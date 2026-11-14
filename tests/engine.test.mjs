import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgent,recommendTemplate,simulateAgent,connectionList,safeExport,TEMPLATES} from '../src/engine.mjs';
test('selects requested assistant types',()=>{
 assert.equal(recommendTemplate('Help with my meetings tomorrow'),'meetings');
 assert.equal(recommendTemplate('Follow up with clients and leads'),'customers');
 assert.equal(recommendTemplate('organize my daily plan'),'personal');
 assert.equal(recommendTemplate('sort my emails'),'inbox');
});
test('creates safe default draft-only agent',()=>{
 const a=createAgent({goal:'Help manage my customer emails',templateId:'customers'});
 assert.equal(a.status,'demo-ready');
 assert.equal(a.rules.approval,true);
 assert.equal(a.rules.readOnly,true);
 assert.ok(a.connections.includes('Gmail'));
});
test('cannot create empty instructions',()=>{
 assert.throws(()=>createAgent({goal:'hi'}),/at least 8/);
});
test('runs offline simulation without claiming live data',()=>{
 const a=createAgent({goal:'Prepare my meetings tomorrow',templateId:'meetings'});
 const r=simulateAgent(a);
 assert.equal(r.source,'SAMPLE_DATA_ONLY');
 assert.ok(r.items.length>0);
 assert.ok(r.items.every(x=>!x.id.includes('undefined')));
 assert.throws(()=>simulateAgent({...a,status:'paused'}),/Resume/);
});
test('lists required provider connections without duplicates',()=>{
 const agents=TEMPLATES.map(t=>createAgent({goal:'Help me organize my messages',templateId:t.id}));
 assert.deepEqual(connectionList(agents),['Gmail','Google Calendar']);
});
test('exports portable demo state without credentials',()=>{
 const exported=safeExport({agents:[],activity:[],approvals:[]});
 assert.match(exported,/mabrig-agent-concierge-demo-v1/);
 assert.doesNotMatch(exported,/access_token/);
});