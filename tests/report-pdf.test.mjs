import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=(path)=>readFileSync(path,'utf8');

test('native PDF routes keep server-side authorization and binary delivery',()=>{
 const billing=read('app/api/reports/billing/route.ts'),agenda=read('app/api/reports/agenda/route.ts'),pdf=read('lib/reports/pdf.ts');
 assert.match(billing,/individualReceived\(row\)/);assert.match(billing,/report\.groups/);assert.match(billing,/report\.cash/);assert.match(billing,/unknownInvoices/);assert.match(billing,/Em aberto/);assert.match(billing,/Substituída por NF/);
 assert.match(agenda,/item\.status!=='cancelled'/);assert.match(agenda,/item\.anesthetistId===professionalId/);assert.match(agenda,/item\.doctorId===professionalId/);assert.match(agenda,/Horários bloqueados/);assert.match(agenda,/CRM/);
 assert.match(pdf,/PDFDocument\.create/);assert.match(pdf,/'Content-Type':'application\/pdf'/);assert.match(pdf,/'Content-Disposition':'inline; filename/);assert.doesNotMatch(pdf,/@ts-nocheck/);
 assert.doesNotMatch(billing,/@ts-nocheck/);assert.doesNotMatch(agenda,/@ts-nocheck/);
});
test('PDF actions require an explicit user action and no custom preview remains',()=>{
 const billing=read('app/billing/billing-client.tsx'),doctor=read('app/billing/doctor-billing.tsx'),pending=read('app/billing/insurance-pending.tsx'),legacy=read('public/legacy-app.js');
 assert.match(billing,/window\.open\('\/api\/reports\/billing\?'/);assert.doesNotMatch(billing,/useEffect\([\s\S]*?openBillingReport\(scope\)/);
 assert.match(doctor,/window\.open\('\/api\/reports\/billing\?'/);assert.match(pending,/reportUrl\(\{entity:company\.id,insurance:payer\.name\}\)/);assert.match(legacy,/window\.open\("\/api\/reports\/agenda\?"/);
 assert.equal(existsSync('components/report-preview.tsx'),false);
});
