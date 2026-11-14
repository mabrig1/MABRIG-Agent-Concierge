import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker,{b64u,encryptCredential,decryptCredential,makeCalendarBrief,sessionCookie,oauthCookie,safeBaseUrl,CALENDAR_SCOPE} from '../src/worker.mjs';
const host='https://concierge.example.test';
const secrets={GOOGLE_CLIENT_ID:'test-oauth-client',GOOGLE_CLIENT_SECRET:'server-only-secret',CREDENTIALS_KEY:b64u(new Uint8Array(32).fill(17)),PUBLIC_BASE_URL:host};
function dbBinding(){
  const db=new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON;');db.exec(readFileSync('db/0001_init.sql','utf8'));
  return {raw:db,async batch(statements){db.exec('BEGIN');try{const out=statements.map(s=>({meta:{changes:db.prepare(s._sql).run(...s._args).changes}}));db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}},prepare(sql){const statement=db.prepare(sql);return {bind(...args){return {_sql:sql,_args:args,
    first:async()=>statement.get(...args)||null,
    all:async()=>({results:statement.all(...args)}),
    run:async()=>({meta:{changes:statement.run(...args).changes}})
  };}}}};
}
function makeEnv(){return {...secrets,DB:dbBinding()};}
const req=(path,options={})=>new Request(host+path,options);
const getCookies=(response)=>response.headers.getSetCookie();
function findCookie(response,name){const c=getCookies(response).find(x=>x.startsWith(name+'='));assert.ok(c,'cookie must be set: '+name);return c.split(';')[0];}
function mockGoogle(){
  const original=globalThis.fetch;
  let current='alice',apiCalls=0,revokeCalls=0,calendarAuthError=false,revokeFailure=false;
  globalThis.fetch=async(input,options={})=>{
    const url=typeof input==='string'?input:input.toString();
    if(url.includes('/token')){
      const form=new URLSearchParams(options.body);
      if(form.get('grant_type')==='refresh_token')return Response.json({access_token:'refreshed-access',expires_in:3600});
      return Response.json({access_token:`access-${current}`,refresh_token:`refresh-${current}`,expires_in:3600,scope:`openid email profile ${CALENDAR_SCOPE}`});
    }
    if(url.includes('/userinfo')){const name=options.headers.Authorization.split('-').at(-1);return Response.json({sub:`sub-${name}`,email:`${name}@example.test`,email_verified:true});}
    if(url.includes('/events')){apiCalls++;if(calendarAuthError)return new Response('Unauthorized',{status:401});return Response.json({items:[{id:'e1',summary:'Design review',start:{dateTime:'2026-11-16T09:00:00Z'},end:{dateTime:'2026-11-16T09:45:00Z'},location:'Online'}]});}
    if(url.includes('/revoke')){revokeCalls++;return new Response('',{status:revokeFailure?503:200});}
    throw new Error('Unexpected fetch: '+url);
  };
  return {set(name){current=name;},setAuthError(v){calendarAuthError=v;},setRevokeFailure(v){revokeFailure=v;},calls(){return {apiCalls,revokeCalls};},restore(){globalThis.fetch=original;}};
}
async function signin(env,name){
  const start=await worker.fetch(req('/api/auth/google/start'),env);assert.equal(start.status,303);
  const loc=new URL(start.headers.get('location'));
  assert.equal(loc.origin,'https://accounts.google.com');
  assert.equal(loc.searchParams.get('code_challenge_method'),'S256');
  assert.ok(!loc.href.includes('server-only-secret'));
  const oauth=findCookie(start,oauthCookie(new URL(host)));
  const callback=`/api/oauth/google/callback?state=${encodeURIComponent(loc.searchParams.get('state'))}&code=test-${name}`;
  const finish=await worker.fetch(req(callback,{headers:{cookie:oauth}}),env);
  assert.equal(finish.status,303);
  assert.ok(getCookies(finish).some(c=>c.startsWith(oauthCookie(new URL(host))+'=;')),'OAuth state cookie cleared');
  return findCookie(finish,sessionCookie(new URL(host)));
}
async function connectCalendar(env,session){
  const start=await worker.fetch(req('/api/calendar/connect/start',{headers:{cookie:session}}),env);
  assert.equal(start.status,303);
  const target=new URL(start.headers.get('location'));
  assert.ok(target.searchParams.get('scope').includes(CALENDAR_SCOPE));
  const oauth=findCookie(start,oauthCookie(new URL(host)));
  const callback=`/api/oauth/google/callback?state=${encodeURIComponent(target.searchParams.get('state'))}&code=calendar-test`;
  const finish=await worker.fetch(req(callback,{headers:{cookie:`${session}; ${oauth}`}}),env);
  return {finish,target,oauth,callback};
}
test('unconfigured instance is safely demo-only',async()=>{
  const status=await worker.fetch(req('/api/status'),{});assert.equal(status.status,200);
  assert.equal((await status.json()).configured,false);
  const live=await worker.fetch(req('/api/calendar/brief'),{});assert.equal(live.status,503);
});
test('base URL prevents arbitrary domains and credential URLs',()=>{
  assert.throws(()=>safeBaseUrl({...secrets,PUBLIC_BASE_URL:'http://evil.example.test'}));
  assert.throws(()=>safeBaseUrl({...secrets,PUBLIC_BASE_URL:'https://evil.example.test/path'}));
  assert.equal(safeBaseUrl(secrets).origin,host);
});
test('AES-GCM token vault authenticates tenant context',async()=>{
  const key=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(17),'AES-GCM',false,['encrypt','decrypt']);
  const encrypted=await encryptCredential({refresh_token:'never-in-browser'},key,'alice:calendar');
  assert.ok(!encrypted.includes('never-in-browser'));
  assert.deepEqual(await decryptCredential(encrypted,key,'alice:calendar'),{refresh_token:'never-in-browser'});
  await assert.rejects(decryptCredential(encrypted,key,'bob:calendar'));
});
test('Google sign-in and read-only Calendar flow, with disconnect',async()=>{
  const google=mockGoogle();try{
    const env=makeEnv();
    const session=await signin(env,'alice');
    const status=await worker.fetch(req('/api/status',{headers:{cookie:session}}),env);
    assert.deepEqual((await status.json()).connection,{googleCalendar:false,gmail:false});
    assert.equal((await worker.fetch(req('/api/calendar/brief',{headers:{cookie:session}}),env)).status,409);
    const {finish,callback,oauth}=await connectCalendar(env,session);
    assert.equal(finish.status,303);
    assert.equal((await worker.fetch(req(callback,{headers:{cookie:`${session}; ${oauth}`}}),env)).status,400,'state is one-use');
    const row=env.DB.raw.prepare('SELECT encrypted_tokens FROM connections').get();
    assert.ok(!row.encrypted_tokens.includes('refresh-alice'),'tokens encrypted in D1');
    const brief=await worker.fetch(req('/api/calendar/brief',{headers:{cookie:session}}),env);
    assert.equal(brief.status,200);
    const data=await brief.json();assert.equal(data.source,'GOOGLE_CALENDAR_READ_ONLY');assert.equal(data.count,1);
    assert.equal(data.events[0].title,'Design review');assert.equal(google.calls().apiCalls,1);
    const noOrigin=await worker.fetch(req('/api/connections/google-calendar/disconnect',{method:'POST',headers:{cookie:session}}),env);
    assert.equal(noOrigin.status,403);
    const disconnected=await worker.fetch(req('/api/connections/google-calendar/disconnect',{method:'POST',headers:{cookie:session,Origin:host}}),env);
    assert.equal((await disconnected.json()).providerRevoked,true);
    assert.equal(google.calls().revokeCalls,1);
    assert.equal((await worker.fetch(req('/api/calendar/brief',{headers:{cookie:session}}),env)).status,409);
  }finally{google.restore();}
});
test('each signed-in user can only manage their own assistant recipes',async()=>{
  const google=mockGoogle();try{
    const env=makeEnv();const alice=await signin(env,'alice');google.set('bob');const bob=await signin(env,'bob');
    const agent={goal:'Prepare an overview of my weekly appointments',templateId:'meetings',customName:'My briefing'};
    const noOrigin=await worker.fetch(req('/api/agents',{method:'POST',headers:{cookie:alice,'Content-Type':'application/json'},body:JSON.stringify(agent)}),env);
    assert.equal(noOrigin.status,403);
    const created=await worker.fetch(req('/api/agents',{method:'POST',headers:{cookie:alice,Origin:host,'Content-Type':'application/json'},body:JSON.stringify(agent)}),env);
    assert.equal(created.status,201);const a=await created.json();assert.equal(a.status,'paused');
    const bobList=await worker.fetch(req('/api/agents',{headers:{cookie:bob}}),env);assert.equal((await bobList.json()).agents.length,0);
    const cross=await worker.fetch(req(`/api/agents/${a.id}/status`,{method:'POST',headers:{cookie:bob,Origin:host,'Content-Type':'application/json'},body:JSON.stringify({status:'ready'})}),env);
    assert.equal(cross.status,404);
    const own=await worker.fetch(req(`/api/agents/${a.id}/status`,{method:'POST',headers:{cookie:alice,Origin:host,'Content-Type':'application/json'},body:JSON.stringify({status:'ready'})}),env);
    assert.equal(own.status,200);
    const aliceList=await worker.fetch(req('/api/agents',{headers:{cookie:alice}}),env);assert.equal((await aliceList.json()).agents[0].status,'ready');
    const logout=await worker.fetch(req('/api/auth/logout',{method:'POST',headers:{cookie:alice,Origin:host}}),env);assert.equal(logout.status,200);
    assert.equal((await worker.fetch(req('/api/agents',{headers:{cookie:alice}}),env)).status,401);
  }finally{google.restore();}
});
test('Calendar must belong to the already signed-in Google identity',async()=>{
  const google=mockGoogle();try{
    const env=makeEnv();const alice=await signin(env,'alice');google.set('bob');
    const {finish}=await connectCalendar(env,alice);
    assert.equal(finish.status,403);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS count FROM connections').get().count,0);
  }finally{google.restore();}
});
test('calendar brief shows only approved minimal event fields',()=>{
  const brief=makeCalendarBrief([{id:'abc',summary:'Strategy session',start:{date:'2026-11-15'},description:'SECRET DO NOT EXPORT',attendees:[{email:'private@example.com'}]}]);
  assert.equal(brief.count,1);assert.ok(!JSON.stringify(brief).includes('SECRET'));assert.ok(!JSON.stringify(brief).includes('private@example.com'));
});
test('build allowlist excludes backend, database and credentials',()=>{
  assert.ok(existsSync('dist/src/app.mjs'));assert.ok(!existsSync('dist/src/worker.mjs'));assert.ok(!existsSync('dist/db/0001_init.sql'));
});
test('saved Calendar agent can prepare live read-only brief, with audit trail and tenant checks',async()=>{
  const google=mockGoogle();try{
    const env=makeEnv();const alice=await signin(env,'alice');await connectCalendar(env,alice);
    const body={goal:'Prepare all my weekly meetings each morning',templateId:'meetings'};
    const saved=await worker.fetch(req('/api/agents',{method:'POST',headers:{cookie:alice,Origin:host,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
    assert.equal(saved.status,201);const {id}=await saved.json();
    const blocked=await worker.fetch(req(`/api/agents/${id}/prepare`,{method:'POST',headers:{cookie:alice,Origin:host,'Content-Type':'application/json'},body:'{}'}),env);
    assert.equal(blocked.status,409,'paused agent must not run');
    const ready=await worker.fetch(req(`/api/agents/${id}/status`,{method:'POST',headers:{cookie:alice,Origin:host,'Content-Type':'application/json'},body:JSON.stringify({status:'ready'})}),env);assert.equal(ready.status,200);
    const prepared=await worker.fetch(req(`/api/agents/${id}/prepare`,{method:'POST',headers:{cookie:alice,Origin:host,'Content-Type':'application/json'},body:'{}'}),env);
    assert.equal(prepared.status,200);const data=await prepared.json();assert.equal(data.agentId,id);assert.equal(data.count,1);
    const trail=await worker.fetch(req('/api/activity',{headers:{cookie:alice}}),env);const activity=(await trail.json()).activity.map(x=>x.event);
    assert.ok(activity.includes('calendar_brief_prepared'));assert.ok(activity.includes('calendar_connected'));assert.ok(activity.includes('agent_recipe_saved'));
    google.set('bob');const bob=await signin(env,'bob');
    const forbidden=await worker.fetch(req(`/api/agents/${id}/prepare`,{method:'POST',headers:{cookie:bob,Origin:host,'Content-Type':'application/json'},body:'{}'}),env);
    assert.equal(forbidden.status,404);assert.equal((await (await worker.fetch(req('/api/activity',{headers:{cookie:bob}}),env)).json()).activity.length,1);
  }finally{google.restore();}
});
test('Google OAuth start throttle limits same-IP login churn',async()=>{
  const env=makeEnv();let last;
  for(let i=0;i<21;i++)last=await worker.fetch(req('/api/auth/google/start',{headers:{'CF-Connecting-IP':'203.0.113.3'}}),env);
  assert.equal(last.status,429);
  const other=await worker.fetch(req('/api/auth/google/start',{headers:{'CF-Connecting-IP':'203.0.113.4'}}),env);
  assert.equal(other.status,303);
});


test('Connection health reports disconnected, working and revoked states without leaking calendar content',async()=>{
  const google=mockGoogle();try{
    const env=makeEnv(),alice=await signin(env,'alice');
    const path='/api/connections/google-calendar/health';
    let result=await (await worker.fetch(req(path,{headers:{cookie:alice}}),env)).json();
    assert.equal(result.status,'not_connected');
    await connectCalendar(env,alice);
    result=await (await worker.fetch(req(path,{headers:{cookie:alice}}),env)).json();
    assert.equal(result.status,'healthy');assert.ok(result.checkedAt);
    assert.ok(!JSON.stringify(result).includes('Design review'));
    google.setAuthError(true);
    result=await (await worker.fetch(req(path,{headers:{cookie:alice}}),env)).json();
    assert.equal(result.status,'needs_reconnect');assert.equal(result.action,'reconnect');
    google.set('bob');const bob=await signin(env,'bob');
    const other=await (await worker.fetch(req(path,{headers:{cookie:bob}}),env)).json();assert.equal(other.status,'not_connected');
  }finally{google.restore();}
});

test('account export is tenant scoped, strips tokens and refuses anonymous access',async()=>{
  const google=mockGoogle();try{
    const env=makeEnv(),alice=await signin(env,'alice');await connectCalendar(env,alice);
    const jsonAgent={goal:'Prepare all my weekly appointments each morning',templateId:'meetings'};
    const saved=await worker.fetch(req('/api/agents',{method:'POST',headers:{cookie:alice,Origin:host,'Content-Type':'application/json'},body:JSON.stringify(jsonAgent)}),env);
    assert.equal(saved.status,201);
    const res=await worker.fetch(req('/api/account/export',{headers:{cookie:alice}}),env);
    assert.equal(res.status,200);const exported=await res.json();
    assert.equal(exported.format,'mabrig-agent-concierge-account-export');
    assert.equal(exported.account.email,'alice@example.test');
    assert.equal(exported.agents.length,1);assert.equal(exported.connections.length,1);
    const raw=JSON.stringify(exported);
    for(const secret of ['access-alice','refresh-alice','encrypted_tokens','google_sub','token_hash','server-only-secret'])assert.ok(!raw.includes(secret),'must not include '+secret);
    google.set('bob');const bob=await signin(env,'bob');
    const other=await (await worker.fetch(req('/api/account/export',{headers:{cookie:bob}}),env)).json();
    assert.equal(other.agents.length,0);assert.equal(other.connections.length,0);
    assert.equal((await worker.fetch(req('/api/account/export'),env)).status,401);
  }finally{google.restore();}
});

test('agent deletion is protected against cross-tenant and missing-origin requests',async()=>{
  const google=mockGoogle();try{
    const env=makeEnv(),alice=await signin(env,'alice');
    const body={goal:'Prepare all my meetings for next week',templateId:'meetings'};
    const saved=await worker.fetch(req('/api/agents',{method:'POST',headers:{cookie:alice,Origin:host,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
    const {id}=await saved.json();google.set('bob');const bob=await signin(env,'bob');
    assert.equal((await worker.fetch(req(`/api/agents/${id}`,{method:'DELETE',headers:{cookie:bob,Origin:host}}),env)).status,404);
    assert.equal((await worker.fetch(req(`/api/agents/${id}`,{method:'DELETE',headers:{cookie:alice}}),env)).status,403);
    const own=await worker.fetch(req(`/api/agents/${id}`,{method:'DELETE',headers:{cookie:alice,Origin:host}}),env);
    assert.equal(own.status,200);assert.equal((await own.json()).deleted,true);
    assert.equal((await (await worker.fetch(req('/api/agents',{headers:{cookie:alice}}),env)).json()).agents.length,0);
  }finally{google.restore();}
});

test('delete account requires recent sign-in and explicit confirmation, cascades without touching another tenant',async()=>{
  const google=mockGoogle();try{
    const env=makeEnv(),alice=await signin(env,'alice');await connectCalendar(env,alice);
    const body={goal:'Prepare all my meetings for next week',templateId:'meetings'};
    const saved=await worker.fetch(req('/api/agents',{method:'POST',headers:{cookie:alice,Origin:host,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
    assert.equal(saved.status,201);
    google.set('bob');const bob=await signin(env,'bob');
    const path='/api/account/delete';
    const params={method:'POST',headers:{cookie:alice,Origin:host,'Content-Type':'application/json'},body:JSON.stringify({confirmation:'DELETE MY ACCOUNT',email:'alice@example.test'})};
    assert.equal((await worker.fetch(req(path,{...params,headers:{...params.headers,Origin:'https://attacker.test'}}),env)).status,403);
    assert.equal((await worker.fetch(req(path,{...params,body:JSON.stringify({confirmation:'DELETE',email:'alice@example.test'})}),env)).status,400);
    assert.equal((await worker.fetch(req(path,{...params,body:JSON.stringify({confirmation:'DELETE MY ACCOUNT',email:'bob@example.test'})}),env)).status,400);
    env.DB.raw.prepare('UPDATE sessions SET created_at = 1 WHERE user_id=(SELECT id FROM users WHERE email=?)').run('alice@example.test');
    assert.equal((await worker.fetch(req(path,params),env)).status,409,'old auth must not allow deletion');
    env.DB.raw.prepare('UPDATE sessions SET created_at = ? WHERE user_id=(SELECT id FROM users WHERE email=?)').run(Math.floor(Date.now()/1000),'alice@example.test');
    google.setRevokeFailure(true);
    const deleted=await worker.fetch(req(path,params),env);assert.equal(deleted.status,200);
    const data=await deleted.json();assert.equal(data.deleted,true);assert.equal(data.providerRevoked,false);
    assert.equal((await worker.fetch(req('/api/status',{headers:{cookie:alice}}),env)).status,200);
    assert.equal((await (await worker.fetch(req('/api/status',{headers:{cookie:alice}}),env)).json()).signedIn,false);
    assert.equal((await worker.fetch(req('/api/account/export',{headers:{cookie:alice}}),env)).status,401);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM connections').get().n,0);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM agents').get().n,0);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM activity WHERE user_id NOT IN (SELECT id FROM users)').get().n,0);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1,"other user's session survives");
    assert.equal((await (await worker.fetch(req('/api/account/export',{headers:{cookie:bob}}),env)).json()).account.email,'bob@example.test');
  }finally{google.restore();}
});