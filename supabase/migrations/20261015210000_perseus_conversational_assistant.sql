-- Perseu Fase 5A: conversa, atividades e telemetria. Esta migration depende da Fase 4.
-- Não concede acesso direto ao navegador e não cria qualquer escrita financeira.
create table public.perseus_document_records (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.perseus_documents(id) on delete restrict,
 analysis_version integer not null,
 source_index integer not null check(source_index >= 0),
 raw_data jsonb not null default '{}'::jsonb check(jsonb_typeof(raw_data)='object'),
 normalized_data jsonb not null default '{}'::jsonb check(jsonb_typeof(normalized_data)='object'),
 source_metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(source_metadata)='object'),
 created_at timestamptz not null default now(),
 unique(document_id,analysis_version,source_index)
);
create index perseus_document_records_lookup on public.perseus_document_records(document_id,analysis_version,source_index);

create table public.perseus_conversations (
 id uuid primary key default gen_random_uuid(),
 owner_id bigint not null references public.users(id) on delete restrict,
 title text not null default 'Nova conversa' check(length(trim(title)) between 1 and 180),
 status text not null default 'ACTIVE' check(status in ('ACTIVE','ARCHIVED')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index perseus_conversations_owner_updated on public.perseus_conversations(owner_id,updated_at desc);

create table public.perseus_messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.perseus_conversations(id) on delete restrict,
 role text not null check(role in ('USER','ASSISTANT','SYSTEM')),
 content text not null check(length(content) between 1 and 8000),
 metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
 created_at timestamptz not null default now()
);
create index perseus_messages_conversation_created on public.perseus_messages(conversation_id,created_at,id);

create table public.perseus_chat_tasks (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.perseus_conversations(id) on delete restrict,
 user_message_id uuid references public.perseus_messages(id) on delete restrict,
 status text not null check(status in ('PENDING','RUNNING','COMPLETED','FAILED','WAITING','CANCELLED')),
 requested_by bigint not null references public.users(id) on delete restrict,
 started_at timestamptz not null default now(), completed_at timestamptz,
 error_message text
);
create index perseus_chat_tasks_conversation on public.perseus_chat_tasks(conversation_id,started_at desc);

create table public.perseus_chat_events (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.perseus_chat_tasks(id) on delete restrict,
 event_index integer not null check(event_index >= 0),
 status text not null check(status in ('PENDING','RUNNING','COMPLETED','FAILED','WAITING','CANCELLED')),
 title text not null check(length(title) <= 240), detail text, tool_name text, source text,
 result_count integer, event_metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(event_metadata)='object'),
 created_at timestamptz not null default now(), completed_at timestamptz,
 unique(task_id,event_index)
);
create index perseus_chat_events_task on public.perseus_chat_events(task_id,event_index);

create table public.perseus_conversation_documents (
 conversation_id uuid not null references public.perseus_conversations(id) on delete restrict,
 document_id uuid not null references public.perseus_documents(id) on delete restrict,
 message_id uuid references public.perseus_messages(id) on delete restrict,
 created_at timestamptz not null default now(),
 primary key(conversation_id,document_id)
);

create table public.perseus_usage_events (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.perseus_conversations(id) on delete restrict,
 task_id uuid references public.perseus_chat_tasks(id) on delete restrict,
 actor_id bigint not null references public.users(id) on delete restrict,
 provider text not null default 'OPENAI', model text not null, request_id text,
 input_tokens integer not null default 0 check(input_tokens >= 0), output_tokens integer not null default 0 check(output_tokens >= 0), cached_tokens integer not null default 0 check(cached_tokens >= 0),
 duration_ms integer not null default 0 check(duration_ms >= 0), estimated_cost_usd numeric(12,6),
 outcome text not null check(outcome in ('COMPLETED','FAILED','BLOCKED')),
 created_at timestamptz not null default now()
);
create index perseus_usage_actor_created on public.perseus_usage_events(actor_id,created_at desc);

alter table public.perseus_document_records enable row level security;
alter table public.perseus_conversations enable row level security;
alter table public.perseus_messages enable row level security;
alter table public.perseus_chat_tasks enable row level security;
alter table public.perseus_chat_events enable row level security;
alter table public.perseus_conversation_documents enable row level security;
alter table public.perseus_usage_events enable row level security;
revoke all on public.perseus_document_records,public.perseus_conversations,public.perseus_messages,public.perseus_chat_tasks,public.perseus_chat_events,public.perseus_conversation_documents,public.perseus_usage_events from public,anon,authenticated;
grant select,insert,update,delete on public.perseus_document_records,public.perseus_conversations,public.perseus_messages,public.perseus_chat_tasks,public.perseus_chat_events,public.perseus_conversation_documents,public.perseus_usage_events to service_role;

create or replace function public.complete_perseus_document_analysis_v2(
 p_document_id uuid,p_expected_version integer,p_document_class text,p_extracted_data jsonb,p_processing_metadata jsonb,p_evidences jsonb,p_proposals jsonb,p_records jsonb,p_outcome text,p_actor_id bigint
) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare doc public.perseus_documents%rowtype; next_version integer;
begin
 if jsonb_typeof(p_records) is distinct from 'array' then raise exception 'Registros estruturados inválidos.' using errcode='22023'; end if;
 select * into doc from public.perseus_documents where id=p_document_id for update;
 if not found or doc.processing_status<>'PROCESSING' or doc.analysis_version<>p_expected_version then raise exception 'Análise foi substituída por outra operação.' using errcode='40001'; end if;
 next_version:=doc.analysis_version+1;
 delete from public.perseus_document_records where document_id=p_document_id;
 insert into public.perseus_document_records(document_id,analysis_version,source_index,raw_data,normalized_data,source_metadata)
 select p_document_id,next_version,source_index,coalesce(raw_data,'{}'::jsonb),coalesce(normalized_data,'{}'::jsonb),coalesce(source_metadata,'{}'::jsonb)
 from jsonb_to_recordset(p_records) as item(source_index integer,raw_data jsonb,normalized_data jsonb,source_metadata jsonb)
 order by source_index;
 perform public.complete_perseus_document_analysis(p_document_id,p_expected_version,p_document_class,p_extracted_data,p_processing_metadata,p_evidences,p_proposals,p_outcome,p_actor_id);
end $$;
revoke all on function public.complete_perseus_document_analysis_v2(uuid,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,bigint) from public,anon,authenticated;
grant execute on function public.complete_perseus_document_analysis_v2(uuid,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,bigint) to service_role;
