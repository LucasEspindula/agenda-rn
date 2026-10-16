import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(path,"utf8");
const migration=read("supabase/migrations/20261016220000_billing_denials_and_appeals.sql");
const route=read("app/api/billing/denials/route.ts");
const page=read("app/billing/glosas/page.tsx");
test("glosa sempre referencia cobrança e entidade, independente do pagamento",()=>{
 assert.match(migration,/billing_record_id uuid not null references public\.billing_records/);
 assert.match(migration,/billing_entity_id uuid not null references public\.billing_entities/);
 assert.match(migration,/denial_kind in \('TOTAL','PARCIAL'\)/);
 assert.match(migration,/billing_method<>'CONVENIO'/);
 assert.doesNotMatch(migration,/update\s+public\.billing_records\s+set\s+payment_status/i);
 assert.doesNotMatch(migration,/update\s+public\.invoices\s+set/i);
});
test("recurso deferido limita recuperação, com status distinto de recebimento",()=>{
 assert.match(migration,/approved_amount numeric\(14,2\)/);
 assert.match(migration,/value_amount\+\(select coalesce\(sum\(amount\),0\)/);
 assert.match(migration,/case_row\.recovered_amount\+value_amount>case_row\.denied_amount/);
 assert.match(migration,/CLOSED/);
 assert.match(migration,/billing_denial_events/);
});
test("API e pagina inacessíveis sem flag, secretario tem escopo por profissional",()=>{
 assert.match(route,/RN_DENIALS_ENABLED/);
 assert.match(page,/RN_DENIALS_ENABLED/);
 assert.match(route,/session\.agendaIds\.includes/);
 assert.match(migration,/public\.agenda_access/);
 assert.match(migration,/case_row\.updated_at is distinct from/);
});
