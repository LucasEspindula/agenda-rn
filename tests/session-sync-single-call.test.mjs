import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {loadTs} from './load-ts.mjs';

// public.session_context / public.agenda_sync_signal: mesmas regras de getSession e do
// antigo /api/state/revision, numa única ida ao banco.
const migration=readFileSync(new URL('../supabase/migrations/20261106190000_session_sync_single_call.sql',import.meta.url),'utf8');
const ORG='00000000-0000-4000-8000-000000000001';

async function fixture(){
 const db=new PGlite();
 await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.organizations(id uuid primary key,slug text not null,active boolean not null default true);
  insert into public.organizations values ('${ORG}','rn-gestao',true);
  create table public.users(id bigint primary key,email text,name text,role text not null,active boolean not null default true,doctor_id text);
  create table public.organization_memberships(user_id bigint,organization_id uuid,role text,active boolean default true);
  create table public.sessions(id bigserial primary key,token_hash text unique,user_id bigint,expires_at timestamptz);
  create table public.doctors(id text primary key,active boolean default true,scheduling_enabled boolean default true,billing_enabled boolean default false,invoice_enabled boolean default false);
  create table public.agenda_access(user_id bigint,professional_id text);
  create table public.agenda_settings(organization_id uuid primary key,revision timestamptz);
  create table public.audit_logs(id bigserial,professional_id text,created_at timestamptz);
  create table public.notifications(id bigserial,user_id bigint,created_at timestamptz,read_at timestamptz);
  create table public.agenda_requests(id bigserial,requested_by bigint,professional_id text,created_at timestamptz);
  create function public.rn_agenda_organization_id() returns uuid language sql stable as $$select id from public.organizations where slug='rn-gestao'$$;
  insert into public.users values (1,'g@t.test','Gerente','general_manager',true,null),(2,'s@t.test','Secretária','secretary',true,null),
   (3,'d@t.test','Médico','doctor',true,'d1'),(4,'x@t.test','Inativo','secretary',false,null),(5,'n@t.test','Sem vínculo','secretary',true,null),(6,'o@t.test','Médico off','doctor',true,'d2');
  insert into public.organization_memberships values (1,'${ORG}','general_manager',true),(2,'${ORG}','secretary',true),(3,'${ORG}','doctor',true),(4,'${ORG}','secretary',true),(6,'${ORG}','doctor',true);
  insert into public.doctors values ('d1',true,true,false,true),('d2',false,true,true,true),('d3',true,true,false,false);
  insert into public.agenda_access values (2,'d1'),(2,'d3'),(3,'d3');
  insert into public.sessions(token_hash,user_id,expires_at) values ('g',1,now()+interval '1 hour'),('s',2,now()+interval '1 hour'),('d',3,now()+interval '1 hour'),
   ('x',4,now()+interval '1 hour'),('n',5,now()+interval '1 hour'),('o',6,now()+interval '1 hour'),('old',1,now()-interval '1 minute');
  insert into public.agenda_settings values ('${ORG}','2026-11-06T10:00:00Z');
  insert into public.audit_logs(professional_id,created_at) values ('d1','2026-11-06T09:00:00Z'),('d9','2026-11-06T09:30:00Z');
  insert into public.notifications(user_id,created_at,read_at) values (2,'2026-11-06T08:00:00Z','2026-11-06T09:10:00Z'),(3,'2026-11-06T07:00:00Z',null);
  insert into public.agenda_requests(requested_by,professional_id,created_at) values (3,'d1','2026-11-06T09:20:00Z'),(3,'d9','2026-11-06T09:50:00Z');
 `);
 await db.exec(migration);
 return db;
}
const ctx=async(db,h)=>(await db.query('select public.session_context($1) v',[h])).rows[0].v;
const sync=async(db,h)=>(await db.query('select public.agenda_sync_signal($1) v',[h])).rows[0].v;

test('session_context admits only active, linked, unexpired sessions and returns scoped agendas',async()=>{
 const db=await fixture();
 try{
  const g=await ctx(db,'g');
  assert.deepEqual(g.account,{id:1,email:'g@t.test',name:'Gerente',role:'general_manager',doctorId:null});
  assert.deepEqual(g.agendaIds,[]);
  assert.deepEqual((await ctx(db,'s')).agendaIds.sort(),['d1','d3']);
  const d=await ctx(db,'d');
  assert.deepEqual(d.agendaIds.sort(),['d1','d3']);
  assert.deepEqual(d.services,{scheduling_enabled:true,billing_enabled:false,invoice_enabled:true});
  assert.equal((await ctx(db,'o')).services.scheduling_enabled,false,'inactive doctor record means no services');
  for(const h of ['old','x','n','missing',null])assert.equal(await ctx(db,h),null,String(h));
  await db.exec(`update public.organization_memberships set role='doctor' where user_id=2`);
  assert.equal(await ctx(db,'s'),null,'membership role must match the account role');
  await db.exec(`insert into public.organizations values ('00000000-0000-4000-8000-000000000002','outra',true)`);
  assert.equal(await ctx(db,'g'),null,'second organization keeps the fail-closed gate');
 }finally{await db.close()}
});

test('agenda_sync_signal keeps the per-role workflow scope of the old revision route',async()=>{
 const db=await fixture();
 try{
  const t=v=>v&&new Date(v).toISOString();
  const g=await sync(db,'g');
  assert.equal(t(g.revision),'2026-11-06T10:00:00.000Z');
  assert.equal(t(g.workflowRevision),'2026-11-06T09:30:00.000Z','manager sees every audit entry');
  assert.equal(t((await sync(db,'s')).workflowRevision),'2026-11-06T09:10:00.000Z','secretary: own agendas audit + own notifications');
  assert.equal(t((await sync(db,'d')).workflowRevision),'2026-11-06T09:20:00.000Z','doctor: own requests on own agendas, no audit');
  assert.equal(await sync(db,'x'),null);
  const grants=(await db.query(`select has_function_privilege('anon','public.agenda_sync_signal(text)','execute') a, has_function_privilege('authenticated','public.session_context(text)','execute') b, has_function_privilege('service_role','public.session_context(text)','execute') c`)).rows[0];
  assert.deepEqual(grants,{a:false,b:false,c:true});
 }finally{await db.close()}
});

test('revision route makes one RPC and denies before exposing revisions',async()=>{
 const route=(data,allowed=true,hash='h')=>{const calls=[];return {calls,mod:loadTs('app/api/state/revision/route.ts',{
  '@/app/authz':{sessionTokenHash:async()=>hash,sessionFromContext:raw=>raw?{account:{id:1,role:'secretary'},agendaIds:[]}:null},
  '@/lib/doctor-services':{canUseAgenda:()=>allowed},
  '@/lib/supabase-admin':{getSupabaseAdmin:()=>({rpc:async(name,args)=>{calls.push([name,args]);return {data,error:null}},from(){throw Error('no table reads')}}),dbError:e=>{if(e)throw e}}})}};
 const ok=route({session:{},revision:'2026-11-06T10:00:00.123456+00:00',workflowRevision:'2026-11-06T09:10:00+00:00'});
 const response=await ok.mod.GET();
 assert.deepEqual(JSON.parse(JSON.stringify(await response.json())),{revision:'2026-11-06T10:00:00.123Z',workflowRevision:'2026-11-06T09:10:00+00:00'});
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal(JSON.stringify(ok.calls),JSON.stringify([['agenda_sync_signal',{p_token_hash:'h'}]]));
 assert.equal((await route(null).mod.GET()).status,403);
 assert.equal((await route({session:{}},false).mod.GET()).status,403);
 const noCookie=route({session:{}},true,null);assert.equal((await noCookie.mod.GET()).status,403);assert.equal(noCookie.calls.length,0);
});

test('agenda polling backs off while idle and returns to the fast pace on change or activity',async()=>{
 const {default:ts}=await import('typescript');const vm=await import('node:vm');
 const source=readFileSync(new URL('../public/legacy-app.js',import.meta.url),'utf8');
 const ast=ts.createSourceFile('legacy.js',source,ts.ScriptTarget.Latest,true);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='agendaNextSyncDelay').getText(ast);
 const c={AGENDA_SYNC_FAST:4000,AGENDA_SYNC_IDLE_MAX:15000};vm.createContext(c);vm.runInContext(fn,c);
 let d=4000;const seen=[];for(let i=0;i<8;i++){d=c.agendaNextSyncDelay(d,false);seen.push(d)}
 assert.deepEqual(seen,[6000,8000,10000,12000,14000,15000,15000,15000]);
 assert.equal(c.agendaNextSyncDelay(15000,true),4000);
 assert.match(source,/const AGENDA_SYNC_FAST=4000,AGENDA_SYNC_IDLE_MAX=15000;/);
 assert.match(source,/document\.addEventListener\("pointerdown",onActivity,\{passive:true\}\)/);
 assert.match(source,/document\.removeEventListener\("pointerdown",onActivity\)/);
});
