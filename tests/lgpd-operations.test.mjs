import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {loadTs} from './load-ts.mjs';

// LGPD e operação: eventos de segurança imutáveis, manutenção, exportação/anonimização restritas.
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').split('\r\n').join('\n');
const sql=read('supabase/migrations/20261110180000_lgpd_operations.sql');
const pick=(start,end)=>sql.slice(sql.indexOf(start),sql.indexOf(end,sql.indexOf(start)+1));

test('security events are append-only; maintenance removes expired sessions, links, limits and year-old events',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role;
   create table public.organizations(id uuid primary key); create table public.users(id bigint primary key);
   create table public.sessions(id bigserial primary key,expires_at timestamptz); create table public.auth_tokens(id bigserial primary key,expires_at timestamptz);
   create table public.security_rate_limits(key text primary key,hits int,expires_at timestamptz);
   insert into public.users values (1);`);
  await db.exec(pick('create table if not exists public.security_events','-- 2.'));
  await db.exec(pick('create or replace function public.run_maintenance()','create or replace function public.health_check()'));
  await db.exec(`select public.record_security_event(null,1,'login_success',null,'{}',null);
   insert into public.security_events(kind,created_at) values ('login_failure',now()-interval '400 days');
   insert into public.sessions(expires_at) values (now()-interval '2 days'),(now()+interval '1 hour');
   insert into public.auth_tokens(expires_at) values (now()-interval '40 days'),(now()-interval '1 day');
   insert into public.security_rate_limits values ('a',1,now()-interval '1 minute'),('b',1,now()+interval '1 minute');`);
  await assert.rejects(db.exec(`update public.security_events set kind='login_failure'`),/imutável/);
  await assert.rejects(db.exec(`delete from public.security_events`),/imutável/);
  await assert.rejects(db.exec(`insert into public.security_events(kind) values ('qualquer')`),/check/i);
  const removed=(await db.query('select public.run_maintenance() v')).rows[0].v;
  assert.deepEqual(removed,{sessions:1,tokens:1,rateLimits:1,securityEvents:1});
  assert.equal((await db.query('select count(*)::int n from public.security_events')).rows[0].n,1,'recent event kept');
  await assert.rejects(db.exec(`delete from public.security_events`),/imutável/,'flag is local to maintenance');
 }finally{await db.close()}
});

test('anonymization keeps legal retention and scrubs every copy of personal data',()=>{
 const fn=pick('create or replace function public.anonymize_patient','-- 5.');
 assert.match(fn,/require_organization_manager\(p_actor,p_org\)/);
 assert.match(fn,/from public\.attendances where patient_id=p_patient and organization_id=p_org\) then\s+raise exception 'Paciente com atendimento realizado/);
 assert.match(fn,/date>=current_date\) then\s+raise exception 'Cancele os agendamentos futuros/);
 for(const part of ["name='Paciente anonimizado',cpf=null,phone=null,email=null","update public.patient_history_events set text=","update public.appointment_reschedules set reason=",
  "update public.audit_logs set description=","update public.agenda_requests set","update public.agenda_row_versions set data=public.agenda_row_json('patients'",
  "delete from public.surgery_documents where patient_id=p_patient and organization_id=p_org","'patient_anonymized'"])
  assert.ok(fn.includes(part),part);
 assert.match(sql,/patient_history_events','appointment_reschedules'\) and coalesce\(current_setting\('rn\.anonymize',true\),''\)<>'on' then\s+raise exception 'Histórico é imutável'/);
 const exp=pick('create or replace function public.export_patient_data','-- 4.');
 assert.match(exp,/require_organization_manager/);assert.match(exp,/'patient_export'/);assert.match(exp,/organization_id=p_org/);
});

test('routes: managers only, explicit confirmation, storage cleanup, secret-protected cron, harmless health',async()=>{
 const anon=read('app/api/patients/[id]/anonymize/route.ts'),exp=read('app/api/patients/[id]/export/route.ts');
 assert.match(anon,/isManager\(session\.account\.role\)/);assert.match(anon,/confirm: z\.literal\("ANONIMIZAR"\)/);
 assert.match(anon,/storage\.from\(BUCKET\)\.remove\(paths\)/);assert.match(anon,/secureMutation\(anonymize\)/);
 assert.match(exp,/isManager\(session\.account\.role\)/);assert.match(exp,/content-disposition/);assert.match(exp,/private, no-store/);
 assert.deepEqual(JSON.parse(read('vercel.json')).crons,[{path:'/api/cron/maintenance',schedule:'0 6 * * *'}]);
 const db={rpc:async()=>({data:{sessions:0},error:null})};
 const prev=process.env.CRON_SECRET;
 try{
  delete process.env.CRON_SECRET;
  let cron=loadTs('app/api/cron/maintenance/route.ts',{'@/lib/supabase-admin':{getSupabaseAdmin:()=>db}});
  assert.equal((await cron.GET(new Request('https://x.test/api/cron/maintenance'))).status,503,'fail-closed without secret');
  process.env.CRON_SECRET='segredo-de-teste-123';
  cron=loadTs('app/api/cron/maintenance/route.ts',{'@/lib/supabase-admin':{getSupabaseAdmin:()=>db}});
  assert.equal((await cron.GET(new Request('https://x.test/api/cron/maintenance',{headers:{authorization:'Bearer errado'}}))).status,401);
  assert.equal((await cron.GET(new Request('https://x.test/api/cron/maintenance',{headers:{authorization:'Bearer segredo-de-teste-123'}}))).status,200);
 }finally{if(prev===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=prev}
 const health=loadTs('app/api/health/route.ts',{'@/lib/supabase-admin':{getSupabaseAdmin:()=>({rpc:async()=>({data:{},error:null})})}});
 const body=await (await health.GET()).json();
 assert.deepEqual(Object.keys(body).sort(),['db','ms','ok','version']);
});

test('auth flows leave a security trail without storing e-mails or IPs in clear',()=>{
 const login=read('app/api/auth/login/route.ts'),events=read('lib/security/events.ts');
 for(const kind of ['login_failure','login_unverified','login_success'])assert.match(login,new RegExp(`recordSecurityEvent\\("${kind}"`));
 assert.match(login,/target: hashEmail\(email\)/);
 assert.match(events,/createHmac\("sha256", secret\)\.update\("ip:"/);
 assert.match(read('app/api/auth/reset/route.ts'),/recordSecurityEvent\("password_reset"/);
 assert.match(read('app/api/invites/accept/route.ts'),/recordSecurityEvent\("invite_accepted"/);
 assert.match(read('app/api/organizations/route.ts'),/recordSecurityEvent\("organization_switch"/);
 const ui=read('public/legacy-app.js');
 assert.match(ui,/if\(\(window\.AgendaAuth\|\|\{\}\)\.role!=="general_manager"\)\{box\?\.remove\(\);return\}/,'LGPD panel only for managers');
 assert.match(ui,/mountPatientPrivacyPanel\(id\);openModal\("patientDetailModal"\)/);
});
