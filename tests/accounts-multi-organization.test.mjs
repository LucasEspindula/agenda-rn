import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

// 2B-M2a: contas, vínculos em várias organizações e organização ativa por sessão.
const read=p=>readFileSync(new URL('../supabase/migrations/'+p,import.meta.url),'utf8').split('\r\n').join('\n');
const m2a=read('20261109150000_accounts_multi_organization.sql');
const A='00000000-0000-4000-8000-00000000000a',B='00000000-0000-4000-8000-00000000000b',X='00000000-0000-4000-8000-00000000000c';

async function fixture(){
 const db=new PGlite();
 await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.organizations(id uuid primary key,slug text unique,name text,kind text default 'MANAGEMENT_COMPANY',active boolean default true);
  insert into public.organizations(id,slug,name) values ('${A}','rn-gestao','RN Gestão'),('${B}','rn-filial','RN Filial'),('${X}','outra','Outra empresa');
  create table public.users(id bigint primary key,email text,name text,role text,active boolean default true,doctor_id text);
  create table public.organization_memberships(organization_id uuid,user_id bigint,role text,active boolean default true,updated_at timestamptz default now(),primary key(organization_id,user_id));
  create table public.sessions(id bigserial primary key,token_hash text unique,user_id bigint,expires_at timestamptz);
  create table public.agenda_settings(organization_id uuid primary key,revision timestamptz default now());
  create table public.doctors(id text primary key,organization_id uuid not null,active boolean default true,scheduling_enabled boolean default true,billing_enabled boolean default false,invoice_enabled boolean default false);
  create table public.agenda_access(id bigserial primary key,user_id bigint,professional_id text,organization_id uuid);
  create table public.notifications(id text primary key,user_id bigint,organization_id uuid);
  create table public.directory_audit(id bigserial primary key,actor_id bigint,kind text,record_id text,before_data jsonb,after_data jsonb,organization_id uuid);
  insert into public.users values (1,'dono@t','Dono','general_manager',true,null),(2,'gerente@t','Gerente A','general_manager',true,null),(3,'outro@t','Gerente X','general_manager',true,null),(4,'sec@t','Secretária','secretary',true,null);
  insert into public.organization_memberships(organization_id,user_id,role) values ('${A}',1,'general_manager'),('${B}',1,'general_manager'),('${A}',2,'general_manager'),('${X}',3,'general_manager'),('${A}',4,'secretary'),('${B}',4,'secretary');
  insert into public.agenda_settings(organization_id) values ('${A}'),('${B}'),('${X}');
  insert into public.doctors(id,organization_id) values ('docA','${A}'),('docB','${B}');
  insert into public.sessions(token_hash,user_id,expires_at) values ('s1',1,now()+interval '1 hour'),('s4',4,now()+interval '1 hour'),('s3',3,now()+interval '1 hour');
  create function public.require_rn_agenda_actor_organization(p_actor bigint) returns uuid language plpgsql stable as $$ begin return public.actor_organization_id(p_actor); end $$;
 `);
 await db.exec(m2a);
 await db.exec(`create trigger g before insert or update or delete on public.notifications for each row execute function public.guard_tenant_row('user:user_id');
  create trigger g before insert or update or delete on public.agenda_access for each row execute function public.guard_tenant_row('user:user_id','doctor:professional_id');`);
 // A empresa "Outra" pertence a outra conta.
 await db.exec(`insert into public.accounts(id,name,owner_user_id) values ('00000000-0000-4000-8000-0000000000cc','Outra conta',3);
  update public.organizations set account_id='00000000-0000-4000-8000-0000000000cc' where id='${X}';`);
 return db;
}
async function fails(db,sql){try{await db.exec(sql);return null}catch(e){return e.message}}
const one=async(db,sql,params=[])=>(await db.query(sql,params)).rows[0];

test('existing organizations get an account owned by an RN Gestão manager',async()=>{
 const db=await fixture();
 try{
  const acc=await one(db,`select a.name,a.owner_user_id owner,(select count(*)::int from public.organizations where account_id=a.id) n from public.accounts a join public.organizations o on o.account_id=a.id where o.slug='rn-gestao'`);
  assert.equal(acc.name,'RN Gestão');assert.equal(Number(acc.owner),1);assert.equal(acc.n,2);
 }finally{await db.close()}
});

test('a person in several organizations must pick one; the database checks the membership',async()=>{
 const db=await fixture();
 try{
  assert.match(await fails(db,'select public.actor_organization_id(1)'),/Selecione a organização/);
  assert.equal((await one(db,'select public.actor_organization_id(2) v')).v,A,'single membership still resolves alone');
  assert.equal((await one(db,`select public.use_organization(1,'${B}') v`)).v,B);
  assert.match(await fails(db,`select public.use_organization(1,'${X}')`),/Acesso à organização negado/);
  assert.match(await fails(db,`select public.use_organization(2,'${B}')`),/Acesso à organização negado/);
  await db.exec(`update public.accounts set status='suspended' where id=(select account_id from public.organizations where id='${A}')`);
  assert.match(await fails(db,`select public.use_organization(2,'${A}')`),/Acesso à organização negado/,'suspended account blocks access');
 }finally{await db.close()}
});

test('session picks an active organization, lists the others and switches only to own memberships',async()=>{
 const db=await fixture();
 try{
  const ctx=async t=>(await one(db,'select public.session_context($1) v',[t])).v;
  let s=await ctx('s1');
  assert.deepEqual(s.organizations.map(o=>o.slug).sort(),['rn-filial','rn-gestao']);
  assert.equal(s.customer.isOwner,true);assert.equal(s.customer.organizationCount,2);
  await db.query(`select public.switch_session_organization('s1','${B}')`);
  s=await ctx('s1');assert.equal(s.organization.id,B);
  assert.equal((await one(db,'select last_organization_id v from public.users where id=1')).v,B,'last used is remembered');
  assert.match(await fails(db,`select public.switch_session_organization('s1','${X}')`),/Acesso à organização negado/);
  assert.equal((await ctx('s4')).customer.isOwner,false);
  assert.equal((await ctx('s3')).organization.id,X);
  await db.exec(`insert into public.agenda_access(user_id,professional_id,organization_id) values (4,'docA','${A}'),(4,'docB','${B}')`);
  await db.query(`select public.switch_session_organization('s4','${A}')`);
  assert.deepEqual((await ctx('s4')).agendaIds,['docA'],'agenda grants follow the active organization');
 }finally{await db.close()}
});

test('only the account owner creates organizations, within the plan limit, and becomes their manager',async()=>{
 const db=await fixture();
 try{
  const id=(await one(db,`select public.create_account_organization(1,'${A}','Clínica São José','CLINIC') v`)).v;
  const org=await one(db,'select slug,kind,account_id from public.organizations where id=$1',[id]);
  assert.match(org.slug,/^clinica-sao-jose-[0-9a-f]{6}$/);assert.equal(org.kind,'CLINIC');
  assert.ok(await one(db,'select 1 from public.agenda_settings where organization_id=$1',[id]));
  assert.ok(await one(db,`select 1 from public.organization_memberships where organization_id=$1 and user_id=1 and role='general_manager' and active`,[id]));
  assert.match(await fails(db,`select public.create_account_organization(2,'${A}','Invasora','CLINIC')`),/titular da conta/);
  assert.match(await fails(db,`select public.create_account_organization(3,'${A}','Invasora','CLINIC')`),/Acesso à organização negado/);
  assert.match(await fails(db,`select public.create_account_organization(1,'${A}','X','CLINIC')`),/nome da organização/);
  assert.match(await fails(db,`select public.create_account_organization(1,'${A}','Tipo ruim','HOSPITAL')`),/Tipo de organização inválido/);
  await db.exec(`update public.accounts set max_organizations=3 where owner_user_id=1`);
  assert.match(await fails(db,`select public.create_account_organization(1,'${A}','Quarta','CLINIC')`),/Limite de organizações/);
 }finally{await db.close()}
});

test('tenant guard: doctors fix the organization, people must belong to it, ambiguous rows are refused',async()=>{
 const db=await fixture();
 try{
  assert.match(await fails(db,`insert into public.notifications(id,user_id) values ('n1',1)`),/Registro sem organização/,'multi-organization user without context');
  await db.exec(`insert into public.notifications(id,user_id) values ('n2',2)`);
  assert.equal((await one(db,`select organization_id v from public.notifications where id='n2'`)).v,A);
  await db.exec(`begin; select set_config('rn.organization','${B}',true); insert into public.notifications(id,user_id) values ('n3',1); commit;`);
  assert.equal((await one(db,`select organization_id v from public.notifications where id='n3'`)).v,B);
  assert.match(await fails(db,`insert into public.agenda_access(user_id,professional_id) values (2,'docB')`),/Vínculo de outra organização \(user_id\)/);
  assert.match(await fails(db,`insert into public.agenda_access(user_id,professional_id,organization_id) values (1,'docA','${B}')`),/Vínculo de outra organização \(professional_id\)/);
  await db.exec(`insert into public.agenda_access(user_id,professional_id) values (1,'docB')`);
  assert.equal((await one(db,`select organization_id v from public.agenda_access where professional_id='docB'`)).v,B);
 }finally{await db.close()}
});

test('every application RPC has an organization-aware version and the server passes the active organization',()=>{
 for(const sig of ['load_agenda_state(p_actor bigint,p_org uuid)','load_agenda_window(p_actor bigint,p_since date,p_org uuid)','agenda_row_bases(p_actor bigint,p_revision timestamptz,p_keys jsonb,p_org uuid)',
  'apply_agenda_changes(p_actor bigint,p_ops jsonb,p_audit jsonb,p_request_id text,p_decision text,p_note text,p_notification jsonb,p_org uuid)','save_doctor_with_access(p_actor bigint,p_kind text,p_data jsonb,p_access jsonb,p_credentials jsonb,p_org uuid)',
  'save_user_access(p_actor bigint,p_data jsonb,p_credentials jsonb,p_org uuid)','deactivate_user_access(p_actor bigint,p_target bigint,p_org uuid)','submit_agenda_suggestion(p_request jsonb,p_notification jsonb,p_audit jsonb,p_org uuid)'])
  assert.ok(m2a.includes('create or replace function public.'+sig),sig);
 const src=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 assert.match(src('lib/agenda/store.ts'),/withOrg\(\{ p_actor: actorId, p_since: since \}, org\)/);
 assert.match(src('app/api/state/route.ts'),/loadAgendaWindow\(session\.account\.id, since, session\.organization\.id\)/);
 assert.match(src('app/api/state/route.ts'),/org: session\.organization\.id \}/);
 assert.match(src('app/api/access/route.ts'),/p_org:session\.organization\.id/);
 assert.match(src('app/api/doctors/route.ts'),/p_org:session\.organization\.id/);
 assert.match(src('app/api/workflow/route.ts'),/p_org: session\.organization\.id/);
 assert.match(src('app/api/organizations/route.ts'),/switch_session_organization/);
 assert.match(src('app/api/organizations/route.ts'),/create_account_organization/);
});
