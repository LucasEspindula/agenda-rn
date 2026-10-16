-- RN Integra — Preflight SOMENTE LEITURA para o banco ATUAL.
-- Não cria, altera nem remove objetos. Não executa migrations.
-- Não retorna nomes de pacientes, CPF, valores recebidos ou documentos.
-- Rodar apenas para verificar compatibilidade do esquema antes da homologação.

select version as migration_ja_aplicada
from supabase_migrations.schema_migrations
where version in (
  '20261016120000','20261016183000','20261016203000',
  '20261016220000','20261016230000'
)
order by version;

select
  t.relname as tabela,
  coalesce(bool_or(g.tgname='financial_stamp'),false) as tem_carimbo_financeiro,
  coalesce(bool_or(g.tgname='financial_log_change'),false) as tem_log_financeiro,
  coalesce(bool_or(g.tgname='fiscal_payment_integrity'),false) as tem_integridade_fiscal
from pg_class t
join pg_namespace n on n.oid=t.relnamespace
left join pg_trigger g on g.tgrelid=t.oid and not g.tgisinternal
where n.nspname='public' and t.relname in ('billing_records','invoices','invoice_requests')
group by t.relname
order by t.relname;

select
  'atendimentos' as indicador,count(*)::bigint as total from public.attendances
union all select 'cobrancas',count(*) from public.billing_records
union all select 'NFs',count(*) from public.invoices
union all select 'itens_de_NF',count(*) from public.invoice_billing_records
union all select 'solicitacoes_fiscais',count(*) from public.invoice_requests
union all select 'despesas',count(*) from public.company_expenses
union all select 'cobrancas_sem_atendimento',count(*)
  from public.billing_records b
  left join public.attendances a on a.id=b.attendance_id where a.id is null
union all select 'cobrancas_sem_entidade',count(*)
  from public.billing_records b
  left join public.billing_entities e on e.id=b.billing_entity_id where e.id is null
union all select 'particulares_pagos_sem_data',count(*)
  from public.billing_records
  where billing_method='PARTICULAR' and payment_status='PAGO' and paid_at is null
union all select 'NFs_convenio_ativas_sem_liquido',count(*)
  from public.invoices
  where recipient_type='CONVENIO' and status='ACTIVE' and net_amount is null
union all select 'NF_itens_sem_referencia',count(*)
  from public.invoice_billing_records ib
  left join public.invoices i on i.id=ib.invoice_id
  left join public.billing_records b on b.id=ib.billing_record_id
  where i.id is null or b.id is null
order by indicador;

select c.conname,c.contype,pg_get_constraintdef(c.oid) as definicao
from pg_constraint c
where c.conrelid='public.billing_records'::regclass
  and c.conname in ('billing_attendance_unique','billing_records_appointment_id_key')
order by c.conname;

select indexname,indexdef from pg_indexes
where schemaname='public' and tablename='invoice_requests'
  and indexname in ('invoice_requests_active_attendance','invoice_requests_active_record')
order by indexname;
