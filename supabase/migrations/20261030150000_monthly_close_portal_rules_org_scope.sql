-- RN Integra 2B/3c2: close monthly and portal deadline rules scoped to active RN Gestao organization.
-- The single-organization lock stays enabled. This migration does not authorize tenant onboarding.
BEGIN;

DO $preflight$
BEGIN
 IF (SELECT count(*) FROM public.organizations)<>1 OR NOT EXISTS
    (SELECT 1 FROM public.organizations WHERE slug='rn-gestao' AND active)
 THEN RAISE EXCEPTION 'RN Gestao must remain the only active organization'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='billing_portal_deadline_rules'
           AND column_name='organization_id')
 THEN RAISE EXCEPTION 'Portal deadline rules already organization-scoped'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.billing_portal_deadline_rules'::regclass)
 THEN RAISE EXCEPTION 'Portal deadline rules require RLS'; END IF;
END;
$preflight$;

-- Constant server-side default backfills historic rules without firing UPDATE/audit triggers.
ALTER TABLE public.billing_portal_deadline_rules
 ADD COLUMN organization_id uuid NOT NULL DEFAULT public.rn_finance_single_organization_id();
ALTER TABLE public.billing_portal_deadline_rules
 ADD CONSTRAINT billing_portal_deadline_rules_organization_fk
 FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.billing_portal_deadline_rules
 ADD CONSTRAINT org_link_billing_portal_deadline_rules_professional_id
 FOREIGN KEY (professional_id,organization_id) REFERENCES public.doctors(id,organization_id);
CREATE UNIQUE INDEX billing_portal_deadline_rules_id_org_unique
 ON public.billing_portal_deadline_rules(id,organization_id);
CREATE INDEX billing_portal_deadline_rules_org_destination_idx
 ON public.billing_portal_deadline_rules(organization_id,destination_key,submission_channel_code);
CREATE TRIGGER guard_rn_finance_organization
 BEFORE INSERT OR UPDATE ON public.billing_portal_deadline_rules
 FOR EACH ROW EXECUTE FUNCTION public.guard_rn_finance_organization();

CREATE OR REPLACE FUNCTION public.get_billing_month_closing(p_actor bigint, p_entity uuid, p_month text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
 rn_org_id uuid;
 snap jsonb;
 original public.billing_monthly_closings%rowtype;
 latest public.billing_monthly_closing_events%rowtype;
 saved_snapshot jsonb;
 saved_id uuid;
 saved_at timestamptz;
 saved_by bigint;
 saved_notes text;
 saved_checksum text;
 is_closed boolean;
 revisions jsonb;
begin
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);
 if not exists(select 1 from public.billing_entities where id=p_entity and organization_id=rn_org_id) then raise exception 'Entidade recebedora não encontrada na organização';end if;
 snap:=public.preview_billing_month(p_actor,p_entity,p_month);
 select * into original from public.billing_monthly_closings
  where billing_entity_id=p_entity and organization_id=rn_org_id and competence_month=(p_month||'-01')::date;
 select * into latest from public.billing_monthly_closing_events
  where billing_entity_id=p_entity and organization_id=rn_org_id and competence_month=(p_month||'-01')::date
  order by event_number desc limit 1;
 is_closed:=case when latest.id is not null then latest.event_type='CLOSED'
                  else original.id is not null end;
 if latest.id is not null and latest.event_type='CLOSED' then
   saved_snapshot:=latest.snapshot;saved_id:=latest.id;
   saved_at:=latest.created_at;saved_by:=latest.actor_id;
   saved_notes:=latest.notes;saved_checksum:=latest.snapshot_checksum;
 elsif original.id is not null then
   saved_snapshot:=original.snapshot;saved_id:=original.id;
   saved_at:=original.closed_at;saved_by:=original.closed_by;
   saved_notes:=original.notes;saved_checksum:=original.snapshot_checksum;
 end if;

 select coalesce(jsonb_agg(to_jsonb(h) order by h.version),'[]'::jsonb) into revisions from (
   select 0::bigint version,o.id,o.closed_at date,o.closed_by actor_id,o.notes,
    'CLOSED'::text event_type
   from public.billing_monthly_closings o
   where o.billing_entity_id=p_entity and o.organization_id=rn_org_id and o.competence_month=(p_month||'-01')::date
   union all
   select e.event_number,e.id,e.created_at,e.actor_id,e.notes,e.event_type
   from public.billing_monthly_closing_events e
   where e.billing_entity_id=p_entity and e.organization_id=rn_org_id and e.competence_month=(p_month||'-01')::date
 ) h;
 return jsonb_build_object(
  'current',snap,'closed',is_closed,
  'unlocked',latest.id is not null and latest.event_type='UNLOCKED',
  'history',revisions,
  'closing',case when saved_snapshot is null then null else jsonb_build_object(
    'id',saved_id,'snapshot',saved_snapshot,'closed_at',saved_at,
    'closed_by',saved_by,'notes',saved_notes,
    'changed_since_close',md5(snap::text)<>saved_checksum) end
 );
end;
$function$;

CREATE OR REPLACE FUNCTION public.close_billing_month(p_actor bigint, p_entity uuid, p_month text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 rn_org_id uuid;
 first_day date;
 snapshot_data jsonb;
 saved_id uuid;
 latest public.billing_monthly_closing_events%rowtype;
begin
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);
 if not exists(select 1 from public.billing_entities where id=p_entity and organization_id=rn_org_id) then raise exception 'Entidade recebedora não encontrada na organização';end if;
 if not exists(select 1 from public.users where id=p_actor and role='general_manager' and active) then
  raise exception 'Somente a gerência pode fechar uma competência';
 end if;
 if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
  raise exception 'Competência inválida';
 end if;
 first_day:=(p_month||'-01')::date;
 if first_day>=date_trunc('month',timezone('America/Sao_Paulo',now()))::date then
  raise exception 'A competência atual ou futura não pode ser encerrada';
 end if;
 if length(coalesce(p_notes,''))>2000 then raise exception 'Observação muito longa';end if;

 perform pg_advisory_xact_lock(hashtext(p_entity::text||p_month)::bigint);
 select * into latest from public.billing_monthly_closing_events
  where billing_entity_id=p_entity and organization_id=rn_org_id and competence_month=first_day
  order by event_number desc limit 1;
 if latest.id is not null then
  if latest.event_type<>'UNLOCKED' then raise exception 'Competência bloqueada. Desbloqueie com a senha do Gerente Geral';end if;
 elsif exists(select 1 from public.billing_monthly_closings
   where billing_entity_id=p_entity and organization_id=rn_org_id and competence_month=first_day) then
  raise exception 'Competência bloqueada. Desbloqueie com a senha do Gerente Geral';
 end if;

 snapshot_data:=public.preview_billing_month(p_actor,p_entity,p_month);
 if coalesce((snapshot_data->'cash'->>'insurance_paid_invoices_without_net')::integer,0)>0
    or coalesce((snapshot_data->'issued_invoices'->>'without_net_amount')::integer,0)>0 then
   raise exception 'Existem NFs sem valor líquido identificado. Revise antes de fechar';
 end if;
 if latest.id is not null then
  insert into public.billing_monthly_closing_events(
    billing_entity_id,competence_month,event_type,snapshot,snapshot_checksum,notes,actor_id)
  values(p_entity,first_day,'CLOSED',snapshot_data,md5(snapshot_data::text),
    nullif(trim(p_notes),''),p_actor) returning id into saved_id;
 else
  insert into public.billing_monthly_closings(
    billing_entity_id,competence_month,snapshot,snapshot_checksum,notes,closed_by)
  values(p_entity,first_day,snapshot_data,md5(snapshot_data::text),
     nullif(trim(p_notes),''),p_actor) returning id into saved_id;
 end if;
 return saved_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.unlock_billing_month(p_actor bigint, p_entity uuid, p_month text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 rn_org_id uuid;
 first_day date;
 latest public.billing_monthly_closing_events%rowtype;
 event_id uuid;
begin
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);
 if not exists(select 1 from public.billing_entities where id=p_entity and organization_id=rn_org_id) then raise exception 'Entidade recebedora não encontrada na organização';end if;
 if not exists(select 1 from public.users where id=p_actor and role='general_manager' and active) then
   raise exception 'Somente o Gerente Geral pode desbloquear';
 end if;
 if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
   raise exception 'Competência inválida';
 end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 2000 then
   raise exception 'Justifique o desbloqueio (mínimo 5 caracteres)';
 end if;
 first_day:=(p_month||'-01')::date;
 perform pg_advisory_xact_lock(hashtext(p_entity::text||p_month)::bigint);
 select * into latest from public.billing_monthly_closing_events
   where billing_entity_id=p_entity and organization_id=rn_org_id and competence_month=first_day
   order by event_number desc limit 1;
 if latest.id is not null then
   if latest.event_type<>'CLOSED' then raise exception 'Competência já desbloqueada';end if;
 elsif not exists(select 1 from public.billing_monthly_closings
   where billing_entity_id=p_entity and organization_id=rn_org_id and competence_month=first_day) then
   raise exception 'A competência ainda não foi fechada';
 end if;
 insert into public.billing_monthly_closing_events(
   billing_entity_id,competence_month,event_type,notes,actor_id)
 values(p_entity,first_day,'UNLOCKED',trim(p_reason),p_actor)
 returning id into event_id;
 return event_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_billing_portal_rule(p_actor bigint, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 rn_org_id uuid;
  key text:=upper(trim(regexp_replace(coalesce(p_data->>'destination_key',''),'\s+',' ','g')));
  channel text:=nullif(p_data->>'submission_channel_code','');
  doctor text:=nullif(p_data->>'professional_id','');
  start_date date:=nullif(p_data->>'valid_from','')::date;
  end_date date:=nullif(p_data->>'valid_to','')::date;
  anchor text:=p_data->>'starts_from';
  days_count integer:=nullif(p_data->>'deadline_days','')::integer;
  lead_days integer:=nullif(p_data->>'alert_before_days','')::integer;
  saved_id uuid;
begin
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);
  if not exists(select 1 from public.users where id=p_actor and role='general_manager' and active)
    then raise exception 'Somente a gerência pode configurar prazos';end if;
  if length(key) not between 2 and 120 or channel not in ('PORTAL_CONVENIO','COOPERATIVA','MANUAL')
     or anchor not in ('SERVICE_DATE','GUIDE_RECEIVED') or start_date is null
     or days_count not between 1 and 365 or lead_days not between 0 and least(days_count,90)
     or (end_date is not null and end_date<start_date) then
     raise exception 'Preencha destino, canal, início da vigência, prazo e antecedência válidos';
  end if;
  if doctor is not null and not exists(select 1 from public.doctors where id=doctor and organization_id=rn_org_id and active)
    then raise exception 'Profissional inexistente';end if;
  -- Serializa edição de regras para impedir duas regras sobrepostas concorrentes.
  perform pg_advisory_xact_lock(194701,11);
  if exists(select 1 from public.billing_portal_deadline_rules r
    where r.organization_id=rn_org_id and r.active and r.destination_key=key and r.submission_channel_code=channel
      and r.professional_id is not distinct from doctor
      and r.valid_from<=coalesce(end_date,'infinity'::date)
      and start_date<=coalesce(r.valid_to,'infinity'::date))
    then raise exception 'Já existe regra sobreposta para esse destino, canal e profissional';end if;
  insert into public.billing_portal_deadline_rules(organization_id,destination_key,submission_channel_code,professional_id,
      starts_from,deadline_days,alert_before_days,valid_from,valid_to,created_by)
  values(rn_org_id,key,channel,doctor,anchor,days_count,lead_days,start_date,end_date,p_actor)
  returning id into saved_id;
  return saved_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.get_billing_month_closing(bigint,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_billing_month_closing(bigint,uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.close_billing_month(bigint,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_billing_month(bigint,uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.unlock_billing_month(bigint,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_billing_month(bigint,uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.save_billing_portal_rule(bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_billing_portal_rule(bigint,jsonb) TO service_role;

COMMIT;
