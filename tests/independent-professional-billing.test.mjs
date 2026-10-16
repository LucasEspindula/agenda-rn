import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  "supabase/migrations/20261016120000_independent_professional_billing.sql",
  "utf8",
);
const surgeon = "11111111-1111-4111-8111-111111111111";
const anesthetist = "22222222-2222-4222-8222-222222222222";
const attendance = "att-1";
const entity = "44444444-4444-4444-8444-444444444444";

test("independent professional charges keep financial ownership and audit isolated", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table users(id bigint primary key, role text not null);
    create table doctors(id text primary key, active boolean not null default true, billing_enabled boolean not null default true);
    create table billing_entities(id uuid primary key, name text not null, trade_name text, active boolean not null default true);
    create table billing_doctor_entities(doctor_id text, billing_entity_id uuid, active boolean not null default true);
    create table attendances(id text primary key, appointment_id text, doctor_id text not null, insurance text, status text not null);
    create table app_state(id integer primary key, payload jsonb not null);
    create table agenda_access(user_id bigint, professional_id text);
    create table billing_records(
      id uuid primary key, attendance_id text not null constraint billing_attendance_unique unique,
      appointment_id text, settlement_mode text, billing_entity_id uuid, billing_method text,
      payment_status text, invoice_number text, received_amount numeric, paid_at date,
      notes text, payment_composition_verified boolean not null default false,
      updated_at timestamptz not null default now(), updated_by bigint
    );
    create table invoices(
      id uuid primary key, billing_entity_id uuid, invoice_number text, payer text,
      issue_date date, total_amount numeric, net_amount numeric, paid_at date, notes text,
      recipient_type text, closing_adjustment numeric, closing_adjustment_reason text,
      allocation_verified boolean, payment_composition_verified boolean,
      status text not null default 'ACTIVE', voided_at timestamptz, updated_at timestamptz not null default now(), updated_by bigint
    );
    create table invoice_billing_records(invoice_id uuid, billing_record_id uuid, received_amount numeric, is_active boolean not null default true, primary key(invoice_id,billing_record_id));
    create table payment_parts(id uuid primary key default gen_random_uuid(), billing_record_id uuid, invoice_id uuid, amount numeric);
    create table financial_logs(id bigint generated always as identity primary key, operation text, actor bigint, record_id text, before_data jsonb, after_data jsonb);
    create function financial_operation(p_actor bigint,p_kind text,p_id text) returns void language plpgsql set search_path to '' as $$ begin
      if not exists(select 1 from public.users where id=p_actor and role in ('general_manager','secretary','doctor')) then raise exception 'Acesso negado'; end if;
      perform set_config('rn.actor',p_actor::text,true); perform set_config('rn.operation',gen_random_uuid()::text,true); perform set_config('rn.kind',p_kind,true); perform set_config('rn.record',coalesce(p_id,''),true);
    end $$;
    create function write_payment_parts(p_record uuid,p_invoice uuid,p_parts jsonb) returns void language plpgsql set search_path to '' as $$ begin
      insert into public.payment_parts(billing_record_id,invoice_id,amount) select p_record,p_invoice,(value->>'amount')::numeric from jsonb_array_elements(p_parts);
    end $$;
    create function billing_payer_key(value text) returns text language sql immutable as $$ select upper(trim(coalesce(value,''))) $$;
    create function save_billing(p_actor bigint,p_kind text,p_data jsonb) returns uuid language plpgsql as $$ begin
      perform financial_operation(p_actor,p_kind,p_data->>'id'); return 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
    end $$;
    create function audit_charge() returns trigger language plpgsql set search_path to '' as $$ begin
      if nullif(current_setting('rn.operation',true),'') is null or current_setting('rn.actor',true) is null then raise exception 'auditoria sem operação'; end if;
      insert into public.financial_logs(operation,actor,record_id,before_data,after_data) values(current_setting('rn.kind',true),current_setting('rn.actor',true)::bigint,coalesce(new.id,old.id)::text,to_jsonb(old),to_jsonb(new));
      return coalesce(new,old);
    end $$;
    insert into users values(1,'general_manager'),(2,'secretary'),(3,'doctor');
    insert into doctors values('${surgeon}',true,true),('${anesthetist}',true,true);
    insert into billing_entities values('${entity}','Clínica',null,true);
    insert into billing_doctor_entities values('${surgeon}','${entity}',true),('${anesthetist}','${entity}',true);
    insert into attendances values('${attendance}','appt-1','${surgeon}','Bradesco','realized'),('legacy-att','legacy-appt','${surgeon}','Unimed','realized');
    insert into billing_records(id,attendance_id,appointment_id,settlement_mode,billing_entity_id,billing_method,payment_status)
      values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','legacy-att','legacy-appt','DIRECT','${entity}','PARTICULAR','PENDENTE');
    insert into app_state values(1,'{"appointments":[{"id":"appt-1","doctorId":"${surgeon}","anesthetistId":"${anesthetist}"}]}');
    insert into agenda_access values(2,'${surgeon}');
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
    grant execute on all functions in schema public to service_role;
  `);
  await db.exec(migration);
  await db.exec("create trigger charge_audit after insert or update or delete on billing_records for each row execute function audit_charge()");
  await db.exec("set role service_role");
  assert.equal((await db.query("select professional_id,professional_role from billing_records where attendance_id='legacy-att'")).rows[0].professional_id, surgeon);

  const charge = async (actor, body) => (
    await db.query("select save_professional_charge($1,$2::jsonb) id", [actor, JSON.stringify(body)])
  ).rows[0].id;
  const base = { attendance_id: attendance, billing_entity_id: entity, payment_status: "PENDENTE" };
  const surgeonCharge = await charge(1, { ...base, professional_id: surgeon, professional_role: "SURGEON", billing_method: "CONVENIO", submission_channel_code: "PORTAL_CONVENIO", commercial_modality_code: "LEGADO", patient_insurance_snapshot: "Bradesco" });
  const anesthetistCharge = await charge(1, { ...base, professional_id: anesthetist, professional_role: "ANESTHETIST", billing_method: "PARTICULAR", received_amount: 900, paid_at: "2026-10-16", payment_status: "PAGO", payment_parts: [{ amount: 900 }] });
  assert.notEqual(surgeonCharge, anesthetistCharge);
  const rows = (await db.query("select id,professional_id,payment_status,received_amount from billing_records where attendance_id=$1 order by professional_id", [attendance])).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.id === surgeonCharge).payment_status, "PENDENTE");
  assert.equal(Number(rows.find((row) => row.id === anesthetistCharge).received_amount), 900);
  assert.ok((await db.query("select count(*)::int n from financial_logs where operation='professional_charge' and actor=1")).rows[0].n >= 2);

  const updated = await db.query("select updated_at from billing_records where id=$1", [anesthetistCharge]);
  await charge(1, { ...base, id: anesthetistCharge, updated_at: updated.rows[0].updated_at, professional_id: anesthetist, professional_role: "ANESTHETIST", billing_method: "PARTICULAR", payment_status: "PENDENTE" });
  const afterReversal = (await db.query("select payment_status,received_amount from billing_records where id=$1", [anesthetistCharge])).rows[0];
  assert.deepEqual({ ...afterReversal, received_amount: afterReversal.received_amount }, { payment_status: "PENDENTE", received_amount: null });
  assert.equal((await db.query("select payment_status from billing_records where id=$1", [surgeonCharge])).rows[0].payment_status, "PENDENTE");

  const anesthetistVersion = (await db.query("select updated_at from billing_records where id=$1", [anesthetistCharge])).rows[0].updated_at;
  await charge(1, { ...base, id: anesthetistCharge, updated_at: anesthetistVersion, professional_id: anesthetist, professional_role: "ANESTHETIST", billing_method: "CONVENIO", submission_channel_code: "COOPERATIVA", commercial_modality_code: "COOPERADA", patient_insurance_snapshot: "Bradesco", payment_status: "PENDENTE" });
  const invoice = (await db.query("select save_professional_invoice($1,$2::jsonb) id", [1, JSON.stringify({ billing_entity_id: entity, invoice_number: "NF-100", payer: "Bradesco", issue_date: "2026-10-16", total_amount: 1900, net_amount: 1900, record_ids: [surgeonCharge, anesthetistCharge], item_amounts: { [surgeonCharge]: 1000, [anesthetistCharge]: 900 } })])).rows[0].id;
  assert.equal((await db.query("select count(*)::int n from invoice_billing_records where invoice_id=$1", [invoice])).rows[0].n, 2);

  await assert.rejects(
    () => charge(2, { ...base, professional_id: anesthetist, billing_method: "PARTICULAR", payment_status: "PENDENTE" }),
    /Agenda sem permissão para este profissional/,
  );
  await assert.rejects(
    () => charge(1, { ...base, professional_id: "not-in-attendance", billing_method: "PARTICULAR", payment_status: "PENDENTE" }),
    /Profissional não participa/,
  );
  assert.equal((await db.query("select count(*)::int n from billing_records where professional_id='not-in-attendance'")).rows[0].n, 0);
  await assert.rejects(
    () => db.query("select save_billing($1,'record',$2::jsonb)", [1, JSON.stringify({ attendance_id: attendance })]),
    /cobranças independentes/,
  );
});
