import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(p,"utf8");
const sql=read("supabase/migrations/20261019143000_monthly_closing_unlock_audit.sql");
const api=read("app/api/billing/closing/route.ts");
const ui=read("app/billing/monthly-closing.tsx");
const pdf=read("app/api/reports/monthly-closing/route.ts");

test("novo desbloqueio preserva snapshot sem apagar e só adiciona versões",()=>{
 assert.match(sql,/create table public\.billing_monthly_closing_events/);
 assert.match(sql,/before update or delete on public\.billing_monthly_closing_events/);
 assert.match(sql,/event_type='UNLOCKED'/);
 assert.match(sql,/event_type='CLOSED'/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.doesNotMatch(sql,/delete from public\.billing_monthly_closings/i);
 assert.doesNotMatch(sql,/update public\.billing_monthly_closings/i);
});
test("senha do Gerente Geral é verificada no servidor antes do RPC",()=>{
 assert.match(api,/verifyPassword\(input\.password,account\.password_hash,account\.password_salt\)/);
 assert.match(api,/consumeLimit\("monthly-closing-unlock"/);
 assert.match(api,/account\.role!=="general_manager"/);
 assert.match(api,/unlock_billing_month/);
 assert.match(sql,/role='general_manager'/);
 assert.doesNotMatch(sql,/password_hash/);
});
test("operações retroativas de NF, faturamento e glosa não são bloqueadas pelo fechamento",()=>{
 assert.doesNotMatch(sql,/update\s+public\.(?:billing_records|invoices|billing_denial_cases)/i);
 assert.doesNotMatch(sql,/create trigger [\s\S]*? on public\.(?:billing_records|invoices|billing_denial_cases)/i);
 assert.match(ui,/Pagamentos, NFs e glosas retroativos não são bloqueados/);
});
test("impressora segue a mesma arquitetura de PDF que os demais relatórios",()=>{
 assert.match(ui,/import \{PrintIcon\} from "@\/components\/billing-icons"/);
 assert.match(ui,/window\.open\("\/api\/reports\/monthly-closing\/print\?"/);
 assert.doesNotMatch(ui,/window\.print\(/);
 assert.match(pdf,/PdfReport,brDate,brDateTime,brl,pdfResponse/);
 assert.match(pdf,/pdfResponse\(pdf/);
 assert.match(pdf,/role!=="general_manager"/);
});
test("mês fechado pode ser desbloqueado e bloqueado novamente mantendo auditoria",()=>{
 assert.match(sql,/create or replace function public\.unlock_billing_month/);
 assert.match(sql,/create or replace function public\.close_billing_month/);
 assert.match(sql,/insert into public\.billing_monthly_closing_events/);
 assert.match(sql,/latest\.event_type<>'UNLOCKED'/);
 assert.match(ui,/Desbloquear mês com senha do Gerente Geral/);
 assert.match(ui,/Histórico de bloqueios e desbloqueios/);
});
