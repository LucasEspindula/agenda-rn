import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';
import {fakeAgenda} from './agenda-fake-store.mjs';

// Desempenho: a agenda montada é reaproveitada enquanto a revisão for a mesma, em vez de cada aba
// refazer a consulta mais cara do banco. Correção vem antes: revisão nova sempre relê.
const initial=()=>({schemaVersion:7,settings:{workStart:'07:00',workEnd:'19:00'},professionals:[{id:'one',name:'Dr. Um'}],
 hospitals:[],patients:[{id:'p1',doctorId:'one',name:'Paciente Um'}],
 appointments:[{id:'a',doctorId:'one',patientId:'p1',status:'scheduled',date:'2026-12-07',time:'10:00',duration:60,procedure:'Consulta'}],
 cancelledAppointments:[],patientHistory:[],schedulingRules:[],scheduleBlocks:[]});
function setup(){
 const agenda=fakeAgenda(initial());
 const store=loadTs('lib/agenda/store.ts',{'@/lib/supabase-admin':{getSupabaseAdmin:()=>agenda.db,dbError:error=>{if(error)throw Object.assign(new Error(error.message),error)}}});
 const loads=name=>agenda.calls.filter(c=>c.name===name).length;
 return {agenda,store,loads};
}
const upsert=(agenda,data)=>agenda.db.rpc('apply_agenda_changes',{p_ops:[{op:'upsert_appointment',data,expectedVersion:null}]});

test('same revision: the agenda is built once and reused, but the revision is checked every time',async()=>{
 const {store,loads}=setup();
 const first=await store.loadAgendaState(1,'org-1'),second=await store.loadAgendaState(1,'org-1');
 assert.deepEqual(JSON.parse(JSON.stringify(second)),JSON.parse(JSON.stringify(first)));
 assert.equal(loads('load_agenda_state'),1);
 assert.equal(loads('agenda_revision'),2);
});

test('a new revision is always read from the database, asking only for what changed',async()=>{
 const {agenda,store,loads}=setup();
 await store.loadAgendaState(1,'org-1');
 await upsert(agenda,{id:'b',doctorId:'one',patientId:'p1',status:'scheduled',date:'2026-12-08',time:'09:00',duration:30,procedure:'Retorno'});
 const after=await store.loadAgendaState(1,'org-1');
 assert.equal(loads('load_agenda_state'),1);
 assert.equal(loads('load_agenda_delta'),1);
 const delta=agenda.calls.find(c=>c.name==='load_agenda_delta');
 assert.equal(delta.p.p_since,null);assert.equal(delta.p.p_org,'org-1');assert.ok(delta.p.p_after);
 assert.ok(after.state.appointments.some(a=>a.id==='b'));
 assert.equal(after.revision,agenda.revision());
 assert.deepEqual(JSON.parse(JSON.stringify(after.state)),JSON.parse(JSON.stringify(agenda.state())));
});

test('incremental refresh keeps the agenda identical to a full read through edits, cancellations and removals',async()=>{
 const {agenda,store}=setup();
 const since='2026-08-01';
 await store.loadAgendaWindow(1,since,'org-1');
 await upsert(agenda,{id:'b',doctorId:'one',patientId:'p1',status:'scheduled',date:'2026-12-08',time:'09:00',duration:30,procedure:'Retorno'});
 await store.loadAgendaWindow(1,since,'org-1');
 await agenda.db.rpc('apply_agenda_changes',{p_ops:[{op:'upsert_appointment',data:{id:'a',doctorId:'one',patientId:'p1',status:'scheduled',date:'2026-12-07',time:'10:00',duration:60,procedure:'Consulta',cancelledAt:'2026-11-05T10:00:00.000Z',cancelReason:'Viagem'},expectedVersion:1,cancelled:true},
  {op:'upsert_patient',data:{id:'p2',doctorId:'one',name:'Paciente Dois'},expectedVersion:null},{op:'upsert_hospital',data:{id:'h1',name:'Hospital',abbreviation:'H'},expectedVersion:null}]});
 await store.loadAgendaWindow(1,since,'org-1');
 await agenda.db.rpc('apply_agenda_changes',{p_ops:[{op:'archive_appointment',id:'b',expectedVersion:1}]});
 const got=await store.loadAgendaWindow(1,since,'org-1');
 assert.ok(!got.state.appointments.some(a=>a.id==='b'));
 assert.deepEqual([...got.state.cancelledAppointments.map(a=>a.id)],['a']);
 const full=(await agenda.db.rpc('load_agenda_window',{p_actor:1,p_since:since})).data;
 assert.deepEqual(JSON.parse(JSON.stringify(got)),JSON.parse(JSON.stringify(full)));
 assert.equal(agenda.calls.filter(c=>c.name==='load_agenda_window').length,2,'só a primeira leitura e a conferência acima são completas');
 assert.equal(agenda.calls.filter(c=>c.name==='load_agenda_delta').length,3);
});

test('an incomplete or failed incremental read falls back to a full read',async()=>{
 const {agenda,store,loads}=setup();
 await store.loadAgendaState(1,'org-1');
 const rpc=agenda.db.rpc;let mode='missing';
 agenda.db.rpc=async(name,p)=>{
  if(name==='load_agenda_delta'&&mode==='missing'){const r=await rpc(name,p);r.data.order.appointments.push('desconhecido');return r}
  if(name==='load_agenda_delta'&&mode==='error'){agenda.calls.push({name});return {data:null,error:{message:'function public.load_agenda_delta does not exist'}}}
  return rpc(name,p);
 };
 await upsert(agenda,{id:'b',doctorId:'one',patientId:'p1',status:'scheduled',date:'2026-12-08',time:'09:00',duration:30,procedure:'Retorno'});
 const first=await store.loadAgendaState(1,'org-1');
 assert.equal(loads('load_agenda_state'),2);
 assert.ok(first.state.appointments.some(a=>a.id==='b'));
 mode='error';
 await upsert(agenda,{id:'c',doctorId:'one',patientId:'p1',status:'scheduled',date:'2026-12-09',time:'09:00',duration:30,procedure:'Retorno'});
 const second=await store.loadAgendaState(1,'org-1');
 assert.equal(loads('load_agenda_state'),3);
 assert.ok(second.state.appointments.some(a=>a.id==='c'));
});

test('simultaneous reads share a single query',async()=>{
 const {store,loads}=setup();
 const all=await Promise.all(Array.from({length:8},()=>store.loadAgendaWindow(1,'2026-08-01','org-1')));
 assert.equal(loads('load_agenda_window'),1);
 assert.equal(new Set(all.map(s=>s.revision)).size,1);
});

test('every caller gets its own copy: changing one never leaks into the next read',async()=>{
 const {store}=setup();
 const first=await store.loadAgendaState(1,'org-1');
 first.state.appointments[0].status='realized';first.state.patients.push({id:'intruso'});
 const second=await store.loadAgendaState(1,'org-1');
 assert.equal(second.state.appointments[0].status,'scheduled');
 assert.ok(!second.state.patients.some(p=>p.id==='intruso'));
});

test('cache is per organization and per period; without an organization nothing is cached',async()=>{
 const {store,loads}=setup();
 await store.loadAgendaWindow(1,'2026-08-01','org-1');await store.loadAgendaWindow(1,'2026-09-01','org-1');await store.loadAgendaWindow(1,'2026-08-01','org-2');
 assert.equal(loads('load_agenda_window'),3);
 await store.loadAgendaState(1);await store.loadAgendaState(1);
 assert.equal(loads('load_agenda_state'),2);
});

test('a failed read is not cached and the next call tries again',async()=>{
 const {agenda,store,loads}=setup();
 const rpc=agenda.db.rpc;let fail=true;
 agenda.db.rpc=async(name,p)=>{if(name==='load_agenda_state'&&fail){fail=false;agenda.calls.push({name});return {data:null,error:{message:'statement timeout'}}}return rpc(name,p)};
 await assert.rejects(store.loadAgendaState(1,'org-1'));
 const ok=await store.loadAgendaState(1,'org-1');
 assert.ok(ok.state.appointments.length);
 assert.equal(loads('load_agenda_state'),2);
});

test('the cache is bounded and expires, so a stale agenda never lingers',()=>{
 const source=readFileSync(new URL('../lib/agenda/store.ts',import.meta.url),'utf8');
 assert.match(source,/SNAPSHOT_TTL_MS = 30_000/);
 assert.match(source,/while \(snapshotCache\.size > SNAPSHOT_MAX\)/);
 assert.match(source,/hit\.revision === current && Date\.now\(\) - hit\.at < SNAPSHOT_TTL_MS/);
 // O incremental parte da agenda em memória por no máximo 10 min; depois disso relê tudo.
 assert.match(source,/FULL_RELOAD_MS = 10 \* 60_000/);
 assert.match(source,/hit && Date\.now\(\) - hit\.fullAt < FULL_RELOAD_MS \? hit : null/);
});
