// Hub (/hub): o resumo de todas as agendas da pessoa, que saiu do topo da agenda.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const {buildHub}=loadTs('lib/agenda/hub.ts');
// 11/11/2026 10:30 em São Paulo.
const now=new Date('2026-11-11T13:30:00Z');
const appt=(id,doctorId,date,time,extra={})=>({id,doctorId,patientId:'p1',date,time,duration:60,status:'confirmed',procedure:'Consulta',insurance:'Particular',...extra});
const state=()=>({
 professionals:[{id:'d2',name:'Dra. Zélia',specialty:'Ortopedia'},{id:'d1',name:'Dr. Abel',specialty:'Cirurgia geral'},{id:'d3',name:'Dr. Anest',specialty:'Anestesiologia'}],
 patients:[{id:'p1',name:'Ana Souza',cpf:'00000000000',phone:'51999999999'}],
 appointments:[
  appt('a1','d1','2026-11-11','08:00',{anesthetistId:'d3',notes:'nota interna'}),
  appt('a2','d1','2026-11-11','10:00',{duration:90}),
  appt('a3','d1','2026-11-11','10:30',{status:'scheduled'}),
  appt('a4','d1','2026-11-12','07:00'),
  appt('a5','d2','2026-11-11','09:00',{status:'cancelled'}),
  appt('a6','d2','2026-11-20','09:00'),
 ],
 scheduleBlocks:[],
});

test('cada agenda: contagens, próximo atendimento (inclui o em andamento) e lista de hoje sem dados sensíveis',()=>{
 const hub=plain(buildHub({state:state(),role:'general_manager',agendaIds:[],now}));
 assert.equal(hub.date,'2026-11-11');assert.equal(hub.time,'10:30');
 assert.deepEqual(hub.agendas.map(a=>a.name),['Dr. Abel','Dr. Anest','Dra. Zélia']);
 const abel=hub.agendas[0];
 assert.deepEqual([abel.today,abel.tomorrow,abel.week],[3,1,4]);
 assert.equal(abel.next.id,'a2');assert.equal(abel.next.end,'11:30');
 assert.equal(abel.todayList[0].partner,'Anestesista: Dr. Anest');
 assert.equal(hub.agendas[1].role,'Anestesista');assert.equal(hub.agendas[1].todayList[0].partner,'Cirurgião: Dr. Abel');
 assert.equal(hub.agendas[2].today,0);assert.equal(hub.agendas[2].next.id,'a6');
 // a3 aguarda confirmação e sobrepõe a2 (10:00–11:30): pendências da agenda e do total.
 assert.deepEqual(abel.pending.map(p=>[p.kind,p.count]),[['unconfirmed',1],['conflict',1]]);
 assert.equal(hub.totals.pending,2);assert.equal(hub.totals.agendas,3);
 assert.doesNotMatch(JSON.stringify(hub),/00000000000|51999999999|nota interna/);
});

test('secretária vê só as agendas liberadas; médico vê as dele sem pendências',()=>{
 const sec=plain(buildHub({state:state(),role:'secretary',agendaIds:['d2','dX'],now}));
 assert.deepEqual(sec.agendas.map(a=>a.id),['d2']);assert.equal(sec.totals.pending,0);
 const doc=plain(buildHub({state:state(),role:'doctor',agendaIds:[],doctorId:'d1',now}));
 assert.deepEqual(doc.agendas.map(a=>a.id),['d1']);assert.equal(doc.doctor,true);
 assert.deepEqual(doc.reminders,[]);assert.deepEqual(doc.agendas[0].pending,[]);assert.equal(doc.totals.pending,0);
});

test('página: sessão, papel, agenda filtrada e pendências só de quem decide',()=>{
 const page=read('app/hub/page.tsx');
 assert.match(page,/if \(!canUseAgenda\(session\)\) redirect\(doctorHome\(session\)\);/);
 assert.match(page,/state: visibleState\(state, session\)/);
 assert.match(page,/requests: await loadPendingRequests\(session\)/);
 assert.match(page,/active="hub"/);
 assert.doesNotMatch(page,/billing|cpf|phone/i);
 const pending=read('lib/agenda/pending-requests.ts');
 assert.match(pending,/if \(role === "doctor"\) return \[\];/);
 assert.match(pending,/if \(!isManager\(role\)\) requests = requests\.in\("professional_id", session\.agendaIds\);/);
});

test('menu: "Hub" no topo e o nome RN Integra levam ao /hub',()=>{
 const {moduleLinks}=loadTs('lib/navigation.ts',{'./billing-paused':{BILLING_PAUSED:true}});
 const links=moduleLinks({account:{role:'secretary',doctorId:null},services:{}});
 assert.deepEqual(plain(links.slice(0,2).map(l=>[l.id,l.href,l.label])),[['hub','/hub','Hub'],['agenda','/dashboard?agenda=1','Agendamento']]);
 assert.equal(moduleLinks({account:{role:'doctor',doctorId:'d1'},services:{}}).some(l=>l.id==='hub'),false);
 const header=read('components/site-header.tsx');
 assert.match(header,/className="hub-brand" href=\{canUseAgenda\(session\)\?'\/hub':doctorHome\(session\)\}/);
 assert.match(header,/hub:LayoutDashboard/);
 assert.match(read('components/mobile-navigation.tsx'),/hub: LayoutDashboard/);
});

test('agenda: o card de resumo saiu e os links do Hub abrem agenda, dia e agendamento',()=>{
 const js=read('public/legacy-app.js'),body=read('app/dashboard/legacy-body.ts'),css=read('public/legacy.css');
 assert.doesNotMatch(js+body+css,/dailySummary|daily-summary|refreshDailySummary/);
 assert.match(js,/function openFromHubLink\(\)/);
 assert.match(js,/\[\.\.\.filter\.options\]\.some\(o=>o\.value===prof\)/);
 assert.match(js,/if\(appt\)\{if\(state\.appointments\.some\(a=>a\.id===appt\)\)openAppointment\(appt\)/);
 assert.match(js,/history\.replaceState\(null,"",location\.pathname\+"\?agenda=1"\)/);
});
