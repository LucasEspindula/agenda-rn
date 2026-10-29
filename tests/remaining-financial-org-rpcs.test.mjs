import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync(new URL('../supabase/migrations/20261029215500_financial_five_legacy_rpc_org_scope.sql',import.meta.url),'utf8');
const accessMigration=readFileSync(new URL('../supabase/migrations/20261029192723_legacy_agenda_directory_org_scope.sql',import.meta.url),'utf8');
const ORG='11111111-1111-4111-8111-111111111111';
const OTHER='99999999-9999-4999-8999-999999999999';
const ENTITY='22222222-2222-4222-8222-222222222222';
const functions=['save_professional_charge','save_professional_charge_core','save_billing_legacy_single_charge','save_billing_fiscal_core','preview_billing_month'];

function helper(name) {
 const match=accessMigration.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$;','i'));
 assert.ok(match,'Missing guard function '+name);
 return match[0];
}

async function fixture(){
 const db=new PGlite();
 await db.exec([
  'CREATE ROLE anon;','CREATE ROLE authenticated;','CREATE ROLE service_role BYPASSRLS;',
  'CREATE TABLE public.organizations(id uuid PRIMARY KEY,slug text,active boolean);',
  'CREATE TABLE public.users(id bigint PRIMARY KEY,role text,active boolean);',
  'CREATE TABLE public.organization_memberships(user_id bigint,organization_id uuid,role text,active boolean);',
  'CREATE TABLE public.app_state(id int PRIMARY KEY,organization_id uuid,payload jsonb);',
  'CREATE TABLE public.billing_records(id uuid PRIMARY KEY);',
  'CREATE TABLE public.invoices(id uuid PRIMARY KEY);',
  'CREATE TABLE public.attendances(id text PRIMARY KEY);',
  'CREATE TABLE public.invoice_requests(id uuid PRIMARY KEY);',
  'CREATE TABLE public.billing_entities(id uuid PRIMARY KEY,organization_id uuid);',
  'CREATE TABLE public.doctors(id text PRIMARY KEY);'
 ].join('\n'));
 await db.query("INSERT INTO public.organizations VALUES($1,'rn-gestao',true)",[ORG]);
 await db.exec("INSERT INTO public.users VALUES(1,'general_manager',true),(2,'secretary',true),(3,'general_manager',false)");
 for(const [id,role,active] of [[1,'general_manager',true],[2,'secretary',true],[3,'general_manager',false]])
  await db.query('INSERT INTO public.organization_memberships VALUES($1,$2,$3,$4)',[id,ORG,role,active]);
 await db.query("INSERT INTO public.app_state VALUES(1,$1,$2::jsonb)",[ORG,JSON.stringify({appointments:[],patients:[]})]);
 await db.query('INSERT INTO public.billing_entities VALUES($1,$2)',[ENTITY,ORG]);
 await db.exec(helper('require_rn_agenda_actor_organization'));
 await db.exec(migration);
 return db;
}

const invocations=[
 ['save_professional_charge','SELECT public.save_professional_charge($1,$2::jsonb)',[null,'{}']],
 ['save_professional_charge_core','SELECT public.save_professional_charge_core($1,$2::jsonb)',[null,'{}']],
 ['save_billing_legacy_single_charge',"SELECT public.save_billing_legacy_single_charge($1,'record',$2::jsonb)",[null,'{}']],
 ['save_billing_fiscal_core',"SELECT public.save_billing_fiscal_core($1,'record',$2::jsonb)",[null,'{}']],
 ['preview_billing_month','SELECT public.preview_billing_month($1,$2::uuid,$3)',[null,ENTITY,'2026-10']]
];

test('all five finance entrypoints reject inactive actor before any mutation',async()=>{
 const db=await fixture();try{
  for(const [name,q,params] of invocations){
   const args=[...params];args[0]=3;
   await assert.rejects(db.query(q,args),/Acesso à organização negado/,name);
  }
 }finally{await db.close();}
});

test('revoked organization membership blocks both billing and monthly report',async()=>{
 const db=await fixture();try{
  await db.exec('UPDATE public.organization_memberships SET active=false WHERE user_id=1');
  for(const [name,q,params] of invocations){
   const args=[...params];args[0]=1;
   await assert.rejects(db.query(q,args),/Acesso à organização negado/,name);
  }
 }finally{await db.close();}
});

test('creating second organization blocks financial functions even for valid manager',async()=>{
 const db=await fixture();try{
  await db.query("INSERT INTO public.organizations VALUES($1,'other-clinic',true)",[OTHER]);
  for(const [name,q,params] of invocations){
   const args=[...params];args[0]=1;
   await assert.rejects(db.query(q,args),/Organização de operação inválida/,name);
  }
 }finally{await db.close();}
});

test('monthly billing rejects nonexistent entity in an otherwise valid organization',async()=>{
 const db=await fixture();try{
  await assert.rejects(
   db.query("SELECT public.preview_billing_month(1,$1::uuid,'2026-10')",['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']),
   /Entidade recebedora não encontrada/
  );
 }finally{await db.close();}
});

test('SQL removes every explicit legacy singleton state lookup',()=>{
 assert.equal((migration.match(/CREATE OR REPLACE FUNCTION public\./g)||[]).length,5);
 for(const fn of functions){
  const body=migration.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+fn+'\\([\\s\\S]*?\\$function\\$;','i'))?.[0];
  assert.ok(body,fn);
  assert.match(body,/rn_org_id:=public.require_rn_agenda_actor_organization\(p_actor\)/,fn);
  assert.match(body,/organization_id=rn_org_id/,fn);
  assert.match(migration,new RegExp('REVOKE ALL ON FUNCTION public\\.'+fn+'\\('),fn);
  assert.match(migration,new RegExp('GRANT EXECUTE ON FUNCTION public\\.'+fn+'\\('),fn);
  assert.doesNotMatch(body,/SECURITY DEFINER/i,fn);
 }
 assert.doesNotMatch(migration,/\bwhere\s+(?:s[.]|st[.])?id\s*=\s*1\b/i);
 assert.match(migration,/st\.organization_id=rn_org_id/);
 assert.match(migration,/s\.organization_id=rn_org_id/);
 assert.match(migration,/from public\.billing_entities where id=p_entity and organization_id=rn_org_id/);
});

test('stored SQL is inaccessible to anon and authenticated',async()=>{
 const db=await fixture();try{
  for(const fn of functions){
   const result=await db.query("SELECT has_function_privilege('anon',oid,'EXECUTE') AS anon,has_function_privilege('authenticated',oid,'EXECUTE') AS auth FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1",[fn]);
   assert.equal(result.rows[0].anon,false,fn);assert.equal(result.rows[0].auth,false,fn);
  }
 }finally{await db.close();}
});
