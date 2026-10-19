-- RN Integra: mês fechado pode ser desbloqueado com reautenticação do Gerente Geral
-- no servidor. Os snapshots antigos permanecem imutáveis. Esta migration
-- NÃO bloqueia lançamentos retroativos de NF, pagamento ou glosa.

create table public.billing_monthly_closing_events(
  event_number bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  billing_entity_id uuid not null references public.billing_entities(id),
  competence_month date not null,
  event_type text not null check(event_type in ('UNLOCKED','CLOSED')),
  snapshot jsonb,
  snapshot_checksum text,
  notes text,
  actor_id bigint not null references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  check(extract(day from competence_month)=1),
  check(length(coalesce(notes,''))<=2000),
  check((event_type='CLOSED' and snapshot is not null and snapshot_checksum is not null)
       or (event_type='UNLOCKED' and snapshot is null and snapshot_checksum is null))
);
create index billing_monthly_closing_events_entity_month
 on public.billing_monthly_closing_events(billing_entity_id,competence_month,event_number desc);
alter table public.billing_monthly_closing_events enable row level security;
revoke all on table public.billing_monthly_closing_events from public,anon,authenticated;
grant select,insert on public.billing_monthly_closing_events to service_role;
create trigger billing_monthly_closing_events_immutable
 before update or delete on public.billing_monthly_closing_events
 for each row execute function public.guard_billing_monthly_closing_immutable();

create or replace function public.get_billing_month_closing(
 p_actor bigint,p_entity uuid,p_month text)
returns jsonb language plpgsql stable set search_path to ''
as $$
declare
 snap jsonb;
 original public.billing_monthly_closings%rowtype;
 latest public.billing_monthly_closing_events%rowtype;
 saved_snapshot jsonb;
 saved_id uuid;
 saved_at timestamptz;
 saved_by bigint;
 saved_notes text;
 saved_checksum text;
 is_closed boolean;
 revisions jsonb;
begin
 snap:=public.preview_billing_month(p_actor,p_entity,p_month);
 select * into original from public.billing_monthly_closings
  where billing_entity_id=p_entity and competence_month=(p_month||'-01')::date;
 select * into latest from public.billing_monthly_closing_events
  where billing_entity_id=p_entity and competence_month=(p_month||'-01')::date
  order by event_number desc limit 1;
 is_closed:=case when latest.id is not null then latest.event_type='CLOSED'
                  else original.id is not null end;
 if latest.id is not null and latest.event_type='CLOSED' then
   saved_snapshot:=latest.snapshot;saved_id:=latest.id;
   saved_at:=latest.created_at;saved_by:=latest.actor_id;
   saved_notes:=latest.notes;saved_checksum:=latest.snapshot_checksum;
 elsif original.id is not null then
   saved_snapshot:=original.snapshot;saved_id:=original.id;
   saved_at:=original.closed_at;saved_by:=original.closed_by;
   saved_notes:=original.notes;saved_checksum:=original.snapshot_checksum;
 end if;

 select coalesce(jsonb_agg(to_jsonb(h) order by h.version),'[]'::jsonb) into revisions from (
   select 0::bigint version,o.id,o.closed_at date,o.closed_by actor_id,o.notes,
    'CLOSED'::text event_type
   from public.billing_monthly_closings o
   where o.billing_entity_id=p_entity and o.competence_month=(p_month||'-01')::date
   union all
   select e.event_number,e.id,e.created_at,e.actor_id,e.notes,e.event_type
   from public.billing_monthly_closing_events e
   where e.billing_entity_id=p_entity and e.competence_month=(p_month||'-01')::date
 ) h;
 return jsonb_build_object(
  'current',snap,'closed',is_closed,
  'unlocked',latest.id is not null and latest.event_type='UNLOCKED',
  'history',revisions,
  'closing',case when saved_snapshot is null then null else jsonb_build_object(
    'id',saved_id,'snapshot',saved_snapshot,'closed_at',saved_at,
    'closed_by',saved_by,'notes',saved_notes,
    'changed_since_close',md5(snap::text)<>saved_checksum) end
 );
end;
$$;

create or replace function public.unlock_billing_month(
 p_actor bigint,p_entity uuid,p_month text,p_reason text)
returns uuid language plpgsql set search_path to ''
as $$
declare
 first_day date;
 latest public.billing_monthly_closing_events%rowtype;
 event_id uuid;
begin
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then
   raise exception 'Somente o Gerente Geral pode desbloquear';
 end if;
 if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
   raise exception 'Competência inválida';
 end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 2000 then
   raise exception 'Justifique o desbloqueio (mínimo 5 caracteres)';
 end if;
 first_day:=(p_month||'-01')::date;
 perform pg_advisory_xact_lock(hashtext(p_entity::text||p_month)::bigint);
 select * into latest from public.billing_monthly_closing_events
   where billing_entity_id=p_entity and competence_month=first_day
   order by event_number desc limit 1;
 if latest.id is not null then
   if latest.event_type<>'CLOSED' then raise exception 'Competência já desbloqueada';end if;
 elsif not exists(select 1 from public.billing_monthly_closings
   where billing_entity_id=p_entity and competence_month=first_day) then
   raise exception 'A competência ainda não foi fechada';
 end if;
 insert into public.billing_monthly_closing_events(
   billing_entity_id,competence_month,event_type,notes,actor_id)
 values(p_entity,first_day,'UNLOCKED',trim(p_reason),p_actor)
 returning id into event_id;
 return event_id;
end;
$$;

create or replace function public.close_billing_month(
 p_actor bigint,p_entity uuid,p_month text,p_notes text default null)
returns uuid language plpgsql set search_path to ''
as $$
declare
 first_day date;
 snapshot_data jsonb;
 saved_id uuid;
 latest public.billing_monthly_closing_events%rowtype;
begin
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then
  raise exception 'Somente a gerência pode fechar uma competência';
 end if;
 if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
  raise exception 'Competência inválida';
 end if;
 first_day:=(p_month||'-01')::date;
 if first_day>=date_trunc('month',timezone('America/Sao_Paulo',now()))::date then
  raise exception 'A competência atual ou futura não pode ser encerrada';
 end if;
 if length(coalesce(p_notes,''))>2000 then raise exception 'Observação muito longa';end if;

 perform pg_advisory_xact_lock(hashtext(p_entity::text||p_month)::bigint);
 select * into latest from public.billing_monthly_closing_events
  where billing_entity_id=p_entity and competence_month=first_day
  order by event_number desc limit 1;
 if latest.id is not null then
  if latest.event_type<>'UNLOCKED' then raise exception 'Competência bloqueada. Desbloqueie com a senha do Gerente Geral';end if;
 elsif exists(select 1 from public.billing_monthly_closings
   where billing_entity_id=p_entity and competence_month=first_day) then
  raise exception 'Competência bloqueada. Desbloqueie com a senha do Gerente Geral';
 end if;

 snapshot_data:=public.preview_billing_month(p_actor,p_entity,p_month);
 if coalesce((snapshot_data->'cash'->>'insurance_paid_invoices_without_net')::integer,0)>0
    or coalesce((snapshot_data->'issued_invoices'->>'without_net_amount')::integer,0)>0 then
   raise exception 'Existem NFs sem valor líquido identificado. Revise antes de fechar';
 end if;
 if latest.id is not null then
  insert into public.billing_monthly_closing_events(
    billing_entity_id,competence_month,event_type,snapshot,snapshot_checksum,notes,actor_id)
  values(p_entity,first_day,'CLOSED',snapshot_data,md5(snapshot_data::text),
    nullif(trim(p_notes),''),p_actor) returning id into saved_id;
 else
  insert into public.billing_monthly_closings(
    billing_entity_id,competence_month,snapshot,snapshot_checksum,notes,closed_by)
  values(p_entity,first_day,snapshot_data,md5(snapshot_data::text),
     nullif(trim(p_notes),''),p_actor) returning id into saved_id;
 end if;
 return saved_id;
end;
$$;

revoke all on function public.unlock_billing_month(bigint,uuid,text,text) from public,anon,authenticated;
grant execute on function public.unlock_billing_month(bigint,uuid,text,text) to service_role;
