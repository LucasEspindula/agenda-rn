-- RN Integra / Etapa 2: apresentação de guias ao portal (não é pagamento).
-- Dependência: 20261016120000_independent_professional_billing.sql.
-- Preparada para homologação. NÃO executar automaticamente no Supabase principal.

create table public.billing_portal_deadline_rules (
  id uuid primary key default gen_random_uuid(),
  destination_key text not null check(length(trim(destination_key)) between 2 and 120),
  submission_channel_code text not null references public.billing_submission_channels(code),
  professional_id text references public.doctors(id),
  starts_from text not null check(starts_from in ('SERVICE_DATE','GUIDE_RECEIVED')),
  days_kind text not null default 'CALENDAR' check(days_kind='CALENDAR'),
  deadline_days integer not null check(deadline_days between 1 and 365),
  alert_before_days integer not null check(alert_before_days between 0 and 90 and alert_before_days <= deadline_days),
  valid_from date not null,
  valid_to date,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  created_by bigint not null references public.users(id),
  check(valid_to is null or valid_to>=valid_from),
  check(submission_channel_code in ('PORTAL_CONVENIO','COOPERATIVA','MANUAL'))
);
create index billing_portal_deadline_rules_lookup
 on public.billing_portal_deadline_rules(destination_key,submission_channel_code,professional_id,valid_from desc)
 where active;

create table public.billing_portal_submissions (
  id uuid primary key default gen_random_uuid(),
  billing_record_id uuid not null unique references public.billing_records(id),
  status text not null default 'PENDENTE' check(status in ('PENDENTE','FATURADO')),
  destination_key text not null check(length(trim(destination_key)) between 2 and 120),
  submission_channel_code text not null references public.billing_submission_channels(code)
    check(submission_channel_code in ('PORTAL_CONVENIO','COOPERATIVA','MANUAL')),
  guide_received_at date,
  submitted_at date,
  portal_protocol text,
  notes text,
  submitted_by bigint references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  created_by bigint not null references public.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by bigint not null references public.users(id),
  check(
    (status='PENDENTE' and submitted_at is null and portal_protocol is null and submitted_by is null)
    or (status='FATURADO' and submitted_at is not null and
      guide_received_at is not null and submitted_at>=guide_received_at and
      submitted_by is not null and length(trim(portal_protocol)) between 3 and 120)
  )
);
create index billing_portal_submissions_status on public.billing_portal_submissions(status,updated_at);

-- Rastro específico do envio. Nunca reutilizar status_pagamento nem data de recebimento da NF.
create table public.billing_portal_submission_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.billing_portal_submissions(id),
  actor_id bigint not null references public.users(id),
  event_type text not null check(event_type in ('CONFIGURED','GUIDE_UPDATED','SUBMITTED')),
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index billing_portal_submission_events_history on public.billing_portal_submission_events(submission_id,created_at,id);

create or replace function public.save_billing_portal_rule(p_actor bigint,p_data jsonb)
returns uuid language plpgsql set search_path to ''
as $$
declare
  key text:=upper(trim(regexp_replace(coalesce(p_data->>'destination_key',''),'\s+',' ','g')));
  channel text:=nullif(p_data->>'submission_channel_code','');
  doctor text:=nullif(p_data->>'professional_id','');
  start_date date:=nullif(p_data->>'valid_from','')::date;
  end_date date:=nullif(p_data->>'valid_to','')::date;
  anchor text:=p_data->>'starts_from';
  days_count integer:=nullif(p_data->>'deadline_days','')::integer;
  lead_days integer:=nullif(p_data->>'alert_before_days','')::integer;
  saved_id uuid;
begin
  if not exists(select 1 from public.users where id=p_actor and role='general_manager')
    then raise exception 'Somente a gerência pode configurar prazos';end if;
  if length(key) not between 2 and 120 or channel not in ('PORTAL_CONVENIO','COOPERATIVA','MANUAL')
     or anchor not in ('SERVICE_DATE','GUIDE_RECEIVED') or start_date is null
     or days_count not between 1 and 365 or lead_days not between 0 and least(days_count,90)
     or (end_date is not null and end_date<start_date) then
     raise exception 'Preencha destino, canal, início da vigência, prazo e antecedência válidos';
  end if;
  if doctor is not null and not exists(select 1 from public.doctors where id=doctor and active)
    then raise exception 'Profissional inexistente';end if;
  -- Serializa edição de regras para impedir duas regras sobrepostas concorrentes.
  perform pg_advisory_xact_lock(194701,11);
  if exists(select 1 from public.billing_portal_deadline_rules r
    where r.active and r.destination_key=key and r.submission_channel_code=channel
      and r.professional_id is not distinct from doctor
      and r.valid_from<=coalesce(end_date,'infinity'::date)
      and start_date<=coalesce(r.valid_to,'infinity'::date))
    then raise exception 'Já existe regra sobreposta para esse destino, canal e profissional';end if;
  insert into public.billing_portal_deadline_rules(destination_key,submission_channel_code,professional_id,
      starts_from,deadline_days,alert_before_days,valid_from,valid_to,created_by)
  values(key,channel,doctor,anchor,days_count,lead_days,start_date,end_date,p_actor)
  returning id into saved_id;
  return saved_id;
end;
$$;

create or replace function public.save_billing_portal_submission(p_actor bigint,p_data jsonb)
returns uuid language plpgsql set search_path to ''
as $$
declare
  actor_role text;
  record_id uuid:=nullif(p_data->>'billing_record_id','')::uuid;
  charge public.billing_records%rowtype;
  attendance public.attendances%rowtype;
  old_row public.billing_portal_submissions%rowtype;
  new_row public.billing_portal_submissions%rowtype;
  saved_id uuid;
  destination text:=upper(trim(regexp_replace(coalesce(p_data->>'destination_key',''),'\s+',' ','g')));
  channel text:=nullif(p_data->>'submission_channel_code','');
  guide_date date:=nullif(p_data->>'guide_received_at','')::date;
  action text:=p_data->>'action';
  submission_date date:=nullif(p_data->>'submitted_at','')::date;
  protocol text:=nullif(trim(p_data->>'portal_protocol'),'');
  note_value text:=nullif(trim(p_data->>'notes'),'');
begin
  select role into actor_role from public.users where id=p_actor;
  if actor_role not in ('general_manager','secretary') or actor_role is null
    then raise exception 'Acesso negado ao envio de guias';end if;
  select * into charge from public.billing_records where id=record_id;
  if not found or charge.professional_id is null or charge.billing_method<>'CONVENIO'
    or charge.settlement_mode<>'INVOICE' then
    raise exception 'Cobrança profissional de convênio não elegível';
  end if;
  select * into attendance from public.attendances where id=charge.attendance_id;
  if not found or attendance.status<>'realized' then raise exception 'Atendimento ainda não realizado';end if;
  if actor_role='secretary' and not exists(select 1 from public.agenda_access
    where user_id=p_actor and professional_id=charge.professional_id)
    then raise exception 'Sem acesso à agenda desse profissional';end if;
  if action not in ('SAVE_PENDING','MARK_SUBMITTED')
    or length(destination) not between 2 and 120
    or channel not in ('PORTAL_CONVENIO','COOPERATIVA','MANUAL')
    or (charge.submission_channel_code not in ('LEGADO','MANUAL')
        and channel is distinct from charge.submission_channel_code)
    or (guide_date is not null and guide_date>current_date)
    or length(coalesce(note_value,''))>2000 then
    raise exception 'Revise destino, canal e dados da guia';
  end if;
  if action='MARK_SUBMITTED' and
    (guide_date is null or submission_date is null or submission_date>current_date
      or submission_date<guide_date or length(coalesce(protocol,'')) not between 3 and 120)
    then raise exception 'Faturado no portal exige recebimento da guia, data e protocolo válidos';end if;
  if action='SAVE_PENDING' and (submission_date is not null or protocol is not null)
    then raise exception 'Data e protocolo pertencem apenas à confirmação de faturamento';end if;

  perform pg_advisory_xact_lock(194701,12);
  select * into old_row from public.billing_portal_submissions where billing_record_id=record_id for update;
  if old_row.status='FATURADO' then raise exception 'Guia já faturada no portal. Preserve o histórico';end if;
  if old_row.id is not null and old_row.guide_received_at is not null
      and guide_date is null then
    raise exception 'Para corrigir o recebimento de uma guia já registrada, contate a gerência';end if;

  if old_row.id is null then
    insert into public.billing_portal_submissions(
      billing_record_id,status,destination_key,submission_channel_code,guide_received_at,
      submitted_at,portal_protocol,notes,submitted_by,created_by,updated_by)
    values(record_id,case when action='MARK_SUBMITTED' then 'FATURADO' else 'PENDENTE' end,
      destination,channel,guide_date,
      case when action='MARK_SUBMITTED' then submission_date end,
      case when action='MARK_SUBMITTED' then protocol end,note_value,
      case when action='MARK_SUBMITTED' then p_actor end,p_actor,p_actor)
    returning * into new_row;
  else
    update public.billing_portal_submissions set
      status=case when action='MARK_SUBMITTED' then 'FATURADO' else 'PENDENTE' end,
      destination_key=destination,submission_channel_code=channel,
      guide_received_at=guide_date,
      submitted_at=case when action='MARK_SUBMITTED' then submission_date end,
      portal_protocol=case when action='MARK_SUBMITTED' then protocol end,
      submitted_by=case when action='MARK_SUBMITTED' then p_actor end,
      notes=note_value,updated_at=clock_timestamp(),updated_by=p_actor
      where id=old_row.id returning * into new_row;
  end if;
  insert into public.billing_portal_submission_events(submission_id,actor_id,event_type,before_snapshot,after_snapshot)
    values(new_row.id,p_actor,
      case when action='MARK_SUBMITTED' then 'SUBMITTED'
        when old_row.guide_received_at is distinct from new_row.guide_received_at then 'GUIDE_UPDATED'
        else 'CONFIGURED' end,
      case when old_row.id is null then null else to_jsonb(old_row) end,to_jsonb(new_row));
  return new_row.id;
end;
$$;

revoke all on table public.billing_portal_deadline_rules,public.billing_portal_submissions,
  public.billing_portal_submission_events from public,anon,authenticated;
grant all on table public.billing_portal_deadline_rules,public.billing_portal_submissions,
  public.billing_portal_submission_events to service_role;
alter table public.billing_portal_deadline_rules enable row level security;
alter table public.billing_portal_submissions enable row level security;
alter table public.billing_portal_submission_events enable row level security;
revoke all on function public.save_billing_portal_rule(bigint,jsonb),
 public.save_billing_portal_submission(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_billing_portal_rule(bigint,jsonb),
 public.save_billing_portal_submission(bigint,jsonb) to service_role;
