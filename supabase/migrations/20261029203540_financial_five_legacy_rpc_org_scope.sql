-- RN Integra 2B/2b2b-2: scope legacy billing and monthly summary SQL to active organization.
-- No data deletion; single RN Gestao organization gate remains in force.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_professional_charge(p_actor bigint, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 rn_org_id uuid;
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
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);
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
    where id=(p_data->>'id')::uuid and organization_id=rn_org_id for update;
    if prior.id is not null then
      select * into old_request from public.invoice_requests
      where billing_record_id=prior.id and status in ('PENDING','ISSUED')
      for update;
    end if;
  end if;

  if coalesce((p_data->>'no_invoice')::boolean,false) and old_request.id is not null then
    raise exception 'Existe solicitação fiscal. Sem NF não pode substituir uma solicitação existente';
  end if;
  if old_request.status='ISSUED' then
    if p_data->>'billing_method' is distinct from prior.billing_method
       or p_data->>'professional_id' is distinct from prior.professional_id
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
       or p_data->>'professional_id' is distinct from prior.professional_id
       or nullif(p_data->>'received_amount','')::numeric is distinct from old_request.received_amount_snapshot
       or nullif(p_data->>'paid_at','')::date is distinct from old_request.paid_at_snapshot
       or nullif(p_data->>'billing_entity_id','')::uuid is distinct from old_request.billing_entity_id
    then
      raise exception 'Pagamento possui solicitação fiscal. Reverta o pagamento para cancelá-la antes de alterar valores ou recebedora';
    end if;
  end if;

  charge_id:=public.save_professional_charge_core(p_actor,p_data);
  select * into saved from public.billing_records where id=charge_id and organization_id=rn_org_id;

  if old_request.status='PENDING' and (saved.payment_status<>'PAGO' or saved.billing_method<>'PARTICULAR') then
    update public.invoice_requests set status='CANCELLED',updated_at=clock_timestamp(),updated_by=p_actor
    where id=old_request.id;
  end if;

  if saved.billing_method='PARTICULAR' and saved.payment_status='PAGO'
    and coalesce((p_data->>'no_invoice')::boolean,false) then
    if nullif(trim(coalesce(saved.invoice_number,'')),'') is not null or
      exists(select 1 from public.invoice_requests
       where billing_record_id=saved.id and status in ('PENDING','ISSUED')) then
      raise exception 'NF ou solicitação existente: Sem NF não é permitido';
    end if;
    update public.billing_records set no_invoice=true where id=saved.id;
  else
    update public.billing_records set no_invoice=false where id=saved.id and no_invoice;
  end if;
  if saved.billing_method='PARTICULAR' and saved.payment_status='PAGO'
     and not coalesce((p_data->>'no_invoice')::boolean,false)
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

    select * into attendance from public.attendances where id=saved.attendance_id and organization_id=rn_org_id;
    select value into patient from public.app_state s
      cross join lateral jsonb_array_elements(coalesce(s.payload->'patients','[]'::jsonb))
      where s.organization_id=rn_org_id and value->>'id'=attendance.patient_id limit 1;
    if attendance.patient_id is null or patient is null then
      raise exception 'Paciente precisa estar cadastrado para gerar solicitação fiscal';
    end if;
    if recipient_kind='PATIENT' and
       (recipient_name is distinct from patient->>'name' or
       (nullif(regexp_replace(coalesce(patient->>'cpf',''),'[^0-9]','','g'),'') is not null
        and recipient_cpf is distinct from regexp_replace(patient->>'cpf','[^0-9]','','g')))
    then raise exception 'Tomador paciente diferente do cadastro';end if;

    select * into entity from public.billing_entities where id=saved.billing_entity_id and organization_id=rn_org_id;
    select * into professional from public.doctors where id=saved.professional_id and organization_id=rn_org_id;

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
$function$;

CREATE OR REPLACE FUNCTION public.save_professional_charge_core(p_actor bigint, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 rn_org_id uuid;
  role_name text;
  target_id uuid;
  current_row public.billing_records%rowtype;
  attendance public.attendances%rowtype;
  entity_id uuid;
  payer_id uuid;
  payer_name text;
  method text;
  status_value text;
  settlement text;
  channel text;
  modality text;
  paid_on date;
  received numeric;
begin
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);
  perform pg_advisory_xact_lock(194701,3);
  select role into role_name from public.users where id=p_actor;
  if role_name is null or role_name not in ('general_manager','secretary') then raise exception 'Acesso negado'; end if;
  if coalesce(nullif(trim(p_data->>'attendance_id'),''),'')='' or coalesce(nullif(trim(p_data->>'professional_id'),''),'')='' then raise exception 'Informe atendimento e profissional responsável'; end if;
  select * into attendance from public.attendances where id=p_data->>'attendance_id' and organization_id=rn_org_id for update;
  if not found or attendance.status='cancelled' then raise exception 'Atendimento cancelado ou inexistente'; end if;
  if not (
    attendance.doctor_id=p_data->>'professional_id'
    or exists (
      select 1
      from public.app_state s
      cross join lateral jsonb_array_elements(coalesce(s.payload->'appointments','[]')) clinical
      where s.organization_id=rn_org_id
        and clinical->>'id'=attendance.appointment_id
        and p_data->>'professional_id' in (clinical->>'doctorId',clinical->>'anesthetistId')
    )
  ) then raise exception 'Profissional não participa deste atendimento'; end if;
  if role_name='secretary' and not exists (
    select 1 from public.agenda_access g
    where g.user_id=p_actor and g.professional_id=p_data->>'professional_id'
  ) then raise exception 'Agenda sem permissão para este profissional'; end if;
  if not exists(select 1 from public.doctors where id=p_data->>'professional_id' and organization_id=rn_org_id and active and billing_enabled) then raise exception 'Profissional inexistente ou sem faturamento habilitado'; end if;
  entity_id:=nullif(p_data->>'billing_entity_id','')::uuid;
  if entity_id is null or not exists(select 1 from public.billing_entities where id=entity_id and organization_id=rn_org_id and active) then raise exception 'Entidade recebedora inativa ou inexistente'; end if;
  if not exists(select 1 from public.billing_doctor_entities where doctor_id=p_data->>'professional_id' and billing_entity_id=entity_id and organization_id=rn_org_id and active) then raise exception 'Selecione uma entidade vinculada ao profissional'; end if;
  method:=p_data->>'billing_method'; status_value:=coalesce(p_data->>'payment_status','PENDENTE');
  if method not in ('PARTICULAR','CONVENIO') or status_value not in ('PENDENTE','PAGO') then raise exception 'Forma de cobrança ou status inválido'; end if;
  modality:=coalesce(nullif(p_data->>'commercial_modality_code',''),case when method='PARTICULAR' then 'PARTICULAR' else 'LEGADO' end);
  channel:=coalesce(nullif(p_data->>'submission_channel_code',''),case when method='PARTICULAR' then 'DIRETO' else 'LEGADO' end);
  if not exists(select 1 from public.billing_commercial_modalities where code=modality and active) or not exists(select 1 from public.billing_submission_channels where code=channel and active) then raise exception 'Modalidade ou canal de faturamento inválido'; end if;
  payer_id:=nullif(p_data->>'effective_payer_id','')::uuid;
  if payer_id is not null then select name into payer_name from public.billing_counterparties where id=payer_id and active; if payer_name is null then raise exception 'Pagador ou intermediário inativo ou inexistente'; end if; end if;
  target_id:=nullif(p_data->>'id','')::uuid;
  if target_id is not null then
    select * into current_row from public.billing_records where id=target_id for update;
    if not found or current_row.attendance_id<>attendance.id then raise exception 'Cobrança não encontrada'; end if;
    if current_row.updated_at is distinct from nullif(p_data->>'updated_at','')::timestamptz then raise exception 'Cobrança alterada. Atualize a página'; end if;
    if exists(select 1 from public.invoice_billing_records where billing_record_id=target_id and is_active)
       and (current_row.professional_id is distinct from p_data->>'professional_id' or current_row.billing_entity_id is distinct from entity_id or current_row.billing_method is distinct from method) then
      raise exception 'Edite os dados fiscais na NF/lote vinculada';
    end if;
  else
    select * into current_row from public.billing_records where attendance_id=attendance.id and professional_id=p_data->>'professional_id' for update;
    if found then raise exception 'Já existe uma cobrança para este profissional neste atendimento'; end if;
    target_id:=gen_random_uuid();
  end if;
  perform public.financial_operation(p_actor,'professional_charge',target_id::text);
  settlement:=case when method='PARTICULAR' or channel='DIRETO' then 'DIRECT' else 'INVOICE' end;
  if settlement='INVOICE' and status_value='PAGO' then raise exception 'Registre o pagamento do convênio na NF/lote'; end if;
  paid_on:=nullif(p_data->>'paid_at','')::date; received:=nullif(p_data->>'received_amount','')::numeric;
  if status_value='PAGO' and (paid_on is null or received is null or received<0) then raise exception 'Pagamento direto exige valor e data'; end if;
  perform set_config('rn.record',target_id::text,true);
  insert into public.billing_records(id,attendance_id,appointment_id,settlement_mode,billing_entity_id,billing_method,payment_status,invoice_number,received_amount,paid_at,notes,professional_id,professional_role,patient_insurance_snapshot,commercial_modality_code,submission_channel_code,effective_payer_id,effective_payer_role,effective_payer_name_snapshot,billing_entity_name_snapshot,service_group_key,updated_at,updated_by)
  values(target_id,attendance.id,attendance.appointment_id,settlement,entity_id,method,status_value,
    case when method='PARTICULAR' then nullif(trim(p_data->>'invoice_number'),'') end,
    case when settlement='DIRECT' then received end,case when settlement='DIRECT' then paid_on end,
    nullif(trim(p_data->>'notes'),''),p_data->>'professional_id',coalesce(nullif(p_data->>'professional_role',''),'OTHER'),coalesce(p_data->>'patient_insurance_snapshot',attendance.insurance,''),modality,channel,payer_id,
    case when payer_id is null then null else coalesce(nullif(p_data->>'effective_payer_role',''),'PAYER') end,
    coalesce(payer_name,nullif(trim(p_data->>'effective_payer_name_snapshot'),'')),
    (select coalesce(trade_name,name) from public.billing_entities where id=entity_id),nullif(trim(p_data->>'service_group_key'),''),clock_timestamp(),p_actor)
  on conflict(id) do update set settlement_mode=excluded.settlement_mode,billing_entity_id=excluded.billing_entity_id,billing_method=excluded.billing_method,payment_status=excluded.payment_status,invoice_number=excluded.invoice_number,received_amount=excluded.received_amount,paid_at=excluded.paid_at,notes=excluded.notes,professional_id=excluded.professional_id,professional_role=excluded.professional_role,patient_insurance_snapshot=excluded.patient_insurance_snapshot,commercial_modality_code=excluded.commercial_modality_code,submission_channel_code=excluded.submission_channel_code,effective_payer_id=excluded.effective_payer_id,effective_payer_role=excluded.effective_payer_role,effective_payer_name_snapshot=excluded.effective_payer_name_snapshot,billing_entity_name_snapshot=excluded.billing_entity_name_snapshot,service_group_key=excluded.service_group_key,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  if settlement='DIRECT' and status_value='PAGO' then
    if jsonb_typeof(p_data->'payment_parts') is distinct from 'array' then raise exception 'Informe as formas de pagamento'; end if;
    perform public.write_payment_parts(target_id,null,p_data->'payment_parts');
    update public.billing_records set payment_composition_verified=true where id=target_id;
  elsif status_value='PENDENTE' then
    delete from public.payment_parts where billing_record_id=target_id;
    update public.billing_records set payment_composition_verified=false where id=target_id;
  end if;
  return target_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_billing_legacy_single_charge(p_actor bigint, p_kind text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 rn_org_id uuid; sid uuid; old_invoice public.invoices%rowtype; b public.billing_records%rowtype; a public.attendances%rowtype; r public.invoice_requests%rowtype;
 entry record; key text; recipient jsonb; canonical text; target_id text; total numeric; selected jsonb; previous_payment_status text;
begin
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);
 perform pg_advisory_xact_lock(194701,1);perform pg_advisory_xact_lock(194701,2);
 if not exists(select 1 from public.users where id=p_actor and (role='general_manager' or (role='secretary' and p_kind='record'))) then raise exception 'Acesso negado';end if;
 perform public.financial_operation(p_actor,p_kind,p_data->>'id');
 foreach key in array array['total_amount','net_amount','received_amount','closing_adjustment'] loop
  if nullif(p_data->>key,'') is not null then p_data:=jsonb_set(p_data,array[key],to_jsonb(round((p_data->>key)::numeric,2)));end if;
 end loop;
 if p_kind in ('undo_invoice','cancel_invoice','replace_invoice') then
  select * into old_invoice from public.invoices where id=(p_data->>'id')::uuid for update;
  if old_invoice.id is null then raise exception 'NF não encontrada';end if;
  if old_invoice.status<>'ACTIVE' or old_invoice.voided_at is not null then raise exception 'NF sem vínculo operacional ativo';end if;
  if old_invoice.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'NF alterada. Atualize a página';end if;
  if nullif(trim(p_data->>'reason'),'') is null then raise exception 'Informe o motivo da operação fiscal';end if;
  update public.invoice_billing_records set is_active=false where invoice_id=old_invoice.id;
  update public.billing_records set payment_status='PENDENTE' where billing_method='CONVENIO' and id in(select billing_record_id from public.invoice_billing_records where invoice_id=old_invoice.id);
  select * into r from public.invoice_requests where invoice_id=old_invoice.id;
  if r.id is not null then update public.invoice_requests set status='PENDING',invoice_id=null where id=r.id;end if;
  if p_kind='undo_invoice' then
   update public.invoices set voided_at=clock_timestamp(),voided_by=p_actor,void_reason=trim(p_data->>'reason') where id=old_invoice.id;
  elsif p_kind='cancel_invoice' then
   update public.invoices set status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=p_actor,cancellation_reason=trim(p_data->>'reason') where id=old_invoice.id;
  else
   if jsonb_typeof(p_data->'replacement') is distinct from 'object' then raise exception 'Informe a NF substituta';end if;
   recipient:=(p_data->'replacement')-'id'-'updated_at';
   if recipient->>'recipient_type' is distinct from old_invoice.recipient_type then raise exception 'Preserve o tipo da NF substituída';end if;
   if r.id is not null then recipient:=recipient||jsonb_build_object('request_id',r.id);end if;
   -- The same operation context is retained through creation, allocation and payment parts.
   foreach key in array array['total_amount','net_amount','closing_adjustment'] loop
    if nullif(recipient->>key,'') is not null then recipient:=jsonb_set(recipient,array[key],to_jsonb(round((recipient->>key)::numeric,2)));end if;
   end loop;
   p_data:=recipient;
   update public.invoices set status='REPLACED' where id=old_invoice.id;
  end if;
  if p_kind<>'replace_invoice' then
   perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);return old_invoice.id;
  end if;
 end if;
 if p_kind='record' then
  target_id:=coalesce(p_data->>'attendance_id',p_data->>'appointment_id');
  if exists(select 1 from public.attendances where id=target_id and organization_id=rn_org_id and status='cancelled') then raise exception 'Atendimento cancelado';end if;
  select * into b from public.billing_records where attendance_id=target_id;
  previous_payment_status:=b.payment_status;
  -- Ignore stale client payment values when explicitly returning to pending.
  if b.payment_status='PAGO' and p_data->>'payment_status'='PENDENTE' then
   p_data:=p_data||jsonb_build_object('received_amount',null,'paid_at',null);
  end if;
  if p_data->'fiscal'->>'taker_kind'='PATIENT' then
   select * into r from public.invoice_requests where billing_record_id=b.id and status in ('PENDING','ISSUED');
   select p->>'name' into canonical from public.app_state s cross join lateral jsonb_array_elements(s.payload->'patients') p where s.organization_id=rn_org_id and p->>'id'=coalesce((select patient_id from public.attendances where id=target_id and organization_id=rn_org_id),(select ap->>'patientId' from public.app_state st cross join lateral jsonb_array_elements(st.payload->'appointments') ap where st.organization_id=rn_org_id and ap->>'id'=target_id));
   p_data:=jsonb_set(p_data,'{fiscal,taker_name}',to_jsonb(coalesce(r.taker_name,canonical,'')));
  end if;
 end if;
 if p_kind in ('invoice','replace_invoice') then
  if exists(select 1 from public.invoices where id=nullif(p_data->>'id','')::uuid and (status<>'ACTIVE' or voided_at is not null)) then raise exception 'Documento histórico não pode ser editado';end if;
  if coalesce(p_data->>'recipient_type','CONVENIO')='CONVENIO' then
   selected:=coalesce(p_data->'attendance_ids',p_data->'appointment_ids');
   if jsonb_typeof(selected) is distinct from 'array' or jsonb_array_length(selected)=0 then raise exception 'Selecione os atendimentos da NF';end if;
   if nullif(p_data->>'net_amount','') is null then raise exception 'Informe o valor líquido';end if;
   if jsonb_typeof(p_data->'item_amounts') is distinct from 'object' then raise exception 'Informe o valor de cada atendimento';end if;
   total:=0;
   for key in select distinct value from jsonb_array_elements_text(selected) loop
    if jsonb_typeof(p_data->'item_amounts'->key) is distinct from 'number' then raise exception 'Informe o valor de cada atendimento';end if;
    p_data:=jsonb_set(p_data,array['item_amounts',key],to_jsonb(round((p_data->'item_amounts'->>key)::numeric,2)));
    total:=total+(p_data->'item_amounts'->>key)::numeric;
   end loop;
   if total+coalesce((p_data->>'closing_adjustment')::numeric,0)<>(p_data->>'net_amount')::numeric then raise exception 'A soma dos itens e ajuste deve ser igual ao valor líquido';end if;
  end if;
 end if;
 sid:=public.save_billing_fiscal_core(p_actor,case when p_kind='replace_invoice' then 'invoice' else p_kind end,p_data);
 if p_kind='record' then
  select * into b from public.billing_records where id=sid;
  if b.billing_method='PARTICULAR' and b.payment_status='PAGO' then
   if p_data ? 'payment_parts' then perform public.write_payment_parts(sid,null,p_data->'payment_parts');
    update public.billing_records set payment_composition_verified=true where id=sid;
   elsif not exists(select 1 from public.payment_parts where billing_record_id=sid) and (b.payment_composition_verified or p_data ? 'fiscal' or previous_payment_status is distinct from 'PAGO') then raise exception 'Informe as formas de pagamento';end if;
  elsif previous_payment_status='PAGO' and b.payment_status='PENDENTE' then
   delete from public.payment_parts where billing_record_id=sid;
   update public.billing_records set received_amount=null,paid_at=null,payment_composition_verified=false where id=sid;
  end if;
 elsif p_kind in ('invoice','replace_invoice') then
  update public.invoices set closing_adjustment=coalesce((p_data->>'closing_adjustment')::numeric,0),closing_adjustment_reason=nullif(trim(p_data->>'closing_adjustment_reason'),''),allocation_verified=true where id=sid;
  if coalesce(p_data->>'recipient_type','CONVENIO')='CONVENIO' and nullif(p_data->>'paid_at','') is not null then
   if p_data ? 'payment_parts' then perform public.write_payment_parts(null,sid,p_data->'payment_parts');
    update public.invoices set payment_composition_verified=true where id=sid;
   elsif not exists(select 1 from public.payment_parts where invoice_id=sid) then raise exception 'Informe as formas de pagamento';end if;
  elsif coalesce(p_data->>'recipient_type','CONVENIO')='CONVENIO' then
   delete from public.payment_parts where invoice_id=sid;
   update public.invoices set payment_composition_verified=false where id=sid;
  end if;
  if p_kind='replace_invoice' then update public.invoices set replaced_by_invoice_id=sid where id=old_invoice.id;end if;
 end if;
 perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);return sid;
end;$function$;

CREATE OR REPLACE FUNCTION public.save_billing_fiscal_core(p_actor bigint, p_kind text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 rn_org_id uuid; role_name text; sid uuid; old_row jsonb; result_row jsonb; state jsonb; a jsonb;
 entity uuid; item uuid; record public.billing_records%rowtype; old_items jsonb; appointment_ids jsonb; selected_records uuid[]:='{}'; appt_id text; payer_name text; before_records jsonb; old_record jsonb; before_item_values jsonb; amount_entry record; mode text; physician public.doctors%rowtype;
begin
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);
 perform pg_advisory_xact_lock(194701,1);
 perform pg_advisory_xact_lock(194701,2);
 select role into role_name from public.users where id=p_actor;
 if role_name is null or role_name not in ('general_manager','secretary') then raise exception 'Acesso negado'; end if;
 if p_kind='record' then p_data:=p_data||jsonb_build_object('appointment_id',coalesce(p_data->>'attendance_id',p_data->>'appointment_id'));end if;
 if p_kind='invoice' and p_data ? 'attendance_ids' then p_data:=p_data||jsonb_build_object('appointment_ids',p_data->'attendance_ids');end if;
 select payload into state from public.app_state where organization_id=rn_org_id;
 if state is null then raise exception 'Agenda da organização indisponível';end if;
 sid:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
 if nullif(current_setting('rn.operation',true),'') is null or current_setting('rn.actor',true)<>p_actor::text then raise exception 'Operação fiscal obrigatória';end if;
 if p_kind in ('entity','link','delete_entity','delete_link') and role_name<>'general_manager' then raise exception 'Somente a gerência pode configurar entidades'; end if;
 if p_kind in ('delete_entity','delete_link') then
  if p_kind='delete_entity' then
   select to_jsonb(e) into old_row from public.billing_entities e where id=sid;
  else
   select to_jsonb(l) into old_row from public.billing_doctor_entities l where id=sid;
  end if;
  if old_row is null then raise exception 'Registro não encontrado'; end if;
  if (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Registro alterado. Atualize a página'; end if;
  if p_kind='delete_entity' then
   if exists(select 1 from public.billing_records where billing_entity_id=sid) or exists(select 1 from public.invoices where billing_entity_id=sid) or exists(select 1 from public.billing_doctor_entities where billing_entity_id=sid) then raise exception 'Entidade possui vínculos ou histórico financeiro. Inative-a para preservar o histórico'; end if;
   delete from public.billing_entities where id=sid;
  else
   delete from public.billing_doctor_entities where id=sid;
  end if;
 elsif p_kind='entity' then
  select to_jsonb(e) into old_row from public.billing_entities e where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Registro alterado por outro usuário. Atualize a página'; end if;
  if coalesce(p_data->>'person_type','') not in ('PF','PJ') or length(regexp_replace(coalesce(p_data->>'tax_id',''),'[^0-9]','','g'))<>(case when p_data->>'person_type'='PF' then 11 else 14 end) then raise exception 'Informe CPF/CNPJ e tipo de pessoa'; end if;
  insert into public.billing_entities(id,name,tax_id,person_type,trade_name,active,updated_at,updated_by)
  values(sid,trim(p_data->>'name'),regexp_replace(p_data->>'tax_id','[^0-9]','','g'),p_data->>'person_type',nullif(trim(p_data->>'trade_name'),''),coalesce((p_data->>'active')::boolean,true),clock_timestamp(),p_actor)
  on conflict(id) do update set name=excluded.name,tax_id=excluded.tax_id,person_type=excluded.person_type,trade_name=excluded.trade_name,active=excluded.active,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(billing_entities.*) into result_row;
 elsif p_kind='link' then
  select to_jsonb(l) into old_row from public.billing_doctor_entities l where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Vínculo alterado. Atualize a página'; end if;
  if not exists(select 1 from public.doctors where id=p_data->>'doctor_id') then raise exception 'Médico inexistente'; end if;
  if not exists(select 1 from public.billing_entities where id=(p_data->>'billing_entity_id')::uuid and active) then raise exception 'Entidade inativa ou inexistente'; end if;
  if exists(select 1 from public.billing_doctor_entities where doctor_id=p_data->>'doctor_id' and billing_entity_id=(p_data->>'billing_entity_id')::uuid and id<>sid) then raise exception 'Este vínculo já existe. Edite o vínculo cadastrado'; end if;
  insert into public.billing_doctor_entities(id,doctor_id,billing_entity_id,active,updated_at,updated_by)
  values(sid,p_data->>'doctor_id',(p_data->>'billing_entity_id')::uuid,coalesce((p_data->>'active')::boolean,true),clock_timestamp(),p_actor)
  on conflict(id) do update set active=excluded.active,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(billing_doctor_entities.*) into result_row;
 elsif p_kind='record' then
  if not exists(select 1 from public.attendances where id=p_data->>'appointment_id')
     and p_data->>'billing_method'='PARTICULAR' then
   select clinical into a from jsonb_array_elements(coalesce(state->'appointments','[]')) clinical
    where clinical->>'id'=p_data->>'appointment_id';
   if a is null or a->>'forma_cobranca' is distinct from 'PARTICULAR' then
    raise exception 'Use a forma de cobrança informada no agendamento';
   end if;
   if role_name<>'general_manager' and not exists(select 1 from public.agenda_access g
      where g.user_id=p_actor and g.professional_id in(a->>'doctorId',a->>'anesthetistId')) then
    raise exception 'Agenda sem permissão';
   end if;
   insert into public.attendances(id,appointment_id,origin,patient_id,doctor_id,date,procedure,insurance,billing_method,status)
    values(a->>'id',a->>'id','AGENDA',nullif(a->>'patientId',''),a->>'doctorId',(a->>'date')::date,
     coalesce(a->>'procedure','Procedimento'),coalesce(a->>'insurance',(select p->>'insurance'
       from jsonb_array_elements(coalesce(state->'patients','[]')) p where p->>'id'=a->>'patientId'),''),
     'PARTICULAR',a->>'status');
  end if;
  a:=public.financial_attendance(p_data->>'appointment_id');
  if a is null then raise exception 'Atendimento inexistente'; end if;
  if role_name<>'general_manager' and not exists(select 1 from public.app_state s cross join lateral jsonb_array_elements(coalesce(s.payload->'appointments','[]')) clinical join public.agenda_access g on g.user_id=p_actor and g.professional_id in(clinical->>'doctorId',clinical->>'anesthetistId') where s.organization_id=rn_org_id and clinical->>'id'=a->>'appointment_id') then raise exception 'Agenda sem permissão'; end if;
  select to_jsonb(b) into old_row from public.billing_records b where attendance_id=p_data->>'appointment_id';
  if old_row is not null then sid:=(old_row->>'id')::uuid; else sid:=gen_random_uuid(); end if;
  perform set_config('rn.record',sid::text,true);
  if public.prepare_private_payment(old_row,p_data) then return sid;end if;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Financeiro alterado por outro usuário. Atualize'; end if;
  if exists(select 1 from public.invoice_billing_records where billing_record_id=sid and is_active) then raise exception 'Edite o pagamento e os dados fiscais na NF/lote vinculada'; end if;
  entity:=(p_data->>'billing_entity_id')::uuid;
  a:=public.attribute_financial_attendance(p_data->>'appointment_id',entity);
  if entity is null or (old_row->>'billing_entity_id' is distinct from entity::text and not exists(
   select 1 from public.billing_doctor_entities l join public.billing_entities e on e.id=l.billing_entity_id
   where l.billing_entity_id=entity and l.doctor_id in (a->>'doctorId',a->>'anesthetistId') and l.active and e.active
)) then raise exception 'Selecione uma entidade vinculada ao médico'; end if;
  if p_data->>'billing_method' not in ('PARTICULAR','CONVENIO') or p_data->>'payment_status' not in ('PENDENTE','PAGO') then raise exception 'Forma de cobrança ou status inválido'; end if;
  select * into physician from public.doctors where id=a->>'doctorId';
  if not physician.billing_enabled then raise exception 'Controle financeiro não habilitado para o médico';end if;
  mode:=case when p_data->>'billing_method'='PARTICULAR' or old_row->>'settlement_mode'='DIRECT' or not physician.invoice_enabled then 'DIRECT' else 'INVOICE' end;
  if mode='INVOICE' and p_data->>'payment_status'='PAGO' then raise exception 'Registre o pagamento do convênio na NF/lote'; end if;
  if p_data->>'payment_status'='PAGO' and (nullif(p_data->>'paid_at','') is null or nullif(p_data->>'received_amount','') is null) then raise exception 'Pagamento particular exige valor e data'; end if;
  if public.appointment_billing_method(a) is not null and public.appointment_billing_method(a) is distinct from p_data->>'billing_method' then raise exception 'Use a forma de cobrança informada no agendamento'; end if;
  insert into public.billing_records(id,attendance_id,appointment_id,settlement_mode,billing_entity_id,billing_method,payment_status,invoice_number,received_amount,paid_at,notes,updated_at,updated_by)
  values(sid,p_data->>'appointment_id',a->>'appointment_id',mode,entity,p_data->>'billing_method',p_data->>'payment_status',case when p_data->>'billing_method'='PARTICULAR' then nullif(trim(p_data->>'invoice_number'),'') end,
   case when mode='DIRECT' then nullif(p_data->>'received_amount','')::numeric end,
   case when mode='DIRECT' then nullif(p_data->>'paid_at','')::date end,nullif(trim(p_data->>'notes'),''),clock_timestamp(),p_actor)
  on conflict(id) do update set settlement_mode=excluded.settlement_mode,billing_entity_id=excluded.billing_entity_id,billing_method=excluded.billing_method,payment_status=excluded.payment_status,invoice_number=excluded.invoice_number,received_amount=excluded.received_amount,paid_at=excluded.paid_at,notes=excluded.notes,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(billing_records.*) into result_row;
  update public.attendances set billing_entity_id=entity,billing_method=p_data->>'billing_method' where id=p_data->>'appointment_id';
  -- Preserve compatibility with the explicit scheduling choice.
  update public.app_state st set payload=jsonb_set(st.payload,'{appointments}',coalesce((select jsonb_agg(case when x->>'id'=a->>'appointment_id' then x||jsonb_build_object('forma_cobranca',p_data->>'billing_method') else x end order by n) from jsonb_array_elements(st.payload->'appointments') with ordinality arr(x,n)),'[]')),updated_at=greatest(clock_timestamp(),st.updated_at+interval '1 millisecond') where st.organization_id=rn_org_id;
  perform public.finish_private_payment(p_actor,sid,p_data);
 elsif p_kind='invoice' then
  if coalesce(p_data->>'recipient_type','CONVENIO')='PARTICULAR' then
   sid:=public.save_private_invoice(p_actor,p_data);return sid;
  end if;
  if exists(select 1 from public.invoices where id=sid and recipient_type='PARTICULAR') then raise exception 'Não altere o tipo de uma NF emitida';end if;
  if role_name<>'general_manager' then raise exception 'Somente a gerência pode gerenciar lotes'; end if;
  select to_jsonb(i) into old_row from public.invoices i where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'NF alterada por outro usuário. Atualize'; end if;
  entity:=(p_data->>'billing_entity_id')::uuid;
  if nullif(trim(p_data->>'payer'),'') is null or nullif(trim(p_data->>'invoice_number'),'') is null or nullif(p_data->>'issue_date','') is null then raise exception 'Preencha número, pagador e emissão'; end if;
  payer_name:=public.billing_payer_key(p_data->>'payer');
  if not exists(
   select 1 from (
    select insurance as name from public.attendances
    union all select value->>'insurance' as name from jsonb_array_elements(coalesce(state->'patients','[]'))
    union all select value->>'insurance' from jsonb_array_elements(coalesce(state->'appointments','[]'))
    union all select old_row->>'payer'
   ) payers where public.billing_payer_key(name)=payer_name and payer_name<>''
  ) then raise exception 'Selecione um pagador existente no sistema'; end if;
  if not exists(select 1 from public.billing_entities where id=entity and (active or old_row->>'billing_entity_id'=entity::text)) then raise exception 'Entidade inativa ou inexistente'; end if;
  if p_data ? 'appointment_ids' then
   appointment_ids:=p_data->'appointment_ids';
   if jsonb_typeof(appointment_ids) is distinct from 'array' then raise exception 'Lista de atendimentos inválida'; end if;
  else
   -- Compatibility for an already open older client. Every supplied ID must exist.
   if jsonb_typeof(p_data->'record_ids') is distinct from 'array' then raise exception 'Lista de atendimentos inválida'; end if;
   appointment_ids:='[]';
   for item in select value::uuid from jsonb_array_elements_text(p_data->'record_ids') loop
    select * into record from public.billing_records where id=item;
    if not found then raise exception 'Faturamento inexistente'; end if;
    appointment_ids:=appointment_ids||jsonb_build_array(record.attendance_id);
   end loop;
  end if;
  if jsonb_array_length(appointment_ids)=0 and nullif(p_data->>'paid_at','') is not null then raise exception 'Vincule pelo menos um atendimento antes de confirmar o pagamento'; end if;
  if p_data ? 'item_amounts' then
   if jsonb_typeof(p_data->'item_amounts') is distinct from 'object' then raise exception 'Valores individuais inválidos'; end if;
   for amount_entry in select * from jsonb_each(p_data->'item_amounts') loop
    if not (appointment_ids ? amount_entry.key) or jsonb_typeof(amount_entry.value) not in ('number','null') then raise exception 'Valor individual inválido ou atendimento não selecionado'; end if;
    if jsonb_typeof(amount_entry.value)='number' and ((amount_entry.value::text)::numeric<0 or (amount_entry.value::text)::numeric>9999999999.99 or round((amount_entry.value::text)::numeric,2)<>(amount_entry.value::text)::numeric) then raise exception 'Valor individual deve ser positivo ou zero, com até duas casas decimais'; end if;
   end loop;
  end if;
  select coalesce(jsonb_agg(to_jsonb(ib)),'[]') into before_item_values from public.invoice_billing_records ib where ib.invoice_id=sid;
  select coalesce(jsonb_agg(billing_record_id),'[]') into old_items from public.invoice_billing_records where invoice_billing_records.invoice_id=sid;
  select coalesce(jsonb_agg(to_jsonb(b)),'[]') into before_records from public.billing_records b where b.id in(select billing_record_id from public.invoice_billing_records where invoice_billing_records.invoice_id=sid);
  for appt_id in select distinct value from jsonb_array_elements_text(appointment_ids) loop
   a:=public.attribute_financial_attendance(appt_id,entity);
   if a is null then raise exception 'Atendimento cancelado ou inexistente'; end if;
   select * into record from public.billing_records b where b.attendance_id=appt_id;
   if a->>'status' is distinct from 'realized' then raise exception 'Somente atendimentos realizados podem ser vinculados'; end if;
   if public.appointment_billing_method(a,record.billing_method) is distinct from 'CONVENIO' then raise exception 'Atendimento não é cobrado por convênio'; end if;
   if public.billing_payer_key(coalesce(a->>'insurance',''))<>payer_name then raise exception 'Convênio do atendimento diferente do pagador'; end if;
   if not exists(select 1 from public.invoice_billing_records ib where ib.invoice_id=sid and ib.billing_record_id=record.id and record.billing_entity_id=entity) and not exists(select 1 from public.billing_doctor_entities l join public.billing_entities be on be.id=l.billing_entity_id and be.active where l.billing_entity_id=entity and l.active and l.doctor_id in(a->>'doctorId',a->>'anesthetistId')) then raise exception 'Médico sem vínculo ativo com a entidade recebedora'; end if;
   if not exists(select 1 from public.invoice_billing_records where invoice_id=sid and billing_record_id=record.id) and not exists(select 1 from public.doctors where id=a->>'doctorId' and invoice_enabled) then raise exception 'Gestão de NF não habilitada para o médico';end if;
   if record.id is not null and record.settlement_mode='DIRECT' then raise exception 'Atendimento utiliza pagamento direto, sem gestão de NF';end if;
   if record.id is not null and exists(select 1 from public.invoice_billing_records ib where ib.billing_record_id=record.id and ib.invoice_id<>sid and ib.is_active) then raise exception 'Atendimento já vinculado a outra NF'; end if;
   if record.id is not null and (record.billing_method<>'CONVENIO' or (record.payment_status='PAGO' and not exists(select 1 from public.invoice_billing_records ib where ib.billing_record_id=record.id and ib.invoice_id=sid))) then raise exception 'Faturamento individual já configurado ou pago. Revise antes de vincular'; end if;
   old_record:=case when record.id is not null then to_jsonb(record) end;
   if record.id is null then
    insert into public.billing_records(attendance_id,appointment_id,settlement_mode,billing_entity_id,billing_method,payment_status,received_amount,paid_at,invoice_number,updated_at,updated_by)
    values(appt_id,a->>'appointment_id','INVOICE',entity,'CONVENIO','PENDENTE',null,null,null,clock_timestamp(),p_actor) returning * into record;
   else
    update public.billing_records b set billing_entity_id=entity,received_amount=null,paid_at=null,invoice_number=null,updated_at=clock_timestamp(),updated_by=p_actor where b.id=record.id returning b.* into record;
   end if;
   update public.attendances set billing_entity_id=entity where id=appt_id;
   selected_records:=array_append(selected_records,record.id);
   insert into public.billing_audit(actor_id,action,record_id,before_data,after_data) values(p_actor,'invoice_record_prepared',record.id,old_record,to_jsonb(record));
  end loop;
  insert into public.invoices(id,billing_entity_id,invoice_number,payer,issue_date,total_amount,net_amount,paid_at,notes,updated_at,updated_by)
  values(sid,entity,trim(p_data->>'invoice_number'),payer_name,(p_data->>'issue_date')::date,nullif(p_data->>'total_amount','')::numeric,nullif(p_data->>'net_amount','')::numeric,nullif(p_data->>'paid_at','')::date,nullif(trim(p_data->>'notes'),''),clock_timestamp(),p_actor)
  on conflict(id) do update set billing_entity_id=excluded.billing_entity_id,invoice_number=excluded.invoice_number,payer=excluded.payer,issue_date=excluded.issue_date,total_amount=excluded.total_amount,net_amount=excluded.net_amount,paid_at=excluded.paid_at,notes=excluded.notes,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(invoices.*) into result_row;
  update public.billing_records set payment_status='PENDENTE',updated_at=clock_timestamp(),updated_by=p_actor where id in(select billing_record_id from public.invoice_billing_records where invoice_billing_records.invoice_id=sid);
  delete from public.invoice_billing_records where invoice_billing_records.invoice_id=sid and not(billing_record_id=any(selected_records));
  insert into public.invoice_billing_records(invoice_id,billing_record_id) select sid,unnest(selected_records) on conflict(invoice_id,billing_record_id) do nothing;
  update public.billing_records set payment_status=case when nullif(p_data->>'paid_at','') is null then 'PENDENTE' else 'PAGO' end,received_amount=null,paid_at=null,invoice_number=null,updated_at=clock_timestamp(),updated_by=p_actor where id=any(selected_records);
  update public.invoice_billing_records ib set received_amount=(p_data->'item_amounts'->>b.attendance_id)::numeric from public.billing_records b where b.id=ib.billing_record_id and ib.invoice_id=sid and (p_data->'item_amounts') ? b.attendance_id;
  old_row:=coalesce(old_row,'{}')||jsonb_build_object('record_ids',old_items,'records',before_records,'items',before_item_values);
  result_row:=result_row||jsonb_build_object('record_ids',to_jsonb(selected_records),'appointment_ids',appointment_ids,'items',(select coalesce(jsonb_agg(to_jsonb(ib)),'[]') from public.invoice_billing_records ib where ib.invoice_id=sid));
 else raise exception 'Operação inválida'; end if;
 insert into public.billing_audit(actor_id,action,record_id,before_data,after_data) values(p_actor,p_kind,sid,old_row,result_row);
 
 return sid;
end;$function$;

CREATE OR REPLACE FUNCTION public.preview_billing_month(p_actor bigint, p_entity uuid, p_month text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
 rn_org_id uuid;
 first_day date;
 last_day date;
 entity_row public.billing_entities%rowtype;
 production jsonb;
 professionals jsonb;
 invoice_summary jsonb;
 invoice_rows jsonb;
 cash_summary jsonb;
 direct_rows jsonb;
 paid_unrealized jsonb;
 expense_summary jsonb;
 expense_rows jsonb;
 denial_summary jsonb;
 denial_rows jsonb;
 pending_summary jsonb;
 professional_attendances jsonb;
 attendance_overview jsonb;
 cancelled_archive jsonb;
 professional_invoice_rows jsonb;
begin
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then
  raise exception 'Somente a gerência consulta o fechamento mensal';
 end if;
 if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
  raise exception 'Competência deve estar no formato AAAA-MM';
 end if;
 first_day:=make_date(substring(p_month,1,4)::integer,substring(p_month,6,2)::integer,1);
 last_day:=(first_day + interval '1 month')::date;
 select * into entity_row from public.billing_entities where id=p_entity and organization_id=rn_org_id;
 if not found then raise exception 'Entidade recebedora não encontrada';end if;

 -- A produção clínica usa a DATA DO ATENDIMENTO, não a data do depósito.
 select jsonb_build_object(
   'attendances',count(distinct a.id),
   'charges',count(b.id),
   'professionals',count(distinct coalesce(b.professional_id,a.doctor_id)),
   'private_charges',count(b.id) filter(where b.billing_method='PARTICULAR'),
   'insurance_charges',count(b.id) filter(where b.billing_method='CONVENIO'),
   'pending_charges_now',count(b.id) filter(where b.payment_status<>'PAGO'),
   'unpriced_charges',count(b.id) filter(where b.received_amount is null and
       not exists(select 1 from public.invoice_billing_records ib
          where ib.billing_record_id=b.id and ib.is_active and ib.received_amount is not null))
 ) into production
 from public.billing_records b
 join public.attendances a on a.id=b.attendance_id
 where b.billing_entity_id=p_entity and a.status='realized'
 and a.date>=first_day and a.date<last_day;

 -- Detalhe informativo por profissional; NÃO é um rateio do caixa.
 select coalesce(jsonb_agg(to_jsonb(t) order by t.professional_name,t.professional_id),'[]'::jsonb)
 into professionals
 from (
  select coalesce(b.professional_id,a.doctor_id) professional_id,
   coalesce(d.name,'Profissional histórico') professional_name,
   count(*) charges,
   count(distinct a.id) attendances,
   count(*) filter(where b.billing_method='PARTICULAR') private_charges,
   count(*) filter(where b.billing_method='CONVENIO') insurance_charges,
   count(*) filter(where b.payment_status<>'PAGO') pending_charges_now,
   coalesce(sum(ibvals.attributed_amount),0) attributed_invoice_items
  from public.billing_records b
  join public.attendances a on a.id=b.attendance_id
  left join public.doctors d on d.id=coalesce(b.professional_id,a.doctor_id)
  left join lateral(
    select sum(ib.received_amount) attributed_amount
    from public.invoice_billing_records ib
    join public.invoices i on i.id=ib.invoice_id
    where ib.billing_record_id=b.id and ib.is_active
      and i.status='ACTIVE' and i.voided_at is null
      and i.recipient_type='CONVENIO'
  ) ibvals on true
  where b.billing_entity_id=p_entity and a.status='realized'
    and a.date>=first_day and a.date<last_day
  group by coalesce(b.professional_id,a.doctor_id),d.name
 ) t;


 -- Atendimentos por profissional para o relatório, agrupáveis por convênio.
 -- Cada cobrança mantém sua própria pessoa, pagador e procedimento.
 select coalesce(jsonb_agg(to_jsonb(t) order by t.professional_name,t.payer_name,t.service_date,t.patient_name,t.billing_record_id),'[]'::jsonb)
 into professional_attendances
 from (
  select b.id billing_record_id,
   coalesce(b.professional_id,a.doctor_id) professional_id,
   coalesce(d.name,'Profissional histórico') professional_name,
   a.id attendance_id, a.date service_date, a.procedure,
   coalesce(nullif(trim(b.effective_payer_name_snapshot),''),
     case when b.billing_method='PARTICULAR' then 'Particular'
       else nullif(trim(a.insurance),'') end,'Não informado') payer_name,
   b.billing_method,b.payment_status,b.no_invoice,b.received_amount,b.paid_at,
   coalesce(nullif(trim(b.patient_insurance_snapshot),''),
    nullif(trim(a.insurance),''),'Convênio não informado') as insurance_name,
   (select sum(ib.received_amount) from public.invoice_billing_records ib
    join public.invoices i on i.id=ib.invoice_id
    where ib.billing_record_id=b.id and ib.is_active
      and i.status='ACTIVE' and i.voided_at is null
   ) as invoice_item_received,
   coalesce(nullif(trim((
     select pat->>'name' from public.app_state s
      cross join lateral jsonb_array_elements(coalesce(s.payload->'patients','[]'::jsonb)) pat
      where s.organization_id=rn_org_id and pat->>'id'=a.patient_id limit 1
   )),'') ,'Paciente histórico') patient_name
  from public.billing_records b
   join public.attendances a on a.id=b.attendance_id
   left join public.doctors d on d.id=coalesce(b.professional_id,a.doctor_id)
  where b.billing_entity_id=p_entity and a.status='realized'
    and a.date>=first_day and a.date<last_day
 ) t;


 -- Uma linha por ATENDIMENTO, não por cobrança: inclui realizados e cancelados,
 -- inclusive cancelamentos sem cobrança. A competência é a data prevista do atendimento.
 -- A entidade é determinada por vínculo persistido, nunca por empresa atual do médico.
 select coalesce(jsonb_agg(to_jsonb(t) order by t.service_date,t.professional_name,t.patient_name,t.attendance_id),'[]'::jsonb)
 into attendance_overview
 from (
  select a.id attendance_id,a.date service_date,a.status,
   a.procedure,a.cancelled_at,a.cancellation_reason,
   coalesce(d.name,'Médico histórico') professional_name,
   coalesce(nullif(trim(a.billing_method),''),
     (select b.billing_method from public.billing_records b
      where b.attendance_id=a.id and b.billing_entity_id=p_entity
      order by b.created_at nulls last,b.id limit 1),'CONVENIO') billing_method,
   coalesce(nullif(trim(a.insurance),''),'Convênio não informado') insurance_name,
   coalesce(nullif(trim((
     select pat->>'name' from public.app_state s
      cross join lateral jsonb_array_elements(coalesce(s.payload->'patients','[]'::jsonb)) pat
      where s.organization_id=rn_org_id and pat->>'id'=a.patient_id limit 1
   )),''),'Paciente histórico') patient_name
  from public.attendances a
  left join public.doctors d on d.id=a.doctor_id
  where a.date>=first_day and a.date<last_day
   and a.status in ('realized','cancelled')
   and (a.billing_entity_id=p_entity or exists(
     select 1 from public.billing_records b
     where b.attendance_id=a.id and b.billing_entity_id=p_entity))
 ) t;
 -- Arquivo clínico da Agenda: cancelamentos podem não ter registro financeiro
 -- ou ter um registro com status agendado. O arquivo clínico prevalece.
 -- Sem criar cobranças; entidade do atendimento ou vínculo único do médico.
 select coalesce(jsonb_agg(to_jsonb(t) order by t.service_date,t.attendance_id),'[]'::jsonb)
 into cancelled_archive
 from (
  select coalesce((
    select a.id from public.attendances a
    where a.appointment_id=c.item->>'id'
      and (a.billing_entity_id=p_entity or exists (
       select 1 from public.billing_records b
       where b.attendance_id=a.id and b.billing_entity_id=p_entity))
    order by a.id limit 1
   ),'cancelled:'||(c.item->>'id')) attendance_id,
   ((c.item->>'date'))::date service_date,
   'cancelled'::text status,
   coalesce(c.item->>'procedure','—') procedure,
   (c.item->>'cancelledAt')::timestamptz cancelled_at,
   c.item->>'cancelReason' cancellation_reason,
   coalesce(d.name,'Médico histórico') professional_name,
   coalesce(nullif(trim(c.item->>'forma_cobranca'),''),
    (select b.billing_method from public.billing_records b
     join public.attendances a on a.id=b.attendance_id
     where a.appointment_id=c.item->>'id' and b.billing_entity_id=p_entity
     order by b.created_at nulls last,b.id limit 1),'CONVENIO') billing_method,
   coalesce(nullif(trim(c.item->>'insurance'),''),'Convênio não informado') insurance_name,
   coalesce(nullif(trim((
    select pat->>'name' from jsonb_array_elements(coalesce(s.payload->'patients','[]'::jsonb)) pat
    where pat->>'id'=c.item->>'patientId' limit 1
   )),''),'Paciente histórico') patient_name
  from public.app_state s
  cross join lateral jsonb_array_elements(coalesce(s.payload->'cancelledAppointments','[]'::jsonb)) c(item)
  left join public.doctors d on d.id=c.item->>'doctorId'
  where s.organization_id=rn_org_id and c.item->>'id' is not null
    and (c.item->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and (c.item->>'date')>=to_char(first_day,'YYYY-MM-DD')
    and (c.item->>'date')<to_char(last_day,'YYYY-MM-DD')
    and (
     exists (
      select 1 from public.attendances a where a.appointment_id=c.item->>'id'
       and (a.billing_entity_id=p_entity or exists (
        select 1 from public.billing_records b
        where b.attendance_id=a.id and b.billing_entity_id=p_entity))
     ) or (
      not exists(select 1 from public.attendances a where a.appointment_id=c.item->>'id')
      and p_entity=(
       select case when count(distinct l.billing_entity_id)=1
         then max(l.billing_entity_id::text)::uuid else null end
       from public.billing_doctor_entities l where l.doctor_id=c.item->>'doctorId'
      )
     )
    )
 ) t;
 -- Substituir status defasado do financeiro, sem duplicar o mesmo atendimento.
 select coalesce(jsonb_agg(entries.item),'[]'::jsonb) into attendance_overview
 from (
  select x.item from jsonb_array_elements(attendance_overview) x(item)
   where not exists (
    select 1 from jsonb_array_elements(cancelled_archive) archived(item)
    where archived.item->>'attendance_id'=x.item->>'attendance_id'
   )
  union all
  select archived.item from jsonb_array_elements(cancelled_archive) archived(item)
 ) entries;
 production:=production || jsonb_build_object(
  'cancelled_attendances',
  (select count(*) from jsonb_array_elements(attendance_overview) entry
   where entry->>'status'='cancelled')
 );

 -- Uma NF pode pertencer a vários profissionais. Lista-se o documento por
 -- vínculo histórico de item/solicitação, SEM ratear ou somar seus totais.
 -- Itens inativos continuam permitindo identificar NFs substituídas.
 select coalesce(jsonb_agg(to_jsonb(t) order by t.professional_name,t.invoice_number,t.invoice_id),'[]'::jsonb)
 into professional_invoice_rows from (
  select distinct on (linked.professional_id,linked.invoice_id)
    linked.professional_id,coalesce(d.name,'Profissional histórico') professional_name,
    linked.invoice_id, inv.invoice_number,
    (select coalesce(jsonb_agg(distinct coalesce(nullif(trim((
      select pat->>'name' from public.app_state s
      cross join lateral jsonb_array_elements(coalesce(s.payload->'patients','[]'::jsonb)) pat
      where s.organization_id=rn_org_id and pat->>'id'=act.patient_id limit 1
    )),''),'Paciente histórico')),'[]'::jsonb)
    from public.invoice_billing_records item
    join public.billing_records bill on bill.id=item.billing_record_id
    join public.attendances act on act.id=bill.attendance_id
    where item.invoice_id=linked.invoice_id and item.is_active
      and coalesce(bill.professional_id,act.doctor_id)=linked.professional_id
    ) patient_names,
    (select coalesce(jsonb_agg(distinct bill.id::text),'[]'::jsonb)
    from public.invoice_billing_records item
    join public.billing_records bill on bill.id=item.billing_record_id
    join public.attendances act on act.id=bill.attendance_id
    where item.invoice_id=linked.invoice_id and item.is_active
      and coalesce(bill.professional_id,act.doctor_id)=linked.professional_id
    ) billing_record_ids,
    (select sum(items.received_amount)
      from public.invoice_billing_records items
      join public.billing_records bill on bill.id=items.billing_record_id
      join public.attendances act on act.id=bill.attendance_id
      where items.invoice_id=linked.invoice_id and items.is_active
        and coalesce(bill.professional_id,act.doctor_id)=linked.professional_id
    ) as attributed_amount
  from (
   select coalesce(b.professional_id,a.doctor_id) professional_id,ib.invoice_id
   from public.invoice_billing_records ib
    join public.billing_records b on b.id=ib.billing_record_id
    join public.attendances a on a.id=b.attendance_id
   where b.billing_entity_id=p_entity
   union
   select coalesce(b.professional_id,r.doctor_id) professional_id,r.invoice_id
   from public.invoice_requests r
    left join public.billing_records b on b.id=r.billing_record_id
   where r.invoice_id is not null and r.billing_entity_id=p_entity
  ) linked
  join public.invoices inv on inv.id=linked.invoice_id and inv.billing_entity_id=p_entity
  left join public.doctors d on d.id=linked.professional_id
  where linked.professional_id is not null
    and (inv.issue_date>=first_day and inv.issue_date<last_day
      or inv.paid_at>=first_day and inv.paid_at<last_day
      or inv.cancelled_at::date>=first_day and inv.cancelled_at::date<last_day
      or inv.voided_at::date>=first_day and inv.voided_at::date<last_day)
  order by linked.professional_id,linked.invoice_id
 ) t;

 -- NF emitida na competência: um registro por NF, nunca por item.
 select jsonb_build_object(
   'count',count(*),
   'gross_total',coalesce(sum(i.total_amount),0),
   'net_total',coalesce(sum(i.net_amount),0),
   'without_net_amount',count(*) filter(where i.net_amount is null),
   'insurance_count',count(*) filter(where i.recipient_type='CONVENIO'),
   'private_count',count(*) filter(where i.recipient_type='PARTICULAR')
 ) into invoice_summary
 from public.invoices i
 where i.billing_entity_id=p_entity and i.status='ACTIVE' and i.voided_at is null
 and i.issue_date>=first_day and i.issue_date<last_day;

 select coalesce(jsonb_agg(to_jsonb(t) order by
   case when t.invoice_number ~ '^[0-9]+$' and length(t.invoice_number)<=18
     then t.invoice_number::bigint end nulls last,
   t.invoice_number,t.issue_date,t.id),'[]'::jsonb)
 into invoice_rows from(
   select i.id,i.invoice_number,i.payer,i.issue_date,i.paid_at,
          i.recipient_type,i.total_amount,i.net_amount,i.status,
          i.voided_at,i.cancelled_at,i.replaced_by_invoice_id,
          (select replacement.invoice_number
             from public.invoices replacement
             where replacement.id=i.replaced_by_invoice_id
               and replacement.billing_entity_id=i.billing_entity_id
          ) as replacement_invoice_number
   from public.invoices i
   where i.billing_entity_id=p_entity
     and (i.issue_date>=first_day and i.issue_date<last_day
          or i.paid_at>=first_day and i.paid_at<last_day
          or i.cancelled_at::date>=first_day and i.cancelled_at::date<last_day
          or i.voided_at::date>=first_day and i.voided_at::date<last_day)
 ) t;

 -- Fluxo de caixa: pagamentos diretos + NF CONVÊNIO recebida,
 -- sem contar a NF PARTICULAR outra vez (já foi pagamento direto).
 select jsonb_build_object(
  'direct_received',coalesce((select sum(b.received_amount)
    from public.billing_records b join public.attendances a on a.id=b.attendance_id
    where b.billing_entity_id=p_entity and a.status<>'cancelled'
      and b.settlement_mode='DIRECT' and b.payment_status='PAGO'
      and b.paid_at>=first_day and b.paid_at<last_day),0),
  'insurance_invoice_received',coalesce((select sum(i.net_amount)
    from public.invoices i where i.billing_entity_id=p_entity
      and i.status='ACTIVE' and i.voided_at is null and i.recipient_type='CONVENIO'
      and i.paid_at>=first_day and i.paid_at<last_day),0),
  'insurance_paid_invoices_without_net',(
    select count(*) from public.invoices i where i.billing_entity_id=p_entity
      and i.status='ACTIVE' and i.voided_at is null and i.recipient_type='CONVENIO'
      and i.paid_at>=first_day and i.paid_at<last_day and i.net_amount is null)
 ) into cash_summary;

 select coalesce(jsonb_agg(to_jsonb(t) order by t.paid_at,t.id),'[]'::jsonb)
 into direct_rows from (
   select b.id,b.attendance_id,coalesce(b.professional_id,a.doctor_id) professional_id,coalesce(d.name,'Profissional histórico') professional_name,
       b.paid_at,b.received_amount,b.billing_method,
       coalesce(nullif(trim((
        select pat->>'name' from public.app_state s
        cross join lateral jsonb_array_elements(coalesce(s.payload->'patients','[]'::jsonb)) pat
        where s.organization_id=rn_org_id and pat->>'id'=a.patient_id limit 1
       )),''),'Paciente histórico') patient_name
   from public.billing_records b
   join public.attendances a on a.id=b.attendance_id
   left join public.doctors d on d.id=coalesce(b.professional_id,a.doctor_id)
   where b.billing_entity_id=p_entity and a.status<>'cancelled'
     and b.settlement_mode='DIRECT' and b.payment_status='PAGO'
     and b.paid_at>=first_day and b.paid_at<last_day
 ) t;


 -- Pagamentos diretos de atendimentos AINDA NÃO marcados como realizados:
 -- pertencem ao caixa, mas não entram na produção. Controle separado e auditável.
 select coalesce(jsonb_agg(to_jsonb(t) order by t.service_date,t.paid_at,t.billing_record_id),'[]'::jsonb)
 into paid_unrealized
 from (
  select b.id billing_record_id,a.id attendance_id,a.date service_date,
   a.status clinical_status,a.procedure,
   coalesce(d.name,'Médico histórico') professional_name,
   coalesce(nullif(trim((
    select p->>'name' from public.app_state s
    cross join lateral jsonb_array_elements(coalesce(s.payload->'patients','[]'::jsonb)) p
    where s.organization_id=rn_org_id and p->>'id'=a.patient_id limit 1
   )),''),'Paciente histórico') patient_name,
   b.billing_method,b.received_amount,b.paid_at,
   coalesce(nullif(trim(a.insurance),''),'Convênio não informado') insurance_name
  from public.billing_records b
  join public.attendances a on a.id=b.attendance_id
  left join public.doctors d on d.id=coalesce(b.professional_id,a.doctor_id)
  where b.billing_entity_id=p_entity
   and a.status not in ('realized','cancelled')
   and b.settlement_mode='DIRECT' and b.payment_status='PAGO'
   and a.date>=first_day and a.date<last_day
 ) t;

 -- Despesas por COMPETÊNCIA e desembolso por DATA DE PAGAMENTO.
 select jsonb_build_object(
   'competence_total',coalesce((select sum(e.amount) from public.company_expenses e
      where e.billing_entity_id=p_entity and e.competence_date>=first_day
       and e.competence_date<last_day),0),
   'paid_total',coalesce((select sum(e.amount) from public.company_expenses e
      where e.billing_entity_id=p_entity and e.status='PAGO'
       and e.paid_at>=first_day and e.paid_at<last_day),0)
 ) into expense_summary;

 select coalesce(jsonb_agg(to_jsonb(t) order by t.competence_date,t.id),'[]'::jsonb)
 into expense_rows from (
   select e.id,e.description,e.category,e.competence_date,e.paid_at,
          e.amount,e.status,e.supplier
   from public.company_expenses e
   where e.billing_entity_id=p_entity and
     (e.competence_date>=first_day and e.competence_date<last_day
      or e.status='PAGO' and e.paid_at>=first_day and e.paid_at<last_day)
 ) t;

 -- Glosa independe do caixa; recuperação não vira segundo depósito.
 select jsonb_build_object(
   'denied_in_month',coalesce((select sum(c.denied_amount)
      from public.billing_denial_cases c
      where c.billing_entity_id=p_entity and c.denied_on>=first_day and c.denied_on<last_day),0),
   'recovered_in_month',coalesce((select sum(r.amount)
      from public.billing_denial_recoveries r
      join public.billing_denial_cases c on c.id=r.denial_id
      where c.billing_entity_id=p_entity and r.recovered_on>=first_day and r.recovered_on<last_day),0),
   'loss_on_cases_opened_in_month_now',coalesce((select sum(c.denied_amount-c.recovered_amount)
      from public.billing_denial_cases c
      where c.billing_entity_id=p_entity and c.status='CLOSED'
      and c.denied_on>=first_day and c.denied_on<last_day),0)
 ) into denial_summary;

 select coalesce(jsonb_agg(to_jsonb(t) order by t.denied_on,t.id),'[]'::jsonb)
 into denial_rows from (
   select c.id,c.billing_record_id,c.denial_kind,c.denied_on,c.denied_amount,
       c.recovered_amount,c.status,c.reason
   from public.billing_denial_cases c
   where c.billing_entity_id=p_entity and c.denied_on>=first_day and c.denied_on<last_day
 ) t;

 select jsonb_build_object(
   'unpaid_invoice_count',count(*),
   'unpaid_invoice_net',coalesce(sum(i.net_amount),0),
   'unpaid_invoice_unknown_net',count(*) filter(where i.net_amount is null)
 ) into pending_summary
 from public.invoices i
 where i.billing_entity_id=p_entity and i.status='ACTIVE' and i.voided_at is null
   and i.recipient_type='CONVENIO'
   and i.issue_date>=first_day and i.issue_date<last_day and i.paid_at is null;

 return jsonb_build_object(
   'entity',jsonb_build_object('id',entity_row.id,'name',entity_row.name,
      'trade_name',entity_row.trade_name,'tax_id',entity_row.tax_id,'person_type',entity_row.person_type),
   'competence',p_month,
   'period_start',first_day,'period_end_exclusive',last_day,
   'production',production,
   'professionals',professionals,
   'professional_attendances',professional_attendances,
   'attendance_overview',attendance_overview,
   'professional_invoice_rows',professional_invoice_rows,
   'issued_invoices',invoice_summary,'invoices',invoice_rows,
   'cash',cash_summary,'direct_payments',direct_rows,
    'paid_unrealized',paid_unrealized,
   'expenses',expense_summary,'expense_items',expense_rows,
   'denials',denial_summary,'denial_items',denial_rows,
   'pending_now',pending_summary,
   'notices',jsonb_build_array(
      'Produção é apurada por atendimento realizado na competência.',
      'Notas emitidas usam a data de emissão; recebimentos e despesas pagas usam data de pagamento.',
      'A NF de convênio é contabilizada uma única vez, independentemente da quantidade de profissionais ou pacientes.',
      'NF particular não é somada ao caixa novamente quando existe pagamento direto.',
      'Pendências e perdas de glosa no relatório refletem a situação atual no momento da consulta ou do fechamento.',
      'Recuperação de glosa é indicador operacional, não segunda entrada de caixa.',
      'Valores não identificados são destacados e não estimados.')
 );
end;
$function$;

REVOKE ALL ON FUNCTION public.save_professional_charge(bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_professional_charge(bigint,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.save_professional_charge_core(bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_professional_charge_core(bigint,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.save_billing_legacy_single_charge(bigint,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_billing_legacy_single_charge(bigint,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.save_billing_fiscal_core(bigint,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_billing_fiscal_core(bigint,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.preview_billing_month(bigint,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_billing_month(bigint,uuid,text) TO service_role;

COMMIT;
