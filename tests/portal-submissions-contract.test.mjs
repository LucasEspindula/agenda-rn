import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const load=name=>readFileSync(name,"utf8");
test("guia apresentada não modifica pagamento no controle novo",()=>{
 const route=load("app/api/billing/portal/route.ts");
 const sql=load("supabase/migrations/20261016203000_billing_portal_submissions.sql");
 assert.match(route,/RN_PORTAL_SUBMISSIONS_ENABLED/);
 assert.match(route,/session\.agendaIds\.includes/);
 assert.match(sql,/billing_record_id uuid not null unique/);
 assert.match(sql,/FATURADO/);
 assert.doesNotMatch(sql,/update\s+public\.billing_records\s+set\s+payment_status/i);
 assert.doesNotMatch(sql,/update\s+public\.invoices\s+set/i);
});
test("registro só aceita perfis autorizados e audita submissão",()=>{
 const sql=load("supabase/migrations/20261016203000_billing_portal_submissions.sql");
 assert.match(sql,/general_manager','secretary/);
 assert.match(sql,/billing_portal_submission_events/);
 assert.match(sql,/submitted_at is not null/);
 assert.match(sql,/portal_protocol/);
 assert.match(sql,/public\.agenda_access/);
});
test("prazo não é presumido sem regra contratual",()=>{
 const source=load("lib/portal-deadlines.js");
 assert.match(source,/if\(!rule\)return \{state:"NO_RULE"/);
 assert.match(source,/rule\.valid_from<=serviceDate/);
 assert.match(source,/!!b\.professional_id/);
});
