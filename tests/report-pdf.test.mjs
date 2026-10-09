import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');

test('native PDF report routes return browser-viewable PDFs',()=>{
 const billing=read('app/api/reports/billing/route.ts'),agenda=read('app/api/reports/agenda/route.ts'),pdf=read('lib/reports/pdf.ts');
 assert.match(billing,/getSession/);
 assert.match(billing,/loadBillingData/);
 assert.match(billing,/doctorBillingProjection/);
 assert.match(billing,/buildReport/);
 assert.match(agenda,/getSession/);
 assert.match(agenda,/session\.agendaIds/);
 assert.match(pdf,/PDFDocument\.create/);
 assert.match(pdf,/'Content-Type':'application\/pdf'/);
 assert.match(pdf,/'Content-Disposition':'inline; filename/);
 assert.match(pdf,/'Cache-Control':'private, no-store'/);
 assert.match(pdf,/StandardFonts\.Helvetica/);
});

test('report actions open native PDF URLs instead of an internal preview',()=>{
 const billing=read('app/billing/billing-client.tsx'),doctor=read('app/billing/doctor-billing.tsx'),pending=read('app/billing/insurance-pending.tsx'),agenda=read('public/legacy-app.js');
 assert.match(billing,/window\.open\('\/api\/reports\/billing\?'/);
 assert.match(doctor,/window\.open\('\/api\/reports\/billing\?'/);
 assert.match(pending,/reportUrl\(\{entity:company\.id,insurance:payer\.name\}\)/);
 assert.match(agenda,/window\.open\("\/api\/reports\/agenda\?"/);
 assert.doesNotMatch(agenda,/agendaReportPreview/);
 assert.doesNotMatch(agenda,/document\.write\(/);
 assert.doesNotMatch(billing,/ReportPreview/);
 assert.doesNotMatch(doctor,/BillingReport/);
 assert.doesNotMatch(pending,/ReportPreview/);
 assert.equal(existsSync('components/report-preview.tsx'),false);
});
