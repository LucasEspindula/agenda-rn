import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path)=>readFileSync(path,"utf8");
const print=read("app/api/reports/monthly-closing/print/route.ts");
const ui=read("app/billing/monthly-closing.tsx");
const sql=read("supabase/migrations/20261016230000_monthly_entity_closing.sql");

test("impressão completa contém todos os blocos financeiros existentes na tela",()=>{
 for(const field of ["cash","expenses","expense_items","direct_payments","denials","denial_items","pending_now"])
  assert.match(print,new RegExp("snap\\."+field+"\\b"));
 for(const heading of ["Resumo de recebimentos","Despesas registradas","Divisão por sócio / médico",
                        "Glosas e pendências","Resultado de caixa","Despesas pagas",
                        "Despesas da competência","NFs pendentes"]){
  assert.ok(print.includes(heading),"Campo ausente na impressão: "+heading);
 }
 assert.match(ui,/<h3>Despesas — competência e pagamento separados<\/h3>/);
 assert.match(ui,/<h3>Glosas e pendências<\/h3>/);
 assert.match(ui,/<h3>Entradas financeiras — data do pagamento<\/h3>/);
});
test("despesas são listadas individualmente, sem trocar competência por pagamento",()=>{
 assert.match(print,/expenseItems\.map\(e=>row\(/);
 assert.match(print,/\[e\.description\],\[e\.category/);
 assert.match(print,/date\(e\.competence_date\)/);
 assert.match(print,/date\(e\.paid_at\)/);
 assert.match(print,/\[e\.status\],\[amount\(e\.amount\),"money"\]/);
 assert.match(print,/const expensesPage=page/);
 assert.match(sql,/e\.competence_date>=first_day/);
 assert.match(sql,/e\.status='PAGO' and e\.paid_at>=first_day/);
 assert.match(sql,/select coalesce\(jsonb_agg\(to_jsonb\(t\) order by t\.competence_date,t\.id\)/);
});
test("resultado de caixa desconta somente despesas pagas, sem incluir glosas novamente",()=>{
 assert.match(print,/receiptTotal=directAmount===null\|\|insuranceAmount===null\?null:/);
 assert.match(print,/Math\.round\(receiptTotal\*100\)-Math\.round\(Number\(expensePaid\)\*100\)/);
 assert.match(print,/card\("Resultado de caixa",amount\(cashResult\)/);
 assert.match(print,/card\("Despesas pagas",amount\(expensePaid\)/);
 assert.match(print,/card\("Despesas da competência",amount\(snap\.expenses\?\.competence_total\)/);
 assert.match(print,/Recuperado no mês/);
 assert.match(print,/const expenseCards=/);
});
test("a seção financeira sai na impressão Prévia e Registro Mensal e respeita página separada",()=>{
 assert.match(print,/const combinedFinancePage=page\(heading\("Divisão por Sócio \/ Médico e Caixa"/);
 assert.match(print,/combinedFinancePage\+expensesPage\+receiptChartPage\+'<script nonce=/);
 assert.match(print,/const expensesPage=page\(heading\("Despesas, Glosas e Pendências"/);
 assert.match(print,/const snap:Snapshot=\(view==="closed"\?data\.closing\.snapshot:data\.current\)/);
 assert.match(print,/view==="closed"\?"REGISTRO MENSAL":"PRÉVIA"/);
 assert.match(print,/if\(view==="closed"&&!data\.closing\)return/);
 assert.match(print,/\.page-break\{break-before:page/);
});
test("nunca transformar ausência de dados históricos em valor zero sem aviso",()=>{
 assert.match(print,/const expensePaid=snap\.expenses\?\.paid_total\?\?null/);
 assert.doesNotMatch(print,/Pontos a conferir|financeWarnings|notices\.map/);
 assert.match(print,/Nenhuma despesa neste período/);
});
