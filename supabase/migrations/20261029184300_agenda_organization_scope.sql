-- RN Integra, phase 2B/1: bind the live agenda document to RN Gestão.
-- No new organization may operate until all 13 dependent SQL functions,
-- finance and storage paths are converted to organization-aware access.
-- Keep app_state(id=1) and its triggers intact for legacy financial flows.
BEGIN;
LOCK TABLE public.app_state IN SHARE ROW EXCLUSIVE MODE;

DO $guard$
BEGIN
 IF (SELECT count(*) FROM public.organizations)<>1
     OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE slug='rn-gestao' AND active)
   THEN RAISE EXCEPTION 'Organização inicial inconsistente'; END IF;
 IF (SELECT count(*) FROM public.app_state)<>1
     OR NOT EXISTS (SELECT 1 FROM public.app_state WHERE id=1)
   THEN RAISE EXCEPTION 'Estado de agenda existente inconsistente'; END IF;
END;$guard$;

ALTER TABLE public.app_state ADD COLUMN organization_id uuid;
UPDATE public.app_state
  SET organization_id=(SELECT id FROM public.organizations WHERE slug='rn-gestao')
  WHERE id=1;
ALTER TABLE public.app_state ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.app_state ADD CONSTRAINT app_state_organization_fk
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX app_state_organization_unique ON public.app_state(organization_id);

-- A temporary physical guard: ensures no other tenant can be inserted into
-- the legacy singleton while other financial RPCs still reference id=1.
CREATE OR REPLACE FUNCTION public.guard_legacy_agenda_organization()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
DECLARE rn_org_id uuid;
BEGIN
 SELECT id INTO rn_org_id FROM public.organizations WHERE slug='rn-gestao' AND active;
 IF rn_org_id IS NULL OR (SELECT count(*) FROM public.organizations)<>1
   THEN RAISE EXCEPTION 'Organização de operação inválida. Acesso bloqueado'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Exclusão direta do estado da agenda bloqueada'; END IF;
 IF NEW.id<>1 OR NEW.organization_id IS DISTINCT FROM rn_org_id
   THEN RAISE EXCEPTION 'Agenda fora da organização atual'; END IF;
 IF TG_OP='UPDATE' AND OLD.organization_id IS DISTINCT FROM NEW.organization_id
   THEN RAISE EXCEPTION 'Alteração de organização da agenda não permitida'; END IF;
 RETURN NEW;
END;$function$;

CREATE TRIGGER guard_legacy_agenda_organization
  BEFORE INSERT OR UPDATE OR DELETE ON public.app_state
  FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_agenda_organization();

CREATE OR REPLACE FUNCTION public.commit_agenda_change(p_expected timestamp with time zone, p_payload jsonb, p_revision timestamp with time zone, p_audit jsonb, p_request_id text DEFAULT NULL::text, p_decision text DEFAULT NULL::text, p_actor bigint DEFAULT NULL::bigint, p_note text DEFAULT NULL::text, p_notification jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare current_revision timestamptz; request_status text; rn_org_id uuid; effective_actor bigint;
begin
  -- Serialize initialization as well as writes to the singleton.
  perform pg_advisory_xact_lock(194701,1);
  select id into rn_org_id from public.organizations where slug='rn-gestao' and active for share;
  if rn_org_id is null or (select count(*) from public.organizations)<>1
    then raise exception 'Organização de operação inválida. Acesso bloqueado'; end if;
  effective_actor:=coalesce(p_actor,(p_audit->0->>'actor_user_id')::bigint);
  if effective_actor is null or not exists (
    select 1 from public.users u join public.organization_memberships m on m.user_id=u.id
    where u.id=effective_actor and u.active and m.active
      and m.organization_id=rn_org_id and m.role=u.role
  ) then raise exception 'Acesso à organização negado'; end if;
  select updated_at into current_revision from public.app_state where id=1 and organization_id=rn_org_id for update;
  if current_revision is distinct from p_expected then return false; end if;
  if p_request_id is not null then
    select status into request_status from public.agenda_requests where id=p_request_id for update;
    if request_status is distinct from 'pending' then return false; end if;
    if p_decision not in ('accepted','denied') then raise exception 'Invalid decision'; end if;
    update public.agenda_requests set status=p_decision,decided_by=p_actor,decision_note=p_note,decided_at=p_revision where id=p_request_id;
  end if;
  perform public.financial_operation(effective_actor,'agenda',p_request_id);
  if p_payload is not null then
    -- UPDATE first: ON CONFLICT fires BEFORE INSERT row triggers even for
    -- an existing singleton, causing historical blocks to reject unrelated saves.
    -- Updates instead compare against OLD.payload, validating only new/changed
    -- appointment availability. Keep INSERT validation for first-time setup.
    update public.app_state
      set payload=p_payload, updated_at=p_revision
      where id=1 and organization_id=rn_org_id;
    if not found then
      insert into public.app_state(id,organization_id,payload,updated_at)
        values(1,rn_org_id,p_payload,p_revision);
    end if;
  end if;
  insert into public.audit_logs(id,actor_user_id,actor_name,actor_role,action,professional_id,appointment_id,patient_id,description,metadata,created_at)
    select x.id,x.actor_user_id,x.actor_name,x.actor_role,x.action,x.professional_id,x.appointment_id,x.patient_id,x.description,x.metadata,coalesce(x.created_at,p_revision)
    from jsonb_to_recordset(p_audit) as x(id text,actor_user_id bigint,actor_name text,actor_role text,action text,professional_id text,appointment_id text,patient_id text,description text,metadata jsonb,created_at timestamptz);
  if p_notification is not null then
    insert into public.notifications(id,user_id,type,request_id,message,created_at)
    values(p_notification->>'id',(p_notification->>'user_id')::bigint,p_notification->>'type',p_request_id,p_notification->>'message',p_revision);
  end if;
  perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);
  return true;
end;
$function$
;

REVOKE ALL ON FUNCTION public.guard_legacy_agenda_organization() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_legacy_agenda_organization() TO service_role;
REVOKE ALL ON FUNCTION public.commit_agenda_change(timestamptz,jsonb,timestamptz,jsonb,text,text,bigint,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_agenda_change(timestamptz,jsonb,timestamptz,jsonb,text,text,bigint,text,jsonb)
  TO service_role;

COMMIT;
