import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync(new URL('../supabase/migrations/20261030120000_financial_support_tenant_keys.sql',import.meta.url),'utf8');
const foundation=readFileSync(new URL('../supabase/migrations/20261029194356_financial_tenant_keys_foundation.sql',import.meta.url),'utf8');
const ORG='11111111-1111-4111-8111-111111111111',OTHER='99999999-9999-4999-8999-999999999999';
const E='22222222-2222-4222-8222-222222222222',B='33333333-3333-4333-8333-333333333333';
const LINK='44444444-4444-4444-8444-444444444444',DENIAL='55555555-5555-4555-8555-555555555555';
const APPEAL='66666666-6666-4666-8666-666666666666',EVENT='77777777-7777-4777-8777-777777777777';
const RECOVERY='88888888-8888-4888-8888-888888888888',CLOSING='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLOSINGEVENT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ASSOCIATE='cccccccc-cccc-4ccc-8ccc-cccccccccccc',EXPENSE='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const tables=['billing_denial_cases','billing_denial_appeals','billing_denial_events','billing_denial_recoveries','billing_monthly_closings','billing_monthly_closing_events','company_associates','company_expenses'];
function helper(name){
 const s=foundation.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$;','i'))?.[0];
 assert.ok(s,'Missing foundation helper '+name);return s;
}
async function fixture(){
 const db=new PGlite();
 await db.exec([
  'CREATE ROLE anon;',
  'CREATE ROLE authenticated;',
  'CREATE ROLE service_role BYPASSRLS;',
  'CREATE TABLE public.organizations(id uuid PRIMARY KEY,slug text,active boolean);',
  'CREATE TABLE public.billing_entities(id uuid PRIMARY KEY,organization_id uuid NOT NULL);',
  'CREATE TABLE public.billing_records(id uuid PRIMARY KEY,organization_id uuid NOT NULL);',
  'CREATE TABLE public.doctors(id text PRIMARY KEY,organization_id uuid NOT NULL);',
  'CREATE TABLE public.billing_doctor_entities(id uuid PRIMARY KEY,organization_id uuid NOT NULL);',
  'CREATE UNIQUE INDEX billing_entities_id_org_unique ON public.billing_entities(id,organization_id);',
  'CREATE UNIQUE INDEX billing_records_id_org_unique ON public.billing_records(id,organization_id);',
  'CREATE UNIQUE INDEX doctors_id_org_unique ON public.doctors(id,organization_id);',
  'CREATE UNIQUE INDEX billing_doctor_entities_id_org_unique ON public.billing_doctor_entities(id,organization_id);',
  'CREATE TABLE public.billing_denial_cases(id uuid PRIMARY KEY,billing_record_id uuid,billing_entity_id uuid);',
  'CREATE TABLE public.billing_denial_appeals(id uuid PRIMARY KEY,denial_id uuid);',
  'CREATE TABLE public.billing_denial_events(id uuid PRIMARY KEY,denial_id uuid);',
  'CREATE TABLE public.billing_denial_recoveries(id uuid PRIMARY KEY,denial_id uuid,appeal_id uuid);',
  'CREATE TABLE public.billing_monthly_closings(id uuid PRIMARY KEY,billing_entity_id uuid);',
  'CREATE TABLE public.billing_monthly_closing_events(event_number bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,id uuid UNIQUE,billing_entity_id uuid);',
  'CREATE TABLE public.company_associates(id uuid PRIMARY KEY,billing_entity_id uuid,doctor_id text);',
  'CREATE TABLE public.company_expenses(id uuid PRIMARY KEY,billing_entity_id uuid,paid_by_associate_id uuid,paid_by_doctor_entity_link_id uuid);'
 ].join('\n'));
 for(const tbl of tables) await db.exec('ALTER TABLE public.'+tbl+' ENABLE ROW LEVEL SECURITY;');
 await db.query("INSERT INTO public.organizations VALUES($1,'rn-gestao',true)",[ORG]);
 await db.query('INSERT INTO public.billing_entities VALUES($1,$2)',[E,ORG]);
 await db.query('INSERT INTO public.billing_records VALUES($1,$2)',[B,ORG]);
 await db.query("INSERT INTO public.doctors VALUES('doc-1',$1)",[ORG]);
 await db.query('INSERT INTO public.billing_doctor_entities VALUES($1,$2)',[LINK,ORG]);
 await db.query('INSERT INTO public.billing_denial_cases VALUES($1,$2,$3)',[DENIAL,B,E]);
 await db.query('INSERT INTO public.billing_denial_appeals VALUES($1,$2)',[APPEAL,DENIAL]);
 await db.query('INSERT INTO public.billing_denial_events VALUES($1,$2)',[EVENT,DENIAL]);
 await db.query('INSERT INTO public.billing_denial_recoveries VALUES($1,$2,$3)',[RECOVERY,DENIAL,APPEAL]);
 await db.query('INSERT INTO public.billing_monthly_closings VALUES($1,$2)',[CLOSING,E]);
 await db.query('INSERT INTO public.billing_monthly_closing_events(id,billing_entity_id) VALUES($1,$2)',[CLOSINGEVENT,E]);
 await db.query("INSERT INTO public.company_associates VALUES($1,$2,'doc-1')",[ASSOCIATE,E]);
 await db.query('INSERT INTO public.company_expenses VALUES($1,$2,$3,$4)',[EXPENSE,E,ASSOCIATE,LINK]);
 await db.exec(helper('rn_finance_single_organization_id'));
 await db.exec(helper('guard_rn_finance_organization'));
 await db.exec(migration);
 return db;
}
test('eight auxiliary tables receive populated NOT NULL keys and keep RLS',async()=>{
 const db=await fixture();try{
  for(const tbl of tables){
   const c=await db.query("SELECT is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='organization_id'",[tbl]);
   assert.equal(c.rows.length,1,tbl);
   assert.equal(c.rows[0].is_nullable,'NO',tbl);
   assert.match(c.rows[0].column_default,/rn_finance_single_organization_id/);
   const data=await db.query('SELECT organization_id FROM public.'+tbl);
   assert.equal(data.rows.length,1,tbl);
   assert.equal(data.rows[0].organization_id,ORG,tbl);
   assert.equal((await db.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',['public.'+tbl])).rows[0].relrowsecurity,true,tbl);
  }
 }finally{await db.close();}
});
test('new glosa, closing and expense records inherit RN Gestão from database',async()=>{
 const db=await fixture();try{
  const denial=await db.query("INSERT INTO public.billing_denial_cases VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',$1,$2,DEFAULT) RETURNING organization_id",[B,E]);
  assert.equal(denial.rows[0].organization_id,ORG);
  const closing=await db.query("INSERT INTO public.billing_monthly_closings(id,billing_entity_id) VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff',$1) RETURNING organization_id",[E]);
  assert.equal(closing.rows[0].organization_id,ORG);
  const expense=await db.query("INSERT INTO public.company_expenses(id,billing_entity_id) VALUES('12121212-1212-4212-8212-121212121212',$1) RETURNING organization_id",[E]);
  assert.equal(expense.rows[0].organization_id,ORG);
 }finally{await db.close();}
});
test('tampering with tenant key or introducing second organization fails closed',async()=>{
 const db=await fixture();try{
  await assert.rejects(db.query('UPDATE public.company_expenses SET organization_id=$1 WHERE id=$2',[OTHER,EXPENSE]),/Registro financeiro fora da organização autorizada/);
  await db.query("INSERT INTO public.organizations VALUES($1,'other-test',true)",[OTHER]);
  await assert.rejects(db.query("INSERT INTO public.billing_denial_events(id,denial_id) VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',$1)",[DENIAL]),/Organização de operação inválida/);
  await assert.rejects(db.query('UPDATE public.billing_monthly_closings SET billing_entity_id=$1 WHERE id=$2',[E,CLOSING]),/Organização de operação inválida/);
 }finally{await db.close();}
});
test('composite FKs block cross-tenant denial/appeal links even with the transition guard disabled',async()=>{
 const db=await fixture();try{
  await db.query("INSERT INTO public.organizations VALUES($1,'other-test',true)",[OTHER]);
  const otherRecord='13131313-1313-4313-8313-131313131313';
  await db.query('INSERT INTO public.billing_records VALUES($1,$2)',[otherRecord,OTHER]);
  await db.exec('ALTER TABLE public.billing_denial_cases DISABLE TRIGGER guard_rn_finance_organization');
  await db.exec('ALTER TABLE public.billing_denial_appeals DISABLE TRIGGER guard_rn_finance_organization');
  await assert.rejects(
   db.query("INSERT INTO public.billing_denial_cases(id,billing_record_id,billing_entity_id,organization_id) VALUES('14141414-1414-4414-8414-141414141414',$1,$2,$3)",[otherRecord,E,ORG]),
   /foreign key constraint|violates foreign key/i);
  const otherDenial='15151515-1515-4515-8515-151515151515';
  const otherEntity='16161616-1616-4616-8616-161616161616';
  await db.query('INSERT INTO public.billing_entities VALUES($1,$2)',[otherEntity,OTHER]);
  await db.query('INSERT INTO public.billing_denial_cases(id,billing_record_id,billing_entity_id,organization_id) VALUES($1,$2,$3,$4)',[otherDenial,otherRecord,otherEntity,OTHER]);
  await assert.rejects(
   db.query("INSERT INTO public.billing_denial_appeals(id,denial_id,organization_id) VALUES('17171717-1717-4717-8717-171717171717',$1,$2)",[otherDenial,ORG]),
   /foreign key constraint|violates foreign key/i);
 }finally{await db.close();}
});
test('expense cannot reference an associate belonging to another organization',async()=>{
 const db=await fixture();try{
  await db.query("INSERT INTO public.organizations VALUES($1,'other-test',true)",[OTHER]);
  const foreignAssociate='18181818-1818-4818-8818-181818181818';
  await db.exec('ALTER TABLE public.company_associates DISABLE TRIGGER guard_rn_finance_organization');
  await db.exec('ALTER TABLE public.company_expenses DISABLE TRIGGER guard_rn_finance_organization');
  const otherEntity='19191919-1919-4919-8919-191919191919';
  await db.query('INSERT INTO public.billing_entities VALUES($1,$2)',[otherEntity,OTHER]);
  await db.query('INSERT INTO public.company_associates(id,billing_entity_id,organization_id) VALUES($1,$2,$3)',[foreignAssociate,otherEntity,OTHER]);
  await assert.rejects(
   db.query("INSERT INTO public.company_expenses(id,billing_entity_id,paid_by_associate_id,organization_id) VALUES('20202020-2020-4020-8020-202020202020',$1,$2,$3)",[E,foreignAssociate,ORG]),
   /foreign key constraint|violates foreign key/i);
 }finally{await db.close();}
});
test('all 13 tenant links are valid; financial entities remain hidden from public roles',async()=>{
 const db=await fixture();try{
  const links=await db.query("SELECT count(*)::int AS total FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname LIKE 'org_link_%' AND convalidated");
  assert.equal(links.rows[0].total,13);
  const triggers=await db.query("SELECT count(*)::int AS total FROM pg_trigger WHERE tgname='guard_rn_finance_organization'");
  assert.equal(triggers.rows[0].total,8);
  for(const tbl of tables){
   const perms=await db.query("SELECT has_table_privilege('anon',$1,'SELECT') AS anon,has_table_privilege('authenticated',$1,'SELECT') AS auth",['public.'+tbl]);
   assert.equal(perms.rows[0].anon,false,tbl);
   assert.equal(perms.rows[0].auth,false,tbl);
  }
 }finally{await db.close();}
});
test('migration keeps historical rows intact and forbids onboarding a second tenant',()=>{
 assert.match(migration,/sole operating organization/);
 assert.match(migration,/DEFAULT backfills test rows without UPDATE/);
 assert.equal((migration.match(/\('billing_denial_(?:cases|appeals|events|recoveries)'|\('billing_monthly_closings'|\('billing_monthly_closing_events'|\('company_(?:associates|expenses)'/g)||[]).length,13);
 assert.doesNotMatch(migration,/\bTRUNCATE\b|\bDELETE FROM\b/i);
});
