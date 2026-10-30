import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync(new URL('../supabase/migrations/20261030150000_monthly_close_portal_rules_org_scope.sql',import.meta.url),'utf8');
const finance=readFileSync(new URL('../supabase/migrations/20261029194356_financial_tenant_keys_foundation.sql',import.meta.url),'utf8');
const access=readFileSync(new URL('../supabase/migrations/20261029192723_legacy_agenda_directory_org_scope.sql',import.meta.url),'utf8');
const ORG='11111111-1111-4111-8111-111111111111';
const OTHER='99999999-9999-4999-8999-999999999999';
const ENTITY='22222222-2222-4222-8222-222222222222';
const FOREIGN='33333333-3333-4333-8333-333333333333';
const MONTH='2026-09';
function helper(src,name){
 const f=src.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$;','i'))?.[0];
 assert.ok(f,'Missing required server function '+name);return f;
}
async function fixture(){
 const db=new PGlite();
 await db.exec([
  'CREATE ROLE anon;',
  'CREATE ROLE authenticated;',
  'CREATE ROLE service_role BYPASSRLS;',
  'CREATE TABLE public.organizations(id uuid PRIMARY KEY,slug text,active boolean);',
  'CREATE TABLE public.users(id bigint PRIMARY KEY,role text,active boolean);',
  'CREATE TABLE public.organization_memberships(user_id bigint,organization_id uuid,role text,active boolean);',
  'CREATE TABLE public.app_state(id int PRIMARY KEY,organization_id uuid,payload jsonb);',
  'CREATE TABLE public.billing_entities(id uuid PRIMARY KEY,organization_id uuid);',
  'CREATE TABLE public.doctors(id text PRIMARY KEY,organization_id uuid,active boolean DEFAULT true);',
  'CREATE TABLE public.billing_monthly_closings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,billing_entity_id uuid,competence_month date,snapshot jsonb,snapshot_checksum text,notes text,closed_at timestamptz DEFAULT now(),closed_by bigint);',
  'CREATE TABLE public.billing_monthly_closing_events(event_number bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,id uuid UNIQUE DEFAULT gen_random_uuid(),organization_id uuid,billing_entity_id uuid,competence_month date,event_type text,snapshot jsonb,snapshot_checksum text,notes text,created_at timestamptz DEFAULT now(),actor_id bigint);',
  'CREATE TABLE public.billing_portal_deadline_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),destination_key text,submission_channel_code text,professional_id text,starts_from text,days_kind text DEFAULT \'CALENDAR\',deadline_days int,alert_before_days int,valid_from date,valid_to date,active boolean DEFAULT true,created_at timestamptz DEFAULT now(),created_by bigint);',
  'CREATE UNIQUE INDEX doctors_id_org_unique ON public.doctors(id,organization_id);',
  'CREATE UNIQUE INDEX billing_entities_id_org_unique ON public.billing_entities(id,organization_id);'
 ].join('\n'));
 await db.exec('ALTER TABLE public.billing_portal_deadline_rules ENABLE ROW LEVEL SECURITY;');
 await db.query("INSERT INTO public.organizations VALUES($1,'rn-gestao',true)",[ORG]);
 await db.exec("INSERT INTO public.users VALUES(1,'general_manager',true),(2,'secretary',true),(3,'general_manager',false)");
 for(const [id,role,active] of [[1,'general_manager',true],[2,'secretary',true],[3,'general_manager',false]])
  await db.query('INSERT INTO public.organization_memberships VALUES($1,$2,$3,$4)',[id,ORG,role,active]);
 await db.query("INSERT INTO public.app_state VALUES(1,$1,'{}'::jsonb)",[ORG]);
 await db.query('INSERT INTO public.billing_entities VALUES($1,$2)',[ENTITY,ORG]);
 await db.query("INSERT INTO public.billing_entities VALUES($1,$2)",[FOREIGN,OTHER]);
 await db.query("INSERT INTO public.doctors VALUES('dr-1',$1,true)",[ORG]);
 await db.query("INSERT INTO public.doctors VALUES('dr-foreign',$1,true)",[OTHER]);
 await db.exec(helper(finance,'rn_finance_single_organization_id'));
 await db.exec(helper(finance,'guard_rn_finance_organization'));
 await db.exec(helper(access,'require_rn_agenda_actor_organization'));
 await db.exec("CREATE FUNCTION public.preview_billing_month(bigint,uuid,text) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('entity',jsonb_build_object('id',$2),'cash',jsonb_build_object('insurance_paid_invoices_without_net',0),'issued_invoices',jsonb_build_object('without_net_amount',0)) $$;");
 await db.exec(migration);
 return db;
}
const GET=(db,actor=1,entity=ENTITY)=>db.query('SELECT public.get_billing_month_closing($1,$2::uuid,$3) AS data',[actor,entity,MONTH]);
const CLOSE=(db,actor=1,entity=ENTITY)=>db.query("SELECT public.close_billing_month($1,$2::uuid,$3,'Fechamento de teste') AS id",[actor,entity,MONTH]);
const UNLOCK=(db,actor=1,entity=ENTITY)=>db.query("SELECT public.unlock_billing_month($1,$2::uuid,$3,'Correção de teste') AS id",[actor,entity,MONTH]);
const RULE=(db,actor=1,doctor='dr-1')=>db.query('SELECT public.save_billing_portal_rule($1,$2::jsonb) AS id',[actor,JSON.stringify({destination_key:'UNIMED',submission_channel_code:'PORTAL_CONVENIO',professional_id:doctor,starts_from:'SERVICE_DATE',deadline_days:30,alert_before_days:5,valid_from:'2026-08-01'})]);

test('monthly closing, unlock and re-close preserve historical snapshots and organization',async()=>{
 const db=await fixture();try{
  assert.equal((await GET(db)).rows[0].data.closed,false);
  const first=(await CLOSE(db)).rows[0].id;assert.ok(first);
  const closed=(await GET(db)).rows[0].data;assert.equal(closed.closed,true);assert.equal(closed.history.length,1);
  await assert.rejects(CLOSE(db),/Competência bloqueada/);
  const unlocked=(await UNLOCK(db)).rows[0].id;assert.ok(unlocked);
  assert.equal((await GET(db)).rows[0].data.closed,false);
  const second=(await CLOSE(db)).rows[0].id;assert.ok(second);
  assert.equal((await GET(db)).rows[0].data.history.length,3);
  for(const table of ['billing_monthly_closings','billing_monthly_closing_events']){
   const rows=await db.query('SELECT organization_id FROM public.'+table);
   assert.ok(rows.rows.length);assert.ok(rows.rows.every(x=>x.organization_id===ORG));
  }
 }finally{await db.close();}
});
test('closing endpoints reject inactive actors, revoked memberships and secretaries',async()=>{
 const db=await fixture();try{
  for(const op of [GET,CLOSE,UNLOCK]){
   await assert.rejects(op(db,3),/Acesso à organização negado/);
   await assert.rejects(op(db,2),/Somente|gerência/);
  }
  await db.exec('UPDATE public.organization_memberships SET active=false WHERE user_id=1');
  for(const op of [GET,CLOSE,UNLOCK])await assert.rejects(op(db,1),/Acesso à organização negado/);
 }finally{await db.close();}
});
test('monthly closing rejects foreign receiving entity even with single RN Gestão organization',async()=>{
 const db=await fixture();try{
  for(const op of [GET,CLOSE,UNLOCK])await assert.rejects(op(db,1,FOREIGN),/Entidade recebedora não encontrada na organização/);
 }finally{await db.close();}
});
test('portal deadline rule receives organization key, validates doctor and prevents overlap',async()=>{
 const db=await fixture();try{
  const id=(await RULE(db)).rows[0].id;assert.ok(id);
  const row=await db.query('SELECT organization_id,professional_id FROM public.billing_portal_deadline_rules WHERE id=$1',[id]);
  assert.equal(row.rows[0].organization_id,ORG);assert.equal(row.rows[0].professional_id,'dr-1');
  await assert.rejects(RULE(db),/regra sobreposta/);
  await assert.rejects(RULE(db,1,'dr-foreign'),/Profissional inexistente/);
  await assert.rejects(RULE(db,2),/Somente a gerência/);
 }finally{await db.close();}
});
test('new organization or compromised membership fails closed for closing and rules',async()=>{
 const db=await fixture();try{
  await db.query("INSERT INTO public.organizations VALUES($1,'other-test',true)",[OTHER]);
  for(const op of [GET,CLOSE,UNLOCK,RULE])await assert.rejects(op(db),/Organização de operação inválida/);
 }finally{await db.close();}
});
test('portal rules cannot be forged into another organization through direct table mutation',async()=>{
 const db=await fixture();try{
  const id=(await RULE(db)).rows[0].id;
  await assert.rejects(db.query('UPDATE public.billing_portal_deadline_rules SET organization_id=$1 WHERE id=$2',[OTHER,id]),/Registro financeiro fora da organização autorizada/);
  assert.equal((await db.query('SELECT organization_id FROM public.billing_portal_deadline_rules WHERE id=$1',[id])).rows[0].organization_id,ORG);
 }finally{await db.close();}
});
test('new RPCs remain inaccessible to anon and authenticated',async()=>{
 const db=await fixture();try{
  for(const name of ['get_billing_month_closing','close_billing_month','unlock_billing_month','save_billing_portal_rule']){
   const permissions=await db.query("SELECT has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') auth FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1",[name]);
   assert.equal(permissions.rows[0].anon,false,name);assert.equal(permissions.rows[0].auth,false,name);
  }
 }finally{await db.close();}
});
test('privileged closing, print and portal rule APIs require server organization gate',()=>{
 const close=readFileSync(new URL('../app/api/billing/closing/route.ts',import.meta.url),'utf8');
 const print=readFileSync(new URL('../app/api/reports/monthly-closing/print/route.ts',import.meta.url),'utf8');
 const portal=readFileSync(new URL('../app/api/billing/portal/route.ts',import.meta.url),'utf8');
 assert.equal((close.match(/financialActorOrganizationId\(session\.account\.id\)/g)||[]).length,2);
 assert.match(close,/\.eq\("organization_id",organizationId\)/);
 assert.match(print,/financialActorOrganizationId\(session\.account\.id\)/);
 assert.match(portal,/allRows\("billing_portal_deadline_rules",organizationId\)/);
 assert.doesNotMatch(portal,/organizationId\?:string/);
});
