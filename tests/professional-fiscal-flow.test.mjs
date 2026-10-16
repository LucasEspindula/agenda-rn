import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";

const migration=readFileSync("supabase/migrations/20261016120000_independent_professional_billing.sql","utf8");
const fiscal=readFileSync("supabase/migrations/20261016183000_professional_private_fiscal_requests.sql","utf8");
const surgeon="11111111-1111-4111-8111-111111111111",anesthetist="22222222-2222-4222-8222-222222222222";
const entity="33333333-3333-4333-8333-333333333333";
function pay(professional_id,amount){return {
 attendance_id:"att-1",professional_id,professional_role:professional_id===surgeon?"SURGEON":"ANESTHETIST",
 billing_entity_id:entity,billing_method:"PARTICULAR",payment_status:"PAGO",
 commercial_modality_code:"PARTICULAR",submission_channel_code:"DIRETO",received_amount:amount,
 paid_at:"2026-10-16",payment_parts:[{method:"PIX",amount}],
 fiscal:{taker_kind:"PATIENT",taker_name:"Paciente Teste",taker_tax_id:"52998224725",taker_address:"Rua Teste"}
};}
test("duas cobranças particulares da mesma cirurgia têm solicitações de NF independentes",async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`
  create role anon;create role authenticated;create role service_role bypassrls;
  create table users(id bigint primary key,role text);
  create table doctors(id text primary key,name text,active boolean default true,billing_enabled boolean default true);
  create table billing_entities(id uuid primary key,name text,trade_name text,tax_id text,active boolean default true);
  create table billing_doctor_entities(doctor_id text,billing_entity_id uuid,active boolean default true);
  create table attendances(id text primary key,appointment_id text,doctor_id text,patient_id text,date date,procedure text,insurance text,status text);
  create table app_state(id integer primary key,payload jsonb);
  create table agenda_access(user_id bigint,professional_id text);
  create table billing_records(id uuid primary key default gen_random_uuid(),attendance_id text constraint billing_attendance_unique unique,
    appointment_id text,settlement_mode text,billing_entity_id uuid,billing_method text,payment_status text,invoice_number text,
    received_amount numeric,paid_at date,notes text,payment_composition_verified boolean default false,
    updated_at timestamptz default now(),updated_by bigint);
  create table invoices(id uuid primary key,billing_entity_id uuid,invoice_number text,payer text,issue_date date,
    total_amount numeric,net_amount numeric,paid_at date,notes text,recipient_type text,closing_adjustment numeric,
    closing_adjustment_reason text,allocation_verified boolean,payment_composition_verified boolean,
    status text default 'ACTIVE',voided_at timestamptz,updated_at timestamptz default now(),updated_by bigint);
  create table invoice_billing_records(invoice_id uuid,billing_record_id uuid,received_amount numeric,
    is_active boolean default true,primary key(invoice_id,billing_record_id));
  create table payment_parts(id uuid primary key default gen_random_uuid(),billing_record_id uuid,invoice_id uuid,method text,amount numeric);
  create table invoice_requests(id uuid primary key default gen_random_uuid(),attendance_id text not null,billing_record_id uuid not null,
    billing_entity_id uuid not null,status text not null default 'PENDING',taker_kind text not null,taker_name text not null,
    taker_tax_id text not null,taker_address text,notes text,received_amount_snapshot numeric not null,paid_at_snapshot date not null,
    patient_id text not null,patient_name_snapshot text not null,doctor_id text not null,doctor_name_snapshot text not null,
    attendance_date_snapshot date not null,procedure_snapshot text not null,entity_name_snapshot text not null,
    entity_tax_id_snapshot text,invoice_id uuid,created_by bigint not null,updated_by bigint not null,
    updated_at timestamptz default now());
  create unique index invoice_requests_active_attendance on invoice_requests(attendance_id) where status in ('PENDING','ISSUED');
  create unique index invoice_requests_active_record on invoice_requests(billing_record_id) where status in ('PENDING','ISSUED');
  create function valid_cpf(value text) returns boolean language sql immutable as $$ select value ~ '^[0-9]{11}$' $$;
  create function billing_payer_key(value text) returns text language sql immutable as $$ select upper(trim(coalesce(value,''))) $$;
  create function appointment_billing_method(a jsonb,fallback text default null) returns text language sql immutable as $$
    select coalesce(a->>'forma_cobranca',fallback) $$;
  create function financial_operation(actor bigint,kind text,id text) returns void language plpgsql set search_path to '' as $$ begin
    perform set_config('rn.actor',actor::text,true);perform set_config('rn.operation',gen_random_uuid()::text,true);
    perform set_config('rn.kind',kind,true);perform set_config('rn.record',coalesce(id,''),true);
  end $$;
  create function write_payment_parts(record_id uuid,invoice_id uuid,parts jsonb) returns void language plpgsql set search_path to '' as $$ begin
    delete from public.payment_parts where billing_record_id=record_id or invoice_id=invoice_id;
    insert into public.payment_parts(billing_record_id,invoice_id,method,amount)
      select record_id,invoice_id,value->>'method',(value->>'amount')::numeric from jsonb_array_elements(parts);
  end $$;
  create function save_billing(actor bigint,kind text,p_data jsonb) returns uuid language plpgsql as $$ begin return gen_random_uuid(); end $$;
  insert into users values(1,'general_manager'),(2,'secretary');
  insert into doctors values('11111111-1111-4111-8111-111111111111','Cirurgião',true,true),
    ('22222222-2222-4222-8222-222222222222','Anestesista',true,true);
  insert into billing_entities values('33333333-3333-4333-8333-333333333333','PJ Exemplo',null,'12345678000199',true);
  insert into billing_doctor_entities values('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',true),
    ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',true);
  insert into attendances values('att-1','appt-1','11111111-1111-4111-8111-111111111111','pat-1',
    '2026-10-16','Cirurgia','Bradesco','realized');
  insert into app_state values(1,'{"patients":[{"id":"pat-1","name":"Paciente Teste","cpf":"52998224725"}],
    "appointments":[{"id":"appt-1","status":"realized","doctorId":"11111111-1111-4111-8111-111111111111",
    "anesthetistId":"22222222-2222-4222-8222-222222222222","patientId":"pat-1","forma_cobranca":"CONVENIO","insurance":"Bradesco"}]}');
  insert into agenda_access values(2,'22222222-2222-4222-8222-222222222222');
  grant usage on schema public to service_role;
  grant all on all tables in schema public to service_role;
  grant execute on all functions in schema public to service_role;
 `);
 await db.exec(migration);await db.exec(fiscal);await db.exec("set role service_role");
 const save=async(actor,body)=>(await db.query("select save_professional_charge($1,$2::jsonb) id",[actor,JSON.stringify(body)])).rows[0].id;
 const first=await save(1,pay(surgeon,100));
 const second=await save(1,pay(anesthetist,200));
 assert.notEqual(first,second);
 const requests=(await db.query("select billing_record_id,doctor_id,received_amount_snapshot from invoice_requests where status='PENDING' order by received_amount_snapshot")).rows;
 assert.equal(requests.length,2);
 assert.deepEqual(requests.map(x=>x.billing_record_id),[first,second]);
 assert.deepEqual(requests.map(x=>Number(x.received_amount_snapshot)),[100,200]);
 await assert.rejects(()=>save(1,pay(surgeon,100)),/Já existe uma cobrança/);
 await assert.rejects(()=>save(2,pay(surgeon,100)),/Agenda sem permissão/);
 const updated=(await db.query("select updated_at from billing_records where id=$1",[first])).rows[0].updated_at;
 await save(1,{...pay(surgeon,100),id:first,updated_at:updated,payment_status:"PENDENTE",received_amount:null,paid_at:null,payment_parts:[]});
 const snapshot=(await db.query("select doctor_id,status from invoice_requests")).rows;
 assert.equal(snapshot.find(x=>x.doctor_id===surgeon).status,"CANCELLED");
 assert.equal(snapshot.find(x=>x.doctor_id===anesthetist).status,"PENDING");
 assert.equal((await db.query("select payment_status from billing_records where id=$1",[second])).rows[0].payment_status,"PAGO");
});
