import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {PDFDocument} from 'pdf-lib';

const read=(path)=>readFileSync(path,'utf8');
async function importTypeScript(path){
 const output=ts.transpileModule(read(path),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const directory='lib/reports',file=join(directory,'.pdf-test-runtime-'+Date.now()+'.mjs');
 writeFileSync(file,output);
 try{return await import(pathToFileURL(file).href+'?'+Date.now())}finally{rmSync(file,{force:true})}
}

test('PdfReport generates a valid multipage A4 landscape PDF',async()=>{
 const {PdfReport,pdfColumnsWidth}=await importTypeScript('lib/reports/pdf.ts');
 const report=await new PdfReport().init(),columns=[{label:'Paciente',width:180},{label:'Procedimento',width:180},{label:'Observação',width:180}];
 assert.ok(pdfColumnsWidth(columns)<=report.contentWidth);
 report.table(columns,Array.from({length:130},(_,index)=>['Paciente '+index,'Procedimento de acompanhamento','Texto suficiente para medir a paginação do documento.']));
 const bytes=await report.bytes();
 assert.equal(Buffer.from(bytes).subarray(0,5).toString('ascii'),'%PDF-');
 const document=await PDFDocument.load(bytes),size=document.getPage(0).getSize();
 assert.ok(document.getPageCount()>1);
 assert.ok(Math.abs(size.width-841.89)<.1);
 assert.ok(Math.abs(size.height-595.28)<.1);
 assert.throws(()=>report.table([{label:'Excede',width:report.contentWidth+1}],[]),/área útil/);
});

test('agenda PDF draws one chronological grid per day with inline highlighted blocks',async()=>{
 const {PdfReport,brDateTime}=await importTypeScript('lib/reports/pdf.ts');
 const {agendaDateLabel,agendaTimeline}=await importTypeScript('lib/agenda-report.ts');
 const pdf=await new PdfReport().init();
 pdf.header('Agenda','Dr. Exemplo · CRM: 12345',['Período: 26/10/2026 a 27/10/2026'],[
  'Gerado em: '+brDateTime('2026-10-28T13:45:00.000Z'),
  'Gerado por: Secretaria Exemplo'
 ],'Agenda da semana');
 pdf.section('Programação',undefined,{reserve:48});
 const appointments=Array.from({length:37},(_,index)=>({
  date:'2026-10-27',time:index===0?'08:00':index===1?'09:00':'11:00',
  patient:index===0?'Lucas':index===1?'Vitória':'Paciente '+String(index+1)
 }));
 const blocks=[
  {date:'2026-10-26',start:'08:00',end:'09:00',reason:'Sem atendimento'},
  {date:'2026-10-27',start:'08:30',end:'09:00',reason:'Reunião médica'}
 ];
 const timeline=agendaTimeline(appointments,blocks);
 assert.deepEqual(timeline.slice(0,4).map(item=>[item.date,item.start,item.kind]),[
  ['2026-10-26','08:00','block'],['2026-10-27','08:00','appointment'],
  ['2026-10-27','08:30','block'],['2026-10-27','09:00','appointment']
 ]);
 const byDay=new Map();
 for(const entry of timeline){if(!byDay.has(entry.date))byDay.set(entry.date,[]);byDay.get(entry.date).push(entry)}
 for(const [date,items] of byDay){
  pdf.dayHeading(agendaDateLabel(date));
  pdf.gridTable([
   {label:'Horário',width:69},{label:'Paciente',width:144},
   {label:'Anestesista',width:108},{label:'Procedimento / Motivo',width:153},
   {label:'Convênio',width:96},{label:'Hospital',width:117},{label:'Status',width:71}
  ],items.map(item=>item.kind==='block'
    ?[item.block.start+' - '+item.block.end,'HORÁRIO BLOQUEADO','—','Motivo: '+item.block.reason,'—','—','Bloqueado']
    :[item.appointment.time,item.appointment.patient,'—','Consulta','Particular','Hospital','Agendado']),
   items.map(item=>item.kind==='block'?'blocked':null));
 }
 const bytes=await pdf.bytes();
 const document=await PDFDocument.load(bytes);
 assert.ok(document.getPageCount()>1);
 assert.equal(Buffer.from(bytes).subarray(0,5).toString('ascii'),'%PDF-');
});

test('agendaTimeline preserves chronological order including block-only days and tied times',async()=>{
 const {agendaTimeline}=await importTypeScript('lib/agenda-report.ts');
 const appointments=[
  {date:'2026-10-27',time:'09:00',patient:'Vitória'},
  {date:'2026-10-27',time:'08:00',patient:'Lucas'},
  {date:'2026-10-27',time:'08:30',patient:'Conflito de teste'}
 ];
 const blocks=[
  {date:'2026-10-27',start:'08:30',end:'09:00',reason:'Bloqueio'},
  {date:'2026-10-26',start:'14:00',end:'15:00',reason:'Sem agenda'}
 ];
 const result=agendaTimeline(appointments,blocks);
 assert.deepEqual(result.map(x=>[x.date,x.start,x.kind]),[
  ['2026-10-26','14:00','block'],
  ['2026-10-27','08:00','appointment'],
  ['2026-10-27','08:30','block'],
  ['2026-10-27','08:30','appointment'],
  ['2026-10-27','09:00','appointment']
 ]);
 assert.equal(result[2].kind,'block');
 assert.equal(result[3].kind,'appointment');
});

test('agenda report preserves historical insurance and human status labels',async()=>{
 const {agendaDateLabel,appointmentInsurance,appointmentStatusLabel}=await importTypeScript('lib/agenda-report.ts');
 assert.equal(appointmentInsurance({insurance:''},{insurance:'UNIMED'}),'');
 assert.equal(appointmentInsurance({},{insurance:'UNIMED'}),'UNIMED');
 assert.equal(appointmentStatusLabel('scheduled'),'Agendado');
 assert.equal(appointmentStatusLabel('realized'),'Realizado');
 assert.equal(agendaDateLabel('2026-10-26'),'Segunda-feira 26/10/2026');
 assert.equal(agendaDateLabel('2026-10-28'),'Quarta-feira 28/10/2026');
 assert.equal(agendaDateLabel('2026-10-10'),'Sábado 10/10/2026');
});

test('native PDF routes keep server-side authorization and report guarantees',()=>{
 const billing=read('app/api/reports/billing/route.ts'),agenda=read('app/api/reports/agenda/route.ts'),pdf=read('lib/reports/pdf.ts');
 assert.match(billing,/individualReceived\(row\)/);assert.match(billing,/report\.groups/);assert.match(billing,/report\.cash/);assert.match(billing,/pendingColumns/);assert.match(billing,/ensureSpace/);
 assert.match(agenda,/renderAgendaPdf\(model\)/);assert.match(agenda,/visibleState\(state, session\)/);assert.doesNotMatch(agenda,/\/anestesi\/i/);
 assert.match(pdf,/ensureSpace\(height:number\)/);assert.match(pdf,/options:PdfSectionOptions/);assert.match(pdf,/pdfColumnsWidth\(columns\)/);assert.match(pdf,/RangeError/);assert.match(pdf,/'Content-Type':'application\/pdf'/);assert.match(pdf,/'Content-Disposition':'inline; filename/);
 assert.doesNotMatch(pdf,/@ts-nocheck/);assert.doesNotMatch(billing,/@ts-nocheck/);assert.doesNotMatch(agenda,/@ts-nocheck/);
});

test('monthly deep link only opens an explicit report menu, never a report window',()=>{
 const billing=read('app/billing/billing-client.tsx');
 const index=billing.indexOf('if (loading || !data.doctors.length || deepLinkHandled.current) return;');
 assert.ok(index>=0,'the monthly link is processed after loading the doctors');
 const deepLink=billing.slice(index,index+260);
 assert.match(deepLink,/q\.get\("view"\) === "monthly"\) setPrintMenu\(true\)/);
 assert.doesNotMatch(deepLink,/window\.open|openBillingReport/);
 assert.match(billing,/function generateReport\(kind: ReportScope\["kind"\]\)/);
 assert.match(billing,/window\.open\(\s*"\/api\/reports\/billing\?"/);
 const doctor=read('app/billing/doctor-billing.tsx'),pending=read('app/billing/insurance-pending.tsx'),legacy=read('public/legacy-app.js');
 assert.match(doctor,/window\.open\(\s*["']\/api\/reports\/billing\?/);
 assert.match(pending,/reportUrl\(\{entity:company\.id,insurance:payer\.name\}\)/);
 assert.match(legacy,/window\.open\("\/api\/reports\/agenda\?"/);
 assert.equal(existsSync('components/report-preview.tsx'),false);
});
