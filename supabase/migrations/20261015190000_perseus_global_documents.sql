-- Perseu Fase 4: documentos globais e propostas operacionais. Nenhuma operação financeira é executada aqui.
create table public.perseus_documents (
 id uuid primary key default gen_random_uuid(),
 storage_path text not null unique,
 original_filename text not null,
 mime_type text not null,
 file_size bigint not null check (file_size > 0 and file_size <= 20971520),
 sha256 text unique,
 detected_format text check (detected_format in ('PDF','PNG','JPEG','WEBP','TXT','CSV','XLSX','XML')),
 processing_status text not null default 'RECEIVED' check (processing_status in ('RECEIVED','PENDING_PROCESSING','PROCESSING','REVIEW_REQUIRED','FAILED')),
 document_class text not null default 'UNKNOWN' check (document_class in ('INSURANCE_PAYMENT','PROCESSING_RETURN','ATTENDANCE_RELATION','GUIDE','GLOSS','TRANSFER_PROOF','INVOICE','INVOICE_REQUEST','EXPENSE','UNKNOWN','MULTIPLE')),
 extracted_data jsonb not null default '{}'::jsonb check (jsonb_typeof(extracted_data)='object'),
 processing_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(processing_metadata)='object'),
 error_message text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by bigint not null references public.users(id) on delete restrict, updated_by bigint not null references public.users(id) on delete restrict
);
create index perseus_documents_status_created on public.perseus_documents(processing_status,created_at desc);
create table public.perseus_document_evidences (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.perseus_documents(id) on delete restrict,
 field_key text not null, field_value text not null, source_page integer, source_snippet text, method text not null check (method in ('LOCAL_TEXT','STRUCTURAL','MULTIMODAL')), engine_version text not null, created_at timestamptz not null default now()
);
create index perseus_document_evidences_document on public.perseus_document_evidences(document_id,id);
create table public.perseus_operational_proposals (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.perseus_documents(id) on delete restrict,
 proposal_type text not null check (proposal_type in ('LINK_ATTENDANCES','REVIEW_INSURANCE_PAYMENT','PREPARE_INVOICE_REQUEST','REVIEW_INVOICE','REVIEW_GLOSS','REGISTER_EXPENSE_DRAFT','REQUEST_INFORMATION')),
 status text not null default 'PROPOSED' check (status in ('PROPOSED','NEEDS_INFORMATION','REVIEWED','DISMISSED')),
 title text not null, rationale text not null, missing_information jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_information)='array'),
 created_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by bigint references public.users(id) on delete restrict
);
create index perseus_operational_proposals_document on public.perseus_operational_proposals(document_id,status,created_at desc);
create table public.perseus_global_events (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.perseus_documents(id) on delete restrict,
 event_type text not null check (event_type in ('DOCUMENT_RECEIVED','ANALYSIS_STARTED','ANALYSIS_COMPLETED','ANALYSIS_FAILED','PROPOSAL_REVIEWED','PROPOSAL_DISMISSED')),
 actor_id bigint references public.users(id) on delete restrict, event_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(event_metadata)='object'), occurred_at timestamptz not null default now()
);
create index perseus_global_events_document on public.perseus_global_events(document_id,occurred_at desc);
alter table public.perseus_documents enable row level security;
alter table public.perseus_document_evidences enable row level security;
alter table public.perseus_operational_proposals enable row level security;
alter table public.perseus_global_events enable row level security;
revoke all on table public.perseus_documents,public.perseus_document_evidences,public.perseus_operational_proposals,public.perseus_global_events from public,anon,authenticated;
grant select,insert,update,delete on table public.perseus_documents,public.perseus_document_evidences,public.perseus_operational_proposals,public.perseus_global_events to service_role;

create or replace function public.claim_perseus_document_processing(p_document_id uuid,p_actor_id bigint)
returns public.perseus_documents language plpgsql security invoker set search_path=public,pg_temp as $$
declare row public.perseus_documents%rowtype;
begin
 select * into row from public.perseus_documents where id=p_document_id for update;
 if not found then raise exception 'Documento não encontrado.' using errcode='P0002'; end if;
 if row.processing_status not in ('PENDING_PROCESSING','REVIEW_REQUIRED','FAILED') then raise exception 'Documento não está disponível para análise.' using errcode='55000'; end if;
 update public.perseus_documents set processing_status='PROCESSING',error_message=null,updated_at=now(),updated_by=p_actor_id where id=p_document_id returning * into row;
 insert into public.perseus_global_events(document_id,event_type,actor_id) values(p_document_id,'ANALYSIS_STARTED',p_actor_id);
 return row;
end $$;
revoke all on function public.claim_perseus_document_processing(uuid,bigint) from public,anon,authenticated;
grant execute on function public.claim_perseus_document_processing(uuid,bigint) to service_role;
