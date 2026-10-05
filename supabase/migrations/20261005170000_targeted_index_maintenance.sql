drop index if exists public.agenda_requests_professional_status_idx;
drop index if exists public.audit_logs_created_idx;
drop index if exists public.notifications_user_created_idx;
drop index if exists public.sessions_expires_idx;

create index if not exists financial_logs_actor_created_idx
on public.financial_logs(actor_id, created_at desc);

create index if not exists financial_attachments_creator_status_created_idx
on public.financial_attachments(created_by, status, created_at);
