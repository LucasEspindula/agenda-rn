-- Preparação para lançamento: uma cobrança financeira pode pertencer a cada
-- profissional de um mesmo atendimento clínico. A agenda continua sendo a
-- origem clínica e os registros fiscais existentes continuam apontando para
-- billing_records pelos mesmos IDs.

create table if not exists public.billing_commercial_modalities (
  code text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code ~ '^[A-Z][A-Z0-9_]{1,47}$')
);

create table if not exists public.billing_submission_channels (
  code text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code ~ '^[A-Z][A-Z0-9_]{1,47}$')
);

create table if not exists public.billing_counterparties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('PAYER','COOPERATIVE','OTHER')),
  tax_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by bigint references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by bigint references public.users(id),
  check (length(trim(name)) > 0)
);

-- A regra é configurável por profissional, pagador e vigência. Ela não é
-- aplicada automaticamente nesta etapa: serve de base auditável para o
-- próximo incremento, sem reclassificar histórico.
create table if not exists public.billing_professional_commercial_rules (
  id uuid primary key default gen_random_uuid(),
  professional_id text not null references public.doctors(id),
  patient_insurance_key text,
  billing_entity_id uuid references public.billing_entities(id),
  commercial_modality_code text references public.billing_commercial_modalities(code),
  submission_channel_code text references public.billing_submission_channels(code),
  effective_payer_id uuid references public.billing_counterparties(id),
  valid_from date not null,
  valid_to date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by bigint references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by bigint references public.users(id),
  check (valid_to is null or valid_to >= valid_from)
);

insert into public.billing_commercial_modalities(code,name) values
  ('PARTICULAR','Particular'),
  ('COOPERADA','Cooperada'),
  ('PACOTE_SOCIAL','Pacote social'),
  ('LEGADO','Registro histórico')
on conflict (code) do nothing;

insert into public.billing_submission_channels(code,name) values
  ('DIRETO','Direto'),
  ('PORTAL_CONVENIO','Portal do convênio'),
  ('COOPERATIVA','Cooperativa'),
  ('MANUAL','Manual'),
  ('LEGADO','Registro histórico')
on conflict (code) do nothing;

alter table public.billing_records
  add column if not exists professional_id text references public.doctors(id),
  add column if not exists professional_role text,
  add column if not exists patient_insurance_snapshot text,
  add column if not exists commercial_modality_code text references public.billing_commercial_modalities(code),
  add column if not exists submission_channel_code text references public.billing_submission_channels(code),
  add column if not exists effective_payer_id uuid references public.billing_counterparties(id),
  add column if not exists effective_payer_role text,
  add column if not exists effective_payer_name_snapshot text,
  add column if not exists billing_entity_name_snapshot text,
  add column if not exists service_group_key text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='billing_records_professional_role_check') then
    alter table public.billing_records add constraint billing_records_professional_role_check
      check (professional_role is null or professional_role in ('PRIMARY','SURGEON','ANESTHETIST','ASSISTANT','OTHER'));
  end if;
  if not exists (select 1 from pg_constraint where conname='billing_records_effective_payer_role_check') then
    alter table public.billing_records add constraint billing_records_effective_payer_role_check
      check (effective_payer_role is null or effective_payer_role in ('PAYER','INTERMEDIARY'));
  end if;
end $$;

-- Each existing row remains one historical charge belonging to the clinical
-- doctor. No values, invoices, payment parts or IDs are duplicated.
update public.billing_records b
set professional_id = coalesce(b.professional_id,a.doctor_id),
    professional_role = coalesce(b.professional_role,'PRIMARY'),
    patient_insurance_snapshot = coalesce(b.patient_insurance_snapshot,a.insurance,''),
    commercial_modality_code = coalesce(b.commercial_modality_code,case when b.billing_method='PARTICULAR' then 'PARTICULAR' else 'LEGADO' end),
    submission_channel_code = coalesce(b.submission_channel_code,case when b.settlement_mode='DIRECT' then 'DIRETO' else 'LEGADO' end),
    billing_entity_name_snapshot = coalesce(b.billing_entity_name_snapshot,e.trade_name,e.name)
from public.attendances a
left join public.billing_entities e on e.id=b.billing_entity_id
where a.id=b.attendance_id;

do $$ begin
  if exists (select 1 from pg_constraint where conrelid='public.billing_records'::regclass and conname='billing_attendance_unique') then
    alter table public.billing_records drop constraint billing_attendance_unique;
  else
    drop index if exists public.billing_attendance_unique;
  end if;
  if exists (select 1 from pg_constraint where conrelid='public.billing_records'::regclass and conname='billing_records_appointment_id_key') then
    alter table public.billing_records drop constraint billing_records_appointment_id_key;
  else
    drop index if exists public.billing_records_appointment_id_key;
  end if;
end $$;
create unique index if not exists billing_records_attendance_professional_unique
  on public.billing_records(attendance_id,professional_id)
  where professional_id is not null;
create index if not exists billing_records_professional_idx on public.billing_records(professional_id,attendance_id);
create index if not exists billing_records_effective_payer_idx on public.billing_records(effective_payer_id) where effective_payer_id is not null;
create index if not exists billing_professional_rules_lookup_idx
  on public.billing_professional_commercial_rules(professional_id,patient_insurance_key,valid_from desc)
  where active;

-- The service route is the only caller. The function locks the attendance and
-- charge row, preserves optimistic concurrency, and lets the existing audit
-- trigger record before/after values under financial_operation().
create or replace function public.save_professional_charge(p_actor bigint,p_data jsonb)
returns uuid
language plpgsql
set search_path to ''
as $$
declare
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
  perform pg_advisory_xact_lock(194701,3);
  select role into role_name from public.users where id=p_actor;
  if role_name is null or role_name not in ('general_manager','secretary') then raise exception 'Acesso negado'; end if;
  if nullif(current_setting('rn.operation',true),'') is null or current_setting('rn.actor',true)<>p_actor::text then raise exception 'Operação fiscal obrigatória'; end if;
  if coalesce(nullif(trim(p_data->>'attendance_id'),''),'')='' or coalesce(nullif(trim(p_data->>'professional_id'),''),'')='' then raise exception 'Informe atendimento e profissional responsável'; end if;
  select * into attendance from public.attendances where id=p_data->>'attendance_id' for update;
  if not found or attendance.status='cancelled' then raise exception 'Atendimento cancelado ou inexistente'; end if;
  if role_name='secretary' and not exists (
    select 1 from public.app_state s cross join lateral jsonb_array_elements(coalesce(s.payload->'appointments','[]')) clinical
    join public.agenda_access g on g.user_id=p_actor and g.professional_id in (clinical->>'doctorId',clinical->>'anesthetistId')
    where s.id=1 and clinical->>'id'=attendance.appointment_id
  ) then raise exception 'Agenda sem permissão'; end if;
  if not exists(select 1 from public.doctors where id=p_data->>'professional_id' and active and billing_enabled) then raise exception 'Profissional inexistente ou sem faturamento habilitado'; end if;
  entity_id:=nullif(p_data->>'billing_entity_id','')::uuid;
  if entity_id is null or not exists(select 1 from public.billing_entities where id=entity_id and active) then raise exception 'Entidade recebedora inativa ou inexistente'; end if;
  if not exists(select 1 from public.billing_doctor_entities where doctor_id=p_data->>'professional_id' and billing_entity_id=entity_id and active) then raise exception 'Selecione uma entidade vinculada ao profissional'; end if;
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
$$;

revoke all on function public.save_professional_charge(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.save_professional_charge(bigint,jsonb) to service_role;

-- A narrow record-id based invoice path. Unlike the legacy attendance-id
-- function, it can group charges of different professionals from the same
-- clinical attendance without selecting one of them implicitly.
create or replace function public.save_professional_invoice(p_actor bigint,p_data jsonb)
returns uuid
language plpgsql
set search_path to ''
as $$
declare
  role_name text;
  target_invoice_id uuid := coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
  entity_id uuid := nullif(p_data->>'billing_entity_id','')::uuid;
  payer_value text := public.billing_payer_key(p_data->>'payer');
  record_id uuid;
  charge public.billing_records%rowtype;
  total numeric:=0;
  amount numeric;
begin
  perform pg_advisory_xact_lock(194701,4);
  select role into role_name from public.users where id=p_actor;
  if role_name is distinct from 'general_manager' then raise exception 'Somente a gerência pode gerenciar lotes'; end if;
  perform public.financial_operation(p_actor,'professional_invoice',target_invoice_id::text);
  if entity_id is null or not exists(select 1 from public.billing_entities where id=entity_id and active) then raise exception 'Entidade recebedora inativa ou inexistente'; end if;
  if payer_value='' or nullif(trim(p_data->>'invoice_number'),'') is null or nullif(p_data->>'issue_date','') is null then raise exception 'Preencha número, pagador e emissão'; end if;
  if jsonb_typeof(p_data->'record_ids') is distinct from 'array' or jsonb_array_length(p_data->'record_ids')=0 or jsonb_typeof(p_data->'item_amounts') is distinct from 'object' then raise exception 'Selecione as cobranças e informe cada valor'; end if;
  if exists(select 1 from public.invoices where id=target_invoice_id and (status<>'ACTIVE' or voided_at is not null)) then raise exception 'Documento histórico não pode ser editado'; end if;
  for record_id in select distinct value::uuid from jsonb_array_elements_text(p_data->'record_ids') loop
    select * into charge from public.billing_records where id=record_id for update;
    if not found or charge.billing_method<>'CONVENIO' or charge.settlement_mode='DIRECT' then raise exception 'Cobrança não elegível para NF de convênio'; end if;
    if charge.billing_entity_id<>entity_id then raise exception 'Todas as cobranças da NF devem usar a mesma entidade recebedora'; end if;
    if public.billing_payer_key(coalesce(charge.effective_payer_name_snapshot,charge.patient_insurance_snapshot,''))<>payer_value then raise exception 'Pagador efetivo diferente do lote'; end if;
    if exists(select 1 from public.invoice_billing_records ib where ib.billing_record_id=record_id and ib.invoice_id<>target_invoice_id and ib.is_active) then raise exception 'Cobrança já vinculada a outra NF'; end if;
    if not exists(select 1 from public.billing_doctor_entities where doctor_id=charge.professional_id and billing_entity_id=entity_id and active) then raise exception 'Profissional sem vínculo ativo com a entidade recebedora'; end if;
    amount:=nullif(p_data->'item_amounts'->>record_id::text,'')::numeric;
    if amount is null or amount<0 then raise exception 'Informe o valor de cada cobrança'; end if;
    total:=total+round(amount,2);
  end loop;
  if total+coalesce(nullif(p_data->>'closing_adjustment','')::numeric,0)<>round((p_data->>'net_amount')::numeric,2) then raise exception 'A soma dos itens e ajuste deve ser igual ao valor líquido'; end if;
  insert into public.invoices(id,billing_entity_id,invoice_number,payer,issue_date,total_amount,net_amount,paid_at,notes,recipient_type,closing_adjustment,closing_adjustment_reason,allocation_verified,payment_composition_verified,updated_at,updated_by)
  values(target_invoice_id,entity_id,trim(p_data->>'invoice_number'),payer_value,(p_data->>'issue_date')::date,nullif(p_data->>'total_amount','')::numeric,(p_data->>'net_amount')::numeric,nullif(p_data->>'paid_at','')::date,nullif(trim(p_data->>'notes'),''),'CONVENIO',coalesce(nullif(p_data->>'closing_adjustment','')::numeric,0),nullif(trim(p_data->>'closing_adjustment_reason'),''),true,false,clock_timestamp(),p_actor)
  on conflict(id) do update set billing_entity_id=excluded.billing_entity_id,invoice_number=excluded.invoice_number,payer=excluded.payer,issue_date=excluded.issue_date,total_amount=excluded.total_amount,net_amount=excluded.net_amount,paid_at=excluded.paid_at,notes=excluded.notes,closing_adjustment=excluded.closing_adjustment,closing_adjustment_reason=excluded.closing_adjustment_reason,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  update public.billing_records set payment_status='PENDENTE',updated_at=clock_timestamp(),updated_by=p_actor where id in(select ib.billing_record_id from public.invoice_billing_records ib where ib.invoice_id=target_invoice_id);
  delete from public.invoice_billing_records ib where ib.invoice_id=target_invoice_id and not (ib.billing_record_id in(select value::uuid from jsonb_array_elements_text(p_data->'record_ids')));
  for record_id in select distinct value::uuid from jsonb_array_elements_text(p_data->'record_ids') loop
    amount:=(p_data->'item_amounts'->>record_id::text)::numeric;
    insert into public.invoice_billing_records(invoice_id,billing_record_id,received_amount,is_active)
      values(target_invoice_id,record_id,round(amount,2),true)
      on conflict(invoice_id,billing_record_id) do update set received_amount=excluded.received_amount,is_active=true;
  end loop;
  update public.billing_records set payment_status=case when nullif(p_data->>'paid_at','') is null then 'PENDENTE' else 'PAGO' end,received_amount=null,paid_at=null,invoice_number=null,updated_at=clock_timestamp(),updated_by=p_actor where id in(select value::uuid from jsonb_array_elements_text(p_data->'record_ids'));
  if nullif(p_data->>'paid_at','') is not null then
    if jsonb_typeof(p_data->'payment_parts') is distinct from 'array' then raise exception 'Informe as formas de pagamento'; end if;
    perform public.write_payment_parts(null,target_invoice_id,p_data->'payment_parts');
    update public.invoices set payment_composition_verified=true where id=target_invoice_id;
  else
    delete from public.payment_parts where invoice_id=target_invoice_id;
  end if;
  return target_invoice_id;
end;
$$;

revoke all on function public.save_professional_invoice(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.save_professional_invoice(bigint,jsonb) to service_role;

alter table public.billing_commercial_modalities enable row level security;
alter table public.billing_submission_channels enable row level security;
alter table public.billing_counterparties enable row level security;
alter table public.billing_professional_commercial_rules enable row level security;
revoke all on table public.billing_commercial_modalities,public.billing_submission_channels,public.billing_counterparties,public.billing_professional_commercial_rules from anon,authenticated;
grant all on table public.billing_commercial_modalities,public.billing_submission_channels,public.billing_counterparties,public.billing_professional_commercial_rules to service_role;
