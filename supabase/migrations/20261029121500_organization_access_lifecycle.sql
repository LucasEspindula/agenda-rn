-- RN Integra — access lifecycle bound to the only operating organization.
-- Additive schema change: old clients continue to log in until new code deploys.
-- This stage still does not enable multi-tenant operation.
BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.save_user_access(p_actor bigint, p_data jsonb, p_credentials jsonb DEFAULT NULL::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare uid bigint:=nullif(p_data->>'id','')::bigint; old_account public.users%rowtype; did text:=nullif(p_data->>'doctor_id',''); email_value text:=lower(trim(p_data->>'email')); role_value text:=p_data->>'role'; grant_id text; rn_org_id uuid; desired_active boolean;
begin
 perform pg_advisory_xact_lock(194701,1);
 select id into rn_org_id from public.organizations where slug='rn-gestao' and active for share;
 if rn_org_id is null or (select count(*) from public.organizations)<>1 then raise exception 'Organização de operação inválida. Acesso bloqueado'; end if;
 if not exists(
  select 1 from public.users actor
  join public.organization_memberships membership on membership.user_id=actor.id
  where actor.id=p_actor and actor.role='general_manager' and actor.active
    and membership.organization_id=rn_org_id and membership.role='general_manager' and membership.active
 ) then raise exception 'Acesso restrito à gerência'; end if;
 if role_value not in ('general_manager','secretary','doctor') or role_value is null or email_value is null or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(email_value)>254 then raise exception 'Dados de acesso inválidos'; end if;
 if role_value='doctor' and (did is null or not exists(select 1 from public.doctors where id=did)) then raise exception 'Selecione um médico existente'; end if;
 if role_value<>'doctor' then did:=null; end if;
 if uid=p_actor and role_value<>'general_manager' then raise exception 'Outro gerente deve alterar seu nível de acesso'; end if;
 if uid is not null then
  select * into old_account from public.users where id=uid for update;
  if not found then raise exception 'Usuário inexistente'; end if;
  if not exists(select 1 from public.organization_memberships where organization_id=rn_org_id and user_id=uid)
      or exists(select 1 from public.organization_memberships where user_id=uid and organization_id<>rn_org_id)
   then raise exception 'Conta fora da organização atual'; end if;
  if p_data ? 'updated_at' and old_account.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Acesso alterado por outro usuário. Atualize'; end if;
 end if;
 if p_data ? 'active' and jsonb_typeof(p_data->'active') <> 'boolean' then raise exception 'Situação de acesso inválida'; end if;
 if uid is null and p_data ? 'active' then raise exception 'Novo acesso deve começar ativo'; end if;
 desired_active:=case when uid is null then true when p_data ? 'active' then (p_data->>'active')::boolean else old_account.active end;
 if uid=p_actor and not desired_active then raise exception 'Outro gerente deve desativar seu acesso'; end if;
 if exists(select 1 from public.users where lower(email)=email_value and id is distinct from uid) then raise exception 'Já existe uma conta com este e-mail'; end if;
 if did is not null and exists(select 1 from public.users where doctor_id=did and id is distinct from uid) then raise exception 'Este médico já possui um acesso'; end if;
 if uid is null and p_credentials is null then raise exception 'Informe uma senha inicial'; end if;
 if p_credentials is not null and (coalesce(p_credentials->>'hash','') !~ '^pbkdf2-sha256\$600000\$[A-Za-z0-9+/=]+$' or length(coalesce(p_credentials->>'salt',''))<20) then raise exception 'Credencial inválida'; end if;
 if p_data ? 'agendaIds' then
  if jsonb_typeof(p_data->'agendaIds') is distinct from 'array' then raise exception 'Agendas inválidas'; end if;
  for grant_id in select jsonb_array_elements_text(p_data->'agendaIds') loop
   if not exists(select 1 from public.doctors where id=grant_id) then raise exception 'Agenda inexistente'; end if;
  end loop;
 end if;
 if uid is null then
  insert into public.users(email,name,role,doctor_id,password_hash,password_salt,active) values(email_value,coalesce(p_data->>'name',''),role_value,did,p_credentials->>'hash',p_credentials->>'salt',true) returning id into uid;
  insert into public.organization_memberships(organization_id,user_id,role,active) values(rn_org_id,uid,role_value,true);
 else
  update public.users set email=email_value,name=coalesce(p_data->>'name',''),role=role_value,doctor_id=did,active=desired_active,password_hash=coalesce(p_credentials->>'hash',password_hash),password_salt=coalesce(p_credentials->>'salt',password_salt),updated_at=clock_timestamp() where id=uid;
  update public.organization_memberships set role=role_value,active=desired_active,updated_at=clock_timestamp() where organization_id=rn_org_id and user_id=uid;
  if not found then raise exception 'Vínculo da organização não encontrado'; end if;
 end if;
 delete from public.sessions where user_id=uid;
 if p_data ? 'agendaIds' or role_value='general_manager' then
  delete from public.agenda_access where user_id=uid;
  if role_value<>'general_manager' then
   insert into public.agenda_access(user_id,professional_id) select uid,value from (select distinct jsonb_array_elements_text(p_data->'agendaIds') value) x;
  end if;
 end if;
 if did is not null and not exists(select 1 from public.agenda_access where user_id=uid and professional_id=did) then insert into public.agenda_access(user_id,professional_id) values(uid,did); end if;
 insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data) values(p_actor,'user_access',uid::text,case when old_account.id is not null then jsonb_build_object('email',old_account.email,'role',old_account.role,'doctor_id',old_account.doctor_id,'active',old_account.active) end,jsonb_build_object('email',email_value,'role',role_value,'doctor_id',did,'active',desired_active,'password_changed',p_credentials is not null,'agendaIds',(select coalesce(jsonb_agg(professional_id),'[]') from public.agenda_access where user_id=uid)));
 return uid;
end;$function$;

CREATE OR REPLACE FUNCTION public.deactivate_user_access(p_actor bigint,p_target bigint)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
declare rn_org_id uuid; target_user public.users%rowtype;
begin
 perform pg_advisory_xact_lock(194701,1);
 select id into rn_org_id from public.organizations where slug='rn-gestao' and active for share;
 if rn_org_id is null or (select count(*) from public.organizations)<>1 then raise exception 'Organização de operação inválida. Acesso bloqueado'; end if;
 if not exists (
  select 1 from public.users actor
  join public.organization_memberships membership on membership.user_id=actor.id
  where actor.id=p_actor and actor.role='general_manager' and actor.active
    and membership.organization_id=rn_org_id and membership.role='general_manager' and membership.active
 ) then raise exception 'Acesso restrito à gerência'; end if;
 if p_target is null or p_target=p_actor then raise exception 'O gerente não pode desativar seu próprio acesso'; end if;
 select * into target_user from public.users where id=p_target for update;
 if not found then raise exception 'Usuário inexistente'; end if;
 if not exists(select 1 from public.organization_memberships where organization_id=rn_org_id and user_id=p_target)
    or exists(select 1 from public.organization_memberships where organization_id<>rn_org_id and user_id=p_target)
 then raise exception 'Conta fora da organização atual'; end if;
 if not target_user.active then
  delete from public.sessions where user_id=p_target;
  return false;
 end if;
 update public.users set active=false,updated_at=clock_timestamp() where id=p_target;
 update public.organization_memberships set active=false,updated_at=clock_timestamp() where organization_id=rn_org_id and user_id=p_target;
 delete from public.sessions where user_id=p_target;
 insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data)
 values(p_actor,'user_access',p_target::text,
        jsonb_build_object('email',target_user.email,'role',target_user.role,'active',true),
        jsonb_build_object('email',target_user.email,'role',target_user.role,'active',false,'access_revoked',true));
 return true;
end;$function$;

REVOKE ALL ON FUNCTION public.save_user_access(bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.deactivate_user_access(bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_user_access(bigint,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_user_access(bigint,bigint) TO service_role;

COMMIT;
