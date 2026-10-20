import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path)=>readFileSync(path,"utf8");
const migration=read("supabase/migrations/20261016230000_monthly_entity_closing.sql");
const api=read("app/api/billing/closing/route.ts");
const ui=read("app/billing/monthly-closing.tsx");
const page=read("app/billing/fechamento/page.tsx");

test("fechamento consolida por entidade recebedora e separa três datas",()=>{
 assert.match(migration,/b\.billing_entity_id=p_entity/);
 assert.match(migration,/i\.billing_entity_id=p_entity/);
 assert.match(migration,/a\.date>=first_day/);
 assert.match(migration,/i\.issue_date>=first_day/);
 assert.match(migration,/i\.paid_at>=first_day/);
 assert.match(migration,/e\.paid_at>=first_day/);
});
test("NF de convênio paga entra uma única vez e NF particular não duplica caixa",()=>{
 assert.match(migration,/i\.recipient_type='CONVENIO'/);
 assert.match(migration,/b\.settlement_mode='DIRECT'/);
 assert.match(migration,/public\.invoice_billing_records/);
 assert.match(migration,/recovered_in_month/);
 assert.doesNotMatch(migration,/update\s+public\.invoices\s+set/i);
});
test("histórico mensal é imutável e separado por PJ\/PF e competência",()=>{
 assert.match(migration,/unique\(billing_entity_id,competence_month\)/);
 assert.match(migration,/before update or delete on public\.billing_monthly_closings/);
 assert.match(migration,/p_actor bigint/);
 assert.match(migration,/general_manager/);
 assert.match(migration,/Competência já encerrada/);
});
test("acesso restrito ao gerente e oculto até migration homologada",()=>{
 assert.match(api,/RN_MONTHLY_CLOSING_ENABLED/);
 assert.match(page,/RN_MONTHLY_CLOSING_ENABLED/);
 assert.match(api,/general_manager/);
 assert.match(api,/secureMutation/);
 assert.match(ui,/Prévia<\/button>/);
 assert.match(ui,/>Fechar Mês<\/button>/);
 assert.match(ui,/attributed_invoice_items/);
});
