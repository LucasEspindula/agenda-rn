import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261029194356_financial_tenant_keys_foundation.sql', import.meta.url), 'utf8');
const tables = ['doctors','billing_entities','billing_doctor_entities','attendances','billing_records','invoices','invoice_billing_records','invoice_requests','financial_attachments'];
const ids = {
  org:'11111111-1111-4111-8111-111111111111',other:'99999999-9999-4999-8999-999999999999',
  entity:'22222222-2222-4222-8222-222222222222',record:'33333333-3333-4333-8333-333333333333',
  invoice:'44444444-4444-4444-8444-444444444444',link:'55555555-5555-4555-8555-555555555555',
  request:'66666666-6666-4666-8666-666666666666',attachment:'77777777-7777-4777-8777-777777777777'
};
async function fixture(){
 const db=new PGlite();
 await db.exec([
  'CREATE ROLE anon;','CREATE ROLE authenticated;','CREATE ROLE service_role BYPASSRLS;',
  'CREATE TABLE public.organizations(id uuid PRIMARY KEY,slug text NOT NULL,active boolean NOT NULL);',
  'CREATE TABLE public.doctors(id text PRIMARY KEY);',
  'CREATE TABLE public.billing_entities(id uuid PRIMARY KEY);',
  'CREATE TABLE public.billing_doctor_entities(id uuid PRIMARY KEY,doctor_id text,billing_entity_id uuid);',
  'CREATE TABLE public.attendances(id text PRIMARY KEY,doctor_id text,billing_entity_id uuid);',
  'CREATE TABLE public.billing_records(id uuid PRIMARY KEY,billing_entity_id uuid,attendance_id text,professional_id text);',
  'CREATE TABLE public.invoices(id uuid PRIMARY KEY,billing_entity_id uuid,replaced_by_invoice_id uuid);',
  'CREATE TABLE public.invoice_billing_records(id uuid PRIMARY KEY,invoice_id uuid,billing_record_id uuid);',
  'CREATE TABLE public.invoice_requests(id uuid PRIMARY KEY,attendance_id text,billing_record_id uuid,billing_entity_id uuid,doctor_id text,invoice_id uuid);',
  'CREATE TABLE public.financial_attachments(id uuid PRIMARY KEY,invoice_id uuid,billing_record_id uuid,replaces_attachment_id uuid,replaced_by_attachment_id uuid);'
 ].join('\n'));
 for(const t of tables) await db.exec('ALTER TABLE public.'+t+' ENABLE ROW LEVEL SECURITY;');
 await db.query("INSERT INTO public.organizations VALUES ($1,'rn-gestao',true)",[ids.org]);
 await db.exec("INSERT INTO public.doctors VALUES ('dr-1')");
 await db.query('INSERT INTO public.billing_entities VALUES ($1)',[ids.entity]);
 await db.query('INSERT INTO public.billing_doctor_entities VALUES ($1,$2,$3)',[ids.link,'dr-1',ids.entity]);
 await db.query("INSERT INTO public.attendances VALUES ('attendance-1','dr-1',$1)",[ids.entity]);
 await db.query('INSERT INTO public.billing_records VALUES ($1,$2,$3,$4)',[ids.record,ids.entity,'attendance-1','dr-1']);
 await db.query('INSERT INTO public.invoices VALUES ($1,$2,NULL)',[ids.invoice,ids.entity]);
 await db.query('INSERT INTO public.invoice_billing_records VALUES ($1,$2,$3)',[ids.link,ids.invoice,ids.record]);
 await db.query('INSERT INTO public.invoice_requests VALUES ($1,$2,$3,$4,$5,$6)',[ids.request,'attendance-1',ids.record,ids.entity,'dr-1',ids.invoice]);
 await db.query('INSERT INTO public.financial_attachments VALUES ($1,$2,$3,NULL,NULL)',[ids.attachment,ids.invoice,ids.record]);
 await db.exec(migration);
 return db;
}
test('nine core financial tables are scoped and existing test rows are backfilled',async()=>{
 const db=await fixture();try{
  for(const t of tables){
   const c=await db.query("SELECT is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='organization_id'",[t]);
   assert.equal(c.rows.length,1,t);assert.equal(c.rows[0].is_nullable,'NO',t);
   assert.match(c.rows[0].column_default,/rn_finance_single_organization_id/);
   const s=await db.query('SELECT organization_id FROM public.'+t);
   assert.ok(s.rows.length,t);
   for(const r of s.rows)assert.equal(r.organization_id,ids.org,t);
   assert.equal((await db.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',['public.'+t])).rows[0].relrowsecurity,true,t);
  }
 }finally{await db.close();}
});
test('default inserts are assigned to RN Gestão server-side',async()=>{
 const db=await fixture();try{
  const r=await db.query("INSERT INTO public.doctors(id) VALUES ('dr-2') RETURNING organization_id");
  assert.equal(r.rows[0].organization_id,ids.org);
  const e=await db.query("INSERT INTO public.billing_entities(id) VALUES ('88888888-8888-4888-8888-888888888888') RETURNING organization_id");
  assert.equal(e.rows[0].organization_id,ids.org);
 }finally{await db.close();}
});
test('second organization blocks all finance inserts and updates',async()=>{
 const db=await fixture();try{
  await db.query("INSERT INTO public.organizations VALUES ($1,'other-test',true)",[ids.other]);
  await assert.rejects(db.query("INSERT INTO public.doctors(id) VALUES ('dr-2')"),/Organização de operação inválida/);
  await assert.rejects(db.query("UPDATE public.doctors SET id='dr-1' WHERE id='dr-1'"),/Organização de operação inválida/);
  await assert.rejects(db.query("INSERT INTO public.billing_entities(id,organization_id) VALUES ('88888888-8888-4888-8888-888888888888',$1)",[ids.other]),/Organização de operação inválida/);
 }finally{await db.close();}
});
test('existing rows cannot be transferred to a forged organization',async()=>{
 const db=await fixture();try{
  await assert.rejects(db.query('UPDATE public.doctors SET organization_id=$1 WHERE id=$2',[ids.other,'dr-1']),/Registro financeiro fora da organização autorizada/);
  await assert.rejects(db.query('UPDATE public.invoices SET organization_id=$1 WHERE id=$2',[ids.other,ids.invoice]),/Registro financeiro fora da organização autorizada/);
 }finally{await db.close();}
});
test('composite FKs prevent a cross-org entity reference independent of singleton guards',async()=>{
 const db=await fixture();try{
  await db.query("INSERT INTO public.organizations VALUES ($1,'other-test',true)",[ids.other]);
  // Only inside this isolated fixture, disable guards to exercise the FK itself.
  await db.exec('ALTER TABLE public.billing_entities DISABLE TRIGGER guard_rn_finance_organization');
  await db.exec('ALTER TABLE public.attendances DISABLE TRIGGER guard_rn_finance_organization');
  const otherEntity='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await db.query('INSERT INTO public.billing_entities(id,organization_id) VALUES ($1,$2)',[otherEntity,ids.other]);
  await assert.rejects(
   db.query('INSERT INTO public.attendances(id,doctor_id,billing_entity_id,organization_id) VALUES ($1,$2,$3,$4)',['cross-org','dr-1',otherEntity,ids.org]),
   /foreign key constraint|violates foreign key/i
  );
 }finally{await db.close();}
});
test('invoice-item composite foreign key preserves cascade deletes',async()=>{
 const db=await fixture();try{
  await db.query('DELETE FROM public.invoice_requests WHERE id=$1',[ids.request]);
  await db.query('DELETE FROM public.financial_attachments WHERE id=$1',[ids.attachment]);
  await db.query('DELETE FROM public.invoices WHERE id=$1',[ids.invoice]);
  assert.equal((await db.query('SELECT count(*)::int AS total FROM public.invoice_billing_records')).rows[0].total,0);
 }finally{await db.close();}
});
test('migration declares twenty organization-scoped relationships and blocks second org',()=>{
 assert.equal((migration.match(/\('(?:billing_doctor_entities|attendances|billing_records|invoices|invoice_billing_records|invoice_requests|financial_attachments)',/g)||[]).length,20);
 assert.match(migration,/ANY second organization appears/);
 assert.match(migration,/Does NOT open multi-company operation/);
 assert.match(migration,/ON DELETE CASCADE/);
});
