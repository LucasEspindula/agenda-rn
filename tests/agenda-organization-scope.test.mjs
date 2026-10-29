import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const foundation=readFileSync(new URL('../supabase/migrations/20261028203004_organization_foundation.sql',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261029190000_agenda_organization_scope.sql',import.meta.url),'utf8');

async function fixture(){
 const db=new PGlite();
 await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create table public.users(id bigint primary key,role text not null,active boolean not null default true);
  create table public.app_state(id integer primary key,payload jsonb not null,version bigint not null default 1,updated_at timestamptz not null default now());
  create table public.agenda_requests(id text primary key,status text,decided_by bigint,decision_note text,decided_at timestamptz);
  create table public.audit_logs(id text,actor_user_id bigint,actor_name text,actor_role text,action text,professional_id text,appointment_id text,patient_id text,description text,metadata jsonb,created_at timestamptz);
  create table public.notifications(id text,user_id bigint,type text,request_id text,message text,created_at timestamptz);
  create function public.financial_operation(bigint,text,text) returns void language plpgsql as $$ begin return; end; $$;
  insert into public.users(id,role) values (1,'general_manager'),(2,'secretary'),(3,'doctor');
  insert into public.app_state(id,payload,version,updated_at)
   values (1,'{"patients":[{"id":"p1"}],"appointments":[{"id":"a1"}]}',2,'2026-10-29T00:00:00Z');
 `);
 await db.exec(foundation);
 await db.exec(migration);
 return db;
}
async function original(db){
 return (await db.query("select id,organization_id,payload,version,updated_at from public.app_state where id=1")).rows[0];
}
async function save(db,actor,expected,payload,revision){
 return db.query("select public.commit_agenda_change($1::timestamptz,$2::jsonb,$3::timestamptz,'[]'::jsonb,null,null,$4::bigint,null,null) as accepted",[expected,JSON.stringify(payload),revision,actor]);
}

test('agenda document is backfilled without changing content, revision or version',async()=>{
 const db=await fixture();
 try{
  const row=await original(db);
  const org=await db.query("select id from public.organizations where slug='rn-gestao'");
  assert.equal(row.id,1);
  assert.equal(row.organization_id,org.rows[0].id);
  assert.deepEqual(row.payload,{patients:[{id:'p1'}],appointments:[{id:'a1'}]});
  assert.equal(row.version,2);
  assert.equal(new Date(row.updated_at).toISOString(),'2026-10-29T00:00:00.000Z');
  const constraints=await db.query("select attnotnull from pg_attribute where attrelid='public.app_state'::regclass and attname='organization_id'");
  assert.equal(constraints.rows[0].attnotnull,true);
  assert.equal((await db.query("select count(*)::int as total from pg_index where indrelid='public.app_state'::regclass and indisunique")).rows[0].total,2);
 }finally{await db.close()}
});

test('main agenda RPC changes only RN Gestão row; guards unauthorized actor and stale revision',async()=>{
 const db=await fixture();
 try{
  const before=await original(db),revision=new Date('2026-10-29T01:00:00Z').toISOString();
  const payload={...before.payload,appointments:[{id:'a1'},{id:'a2'}]};
  const result=await save(db,1,before.updated_at,payload,revision);
  assert.equal(result.rows[0].accepted,true);
  const after=await original(db);
  assert.equal(after.organization_id,before.organization_id);
  assert.deepEqual(after.payload,payload);
  assert.equal(new Date(after.updated_at).toISOString(),revision.replace('.000Z','.000Z'));
  assert.equal((await save(db,1,before.updated_at,payload,'2026-10-29T02:00:00Z')).rows[0].accepted,false);
  await db.query('update public.organization_memberships set active=false where user_id=1');
  await assert.rejects(save(db,1,revision,payload,'2026-10-29T03:00:00Z'),/Acesso à organização negado/);
 }finally{await db.close()}
});

test('legacy state cannot be transferred, deleted or cloned for another tenant',async()=>{
 const db=await fixture();
 try{
  const row=await original(db);
  await assert.rejects(db.query('insert into public.app_state(id,organization_id,payload) values (2,$1,\'{}\')',[row.organization_id]),/Agenda fora da organização atual/);
  await assert.rejects(db.query('delete from public.app_state where id=1'),/Exclusão direta/);
  await db.exec("insert into public.organizations(slug,name,kind) values ('other','Other org','CLINIC')");
  const other=await db.query("select id from public.organizations where slug='other'");
  await assert.rejects(db.query('update public.app_state set organization_id=$1 where id=1',[other.rows[0].id]),/Organização de operação inválida/);
  assert.equal((await db.query('select count(*)::int as total from public.app_state')).rows[0].total,1);
 }finally{await db.close()}
});

test('all server-side agenda readers filter by RN Gestão organization, not global id=1',()=>{
 const paths=[
  '../app/api/access/route.ts',
  '../app/api/attendance/status/route.ts',
  '../app/api/documents/route.ts',
  '../app/api/patient-authorship/route.ts',
  '../app/api/state/revision/route.ts',
  '../app/api/state/route.ts',
  '../app/api/workflow/route.ts',
  '../lib/billing-data.ts'
 ];
 for(const path of paths){
  const source=readFileSync(new URL(path,import.meta.url),'utf8');
  assert.match(source,/organizations!inner\(slug,active\)/,path);
  assert.match(source,/\.eq\("organizations.slug","rn-gestao"\)/,path);
  assert.doesNotMatch(source,/from\(['"]app_state['"]\)\.select\([^;]*?\.eq\(['"]id['"],\s*1\)/,path);
 }
 const sql=readFileSync(new URL('../supabase/migrations/20261029190000_agenda_organization_scope.sql',import.meta.url),'utf8');
 assert.match(sql,/where id=1 and organization_id=rn_org_id/i);
 assert.match(sql,/effective_actor.*coalesce\(p_actor/i);
});
