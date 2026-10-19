-- Histórico de atendimentos realizados e cancelados no snapshot mensal.
-- Fechamentos anteriores permanecem intocados.
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
 attendance_overview jsonb;
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
      where s.id=1 and pat->>'id'=a.patient_id limit 1
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
      where s.id=1 and pat->>'id'=a.patient_id limit 1
   )),''),'Paciente histórico') patient_name
  from public.attendances a
  left join public.doctors d on d.id=a.doctor_id
  where a.date>=first_day and a.date<last_day
   and a.status in ('realized','cancelled')
   and (a.billing_entity_id=p_entity or exists(
     select 1 from public.billing_records b
     where b.attendance_id=a.id and b.billing_entity_id=p_entity))
 ) t;
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
   'attendance_overview',attendance_overview,
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
$function$
;

