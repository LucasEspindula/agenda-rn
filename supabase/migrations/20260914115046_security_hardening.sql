-- Additive hardening for the existing server-only Supabase access model.
create table public.security_rate_limits (
  key text primary key check (length(key) = 64),
  hits integer not null,
  expires_at timestamptz not null
);
alter table public.security_rate_limits enable row level security;
revoke all on public.security_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.security_rate_limits to service_role;
create index security_rate_limits_expiry on public.security_rate_limits(expires_at);

create function public.consume_security_limit(p_key text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare n integer; t timestamptz := clock_timestamp();
begin
  if p_limit < 1 or p_limit > 10000 or p_seconds < 1 or p_seconds > 86400 then raise exception 'Invalid limit'; end if;
  delete from public.security_rate_limits where expires_at < t;
  insert into public.security_rate_limits(key,hits,expires_at) values(p_key,1,t + make_interval(secs=>p_seconds))
  on conflict(key) do update set hits=public.security_rate_limits.hits+1
  returning hits into n;
  return n <= p_limit;
end;
$$;
revoke all on function public.consume_security_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_security_limit(text,integer,integer) to service_role;

create function public.revoke_changed_credentials() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.password_hash is distinct from new.password_hash or old.password_salt is distinct from new.password_salt or old.role is distinct from new.role then
    delete from public.sessions where user_id=old.id;
  end if;
  return new;
end;
$$;
revoke all on function public.revoke_changed_credentials() from public,anon,authenticated;
grant execute on function public.revoke_changed_credentials() to service_role;
create trigger users_revoke_sessions before update on public.users for each row execute function public.revoke_changed_credentials();

-- State compare-and-set, audit trail, and workflow decision must commit together.
create function public.commit_agenda_change(p_expected timestamptz, p_payload jsonb, p_revision timestamptz, p_audit jsonb,
  p_request_id text default null, p_decision text default null, p_actor bigint default null, p_note text default null, p_notification jsonb default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_revision timestamptz; request_status text;
begin
  -- Serialize initialization as well as writes to the singleton.
  perform pg_advisory_xact_lock(194701,1);
  select updated_at into current_revision from public.app_state where id=1 for update;
  if current_revision is distinct from p_expected then return false; end if;
  if p_request_id is not null then
    select status into request_status from public.agenda_requests where id=p_request_id for update;
    if request_status is distinct from 'pending' then return false; end if;
    if p_decision not in ('accepted','denied') then raise exception 'Invalid decision'; end if;
    update public.agenda_requests set status=p_decision,decided_by=p_actor,decision_note=p_note,decided_at=p_revision where id=p_request_id;
  end if;
  if p_payload is not null then
    insert into public.app_state(id,payload,updated_at) values(1,p_payload,p_revision)
    on conflict(id) do update set payload=excluded.payload,updated_at=excluded.updated_at;
  end if;
  insert into public.audit_logs(id,actor_user_id,actor_name,actor_role,action,professional_id,appointment_id,patient_id,description,metadata,created_at)
    select x.id,x.actor_user_id,x.actor_name,x.actor_role,x.action,x.professional_id,x.appointment_id,x.patient_id,x.description,x.metadata,coalesce(x.created_at,p_revision)
    from jsonb_to_recordset(p_audit) as x(id text,actor_user_id bigint,actor_name text,actor_role text,action text,professional_id text,appointment_id text,patient_id text,description text,metadata jsonb,created_at timestamptz);
  if p_notification is not null then
    insert into public.notifications(id,user_id,type,request_id,message,created_at)
    values(p_notification->>'id',(p_notification->>'user_id')::bigint,p_notification->>'type',p_request_id,p_notification->>'message',p_revision);
  end if;
  return true;
end;
$$;
revoke all on function public.commit_agenda_change(timestamptz,jsonb,timestamptz,jsonb,text,text,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_agenda_change(timestamptz,jsonb,timestamptz,jsonb,text,text,bigint,text,jsonb) to service_role;
