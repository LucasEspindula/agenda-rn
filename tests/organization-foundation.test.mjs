import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const sql=readFileSync(new URL('../supabase/migrations/20261028203004_organization_foundation.sql',import.meta.url),'utf8');

test('organization foundation migrates without touching legacy clinical or financial tables',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   create role anon;
   create role authenticated;
   create role service_role bypassrls;
   create table public.users(id bigint primary key,role text not null);
   create table public.app_state(id int primary key,payload jsonb not null);
   insert into public.users(id,role) values(1,'general_manager'),(2,'secretary'),(3,'doctor');
   insert into public.app_state(id,payload) values(1,'{"appointments":[{"id":"untouched"}]}');
  `);
  await db.exec(sql);
  const organizations=await db.query('select slug,name,kind from public.organizations');
  assert.deepEqual(organizations.rows,[{slug:'rn-gestao',name:'RN Gestão',kind:'MANAGEMENT_COMPANY'}]);
  const memberships=await db.query('select user_id,role,active from public.organization_memberships order by user_id');
  assert.deepEqual(memberships.rows,[
   {user_id:1,role:'general_manager',active:true},
   {user_id:2,role:'secretary',active:true},
   {user_id:3,role:'doctor',active:true}
  ]);
  const original=await db.query('select payload from public.app_state where id=1');
  assert.deepEqual(original.rows[0].payload,{appointments:[{id:'untouched'}]});
  const security=await db.query(`select relname,relrowsecurity from pg_class where relname in ('organizations','organization_memberships') order by relname`);
  assert.equal(security.rows.length,2);
  assert.ok(security.rows.every(row=>row.relrowsecurity===true));
  const policies=await db.query(`select count(*)::int as count from pg_policies where schemaname='public' and tablename in ('organizations','organization_memberships')`);
  assert.equal(policies.rows[0].count,0);
  const acl=await db.query(`select has_table_privilege('anon','public.organizations','SELECT') as anon,has_table_privilege('authenticated','public.organization_memberships','SELECT') as authenticated,has_table_privilege('service_role','public.organization_memberships','SELECT') as service`);
  assert.deepEqual(acl.rows[0],{anon:false,authenticated:false,service:true});
 }finally{await db.close();}
});

test('membership is isolated by organization and rejects duplicate or invalid roles',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   create role anon;create role authenticated;create role service_role bypassrls;
   create table public.users(id bigint primary key,role text not null);
   insert into public.users(id,role) values(1,'general_manager'),(2,'secretary');
  `);
  await db.exec(sql);
  const extra=await db.query(`insert into public.organizations(slug,name,kind) values('consultorio-teste','Consultório Teste','CLINIC') returning id`);
  const second=extra.rows[0].id;
  const current=await db.query(`select organization_id from public.organization_memberships where user_id=2`);
  assert.equal(current.rows.length,1);
  assert.notEqual(current.rows[0].organization_id,second);
  await db.query('insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)',[second,2,'general_manager']);
  const roles=await db.query('select role from public.organization_memberships where organization_id=$1 and user_id=$2',[second,2]);
  assert.equal(roles.rows[0].role,'general_manager');
  const original=await db.query('select role from public.organization_memberships where user_id=2 and organization_id<>$1',[second]);
  assert.equal(original.rows[0].role,'secretary');
  await assert.rejects(()=>db.query('insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)',[second,2,'doctor']));
  await assert.rejects(()=>db.query('insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)',[second,1,'admin']));
 }finally{await db.close();}
});

test('migration has no permissive client policies or modifications to legacy records',()=>{
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON TABLE/);
 assert.doesNotMatch(sql,/CREATE\s+POLICY|ALTER\s+TABLE\s+public\.(?:users|app_state)|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/i);
});
