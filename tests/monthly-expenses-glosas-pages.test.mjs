import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync("app/api/reports/monthly-closing/print/route.ts","utf8");

test("despesas e glosas começam em nova folha após divisão financeira",()=>{
 assert.match(source,/const combinedFinancePage=page/);
 assert.match(source,/const expensesPage=page\(heading\("Despesas, Glosas e Pendências"/);
 assert.match(source,/attendancePage\+combinedFinancePage\+expensesPage\+receiptChartPage/);
 assert.match(source,/\.page-break\{break-before:page/);
 const combined=source.slice(source.indexOf("const combinedFinancePage="),source.indexOf("const glosaSummary="));
 assert.doesNotMatch(combined,/expenseRows|denialRows|glosaSummary/);
 const expenses=source.slice(source.indexOf("const expensesPage="),source.indexOf("const nonce="));
 assert.match(expenses,/expenseCards/);
 assert.match(expenses,/expenseRows/);
 assert.match(expenses,/glosaSummary/);
 assert.match(expenses,/denialRows/);
 assert.match(expenses,/<\/span><\/div>',true\);/);
});
test("não imprime observações e evita título de glosas isolado",()=>{
 assert.doesNotMatch(source,/Pontos a conferir|financeWarnings|financeWarningsHtml/);
 assert.doesNotMatch(source,/NF líquida = valor total do documento/);
 assert.match(source,/\.glosa-summary\{break-inside:avoid-page;page-break-inside:avoid\}/);
 assert.match(source,/\.section-head\{[^}]*break-after:avoid-page/);
});
test("permanece fiel aos dados e à marca d'água",()=>{
 assert.match(source,/expenseItems\.map\(e=>row\(/);
 assert.match(source,/denialItems\.map\(g=>row\(/);
 assert.match(source,/cashResult=receiptTotal===null\|\|expensePaid===null\?null:/);
 assert.match(source,/view==="closed"\?"REGISTRO MENSAL":"PRÉVIA"/);
});
