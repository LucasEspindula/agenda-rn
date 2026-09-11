-- Private surgery documents. Access is mediated by the application's session API.
create table if not exists public.surgery_documents (
 id uuid primary key,
 appointment_id text not null,
 patient_id text,
 object_path text not null unique,
 name text not null,
 category text not null check (category in ('guide','report','summary','other')),
 size bigint not null check (size > 0 and size <= 20971520),
 sha256 text,
 uploaded_by bigint not null,
 status text not null default 'pending' check (status in ('pending','ready')),
 created_at timestamptz not null default now()
);
create index if not exists surgery_documents_appointment_idx on public.surgery_documents(appointment_id,created_at);
create index if not exists surgery_documents_patient_idx on public.surgery_documents(patient_id,created_at);
create unique index if not exists surgery_documents_duplicate_idx on public.surgery_documents(appointment_id,sha256) where status='ready';
alter table public.surgery_documents enable row level security;
revoke all on public.surgery_documents from anon, authenticated;
grant all on public.surgery_documents to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('surgery-documents','surgery-documents',false,20971520,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=20971520,allowed_mime_types=array['application/pdf'];
