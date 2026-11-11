// Assistente da agenda: resumo do dia e lembretes por papel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

const assistant=loadTs('lib/agenda/assistant.ts');
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
// 11/11/2026 10:00 em São Paulo (13:00 UTC).
const now=new Date('2026-11-11T13:00:00Z');
const appt=(id,doctorId,date,time,extra={})=>({id,doctorId,patientId:'p-'+doctorId,date,time,duration:60,status:'scheduled',procedure:'Consulta',insurance:'Unimed',...extra});
function state(){return {
 professionals:[{id:'d1',name:'Dr. Um'},{id:'d2',name:'Dra. Dois'},{id:'d3',name:'Dr. Anestesista'}],
 patients:[{id:'p-d1',name:'Ana',doctorId:'d1'},{id:'p-d2',name:'Bia',doctorId:'d2'}],
 appointments:[
  appt('a1','d1','2026-11-11','09:00'),
  appt('a2','d1','2026-11-12','10:00',{status:'confirmed',guideExpiry:'2026-11-14'}),
  appt('a3','d2','2026-11-12','08:00'),
  appt('a4','d1','2026-11-13','14:00',{anesthetistId:'d3',status:'confirmed'}),
  appt('a5','d1','2026-11-13','14:30',{status:'confirmed',guideExpiry:'2026-12-30'}),
  appt('a6','d1','2026-11-15','08:00',{status:'confirmed',forma_cobranca:'PARTICULAR',insurance:null}),
  appt('a7','d1','2026-11-16','08:00',{status:'cancelled'}),
 ],
 scheduleBlocks:[{id:'b1',professionalId:'d2',date:'2026-11-12',start:'08:30',end:'09:30',reason:'Congresso'}],
 schedulingRules:[],
}}
const requests=[
 {id:'r-old',professional_id:'d1',action:'create',status:'pending',requested_by:9,created_at:'2026-11-09T12:00:00Z',proposed_payload:{patientId:'p-d1',date:'2026-11-20',time:'10:00'}},
 {id:'r-new',professional_id:'d1',action:'update',status:'pending',requested_by:9,created_at:'2026-11-11T11:00:00Z',proposed_payload:{patientId:'p-d1',date:'2026-11-21',time:'10:00'}},
 {id:'r-d2',professional_id:'d2',action:'delete',status:'pending',requested_by:11,created_at:'2026-11-08T12:00:00Z',previous_payload:{patientId:'p-d2',date:'2026-11-22',time:'09:00'}},
];
const build=(role,agendaIds,userId=1)=>plain(assistant.buildAgendaSummary({state:state(),role,agendaIds,userId,now,requests}));
const kinds=s=>Object.fromEntries(s.reminders.map(r=>[r.kind,r.items.map(i=>i.appointmentId||i.requestId)]));

test('data do resumo é a de São Paulo, não a UTC',()=>{
 assert.equal(assistant.localDate(new Date('2026-11-12T02:30:00Z')),'2026-11-11');
 assert.equal(assistant.addDays('2026-12-31',1),'2027-01-01');
});

test('gerência: visão da organização inteira com todos os lembretes',()=>{
 const s=build('general_manager',[]);
 assert.equal(s.date,'2026-11-11');assert.equal(s.agenda.today,1);assert.equal(s.agenda.tomorrow,2);
 assert.deepEqual(s.agenda.professionals.map(p=>[p.id,p.today,p.tomorrow]),[['d1',1,1],['d2',0,1]]);
 const k=kinds(s);
 assert.deepEqual(k.unconfirmed,['a1','a3']);
 assert.deepEqual(k.guide_expiring,['a2']);
 // Particular não precisa de guia; cancelado não entra.
 assert.deepEqual(k.guide_missing,['a1','a3','a4']);
 // a4 x a5 se sobrepõem na agenda d1; a3 cai dentro do bloqueio de d2.
 assert.deepEqual(k.conflict,['a3','a4']);
 assert.deepEqual(k.stale_suggestion,['r-d2','r-old']);
});

test('secretária: só as agendas liberadas',()=>{
 const s=build('secretary',['d1']),k=kinds(s);
 assert.equal(s.agenda.tomorrow,1);
 assert.deepEqual(s.agenda.professionals.map(p=>p.id),['d1']);
 assert.deepEqual(k.unconfirmed,['a1']);
 assert.deepEqual(k.conflict,['a4']);
 assert.deepEqual(k.stale_suggestion,['r-old']);
 assert.ok(!JSON.stringify(s).includes('Bia'));
});

test('médico: nenhuma pendência; vê a agenda de hoje dele e das agendas a que tem acesso',()=>{
 const s=build('doctor',['d1'],9);
 assert.equal(s.reminders.length,0);
 assert.deepEqual(s.todayList.map(i=>[i.appointmentId,i.title]),[['a1','09:00 · Ana']]);
 const both=build('doctor',['d1','d2'],9);
 assert.equal(both.reminders.length,0);assert.equal(both.agenda.tomorrow,2);
 assert.equal(build('secretary',['d1']).todayList,undefined);
});

test('conflito do anestesista aparece para quem cuida da agenda dele',()=>{
 const s=plain(assistant.buildAgendaSummary({state:{...state(),appointments:[...state().appointments,appt('a8','d2','2026-11-13','14:15',{anesthetistId:'d3',status:'confirmed'})]},role:'secretary',agendaIds:['d3'],userId:8,now,requests:[]}));
 assert.deepEqual(kinds(s).conflict,['a4']);
 assert.match(s.reminders.find(r=>r.kind==='conflict').items[0].detail,/^Dr\. Anestesista · sobrepõe/);
});

test('lista limitada a 8 itens, com a contagem total',()=>{
 const many=state();many.appointments=Array.from({length:12},(_,i)=>appt('x'+i,'d1','2026-11-12',String(7+i).padStart(2,'0')+':00',{duration:30}));
 const r=plain(assistant.buildAgendaSummary({state:many,role:'general_manager',agendaIds:[],userId:1,now,requests:[]})).reminders.find(r=>r.kind==='unconfirmed');
 assert.equal(r.count,12);assert.equal(r.items.length,assistant.MAX_ITEMS);
});

test('sem pendências: nenhum lembrete',()=>{
 const empty={...state(),appointments:[appt('ok','d1','2026-11-12','10:00',{status:'confirmed',forma_cobranca:'PARTICULAR',insurance:null})],scheduleBlocks:[]};
 assert.equal(plain(assistant.buildAgendaSummary({state:empty,role:'general_manager',agendaIds:[],userId:1,now,requests:[]})).reminders.length,0);
});

test('rota usa a visibilidade por papel e o mesmo filtro das sugestões',()=>{
 const route=read('app/api/agenda/summary/route.ts');
 assert.match(route,/if \(!session\?\.account \|\| !canUseAgenda\(session\)\) return Response\.json\(\{ error: "Acesso não autorizado" \}, \{ status: 403 \}\);/);
 assert.match(route,/state: visibleState\(state, session\), role, agendaIds: session\.agendaIds/);
 assert.match(route,/\.eq\("organization_id", org\)\.eq\("status", "pending"\)/);
 assert.match(route,/if \(role !== "doctor"\) \{/);
 assert.match(route,/if \(!isManager\(role\)\) requests = requests\.in\("professional_id", session\.agendaIds\);/);
 assert.doesNotMatch(read('lib/agenda/assistant.ts'),/\.(cpf|payment|invoiceNumber|received_amount|address)\b/);
});

test('interface: card no topo da agenda, atualizado pela revisão e recolhível sem gravar no navegador',()=>{
 const js=read('public/legacy-app.js'),html=read('app/dashboard/legacy-body.ts');
 assert.match(html,/<section id="agendaView" class="view active">\r?\n <section id="dailySummary" class="daily-summary hidden"/);
 assert.match(js,/function renderCalendar\(\)\{\r?\n if\(typeof refreshDailySummary==="function"\)refreshDailySummary\(\);/);
 assert.match(js,/if\(!force&&revision===dailySummaryRevision&&Date\.now\(\)-dailySummaryAt<300000\)return;/);
 assert.match(js,/function dailySummaryCollapsed\(\)\{return dailySummaryHidden\}/);
 assert.match(js,/\$\{esc\(i\.title\)\}/);
});
