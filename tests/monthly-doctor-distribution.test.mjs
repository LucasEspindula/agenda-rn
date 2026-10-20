import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync("app/api/reports/monthly-closing/print/route.ts","utf8");
const sql=readFileSync("supabase/migrations/20261020203000_monthly_doctor_patient_references.sql","utf8");
test("impressão mensal usa três partes e elimina relatórios repetidos",()=>{
 assert.match(src,/attendancePage\+combinedFinancePage\+receiptChartPage/);
 assert.match(src,/const doctorTables=/);
 assert.match(src,/NF líquida total/);
 assert.match(src,/Valor deste médico/);
 assert.doesNotMatch(src,/const (?:validInvoicePage|insurancePage|fiscalEventsPage)=/);
 assert.doesNotMatch(src,/const paymentItems=/);
});
test("NF compartilhada conserva total e atribui somente parcela conhecida",()=>{
 assert.match(src,/inv\.net_amount/);
 assert.match(src,/l\.attributed_amount/);
 assert.match(src,/l\.professional_id\+"::"\+l\.invoice_id/);
 assert.match(src,/g\.insurerCents\+=itemCents/);
 assert.match(src,/g\.directCents\+=received/);
 assert.match(src,/seenLinks\.has\(key\)/);
 assert.match(src,/matchedPayments\.add\(payment\.id\)/);
 assert.match(src,/g\.directCents\+g\.insurerCents/);
});
test("referências de paciente são guardadas no snapshot futuro",()=>{
 assert.match(sql,/patient_names/);
 assert.match(sql,/billing_record_ids/);
 assert.match(sql,/coalesce\(b\.professional_id,a\.doctor_id\) professional_id/);
 assert.match(src,/Sem paciente discriminado no snapshot/);
});
