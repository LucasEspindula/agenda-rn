import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration=readFileSync(new URL('../supabase/migrations/20261029214500_finance_auxiliary_tenant_keys.sql',import.meta.url),'utf8');
const foundation=readFileSync(new URL('../supabase/migrations/20261029194356_financial_tenant_keys_foundation.sql',import.meta.url),'utf8');

const ORG='11111111-1111-4111-8111-111111111111';
const OTHER='99999999-9999-4999-8999-999999999999';
const RECORD='22222222-2222-4222-8222-222222222222';
const INVOICE='33333333-3333-4333-8333-333333333333';
const PART='44444444-4444-4444-8444-444444444444';
const SUBMISSION='55555555-5555-4555-8555-555555555555';
const EVENT='66666666-6666-4666-8666-666666666666';
const tables=['payment_parts','billing_portal_submissions','billing_portal_submission_events'];

function helper(name){
 const f=foundation.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$;','i'))?.[0];
 assert.ok(f,'Missing core tenant guard '+name);return f;
}
async function fixture(){
 const db=new PGlite();
 await db.exec([
  'CREATE ROLE anon;',
  'CREATE ROLE authenticated;',
  'CREATE ROLE service_role BYPASSRLS;',
  'CREATE TABLE public.organizations(id uuid PRIMARY KEY,slug text,active boolean);',
  'CREATE TABLE public.billing_records(id uuid PRIMARY KEY,organization_id uuid NOT NULL);',
  'CREATE TABLE public.invoices(id uuid PRIMARY KEY,organization_id uuid NOT NULL);',
  'CREATE UNIQUE INDEX billing_records_id_org_unique ON public.billing_records(id,organization_id);',
  'CREATE UNIQUE INDEX invoices_id_org_unique ON public.invoices(id,organization_id);',
  'CREATE TABLE public.payment_parts(id uuid PRIMARY KEY,billing_record_id uuid,invoice_id uuid,method text);',
  'CREATE TABLE public.billing_portal_submissions(id uuid PRIMARY KEY,billing_record_id uuid NOT NULL,status text);',
  'CREATE TABLE public.billing_portal_submission_events(id uuid PRIMARY KEY,submission_id uuid NOT NULL,event_type text);'
 ].join('\n'));
 for(const table of tables)await db.exec('ALTER TABLE public.'+table+' ENABLE ROW LEVEL SECURITY');
 await db.query("INSERT INTO public.organizations VALUES($1,'rn-gestao',true)",[ORG]);
 await db.query('INSERT INTO public.billing_records VALUES($1,$2)',[RECORD,ORG]);
 await db.query('INSERT INTO public.invoices VALUES($1,$2)',[INVOICE,ORG]);
 await db.query("INSERT INTO public.payment_parts VALUES($1,$2,null,'PIX')",[PART,RECORD]);
 await db.query("INSERT INTO public.billing_portal_submissions VALUES($1,$2,'PENDING')",[SUBMISSION,RECORD]);
 await db.query("INSERT INTO public.billing_portal_submission_events VALUES($1,$2,'CREATED')",[EVENT,SUBMISSION]);
 await db.exec(helper('rn_finance_single_organization_id'));
 await db.exec(helper('guard_rn_finance_organization'));
 await db.exec(migration);
 return db;
}

test('three auxiliary tables are backfilled, required, and retain RLS',async()=>{
 const db=await fixture();try{
  for(const table of tables){
   const cols=await db.query("SELECT is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='organization_id'",[table]);
   assert.equal(cols.rows.length,1,table);
   assert.equal(cols.rows[0].is_nullable,'NO',table);
   assert.match(cols.rows[0].column_default,/rn_finance_single_organization_id/);
   const rows=await db.query('SELECT organization_id FROM public.'+table);
   assert.equal(rows.rows.length,1,table);
   assert.equal(rows.rows[0].organization_id,ORG,table);
   const rls=await db.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',['public.'+table]);
   assert.equal(rls.rows[0].relrowsecurity,true,table);
  }
 }finally{await db.close();}
});

test('new payment and portal records inherit organization without client-supplied tenant',async()=>{
 const db=await fixture();try{
  const p=await db.query("INSERT INTO public.payment_parts(id,billing_record_id,method) VALUES('77777777-7777-4777-8777-777777777777',$1,'CREDIT_CARD') RETURNING organization_id",[RECORD]);
  assert.equal(p.rows[0].organization_id,ORG);
  const e=await db.query("INSERT INTO public.billing_portal_submission_events(id,submission_id,event_type) VALUES('88888888-8888-4888-8888-888888888888',$1,'UPDATED') RETURNING organization_id",[SUBMISSION]);
  assert.equal(e.rows[0].organization_id,ORG);
 }finally{await db.close();}
});

test('second organization or forged organization blocks auxiliary writes',async()=>{
 const db=await fixture();try{
  await assert.rejects(db.query('UPDATE public.payment_parts SET organization_id=$1 WHERE id=$2',[OTHER,PART]),/Registro financeiro fora da organização autorizada/);
  await db.query("INSERT INTO public.organizations VALUES($1,'other-test',true)",[OTHER]);
  await assert.rejects(db.query("INSERT INTO public.payment_parts(id,billing_record_id) VALUES('77777777-7777-4777-8777-777777777777',$1)",[RECORD]),/Organização de operação inválida/);
  await assert.rejects(db.query("UPDATE public.billing_portal_submissions SET status='SUBMITTED' WHERE id=$1",[SUBMISSION]),/Organização de operação inválida/);
 }finally{await db.close();}
});

test('composite FKs independently prevent cross-organization payment and portal links',async()=>{
 const db=await fixture();try{
  await db.query("INSERT INTO public.organizations VALUES($1,'other-test',true)",[OTHER]);
  const foreignRecord='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const foreignSubmission='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await db.query('INSERT INTO public.billing_records(id,organization_id) VALUES($1,$2)',[foreignRecord,OTHER]);
  // Isolated fixture only: exercise FK in isolation from transitional single-tenant guard.
  await db.exec('ALTER TABLE public.payment_parts DISABLE TRIGGER guard_rn_finance_organization');
  await db.exec('ALTER TABLE public.billing_portal_submissions DISABLE TRIGGER guard_rn_finance_organization');
  await db.exec('ALTER TABLE public.billing_portal_submission_events DISABLE TRIGGER guard_rn_finance_organization');
  await assert.rejects(
   db.query('INSERT INTO public.payment_parts(id,billing_record_id,organization_id) VALUES($1,$2,$3)',['cccccccc-cccc-4ccc-8ccc-cccccccccccc',foreignRecord,ORG]),
   /foreign key constraint|violates foreign key/i);
  await db.query("INSERT INTO public.billing_portal_submissions VALUES($1,$2,'PENDING',$3)",[foreignSubmission,foreignRecord,OTHER]);
  await assert.rejects(
   db.query("INSERT INTO public.billing_portal_submission_events(id,submission_id,event_type,organization_id) VALUES($1,$2,'UPDATE',$3)",['dddddddd-dddd-4ddd-8ddd-dddddddddddd',foreignSubmission,ORG]),
   /foreign key constraint|violates foreign key/i);
 }finally{await db.close();}
});

test('migration has three immutable organization associations and four scoped FKs',()=>{
 assert.match(migration,/ADD COLUMN organization_id uuid NOT NULL DEFAULT public\.rn_finance_single_organization_id\(\)/);
 assert.equal((migration.match(/ADD CONSTRAINT org_link_/g)||[]).length,4);
 assert.match(migration,/guard_rn_finance_organization/);
 assert.match(migration,/sole operating organization/);
});

test('no direct public reads of auxiliary payment data',async()=>{
 const db=await fixture();try{
  for(const table of tables){
   const perms=await db.query("SELECT has_table_privilege('anon',$1,'SELECT') AS anon,has_table_privilege('authenticated',$1,'SELECT') AS auth",['public.'+table]);
   assert.equal(perms.rows[0].anon,false,table);
   assert.equal(perms.rows[0].auth,false,table);
  }
 }finally{await db.close();}
});
