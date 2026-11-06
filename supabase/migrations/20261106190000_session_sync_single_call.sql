-- Fase 1 de capacidade: sessão e sinal de sincronização numa única ida ao banco.
-- Antes: getSession fazia 4-5 consultas e /api/state/revision mais 5. Agora 1 RPC cada.
-- Regras idênticas às de app/authz.ts (hasActiveRnGestaoMembership + getSession) e de
-- app/api/state/revision/route.ts. Mantém o bloqueio de organização única (Fase 2B).

create or replace function public.session_context(p_token_hash text)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
 v_user public.users%rowtype;
 v_services jsonb:='{"scheduling_enabled":false,"billing_enabled":false,"invoice_enabled":false}'::jsonb;
 v_agendas text[]:='{}';
begin
 if p_token_hash is null or length(p_token_hash)>100 then return null; end if;
 select u.* into v_user from public.sessions s join public.users u on u.id=s.user_id
  where s.token_hash=p_token_hash and s.expires_at>now();
 if not found or not v_user.active or v_user.role not in ('general_manager','secretary','doctor') then return null; end if;
 -- Organização única: vínculo ativo com o mesmo papel na RN Gestão e exatamente uma organização.
 if not exists (
  select 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id
  where m.user_id=v_user.id and m.active and m.role=v_user.role and o.slug='rn-gestao' and o.active
 ) or (select count(*) from public.organizations)<>1 then return null; end if;
 if v_user.role='doctor' and v_user.doctor_id is not null then
  select jsonb_build_object('scheduling_enabled',d.scheduling_enabled,'billing_enabled',d.billing_enabled,'invoice_enabled',d.invoice_enabled)
   into v_services from public.doctors d where d.id=v_user.doctor_id and d.active;
  v_services:=coalesce(v_services,'{"scheduling_enabled":false,"billing_enabled":false,"invoice_enabled":false}'::jsonb);
 end if;
 if v_user.role<>'general_manager' then
  select coalesce(array_agg(distinct x),'{}') into v_agendas from (
   select a.professional_id::text x from public.agenda_access a where a.user_id=v_user.id
   union select v_user.doctor_id where v_user.role='doctor' and v_user.doctor_id is not null
  ) t;
 end if;
 return jsonb_build_object(
  'account',jsonb_build_object('id',v_user.id,'email',v_user.email,'name',v_user.name,'role',v_user.role,'doctorId',v_user.doctor_id),
  'services',v_services,
  'agendaIds',to_jsonb(v_agendas));
end;$function$;

create or replace function public.agenda_sync_signal(p_token_hash text)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
 v_session jsonb:=public.session_context(p_token_hash);
 v_id bigint; v_role text; v_agendas text[]; v_revision timestamptz; v_workflow timestamptz;
begin
 if v_session is null then return null; end if;
 v_id:=(v_session->'account'->>'id')::bigint; v_role:=v_session->'account'->>'role';
 select coalesce(array_agg(value),'{}') into v_agendas from jsonb_array_elements_text(v_session->'agendaIds');
 select revision into v_revision from public.agenda_settings where organization_id=public.rn_agenda_organization_id();
 select max(t) into v_workflow from (
  select (select l.created_at from public.audit_logs l where v_role='general_manager' order by l.created_at desc limit 1) t
  union all select (select l.created_at from public.audit_logs l where v_role='secretary' and l.professional_id=any(v_agendas) order by l.created_at desc limit 1)
  union all select (select n.created_at from public.notifications n where n.user_id=v_id order by n.created_at desc limit 1)
  union all select (select max(n.read_at) from public.notifications n where n.user_id=v_id)
  union all select (select r.created_at from public.agenda_requests r where v_role='doctor' and r.requested_by=v_id and r.professional_id=any(v_agendas) order by r.created_at desc limit 1)
 ) s;
 return jsonb_build_object('session',v_session,'revision',v_revision,'workflowRevision',v_workflow);
end;$function$;

revoke all on function public.session_context(text),public.agenda_sync_signal(text) from public,anon,authenticated;
grant execute on function public.session_context(text),public.agenda_sync_signal(text) to service_role;
