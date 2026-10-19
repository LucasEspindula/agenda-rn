-- Auditoria centralizada do fechamento, sem expor snapshots clínicos nos logs.
-- O histórico mensal original permanece imutável e os registros financeiros não mudam.
create or replace function public.log_monthly_financial_action()
returns trigger language plpgsql set search_path to ''
as $$
declare
  operator public.users%rowtype;
  entity_name text;
  operation_id uuid:=gen_random_uuid();
  operation_kind text;
  operation_at timestamptz;
  month date;
  entity uuid;
  actor bigint;
  reason text;
  payload jsonb;
begin
  if tg_table_name='billing_monthly_closings' then
    actor:=new.closed_by;
    month:=new.competence_month;
    entity:=new.billing_entity_id;
    reason:=new.notes;
    operation_at:=new.closed_at;
    operation_kind:='monthly_closing';
  else
    actor:=new.actor_id;
    month:=new.competence_month;
    entity:=new.billing_entity_id;
    reason:=new.notes;
    operation_at:=new.created_at;
    operation_kind:=case when new.event_type='UNLOCKED' then 'monthly_unlock'
      else 'monthly_closing' end;
  end if;
  select * into operator from public.users where id=actor;
  if operator.id is null then raise exception 'Responsável pelo fechamento inválido';end if;
  select coalesce(nullif(e.trade_name,''),e.name) into entity_name
  from public.billing_entities e where e.id=entity;
  payload:=jsonb_build_object(
    'event_type',case when operation_kind='monthly_unlock' then 'UNLOCKED' else 'CLOSED' end,
    'billing_entity_id',entity,'entity_name',coalesce(entity_name,'Entidade histórica'),
    'competence_month',month,'notes',reason,
    'event_id',new.id
  );
  insert into public.financial_logs(id,actor_id,actor_name,actor_email,kind,record_id,created_at)
  values(operation_id,operator.id,coalesce(nullif(operator.name,''),operator.email),
   operator.email,operation_kind,entity::text||':'||month::text,operation_at);
  insert into public.financial_log_changes(
    log_id,record_type,record_id,action,before_data,after_data)
  values(operation_id,'billing_monthly_closing',entity::text||':'||month::text,
    'INSERT',null,payload);
  return new;
end;
$$;
create trigger billing_monthly_closings_financial_log
after insert on public.billing_monthly_closings
for each row execute function public.log_monthly_financial_action();
create trigger billing_monthly_closing_events_financial_log
after insert on public.billing_monthly_closing_events
for each row execute function public.log_monthly_financial_action();

-- Registrar fechamentos antigos que ainda não constem na auditoria financeira.
-- Não altera os fechamentos, só acrescenta seu rastro identificável.
insert into public.financial_logs(id,actor_id,actor_name,actor_email,kind,record_id,created_at)
select gen_random_uuid(),o.closed_by,coalesce(nullif(u.name,''),u.email),
 u.email,'monthly_closing',o.billing_entity_id::text||':'||o.competence_month::text,o.closed_at
from public.billing_monthly_closings o
join public.users u on u.id=o.closed_by
where not exists (
 select 1 from public.financial_logs fl
 where fl.kind='monthly_closing' and fl.created_at=o.closed_at
   and fl.record_id=o.billing_entity_id::text||':'||o.competence_month::text
);
insert into public.financial_log_changes(log_id,record_type,record_id,action,before_data,after_data)
select fl.id,'billing_monthly_closing',fl.record_id,'INSERT',null,
 jsonb_build_object('event_type','CLOSED','billing_entity_id',o.billing_entity_id,
 'entity_name',coalesce(nullif(e.trade_name,''),e.name),
 'competence_month',o.competence_month,'notes',o.notes,'event_id',o.id)
from public.billing_monthly_closings o
join public.billing_entities e on e.id=o.billing_entity_id
join public.financial_logs fl on fl.kind='monthly_closing'
 and fl.record_id=o.billing_entity_id::text||':'||o.competence_month::text
 and fl.created_at=o.closed_at
where not exists(select 1 from public.financial_log_changes c
 where c.log_id=fl.id and c.record_type='billing_monthly_closing');
