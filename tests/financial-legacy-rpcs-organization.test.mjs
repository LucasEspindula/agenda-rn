import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync(new URL('../supabase/migrations/20261029202018_financial_legacy_rpcs_org_scope.sql',import.meta.url),'utf8');
const agenda=readFileSync(new URL('../supabase/migrations/20261029192723_legacy_agenda_directory_org_scope.sql',import.meta.url),'utf8');
const finance=readFileSync(new URL('../supabase/migrations/20261029194356_financial_tenant_keys_foundation.sql',import.meta.url),'utf8');
const org='11111111-1111-4111-8111-111111111111';
const other='99999999-9999-4999-8999-999999999999';
const entity='22222222-2222-4222-8222-222222222222';
const payment='33333333-3333-4333-8333-333333333333';
const requestId='44444444-4444-4444-8444-444444444444';
const invoice='55555555-5555-4555-8555-555555555555';
function extract(src,name) {
 const fragment=src.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$;','i'))?.[0];
 assert.ok(fragment,'Expected helper '+name);return fragment;
}
async function fixture(){
 const db=new PGlite();
 await db.exec([
  'CREATE ROLE anon;','CREATE ROLE authenticated;','CREATE ROLE service_role BYPASSRLS;',
  'CREATE TABLE public.organizations(id uuid PRIMARY KEY,slug text,active boolean);',
  'CREATE TABLE public.users(id bigint PRIMARY KEY,role text,active boolean);',
  'CREATE TABLE public.organization_memberships(user_id bigint,organization_id uuid,role text,active boolean);',
  'CREATE TABLE public.app_state(id integer PRIMARY KEY,organization_id uuid,payload jsonb,updated_at timestamptz DEFAULT now());',
  'CREATE TABLE public.agenda_access(user_id bigint,professional_id text);',
  'CREATE TABLE public.doctors(id text PRIMARY KEY,organization_id uuid,name text);',
  'CREATE TABLE public.billing_entities(id uuid PRIMARY KEY,organization_id uuid,name text,tax_id text);',
  'CREATE TABLE public.billing_doctor_entities(id uuid PRIMARY KEY,doctor_id text,billing_entity_id uuid,organization_id uuid,active boolean);',
  'CREATE TABLE public.attendances(id text PRIMARY KEY,organization_id uuid,doctor_id text,appointment_id text,patient_id text,date date,procedure text);',
  'CREATE TABLE public.billing_records(id uuid PRIMARY KEY,organization_id uuid,attendance_id text,billing_entity_id uuid,appointment_id text,professional_id text,payment_status text,billing_method text,no_invoice boolean DEFAULT false,invoice_number text,received_amount numeric,paid_at date);',
  'CREATE TABLE public.invoice_requests(id uuid PRIMARY KEY,organization_id uuid,attendance_id text,billing_record_id uuid,billing_entity_id uuid,status text,invoice_id uuid,updated_at timestamptz,taker_kind text,taker_name text,taker_tax_id text,taker_address text,notes text,received_amount_snapshot numeric,paid_at_snapshot date,patient_id text,patient_name_snapshot text,doctor_id text,doctor_name_snapshot text,attendance_date_snapshot date,procedure_snapshot text,entity_name_snapshot text,entity_tax_id_snapshot text);',
  'CREATE TABLE public.invoices(id uuid PRIMARY KEY,organization_id uuid,invoice_number text);',
  'CREATE TABLE public.company_associates(id uuid PRIMARY KEY,name text);',
  'CREATE FUNCTION public.valid_cpf(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT length($1)=11 $$;',
  'CREATE FUNCTION public.financial_operation(bigint,text,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$;',
  'CREATE FUNCTION public.financial_attendance(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object(\'id\',$1) $$;'
 ].join('\n'));
 await db.query("INSERT INTO public.organizations VALUES ($1,'rn-gestao',true)",[org]);
 await db.exec("INSERT INTO public.users VALUES (1,'general_manager',true),(2,'secretary',true),(3,'secretary',false)");
 for(const [id,role,active] of [[1,'general_manager',true],[2,'secretary',true],[3,'secretary',false]]){
  await db.query('INSERT INTO public.organization_memberships VALUES ($1,$2,$3,$4)',[id,org,role,active]);
 }
 await db.query('INSERT INTO public.app_state(id,organization_id,payload) VALUES (1,$1,$2::jsonb)',[org,JSON.stringify({patients:[{id:'p-1',name:'Paciente Teste',cpf:'12345678901'}],appointments:[{id:'appointment-1',doctorId:'dr-1',anesthetistId:'dr-anesthesia'}]})]);
 await db.query("INSERT INTO public.agenda_access VALUES (2,'dr-1')");
 await db.query("INSERT INTO public.doctors VALUES ('dr-1',$1,'Doutor Teste'),('dr-anesthesia',$1,'Anestesista Teste')",[org]);
 await db.query("INSERT INTO public.billing_entities VALUES ($1,$2,'Empresa Teste','123')",[entity,org]);
 await db.query("INSERT INTO public.billing_doctor_entities VALUES ($1,'dr-anesthesia',$2,$3,true)",[invoice,entity,org]);
 await db.query("INSERT INTO public.attendances VALUES ('a-1',$1,'dr-1','appointment-1','p-1','2026-10-29','Consulta')",[org]);
 await db.query("INSERT INTO public.attendances VALUES ('a-attribute',$1,'dr-1','appointment-1','p-1','2026-10-29','Consulta')",[org]);
 await db.query("INSERT INTO public.billing_records(id,organization_id,attendance_id,billing_entity_id,appointment_id,payment_status,billing_method,no_invoice,received_amount,paid_at) VALUES ($1,$2,'a-1',$3,'appointment-1','PENDENTE','PARTICULAR',true,100,'2026-10-29')",[payment,org,entity]);
 await db.query("INSERT INTO public.invoices VALUES ($1,$2,'NF-123')",[invoice,org]);
 await db.query("INSERT INTO public.invoice_requests(id,organization_id,attendance_id,billing_record_id,billing_entity_id,status,updated_at,taker_kind,taker_name,taker_tax_id,received_amount_snapshot,paid_at_snapshot,patient_id) VALUES ($1,$2,'a-1',$3,$4,'PENDING','2026-10-29T12:00:00Z','OTHER','Nome Antigo','12345678901',100,'2026-10-29','p-1')",[requestId,org,payment,entity]);
 await db.exec(extract(finance,'rn_finance_single_organization_id'));
 await db.exec(extract(agenda,'require_rn_agenda_actor_organization'));
 await db.exec(migration);
 return db;
}
test('payment finalization requires active organization membership even on pending records',async()=>{
 const db=await fixture();try{
  await assert.rejects(db.query('SELECT public.finish_private_payment($1,$2,$3::jsonb)',[3,payment,'{}']),/Acesso à organização negado/);
  await db.query('SELECT public.finish_private_payment($1,$2,$3::jsonb)',[1,payment,'{}']);
  const row=await db.query('SELECT no_invoice,status FROM (SELECT no_invoice,payment_status AS status FROM public.billing_records WHERE id=$1) b',[payment]);
  assert.equal(row.rows[0].no_invoice,false);
  const request=await db.query('SELECT status FROM public.invoice_requests WHERE id=$1',[requestId]);
  assert.equal(request.rows[0].status,'CANCELLED');
 }finally{await db.close();}
});
test('payment finalization rejects non-existent record rather than silently accepting',async()=>{
 const db=await fixture();try{
  await assert.rejects(db.query('SELECT public.finish_private_payment(1,$1,$2::jsonb)',['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{}']),/Cobrança não encontrada/);
 }finally{await db.close();}
});
test('invoice request editing accepts valid manager and checks membership before target lookup',async()=>{
 const db=await fixture();try{
  await assert.rejects(db.query('SELECT public.update_pending_invoice_request(3,$1::jsonb)',[JSON.stringify({id:requestId,updated_at:'2026-10-29T12:00:00Z'})]),/Acesso à organização negado/);
  await assert.rejects(db.query('SELECT public.update_pending_invoice_request(1,$1::jsonb)',[JSON.stringify({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',updated_at:'2026-10-29T12:00:00Z'})]),/Solicitação fiscal não encontrada/);
  await db.exec("UPDATE public.billing_records SET payment_status='PAGO' WHERE id='"+payment+"'");
  const result=await db.query('SELECT public.update_pending_invoice_request(1,$1::jsonb) AS id',[JSON.stringify({id:requestId,updated_at:'2026-10-29T12:00:00Z',taker_kind:'OTHER',taker_name:'Novo Nome',taker_tax_id:'12345678901'})]);
  assert.equal(result.rows[0].id,requestId);
  assert.equal((await db.query('SELECT taker_name FROM public.invoice_requests WHERE id=$1',[requestId])).rows[0].taker_name,'Novo Nome');
 }finally{await db.close();}
});
test('attribution derives tenant from persisted entity, not from a caller-supplied organization',async()=>{
 const db=await fixture();try{
  const result=await db.query('SELECT public.attribute_financial_attendance($1,$2) AS result',['a-attribute',entity]);
  assert.equal(result.rows[0].result.id,'a-attribute');
  assert.equal((await db.query("SELECT doctor_id FROM public.attendances WHERE id='a-attribute'")).rows[0].doctor_id,'dr-anesthesia');
  await assert.rejects(db.query('SELECT public.attribute_financial_attendance($1,$2)',['a-1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']),/Entidade recebedora não encontrada/);
 }finally{await db.close();}
});
test('audit label snapshot derives patient and financial names from scoped organization',async()=>{
 const db=await fixture();try{
  const data={doctor_id:'dr-1',billing_entity_id:entity,invoice_id:invoice,patient_id:'p-1'};
  const result=await db.query('SELECT public.financial_log_snapshot($1::jsonb) AS data',[JSON.stringify(data)]);
  assert.equal(result.rows[0].data._labels.doctor_id,'Doutor Teste');
  assert.equal(result.rows[0].data._labels.billing_entity_id,'Empresa Teste');
  assert.equal(result.rows[0].data._labels.patient_id,'Paciente Teste');
 }finally{await db.close();}
});
test('a second organization fails closed even when old records remain',async()=>{
 const db=await fixture();try{
  await db.query("INSERT INTO public.organizations VALUES ($1,'other-test',true)",[other]);
  await assert.rejects(db.query('SELECT public.attribute_financial_attendance($1,$2)',['a-1',entity]),/Organização de operação inválida/);
  await assert.rejects(db.query('SELECT public.financial_log_snapshot($1::jsonb)',[JSON.stringify({patient_id:'p-1'})]),/Organização de operação inválida/);
  await assert.rejects(db.query('SELECT public.finish_private_payment(1,$1,$2::jsonb)',[payment,'{}']),/Organização de operação inválida/);
 }finally{await db.close();}
});
test('migration replaces legacy singleton reads and protects RPCs against direct public execution',()=>{
 for(const fn of ['attribute_financial_attendance','financial_log_snapshot','finish_private_payment','update_pending_invoice_request']){
  assert.match(migration,new RegExp('CREATE OR REPLACE FUNCTION public\\.'+fn+'\\('));
  assert.match(migration,new RegExp('REVOKE ALL ON FUNCTION public\\.'+fn+'\\('));
 }
 assert.doesNotMatch(migration,/\bwhere\s+(?:s\.)?id\s*=\s*1\b/i);
 assert.match(migration,/rn_org_id:=public.require_rn_agenda_actor_organization\(p_actor\)/);
});
