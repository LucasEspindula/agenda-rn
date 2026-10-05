create index if not exists agenda_requests_requester_idx
on public.agenda_requests(requested_by);

create index if not exists sessions_user_idx
on public.sessions(user_id);

create index if not exists audit_logs_professional_idx
on public.audit_logs(professional_id);

alter table public.users
drop constraint if exists users_email_key;

create unique index if not exists users_email_lower_uidx
on public.users(lower(email));
