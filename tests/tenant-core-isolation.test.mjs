import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

// 2B-M1: organização derivada do autor e guarda das tabelas que ganharam organization_id.
const migration=readFileSync(new URL('../supabase/migrations/20261107120000_tenant_core_isolation.sql',import.meta.url),'utf8');
const A='00000000-0000-4000-8000-00000000000a',B='00000000-0000-4000-8000-00000000000b';
const pick=(sql,start,end)=>sql.slice(sql.indexOf(start),end?sql.indexOf(end,sql.indexOf(start)+1):undefined);
const body=(sql,fn)=>{const i=sql.indexOf(`create or replace function public.${fn}(`);if(i<0)return '';const ends=['$function$;','end;$$;'].map(e=>sql.indexOf(e,i)).filter(x=>x>0);return sql.slice(i,Math.min(...ends))};

async function fixture(){
 const db=new PGlite();
 await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.organizations(id uuid primary key,slug text unique,name text,active boolean default true);
  insert into public.organizations values ('${A}','rn-gestao','A',true),('${B}','clinica-b','B',true);
  create table public.users(id bigint primary key,email text,name text,role text,active boolean default true,doctor_id text);
  create table public.organization_memberships(organization_id uuid,user_id bigint,role text,active boolean default true,updated_at timestamptz default now(),primary key(organization_id,user_id));
  create table public.doctors(id text primary key,organization_id uuid not null);
  create table public.audit_logs(id text primary key,actor_user_id bigint,professional_id text,created_at timestamptz default now());
  create table public.notifications(id text primary key,user_id bigint,read_at timestamptz);
  create table public.agenda_access(id bigserial primary key,user_id bigint,professional_id text);
  insert into public.users values (1,'a@t','Ger A','general_manager',true,null),(2,'b@t','Ger B','general_manager',true,null),(3,'x@t','Inativo','secretary',false,null),(4,'s@t','Sec A','doctor',true,null);
  insert into public.organization_memberships(organization_id,user_id,role,active) values ('${A}',1,'general_manager',true),('${B}',2,'general_manager',true),('${A}',3,'secretary',true),('${A}',4,'secretary',true);
  insert into public.doctors values ('docA','${A}'),('docB','${B}');
  insert into public.audit_logs(id,actor_user_id,professional_id) values ('old',1,'docA');
 `);
 // Só as partes da migration que não dependem das tabelas da agenda.
 await db.exec(pick(migration,'create unique index if not exists organization_memberships_one_active_per_user','-- 3.'));
 await db.exec(pick(migration,'create or replace function public.guard_tenant_row()','do $$\ndeclare spec record'));
 await db.exec(`
  alter table public.audit_logs add column organization_id uuid; update public.audit_logs set organization_id='${A}'; alter table public.audit_logs alter column organization_id set not null;
  alter table public.notifications add column organization_id uuid not null;
  alter table public.agenda_access add column organization_id uuid not null;
  create trigger g before insert or update or delete on public.audit_logs for each row execute function public.guard_tenant_row('user:actor_user_id','doctor:professional_id');
  create trigger g before insert or update or delete on public.notifications for each row execute function public.guard_tenant_row('user:user_id');
  create trigger g before insert or update or delete on public.agenda_access for each row execute function public.guard_tenant_row('user:user_id','doctor:professional_id');
 `);
 return db;
}
async function fails(db,sql){try{await db.exec(sql);return null}catch(e){return e.message}}
const actor=(id)=>`select set_config('rn.actor','${id}',false);`;

test('actor organization comes from the active membership with the same role, never from input',async()=>{
 const db=await fixture();
 try{
  const org=async id=>(await db.query('select public.actor_organization_id($1) v',[id])).rows[0].v;
  assert.equal(await org(1),A);assert.equal(await org(2),B);
  for(const id of [3,4,99])assert.match(await fails(db,`select public.actor_organization_id(${id})`),/Acesso à organização negado/,String(id));
  assert.match(await fails(db,`insert into public.organization_memberships(organization_id,user_id,role,active) values ('${B}',1,'general_manager',true)`),/duplicate|unique/i,'one active organization per user');
  await db.exec(actor(2));
  assert.equal((await db.query('select public.current_organization_id() v')).rows[0].v,B);
  await db.exec(`select set_config('rn.actor','',false)`);
  assert.equal((await db.query('select public.current_organization_id() v')).rows[0].v,null);
 }finally{await db.close()}
});

test('tenant guard fills the organization from the referenced user and rejects cross-organization links',async()=>{
 const db=await fixture();
 try{
  await db.exec(`insert into public.notifications(id,user_id) values ('n1',2)`);
  assert.equal((await db.query(`select organization_id v from public.notifications where id='n1'`)).rows[0].v,B);
  assert.match(await fails(db,`insert into public.audit_logs(id,actor_user_id,professional_id) values ('x1',2,'docA')`),/Vínculo de outra organização/);
  assert.match(await fails(db,`insert into public.agenda_access(user_id,professional_id) values (2,'docA')`),/Vínculo de outra organização/);
  assert.match(await fails(db,`insert into public.notifications(id,user_id,organization_id) values ('n2',2,'${A}')`),/Vínculo de outra organização/,'explicit organization must match');
  await db.exec(`insert into public.agenda_access(user_id,professional_id) values (2,'docB')`);
  await db.exec(actor(2));
  assert.match(await fails(db,`update public.audit_logs set professional_id='docA' where id='old'`),/Registro fora da organização atual/);
  assert.match(await fails(db,`delete from public.audit_logs where id='old'`),/Registro fora da organização atual/);
  assert.match(await fails(db,`update public.notifications set organization_id='${A}' where id='n1'`),/Alteração de organização não permitida/);
  await db.exec(`update public.notifications set read_at=now() where id='n1'`);
 }finally{await db.close()}
});

test('migration removes every single-organization gate from session, agenda and access code',()=>{
 for(const fn of ['session_context','agenda_sync_signal','save_user_access','deactivate_user_access','save_doctor_directory','require_rn_agenda_actor_organization','rn_agenda_organization_id','rn_finance_single_organization_id']){
  const text=body(migration,fn);
  assert.ok(text.length>40,fn);
  assert.doesNotMatch(text,/slug='rn-gestao'|count\(\*\) from public\.organizations/,fn);
 }
 assert.match(migration,/CRM já cadastrado[\s\S]*?/);
 assert.match(migration,/where organization_id=org and id<>sid and lower\(trim\(crm\)\)/,'CRM unique per organization');
 for(const table of ['audit_logs','notifications','agenda_requests','agenda_access','doctor_agendas','surgery_documents','directory_audit'])assert.match(migration,new RegExp(`\\('${table}',array\\[`),table);
 assert.match(migration,/alter column organization_id set default public\.current_organization_id\(\)/);
});

test('APIs read organization from the session and never from a fixed slug',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 for(const p of ['app/api/access/route.ts','app/api/doctors/route.ts','app/api/workflow/route.ts','app/api/workflow/logs/route.ts','app/api/documents/route.ts','app/authz.ts','app/api/auth/login/route.ts']){
  const s=read(p);assert.doesNotMatch(s,/rn-gestao/,p);
 }
 assert.match(read('app/api/doctors/route.ts'),/\.from\('doctors'\)\.select\('\*'\)\.eq\('organization_id',org\)/);
 assert.match(read('app/api/workflow/route.ts'),/from\("agenda_requests"\)\.select\("\*"\)\.eq\("organization_id", org\)/);
 assert.match(read('app/api/documents/route.ts'),/path = `org\/\$\{session\.organization\.id\}\//);
 assert.match(read('app/authz.ts'),/organization: \{ id: String\(organization\.id\)/);
});
