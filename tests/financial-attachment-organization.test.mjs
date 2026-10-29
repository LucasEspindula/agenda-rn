import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync(new URL('../supabase/migrations/20261029210500_financial_attachment_organization_authorization.sql',import.meta.url),'utf8');
const finance=readFileSync(new URL('../supabase/migrations/20261029194356_financial_tenant_keys_foundation.sql',import.meta.url),'utf8');
const access=readFileSync(new URL('../supabase/migrations/20261029192723_legacy_agenda_directory_org_scope.sql',import.meta.url),'utf8');
const ORG='55555555-5555-4555-8555-555555555555',OTHER='99999999-9999-4999-8999-999999999999';
const R1='11111111-1111-4111-8111-111111111111',R2='22222222-2222-4222-8222-222222222222';
const I1='33333333-3333-4333-8333-333333333333',I2='44444444-4444-4444-8444-444444444444';
function extract(source,name){
 const sql=source.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$;','i'))?.[0];
 assert.ok(sql,'Missing helper '+name);return sql;
}
async function fixture(){
 const db=new PGlite();
 await db.exec([
  'CREATE ROLE anon;','CREATE ROLE authenticated;','CREATE ROLE service_role BYPASSRLS;',
  'CREATE TABLE public.organizations(id uuid PRIMARY KEY,slug text,active boolean);',
  'CREATE TABLE public.users(id bigint PRIMARY KEY,role text,active boolean);',
  'CREATE TABLE public.organization_memberships(user_id bigint,organization_id uuid,role text,active boolean);',
  'CREATE TABLE public.app_state(id int PRIMARY KEY,organization_id uuid,payload jsonb);',
  'CREATE TABLE public.agenda_access(user_id bigint,professional_id text);',
  'CREATE TABLE public.attendances(id text PRIMARY KEY,organization_id uuid,doctor_id text,appointment_id text);',
  'CREATE TABLE public.billing_records(id uuid PRIMARY KEY,organization_id uuid,attendance_id text,payment_status text,paid_at date,received_amount numeric,billing_method text,settlement_mode text);',
  'CREATE TABLE public.invoices(id uuid PRIMARY KEY,organization_id uuid,recipient_type text,status text,voided_at timestamptz,paid_at date);',
  'CREATE TABLE public.invoice_billing_records(invoice_id uuid,billing_record_id uuid,organization_id uuid);',
  'CREATE TABLE public.financial_attachments(id uuid PRIMARY KEY,organization_id uuid,invoice_id uuid,billing_record_id uuid,storage_path text,document_type text,original_filename text,mime_type text,file_size bigint,replaces_attachment_id uuid,status text DEFAULT \'PENDING\',is_current boolean DEFAULT false,created_by bigint);',
  'CREATE FUNCTION public.financial_operation(bigint,text,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$;'
 ].join('\n'));
 await db.query("INSERT INTO public.organizations VALUES ($1,'rn-gestao',true)",[ORG]);
 await db.exec("INSERT INTO public.users VALUES (1,'general_manager',true),(2,'secretary',true),(3,'doctor',true),(4,'secretary',true),(5,'secretary',false)");
 for(const [id,role,on] of [[1,'general_manager',true],[2,'secretary',true],[3,'doctor',true],[4,'secretary',true],[5,'secretary',false]]){
  await db.query('INSERT INTO public.organization_memberships VALUES ($1,$2,$3,$4)',[id,ORG,role,on]);
 }
 await db.query('INSERT INTO public.app_state VALUES (1,$1,$2::jsonb)',[ORG,JSON.stringify({appointments:[{id:'appointment-1',anesthetistId:'anesthesia-1'},{id:'appointment-2'}]})]);
 await db.exec("INSERT INTO public.agenda_access VALUES (2,'dr-1'),(4,'anesthesia-1')");
 await db.query('INSERT INTO public.attendances VALUES ($1,$2,$3,$4)',['attendance-1',ORG,'dr-1','appointment-1']);
 await db.query('INSERT INTO public.attendances VALUES ($1,$2,$3,$4)',['attendance-2',ORG,'dr-2','appointment-2']);
 for(const [id,attendance] of [[R1,'attendance-1'],[R2,'attendance-2']])
  await db.query("INSERT INTO public.billing_records VALUES ($1,$2,$3,'PAGO','2026-10-25',100,'PARTICULAR','DIRECT')",[id,ORG,attendance]);
 for(const id of [I1,I2])await db.query("INSERT INTO public.invoices VALUES ($1,$2,'CONVENIO','ACTIVE',null,'2026-10-25')",[id,ORG]);
 for(const [invoice,record] of [[I1,R1],[I2,R1],[I2,R2]])
  await db.query('INSERT INTO public.invoice_billing_records VALUES ($1,$2,$3)',[invoice,record,ORG]);
 await db.exec(extract(finance,'rn_finance_single_organization_id'));
 await db.exec(extract(access,'require_rn_agenda_actor_organization'));
 await db.exec(migration);
 return db;
}
async function allowed(db,actor,invoice,record){
 const result=await db.query('SELECT public.authorized_financial_attachment_actor($1,$2::uuid,$3::uuid) AS ok',[actor,invoice,record]);
 return result.rows[0].ok;
}
test('manager and secretaries must have authorized targets and active organization memberships',async()=>{
 const db=await fixture();try{
  assert.equal(await allowed(db,1,null,R1),true);
  assert.equal(await allowed(db,1,I1,null),true);
  assert.equal(await allowed(db,1,null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),false);
  assert.equal(await allowed(db,1,I1,R1),false);
  assert.equal(await allowed(db,1,null,null),false);
  assert.equal(await allowed(db,3,null,R1),false);
  assert.equal(await allowed(db,5,null,R1),false);
  assert.equal(await allowed(db,2,null,R1),true);
  assert.equal(await allowed(db,2,null,R2),false);
  assert.equal(await allowed(db,2,I1,null),true);
  assert.equal(await allowed(db,2,I2,null),false);
  assert.equal(await allowed(db,4,null,R1),true);
  assert.equal(await allowed(db,4,I1,null),true);
  assert.equal(await allowed(db,4,I2,null),false);
 }finally{await db.close();}
});
test('revoked memberships, role mismatch and second organization fail closed',async()=>{
 const db=await fixture();try{
  await db.exec('UPDATE public.organization_memberships SET active=false WHERE user_id=2');
  assert.equal(await allowed(db,2,null,R1),false);
  await db.exec("UPDATE public.organization_memberships SET role='doctor' WHERE user_id=1");
  assert.equal(await allowed(db,1,null,R1),false);
  await db.query("INSERT INTO public.organizations VALUES ($1,'other',true)",[OTHER]);
  await assert.rejects(allowed(db,4,null,R1),/Organização de operação inválida/);
 }finally{await db.close();}
});
test('new proof uploads receive server-derived organization prefix',async()=>{
 const db=await fixture();try{
  const row=(await db.query('SELECT * FROM public.begin_financial_attachment($1,$2::uuid,$3::uuid,$4,$5,$6,$7::uuid)',[1,null,R1,'receipt.pdf','application/pdf',140,null])).rows[0];
  assert.ok(row.id);
  assert.equal(row.storage_path,'org/'+ORG+'/payment-proofs/'+R1+'/'+row.id);
  const saved=await db.query('SELECT storage_path FROM public.financial_attachments WHERE id=$1',[row.id]);
  assert.equal(saved.rows[0].storage_path,row.storage_path);
  await assert.rejects(db.query('SELECT * FROM public.begin_financial_attachment(5,null,$1,$2,$3,$4,null)',[R1,'receipt.pdf','application/pdf',140]),/Acesso à organização negado/);
 }finally{await db.close();}
});
test('proof API scopes metadata lookups before signed URLs',()=>{
 const route=readFileSync(new URL('../app/api/financial-attachments/route.ts',import.meta.url),'utf8');
 assert.equal((route.match(/organizations!inner\(slug,active\)/g)||[]).length,3);
 assert.equal((route.match(/\.eq\('organizations\.slug','rn-gestao'\)/g)||[]).length,3);
 assert.match(route,/createSignedUrl\(attachment\.storage_path,60\)/);
});
test('new RPCs are inaccessible to anon and authenticated roles',async()=>{
 const db=await fixture();try{
  for(const name of ['authorized_financial_attachment_actor','begin_financial_attachment']){
   const rights=await db.query("SELECT has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') auth FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=$1",[name]);
   assert.equal(rights.rows[0].anon,false,name);assert.equal(rights.rows[0].auth,false,name);
  }
 }finally{await db.close();}
});
