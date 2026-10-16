import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const migrations=[
 "20261016120000_independent_professional_billing.sql",
 "20261016183000_professional_private_fiscal_requests.sql",
 "20261016203000_billing_portal_submissions.sql",
 "20261016220000_billing_denials_and_appeals.sql",
 "20261016230000_monthly_entity_closing.sql"
];
const read=name=>readFileSync(join("supabase","migrations",name),"utf8");

test("as cinco migrations são sequenciais e não possuem blocos DO malformados",()=>{
 assert.equal(migrations.length,5);
 const versions=migrations.map(s=>s.slice(0,14));
 assert.deepEqual([...versions].sort(),versions);
 for(const name of migrations){
   const sql=read(name);
   assert.doesNotMatch(sql,/\bdo\s+\$\s+begin\b/i,
     name+" contém bloco DO com delimitador incompleto");
   // Teste lexical, não substitui execução em PostgreSQL. Evita erro conhecido:
   // cada tag de bloco $$ ou $named$ precisa aparecer um número par de vezes.
   const tags=[...sql.matchAll(/\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/g)]
      .map(match=>match[0]);
   const counts=new Map();
   for(const tag of tags)counts.set(tag,(counts.get(tag)||0)+1);
   for(const [tag,count] of counts)
      assert.equal(count%2,0,name+": delimitador "+tag+" desequilibrado");
   assert.ok(sql.trim().endsWith(";"),name+" deve terminar com ;");
 }
});
test("backfill preserva metadados e desabilita somente triggers de auditoria conhecidos",()=>{
 const sql=read(migrations[0]);
 assert.match(sql,/do \$professional_metadata_backfill\$/);
 assert.match(sql,/disable trigger financial_stamp/);
 assert.match(sql,/disable trigger financial_log_change/);
 assert.match(sql,/enable trigger financial_stamp/);
 assert.match(sql,/enable trigger financial_log_change/);
 assert.doesNotMatch(sql,/disable trigger all/i);
 assert.match(sql,/create unique index if not exists billing_records_attendance_professional_unique/i);
 assert.match(sql,/drop constraint billing_records_appointment_id_key/i);
});
test("pagamento PARTICULAR gera solicitação vinculada à cobrança, não apenas à cirurgia",()=>{
 const sql=read(migrations[1]);
 assert.match(sql,/drop index if exists public\.invoice_requests_active_attendance/i);
 assert.match(sql,/insert into public\.invoice_requests\(/);
 assert.match(sql,/billing_record_id/);
 assert.match(sql,/save_professional_charge_core/);
});
test("faturado no portal é distinto de pagamento recebido e tem log",()=>{
 const sql=read(migrations[2]);
 assert.match(sql,/billing_portal_submission_events/);
 assert.match(sql,/MARK_SUBMITTED/);
 assert.doesNotMatch(sql,/update\s+public\.billing_records\s+set\s+payment_status/i);
});
test("glosas não duplicam receitas",()=>{
 const sql=read(migrations[3]);
 assert.match(sql,/billing_denial_recoveries/);
 assert.match(sql,/billing_denial_events/);
 assert.doesNotMatch(sql,/update\s+public\.invoices\s+set/i);
 assert.doesNotMatch(sql,/update\s+public\.billing_records\s+set\s+received_amount/i);
});
test("fechamento por PJ/PF é imutável e soma caixa somente por NF",()=>{
 const sql=read(migrations[4]);
 assert.match(sql,/unique\(billing_entity_id,competence_month\)/);
 assert.match(sql,/before update or delete on public\.billing_monthly_closings/);
 assert.match(sql,/i\.recipient_type='CONVENIO'/);
 assert.match(sql,/b\.settlement_mode='DIRECT'/);
 assert.match(sql,/general_manager/);
});
test("as cinco funcionalidades exigem ativação independente do servidor",()=>{
 const sources=[
  ["app/api/billing/route.ts","RN_PROFESSIONAL_BILLING_ENABLED"],
  ["app/api/billing/portal/route.ts","RN_PORTAL_SUBMISSIONS_ENABLED"],
  ["app/api/billing/denials/route.ts","RN_DENIALS_ENABLED"],
  ["app/api/billing/closing/route.ts","RN_MONTHLY_CLOSING_ENABLED"]
 ];
 for(const [path,flag] of sources){
  const source=readFileSync(path,"utf8");
  assert.ok(source.includes(flag),path+" não verifica a flag "+flag);
 }
});
