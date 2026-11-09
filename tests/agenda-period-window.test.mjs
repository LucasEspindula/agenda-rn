import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';
import {fakeAgenda} from './agenda-fake-store.mjs';

// Agenda por período: o navegador recebe só o período pedido; gravar com a janela
// nunca remove consultas, pacientes ou histórico antigos.
const professional=(id,name)=>({id,name,specialty:'Ortopedia',category:'doctor',active:true,scheduling_enabled:true,agendaEnabled:true,agendaSettings:{workStart:'07:00',workEnd:'19:00'}});
const base=()=>({schemaVersion:7,settings:{workStart:'07:00',workEnd:'19:00'},professionals:[professional('one','Dr. Um')],
 hospitals:[{id:'h1',name:'Hospital',abbreviation:'H'},{id:'h2',name:'Hospital Antigo',abbreviation:'HA'}],
 patients:[{id:'p1',doctorId:'one',name:'Paciente Um',insurance:'',cardNumber:''}],
 appointments:[{id:'old',doctorId:'one',patientId:'p1',hospitalId:'h2',status:'scheduled',date:'2026-01-10',time:'10:00',duration:60,procedure:'Antiga'},
  {id:'new',doctorId:'one',patientId:'p1',hospitalId:'h1',status:'scheduled',date:'2026-12-07',time:'10:00',duration:60,procedure:'Nova'}],
 cancelledAppointments:[{id:'oldc',doctorId:'one',patientId:'p1',status:'scheduled',date:'2026-02-01',time:'09:00',duration:30,procedure:'Cancelada antiga',cancelledAt:'2026-01-20T10:00:00.000Z',cancelReason:'x'}],
 patientHistory:[{id:'h-old',patientId:'p1',appointmentId:'old',type:'Agendamento criado',text:'a',at:'2026-01-05T10:00:00.000Z'}],schedulingRules:[],scheduleBlocks:[]});
function fixture(){
 const agenda=fakeAgenda(base());
 const api=loadTs('app/api/state/route.ts',{
  '@/app/authz':{getSession:async()=>({organization:{id:'org-1'},account:{id:1,name:'g',email:'g@t.test',role:'general_manager',doctorId:null},services:{scheduling_enabled:true},agendaIds:[]}),isManager:()=>true},
  '@/lib/supabase-admin':{getSupabaseAdmin:()=>agenda.db,dbError:e=>{if(e)throw e}}});
 return {api,agenda};
}
const get=async(api,q='')=>(await api.GET(new Request('http://localhost/api/state'+q))).json();
const put=(api,state,revision)=>api.PUT(new Request('http://localhost/api/state',{method:'PUT',headers:{origin:'http://localhost','content-type':'application/json','if-match':revision},body:JSON.stringify(state)}));
const plain=v=>JSON.parse(JSON.stringify(v));

test('default window is 90 days back in São Paulo time; explicit dates and "all" are honoured; junk falls back',()=>{
 const store=loadTs('lib/agenda/store.ts',{'@/lib/supabase-admin':{getSupabaseAdmin(){},dbError(){}}});
 const now=new Date('2026-11-07T02:30:00Z'); // ainda 06/11 em São Paulo
 assert.equal(store.defaultAgendaSince(now),'2026-08-08');
 assert.equal(store.parseAgendaSince('all',now),null);
 assert.equal(store.parseAgendaSince('2026-03-01',now),'2026-03-01');
 for(const junk of [null,'','2026-02-30','2026-3-1',"2026-03-01'--",'tomorrow'])assert.equal(store.parseAgendaSince(junk,now),'2026-08-08',String(junk));
});

test('GET sends only the requested period and reports the window it used',async()=>{
 const {api,agenda}=fixture();
 const recent=await get(api,'?since=2026-06-01');
 assert.deepEqual(plain(recent.window),{since:'2026-06-01'});
 assert.deepEqual(plain(recent.state.appointments.map(a=>a.id)),['new']);
 assert.equal(recent.state.cancelledAppointments.length,0);
 assert.equal(recent.state.patientHistory.length,0);
 assert.equal(recent.state.hospitals.length,2,'hospitals stay complete');
 const all=await get(api,'?since=all');
 assert.deepEqual(plain(all.window),{since:'all'});
 assert.equal(all.state.appointments.length,2);
 assert.equal(agenda.calls.filter(c=>c.name==='load_agenda_window').at(-1).p.p_since,null);
 const fallback=await get(api);
 assert.match(fallback.window.since,/^\d{4}-\d{2}-\d{2}$/);
});

test('saving from a windowed state keeps old appointments, cancellations and history untouched',async()=>{
 const {api,agenda}=fixture();
 const {state,revision}=await get(api,'?since=2026-06-01');
 state.appointments.find(a=>a.id==='new').status='confirmed';
 const response=await put(api,state,revision);
 assert.equal(response.status,200);
 const ops=agenda.calls.find(c=>c.name==='apply_agenda_changes').p.p_ops;
 assert.deepEqual(plain(ops.map(o=>[o.op,o.id])),[['upsert_appointment','new']]);
 const after=agenda.state();
 assert.ok(after.appointments.some(a=>a.id==='old'));
 assert.ok(after.cancelledAppointments.some(a=>a.id==='oldc'));
 assert.ok(after.patientHistory.some(h=>h.id==='h-old'));
});

test('a hospital used only by appointments outside the window cannot be archived',async()=>{
 const {api,agenda}=fixture();
 const {state,revision}=await get(api,'?since=2026-06-01');
 state.hospitals=state.hospitals.filter(h=>h.id!=='h2');
 const response=await put(api,state,revision);
 assert.equal(response.status,409);
 assert.match((await response.json()).error,/vinculado a agendamentos/);
 assert.equal(agenda.calls.filter(c=>c.name==='apply_agenda_changes').length,0);
});

test('client reads through the window, extends it on navigation and offers older records',()=>{
 const client=readFileSync('public/legacy-app.js','utf8'),host=readFileSync('app/dashboard/legacy-app.tsx','utf8');
 assert.equal((client.match(/fetch\("\/api\/state",\{cache/g)||[]).length,0,'every GET goes through agendaStateUrl()');
 assert.equal((client.match(/fetch\(agendaStateUrl\(\)/g)||[]).length,4);
 assert.match(client,/if\(!agendaWindowCovers\(ds\(days\[0\]\)\)\)void ensureAgendaWindow\(ds\(days\[0\]\)\);/);
 assert.match(client,/if\(!agendaWindowCovers\(monthDates\[0\]\)\)void ensureAgendaWindow\(monthDates\[0\]\);/);
 assert.match(client,/agendaWindowNote\("Mostrando cancelamentos com data"\)/);
 assert.match(client,/agendaWindowNote\("Mostrando histórico"\)/);
 assert.match(client,/if\(Storage\.saving\|\|Storage\.pending\|\|agendaEditorOpen\(\)\)/);
 assert.match(host,/AgendaWindowSince = state\.window\?\.since/);
});
