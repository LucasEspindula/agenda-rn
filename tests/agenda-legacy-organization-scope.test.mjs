import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const foundation = readFileSync(new URL('../supabase/migrations/20261028203004_organization_foundation.sql', import.meta.url), 'utf8');
const agendaScope = readFileSync(new URL('../supabase/migrations/20261029184300_agenda_organization_scope.sql', import.meta.url), 'utf8');
const directoryScope = readFileSync(new URL('../supabase/migrations/20261029192000_legacy_agenda_directory_org_scope.sql', import.meta.url), 'utf8');

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.users(id bigint primary key, role text not null, active boolean not null default true);
    create table public.app_state(id integer primary key, payload jsonb not null, version bigint not null default 1, updated_at timestamptz not null default now());
    create table public.doctors(
      id text primary key, name text, crm text, specialty text, category text,
      active boolean, scheduling_enabled boolean, billing_enabled boolean, invoice_enabled boolean,
      updated_at timestamptz default now(), updated_by bigint
    );
    create table public.doctor_agendas(doctor_id text primary key,active boolean,settings jsonb,updated_at timestamptz,updated_by bigint);
    create table public.attendances(id text primary key);
    create table public.directory_audit(actor_id bigint,kind text,record_id text,before_data jsonb,after_data jsonb);
    create table public.agenda_requests(id text primary key,status text,decided_by bigint,decision_note text,decided_at timestamptz);
    create table public.audit_logs(id text,actor_user_id bigint,actor_name text,actor_role text,action text,professional_id text,appointment_id text,patient_id text,description text,metadata jsonb,created_at timestamptz);
    create table public.notifications(id text,user_id bigint,type text,request_id text,message text,created_at timestamptz);
    create function public.financial_operation(bigint,text,text) returns void language plpgsql as $$ begin return; end; $$;
    create function public.valid_medical_specialty(text) returns boolean language sql immutable as $$ select true $$;
    create function public.is_anesthesiologist(text) returns boolean language sql immutable as $$ select false $$;
    insert into public.users(id,role) values(1,'general_manager'),(2,'secretary'),(3,'doctor');
    insert into public.app_state(id,payload) values(1,'{"patients":[],"appointments":[]}');
  `);
  await db.exec(foundation);
  await db.exec(agendaScope);
  await db.exec(directoryScope);
  return db;
}

async function currentOrg(db, actor) {
  return (await db.query('select public.require_rn_agenda_actor_organization($1) as id', [actor])).rows[0].id;
}

test('organization helper resolves active actor membership for the only operating organization', async () => {
  const db = await fixture();
  try {
    const id = (await db.query("select id from public.organizations where slug='rn-gestao'")).rows[0].id;
    assert.equal(await currentOrg(db, 1), id);
    assert.equal(await currentOrg(db, 2), id);
    assert.equal(await currentOrg(db, 3), id);
    await assert.rejects(currentOrg(db, null), /Acesso à organização negado/);
  } finally { await db.close(); }
});

test('deactivated account, membership revocation and mismatched roles are rejected', async () => {
  const db = await fixture();
  try {
    await db.exec('update public.users set active=false where id=1');
    await assert.rejects(currentOrg(db, 1), /Acesso à organização negado/);
    await db.exec('update public.users set active=true where id=1');
    await db.exec('update public.organization_memberships set active=false where user_id=1');
    await assert.rejects(currentOrg(db, 1), /Acesso à organização negado/);
    await db.exec("update public.organization_memberships set active=true,role='doctor' where user_id=1");
    await assert.rejects(currentOrg(db, 1), /Acesso à organização negado/);
  } finally { await db.close(); }
});

test('second organization fails closed: no legacy operation is automatically multi-tenant', async () => {
  const db = await fixture();
  try {
    await db.exec("insert into public.organizations(slug,name,kind) values('second-test','Second test organization','CLINIC')");
    await assert.rejects(currentOrg(db, 1), /Organização de operação inválida/);
    await assert.rejects(
      db.query("select public.save_doctor_directory(1,'doctor',$1::jsonb)", [JSON.stringify({name:'Dr Test',specialty:'Cardiologia'})]),
      /Organização de operação inválida/
    );
  } finally { await db.close(); }
});

test('directory and manual attendance require active membership AND managerial role', async () => {
  const db = await fixture();
  try {
    await assert.rejects(
      db.query("select public.save_doctor_directory(2,'doctor','{}'::jsonb)"),
      /Somente a gerência/
    );
    await assert.rejects(
      db.query("select public.save_manual_attendance(2,'{}'::jsonb)"),
      /Acesso restrito à gerência/
    );
    await db.exec('update public.organization_memberships set active=false where user_id=1');
    await assert.rejects(
      db.query("select public.save_manual_attendance(1,'{}'::jsonb)"),
      /Acesso à organização negado/
    );
  } finally { await db.close(); }
});

test('directory write works for valid RN Gestão manager and updates scoped state revision', async () => {
  const db = await fixture();
  try {
    const before = (await db.query('select updated_at from public.app_state')).rows[0].updated_at;
    const payload = {name:'Doctor Test',crm:'CRM123',specialty:'Cardiologia',active:true,scheduling_enabled:true,billing_enabled:true,invoice_enabled:true};
    const result = await db.query("select public.save_doctor_directory(1,'doctor',$1::jsonb) as id",[JSON.stringify(payload)]);
    const id = result.rows[0].id;
    assert.ok(id);
    assert.equal((await db.query('select name from public.doctors where id=$1',[id])).rows[0].name,'Doctor Test');
    assert.equal((await db.query('select count(*)::int as n from public.doctor_agendas where doctor_id=$1',[id])).rows[0].n,1);
    const after = (await db.query('select updated_at from public.app_state')).rows[0].updated_at;
    assert.ok(new Date(after) > new Date(before));
  } finally { await db.close(); }
});

test('all app_state predicates in migrated functions use organization_id rather than id=1', () => {
  for (const functionName of ['save_doctor_directory','save_manual_attendance']) {
    const body = directoryScope.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.' + functionName + '\\([\\s\\S]*?\\$function\\$;', 'i'))?.[0];
    assert.ok(body, functionName);
    assert.match(body,/rn_org_id:=public.require_rn_agenda_actor_organization\(p_actor\)/);
    assert.match(body,/organization_id=rn_org_id/);
    assert.doesNotMatch(body,/\b(?:s\.)?id\s*=\s*1\b/);
  }
  assert.match(directoryScope,/REVOKE ALL ON FUNCTION public.require_rn_agenda_actor_organization\(bigint\) FROM PUBLIC, anon, authenticated;/);
});
