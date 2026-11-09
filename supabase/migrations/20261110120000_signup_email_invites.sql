-- Fase 2B-M2b — contratar pelo site, confirmação de e-mail, recuperação de senha e convites.
-- Tokens de e-mail guardam só o hash SHA-256; valem uma vez e expiram.
-- Contas criadas pela gerência (senha inicial) continuam verificadas; só o autocadastro
-- nasce com e-mail não confirmado e não entra até confirmar.

-- 1. Usuários: confirmação de e-mail e aceite dos termos.
alter table public.users add column if not exists email_verified_at timestamptz default now();
update public.users set email_verified_at=coalesce(created_at,now()) where email_verified_at is null;
alter table public.users add column if not exists terms_version text;
alter table public.users add column if not exists terms_accepted_at timestamptz;

-- 2. Tokens enviados por e-mail.
create table if not exists public.auth_tokens(
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
 kind text not null check (kind in ('verify_email','reset_password','invite')),
 user_id bigint references public.users(id),
 email text not null,
 organization_id uuid references public.organizations(id),
 role text check (role in ('general_manager','secretary','doctor')),
 payload jsonb not null default '{}'::jsonb,
 created_by bigint references public.users(id),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 used_at timestamptz
);
create index if not exists auth_tokens_kind_email_idx on public.auth_tokens(kind,lower(email)) where used_at is null;
create index if not exists auth_tokens_expires_idx on public.auth_tokens(expires_at);
alter table public.auth_tokens enable row level security;
revoke all on public.auth_tokens from public,anon,authenticated;
grant select,insert,update,delete on public.auth_tokens to service_role;

create or replace function public.valid_password_credentials(p_hash text,p_salt text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(p_hash,'') ~ '^pbkdf2-sha256\$600000\$[A-Za-z0-9+/=]+$' and length(coalesce(p_salt,''))>=20
$$;

create or replace function public.organization_slug(p_name text,p_id uuid) returns text
language sql immutable set search_path='' as $$
 select left(coalesce(nullif(trim(both '-' from regexp_replace(lower(translate(btrim(p_name),'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn')),'[^a-z0-9]+','-','g')),''),'organizacao'),48)
  ||'-'||left(replace(p_id::text,'-',''),6)
$$;

-- 3. Autocadastro: pessoa titular + conta (plano de teste, 1 organização) + organização.
create or replace function public.signup_account(p_email text,p_name text,p_hash text,p_salt text,p_org_name text,p_org_kind text,p_terms_version text,p_token_hash text)
returns bigint language plpgsql set search_path='' as $$
declare v_email text:=lower(btrim(p_email)); v_user bigint; v_acc uuid; v_org uuid:=gen_random_uuid();
begin
 perform pg_advisory_xact_lock(194701,8);
 if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(v_email)>254 then raise exception 'E-mail inválido'; end if;
 if coalesce(char_length(btrim(p_name)),0) not between 2 and 120 then raise exception 'Informe seu nome'; end if;
 if coalesce(char_length(btrim(p_org_name)),0) not between 2 and 120 then raise exception 'Informe o nome da organização'; end if;
 if p_org_kind not in ('MANAGEMENT_COMPANY','CLINIC','SOLO_DOCTOR') then raise exception 'Tipo de organização inválido'; end if;
 if not public.valid_password_credentials(p_hash,p_salt) then raise exception 'Credencial inválida'; end if;
 if coalesce(btrim(p_terms_version),'')='' then raise exception 'Aceite os termos de uso'; end if;
 if exists(select 1 from public.users where lower(email)=v_email) then raise exception 'Já existe uma conta com este e-mail'; end if;
 insert into public.users(email,name,role,active,password_hash,password_salt,email_verified_at,terms_version,terms_accepted_at)
  values(v_email,btrim(p_name),'general_manager',true,p_hash,p_salt,null,btrim(p_terms_version),now()) returning id into v_user;
 insert into public.accounts(name,owner_user_id,plan,max_organizations) values(btrim(p_org_name),v_user,'trial',1) returning id into v_acc;
 insert into public.organizations(id,slug,name,kind,active,account_id) values(v_org,public.organization_slug(p_org_name,v_org),btrim(p_org_name),p_org_kind,true,v_acc);
 insert into public.agenda_settings(organization_id) values(v_org);
 insert into public.organization_memberships(organization_id,user_id,role,active) values(v_org,v_user,'general_manager',true);
 insert into public.auth_tokens(token_hash,kind,user_id,email,organization_id,expires_at) values(p_token_hash,'verify_email',v_user,v_email,v_org,now()+interval '48 hours');
 return v_user;
end;$$;

-- Novo link de confirmação (substitui os anteriores). Nulo quando não há o que confirmar.
create or replace function public.renew_email_verification(p_email text,p_token_hash text) returns bigint
language plpgsql set search_path='' as $$
declare v_user bigint;
begin
 select id into v_user from public.users where lower(email)=lower(btrim(p_email)) and active and email_verified_at is null;
 if v_user is null then return null; end if;
 update public.auth_tokens set used_at=now() where kind='verify_email' and user_id=v_user and used_at is null;
 insert into public.auth_tokens(token_hash,kind,user_id,email,expires_at) values(p_token_hash,'verify_email',v_user,lower(btrim(p_email)),now()+interval '48 hours');
 return v_user;
end;$$;

create or replace function public.confirm_email(p_token_hash text) returns bigint
language plpgsql set search_path='' as $$
declare t public.auth_tokens%rowtype;
begin
 select * into t from public.auth_tokens where token_hash=p_token_hash and kind='verify_email' for update;
 if not found or t.used_at is not null or t.expires_at<=now() then raise exception 'Link inválido ou expirado'; end if;
 update public.auth_tokens set used_at=now() where id=t.id;
 update public.users set email_verified_at=coalesce(email_verified_at,now()) where id=t.user_id and lower(email)=lower(t.email);
 return t.user_id;
end;$$;

-- 4. Recuperação de senha: o pedido nunca revela se a conta existe (a API responde igual).
create or replace function public.request_password_reset(p_email text,p_token_hash text) returns jsonb
language plpgsql set search_path='' as $$
declare u public.users%rowtype;
begin
 select * into u from public.users where lower(email)=lower(btrim(p_email)) and active;
 if not found then return null; end if;
 update public.auth_tokens set used_at=now() where kind='reset_password' and user_id=u.id and used_at is null;
 insert into public.auth_tokens(token_hash,kind,user_id,email,expires_at) values(p_token_hash,'reset_password',u.id,lower(u.email),now()+interval '1 hour');
 return jsonb_build_object('name',u.name,'email',u.email);
end;$$;

create or replace function public.reset_password(p_token_hash text,p_hash text,p_salt text) returns bigint
language plpgsql set search_path='' as $$
declare t public.auth_tokens%rowtype;
begin
 select * into t from public.auth_tokens where token_hash=p_token_hash and kind='reset_password' for update;
 if not found or t.used_at is not null or t.expires_at<=now() then raise exception 'Link inválido ou expirado'; end if;
 if not public.valid_password_credentials(p_hash,p_salt) then raise exception 'Credencial inválida'; end if;
 update public.auth_tokens set used_at=now() where id=t.id;
 -- Trocar a senha encerra as sessões abertas (trigger users_revoke_sessions) e comprova o e-mail.
 update public.users set password_hash=p_hash,password_salt=p_salt,email_verified_at=coalesce(email_verified_at,now()),updated_at=clock_timestamp()
  where id=t.user_id and active and lower(email)=lower(t.email);
 if not found then raise exception 'Link inválido ou expirado'; end if;
 return t.user_id;
end;$$;

-- 5. Convites: a gerência convida por e-mail para a organização ativa.
create or replace function public.create_invite(p_actor bigint,p_org uuid,p_email text,p_name text,p_role text,p_agenda_ids jsonb,p_doctor_id text,p_token_hash text) returns jsonb
language plpgsql set search_path='' as $$
declare v_email text:=lower(btrim(p_email)); existing public.users%rowtype; grant_id text;
begin
 perform pg_advisory_xact_lock(194701,1);
 perform public.use_organization(p_actor,p_org);
 if not exists(select 1 from public.users u join public.organization_memberships m on m.user_id=u.id and m.organization_id=p_org and m.active and m.role='general_manager'
   where u.id=p_actor and u.role='general_manager' and u.active) then raise exception 'Acesso restrito à gerência'; end if;
 if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(v_email)>254 then raise exception 'E-mail inválido'; end if;
 if p_role not in ('general_manager','secretary','doctor') then raise exception 'Papel inválido'; end if;
 if p_role='doctor' then
  if p_doctor_id is null or not exists(select 1 from public.doctors where id=p_doctor_id and organization_id=p_org) then raise exception 'Selecione um médico existente'; end if;
  if exists(select 1 from public.users where doctor_id=p_doctor_id) then raise exception 'Este médico já possui um acesso'; end if;
 elsif p_doctor_id is not null then raise exception 'Vínculo de médico só vale para o papel médico';
 end if;
 if p_agenda_ids is not null then
  if jsonb_typeof(p_agenda_ids)<>'array' then raise exception 'Agendas inválidas'; end if;
  for grant_id in select jsonb_array_elements_text(p_agenda_ids) loop
   if not exists(select 1 from public.doctors where id=grant_id and organization_id=p_org) then raise exception 'Agenda inexistente'; end if;
  end loop;
 end if;
 select * into existing from public.users where lower(email)=v_email;
 if found then
  if exists(select 1 from public.organization_memberships where user_id=existing.id and organization_id=p_org and active) then raise exception 'Essa pessoa já faz parte da organização'; end if;
  if existing.role<>p_role then raise exception 'Essa pessoa já tem conta com outro papel'; end if;
  if p_role='doctor' then raise exception 'Médico com conta existente ainda não pode ser convidado para outra organização'; end if;
 end if;
 update public.auth_tokens set used_at=now() where kind='invite' and organization_id=p_org and lower(email)=v_email and used_at is null;
 insert into public.auth_tokens(token_hash,kind,email,organization_id,role,payload,created_by,expires_at)
  values(p_token_hash,'invite',v_email,p_org,p_role,jsonb_build_object('name',nullif(btrim(coalesce(p_name,'')),''),'agendaIds',coalesce(p_agenda_ids,'[]'::jsonb),'doctorId',p_doctor_id),p_actor,now()+interval '7 days');
 return jsonb_build_object('existingUser',existing.id is not null,'organization',(select name from public.organizations where id=p_org));
end;$$;

create or replace function public.invite_info(p_token_hash text) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('email',t.email,'role',t.role,'name',t.payload->>'name','organization',o.name,
   'existingUser',exists(select 1 from public.users u where lower(u.email)=t.email))
 from public.auth_tokens t join public.organizations o on o.id=t.organization_id and o.active
 where t.token_hash=p_token_hash and t.kind='invite' and t.used_at is null and t.expires_at>now()
$$;

-- Aceite: conta nova (com senha) ou conta existente já autenticada com o mesmo e-mail.
create or replace function public.accept_invite(p_token_hash text,p_session_user bigint,p_name text,p_hash text,p_salt text) returns bigint
language plpgsql set search_path='' as $$
declare t public.auth_tokens%rowtype; v_user bigint; v_name text; grant_id text;
begin
 perform pg_advisory_xact_lock(194701,1);
 select * into t from public.auth_tokens where token_hash=p_token_hash and kind='invite' for update;
 if not found or t.used_at is not null or t.expires_at<=now() then raise exception 'Convite inválido ou expirado'; end if;
 select id into v_user from public.users where lower(email)=t.email;
 if v_user is not null then
  if p_session_user is distinct from v_user then raise exception 'Entre com a conta deste e-mail para aceitar o convite'; end if;
  if (select role from public.users where id=v_user)<>t.role then raise exception 'Essa pessoa já tem conta com outro papel'; end if;
 else
  if not public.valid_password_credentials(p_hash,p_salt) then raise exception 'Credencial inválida'; end if;
  v_name:=coalesce(nullif(btrim(coalesce(p_name,'')),''),t.payload->>'name');
  if coalesce(char_length(v_name),0) not between 2 and 120 then raise exception 'Informe seu nome'; end if;
  if t.role='doctor' and exists(select 1 from public.users where doctor_id=t.payload->>'doctorId') then raise exception 'Este médico já possui um acesso'; end if;
  insert into public.users(email,name,role,doctor_id,active,password_hash,password_salt,email_verified_at)
   values(t.email,v_name,t.role,case when t.role='doctor' then t.payload->>'doctorId' end,true,p_hash,p_salt,now()) returning id into v_user;
 end if;
 insert into public.organization_memberships(organization_id,user_id,role,active) values(t.organization_id,v_user,t.role,true)
  on conflict(organization_id,user_id) do update set role=excluded.role,active=true,updated_at=clock_timestamp();
 update public.users set active=true where id=v_user;
 perform set_config('rn.organization',t.organization_id::text,true);
 if t.role<>'general_manager' then
  for grant_id in select jsonb_array_elements_text(coalesce(t.payload->'agendaIds','[]'::jsonb)) loop
   insert into public.agenda_access(user_id,professional_id,organization_id) select v_user,grant_id,t.organization_id
    where exists(select 1 from public.doctors where id=grant_id and organization_id=t.organization_id)
      and not exists(select 1 from public.agenda_access where user_id=v_user and professional_id=grant_id);
  end loop;
  if t.role='doctor' and t.payload->>'doctorId' is not null and not exists(select 1 from public.agenda_access where user_id=v_user and professional_id=t.payload->>'doctorId') then
   insert into public.agenda_access(user_id,professional_id,organization_id) values(v_user,t.payload->>'doctorId',t.organization_id);
  end if;
 end if;
 update public.auth_tokens set used_at=now(),user_id=v_user where id=t.id;
 insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data,organization_id)
  values(coalesce(t.created_by,v_user),'invite_accepted',v_user::text,null,jsonb_build_object('email',t.email,'role',t.role,'invite',t.id),t.organization_id);
 perform set_config('rn.organization','',true);
 return v_user;
end;$$;

-- 6. Limpeza de sessões e tokens vencidos (chamada pelo login).
create or replace function public.purge_expired_auth() returns void
language sql set search_path='' as $$
 delete from public.sessions where expires_at<now()-interval '1 day';
 delete from public.auth_tokens where expires_at<now()-interval '30 days';
$$;

revoke all on function public.valid_password_credentials(text,text),public.organization_slug(text,uuid),
 public.signup_account(text,text,text,text,text,text,text,text),public.renew_email_verification(text,text),public.confirm_email(text),
 public.request_password_reset(text,text),public.reset_password(text,text,text),
 public.create_invite(bigint,uuid,text,text,text,jsonb,text,text),public.invite_info(text),
 public.accept_invite(text,bigint,text,text,text),public.purge_expired_auth() from public,anon,authenticated;
grant execute on function public.valid_password_credentials(text,text),public.organization_slug(text,uuid),
 public.signup_account(text,text,text,text,text,text,text,text),public.renew_email_verification(text,text),public.confirm_email(text),
 public.request_password_reset(text,text),public.reset_password(text,text,text),
 public.create_invite(bigint,uuid,text,text,text,jsonb,text,text),public.invite_info(text),
 public.accept_invite(text,bigint,text,text,text),public.purge_expired_auth() to service_role;
