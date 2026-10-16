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
