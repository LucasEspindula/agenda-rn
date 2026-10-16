import {test} from "node:test";
import assert from "node:assert/strict";
import {monthlyCash,canCloseMonthlySnapshot} from "../lib/monthly-closing-math.js";
test("uma NF compartilhada é somada uma vez, sem duplicar itens dos profissionais",()=>{
 const total=monthlyCash({direct_received:100.01,insurance_invoice_received:499.99},
   {paid_total:120.25});
 assert.deepEqual(total,{direct:100.01,invoice:499.99,revenue:600,
  expenses:120.25,result:479.75});
});
test("NF particular não entra outra vez na receita de convênio",()=>{
 const total=monthlyCash({direct_received:200,insurance_invoice_received:0},{paid_total:0});
 assert.equal(total.revenue,200);
});
test("sem valor líquido de NF não se pode encerrar competência",()=>{
 assert.equal(canCloseMonthlySnapshot({
  issued_invoices:{without_net_amount:1},cash:{insurance_paid_invoices_without_net:0}
 }),false);
 assert.equal(canCloseMonthlySnapshot({
  issued_invoices:{without_net_amount:0},cash:{insurance_paid_invoices_without_net:1}
 }),false);
 assert.equal(canCloseMonthlySnapshot({
  issued_invoices:{without_net_amount:0},cash:{insurance_paid_invoices_without_net:0}
 }),true);
});
