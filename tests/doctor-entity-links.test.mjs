import {test} from 'node:test';
import assert from 'node:assert/strict';
// Values evaluated in node:vm have a different prototype realm; compare their JSON shape.
const assertSameStructure=(actual,expected)=>assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected);
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

const {activeBillingEntities,buildDoctorEntityLinkMutation,doctorEntityLink,inactiveEntityHistory}=loadTs('lib/doctor-entity-links.ts');

const entities=[
 {id:'e2',name:'Beta',trade_name:'',active:true},
 {id:'e1',name:'Alfa Legal',trade_name:'Alfa',active:true},
 {id:'e3',name:'Entidade Antiga',trade_name:'',active:false},
];
const links=[
 {id:'l1',doctor_id:'d1',billing_entity_id:'e1',updated_at:'2026-10-01T10:00:00Z',active:true},
 {id:'l2',doctor_id:'d1',billing_entity_id:'e3',updated_at:'2026-10-03T10:00:00Z',active:false},
];

test('doctor entity mutation creates, deactivates and reactivates without delete_link',()=>{
 assertSameStructure(buildDoctorEntityLinkMutation([], 'd1','e1',true),{doctor_id:'d1',billing_entity_id:'e1',active:true});
 assertSameStructure(buildDoctorEntityLinkMutation(links,'d1','e1',false),{id:'l1',doctor_id:'d1',billing_entity_id:'e1',updated_at:'2026-10-01T10:00:00Z',active:false});
 assertSameStructure(buildDoctorEntityLinkMutation(links,'d1','e3',true),{id:'l2',doctor_id:'d1',billing_entity_id:'e3',updated_at:'2026-10-03T10:00:00Z',active:true});
 assertSameStructure(activeBillingEntities(entities).map(entity=>entity.id),['e1','e2']);
 assert.equal(doctorEntityLink(links,'d1','e1')?.active,true);
 assertSameStructure(inactiveEntityHistory({entities,links},'d1').map(({entity})=>entity.id),['e3']);
});

test('focused doctor entities endpoint only serves managers and returns no financial collections',async()=>{
 for(const role of ['doctor','secretary']){
  const endpoint=loadTs('app/api/billing/doctor-entities/route.ts',{'@/app/authz':{getSession:async()=>({account:{role}})},'@/lib/supabase-admin':{getSupabaseAdmin:()=>{throw Error('database must not be queried')}}});
  assert.equal((await endpoint.GET()).status,403);
 }
 const queried=[];
 const organizationId='11111111-1111-4111-8111-111111111111';
 const endpoint=loadTs('app/api/billing/doctor-entities/route.ts',{
  '@/app/authz':{getSession:async()=>({account:{id:1,role:'general_manager'}})},
  '@/lib/supabase-admin':{getSupabaseAdmin:()=>({
   rpc:async(name,args)=>{
    assert.equal(name,'require_rn_agenda_actor_organization');
    assert.equal(args.p_actor,1);
    return {data:organizationId,error:null};
   },
   from(table){
    queried.push(table);
    return {select:()=>({
     eq(column,value){
      assert.equal(column,'organization_id');
      assert.equal(value,organizationId);
      return Promise.resolve({data:table==='billing_entities'?[{id:'e1'}]:[{id:'l1'}],error:null});
     }
    })};
   }
  })}
 });
 const response=await endpoint.GET(),payload=await response.json();
 assertSameStructure(queried,['billing_entities','billing_doctor_entities']);
 assertSameStructure(Object.keys(payload).sort(),['entities','links']);
 assertSameStructure(payload.entities,[{id:'e1'}]);
 assertSameStructure(payload.links,[{id:'l1'}]);
});

test('billing retains entity registration but no longer renders the old links administration',()=>{
 const source=readFileSync('app/billing/billing-client.tsx','utf8');
 assert.match(readFileSync('app/billing/billing-subnav.tsx','utf8'),/>Entidades recebedoras/);
 assert.match(source,/Cadastre os CPF\/CNPJ utilizados para receber pagamentos e\s+emitir notas fiscais\./);
 assert.match(source,/\+ Cadastrar entidade/);
 assert.doesNotMatch(source,/adminView|administration|Vínculos médico ↔ entidade|toggleDoctorEntityLink/);
});


