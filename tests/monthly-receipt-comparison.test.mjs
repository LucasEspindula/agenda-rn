import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {monthlyReceiptComparison} from "../lib/monthly-receipt-comparison.js";

test("compara Particular com uma barra para cada convênio, somente pagamentos confirmados",()=>{
 const result=monthlyReceiptComparison([
  {billing_method:"PARTICULAR",payment_status:"PAGO",received_amount:100},
  {billing_method:"PARTICULAR",payment_status:"PENDENTE",received_amount:90},
  {billing_method:"CONVENIO",insurance_name:"Unimed",payment_status:"PAGO",invoice_item_received:120},
  {billing_method:"CONVENIO",insurance_name:"unimed",payment_status:"PAGO",invoice_item_received:30},
  {billing_method:"CONVENIO",insurance_name:"IPE",payment_status:"PAGO",invoice_item_received:80},
  {billing_method:"CONVENIO",insurance_name:"IPE",payment_status:"PENDENTE",invoice_item_received:500},
  {billing_method:"CONVENIO",payer_name:"Convênio legado",payment_status:"PAGO",received_amount:20},
 ]);
 assert.deepEqual(result.groups.map(g=>[g.label,g.receivedCents]),[
  ["Particular",10000],["Unimed",15000],["IPE",8000],["Convênio legado",2000]
 ]);
 assert.equal(result.totalCents,35000);
});
test("não duplica total de NF nem soma item de particular à cobrança direta",()=>{
 const result=monthlyReceiptComparison([
  {billing_method:"PARTICULAR",payment_status:"PAGO",received_amount:100,invoice_item_received:999},
  {billing_method:"CONVENIO",insurance_name:"A",payment_status:"PAGO",invoice_item_received:60,received_amount:500},
  {billing_method:"CONVENIO",insurance_name:"A",payment_status:"PAGO",received_amount:40},
 ]);
 assert.equal(result.totalCents,20000);
});
test("valores faltantes não são inventados, mas o convênio permanece na comparação",()=>{
 const result=monthlyReceiptComparison([
  {billing_method:"CONVENIO",insurance_name:"Sem repasse",payment_status:"PENDENTE",received_amount:900},
  {billing_method:"CONVENIO",insurance_name:"Sem valor",payment_status:"PAGO",invoice_item_received:null,received_amount:null},
  {billing_method:"PARTICULAR",payment_status:"PAGO",received_amount:"0.1"},
  {billing_method:"PARTICULAR",payment_status:"PAGO",received_amount:"0.2"},
  {billing_method:"PARTICULAR",payment_status:"PAGO",received_amount:""},
  {billing_method:"CONVENIO",insurance_name:"Inválido",payment_status:"PAGO",invoice_item_received:-100},
 ]);
 assert.equal(result.totalCents,30);
 assert.equal(result.missingPaidAmounts,3);
 assert.equal(result.groups.length,4);
 assert.equal(result.groups.find(g=>g.label==="Sem repasse")?.receivedCents,0);
});
test("impressão mensal usa colunas verticais em página própria depois dos convênios",()=>{
 const source=readFileSync("app/api/reports/monthly-closing/print/route.ts","utf8");
 assert.match(source,/monthlyReceiptComparison\(\[\.\.\.details,\.\.\.extraPaid\]\)/);
 assert.match(source,/receiptChartSvg\(comparison\.groups\)/);
 assert.match(source,/viewBox="0 0 /);
 assert.match(source,/receipt-plot/);
 assert.match(source,/Valor recebido \(R\$\)/);
 assert.match(source,/esc\(amount\(item\.receivedCents\/100\)\)/);
 assert.match(source,/esc\(line\)/);
 assert.doesNotMatch(source,/receiptRows|class="receipt-track"|\.receipt-row\{/);
 const insurance=source.slice(source.indexOf("const insurancePage=page("),
  source.indexOf("const receiptChartPage=page("));
 const chart=source.slice(source.indexOf("const receiptChartPage=page("),
  source.indexOf("// A relação clínica não depende de cobrança"));
 assert.doesNotMatch(insurance,/receiptChart\+/);
 assert.match(chart,/heading\("Recebimentos por origem"/);
 assert.match(chart,/receiptChart\+/);
 assert.match(chart,/<\/span><\/div>',true\);/);
 assert.match(source,/insurancePage\+receiptChartPage\+'<script nonce=/);
 assert.ok(source.indexOf("const insurancePage=page(") < source.indexOf("const receiptChartPage=page("),
  "o gráfico deve ficar depois dos atendimentos por convênio, em nova página");
 assert.match(source,/\.receipt-plot\{[^}]*break-inside:avoid/);
});
