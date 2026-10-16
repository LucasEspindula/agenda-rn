-- RN Integra / Etapa 4 — fechamento mensal histórico por ENTIDADE recebedora.
-- Depende das migrations de faturamento profissional e glosas (Etapas 1–3).
-- A aplicação desta migration requer homologação. Nunca rodar automaticamente.

create table public.billing_monthly_closings (
  id uuid primary key default gen_random_uuid(),
  billing_entity_id uuid not null references public.billing_entities(id),
  competence_month date not null,
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  snapshot_checksum text not null,
  notes text,
  closed_at timestamptz not null default clock_timestamp(),
  closed_by bigint not null references public.users(id),
  unique(billing_entity_id,competence_month),
  check(extract(day from competence_month)=1),
  check(length(coalesce(notes,''))<=2000)
);
create index billing_monthly_closings_entity_month_idx
  on public.billing_monthly_closings(billing_entity_id,competence_month desc);

-- A fonte da verdade de pagamentos permanece nas cobranças/NFs.
-- A função de preview usa agregações independentes para nunca multiplicar
-- uma NF por sua quantidade de pacientes ou de profissionais.
create or replace function public.preview_billing_month(p_actor bigint,p_entity uuid,p_month text)
returns jsonb language plpgsql stable set search_path to ''
as $$
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

 select coalesce(jsonb_agg(to_jsonb(t) order by t.issue_date,t.invoice_number,t.id),'[]'::jsonb)
 into invoice_rows from(
   select i.id,i.invoice_number,i.payer,i.issue_date,i.paid_at,
          i.recipient_type,i.total_amount,i.net_amount
   from public.invoices i
   where i.billing_entity_id=p_entity and i.status='ACTIVE' and i.voided_at is null
     and (i.issue_date>=first_day and i.issue_date<last_day
          or i.paid_at>=first_day and i.paid_at<last_day)
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
$$;

create or replace function public.get_billing_month_closing(p_actor bigint,p_entity uuid,p_month text)
returns jsonb language plpgsql stable set search_path to ''
as $$
declare snap jsonb; past public.billing_monthly_closings%rowtype;
begin
 snap:=public.preview_billing_month(p_actor,p_entity,p_month);
 select * into past from public.billing_monthly_closings
   where billing_entity_id=p_entity and competence_month=(p_month||'-01')::date;
 return jsonb_build_object(
   'current',snap,
   'closed',past.id is not null,
   'closing',case when past.id is null then null else jsonb_build_object(
      'id',past.id,'snapshot',past.snapshot,'closed_at',past.closed_at,
      'closed_by',past.closed_by,'notes',past.notes,
      'changed_since_close',md5(snap::text)<>past.snapshot_checksum) end
 );
end;
$$;

create or replace function public.close_billing_month(p_actor bigint,p_entity uuid,p_month text,p_notes text default null)
returns uuid language plpgsql set search_path to ''
as $$
declare first_day date; snapshot_data jsonb; saved_id uuid;
begin
 if not exists(select 1 from public.users where id=p_actor and role='general_manager')
   then raise exception 'Somente a gerência pode fechar uma competência';end if;
 if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
   raise exception 'Competência inválida';end if;
 first_day:=(p_month||'-01')::date;
 if first_day>=date_trunc('month',timezone('America/Sao_Paulo',now()))::date
   then raise exception 'A competência atual ou futura não pode ser encerrada';end if;
 if length(coalesce(p_notes,''))>2000 then raise exception 'Observação muito longa';end if;

 -- Não permitir dois fechamentos concorrentes da mesma PJ/PF e competência.
 perform pg_advisory_xact_lock(hashtext(p_entity::text||p_month)::bigint);
 if exists(select 1 from public.billing_monthly_closings
      where billing_entity_id=p_entity and competence_month=first_day) then
   raise exception 'Competência já encerrada: o histórico não pode ser substituído';end if;

 snapshot_data:=public.preview_billing_month(p_actor,p_entity,p_month);
 if coalesce((snapshot_data->'cash'->>'insurance_paid_invoices_without_net')::integer,0)>0
    or coalesce((snapshot_data->'issued_invoices'->>'without_net_amount')::integer,0)>0 then
  raise exception 'Existem NFs sem valor líquido identificado. Revise antes de fechar';
 end if;

 insert into public.billing_monthly_closings(
    billing_entity_id,competence_month,snapshot,snapshot_checksum,notes,closed_by)
 values(p_entity,first_day,snapshot_data,md5(snapshot_data::text),
      nullif(trim(p_notes),''),p_actor)
 returning id into saved_id;
 return saved_id;
end;
$$;

-- NUNCA alterar ou apagar um fechamento histórico em operações normais.
create or replace function public.guard_billing_monthly_closing_immutable()
returns trigger language plpgsql set search_path to ''
as $$
begin
 raise exception 'Fechamento mensal é imutável. Correções precisam de processo de retificação auditável';
end;
$$;
create trigger billing_monthly_closings_immutable
 before update or delete on public.billing_monthly_closings
 for each row execute function public.guard_billing_monthly_closing_immutable();

alter table public.billing_monthly_closings enable row level security;
revoke all on table public.billing_monthly_closings from public,anon,authenticated;
grant select,insert on public.billing_monthly_closings to service_role;

revoke all on function public.preview_billing_month(bigint,uuid,text),
  public.get_billing_month_closing(bigint,uuid,text),
  public.close_billing_month(bigint,uuid,text,text) from public,anon,authenticated;
grant execute on function public.preview_billing_month(bigint,uuid,text),
  public.get_billing_month_closing(bigint,uuid,text),
  public.close_billing_month(bigint,uuid,text,text) to service_role;
