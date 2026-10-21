-- Indicadores financeiros por entidade recebedora, sem snapshots ou valores duplicados.
-- O cálculo usa apenas o caixa efetivamente pago: cobrança individual PARTICULAR
-- ou NF de convênio paga e ativa. NF particular não entra duas vezes.
create or replace function public.billing_entity_receipts_analytics(p_entity uuid)
returns table (
 payment_year integer,
 payment_month integer,
 source text,
 amount numeric,
 operations bigint
)
language sql stable security invoker set search_path=''
as $function$
 with direct_payments as (
  select extract(year from b.paid_at)::integer payment_year,
         extract(month from b.paid_at)::integer payment_month,
         case when nullif(trim(b.invoice_number),'') is not null
           or exists (
            select 1 from public.invoice_billing_records item
            join public.invoices inv on inv.id=item.invoice_id
            where item.billing_record_id=b.id
             and item.is_active and inv.status='ACTIVE'
             and inv.voided_at is null and inv.recipient_type='PARTICULAR'
           )
           then 'Particular - Com NF' else 'Particular - Sem NF' end as source,
         b.received_amount::numeric amount
  from public.billing_records b
  where b.billing_entity_id=p_entity
   and b.settlement_mode='DIRECT'
   and b.billing_method='PARTICULAR'
   and b.payment_status='PAGO'
   and b.paid_at is not null
   and b.received_amount is not null
   and b.received_amount>=0
 ), insurance_payments as (
  select extract(year from i.paid_at)::integer payment_year,
         extract(month from i.paid_at)::integer payment_month,
         coalesce(nullif(upper(trim(i.payer)),''),'CONVÊNIO NÃO INFORMADO') as source,
         i.net_amount::numeric as amount
  from public.invoices i
  where i.billing_entity_id=p_entity
   and i.recipient_type='CONVENIO'
   and i.status='ACTIVE' and i.voided_at is null
   and i.paid_at is not null and i.net_amount is not null
   and i.net_amount>=0
 ), receipts as (
  select * from direct_payments
  union all
  select * from insurance_payments
 )
 select r.payment_year,r.payment_month,r.source,
        round(sum(r.amount),2) as amount,
        count(*)::bigint as operations
 from receipts r
 group by r.payment_year,r.payment_month,r.source
 order by r.payment_year,r.payment_month,r.source;
$function$;

revoke all on function public.billing_entity_receipts_analytics(uuid) from public,anon,authenticated;
grant execute on function public.billing_entity_receipts_analytics(uuid) to service_role;
