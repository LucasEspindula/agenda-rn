-- RN Integra: avoid running appointment availability validation as INSERT
-- during every save of the existing singleton app_state row.
-- PostgreSQL executes row-level BEFORE INSERT triggers for INSERT ... ON CONFLICT,
-- including conflicts resolved by UPDATE. Legacy appointment+block combinations
-- must not prevent a new unrelated booking; real new/changed overlaps stay blocked.
CREATE OR REPLACE FUNCTION public.commit_agenda_change(p_expected timestamp with time zone, p_payload jsonb, p_revision timestamp with time zone, p_audit jsonb, p_request_id text DEFAULT NULL::text, p_decision text DEFAULT NULL::text, p_actor bigint DEFAULT NULL::bigint, p_note text DEFAULT NULL::text, p_notification jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare current_revision timestamptz; request_status text;
begin
  -- Serialize initialization as well as writes to the singleton.
  perform pg_advisory_xact_lock(194701,1);
  select updated_at into current_revision from public.app_state where id=1 for update;
  if current_revision is distinct from p_expected then return false; end if;
  if p_request_id is not null then
    select status into request_status from public.agenda_requests where id=p_request_id for update;
    if request_status is distinct from 'pending' then return false; end if;
    if p_decision not in ('accepted','denied') then raise exception 'Invalid decision'; end if;
    update public.agenda_requests set status=p_decision,decided_by=p_actor,decision_note=p_note,decided_at=p_revision where id=p_request_id;
  end if;
  perform public.financial_operation(coalesce(p_actor,(p_audit->0->>'actor_user_id')::bigint),'agenda',p_request_id);
  if p_payload is not null then
    -- UPDATE first: ON CONFLICT fires BEFORE INSERT row triggers even for
    -- an existing singleton, causing historical blocks to reject unrelated saves.
    -- Updates instead compare against OLD.payload, validating only new/changed
    -- appointment availability. Keep INSERT validation for first-time setup.
    update public.app_state
      set payload=p_payload, updated_at=p_revision
      where id=1;
    if not found then
      insert into public.app_state(id,payload,updated_at)
        values(1,p_payload,p_revision);
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

