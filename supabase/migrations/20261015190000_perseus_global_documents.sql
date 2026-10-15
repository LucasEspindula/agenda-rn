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
 document_class text not null default 'UNKNOWN' check (document_class in ('INSURANCE_PROCESSING','INSURANCE_PAYMENT','ATTENDANCE_RELATION','GUIDE','GLOSS_DETAIL','GLOSS_APPEAL','GLOSS_APPEAL_RESPONSE','HONORARIUM_REPORT','TRANSFER_PROOF','INVOICE','INVOICE_REQUEST','EXPENSE_RECEIPT','UNKNOWN','MULTIPLE')),
 extracted_data jsonb not null default '{}'::jsonb check (jsonb_typeof(extracted_data)='object'),
 processing_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(processing_metadata)='object'),
 error_message text, analysis_version integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by bigint not null references public.users(id) on delete restrict, updated_by bigint not null references public.users(id) on delete restrict
);
create index perseus_documents_status_created on public.perseus_documents(processing_status,created_at desc);
create table public.perseus_document_evidences (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.perseus_documents(id) on delete restrict,
 analysis_version integer not null, field_key text not null, field_value text not null, source_page integer, source_snippet text, method text not null check (method in ('LOCAL_TEXT','STRUCTURAL','MULTIMODAL')), engine_version text not null, created_at timestamptz not null default now()
);
create index perseus_document_evidences_document on public.perseus_document_evidences(document_id,id);
create table public.perseus_operational_proposals (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.perseus_documents(id) on delete restrict,
 proposal_type text not null check (proposal_type in ('LINK_ATTENDANCES','REVIEW_INSURANCE_PAYMENT','PREPARE_INVOICE_REQUEST','REVIEW_INVOICE','REVIEW_GLOSS','REGISTER_EXPENSE_DRAFT','REQUEST_INFORMATION')),
 analysis_version integer not null, status text not null default 'PROPOSED' check (status in ('PROPOSED','NEEDS_INFORMATION','REVIEWED','DISMISSED','SUPERSEDED')),
 title text not null, rationale text not null, proposal_data jsonb not null default '{}'::jsonb check (jsonb_typeof(proposal_data)='object'), missing_information jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_information)='array'),
 created_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by bigint references public.users(id) on delete restrict, review_data jsonb not null default '{}'::jsonb check (jsonb_typeof(review_data)='object')
);
create index perseus_operational_proposals_document on public.perseus_operational_proposals(document_id,status,created_at desc);
create table public.perseus_global_events (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.perseus_documents(id) on delete restrict,
 event_type text not null check (event_type in ('DOCUMENT_RECEIVED','FORMAT_VALIDATED','ANALYSIS_STARTED','CLASSIFICATION_COMPLETED','EXTRACTION_COMPLETED','EXTRACTION_PARTIAL','MULTIMODAL_USED','MULTIMODAL_UNAVAILABLE','CONTEXT_LOCATED','PROPOSAL_CREATED','ANALYSIS_COMPLETED','ANALYSIS_FAILED','REANALYSIS_BLOCKED','PROPOSAL_REVIEWED','PROPOSAL_DISMISSED')),
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
 if row.processing_status='PROCESSING' and row.updated_at > now()-interval '15 minutes' then raise exception 'Documento já está em processamento.' using errcode='55000'; end if;
 if row.processing_status not in ('PENDING_PROCESSING','REVIEW_REQUIRED','FAILED','PROCESSING') then raise exception 'Documento não está disponível para análise.' using errcode='55000'; end if;
 update public.perseus_documents set processing_status='PROCESSING',error_message=null,updated_at=now(),updated_by=p_actor_id where id=p_document_id returning * into row;
 insert into public.perseus_global_events(document_id,event_type,actor_id) values(p_document_id,'ANALYSIS_STARTED',p_actor_id);
 return row;
end $$;
revoke all on function public.claim_perseus_document_processing(uuid,bigint) from public,anon,authenticated;
grant execute on function public.claim_perseus_document_processing(uuid,bigint) to service_role;

create or replace function public.complete_perseus_document_analysis(p_document_id uuid,p_expected_version integer,p_document_class text,p_extracted_data jsonb,p_processing_metadata jsonb,p_evidences jsonb,p_proposals jsonb,p_outcome text,p_actor_id bigint)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare doc public.perseus_documents%rowtype; next_version integer;
begin
 if jsonb_typeof(p_extracted_data) is distinct from 'object' or jsonb_typeof(p_processing_metadata) is distinct from 'object' or jsonb_typeof(p_evidences) is distinct from 'array' or jsonb_typeof(p_proposals) is distinct from 'array' then raise exception 'Resultado do Perseu inválido.' using errcode='22023'; end if;
 if p_document_class not in ('INSURANCE_PROCESSING','INSURANCE_PAYMENT','ATTENDANCE_RELATION','GUIDE','GLOSS_DETAIL','GLOSS_APPEAL','GLOSS_APPEAL_RESPONSE','HONORARIUM_REPORT','TRANSFER_PROOF','INVOICE','INVOICE_REQUEST','EXPENSE_RECEIPT','UNKNOWN','MULTIPLE') then raise exception 'Classificação inválida.' using errcode='22023'; end if;
 select * into doc from public.perseus_documents where id=p_document_id for update;
 if not found or doc.processing_status<>'PROCESSING' or doc.analysis_version<>p_expected_version then raise exception 'Análise foi substituída por outra operação.' using errcode='40001'; end if;
 next_version:=doc.analysis_version+1;
 update public.perseus_operational_proposals set status='SUPERSEDED' where document_id=p_document_id and status in ('PROPOSED','NEEDS_INFORMATION');
 insert into public.perseus_document_evidences(document_id,analysis_version,field_key,field_value,source_page,source_snippet,method,engine_version)
 select p_document_id,next_version,left(field_key,64),left(field_value,2000),source_page,left(source_snippet,2000),method,engine_version from jsonb_to_recordset(p_evidences) as item(field_key text,field_value text,source_page integer,source_snippet text,method text,engine_version text);
 insert into public.perseus_operational_proposals(document_id,analysis_version,proposal_type,status,title,rationale,proposal_data,missing_information)
 select p_document_id,next_version,proposal_type,'PROPOSED',left(title,240),left(rationale,2000),coalesce(proposal_data,'{}'::jsonb),coalesce(missing_information,'[]'::jsonb) from jsonb_to_recordset(p_proposals) as item(proposal_type text,title text,rationale text,proposal_data jsonb,missing_information jsonb);
 update public.perseus_documents set analysis_version=next_version,processing_status='REVIEW_REQUIRED',document_class=p_document_class,extracted_data=p_extracted_data,processing_metadata=p_processing_metadata,error_message=null,updated_at=now(),updated_by=p_actor_id where id=p_document_id;
 insert into public.perseus_global_events(document_id,event_type,actor_id,event_metadata) values
 (p_document_id,'CLASSIFICATION_COMPLETED',p_actor_id,jsonb_build_object('class',p_document_class,'version',next_version)),
 (p_document_id,case when p_outcome='PARTIAL' then 'EXTRACTION_PARTIAL' else 'EXTRACTION_COMPLETED' end,p_actor_id,jsonb_build_object('version',next_version)),
 (p_document_id,'PROPOSAL_CREATED',p_actor_id,jsonb_build_object('version',next_version,'count',jsonb_array_length(p_proposals))),
 (p_document_id,'ANALYSIS_COMPLETED',p_actor_id,jsonb_build_object('version',next_version));
end $$;
revoke all on function public.complete_perseus_document_analysis(uuid,integer,text,jsonb,jsonb,jsonb,jsonb,text,bigint) from public,anon,authenticated;
grant execute on function public.complete_perseus_document_analysis(uuid,integer,text,jsonb,jsonb,jsonb,jsonb,text,bigint) to service_role;
