-- Perseu Fase 1: domínio documental independente e estritamente aditivo.
create table public.insurance_movements (
 id uuid primary key default gen_random_uuid(),
 billing_entity_id uuid not null references public.billing_entities(id),
 payer text not null check(length(trim(payer))>0),
 competence date,
 kind text not null check(kind in ('SUBMISSION','PROCESSING','GLOSS','APPEAL','APPEAL_RESPONSE','OTHER','UNKNOWN')),
 external_reference text,
 reference_date date,
 notes text,
 created_at timestamptz not null default now(),
 created_by bigint not null references public.users(id),
 updated_at timestamptz not null default now(),
 updated_by bigint not null references public.users(id),
 check(competence is null or competence=date_trunc('month',competence)::date)
);
create index insurance_movements_context_idx on public.insurance_movements(billing_entity_id,payer,competence,created_at desc);

create table public.insurance_documents (
 id uuid primary key,
 movement_id uuid not null references public.insurance_movements(id) on delete restrict,
 storage_path text not null unique,
 original_filename text not null check(length(trim(original_filename)) between 1 and 200),
 mime_type text,
 file_size bigint check(file_size is null or (file_size>0 and file_size<=26214400)),
 sha256 text,
 detected_format text,
 detected_kind text,
 upload_status text not null default 'PENDING' check(upload_status in ('PENDING','READY','REJECTED')),
 perseus_status text not null default 'NOT_ANALYZED' check(perseus_status in ('NOT_ANALYZED','REVIEW_REQUIRED','ANALYZED','FAILED')),
 parser_key text,
 parser_version text,
 raw_metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 created_by bigint not null references public.users(id),
 updated_at timestamptz not null default now(),
 updated_by bigint not null references public.users(id),
 check(detected_kind is null or detected_kind in ('SUBMISSION','PROCESSING','GLOSS','APPEAL','APPEAL_RESPONSE','OTHER','UNKNOWN'))
);
create index insurance_documents_sha256_ready_idx on public.insurance_documents(sha256) where upload_status='READY';
create index insurance_documents_movement_idx on public.insurance_documents(movement_id,created_at desc);

create table public.insurance_document_items (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.insurance_documents(id) on delete restrict,
 source_index integer,
 raw_data jsonb not null,
 normalized_data jsonb not null default '{}'::jsonb,
 patient_name text,
 beneficiary_number text,
 guide_number text,
 external_reference text,
 service_date date,
 procedure_code text,
 procedure_description text,
 amount_presented numeric,
 amount_approved numeric,
 amount_glossed numeric,
 gloss_code text,
 gloss_reason text,
 attendance_id uuid,
 billing_record_id uuid,
 match_status text check(match_status in ('UNMATCHED','SUGGESTED','MATCHED','IGNORED')),
 match_confidence numeric check(match_confidence is null or (match_confidence>=0 and match_confidence<=100)),
 match_evidence jsonb not null default '{}'::jsonb
);
create index insurance_document_items_document_idx on public.insurance_document_items(document_id,source_index);

alter table public.insurance_movements enable row level security;
alter table public.insurance_documents enable row level security;
alter table public.insurance_document_items enable row level security;
revoke all on public.insurance_movements,public.insurance_documents,public.insurance_document_items from public,anon,authenticated;
grant select,insert,update,delete on public.insurance_movements,public.insurance_documents,public.insurance_document_items to service_role;

insert into storage.buckets(id,name,public,file_size_limit)
values('insurance-documents','insurance-documents',false,26214400)
on conflict(id) do update set public=false,file_size_limit=26214400;
