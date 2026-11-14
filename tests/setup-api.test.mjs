import test from 'node:test';
import assert from 'node:assert/strict';
import {getSetupReadiness,planSetup} from '../src/setup-api.mjs';
import {handleApi} from '../src/worker.mjs';

const origin='https://concierge.mabrigkorie.org';
const fakeKey='A'.repeat(43);
const goodEnv={DB:{prepare(){return {first:async()=>({name:'users'})};}},GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',CREDENTIALS_KEY:fakeKey,PUBLIC_BASE_URL:origin+'/'};

test('readiness reports migration missing without leaking credentials',()=>{
  const r=getSetupReadiness(goodEnv,{schemaReady:false,requestOrigin:origin});
  assert.equal(r.mode,'demo_only');
  assert.equal(r.checks.database.status,'needs_migration');
  assert.equal(JSON.stringify(r).includes('secret'),false);
  assert.equal(JSON.stringify(r).includes(fakeKey),false);
});
test('ready app still requires separate user consent',()=>{
  const r=getSetupReadiness(goodEnv,{schemaReady:true,requestOrigin:origin});
  assert.equal(r.mode,'consent_ready');
  assert.equal(r.providers.find(x=>x.id==='google_calendar').state,'consent_required');
  assert.equal(r.providers.find(x=>x.id==='gmail').state,'not_enabled');
});
test('incorrect host never claims setup ready',()=>{
  const r=getSetupReadiness(goodEnv,{schemaReady:true,requestOrigin:'https://another.example'});
  assert.equal(r.mode,'demo_only');
  assert.equal(r.checks.domain.status,'host_mismatch');
});
test('missing canonical URL, OAuth and D1 result in demo-only mode',()=>{
  const r=getSetupReadiness({},{});
  assert.equal(r.checks.database.status,'needs_setup');
  assert.equal(r.checks.domain.status,'needs_setup');
  assert.equal(r.mode,'demo_only');
});
test('meeting goal finds Calendar but never claims Gmail access',()=>{
  const r=planSetup('Prepare my meetings for tomorrow',getSetupReadiness(goodEnv,{schemaReady:true,requestOrigin:origin}));
  assert.equal(r.suggestedAgent.id,'meetings');
  assert.ok(r.steps.some(s=>s.id==='calendar'&&s.state==='consent_required'));
  assert.ok(r.steps.some(s=>s.id==='gmail'&&s.state==='not_enabled'));
  assert.equal(r.execution,'none');
});
test('business goal offers demonstration without enabling sending',()=>{
  const r=planSetup('Help follow up with my customers',getSetupReadiness({},{}));
  assert.equal(r.suggestedAgent.id,'customers');
  assert.ok(r.steps.every(s=>s.action!=='send_message'));
});
test('invalid goal is rejected',()=>{
  assert.throws(()=>planSetup('hi',getSetupReadiness({},{})),/8–500/);
  assert.throws(()=>planSetup('x'.repeat(501),getSetupReadiness({},{})),/8–500/);
});
test('public GET readiness survives missing credentials and database',async()=>{
  const response=await handleApi(new Request(origin+'/api/setup/readiness'),{});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.mode,'demo_only');
  assert.equal(result.providers.find(x=>x.id==='gmail').state,'not_enabled');
});
test('public plan does not send credentials or invoke provider APIs',async()=>{
  const response=await handleApi(new Request(origin+'/api/setup/plan',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:origin},
    body:JSON.stringify({goal:'Plan my meetings for the week'})
  }),{});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.source,'deterministic_local_rules');
  assert.equal(result.execution,'none');
});
test('setup plan denies cross-origin and invalid content',async()=>{
  const denied=await handleApi(new Request(origin+'/api/setup/plan',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:'https://attacker.invalid'},
    body:JSON.stringify({goal:'Sort out my meetings'})
  }),{});
  assert.equal(denied.status,403);
  const invalid=await handleApi(new Request(origin+'/api/setup/plan',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:origin},
    body:JSON.stringify({goal:'x'})
  }),{});
  assert.equal(invalid.status,400);
});
