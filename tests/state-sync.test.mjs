import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
import {fakeAgenda} from './agenda-fake-store.mjs';

// A1: /api/state lê e grava a agenda normalizada mantendo o contrato do legacy-app.js.
const professional=(id,name)=>({id,name,specialty:'Ortopedia',category:'doctor',active:true,scheduling_enabled:true,agendaEnabled:true,agendaSettings:{workStart:'07:00',workEnd:'19:00'}});
const base=()=>({schemaVersion:7,settings:{workStart:'07:00',workEnd:'19:00'},professionals:[professional('one','Dr. Um'),professional('two','Dra. Dois')],
 hospitals:[{id:'h1',name:'Hospital',abbreviation:'H'}],
 patients:[{id:'p1',doctorId:'one',name:'Paciente Um',cpf:'52998224725',address:'Rua A',insurance:'Unimed',cardNumber:'1'},{id:'p2',doctorId:'two',name:'Paciente Dois',insurance:'',cardNumber:''}],
 appointments:[{id:'a',doctorId:'one',patientId:'p1',status:'scheduled',date:'2026-12-07',time:'10:00',duration:60,procedure:'Consulta'},
  {id:'b',doctorId:'two',patientId:'p2',status:'scheduled',date:'2026-12-07',time:'10:00',duration:60,procedure:'Consulta'},
  {id:'c',doctorId:'one',patientId:'p1',status:'scheduled',date:'2026-12-08',time:'11:00',duration:30,procedure:'Retorno'}],
 cancelledAppointments:[],patientHistory:[],schedulingRules:[],
 scheduleBlocks:[{id:'blk-one',professionalId:'one',date:'2026-12-10',start:'08:00',end:'09:00',reason:'Reunião'},{id:'blk-two',professionalId:'two',date:'2026-12-10',start:'08:00',end:'09:00',reason:'Reunião'}]});

function fixture({role='general_manager',agendaIds=['one'],authenticated=true,store}={}){
 const agenda=store||fakeAgenda(base());
 const api=loadTs('app/api/state/route.ts',{
  '@/app/authz':{getSession:async()=>authenticated?{organization:{id:'org-1'},account:{id:role==='doctor'?3:role==='secretary'?2:1,name:role,email:role+'@example.test',role,doctorId:role==='doctor'?'one':null},services:{scheduling_enabled:true,billing_enabled:false,invoice_enabled:false},agendaIds}:null,isManager:r=>r==='general_manager'},
  '@/lib/supabase-admin':{getSupabaseAdmin:()=>agenda.db,dbError:error=>{if(error)throw Object.assign(new Error(error.message),error)}}
 });
 return {api,agenda};
}
const put=(api,state,revision)=>api.PUT(new Request('http://localhost/api/state',{method:'PUT',headers:{origin:'http://localhost','content-type':'application/json',...(revision?{'if-match':revision}:{})},body:JSON.stringify(state)}));
const read=async api=>(await api.GET()).json();

test('rejects unauthenticated reads and writes',async()=>{
 const f=fixture({authenticated:false});
 assert.equal((await f.api.GET()).status,403);
 assert.equal((await put(f.api,{},'2026-11-03T12:00:00.000Z')).status,403);
 assert.equal(f.agenda.applies().length,0);
});

test('a write without the revision the user read is refused',async()=>{
 const f=fixture(),{state}=await read(f.api);
 assert.equal((await put(f.api,state)).status,409);
 assert.equal((await put(f.api,state,'old')).status,409);
 assert.equal(f.agenda.applies().length,0);
});

test('saves a status change as one versioned operation with one audit entry and a new revision',async()=>{
 const f=fixture(),{state,revision}=await read(f.api);
 state.appointments.find(a=>a.id==='a').status='confirmed';
 const response=await put(f.api,state,revision),body=await response.json();
 assert.equal(response.status,200);
 assert.ok(Date.parse(body.revision)>Date.parse(revision));
 const [call]=f.agenda.applies();
 assert.deepEqual(call.p.p_ops.map(o=>[o.op,o.id,o.expectedVersion]),[['upsert_appointment','a',1]]);
 assert.deepEqual(f.agenda.audit.map(a=>a.action),['appointment_updated']);
 assert.equal(f.agenda.state().appointments.find(a=>a.id==='a').status,'confirmed');
});

test('a no-op save writes nothing; equivalent timestamp formats are accepted',async()=>{
 const f=fixture(),{state}=await read(f.api);
 assert.equal((await put(f.api,state,'2026-11-03T12:00:00+00:00')).status,200);
 assert.equal(f.agenda.applies().length,0);
 assert.equal(f.agenda.audit.length,0);
});

test('visibility by profile: secretary sees her agendas; doctor gets no CPF, address or finance',async()=>{
 const secretary=await read(fixture({role:'secretary'}).api);
 assert.deepEqual(secretary.state.appointments.map(a=>a.id),['a','c']);
 assert.deepEqual(secretary.state.patients.map(p=>p.id),['p1']);
 assert.deepEqual(secretary.state.scheduleBlocks.map(b=>b.id),['blk-one']);
 const doctor=await read(fixture({role:'doctor'}).api);
 assert.deepEqual(doctor.state.patients.map(p=>p.id),['p1']);
 assert.equal(doctor.state.patients[0].cpf,undefined);
 assert.equal(doctor.state.patients[0].address,undefined);
});

test('per-record concurrency: two secretaries editing different appointments do not block each other',async()=>{
 const store=fakeAgenda(base()),one=fixture({role:'secretary',store}),two=fixture({role:'secretary',store});
 const first=await read(one.api),second=await read(two.api);
 first.state.appointments.find(a=>a.id==='a').status='confirmed';
 assert.equal((await put(one.api,first.state,first.revision)).status,200);
 // A segunda sessão ainda tem a cópia antiga de "a"; ela não pode sobrescrever a alteração.
 second.state.appointments.find(a=>a.id==='c').notes='Levar exames';
 assert.equal((await put(two.api,second.state,second.revision)).status,200);
 const final=store.state();
 assert.equal(final.appointments.find(a=>a.id==='a').status,'confirmed');
 assert.equal(final.appointments.find(a=>a.id==='c').notes,'Levar exames');
});

test('per-record concurrency: editing the same appointment changed by someone else is a 409',async()=>{
 const store=fakeAgenda(base()),one=fixture({role:'secretary',store}),two=fixture({role:'secretary',store});
 const first=await read(one.api),second=await read(two.api);
 first.state.appointments.find(a=>a.id==='a').status='confirmed';
 assert.equal((await put(one.api,first.state,first.revision)).status,200);
 second.state.appointments.find(a=>a.id==='a').notes='Outra edição';
 assert.equal((await put(two.api,second.state,second.revision)).status,409);
 const final=store.state().appointments.find(a=>a.id==='a');
 assert.deepEqual([final.status,final.notes],['confirmed',undefined]);
});

test('nothing is deleted by omission; blocks removed by the user become explicit deletions',async()=>{
 const f=fixture(),{state,revision}=await read(f.api);
 state.patients=state.patients.filter(p=>p.id!=='p1');
 state.appointments=state.appointments.filter(a=>a.id!=='a');
 state.scheduleBlocks=state.scheduleBlocks.filter(b=>b.id!=='blk-two');
 assert.equal((await put(f.api,state,revision)).status,200);
 const after=f.agenda.state();
 assert.ok(after.patients.some(p=>p.id==='p1'));
 assert.ok(after.appointments.some(a=>a.id==='a'));
 assert.deepEqual(after.scheduleBlocks.map(b=>b.id),['blk-one']);
 assert.deepEqual(f.agenda.applies()[0].p.p_ops.map(o=>o.op),['delete_block']);
});

test('rows created by others after the read are not deleted by a stale full-state save',async()=>{
 const store=fakeAgenda(base()),one=fixture({store}),two=fixture({store});
 const stale=await read(one.api),fresh=await read(two.api);
 fresh.state.scheduleBlocks.push({id:'blk-new',professionalId:'two',date:'2026-12-11',start:'08:00',end:'09:00',reason:'Curso'});
 assert.equal((await put(two.api,fresh.state,fresh.revision)).status,200);
 stale.state.settings.workEnd='18:00';
 assert.equal((await put(one.api,stale.state,stale.revision)).status,200);
 assert.ok(store.state().scheduleBlocks.some(b=>b.id==='blk-new'));
 assert.equal(store.state().settings.workEnd,'18:00');
});

test('doctor only manages own blocks; other changes are ignored and other agendas stay intact',async()=>{
 const f=fixture({role:'doctor'}),{state,revision}=await read(f.api);
 state.scheduleBlocks.push({id:'blk-doc',professionalId:'one',date:'2026-12-12',start:'14:00',end:'15:00',reason:'Pessoal'});
 state.appointments.find(a=>a.id==='a').status='confirmed';
 assert.equal((await put(f.api,state,revision)).status,200);
 const after=f.agenda.state();
 assert.ok(after.scheduleBlocks.some(b=>b.id==='blk-doc'));
 assert.ok(after.scheduleBlocks.some(b=>b.id==='blk-two'));
 assert.equal(after.appointments.find(a=>a.id==='a').status,'scheduled');
});

test('secretary cannot touch an appointment from another agenda',async()=>{
 const f=fixture({role:'secretary'}),{state,revision}=await read(f.api);
 state.appointments.push({id:'b',doctorId:'two',patientId:'p2',status:'confirmed',date:'2026-12-07',time:'10:00',duration:60,procedure:'Consulta'});
 assert.equal((await put(f.api,state,revision)).status,403);
 assert.equal(f.agenda.applies().length,0);
});

test('cancelling moves the appointment with an explicit cancelled operation and audit',async()=>{
 const f=fixture({role:'secretary'}),{state,revision}=await read(f.api);
 const c=state.appointments.find(a=>a.id==='c');
 state.appointments=state.appointments.filter(a=>a.id!=='c');
 state.cancelledAppointments.push({...c,cancelledAt:'2026-11-03T12:30:00.000Z',cancelReason:'Paciente desmarcou'});
 assert.equal((await put(f.api,state,revision)).status,200);
 const op=f.agenda.applies()[0].p.p_ops[0];
 assert.deepEqual([op.op,op.id,op.cancelled],['upsert_appointment','c',true]);
 assert.deepEqual(f.agenda.audit.map(a=>a.action),['appointment_cancelled']);
 assert.deepEqual(f.agenda.state().cancelledAppointments.map(a=>a.id),['c']);
});

test('newborn patients require a guardian and keep the RN fields',async()=>{
 const f=fixture({role:'secretary'}),{state,revision}=await read(f.api);
 state.patients.push({id:'p-rn',doctorId:'one',name:'RN de Maria',newborn:true,guardianName:''});
 assert.equal((await put(f.api,state,revision)).status,400);
 state.patients.at(-1).guardianName='Maria';
 assert.equal((await put(f.api,state,revision)).status,200);
 const rn=f.agenda.state().patients.find(p=>p.id==='p-rn');
 assert.deepEqual([rn.newborn,rn.guardianName],[true,'Maria']);
});

test('a surgery saved with an anesthetist reaches the anesthetist session at once, with the surgeon patient but no CPF',async()=>{
 const store=fakeAgenda(base()),manager=fixture({store}),anesthetist=fixture({role:'doctor',agendaIds:['anest'],store});
 const {state,revision}=await read(manager.api);
 state.professionals.push({id:'anest',name:'Dr. Carlos',specialty:'Anestesiologia',category:'anesthetist',active:true});
 state.appointments.push({id:'surgery',doctorId:'one',anesthetistId:'anest',patientId:'p1',status:'scheduled',date:'2026-12-09',time:'09:00',duration:90,procedure:'Artroscopia'});
 assert.equal((await put(manager.api,state,revision)).status,200);
 const seen=(await read(anesthetist.api)).state;
 assert.deepEqual(seen.appointments.map(a=>a.id),['surgery']);
 assert.deepEqual(seen.patients.map(p=>p.id),['p1']);
 assert.equal(seen.patients[0].cpf,undefined);
 // Trocar o anestesista tira a cirurgia da agenda anterior.
 const next=(await read(manager.api));
 next.state.appointments.find(a=>a.id==='surgery').anesthetistId=null;
 assert.equal((await put(manager.api,next.state,next.revision)).status,200);
 assert.deepEqual((await read(anesthetist.api)).state.appointments,[]);
});
