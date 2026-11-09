-- Área de organização: equipe e convites pendentes, cancelar convite, editar a organização,
-- primeiros passos de organização nova e proteção do titular da conta.

-- 1. Equipe da organização ativa (somente gerência): membros, convites pendentes e progresso.
create or replace function public.organization_team(p_actor bigint,p_org uuid) returns jsonb
language plpgsql set search_path='' as $$
declare owner_id bigint; result jsonb;
begin
 perform public.require_organization_manager(p_actor,p_org);
 select a.owner_user_id into owner_id from public.organizations o join public.accounts a on a.id=o.account_id where o.id=p_org;
 result:=jsonb_build_object(
  'members',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'role',m.role,
     'isOwner',u.id=owner_id,'isYou',u.id=p_actor,'since',m.created_at,
     'agendas',(select count(*) from public.agenda_access g where g.user_id=u.id and g.organization_id=p_org))
     order by (u.id=owner_id) desc,m.role,u.name)
   from public.organization_memberships m join public.users u on u.id=m.user_id and u.active
   where m.organization_id=p_org and m.active),'[]'::jsonb),
  'invites',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'email',t.email,'role',t.role,'name',t.payload->>'name',
     'agendaIds',coalesce(t.payload->'agendaIds','[]'::jsonb),'doctorId',t.payload->>'doctorId',
     'createdAt',t.created_at,'expiresAt',t.expires_at,'invitedBy',(select name from public.users where id=t.created_by))
     order by t.created_at desc)
   from public.auth_tokens t where t.kind='invite' and t.organization_id=p_org and t.used_at is null and t.expires_at>now()),'[]'::jsonb));
 perform set_config('rn.organization','',true);
 return result;
end;$$;

-- 2. Cancelar convite pendente da organização.
create or replace function public.cancel_invite(p_actor bigint,p_org uuid,p_invite uuid) returns boolean
language plpgsql set search_path='' as $$
begin
 perform public.require_organization_manager(p_actor,p_org);
 update public.auth_tokens set used_at=now()
  where id=p_invite and kind='invite' and organization_id=p_org and used_at is null;
 if not found then raise exception 'Convite não encontrado ou já utilizado'; end if;
 perform set_config('rn.organization','',true);
 return true;
end;$$;

-- 3. Nome e tipo da organização (gerência da própria organização).
create or replace function public.update_organization(p_actor bigint,p_org uuid,p_name text,p_kind text) returns jsonb
language plpgsql set search_path='' as $$
declare r public.organizations%rowtype;
begin
 perform public.require_organization_manager(p_actor,p_org);
 if coalesce(char_length(btrim(p_name)),0) not between 2 and 120 then raise exception 'Informe o nome da organização'; end if;
 if p_kind not in ('MANAGEMENT_COMPANY','CLINIC','SOLO_DOCTOR') then raise exception 'Tipo de organização inválido'; end if;
 update public.organizations set name=btrim(p_name),kind=p_kind,updated_at=clock_timestamp() where id=p_org returning * into r;
 perform set_config('rn.organization','',true);
 return jsonb_build_object('id',r.id,'name',r.name,'kind',r.kind);
end;$$;

-- 4. Primeiros passos (cartões na agenda da gerência): só contagens, nada pessoal.
create or replace function public.organization_setup_status(p_actor bigint,p_org uuid) returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb;
begin
 perform public.require_organization_manager(p_actor,p_org);
 result:=jsonb_build_object(
  'doctors',(select count(*) from public.doctors where organization_id=p_org and active),
  'appointments',(select count(*) from (select 1 from public.appointments where organization_id=p_org limit 1) x),
  'members',(select count(*) from public.organization_memberships where organization_id=p_org and active),
  'invites',(select count(*) from public.auth_tokens where kind='invite' and organization_id=p_org and (used_at is null and expires_at>now())));
 perform set_config('rn.organization','',true);
 return result;
end;$$;

-- 5. O titular da conta não pode ser removido de uma organização da própria conta.
create or replace function public.deactivate_user_access(p_actor bigint, p_target bigint)
 returns boolean language plpgsql set search_path='' as $$
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
 if exists(select 1 from public.organizations o join public.accounts a on a.id=o.account_id where o.id=org and a.owner_user_id=p_target) then
  raise exception 'O titular da conta não pode ser removido da organização';
 end if;
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
end;$$;

revoke all on function public.organization_team(bigint,uuid),public.cancel_invite(bigint,uuid,uuid),public.update_organization(bigint,uuid,text,text),
 public.organization_setup_status(bigint,uuid) from public,anon,authenticated;
grant execute on function public.organization_team(bigint,uuid),public.cancel_invite(bigint,uuid,uuid),public.update_organization(bigint,uuid,text,text),
 public.organization_setup_status(bigint,uuid) to service_role;
