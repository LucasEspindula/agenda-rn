import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

const {activeBillingEntities,activeEntityLinkCount,buildDoctorEntityLinkMutation,doctorEntityLink,inactiveEntityHistory,sortedBillingDoctors}=loadTs('lib/doctor-entity-links.ts');

const entities=[
 {id:'e2',name:'Beta',trade_name:'',active:true},
 {id:'e1',name:'Alfa Legal',trade_name:'Alfa',active:true},
 {id:'e3',name:'Empresa Antiga',trade_name:'',active:false},
];
const links=[
 {id:'l1',doctor_id:'d1',billing_entity_id:'e1',updated_at:'2026-10-01T10:00:00Z',active:true},
 {id:'l2',doctor_id:'d1',billing_entity_id:'e2',updated_at:'2026-10-02T10:00:00Z',active:true},
 {id:'l3',doctor_id:'d1',billing_entity_id:'e3',updated_at:'2026-10-03T10:00:00Z',active:false},
];
const data={entities,links,doctors:[{id:'d2',name:'Bruno'},{id:'d1',name:'Ana'}]};

test('doctor entity mutation creates, deactivates and reactivates without delete_link',()=>{
 assert.deepEqual(buildDoctorEntityLinkMutation([], 'd1','e1',true),{doctor_id:'d1',billing_entity_id:'e1',active:true});
 assert.deepEqual(buildDoctorEntityLinkMutation(links,'d1','e1',false),{id:'l1',doctor_id:'d1',billing_entity_id:'e1',updated_at:'2026-10-01T10:00:00Z',active:false});
 assert.deepEqual(buildDoctorEntityLinkMutation(links,'d1','e3',true),{id:'l3',doctor_id:'d1',billing_entity_id:'e3',updated_at:'2026-10-03T10:00:00Z',active:true});
});

test('doctor links show every doctor, active options and inactive history independently',()=>{
 assert.deepEqual(sortedBillingDoctors(data.doctors).map(doctor=>doctor.id),['d1','d2']);
 assert.deepEqual(activeBillingEntities(entities).map(entity=>entity.id),['e1','e2']);
 assert.equal(activeEntityLinkCount(data,'d1'),2);
 assert.equal(activeEntityLinkCount(data,'d2'),0);
 assert.equal(doctorEntityLink(links,'d1','e1')?.active,true);
 assert.equal(doctorEntityLink(links,'d1','e2')?.active,true);
 assert.equal(doctorEntityLink(links,'d1','e3')?.active,false);
 assert.deepEqual(inactiveEntityHistory(data,'d1').map(({entity})=>entity.id),['e3']);
});

test('links UI is doctor-based multi-control editing without the old modal or delete flow',()=>{
 const source=readFileSync('app/billing/billing-client.tsx','utf8');
 assert.match(source,/const linkDoctors=sortedBillingDoctors\(data\.doctors\)/);
 assert.match(source,/linkDoctors\.map\(doctor=>/);
 assert.match(source,/visibleLinkEntities\.map\(entity=>/);
 assert.match(source,/type="checkbox"/);
 assert.match(source,/buildDoctorEntityLinkMutation\(data\.links,doctorId,entityId,desiredActive\)/);
 assert.match(source,/kind:'link'/);
 assert.doesNotMatch(source,/\+ Novo vínculo/);
 assert.doesNotMatch(source,/open\('link'/);
 assert.doesNotMatch(source,/askDelete\('link'/);
 assert.doesNotMatch(source,/editing==='link'/);
});


test('link toggle preserves the API error after reloading the server state',()=>{
 const source=readFileSync('app/billing/billing-client.tsx','utf8');
 const start=source.indexOf('async function toggleDoctorEntityLink');
 const end=source.indexOf(' const set=',start);
 assert.notEqual(start,-1);
 assert.notEqual(end,-1);
 const handler=source.slice(start,end);
 const catchStart=handler.indexOf('}catch(e){');
 const finallyStart=handler.indexOf('}finally{',catchStart);
 assert.notEqual(catchStart,-1);
 assert.notEqual(finallyStart,-1);
 const failure=handler.slice(catchStart,finallyStart);
 const capture=failure.indexOf("const errorMessage=e instanceof Error?e.message:'Não foi possível atualizar o vínculo.';");
 const reload=failure.indexOf('await load();');
 const restore=failure.indexOf('setError(errorMessage);');
 assert.ok(capture>=0,'the API error is captured');
 assert.ok(capture<reload,'the error is kept before the reload');
 assert.ok(reload<restore,'the error is restored after the reload clears it');
 assert.match(handler,/finally\{setSavingLinks\(values=>\{const next=\{\.\.\.values\};delete next\[key\];return next\}\)\}/);
 assert.doesNotMatch(handler,/delete_link/);
});
