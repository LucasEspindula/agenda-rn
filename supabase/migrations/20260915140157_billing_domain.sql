create table if not exists public.billing_entities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  tax_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_records (
  id uuid primary key default gen_random_uuid(),
  appointment_id text not null,
  billing_entity_id uuid not null references public.billing_entities(id),
  billing_method text not null check (billing_method in ('PARTICULAR','CONVENIO')),
  payment_status text not null default 'PENDENTE' check (payment_status in ('PENDENTE','PAGO')),
  invoice_number text,
  received_amount numeric(12,2),
  paid_at date,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by bigint references public.users(id),
  unique (appointment_id),
  check (billing_method = 'CONVENIO' or received_amount is not null or payment_status = 'PENDENTE'),
  check (received_amount is null or received_amount >= 0)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  billing_entity_id uuid not null references public.billing_entities(id),
  invoice_number text not null,
  issue_date date,
  total_amount numeric(12,2),
  paid_at date,
  created_at timestamptz not null default now(),
  unique (billing_entity_id, invoice_number)
);

create table if not exists public.invoice_billing_records (
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  billing_record_id uuid not null references public.billing_records(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (invoice_id,billing_record_id)
);

create index if not exists billing_records_appointment_idx on public.billing_records(appointment_id);
create index if not exists billing_records_pending_idx on public.billing_records(payment_status,billing_method);

alter table public.billing_entities enable row level security;
alter table public.billing_records enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_billing_records enable row level security;

revoke all on public.billing_entities,public.billing_records,public.invoices,public.invoice_billing_records from public,anon,authenticated;
grant select,insert,update,delete on public.billing_entities,public.billing_records,public.invoices,public.invoice_billing_records to service_role;