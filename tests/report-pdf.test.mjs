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

test('agenda day headers and generator metadata render into a valid multipage PDF',async()=>{
 const {PdfReport,brDateTime}=await importTypeScript('lib/reports/pdf.ts');
 const {agendaDateLabel}=await importTypeScript('lib/agenda-report.ts');
 const pdf=await new PdfReport().init();
 pdf.header('Agenda','Dr. Exemplo · CRM: 12345',['Período: 28/10/2026 a 29/10/2026'],[
  'Gerado em: '+brDateTime('2026-10-28T13:45:00.000Z'),
  'Gerado por: Secretaria Exemplo'
 ],'Agenda da semana');
 pdf.section('Programação',undefined,{reserve:48});
 for(const date of ['2026-10-28','2026-10-29']){
  pdf.dayHeading(agendaDateLabel(date));
  pdf.gridTable([{label:'Horário',width:80},{label:'Paciente',width:250},{label:'Procedimento',width:250}],
   Array.from({length:35},(_,i)=>['08:00','Paciente '+String(i+1),'Procedimento agendado']));
  pdf.section('Horários bloqueados',undefined,{reserve:40});
  pdf.gridTable([{label:'Horário',width:130},{label:'Motivo',width:534}],[['10:00 - 11:00','Bloqueio profissional']]);
 }
 const bytes=await pdf.bytes();
 const document=await PDFDocument.load(bytes);
 assert.ok(document.getPageCount()>1);
 assert.equal(Buffer.from(bytes).subarray(0,5).toString('ascii'),'%PDF-');
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
 assert.match(agenda,/import \{isAnesthesiologist\} from '@\/lib\/medical-specialties'/);assert.match(agenda,/appointmentInsurance\(item,patients\.get\(item\.patientId\)\)/);assert.match(agenda,/appointmentStatusLabel\(item\.status\)/);assert.doesNotMatch(agenda,/\/anestesi\/i/);
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
