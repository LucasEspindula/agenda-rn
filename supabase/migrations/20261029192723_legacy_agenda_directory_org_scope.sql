-- RN Integra 2B/2a — explicitly scope doctor directory and manually entered attendances.
-- Uses the existing RN Gestão-only gate. NOT permission to onboard another organization.
-- This migration does not alter or delete clinical/financial test records.
BEGIN;

CREATE OR REPLACE FUNCTION public.require_rn_agenda_actor_organization(p_actor bigint)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE rn_org_id uuid;
BEGIN
 -- Fail closed until all financial tables and privileged API paths are tenant-scoped.
 SELECT id INTO rn_org_id FROM public.organizations WHERE slug='rn-gestao' AND active;
 IF rn_org_id IS NULL OR (SELECT count(*) FROM public.organizations)<>1
 THEN RAISE EXCEPTION 'Organização de operação inválida. Acesso bloqueado'; END IF;
 IF p_actor IS NULL OR NOT EXISTS (
   SELECT 1
   FROM public.users u
   JOIN public.organization_memberships m ON m.user_id=u.id
   WHERE u.id=p_actor AND u.active AND m.active
     AND m.organization_id=rn_org_id AND m.role=u.role
 ) THEN RAISE EXCEPTION 'Acesso à organização negado'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.app_state WHERE organization_id=rn_org_id)
 THEN RAISE EXCEPTION 'Agenda da organização indisponível'; END IF;
 RETURN rn_org_id;
END;$function$;

REVOKE ALL ON FUNCTION public.require_rn_agenda_actor_organization(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.require_rn_agenda_actor_organization(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.save_doctor_directory(p_actor bigint, p_kind text, p_data jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare sid text; old_row jsonb; result_row jsonb; old_agenda jsonb; new_agenda jsonb; rn_org_id uuid;
begin
 perform pg_advisory_xact_lock(194701,1);
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then raise exception 'Somente a gerência pode alterar o cadastro central'; end if;
 sid:=coalesce(nullif(p_data->>'id',''),gen_random_uuid()::text);
 perform public.financial_operation(p_actor,'doctor',sid);
 if p_kind='doctor' then
  select to_jsonb(d) into old_row from public.doctors d where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Médico alterado. Atualize a página'; end if;
  if coalesce(length(trim(p_data->>'name')),0)<2 then raise exception 'Informe o nome'; end if;
  if not coalesce(public.valid_medical_specialty(p_data->>'specialty'),false) then raise exception 'Selecione uma especialidade da lista';end if;
  if nullif(trim(p_data->>'crm'),'') is not null and exists(select 1 from public.doctors where id<>sid and lower(trim(crm))=lower(trim(p_data->>'crm'))) then raise exception 'CRM já cadastrado. Use o médico existente'; end if;
  insert into public.doctors(id,name,crm,specialty,category,active,scheduling_enabled,billing_enabled,invoice_enabled,updated_at,updated_by)
   values(sid,trim(p_data->>'name'),trim(coalesce(p_data->>'crm','')),trim(coalesce(p_data->>'specialty','')),case when public.is_anesthesiologist(p_data->>'specialty') then 'anesthetist' else 'doctor' end,coalesce((p_data->>'active')::boolean,true),coalesce((p_data->>'scheduling_enabled')::boolean,(old_row->>'scheduling_enabled')::boolean,true),coalesce((p_data->>'billing_enabled')::boolean,(old_row->>'billing_enabled')::boolean,true),coalesce((p_data->>'invoice_enabled')::boolean,(old_row->>'invoice_enabled')::boolean,true),clock_timestamp(),p_actor)
   on conflict(id) do update set name=excluded.name,crm=excluded.crm,specialty=excluded.specialty,category=excluded.category,active=excluded.active,scheduling_enabled=excluded.scheduling_enabled,billing_enabled=excluded.billing_enabled,invoice_enabled=excluded.invoice_enabled,updated_at=excluded.updated_at,updated_by=p_actor returning to_jsonb(doctors.*) into result_row;
 elsif p_kind='agenda' then
  if not exists(select 1 from public.doctors where id=sid and scheduling_enabled) then raise exception 'Agendamento não habilitado para o médico';end if;
  if not exists(select 1 from public.doctors where id=sid) then raise exception 'Médico não cadastrado'; end if;
  select to_jsonb(a) into old_row from public.doctor_agendas a where doctor_id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Agenda alterada. Atualize a página'; end if;
  if coalesce(p_data->>'workStart','')!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_data->>'workEnd','')!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or p_data->>'workStart'>=p_data->>'workEnd' then raise exception 'Horário da agenda inválido'; end if;
  insert into public.doctor_agendas(doctor_id,active,settings,updated_at,updated_by) values(sid,coalesce((p_data->>'active')::boolean,true),jsonb_build_object('workStart',p_data->>'workStart','workEnd',p_data->>'workEnd'),clock_timestamp(),p_actor)
  on conflict(doctor_id) do update set active=excluded.active,settings=excluded.settings,updated_at=excluded.updated_at,updated_by=p_actor returning to_jsonb(doctor_agendas.*) into result_row;
 else raise exception 'Operação inválida'; end if;

 -- Provision only when first configured or when the scheduling service is enabled again.
 -- Editing a doctor must not override an explicitly paused agenda or custom hours.
 if p_kind='doctor' and (result_row->>'scheduling_enabled')::boolean then
  select to_jsonb(a) into old_agenda from public.doctor_agendas a where a.doctor_id=sid;
  if old_agenda is null or not coalesce((old_row->>'scheduling_enabled')::boolean,false) then
   insert into public.doctor_agendas(doctor_id,active,settings,updated_at,updated_by)
    values(sid,true,jsonb_build_object('workStart','07:00','workEnd','19:00'),clock_timestamp(),p_actor)
    on conflict(doctor_id) do update set active=true,updated_at=clock_timestamp(),updated_by=p_actor
    returning to_jsonb(doctor_agendas.*) into new_agenda;
   insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data) values(p_actor,'agenda',sid,old_agenda,new_agenda);
  end if;
 end if;
 insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data) values(p_actor,p_kind,sid,old_row,result_row);
 update public.app_state set payload=payload,updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond') where organization_id=rn_org_id;
 if not found then raise exception 'Agenda da organização indisponível'; end if;
 perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);return sid;
end;$function$
;

CREATE OR REPLACE FUNCTION public.save_manual_attendance(p_actor bigint, p_data jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare sid text:=coalesce(nullif(p_data->>'id',''),gen_random_uuid()::text);old_row public.attendances%rowtype;d public.doctors%rowtype;entity uuid:=(p_data->>'billing_entity_id')::uuid;method text:=p_data->>'billing_method';patient text:=p_data->>'patient_id';rn_org_id uuid;
begin
 perform pg_advisory_xact_lock(194701,1);
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);perform pg_advisory_xact_lock(194701,2);
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then raise exception 'Acesso restrito à gerência';end if;
 perform public.financial_operation(p_actor,'attendance',sid);
 select * into old_row from public.attendances where id=sid;
 if old_row.status='cancelled' then raise exception 'Atendimento cancelado não pode ser editado';end if;
 if old_row.id is not null and (old_row.origin='AGENDA' or old_row.updated_at is distinct from (p_data->>'updated_at')::timestamptz) then raise exception 'Edite a origem correta ou atualize o atendimento';end if;
 if exists(select 1 from public.billing_records b join public.invoice_billing_records ib on ib.billing_record_id=b.id where b.attendance_id=sid and ib.is_active) then raise exception 'Atendimento vinculado a NF não pode ter sua identificação alterada';end if;
 select * into d from public.doctors where id=p_data->>'doctor_id';
 if d.id is null or not d.active or not(d.billing_enabled or d.invoice_enabled) then raise exception 'Médico sem serviço financeiro/fiscal habilitado';end if;
 if method='CONVENIO' and not exists(select 1 from public.app_state s cross join lateral jsonb_array_elements(s.payload->'patients') p where s.organization_id=rn_org_id and public.billing_payer_key(p->>'insurance')=public.billing_payer_key(p_data->>'insurance') and nullif(p->>'insurance','') is not null) and not exists(select 1 from public.attendances where public.billing_payer_key(insurance)=public.billing_payer_key(p_data->>'insurance') and insurance<>'') then raise exception 'Selecione um convênio existente';end if;
 if nullif(patient,'') is null and length(trim(coalesce(p_data->>'patient_name','')))>=2 then
  if exists(select 1 from public.app_state s cross join lateral jsonb_array_elements(s.payload->'patients') p where s.organization_id=rn_org_id and lower(trim(p->>'name'))=lower(trim(p_data->>'patient_name')) and p->>'doctorId'=d.id) then raise exception 'Paciente já cadastrado para este médico. Selecione o cadastro existente';end if;
  patient:=gen_random_uuid()::text;
  update public.app_state set payload=jsonb_set(payload,'{patients}',coalesce(payload->'patients','[]')||jsonb_build_array(jsonb_build_object('id',patient,'name',trim(p_data->>'patient_name'),'doctorId',d.id,'insurance',coalesce(p_data->>'insurance','')))),updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond') where organization_id=rn_org_id;
 end if;
 if not exists(select 1 from public.app_state s cross join lateral jsonb_array_elements(s.payload->'patients') p where s.organization_id=rn_org_id and p->>'id'=patient) then raise exception 'Selecione um paciente existente';end if;
 if method is null or method not in ('PARTICULAR','CONVENIO') or nullif(trim(p_data->>'procedure'),'') is null or nullif(p_data->>'date','') is null then raise exception 'Preencha procedimento, data e forma de cobrança';end if;
 if not exists(select 1 from public.billing_doctor_entities l join public.billing_entities e on e.id=l.billing_entity_id where l.doctor_id=d.id and l.billing_entity_id=entity and l.active and e.active) and old_row.billing_entity_id is distinct from entity then raise exception 'Entidade não vinculada ao médico';end if;
 if entity is null then raise exception 'Selecione a entidade recebedora';end if;
 if exists(select 1 from public.billing_records where attendance_id=sid and payment_status='PAGO') then raise exception 'Atendimento pago: preserve sua identificação financeira';end if;
 insert into public.attendances(id,origin,patient_id,doctor_id,date,procedure,insurance,billing_method,status,billing_entity_id)
 values(sid,case when d.billing_enabled then 'FATURAMENTO_MANUAL' else 'FISCAL_MANUAL' end,patient,d.id,(p_data->>'date')::date,trim(p_data->>'procedure'),coalesce(trim(p_data->>'insurance'),''),method,'realized',entity)
 on conflict(id) do update set patient_id=excluded.patient_id,doctor_id=excluded.doctor_id,date=excluded.date,procedure=excluded.procedure,insurance=excluded.insurance,billing_method=excluded.billing_method,billing_entity_id=excluded.billing_entity_id;
 insert into public.billing_records(attendance_id,appointment_id,billing_entity_id,billing_method,payment_status,settlement_mode)
 values(sid,null,entity,method,'PENDENTE',case when method='PARTICULAR' or not d.invoice_enabled then 'DIRECT' else 'INVOICE' end)
 on conflict(attendance_id) do update set billing_entity_id=excluded.billing_entity_id,billing_method=excluded.billing_method,settlement_mode=excluded.settlement_mode,received_amount=null,paid_at=null,invoice_number=null;
 perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);return sid;
end;$function$
;

REVOKE ALL ON FUNCTION public.save_doctor_directory(bigint,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_doctor_directory(bigint,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.save_manual_attendance(bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_manual_attendance(bigint,jsonb) TO service_role;

COMMIT;
