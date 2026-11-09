-- Fase 2B-M2a — contas e várias organizações por pessoa.
-- Conta = quem contrata o RN Integra; organização = operação da conta (empresa de gestão,
-- clínica ou médico autônomo). Uma pessoa pode ter vínculo com várias organizações
-- (mesmo papel em todas nesta etapa) e escolhe a organização ativa da sessão.
-- Toda RPC da aplicação recebe a organização ativa (p_org) e o banco confere o vínculo.

-- 1. Contas.
create table if not exists public.accounts(
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(btrim(name)) between 2 and 120),
 owner_user_id bigint not null references public.users(id),
 plan text not null default 'internal',
 status text not null default 'active' check (status in ('active','suspended','cancelled')),
 max_organizations integer not null default 5 check (max_organizations between 1 and 500),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.accounts enable row level security;
revoke all on public.accounts from public,anon,authenticated;
grant select,insert,update on public.accounts to service_role;

alter table public.organizations add column if not exists account_id uuid references public.accounts(id);
do $$
declare rn uuid; owner bigint; acc uuid;
begin
 select id into rn from public.organizations where slug='rn-gestao';
 if rn is not null and (select account_id from public.organizations where id=rn) is null then
  select m.user_id into owner from public.organization_memberships m join public.users u on u.id=m.user_id
   where m.organization_id=rn and m.active and m.role='general_manager' and u.active order by m.user_id limit 1;
  insert into public.accounts(name,owner_user_id,plan) values('RN Gestão',owner,'internal') returning id into acc;
  update public.organizations set account_id=acc where account_id is null;
 end if;
end $$;
alter table public.organizations alter column account_id set not null;
create index if not exists organizations_account_idx on public.organizations(account_id);

-- 2. Vínculos em várias organizações; organização ativa por sessão.
drop index if exists public.organization_memberships_one_active_per_user;
alter table public.sessions add column if not exists organization_id uuid references public.organizations(id);
alter table public.users add column if not exists last_organization_id uuid references public.organizations(id);

-- Organização válida para o usuário: vínculo ativo, mesmo papel, organização e conta ativas.
create or replace function public.membership_organization_ok(p_user bigint,p_org uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.users u
  join public.organization_memberships m on m.user_id=u.id and m.active and m.role=u.role
  join public.organizations o on o.id=m.organization_id and o.active
  join public.accounts a on a.id=o.account_id and a.status='active'
  where u.id=p_user and u.active and m.organization_id=p_org)
$$;

-- Organização do autor: a escolhida na operação (rn.organization) ou, sem escolha, a única ativa.
create or replace function public.actor_organization_id(p_actor bigint) returns uuid
language plpgsql stable set search_path='' as $$
declare o uuid:=nullif(current_setting('rn.organization',true),'')::uuid; n integer; v uuid;
begin
 if o is not null then
  if public.membership_organization_ok(p_actor,o) then return o; end if;
  raise exception 'Acesso à organização negado';
 end if;
 select count(*),min(m.organization_id::text)::uuid into n,v from public.users u
  join public.organization_memberships m on m.user_id=u.id and m.active and m.role=u.role
  join public.organizations og on og.id=m.organization_id and og.active
  join public.accounts a on a.id=og.account_id and a.status='active'
  where u.id=p_actor and u.active;
 if n=1 then return v; end if;
 if n=0 then raise exception 'Acesso à organização negado'; end if;
 raise exception 'Selecione a organização';
end;$$;

create or replace function public.current_organization_id() returns uuid
language plpgsql stable set search_path='' as $$
declare a bigint:=nullif(current_setting('rn.actor',true),'')::bigint; o uuid:=nullif(current_setting('rn.organization',true),'')::uuid;
begin
 if a is not null then return public.actor_organization_id(a); end if;
 return o;
end;$$;

-- Fixa a organização da operação (transação atual) depois de conferir o vínculo.
create or replace function public.use_organization(p_actor bigint,p_org uuid) returns uuid
language plpgsql set search_path='' as $$
begin
 if p_org is null then raise exception 'Selecione a organização'; end if;
 perform set_config('rn.organization',p_org::text,true);
 return public.actor_organization_id(p_actor);
end;$$;

-- 3. Guarda das tabelas auxiliares: médico define a organização; usuário precisa ter vínculo nela.
create or replace function public.guard_tenant_row() returns trigger
language plpgsql set search_path='' as $$
declare ctx uuid:=public.current_organization_id(); spec text; kind text; col text; ref text; derived uuid; row_data jsonb; target uuid; first_user bigint; i integer;
begin
 if tg_op='DELETE' then
  if ctx is not null and old.organization_id<>ctx then raise exception 'Registro fora da organização atual'; end if;
  return old;
 end if;
 if tg_op='UPDATE' then
  if new.organization_id is distinct from old.organization_id then raise exception 'Alteração de organização não permitida'; end if;
  if ctx is not null and old.organization_id<>ctx then raise exception 'Registro fora da organização atual'; end if;
 end if;
 row_data:=to_jsonb(new); target:=new.organization_id;
 -- Médicos pertencem a uma única organização: definem (ou conferem) a organização da linha.
 for i in 0..tg_nargs-1 loop
  spec:=tg_argv[i]; kind:=split_part(spec,':',1); col:=split_part(spec,':',2); ref:=row_data->>col;
  if ref is null or ref='' then continue; end if;
  if kind='doctor' then
   derived:=(select organization_id from public.doctors where id=ref);
   if derived is null then raise exception 'Vínculo sem organização (%)',col; end if;
   if target is null then target:=derived; elsif derived<>target then raise exception 'Vínculo de outra organização (%)',col; end if;
  elsif first_user is null then first_user:=ref::bigint;
  end if;
 end loop;
 target:=coalesce(target,ctx);
 if target is null and first_user is not null then
  if (select count(*) from public.organization_memberships where user_id=first_user and active)=1 then
   target:=(select organization_id from public.organization_memberships where user_id=first_user and active);
  end if;
 end if;
 if target is null then raise exception 'Registro sem organização'; end if;
 if ctx is not null and target<>ctx then raise exception 'Registro fora da organização atual'; end if;
 -- Pessoas citadas na linha precisam ter (ou ter tido) vínculo com essa organização.
 for i in 0..tg_nargs-1 loop
  spec:=tg_argv[i]; kind:=split_part(spec,':',1); col:=split_part(spec,':',2); ref:=row_data->>col;
  if kind<>'user' or ref is null or ref='' then continue; end if;
  if not exists(select 1 from public.organization_memberships where user_id=ref::bigint and organization_id=target) then
   raise exception 'Vínculo de outra organização (%)',col;
  end if;
 end loop;
 new.organization_id:=target;
 return new;
end;$$;

-- 4. Sessão: organização ativa escolhida, senão a última usada, senão a primeira.
create or replace function public.session_context(p_token_hash text)
returns jsonb language plpgsql stable set search_path to '' as $function$
declare
 v_user public.users%rowtype; v_session public.sessions%rowtype; v_org public.organizations%rowtype; v_account public.accounts%rowtype;
 v_services jsonb:='{"scheduling_enabled":false,"billing_enabled":false,"invoice_enabled":false}'::jsonb;
 v_agendas text[]:='{}'; v_orgs jsonb;
begin
 if p_token_hash is null or length(p_token_hash)>100 then return null; end if;
 select s.* into v_session from public.sessions s where s.token_hash=p_token_hash and s.expires_at>now();
 if not found then return null; end if;
 select u.* into v_user from public.users u where u.id=v_session.user_id;
 if not found or not v_user.active or v_user.role not in ('general_manager','secretary','doctor') then return null; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'slug',o.slug,'name',o.name,'kind',o.kind) order by o.name),'[]'::jsonb) into v_orgs
  from public.organization_memberships m join public.organizations o on o.id=m.organization_id and o.active
  join public.accounts a on a.id=o.account_id and a.status='active'
  where m.user_id=v_user.id and m.active and m.role=v_user.role;
 select o.* into v_org from public.organizations o
  where o.id=coalesce(
   case when public.membership_organization_ok(v_user.id,v_session.organization_id) then v_session.organization_id end,
   case when public.membership_organization_ok(v_user.id,v_user.last_organization_id) then v_user.last_organization_id end,
   (select (x->>'id')::uuid from jsonb_array_elements(v_orgs) x limit 1));
 if not found then return null; end if;
 select a.* into v_account from public.accounts a where a.id=v_org.account_id;
 if v_user.role='doctor' and v_user.doctor_id is not null then
  select jsonb_build_object('scheduling_enabled',d.scheduling_enabled,'billing_enabled',d.billing_enabled,'invoice_enabled',d.invoice_enabled)
   into v_services from public.doctors d where d.id=v_user.doctor_id and d.active and d.organization_id=v_org.id;
  v_services:=coalesce(v_services,'{"scheduling_enabled":false,"billing_enabled":false,"invoice_enabled":false}'::jsonb);
 end if;
 if v_user.role<>'general_manager' then
  select coalesce(array_agg(distinct x),'{}') into v_agendas from (
   select a.professional_id::text x from public.agenda_access a join public.doctors d on d.id=a.professional_id and d.organization_id=v_org.id
    where a.user_id=v_user.id and a.organization_id=v_org.id
   union select v_user.doctor_id where v_user.role='doctor' and v_user.doctor_id is not null
    and exists(select 1 from public.doctors d where d.id=v_user.doctor_id and d.organization_id=v_org.id)
  ) t;
 end if;
 return jsonb_build_object(
  'account',jsonb_build_object('id',v_user.id,'email',v_user.email,'name',v_user.name,'role',v_user.role,'doctorId',v_user.doctor_id),
  'organization',jsonb_build_object('id',v_org.id,'slug',v_org.slug,'name',v_org.name,'kind',v_org.kind),
  'organizations',v_orgs,
  'customer',jsonb_build_object('id',v_account.id,'name',v_account.name,'isOwner',v_account.owner_user_id=v_user.id,
    'maxOrganizations',v_account.max_organizations,
    'organizationCount',(select count(*) from public.organizations where account_id=v_account.id and active)),
  'services',v_services,
  'agendaIds',to_jsonb(v_agendas));
end;$function$;

-- Troca a organização ativa da sessão (e lembra a última usada).
create or replace function public.switch_session_organization(p_token_hash text,p_org uuid) returns boolean
language plpgsql set search_path='' as $$
declare v_user bigint;
begin
 select user_id into v_user from public.sessions where token_hash=p_token_hash and expires_at>now();
 if v_user is null or not public.membership_organization_ok(v_user,p_org) then raise exception 'Acesso à organização negado'; end if;
 update public.sessions set organization_id=p_org where token_hash=p_token_hash;
 update public.users set last_organization_id=p_org where id=v_user;
 return true;
end;$$;

-- 5. Dono da conta cria organizações (limite do plano) e entra como gerente geral.
create or replace function public.create_account_organization(p_actor bigint,p_org uuid,p_name text,p_kind text) returns uuid
language plpgsql set search_path='' as $$
declare acc public.accounts%rowtype; new_id uuid:=gen_random_uuid(); base text; v_slug text;
begin
 perform pg_advisory_xact_lock(194701,7);
 perform public.use_organization(p_actor,p_org);
 select a.* into acc from public.accounts a join public.organizations o on o.account_id=a.id where o.id=p_org for update of a;
 if acc.owner_user_id is distinct from p_actor then raise exception 'Somente o titular da conta cria organizações'; end if;
 if (select role from public.users where id=p_actor)<>'general_manager' then raise exception 'Somente o titular da conta cria organizações'; end if;
 if coalesce(char_length(btrim(p_name)),0) not between 2 and 120 then raise exception 'Informe o nome da organização'; end if;
 if p_kind not in ('MANAGEMENT_COMPANY','CLINIC','SOLO_DOCTOR') then raise exception 'Tipo de organização inválido'; end if;
 if (select count(*) from public.organizations where account_id=acc.id and active)>=acc.max_organizations then raise exception 'Limite de organizações do plano atingido'; end if;
 base:=trim(both '-' from regexp_replace(lower(translate(btrim(p_name),'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn')),'[^a-z0-9]+','-','g'));
 v_slug:=left(coalesce(nullif(base,''),'organizacao'),48)||'-'||left(replace(new_id::text,'-',''),6);
 insert into public.organizations(id,slug,name,kind,active,account_id) values(new_id,v_slug,btrim(p_name),p_kind,true,acc.id);
 perform set_config('rn.organization','',true);
 insert into public.agenda_settings(organization_id) values(new_id);
 insert into public.organization_memberships(organization_id,user_id,role,active) values(new_id,p_actor,'general_manager',true);
 return new_id;
end;$$;

-- 6. Versões das RPCs com a organização ativa (p_org). As de antes continuam valendo
-- para quem tem uma única organização.
create or replace function public.load_agenda_state(p_actor bigint,p_org uuid) returns jsonb
language plpgsql set search_path='' as $$ begin perform public.use_organization(p_actor,p_org); return public.load_agenda_state(p_actor); end;$$;
create or replace function public.load_agenda_window(p_actor bigint,p_since date,p_org uuid) returns jsonb
language plpgsql set search_path='' as $$ begin perform public.use_organization(p_actor,p_org); return public.load_agenda_window(p_actor,p_since); end;$$;
create or replace function public.agenda_revision(p_actor bigint,p_org uuid) returns timestamptz
language plpgsql set search_path='' as $$ begin perform public.use_organization(p_actor,p_org); return public.agenda_revision(p_actor); end;$$;
create or replace function public.agenda_row_bases(p_actor bigint,p_revision timestamptz,p_keys jsonb,p_org uuid) returns jsonb
language plpgsql set search_path='' as $$ begin perform public.use_organization(p_actor,p_org); return public.agenda_row_bases(p_actor,p_revision,p_keys); end;$$;
create or replace function public.apply_agenda_changes(p_actor bigint,p_ops jsonb,p_audit jsonb,p_request_id text,p_decision text,p_note text,p_notification jsonb,p_org uuid) returns jsonb
language plpgsql set search_path='' as $$ begin perform public.use_organization(p_actor,p_org); return public.apply_agenda_changes(p_actor,p_ops,p_audit,p_request_id,p_decision,p_note,p_notification); end;$$;
create or replace function public.save_doctor_with_access(p_actor bigint,p_kind text,p_data jsonb,p_access jsonb,p_credentials jsonb,p_org uuid) returns text
language plpgsql set search_path='' as $$ begin perform public.use_organization(p_actor,p_org); return public.save_doctor_with_access(p_actor,p_kind,p_data,p_access,p_credentials); end;$$;
create or replace function public.save_user_access(p_actor bigint,p_data jsonb,p_credentials jsonb,p_org uuid) returns bigint
language plpgsql set search_path='' as $$ begin perform public.use_organization(p_actor,p_org); return public.save_user_access(p_actor,p_data,p_credentials); end;$$;
create or replace function public.deactivate_user_access(p_actor bigint,p_target bigint,p_org uuid) returns boolean
language plpgsql set search_path='' as $$ begin perform public.use_organization(p_actor,p_org); return public.deactivate_user_access(p_actor,p_target); end;$$;
create or replace function public.submit_agenda_suggestion(p_request jsonb,p_notification jsonb,p_audit jsonb,p_org uuid) returns text
language plpgsql set search_path='' as $$ begin perform public.use_organization(nullif(p_request->>'requested_by','')::bigint,p_org); return public.submit_agenda_suggestion(p_request,p_notification,p_audit); end;$$;

-- Com várias organizações, um mesmo usuário pode ter vínculo em mais de uma: a desativação
-- e a edição de acesso olham só a organização da operação.
create or replace function public.deactivate_user_access(p_actor bigint, p_target bigint)
returns boolean language plpgsql set search_path to '' as $function$
declare org uuid; target_user public.users%rowtype; other_active boolean;
begin
 perform pg_advisory_xact_lock(194701,1);
 org:=public.actor_organization_id(p_actor);
 if not exists (
  select 1 from public.users actor
  join public.organization_memberships membership on membership.user_id=actor.id
  where actor.id=p_actor and actor.role='general_manager' and actor.active
    and membership.organization_id=org and membership.role='general_manager' and membership.active
 ) then raise exception 'Acesso restrito à gerência'; end if;
 if p_target is null or p_target=p_actor then raise exception 'O gerente não pode desativar seu próprio acesso'; end if;
 select * into target_user from public.users where id=p_target for update;
 if not found then raise exception 'Usuário inexistente'; end if;
 if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=p_target and active) then
  if exists(select 1 from public.organization_memberships where organization_id=org and user_id=p_target) then return false; end if;
  raise exception 'Conta fora da organização atual';
 end if;
 update public.organization_memberships set active=false,updated_at=clock_timestamp() where organization_id=org and user_id=p_target;
 select exists(select 1 from public.organization_memberships where user_id=p_target and active) into other_active;
 -- Sem nenhum outro vínculo ativo, a conta inteira é desativada.
 if not other_active then update public.users set active=false,updated_at=clock_timestamp() where id=p_target; end if;
 delete from public.sessions where user_id=p_target and (organization_id=org or not other_active or organization_id is null);
 insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data,organization_id)
 values(p_actor,'user_access',p_target::text,
        jsonb_build_object('email',target_user.email,'role',target_user.role,'active',true),
        jsonb_build_object('email',target_user.email,'role',target_user.role,'active',other_active,'access_revoked',true,'organization_revoked',org),org);
 return true;
end;$function$;

revoke all on function public.membership_organization_ok(bigint,uuid),public.use_organization(bigint,uuid),
 public.switch_session_organization(text,uuid),public.create_account_organization(bigint,uuid,text,text),
 public.load_agenda_state(bigint,uuid),public.load_agenda_window(bigint,date,uuid),public.agenda_revision(bigint,uuid),
 public.agenda_row_bases(bigint,timestamptz,jsonb,uuid),public.apply_agenda_changes(bigint,jsonb,jsonb,text,text,text,jsonb,uuid),
 public.save_doctor_with_access(bigint,text,jsonb,jsonb,jsonb,uuid),public.save_user_access(bigint,jsonb,jsonb,uuid),
 public.deactivate_user_access(bigint,bigint,uuid),public.submit_agenda_suggestion(jsonb,jsonb,jsonb,uuid)
 from public,anon,authenticated;
grant execute on function public.membership_organization_ok(bigint,uuid),public.use_organization(bigint,uuid),
 public.switch_session_organization(text,uuid),public.create_account_organization(bigint,uuid,text,text),
 public.load_agenda_state(bigint,uuid),public.load_agenda_window(bigint,date,uuid),public.agenda_revision(bigint,uuid),
 public.agenda_row_bases(bigint,timestamptz,jsonb,uuid),public.apply_agenda_changes(bigint,jsonb,jsonb,text,text,text,jsonb,uuid),
 public.save_doctor_with_access(bigint,text,jsonb,jsonb,jsonb,uuid),public.save_user_access(bigint,jsonb,jsonb,uuid),
 public.deactivate_user_access(bigint,bigint,uuid),public.submit_agenda_suggestion(jsonb,jsonb,jsonb,uuid)
 to service_role;
