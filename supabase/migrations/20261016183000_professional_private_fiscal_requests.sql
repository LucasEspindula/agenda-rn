-- Fluxo fiscal das cobranças independentes. Executar somente após
-- 20261016120000_independent_professional_billing.sql, em homologação primeiro.
-- Uma solicitação fiscal pertence à cobrança (não exclusivamente à cirurgia).
drop index if exists public.invoice_requests_active_attendance;
-- O índice invoice_requests_active_record já existente mantém no máximo
-- uma solicitação PENDING/ISSUED por cobrança, com CPF validado e snapshots.

alter function public.save_professional_charge(bigint,jsonb) rename to save_professional_charge_core;

create function public.save_professional_charge(p_actor bigint,p_data jsonb)
returns uuid
language plpgsql
set search_path to ''
as $$
declare
  prior public.billing_records%rowtype;
  saved public.billing_records%rowtype;
  old_request public.invoice_requests%rowtype;
  attendance public.attendances%rowtype;
  patient jsonb;
  entity public.billing_entities%rowtype;
  professional public.doctors%rowtype;
  fiscal jsonb := p_data->'fiscal';
  recipient_kind text;
  recipient_name text;
  recipient_cpf text;
  charge_id uuid;
begin
  -- Enquanto a composição de pagamentos DIRETOS de convênio não estiver
  -- representada no controle fiscal, não registrar pagamento inconsistente.
  if p_data->>'billing_method'='CONVENIO' and p_data->>'payment_status'='PAGO'
     and p_data->>'submission_channel_code'='DIRETO'
  then
    raise exception 'Pagamento direto de convênio depende da configuração fiscal do repasse';
  end if;

  -- O núcleo faz o bloqueio da cobrança, verifica os vínculos do profissional,
  -- atualiza a composição de pagamento e abre o contexto auditável.
  if nullif(p_data->>'id','') is not null then
    select * into prior from public.billing_records
    where id=(p_data->>'id')::uuid for update;
    if prior.id is not null then
      select * into old_request from public.invoice_requests
      where billing_record_id=prior.id and status in ('PENDING','ISSUED')
      for update;
    end if;
  end if;

  if old_request.status='ISSUED' then
    if p_data->>'billing_method' is distinct from prior.billing_method
       or p_data->>'payment_status' is distinct from prior.payment_status
       or nullif(p_data->>'billing_entity_id','')::uuid is distinct from prior.billing_entity_id
       or nullif(p_data->>'received_amount','')::numeric is distinct from prior.received_amount
       or nullif(p_data->>'paid_at','')::date is distinct from prior.paid_at
    then
      raise exception 'NF particular já emitida. Corrija primeiro a nota fiscal pelo fluxo próprio';
    end if;
  end if;

  if old_request.status='PENDING' and p_data->>'payment_status'='PAGO' then
    if p_data->>'billing_method'<>'PARTICULAR'
       or nullif(p_data->>'received_amount','')::numeric is distinct from old_request.received_amount_snapshot
       or nullif(p_data->>'paid_at','')::date is distinct from old_request.paid_at_snapshot
       or nullif(p_data->>'billing_entity_id','')::uuid is distinct from old_request.billing_entity_id
    then
      raise exception 'Pagamento possui solicitação fiscal. Reverta o pagamento para cancelá-la antes de alterar valores ou recebedora';
    end if;
  end if;

  charge_id:=public.save_professional_charge_core(p_actor,p_data);
  select * into saved from public.billing_records where id=charge_id;

  if old_request.status='PENDING' and (saved.payment_status<>'PAGO' or saved.billing_method<>'PARTICULAR') then
    update public.invoice_requests set status='CANCELLED',updated_at=clock_timestamp(),updated_by=p_actor
    where id=old_request.id;
  end if;

  if saved.billing_method='PARTICULAR' and saved.payment_status='PAGO'
     and nullif(trim(coalesce(saved.invoice_number,'')),'') is null
     and not exists(select 1 from public.invoice_requests where billing_record_id=saved.id and status in ('PENDING','ISSUED'))
  then
    if jsonb_typeof(fiscal) is distinct from 'object' then
      raise exception 'Confirme o tomador da NF e as formas de pagamento particular';
    end if;
    recipient_kind:=fiscal->>'taker_kind';
    recipient_name:=nullif(trim(fiscal->>'taker_name'),'');
    recipient_cpf:=regexp_replace(coalesce(fiscal->>'taker_tax_id',''),'[^0-9]','','g');
    if recipient_kind not in ('PATIENT','OTHER') or recipient_name is null
       or length(recipient_name)>200 or length(recipient_cpf)<>11 or not public.valid_cpf(recipient_cpf)
    then raise exception 'Informe tomador e CPF válidos para solicitação fiscal';end if;

    select * into attendance from public.attendances where id=saved.attendance_id;
    select value into patient from public.app_state s
      cross join lateral jsonb_array_elements(coalesce(s.payload->'patients','[]'::jsonb))
      where s.id=1 and value->>'id'=attendance.patient_id limit 1;
    if attendance.patient_id is null or patient is null then
      raise exception 'Paciente precisa estar cadastrado para gerar solicitação fiscal';
    end if;
    if recipient_kind='PATIENT' and
       (recipient_name is distinct from patient->>'name' or
       (nullif(regexp_replace(coalesce(patient->>'cpf',''),'[^0-9]','','g'),'') is not null
        and recipient_cpf is distinct from regexp_replace(patient->>'cpf','[^0-9]','','g')))
    then raise exception 'Tomador paciente diferente do cadastro';end if;

    select * into entity from public.billing_entities where id=saved.billing_entity_id;
    select * into professional from public.doctors where id=saved.professional_id;

    insert into public.invoice_requests(
      attendance_id,billing_record_id,billing_entity_id,status,
      taker_kind,taker_name,taker_tax_id,taker_address,notes,
      received_amount_snapshot,paid_at_snapshot,patient_id,patient_name_snapshot,
      doctor_id,doctor_name_snapshot,attendance_date_snapshot,procedure_snapshot,
      entity_name_snapshot,entity_tax_id_snapshot,created_by,updated_by)
    values(
      attendance.id,saved.id,saved.billing_entity_id,'PENDING',
      recipient_kind,recipient_name,recipient_cpf,nullif(trim(fiscal->>'taker_address'),''),
      nullif(trim(fiscal->>'notes'),''),
      saved.received_amount,saved.paid_at,attendance.patient_id,
      patient->>'name',saved.professional_id,professional.name,attendance.date,
      attendance.procedure,coalesce(entity.trade_name,entity.name),entity.tax_id,
      p_actor,p_actor);
  end if;
  return charge_id;
end;
$$;

revoke all on function public.save_professional_charge(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_professional_charge(bigint,jsonb) to service_role;
revoke all on function public.save_professional_charge_core(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_professional_charge_core(bigint,jsonb) to service_role;

comment on function public.save_professional_charge(bigint,jsonb) is
'Cobrança profissional e, em pagamento PARTICULAR, solicitação fiscal atômica por billing_record_id';

-- A agenda descreve o evento clínico; a forma de cobrança de cada profissional
-- pode divergir do campo histórico do agendamento. Mantenha as restrições
-- clínicas e a proteção original para cobranças legadas de um só profissional.
create or replace function public.guard_invoice_appointments()
returns trigger language plpgsql set search_path to ''
as $$
declare
  appointment jsonb;
  previous jsonb;
  entry record;
  method text;
  payer text;
begin
  for appointment in select value from jsonb_array_elements(coalesce(new.payload->'appointments','[]'::jsonb)) loop
    method:=public.appointment_billing_method(appointment);
    if method is not null and method not in ('PARTICULAR','CONVENIO') then
      raise exception 'Forma de cobrança inválida';
    end if;
  end loop;

  for entry in
    select b.appointment_id,b.professional_id,b.professional_role,b.attendance_id,
           i.payer,b.billing_method,b.billing_entity_id,
           (b.professional_role is distinct from 'PRIMARY' or
              exists(select 1 from public.billing_records other
                     where other.attendance_id=b.attendance_id and other.id<>b.id)) independent
    from public.billing_records b
    join public.invoice_billing_records ib on ib.billing_record_id=b.id
    join public.invoices i on i.id=ib.invoice_id
    where b.appointment_id is not null and i.recipient_type='CONVENIO' and ib.is_active
  loop
    select value into appointment from jsonb_array_elements(coalesce(new.payload->'appointments','[]'::jsonb))
      where value->>'id'=entry.appointment_id;
    select value into previous from jsonb_array_elements(coalesce(old.payload->'appointments','[]'::jsonb))
      where value->>'id'=entry.appointment_id;
    if appointment is null or appointment->>'status' is distinct from 'realized'
       or appointment->>'doctorId' is distinct from previous->>'doctorId'
       or appointment->>'anesthetistId' is distinct from previous->>'anesthetistId'
       or appointment->>'patientId' is distinct from previous->>'patientId' then
      raise exception 'Atendimento com NF: preserve realização, médico, anestesista e paciente';
    end if;
    if entry.independent then
      if entry.professional_id not in (appointment->>'doctorId',appointment->>'anesthetistId') then
        raise exception 'Profissional faturado não participa mais do atendimento';
      end if;
    else
      payer:=coalesce(appointment->>'insurance','');
      if public.appointment_billing_method(appointment,entry.billing_method) is distinct from 'CONVENIO'
         or (public.billing_payer_key(payer)<>public.billing_payer_key(entry.payer)
             and (appointment->>'insurance' is distinct from previous->>'insurance'
                or nullif(trim(previous->>'insurance'),'') is not null)) then
        raise exception 'NF legada: preserve convênio e forma de cobrança';
      end if;
    end if;
  end loop;

  for entry in
    select b.appointment_id,b.attendance_id,b.professional_id,b.professional_role,r.patient_id,
      (b.professional_role is distinct from 'PRIMARY' or
       exists(select 1 from public.billing_records other
              where other.attendance_id=b.attendance_id and other.id<>b.id)) independent
    from public.invoice_requests r join public.billing_records b on b.id=r.billing_record_id
    where r.status in ('PENDING','ISSUED') and b.appointment_id is not null
  loop
    select value into appointment
    from jsonb_array_elements(coalesce(new.payload->'appointments','[]'::jsonb)||
                              coalesce(new.payload->'cancelledAppointments','[]'::jsonb))
    where value->>'id'=entry.appointment_id;
    if appointment is null or appointment->>'patientId' is distinct from entry.patient_id then
      raise exception 'Atendimento com solicitação fiscal: preserve o paciente';
    end if;
    if entry.independent then
      if entry.professional_id not in (appointment->>'doctorId',appointment->>'anesthetistId') then
        raise exception 'Profissional da solicitação fiscal não participa do atendimento';
      end if;
    elsif appointment->>'forma_cobranca' is distinct from 'PARTICULAR' then
      raise exception 'Solicitação fiscal legada: preserve a forma particular';
    end if;
  end loop;
  return new;
end;
$$;
