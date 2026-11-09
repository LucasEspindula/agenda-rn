import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {loadTs} from './load-ts.mjs';

// 2B-M2b: autocadastro com confirmação de e-mail, recuperação de senha e convites.
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').split('\r\n').join('\n');
const m2a=read('supabase/migrations/20261109150000_accounts_multi_organization.sql');
const m2b=read('supabase/migrations/20261110120000_signup_email_invites.sql');
const A='00000000-0000-4000-8000-00000000000a',B='00000000-0000-4000-8000-00000000000b';
const H='pbkdf2-sha256$600000$'+Buffer.alloc(32,7).toString('base64'),S=Buffer.alloc(16,3).toString('base64');
const tok=n=>createHash('sha256').update('token-'+n).digest('hex');

async function fixture(){
 const db=new PGlite();
 await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.organizations(id uuid primary key,slug text unique,name text,kind text default 'MANAGEMENT_COMPANY',active boolean default true);
  insert into public.organizations(id,slug,name) values ('${A}','rn-gestao','RN Gestão'),('${B}','outra','Outra');
  create table public.users(id bigserial primary key,email text unique,name text,role text,active boolean default true,doctor_id text,password_hash text,password_salt text,created_at timestamptz default now(),updated_at timestamptz default now());
  create table public.organization_memberships(organization_id uuid,user_id bigint,role text,active boolean default true,updated_at timestamptz default now(),primary key(organization_id,user_id));
  create table public.sessions(id bigserial primary key,token_hash text unique,user_id bigint,expires_at timestamptz);
  create table public.agenda_settings(organization_id uuid primary key,revision timestamptz default now());
  create table public.doctors(id text primary key,organization_id uuid not null,name text,active boolean default true,scheduling_enabled boolean default true,billing_enabled boolean default false,invoice_enabled boolean default false);
  create table public.agenda_access(id bigserial primary key,user_id bigint,professional_id text,organization_id uuid);
  create table public.directory_audit(id bigserial primary key,actor_id bigint,kind text,record_id text,before_data jsonb,after_data jsonb,organization_id uuid);
  insert into public.users(id,email,name,role) values (1,'dono@t.test','Dono','general_manager'),(2,'sec@t.test','Sec','secretary'),(3,'outro@t.test','Gerente B','general_manager');
  select setval('public.users_id_seq',10);
  insert into public.organization_memberships(organization_id,user_id,role) values ('${A}',1,'general_manager'),('${A}',2,'secretary'),('${B}',3,'general_manager');
  insert into public.agenda_settings values ('${A}'),('${B}');
  insert into public.doctors(id,organization_id,name) values ('docA','${A}','Dr. A'),('docA2','${A}','Dr. A2'),('docB','${B}','Dr. B');
 `);
 await db.exec(m2a);
 await db.exec(`insert into public.accounts(id,name,owner_user_id) values ('00000000-0000-4000-8000-0000000000bb','Outra conta',3); update public.organizations set account_id='00000000-0000-4000-8000-0000000000bb' where id='${B}';
  create trigger g before insert or update or delete on public.agenda_access for each row execute function public.guard_tenant_row('user:user_id','doctor:professional_id');
  create trigger g before insert or update or delete on public.directory_audit for each row execute function public.guard_tenant_row('user:actor_id');`);
 await db.exec(m2b);
 return db;
}
async function fails(db,sql,params=[]){try{await db.query(sql,params);return null}catch(e){return e.message}}
const one=async(db,sql,params=[])=>(await db.query(sql,params)).rows[0];

test('existing users stay verified; sign-up creates an unverified owner with a trial account and its organization',async()=>{
 const db=await fixture();
 try{
  assert.equal((await one(db,`select count(*)::int n from public.users where email_verified_at is null`)).n,0);
  const id=(await one(db,`select public.signup_account('Nova@Clinica.test','Ana Nova',$1,$2,'Clínica Nova','CLINIC','v1',$3) v`,[H,S,tok(1)])).v;
  const u=await one(db,'select email,role,email_verified_at,terms_version from public.users where id=$1',[id]);
  assert.deepEqual([u.email,u.role,u.email_verified_at,u.terms_version],['nova@clinica.test','general_manager',null,'v1']);
  const acc=await one(db,`select a.plan,a.max_organizations,o.kind,o.slug from public.accounts a join public.organizations o on o.account_id=a.id where a.owner_user_id=$1`,[id]);
  assert.equal(acc.plan,'trial');assert.equal(acc.max_organizations,1);assert.equal(acc.kind,'CLINIC');assert.match(acc.slug,/^clinica-nova-[0-9a-f]{6}$/);
  assert.ok(await one(db,`select 1 from public.organization_memberships where user_id=$1 and role='general_manager' and active`,[id]));
  assert.match(await fails(db,`select public.signup_account('nova@clinica.test','X Y',$1,$2,'Outra','CLINIC','v1',$3)`,[H,S,tok(2)]),/Já existe uma conta/);
  assert.match(await fails(db,`select public.signup_account('x@y.test','X Y','senha-em-texto',$1,'Org','CLINIC','v1',$2)`,[S,tok(3)]),/Credencial inválida/);
  assert.match(await fails(db,`select public.signup_account('x@y.test','X Y',$1,$2,'Org','CLINIC','',$3)`,[H,S,tok(4)]),/termos/);
  assert.match(await fails(db,`select public.signup_account('x@y.test','X Y',$1,$2,'Org','HOSPITAL','v1',$3)`,[H,S,tok(5)]),/Tipo de organização/);
 }finally{await db.close()}
});

test('e-mail confirmation links work once and expire; renewal replaces the old link',async()=>{
 const db=await fixture();
 try{
  const id=(await one(db,`select public.signup_account('c@t.test','Conf Test',$1,$2,'Org C','CLINIC','v1',$3) v`,[H,S,tok(10)])).v;
  assert.equal((await one(db,`select public.renew_email_verification('c@t.test',$1) v`,[tok(11)])).v,id);
  assert.match(await fails(db,'select public.confirm_email($1)',[tok(10)]),/Link inválido/,'old link was replaced');
  assert.equal((await one(db,'select public.confirm_email($1) v',[tok(11)])).v,id);
  assert.ok((await one(db,'select email_verified_at v from public.users where id=$1',[id])).v);
  assert.match(await fails(db,'select public.confirm_email($1)',[tok(11)]),/Link inválido/,'single use');
  assert.equal((await one(db,`select public.renew_email_verification('c@t.test',$1) v`,[tok(12)])).v,null,'already verified');
  await db.exec(`insert into public.auth_tokens(token_hash,kind,user_id,email,expires_at) values ('${tok(13)}','verify_email',${id},'c@t.test',now()-interval '1 minute')`);
  assert.match(await fails(db,'select public.confirm_email($1)',[tok(13)]),/expirado/);
 }finally{await db.close()}
});

test('password reset never reveals unknown e-mails, keeps only the newest link and works once',async()=>{
 const db=await fixture();
 try{
  assert.equal((await one(db,`select public.request_password_reset('ninguem@t.test',$1) v`,[tok(20)])).v,null);
  assert.equal((await one(db,`select public.request_password_reset(' SEC@t.test ',$1) v`,[tok(21)])).v.email,'sec@t.test');
  await db.query(`select public.request_password_reset('sec@t.test',$1)`,[tok(22)]);
  assert.match(await fails(db,'select public.reset_password($1,$2,$3)',[tok(21),H,S]),/Link inválido/,'older link invalidated');
  assert.match(await fails(db,'select public.reset_password($1,$2,$3)',[tok(22),'fraca',S]),/Credencial inválida/);
  assert.equal(Number((await one(db,'select public.reset_password($1,$2,$3) v',[tok(22),H,S])).v),2);
  assert.equal((await one(db,'select password_hash v from public.users where id=2')).v,H);
  assert.match(await fails(db,'select public.reset_password($1,$2,$3)',[tok(22),H,S]),/Link inválido/,'single use');
 }finally{await db.close()}
});

test('invites: only managers of the active organization, agendas of that organization, accepted once',async()=>{
 const db=await fixture();
 try{
  assert.match(await fails(db,`select public.create_invite(2,'${A}','novo@t.test',null,'secretary','["docA"]',null,$1)`,[tok(30)]),/gerência/);
  assert.match(await fails(db,`select public.create_invite(3,'${A}','novo@t.test',null,'secretary','["docA"]',null,$1)`,[tok(30)]),/Acesso à organização negado/);
  assert.match(await fails(db,`select public.create_invite(1,'${A}','novo@t.test',null,'secretary','["docB"]',null,$1)`,[tok(30)]),/Agenda inexistente/);
  assert.match(await fails(db,`select public.create_invite(1,'${A}','sec@t.test',null,'secretary','[]',null,$1)`,[tok(30)]),/já faz parte/);
  assert.match(await fails(db,`select public.create_invite(1,'${A}','outro@t.test',null,'secretary','[]',null,$1)`,[tok(30)]),/outro papel/);
  const info=(await one(db,`select public.create_invite(1,'${A}','Novo@T.test','Nova Pessoa','secretary','["docA"]',null,$1) v`,[tok(31)])).v;
  assert.equal(info.existingUser,false);
  assert.equal((await one(db,'select public.invite_info($1) v',[tok(31)])).v.organization,'RN Gestão');
  assert.match(await fails(db,'select public.accept_invite($1,null,$2,null,null)',[tok(31),'Nova Pessoa']),/Credencial inválida/);
  const uid=Number((await one(db,'select public.accept_invite($1,null,null,$2,$3) v',[tok(31),H,S])).v);
  const u=await one(db,'select email,role,email_verified_at is not null verified,name from public.users where id=$1',[uid]);
  assert.deepEqual([u.email,u.role,u.verified,u.name],['novo@t.test','secretary',true,'Nova Pessoa']);
  assert.deepEqual((await db.query('select professional_id from public.agenda_access where user_id=$1',[uid])).rows.map(r=>r.professional_id),['docA']);
  assert.equal((await one(db,'select organization_id v from public.agenda_access where user_id=$1',[uid])).v,A);
  assert.match(await fails(db,'select public.accept_invite($1,null,null,$2,$3)',[tok(31),H,S]),/inválido ou expirado/,'single use');
  assert.equal((await one(db,'select public.invite_info($1) v',[tok(31)])).v,null);
 }finally{await db.close()}
});

test('an existing account joins another organization only while logged in with the invited e-mail',async()=>{
 const db=await fixture();
 try{
  await db.query(`select public.create_invite(3,'${B}','dono@t.test',null,'general_manager',null,null,$1)`,[tok(40)]);
  assert.equal((await one(db,'select public.invite_info($1) v',[tok(40)])).v.existingUser,true);
  assert.match(await fails(db,'select public.accept_invite($1,null,null,null,null)',[tok(40)]),/Entre com a conta/);
  assert.match(await fails(db,'select public.accept_invite($1,3,null,null,null)',[tok(40)]),/Entre com a conta/,'another logged-in user cannot take it');
  await db.query('select public.accept_invite($1,1,null,null,null)',[tok(40)]);
  assert.deepEqual((await db.query(`select organization_id from public.organization_memberships where user_id=1 and active order by organization_id`)).rows.map(r=>r.organization_id),[A,B]);
  assert.equal((await one(db,`select password_hash v from public.users where id=1`)).v,null,'existing password untouched');
 }finally{await db.close()}
});

test('server: unverified logins are refused, e-mail is fail-closed in production, tokens are hashed, sign-up is gated',async()=>{
 const login=read('app/api/auth/login/route.ts');
 assert.match(login,/if \(!account\.email_verified_at\) return Response\.json\(\{ error: "Confirme seu e-mail/);
 assert.match(login,/purge_expired_auth/);
 const prev={...process.env};
 try{
  delete process.env.RESEND_API_KEY;process.env.VERCEL_ENV='production';
  const email=loadTs('lib/email.ts',{'@/lib/security/http':{HttpError:class extends Error{constructor(s,m){super(m);this.status=s}}}});
  await assert.rejects(email.sendMail({to:'a@b.test',subject:'s',text:'t',html:'h'}),e=>e.status===503);
  const {token,hash}=email.newEmailToken();
  assert.ok(email.validEmailToken(token));assert.match(hash,/^[0-9a-f]{64}$/);assert.notEqual(token,hash);
  assert.equal(email.hashEmailToken(token),hash);
  process.env.APP_ORIGIN='https://app.exemplo.test';
  assert.equal(email.appOrigin(new Request('https://atacante.test/x')),'https://app.exemplo.test','links never use the request host');
 }finally{process.env=prev}
 assert.match(read('app/api/auth/signup/route.ts'),/if \(!publicSignupEnabled\(\)\) throw new HttpError\(404/);
 for(const p of ['app/api/auth/signup/route.ts','app/api/auth/forgot/route.ts','app/api/auth/reset/route.ts','app/api/auth/resend-confirmation/route.ts','app/api/invites/route.ts','app/api/invites/accept/route.ts'])
  assert.match(read(p),/consumeLimit\(/,p);
 assert.match(read('app/api/auth/forgot/route.ts'),/Se o e-mail estiver cadastrado/,'same answer for unknown e-mails');
});
