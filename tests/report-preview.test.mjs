import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');
const between=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));

test('reports use the shared internal preview instead of replacing their source screens',()=>{
 const preview=read('components/report-preview.tsx'),report=read('app/billing/billing-report.tsx'),client=read('app/billing/billing-client.tsx'),doctor=read('app/billing/doctor-billing.tsx'),pending=read('app/billing/insurance-pending.tsx');
 assert.match(preview,/title:string;orientation\?:"portrait"\|"landscape";onClose/);
 assert.match(preview,/Imprimir \/ Salvar PDF/);
 assert.match(preview,/report-preview-toolbar no-print/);
 assert.match(preview,/window\.print\(\)/);
 assert.match(preview,/@page \{ size: A4 \$\{orientation\}/);
 assert.match(report,/import ReportPreview from '@\/components\/report-preview'/);
 assert.match(report,/<ReportPreview title=\{titles\[scope\.kind\]\} orientation="landscape"/);
 assert.doesNotMatch(client,/if\(report\)return <BillingReport/);
 assert.match(client,/<\/main>\{report&&<BillingReport/);
 assert.doesNotMatch(doctor,/if\(report\)return <BillingReport/);
 assert.match(doctor,/<\/main>\{report&&<BillingReport/);
 assert.match(pending,/import ReportPreview from '@\/components\/report-preview'/);
 assert.match(pending,/<ReportPreview title="Pendências de Convênio" orientation="landscape"/);
});

test('preview print styles keep only documents and paginate tables naturally',()=>{
 const css=read('app/billing/billing.css');
 assert.match(css,/body:has\(\.report-preview\) \.rn-hub>\*:not\(\.report-preview\)/);
 assert.match(css,/\.report-preview-toolbar\{display:none!important\}/);
 assert.match(css,/\.billing-report-document thead\{display:table-header-group\}/);
 assert.match(css,/\.billing-report-document tr\{break-inside:avoid;page-break-inside:avoid\}/);
 assert.match(css,/\.billing-report-document h2,\.billing-report-document h3\{break-after:avoid\}/);
});

test('Agenda opens an internal preview and waits for an explicit print action',()=>{
 const source=read('public/legacy-app.js'),fn=between(source,'function openAgendaPrint(){','function mountAgendaOwnerSelector');
 assert.match(fn,/agendaReportPreview/);
 assert.match(fn,/Visualização da agenda/);
 assert.match(fn,/Imprimir \/ Salvar PDF/);
 assert.match(fn,/\$\("agendaReportPrint"\)\.onclick=\(\)=>window\.print\(\)/);
 assert.doesNotMatch(fn,/window\.open\(/);
 assert.doesNotMatch(fn,/document\.write\(/);
 assert.doesNotMatch(fn,/\.onload=.*print/);
 const css=read('public/legacy.css');
 assert.match(css,/\.agenda-report-document thead\{display:table-header-group\}/);
 assert.match(css,/\.agenda-report-document tr\{break-inside:avoid;page-break-inside:avoid\}/);
});

