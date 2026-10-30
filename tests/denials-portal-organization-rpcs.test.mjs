import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const sql=readFileSync(new URL('../supabase/migrations/20261030115731_denial_portal_org_rpc_scope.sql',import.meta.url),'utf8');
const membership=readFileSync(new URL('../supabase/migrations/20261029192723_legacy_agenda_directory_org_scope.sql',import.meta.url),'utf8');
const ORG='11111111-1111-4111-8111-111111111111';
const OTHER='99999999-9999-4999-8999-999999999999';
const RECORD='22222222-2222-4222-8222-222222222222';
const ENTITY='33333333-3333-4333-8333-333333333333';
function extract(text,name){
 const result=text.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$;','i'))?.[0];
 assert.ok(result,'Missing source function '+name);return result;
}
async function fixture(){
 const db=new PGlite();
 await db.exec([
  'CREATE ROLE anon;', 'CREATE ROLE authenticated;', 'CREATE ROLE service_role BYPASSRLS;',
  'CREATE TABLE public.organizations(id uuid PRIMARY KEY,slug text,active boolean);',
  'CREATE TABLE public.users(id bigint PRIMARY KEY,role text,active boolean);',
  'CREATE TABLE public.organization_memberships(user_id bigint,organization_id uuid,role text,active boolean);',
  'CREATE TABLE public.app_state(id integer PRIMARY KEY,organization_id uuid,payload jsonb);',
  'CREATE TABLE public.agenda_access(user_id bigint,professional_id text);',
  'CREATE TABLE public.attendances(id text PRIMARY KEY,organization_id uuid,status text,date date);',
  'CREATE TABLE public.billing_records(id uuid PRIMARY KEY,organization_id uuid,professional_id text,billing_method text,settlement_mode text,submission_channel_code text,attendance_id text,billing_entity_id uuid);',
  'CREATE TABLE public.billing_denial_cases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid DEFAULT '+ "'" +ORG+"'"+'::uuid,billing_record_id uuid,billing_entity_id uuid,denied_on date,denial_kind text,denied_amount numeric,recovered_amount numeric DEFAULT 0,reason text,payer_reference text,notes text,status text DEFAULT '+ "'OPEN'"+',updated_at timestamptz DEFAULT now(),created_by bigint,updated_by bigint,closed_at timestamptz,closed_by bigint,closing_reason text);',
  'CREATE TABLE public.billing_denial_appeals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid DEFAULT '+ "'" +ORG+"'"+'::uuid,denial_id uuid,filed_on date,appealed_amount numeric,protocol text,notes text,created_by bigint,decision text DEFAULT '+ "'PENDING'"+',decision_on date,approved_amount numeric DEFAULT 0,decision_notes text,decided_by bigint);',
  'CREATE TABLE public.billing_denial_recoveries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid DEFAULT '+ "'" +ORG+"'"+'::uuid,denial_id uuid,appeal_id uuid,recovered_on date,amount numeric,receipt_reference text,notes text,created_by bigint);',
  'CREATE TABLE public.billing_denial_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid DEFAULT '+ "'" +ORG+"'"+'::uuid,denial_id uuid,actor_id bigint,event_type text,before_snapshot jsonb,after_snapshot jsonb);',
  'CREATE TABLE public.billing_portal_submissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid DEFAULT '+ "'" +ORG+"'"+'::uuid,billing_record_id uuid,status text,destination_key text,submission_channel_code text,guide_received_at date,submitted_at date,portal_protocol text,notes text,submitted_by bigint,created_by bigint,updated_by bigint,updated_at timestamptz DEFAULT now());',
  'CREATE TABLE public.billing_portal_submission_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid DEFAULT '+ "'" +ORG+"'"+'::uuid,submission_id uuid,actor_id bigint,event_type text,before_snapshot jsonb,after_snapshot jsonb);'
 ].join('\n'));
 await db.query("INSERT INTO public.organizations VALUES($1,'rn-gestao',true)",[ORG]);
 await db.exec("INSERT INTO public.users VALUES(1,'general_manager',true),(2,'secretary',true),(3,'secretary',true),(4,'general_manager',false)");
 for(const [id,role,active] of [[1,'general_manager',true],[2,'secretary',true],[3,'secretary',true],[4,'general_manager',false]])
  await db.query('INSERT INTO public.organization_memberships VALUES($1,$2,$3,$4)',[id,ORG,role,active]);
 await db.query("INSERT INTO public.app_state VALUES(1,$1,'{}'::jsonb)",[ORG]);
 await db.query("INSERT INTO public.attendances VALUES('attendance-1',$1,'realized','2026-10-01')",[ORG]);
 await db.query("INSERT INTO public.billing_records VALUES($1,$2,'doc-1','CONVENIO','INVOICE','MANUAL','attendance-1',$3)",[RECORD,ORG,ENTITY]);
 await db.exec("INSERT INTO public.agenda_access VALUES(2,'doc-1')");
 await db.exec(extract(membership,'require_rn_agenda_actor_organization'));
 await db.exec(sql);
 return db;
}
const submit=(db,actor,record=RECORD)=>db.query('SELECT public.save_billing_portal_submission($1,$2::jsonb) AS id',
 [actor,JSON.stringify({action:'SAVE_PENDING',billing_record_id:record,destination_key:'UNIMED',submission_channel_code:'MANUAL'})]);
const denial=(db,actor,record=RECORD)=>db.query('SELECT public.save_billing_denial($1,$2::jsonb) AS id',
 [actor,JSON.stringify({action:'OPEN_CASE',billing_record_id:record,denied_on:'2026-10-20',denied_amount:50,denial_kind:'PARCIAL',reason:'Glosa administrativa de teste'})]);

test('active manager can create tenant-scoped denial and portal submission',async()=>{
 const db=await fixture();try{
  const denialId=(await denial(db,1)).rows[0].id;
  const portalId=(await submit(db,1)).rows[0].id;
  assert.ok(denialId);assert.ok(portalId);
  for(const [table,id] of [['billing_denial_cases',denialId],['billing_portal_submissions',portalId]]){
   const row=await db.query('SELECT organization_id FROM public.'+table+' WHERE id=$1',[id]);
   assert.equal(row.rows[0].organization_id,ORG,table);
  }
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.billing_denial_events')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.billing_portal_submission_events')).rows[0].n,1);
 }finally{await db.close();}
});
test('active secretary only writes to professionals explicitly granted',async()=>{
 const db=await fixture();try{
  assert.ok((await denial(db,2)).rows[0].id);
  assert.ok((await submit(db,2)).rows[0].id);
  await assert.rejects(denial(db,3),/Sem acesso à agenda deste profissional/);
  await assert.rejects(submit(db,3),/Sem acesso à agenda desse profissional/);
 }finally{await db.close();}
});
test('inactive actor, revoked membership and role mismatch fail closed in both functions',async()=>{
 const db=await fixture();try{
  await assert.rejects(denial(db,4),/Acesso à organização negado/);
  await assert.rejects(submit(db,4),/Acesso à organização negado/);
  await db.exec('UPDATE public.organization_memberships SET active=false WHERE user_id=2');
  await assert.rejects(denial(db,2),/Acesso à organização negado/);
  await assert.rejects(submit(db,2),/Acesso à organização negado/);
  await db.exec("UPDATE public.organization_memberships SET role='doctor' WHERE user_id=1");
  await assert.rejects(denial(db,1),/Acesso à organização negado/);
  await assert.rejects(submit(db,1),/Acesso à organização negado/);
 }finally{await db.close();}
});
test('foreign billing target cannot be accessed even if the organization guard remains single-tenant',async()=>{
 const db=await fixture();try{
  const foreign='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await db.query("INSERT INTO public.billing_records VALUES($1,$2,'doc-1','CONVENIO','INVOICE','MANUAL','attendance-1',$3)",[foreign,OTHER,ENTITY]);
  await assert.rejects(denial(db,1,foreign),/Glosa exige cobrança profissional de convênio/);
  await assert.rejects(submit(db,1,foreign),/Cobrança profissional de convênio não elegível/);
 }finally{await db.close();}
});
test('second organization prevents all billing mutation before any financial lookup',async()=>{
 const db=await fixture();try{
  await db.query("INSERT INTO public.organizations VALUES($1,'other-test',true)",[OTHER]);
  await assert.rejects(denial(db,1),/Organização de operação inválida/);
  await assert.rejects(submit(db,1),/Organização de operação inválida/);
 }finally{await db.close();}
});
test('RPC grants reject public and authenticated direct execution',async()=>{
 const db=await fixture();try{
  for(const fn of ['save_billing_denial','save_billing_portal_submission']){
   const perms=await db.query("SELECT has_function_privilege('anon',oid,'EXECUTE') AS anon,has_function_privilege('authenticated',oid,'EXECUTE') AS auth FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1",[fn]);
   assert.equal(perms.rows[0].anon,false,fn);
   assert.equal(perms.rows[0].auth,false,fn);
  }
 }finally{await db.close();}
});
test('API routes guard membership and scope direct privileged reads by organization',()=>{
 const routes=['denials','portal'].map(name=>readFileSync(new URL('../app/api/billing/'+name+'/route.ts',import.meta.url),'utf8'));
 for(const route of routes){
  assert.equal((route.match(/financialActorOrganizationId\(session\.account\.id\)/g)||[]).length,2);
  assert.match(route,/\.eq\("organization_id",organizationId\)/);
  assert.match(route,/Acesso à organização negado/);
 }
 const helper=readFileSync(new URL('../lib/financial-organization.ts',import.meta.url),'utf8');
 assert.match(helper,/require_rn_agenda_actor_organization/);
 assert.doesNotMatch(helper,/p_organization|organizationId:\s*string/);
});
