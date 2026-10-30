-- RN Integra 2B/3c1: enforce active organization membership on denial and portal submission RPCs.
-- Transitional RN Gestao-only guard remains; never onboard another tenant yet.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_billing_denial(p_actor bigint, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 actor_role text;
 rn_org_id uuid;
 act text:=p_data->>'action';
 charge public.billing_records%rowtype;
 attendance public.attendances%rowtype;
 case_row public.billing_denial_cases%rowtype;
 appeal_row public.billing_denial_appeals%rowtype;
 result_id uuid;
 old_snapshot jsonb;
 event_name text;
 value_amount numeric(14,2);
 action_date date;
 note_value text:=nullif(trim(p_data->>'notes'),'');
begin
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);
 select role into actor_role from public.users where id=p_actor and active;
 if actor_role is null or actor_role not in ('general_manager','secretary')
    then raise exception 'Sem permissão para gerir glosas';end if;
 if act not in ('OPEN_CASE','FILE_APPEAL','DECIDE_APPEAL','REGISTER_RECOVERY','CLOSE_CASE')
    then raise exception 'Ação de glosa inválida';end if;
 if length(coalesce(note_value,''))>2000 then raise exception 'Observação muito longa';end if;

 if act='OPEN_CASE' then
   select * into charge from public.billing_records
    where id=nullif(p_data->>'billing_record_id','')::uuid and organization_id=rn_org_id;
 else
   select * into case_row from public.billing_denial_cases
    where id=nullif(p_data->>'denial_id','')::uuid and organization_id=rn_org_id for update;
   if not found then raise exception 'Glosa inexistente';end if;
   if case_row.updated_at is distinct from nullif(p_data->>'updated_at','')::timestamptz
     then raise exception 'Glosa alterada. Atualize a página';end if;
   select * into charge from public.billing_records where id=case_row.billing_record_id and organization_id=rn_org_id;
 end if;
 if charge.id is null or charge.professional_id is null or charge.billing_method<>'CONVENIO'
    then raise exception 'Glosa exige cobrança profissional de convênio';end if;
 select * into attendance from public.attendances where id=charge.attendance_id and organization_id=rn_org_id;
 if attendance.id is null or attendance.status<>'realized'
    then raise exception 'Atendimento não realizado';end if;
 if actor_role='secretary' and not exists(select 1 from public.agenda_access a
    where a.user_id=p_actor and a.professional_id=charge.professional_id)
    then raise exception 'Sem acesso à agenda deste profissional';end if;
 if act<>'OPEN_CASE' and (case_row.billing_entity_id is distinct from charge.billing_entity_id)
    then raise exception 'Entidade financeira histórica divergente';end if;
 if act<>'OPEN_CASE' and case_row.status='CLOSED'
    then raise exception 'Glosa encerrada. Abra nova ocorrência para registro adicional';end if;
 old_snapshot:=case when act='OPEN_CASE' then null else to_jsonb(case_row) end;

 if act='OPEN_CASE' then
   action_date:=nullif(p_data->>'denied_on','')::date;
   value_amount:=nullif(p_data->>'denied_amount','')::numeric;
   if p_data->>'denial_kind' not in ('TOTAL','PARCIAL')
      then raise exception 'Informe se a glosa foi total ou parcial';end if;
   if action_date is null or action_date<attendance.date or action_date>current_date
      or value_amount is null or value_amount<=0 or value_amount>999999999999.99
      or length(trim(coalesce(p_data->>'reason',''))) not between 5 and 2000
      or length(coalesce(p_data->>'payer_reference',''))>120
      then raise exception 'Informe data, valor e motivo válidos para a glosa';end if;
   insert into public.billing_denial_cases(
      billing_record_id,billing_entity_id,denied_on,denial_kind,denied_amount,reason,payer_reference,
      notes,created_by,updated_by)
   values(charge.id,charge.billing_entity_id,action_date,p_data->>'denial_kind',value_amount,
      trim(p_data->>'reason'),nullif(trim(p_data->>'payer_reference'),''),
      note_value,p_actor,p_actor) returning * into case_row;
   event_name:='OPENED';

 elsif act='FILE_APPEAL' then
   if case_row.recovered_amount>=case_row.denied_amount then
     raise exception 'Glosa integralmente recuperada. Não é possível abrir outro recurso';end if;
   action_date:=nullif(p_data->>'filed_on','')::date;
   value_amount:=nullif(p_data->>'appealed_amount','')::numeric;
   if action_date is null or action_date<case_row.denied_on or action_date>current_date
     or value_amount is null or value_amount<=0 or value_amount>case_row.denied_amount
     or length(trim(coalesce(p_data->>'protocol',''))) not between 3 and 120
   then raise exception 'Informe data, valor e protocolo do recurso válidos';end if;
   if exists(select 1 from public.billing_denial_appeals where denial_id=case_row.id and organization_id=rn_org_id and decision='PENDING')
   then raise exception 'Já existe recurso aguardando decisão';end if;
   insert into public.billing_denial_appeals(
      denial_id,filed_on,appealed_amount,protocol,notes,created_by)
   values(case_row.id,action_date,value_amount,trim(p_data->>'protocol'),note_value,p_actor)
   returning * into appeal_row;
   update public.billing_denial_cases set status='APPEALED',
      updated_at=clock_timestamp(),updated_by=p_actor where id=case_row.id and organization_id=rn_org_id;
   event_name:='APPEAL_FILED';

 elsif act='DECIDE_APPEAL' then
   select * into appeal_row from public.billing_denial_appeals
     where id=nullif(p_data->>'appeal_id','')::uuid and denial_id=case_row.id and organization_id=rn_org_id for update;
   if appeal_row.id is null or appeal_row.decision<>'PENDING'
      then raise exception 'Recurso não está pendente';end if;
   action_date:=nullif(p_data->>'decision_on','')::date;
   value_amount:=coalesce(nullif(p_data->>'approved_amount','')::numeric,0);
   if p_data->>'decision' not in ('ACCEPTED','PARTIAL','REJECTED')
     or action_date is null or action_date<appeal_row.filed_on or action_date>current_date
     or value_amount<0 or value_amount>appeal_row.appealed_amount
     or (p_data->>'decision'='ACCEPTED' and value_amount<>appeal_row.appealed_amount)
     or (p_data->>'decision'='PARTIAL' and (value_amount<=0 or value_amount>=appeal_row.appealed_amount))
     or (p_data->>'decision'='REJECTED' and value_amount<>0)
   then raise exception 'Decisão ou valor deferido incompatível com o recurso';end if;
   update public.billing_denial_appeals set decision=p_data->>'decision',
     decision_on=action_date,approved_amount=value_amount,
     decision_notes=note_value,decided_by=p_actor where id=appeal_row.id and organization_id=rn_org_id
     returning * into appeal_row;
   update public.billing_denial_cases set status=case when recovered_amount>0 then 'PARTIAL' else 'DECIDED' end,
     updated_at=clock_timestamp(),updated_by=p_actor where id=case_row.id and organization_id=rn_org_id;
   event_name:='APPEAL_DECIDED';

 elsif act='REGISTER_RECOVERY' then
   select * into appeal_row from public.billing_denial_appeals
     where id=nullif(p_data->>'appeal_id','')::uuid and denial_id=case_row.id and organization_id=rn_org_id for update;
   action_date:=nullif(p_data->>'recovered_on','')::date;
   value_amount:=nullif(p_data->>'amount','')::numeric;
   if appeal_row.id is null or appeal_row.decision not in ('ACCEPTED','PARTIAL')
     or action_date is null or action_date<appeal_row.decision_on or action_date>current_date
     or value_amount is null or value_amount<=0
     or length(trim(coalesce(p_data->>'receipt_reference',''))) not between 3 and 120
     or case_row.recovered_amount+value_amount>case_row.denied_amount
     or value_amount+(select coalesce(sum(amount),0) from public.billing_denial_recoveries
                       where appeal_id=appeal_row.id and organization_id=rn_org_id)>appeal_row.approved_amount
   then raise exception 'Recuperação excede o deferimento ou faltam comprovantes';end if;
   insert into public.billing_denial_recoveries(
      denial_id,appeal_id,recovered_on,amount,receipt_reference,notes,created_by)
   values(case_row.id,appeal_row.id,action_date,value_amount,
      trim(p_data->>'receipt_reference'),note_value,p_actor);
   update public.billing_denial_cases set recovered_amount=recovered_amount+value_amount,
     status=case when recovered_amount+value_amount=denied_amount then 'RECOVERED' else 'PARTIAL' end,
     updated_at=clock_timestamp(),updated_by=p_actor where id=case_row.id and organization_id=rn_org_id;
   event_name:='RECOVERY_RECORDED';

 elsif act='CLOSE_CASE' then
   if length(trim(coalesce(p_data->>'closing_reason',''))) not between 5 and 1000
     then raise exception 'Informe o motivo do encerramento';end if;
   if exists(select 1 from public.billing_denial_appeals where denial_id=case_row.id and organization_id=rn_org_id and decision='PENDING')
     then raise exception 'Resolva o recurso pendente antes de encerrar';end if;
   update public.billing_denial_cases set status='CLOSED',closed_at=clock_timestamp(),
     closed_by=p_actor,closing_reason=trim(p_data->>'closing_reason'),
     updated_at=clock_timestamp(),updated_by=p_actor where id=case_row.id and organization_id=rn_org_id;
   event_name:='CLOSED';
 end if;

 select * into case_row from public.billing_denial_cases where id=case_row.id and organization_id=rn_org_id;
 result_id:=case_row.id;
 insert into public.billing_denial_events(denial_id,actor_id,event_type,before_snapshot,after_snapshot)
 values(result_id,p_actor,event_name,old_snapshot,
   jsonb_build_object('case',to_jsonb(case_row),
     'appeal',case when appeal_row.id is null then null else to_jsonb(appeal_row) end,
     'payload',p_data));
 return result_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_billing_portal_submission(p_actor bigint, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  actor_role text;
 rn_org_id uuid;
  record_id uuid:=nullif(p_data->>'billing_record_id','')::uuid;
  charge public.billing_records%rowtype;
  attendance public.attendances%rowtype;
  old_row public.billing_portal_submissions%rowtype;
  new_row public.billing_portal_submissions%rowtype;
  saved_id uuid;
  destination text:=upper(trim(regexp_replace(coalesce(p_data->>'destination_key',''),'\s+',' ','g')));
  channel text:=nullif(p_data->>'submission_channel_code','');
  guide_date date:=nullif(p_data->>'guide_received_at','')::date;
  action text:=p_data->>'action';
  submission_date date:=nullif(p_data->>'submitted_at','')::date;
  protocol text:=nullif(trim(p_data->>'portal_protocol'),'');
  note_value text:=nullif(trim(p_data->>'notes'),'');
begin
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);
  select role into actor_role from public.users where id=p_actor and active;
  if actor_role not in ('general_manager','secretary') or actor_role is null
    then raise exception 'Acesso negado ao envio de guias';end if;
  select * into charge from public.billing_records where id=record_id and organization_id=rn_org_id;
  if not found or charge.professional_id is null or charge.billing_method<>'CONVENIO'
    or charge.settlement_mode<>'INVOICE' then
    raise exception 'Cobrança profissional de convênio não elegível';
  end if;
  select * into attendance from public.attendances where id=charge.attendance_id and organization_id=rn_org_id;
  if not found or attendance.status<>'realized' then raise exception 'Atendimento ainda não realizado';end if;
  if actor_role='secretary' and not exists(select 1 from public.agenda_access
    where user_id=p_actor and professional_id=charge.professional_id)
    then raise exception 'Sem acesso à agenda desse profissional';end if;
  if action not in ('SAVE_PENDING','MARK_SUBMITTED')
    or length(destination) not between 2 and 120
    or channel not in ('PORTAL_CONVENIO','COOPERATIVA','MANUAL')
    or (charge.submission_channel_code not in ('LEGADO','MANUAL')
        and channel is distinct from charge.submission_channel_code)
    or (guide_date is not null and guide_date>current_date)
    or length(coalesce(note_value,''))>2000 then
    raise exception 'Revise destino, canal e dados da guia';
  end if;
  if action='MARK_SUBMITTED' and
    (guide_date is null or submission_date is null or submission_date>current_date
      or submission_date<guide_date or length(coalesce(protocol,'')) not between 3 and 120)
    then raise exception 'Faturado no portal exige recebimento da guia, data e protocolo válidos';end if;
  if action='SAVE_PENDING' and (submission_date is not null or protocol is not null)
    then raise exception 'Data e protocolo pertencem apenas à confirmação de faturamento';end if;

  perform pg_advisory_xact_lock(194701,12);
  select * into old_row from public.billing_portal_submissions where billing_record_id=record_id and organization_id=rn_org_id for update;
  if old_row.status='FATURADO' then raise exception 'Guia já faturada no portal. Preserve o histórico';end if;
  if old_row.id is not null and old_row.guide_received_at is not null
      and guide_date is null then
    raise exception 'Para corrigir o recebimento de uma guia já registrada, contate a gerência';end if;

  if old_row.id is null then
    insert into public.billing_portal_submissions(
      billing_record_id,status,destination_key,submission_channel_code,guide_received_at,
      submitted_at,portal_protocol,notes,submitted_by,created_by,updated_by)
    values(record_id,case when action='MARK_SUBMITTED' then 'FATURADO' else 'PENDENTE' end,
      destination,channel,guide_date,
      case when action='MARK_SUBMITTED' then submission_date end,
      case when action='MARK_SUBMITTED' then protocol end,note_value,
      case when action='MARK_SUBMITTED' then p_actor end,p_actor,p_actor)
    returning * into new_row;
  else
    update public.billing_portal_submissions set
      status=case when action='MARK_SUBMITTED' then 'FATURADO' else 'PENDENTE' end,
      destination_key=destination,submission_channel_code=channel,
      guide_received_at=guide_date,
      submitted_at=case when action='MARK_SUBMITTED' then submission_date end,
      portal_protocol=case when action='MARK_SUBMITTED' then protocol end,
      submitted_by=case when action='MARK_SUBMITTED' then p_actor end,
      notes=note_value,updated_at=clock_timestamp(),updated_by=p_actor
      where id=old_row.id and organization_id=rn_org_id returning * into new_row;
  end if;
  insert into public.billing_portal_submission_events(submission_id,actor_id,event_type,before_snapshot,after_snapshot)
    values(new_row.id,p_actor,
      case when action='MARK_SUBMITTED' then 'SUBMITTED'
        when old_row.guide_received_at is distinct from new_row.guide_received_at then 'GUIDE_UPDATED'
        else 'CONFIGURED' end,
      case when old_row.id is null then null else to_jsonb(old_row) end,to_jsonb(new_row));
  return new_row.id;
end;
$function$;

REVOKE ALL ON FUNCTION public.save_billing_denial(bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_billing_denial(bigint,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.save_billing_portal_submission(bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_billing_portal_submission(bigint,jsonb) TO service_role;

COMMIT;
