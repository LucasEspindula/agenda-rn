// Agenda em PDF: o mesmo modelo e layout no botão de impressão e no e-mail do médico.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {PDFDocument} from 'pdf-lib';
import {loadTs} from './load-ts.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const print=loadTs('lib/agenda/print.ts');
// O PDF roda no mesmo "realm" do pdf-lib (o vm do loadTs quebra as checagens de tipo dele).
async function importPdf(){
 const output=ts.transpileModule(read('lib/reports/agenda-pdf.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const file=join('lib/reports','.agenda-pdf-test-'+Date.now()+'.mjs');writeFileSync(file,output);
 try{return await import(pathToFileURL(file).href)}finally{rmSync(file,{force:true})}
}
const appt=(id,doctorId,date,time,extra={})=>({id,doctorId,patientId:'p1',date,time,duration:60,status:'confirmed',procedure:'Consulta',hospitalId:'h1',insurance:'Unimed',...extra});
const state=()=>({
 professionals:[{id:'d1',name:'Dr. Um',crm:'123',specialty:'Ortopedia'},{id:'d3',name:'Dra. Anestesia',specialty:'Anestesiologia'}],
 patients:[{id:'p1',name:'Ana Souza',cpf:'00000000000',phone:'51999999999'},{id:'p2',name:'Ŝtefan Ölander'}],
 hospitals:[{id:'h1',name:'Hospital Central'}],
 appointments:[
  appt('a1','d1','2026-11-12','07:00',{duration:120,anesthetistId:'d3',careType:'inpatient',opme:true,notes:'nota interna',payment:{amount:900}}),
  appt('a2','d1','2026-11-12','10:00',{status:'scheduled',patientId:'p2'}),
  appt('a3','d1','2026-11-13','08:00',{status:'cancelled'}),
  appt('a4','d1','2026-11-20','08:00'),
 ],
 scheduleBlocks:[{id:'b1',professionalId:'d1',date:'2026-11-12',start:'09:00',end:'10:00',reason:'Reunião'}],
});
const build=(mode,date,ids=['d1'])=>plain(print.buildAgendaPrint({state:state(),professionalIds:ids,mode,date,organization:'Clínica X',generatedBy:'Sec',now:new Date('2026-11-11T23:00:00Z')}));

test('períodos: semana de domingo a sábado como na tela, mês inteiro e rótulos em português',()=>{
 assert.deepEqual(plain(print.agendaPeriod('week','2026-11-12')),{start:'2026-11-08',end:'2026-11-14'});
 assert.deepEqual(plain(print.agendaPeriod('month','2026-02-10')),{start:'2026-02-01',end:'2026-02-28'});
 assert.equal(print.periodLabel('day','2026-11-12','2026-11-12'),'Quinta-feira, 12 de novembro de 2026');
 assert.equal(print.periodLabel('week','2026-11-29','2026-12-05'),'29 de novembro a 5 de dezembro de 2026');
 assert.equal(print.periodLabel('month','2026-11-01','2026-11-30'),'Novembro de 2026');
});

test('modelo: horário de término, equipe, bloqueio intercalado e cancelado fora',()=>{
 const m=build('day','2026-11-12');
 assert.equal(m.title,'Agenda do dia');assert.equal(m.agendas[0].appointments,2);assert.equal(m.agendas[0].blocks,1);
 const day=m.agendas[0].days[0];
 assert.deepEqual(day.entries.map(e=>e.kind+':'+e.start),['appointment:07:00','block:09:00','appointment:10:00']);
 const first=day.entries[0];
 assert.equal(first.end,'09:00');assert.equal(first.partner,'Anestesista: Dra. Anestesia');
 assert.equal(first.careType,'Internado');assert.deepEqual(first.flags,['OPME']);assert.equal(first.statusLabel,'Confirmado');
 // Sem CPF, telefone, observações nem valores.
 assert.doesNotMatch(JSON.stringify(m),/00000000000|51999999999|nota interna|900/);
});

test('semana mostra os 7 dias (livres inclusive); mês só os dias com agenda; anestesista vê pela anestesia',()=>{
 const week=build('week','2026-11-12');
 assert.equal(week.agendas[0].days.length,7);assert.equal(week.agendas[0].days[0].label,'Domingo, 08/11');
 assert.equal(build('month','2026-11-12').agendas[0].days.map(d=>d.date).join(),'2026-11-12,2026-11-20');
 const both=build('day','2026-11-12',['d1','d3']);
 assert.deepEqual(both.agendas.map(a=>[a.professional.role,a.appointments]),[['Cirurgião',2],['Anestesista',1]]);
 assert.equal(both.agendas[1].days[0].entries[0].partner,'Cirurgião: Dr. Um');
});

test('PDF A4 retrato, uma agenda por página, numeração e texto fora do WinAnsi sem quebrar',async()=>{
 const {renderAgendaPdf,pdfSafe}=await importPdf();
 assert.equal(pdfSafe('Ŝtefan Ölander 😀'),'Stefan Ölander ?');
 const doc=await PDFDocument.load(await renderAgendaPdf(build('week','2026-11-12',['d1','d3'])));
 const size=doc.getPage(0).getSize();
 assert.ok(Math.abs(size.width-595.28)<.1&&Math.abs(size.height-841.89)<.1);
 assert.equal(doc.getPageCount(),2);
 const empty=await PDFDocument.load(await renderAgendaPdf(build('month','2026-01-10')));
 assert.equal(empty.getPageCount(),1);
});

test('rota: permissão por agenda, visibilidade por papel, sem faturamento',()=>{
 const route=read('app/api/reports/agenda/route.ts');
 assert.match(route,/if \(!isManager\(session\.account\.role\) && ids\.some\(\(id\) => !session\.agendaIds\.includes\(id\)\)\)/);
 assert.match(route,/const visible = visibleState\(state, session\);/);
 assert.match(route,/loadAgendaWindow\(session\.account\.id, start, session\.organization\.id\)/);
 assert.match(route,/ids\.length > MAX_AGENDAS/);
 assert.doesNotMatch(route,/billing|individualReceived|brl\(/);
 assert.match(route,/"Cache-Control": "private, no-store"/);
});

test('tela: o diálogo pode juntar todas as agendas da pessoa no mesmo PDF',()=>{
 const js=read('public/legacy-app.js');
 assert.match(js,/window\.open\("\/api\/reports\/agenda\?"/);
 assert.match(js,/<option value="all">Todas as minhas agendas \(\$\{agendas\.length\}\)<\/option>/);
 assert.match(js,/for\(const id of \$\("agendaPrintScope"\)\?\.value==="all"\?agendas:\[owner\.id\]\)params\.append\("professional_id",id\);/);
});
