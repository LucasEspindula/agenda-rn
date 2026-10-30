import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const migration=readFileSync(new URL('../supabase/migrations/20261030160000_financial_logs_tenant_scope.sql',import.meta.url),'utf8');
const foundation=readFileSync(new URL('../supabase/migrations/20261029194356_financial_tenant_keys_foundation.sql',import.meta.url),'utf8');
const ORG='11111111-1111-4111-8111-111111111111',OTHER='99999999-9999-4999-8999-999999999999';
const LOG='22222222-2222-4222-8222-222222222222';
function helper(name){
 const found=foundation.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$;','i'))?.[0];
 assert.ok(found,'Missing foundation '+name);return found;
}
async function fixture(){
 const db=new PGlite();
 await db.exec([
  'CREATE ROLE anon;',
  'CREATE ROLE authenticated;',
  'CREATE ROLE service_role BYPASSRLS;',
  'CREATE TABLE public.organizations(id uuid PRIMARY KEY,slug text,active boolean);',
  'CREATE TABLE public.financial_logs(id uuid PRIMARY KEY,actor_id bigint,actor_name text,actor_email text,kind text,record_id text,created_at timestamptz DEFAULT now());',
  'CREATE TABLE public.financial_log_changes(id bigint PRIMARY KEY,log_id uuid NOT NULL REFERENCES public.financial_logs(id),record_type text,record_id text,action text,before_data jsonb,after_data jsonb);',
  "CREATE FUNCTION public.block_immutable_financial_logs() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit history is immutable'; END; $$;",
  'CREATE TRIGGER immutable_log BEFORE UPDATE OR DELETE ON public.financial_logs FOR EACH ROW EXECUTE FUNCTION public.block_immutable_financial_logs();',
  'CREATE TRIGGER immutable_log BEFORE UPDATE OR DELETE ON public.financial_log_changes FOR EACH ROW EXECUTE FUNCTION public.block_immutable_financial_logs();'
 ].join('\n'));
 for(const t of ['financial_logs','financial_log_changes'])await db.exec('ALTER TABLE public.'+t+' ENABLE ROW LEVEL SECURITY');
 await db.query("INSERT INTO public.organizations VALUES($1,'rn-gestao',true)",[ORG]);
 await db.query("INSERT INTO public.financial_logs VALUES($1,1,'Gerente','x@example.test','INVOICE','invoice-one',now())",[LOG]);
 await db.query("INSERT INTO public.financial_log_changes VALUES(42,$1,'INVOICE','invoice-one','CREATED',null,'{}'::jsonb)",[LOG]);
 await db.exec(helper('rn_finance_single_organization_id'));
 await db.exec(helper('guard_rn_finance_organization'));
 await db.exec(migration);
 return db;
}
test('immutable financial audit history receives tenant key without destructive backfill',async()=>{
 const db=await fixture();try{
  for(const table of ['financial_logs','financial_log_changes']){
   const c=await db.query("SELECT is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='organization_id'",[table]);
   assert.equal(c.rows[0].is_nullable,'NO',table);
   assert.match(c.rows[0].column_default,/rn_finance_single_organization_id/);
   assert.equal((await db.query('SELECT organization_id FROM public.'+table)).rows[0].organization_id,ORG);
   assert.equal((await db.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',['public.'+table])).rows[0].relrowsecurity,true);
  }
  assert.equal((await db.query('SELECT id FROM public.financial_log_changes')).rows[0].id,42);
  await assert.rejects(db.query("UPDATE public.financial_logs SET actor_name='X' WHERE id=$1",[LOG]),/Audit history is immutable/);
  await assert.rejects(db.query('DELETE FROM public.financial_log_changes WHERE id=42'),/Audit history is immutable/);
 }finally{await db.close();}
});
test('new audit entries inherit server-selected tenant key',async()=>{
 const db=await fixture();try{
  const id='33333333-3333-4333-8333-333333333333';
  const p=await db.query("INSERT INTO public.financial_logs(id,actor_name,kind) VALUES($1,'Teste','PAYMENT') RETURNING organization_id",[id]);
  const c=await db.query("INSERT INTO public.financial_log_changes(id,log_id,record_type,action) VALUES(43,$1,'PAYMENT','CREATED') RETURNING organization_id",[id]);
  assert.equal(p.rows[0].organization_id,ORG);assert.equal(c.rows[0].organization_id,ORG);
 }finally{await db.close();}
});
test('cross-org inserts fail closed and child cannot point to parent in another organization',async()=>{
 const db=await fixture();try{
  await assert.rejects(db.query("INSERT INTO public.financial_logs(id,actor_name,kind,organization_id) VALUES('44444444-4444-4444-8444-444444444444','X','AUDIT',$1)",[OTHER]),/Registro financeiro fora da organização autorizada/);
  await db.query("INSERT INTO public.organizations VALUES($1,'other-test',true)",[OTHER]);
  await assert.rejects(db.query("INSERT INTO public.financial_logs(id,actor_name,kind) VALUES('55555555-5555-4555-8555-555555555555','X','AUDIT')"),/Organização de operação inválida/);
  await db.exec('ALTER TABLE public.financial_log_changes DISABLE TRIGGER guard_rn_finance_organization');
  await assert.rejects(db.query("INSERT INTO public.financial_log_changes(id,log_id,record_type,action,organization_id) VALUES(99,$1,'PAYMENT','CREATED',$2)",[LOG,OTHER]),/foreign key constraint|violates foreign key/i);
 }finally{await db.close();}
});
test('public access remains revoked and composite log FK is validated',async()=>{
 const db=await fixture();try{
  for(const table of ['financial_logs','financial_log_changes']){
   const perms=await db.query("SELECT has_table_privilege('anon',$1,'SELECT') anon,has_table_privilege('authenticated',$1,'SELECT') auth",['public.'+table]);
   assert.equal(perms.rows[0].anon,false,table);assert.equal(perms.rows[0].auth,false,table);
  }
  assert.equal((await db.query("SELECT convalidated FROM pg_constraint WHERE conname='org_link_financial_log_changes_log_id'")).rows[0].convalidated,true);
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname='guard_rn_finance_organization'")).rows[0].n,2);
 }finally{await db.close();}
});
test('billing data loader rejects missing actor scope and scopes every financial table',()=>{
 const src=readFileSync(new URL('../lib/billing-data.ts',import.meta.url),'utf8');
 for(const pattern of [/loadBillingData\(actorId:number\)/,/financialActorOrganizationId\(actorId\)/,/\.eq\(scopeColumn,organizationId\)/,/\.eq\('organization_id',organizationId\)/,/organization_memberships!inner\(organization_id\)/])assert.match(src,pattern);
 for(const path of ['billing/route.ts','billing/denials/route.ts','billing/portal/route.ts','reports/billing/route.ts','reports/agenda/route.ts','patient-finance/route.ts']){
  const code=readFileSync(new URL('../app/api/'+path,import.meta.url),'utf8');
  assert.doesNotMatch(code,/loadBillingData\(\)/,path);
  assert.match(code,/loadBillingData\((session|s)\.account\.id\)/,path);
 }
});
test('financial log API filters the tenant and explicitly selects the original child FK',()=>{
 const api=readFileSync(new URL('../app/api/billing/logs/route.ts',import.meta.url),'utf8');
 assert.match(api,/financialActorOrganizationId\(s\.account\.id\)/);
 assert.match(api,/\.eq\('organization_id',organizationId\)/);
 assert.match(api,/financial_log_changes!financial_log_changes_log_id_fkey/);
});
