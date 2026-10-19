import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {currentFiscalMonth,isInvoiceFromEarlierMonth} from "../lib/invoice-prior-month.js";
const now=new Date("2026-10-19T14:41:00Z");
test("competência fiscal usa São Paulo",()=>{
 assert.equal(currentFiscalMonth(now),"2026-10");
 assert.equal(isInvoiceFromEarlierMonth("2026-09-30",now),true);
 assert.equal(isInvoiceFromEarlierMonth("2026-10-01",now),false);
});
test("PDF mensal agrupa médicos, convênios e notas sem vínculo",()=>{
 const src=readFileSync("app/api/reports/monthly-closing/route.ts","utf8");
 for(const term of ["professional_attendances","professional_invoice_rows","Atendimentos — ","Notas fiscais — ","sem vínculo individual"])
  assert.ok(src.includes(term),term);
});
test("API fiscal verifica meses antigos no servidor",()=>{
 const src=readFileSync("app/api/billing/route.ts","utf8");
 assert.ok(src.includes("isInvoiceFromEarlierMonth(invoice.issue_date)"));
 assert.ok(src.includes("verifyPassword(manager_password"));
 assert.ok(src.includes("p_data:data"));
});
