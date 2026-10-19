-- Particular recebido "Sem Nota Fiscal" (S/N). Não emite documento nem cria solicitação.
-- A decisão fica registrada na cobrança e mantém o recebimento financeiro intacto.
alter table public.billing_records add column if not exists no_invoice boolean not null default false;
CREATE OR REPLACE FUNCTION public.finish_private_payment(p_actor bigint, p_id uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.billing_records%rowtype;a public.attendances%rowtype;f jsonb:=p_data->'fiscal';patient jsonb;cpf text;
begin
 select * into b from public.billing_records where id=p_id;
 if b.payment_status='PENDENTE' then
  update public.billing_records set no_invoice=false where id=p_id and no_invoice; update public.invoice_requests set status='CANCELLED' where billing_record_id=p_id and status='PENDING';return;end if;
 if b.billing_method<>'PARTICULAR' then return;end if;
 if coalesce((p_data->>'no_invoice')::boolean,false) then
  if exists(select 1 from public.invoice_requests
    where billing_record_id=p_id and status in ('PENDING','ISSUED')) then
    raise exception 'Solicitação de NF existente. Regularize antes de selecionar Sem Nota Fiscal';
  end if;
  if nullif(trim(b.invoice_number),'') is not null then
    raise exception 'Existe NF registrada: Sem Nota Fiscal não é permitido';
  end if;
  update public.billing_records set no_invoice=true where id=p_id and not no_invoice;
  return;
 end if;
 update public.billing_records set no_invoice=false where id=p_id and no_invoice;
 if nullif(trim(b.invoice_number),'') is not null then raise exception 'NF particular legada: preserve o documento e solicite regularização fiscal à gerência';end if;
 if f is null or coalesce(f->>'taker_kind','') not in ('PATIENT','OTHER') or nullif(trim(f->>'taker_name'),'') is null or not public.valid_cpf(f->>'taker_tax_id') then raise exception 'Confirme o pagamento e solicite NF com nome e CPF válido do tomador';end if;
 cpf:=regexp_replace(f->>'taker_tax_id','[^0-9]','','g');select * into a from public.attendances where id=b.attendance_id;
 select p into patient from public.app_state s cross join lateral jsonb_array_elements(s.payload->'patients') p where s.id=1 and p->>'id'=a.patient_id;
 if patient is null or nullif(trim(patient->>'name'),'') is null then raise exception 'Paciente não encontrado para confirmação fiscal';end if;
 if f->>'taker_kind'='PATIENT' and nullif(patient->>'cpf','') is not null and regexp_replace(patient->>'cpf','[^0-9]','','g')<>cpf then raise exception 'CPF diferente do cadastro. Corrija o paciente ou selecione Outra pessoa';end if;
 if f->>'taker_kind'='PATIENT' then
  f:=jsonb_set(f,'{taker_name}',to_jsonb(patient->>'name'));
  update public.app_state set payload=jsonb_set(payload,'{patients}',(select jsonb_agg(case when p->>'id'=a.patient_id then p||jsonb_build_object('cpf',cpf)||case when nullif(trim(f->>'taker_address'),'') is not null then jsonb_build_object('address',trim(f->>'taker_address')) else '{}'::jsonb end else p end order by n) from jsonb_array_elements(payload->'patients') with ordinality x(p,n))),updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond') where id=1;
 end if;
 insert into public.invoice_requests(attendance_id,billing_record_id,billing_entity_id,taker_kind,taker_name,taker_tax_id,taker_address,notes,received_amount_snapshot,paid_at_snapshot,patient_id,patient_name_snapshot,doctor_id,doctor_name_snapshot,attendance_date_snapshot,procedure_snapshot,entity_name_snapshot,entity_tax_id_snapshot)
 select a.id,b.id,b.billing_entity_id,f->>'taker_kind',trim(f->>'taker_name'),cpf,nullif(trim(f->>'taker_address'),''),nullif(trim(f->>'notes'),''),b.received_amount,b.paid_at,a.patient_id,patient->>'name',a.doctor_id,d.name,a.date,a.procedure,e.name,e.tax_id from public.billing_entities e cross join public.doctors d where e.id=b.billing_entity_id and d.id=a.doctor_id;
end;$function$;

CREATE OR REPLACE FUNCTION public.save_professional_charge(p_actor bigint, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  select * into saved from public.billing_records where id=charge_id;

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
$function$;

CREATE OR REPLACE FUNCTION public.preview_billing_month(p_actor bigint, p_entity uuid, p_month text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
 first_day date;
 last_day date;
 entity_row public.billing_entities%rowtype;
 production jsonb;
 professionals jsonb;
 invoice_summary jsonb;
 invoice_rows jsonb;
 cash_summary jsonb;
 direct_rows jsonb;
 expense_summary jsonb;
 expense_rows jsonb;
 denial_summary jsonb;
 denial_rows jsonb;
 pending_summary jsonb;
 professional_attendances jsonb;
 professional_invoice_rows jsonb;
begin
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then
  raise exception 'Somente a gerência consulta o fechamento mensal';
 end if;
 if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
  raise exception 'Competência deve estar no formato AAAA-MM';
 end if;
 first_day:=make_date(substring(p_month,1,4)::integer,substring(p_month,6,2)::integer,1);
 last_day:=(first_day + interval '1 month')::date;
 select * into entity_row from public.billing_entities where id=p_entity;
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
   coalesce(nullif(trim((
     select pat->>'name' from public.app_state s
      cross join lateral jsonb_array_elements(coalesce(s.payload->'patients','[]'::jsonb)) pat
      where s.id=1 and pat->>'id'=a.patient_id limit 1
   )),'') ,'Paciente histórico') patient_name
  from public.billing_records b
   join public.attendances a on a.id=b.attendance_id
   left join public.doctors d on d.id=coalesce(b.professional_id,a.doctor_id)
  where b.billing_entity_id=p_entity and a.status='realized'
    and a.date>=first_day and a.date<last_day
 ) t;

 -- Uma NF pode pertencer a vários profissionais. Lista-se o documento por
 -- vínculo histórico de item/solicitação, SEM ratear ou somar seus totais.
 -- Itens inativos continuam permitindo identificar NFs substituídas.
 select coalesce(jsonb_agg(to_jsonb(t) order by t.professional_name,t.invoice_number,t.invoice_id),'[]'::jsonb)
 into professional_invoice_rows from (
  select distinct on (linked.professional_id,linked.invoice_id)
    linked.professional_id,coalesce(d.name,'Profissional histórico') professional_name,
    linked.invoice_id, inv.invoice_number,
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
    where b.billing_entity_id=p_entity and a.status='realized'
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
   select b.id,b.attendance_id,b.professional_id,coalesce(d.name,'Profissional histórico') professional_name,
       b.paid_at,b.received_amount,b.billing_method
   from public.billing_records b
   join public.attendances a on a.id=b.attendance_id
   left join public.doctors d on d.id=coalesce(b.professional_id,a.doctor_id)
   where b.billing_entity_id=p_entity and a.status='realized'
     and b.settlement_mode='DIRECT' and b.payment_status='PAGO'
     and b.paid_at>=first_day and b.paid_at<last_day
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
   'professional_invoice_rows',professional_invoice_rows,
   'issued_invoices',invoice_summary,'invoices',invoice_rows,
   'cash',cash_summary,'direct_payments',direct_rows,
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

