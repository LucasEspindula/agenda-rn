import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {loadTs} from './load-ts.mjs';

const {formatDateBR,formatDateTimeBR}=loadTs('lib/date-format.ts');

test('shared date formatters present valid dates in Brazilian notation without timezone shifts',()=>{
 assert.equal(formatDateBR('2026-10-05'),'05/10/2026');
 assert.equal(formatDateBR('2026-01-09T13:45:00.000Z'),'09/01/2026');
 for(const value of [null,undefined,'','2026-02-30','not-a-date'])assert.equal(formatDateBR(value),'—');
 assert.equal(formatDateTimeBR('2026-10-07T17:31:59.000Z',{timeZone:'UTC'}),'07/10/2026 17:31');
 assert.match(formatDateTimeBR('2026-10-07T17:31:59.000Z'),/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
});

test('human-facing financial dates use the shared formatter while controlled date inputs stay ISO',()=>{
 const doctor=readFileSync('app/billing/doctor-billing.tsx','utf8');
 const company=readFileSync('app/billing/company-finance.tsx','utf8');
 const requests=readFileSync('app/billing/invoice-requests.tsx','utf8');
 const privateInvoice=readFileSync('app/billing/private-invoice.tsx','utf8');
 assert.match(doctor,/formatDateBR\(r\.date\)/);
 assert.match(doctor,/formatDateBR\(i\.issue_date\)/);
 assert.match(doctor,/i\.paid_at\?formatDateBR\(i\.paid_at\):'Pendente'/);
 assert.match(company,/formatDateBR\(e\.competence_date\)/);
 assert.match(company,/formatDateBR\(e\.due_date\)/);
 assert.match(company,/formatDateBR\(e\.paid_at\)/);
 assert.match(requests,/date\(r\.attendance_date_snapshot\)/);
 assert.match(privateInvoice,/formatDateBR\(r\.attendance_date_snapshot\)/);
 assert.match(privateInvoice,/type="date" value=\{request\.paid_at_snapshot\.slice\(0,10\)\}/);
 assert.match(company,/type="date" value=\{start\}/);
 assert.match(company,/e\.competence_date>=start/);
});
