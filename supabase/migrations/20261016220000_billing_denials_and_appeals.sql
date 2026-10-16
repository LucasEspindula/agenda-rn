-- RN Integra · Etapa 3 · Glosas de convênio por cobrança profissional.
-- Depende de 20261016120000_independent_professional_billing.sql.
-- NÃO aplicar sem homologação das migrations anteriores e deste fluxo.
-- Glosa, recurso, decisão e recuperação NÃO quitam cobranças ou NFs.

create table public.billing_denial_cases (
 id uuid primary key default gen_random_uuid(),
 billing_record_id uuid not null references public.billing_records(id),
 billing_entity_id uuid not null references public.billing_entities(id),
 denied_on date not null,
 denied_amount numeric(14,2) not null check(denied_amount>0),
 recovered_amount numeric(14,2) not null default 0 check(recovered_amount>=0 and recovered_amount<=denied_amount),
 reason text not null check(length(trim(reason)) between 5 and 2000),
 payer_reference text,
 notes text,
 status text not null default 'OPEN'
   check(status in ('OPEN','APPEALED','DECIDED','PARTIAL','RECOVERED','CLOSED')),
 closed_at timestamptz,
 closed_by bigint references public.users(id),
 closing_reason text,
 created_at timestamptz not null default clock_timestamp(),
 created_by bigint not null references public.users(id),
 updated_at timestamptz not null default clock_timestamp(),
 updated_by bigint not null references public.users(id),
 check((status='CLOSED')=(closed_at is not null)),
 check((status<>'CLOSED')=(closed_by is null and closing_reason is null))
);
create index billing_denial_cases_record on public.billing_denial_cases(billing_record_id,created_at desc);
create index billing_denial_cases_entity on public.billing_denial_cases(billing_entity_id,status,denied_on);

create table public.billing_denial_appeals (
 id uuid primary key default gen_random_uuid(),
 denial_id uuid not null references public.billing_denial_cases(id),
 filed_on date not null,
 appealed_amount numeric(14,2) not null check(appealed_amount>0),
 protocol text not null check(length(trim(protocol)) between 3 and 120),
 notes text,
 decision text not null default 'PENDING' check(decision in ('PENDING','ACCEPTED','PARTIAL','REJECTED')),
 decision_on date,
 approved_amount numeric(14,2) not null default 0
    check(approved_amount>=0 and approved_amount<=appealed_amount),
 decision_notes text,
 created_at timestamptz not null default clock_timestamp(),
 created_by bigint not null references public.users(id),
 decided_by bigint references public.users(id),
 check((decision='PENDING' and decision_on is null and decided_by is null and approved_amount=0) or
       (decision<>'PENDING' and decision_on is not null and decided_by is not null)),
 check((decision='ACCEPTED' and approved_amount=appealed_amount) or
       (decision='PARTIAL' and approved_amount>0 and approved_amount<appealed_amount) or
       (decision='REJECTED' and approved_amount=0) or (decision='PENDING'))
);
create index billing_denial_appeals_case on public.billing_denial_appeals(denial_id,filed_on,id);

-- Recuperação registrada neste módulo é controle operacional de recurso.
-- Não é uma segunda entrada de caixa: o faturamento e a NF permanecem fontes de verdade.
create table public.billing_denial_recoveries (
 id uuid primary key default gen_random_uuid(),
 denial_id uuid not null references public.billing_denial_cases(id),
 appeal_id uuid not null references public.billing_denial_appeals(id),
 recovered_on date not null,
 amount numeric(14,2) not null check(amount>0),
 receipt_reference text not null check(length(trim(receipt_reference)) between 3 and 120),
 notes text,
 created_at timestamptz not null default clock_timestamp(),
 created_by bigint not null references public.users(id)
);
create index billing_denial_recoveries_case on public.billing_denial_recoveries(denial_id,recovered_on,id);

create table public.billing_denial_events (
 id uuid primary key default gen_random_uuid(),
 denial_id uuid not null references public.billing_denial_cases(id),
 actor_id bigint not null references public.users(id),
 event_type text not null check(event_type in ('OPENED','APPEAL_FILED','APPEAL_DECIDED','RECOVERY_RECORDED','CLOSED')),
 before_snapshot jsonb,
 after_snapshot jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index billing_denial_events_history on public.billing_denial_events(denial_id,created_at,id);

create or replace function public.save_billing_denial(p_actor bigint,p_data jsonb)
returns uuid language plpgsql set search_path to ''
as $$
declare
 actor_role text;
 act text:=p_data->>'action';
 charge public.billing_records%rowtype;
 attendance public.attendances%rowtype;
 case_row public.billing_denial_cases%rowtype;
 appeal_row public.billing_denial_appeals%rowtype;
 result_id uuid;
 old_snapshot jsonb;
 event_name text;
 value_amount numeric(14,2);
 action_date date;
 note_value text:=nullif(trim(p_data->>'notes'),'');
begin
 select role into actor_role from public.users where id=p_actor;
 if actor_role is null or actor_role not in ('general_manager','secretary')
    then raise exception 'Sem permissão para gerir glosas';end if;
 if act not in ('OPEN_CASE','FILE_APPEAL','DECIDE_APPEAL','REGISTER_RECOVERY','CLOSE_CASE')
    then raise exception 'Ação de glosa inválida';end if;
 if length(coalesce(note_value,''))>2000 then raise exception 'Observação muito longa';end if;

 if act='OPEN_CASE' then
   select * into charge from public.billing_records
    where id=nullif(p_data->>'billing_record_id','')::uuid;
 else
   select * into case_row from public.billing_denial_cases
    where id=nullif(p_data->>'denial_id','')::uuid for update;
   if not found then raise exception 'Glosa inexistente';end if;
   if case_row.updated_at is distinct from nullif(p_data->>'updated_at','')::timestamptz
     then raise exception 'Glosa alterada. Atualize a página';end if;
   select * into charge from public.billing_records where id=case_row.billing_record_id;
 end if;
 if charge.id is null or charge.professional_id is null or charge.billing_method<>'CONVENIO'
    then raise exception 'Glosa exige cobrança profissional de convênio';end if;
 select * into attendance from public.attendances where id=charge.attendance_id;
 if attendance.id is null or attendance.status<>'realized'
    then raise exception 'Atendimento não realizado';end if;
 if actor_role='secretary' and not exists(select 1 from public.agenda_access a
    where a.user_id=p_actor and a.professional_id=charge.professional_id)
    then raise exception 'Sem acesso à agenda deste profissional';end if;
 if act<>'OPEN_CASE' and (case_row.billing_entity_id is distinct from charge.billing_entity_id)
    then raise exception 'Entidade financeira histórica divergente';end if;
 if act<>'OPEN_CASE' and case_row.status='CLOSED'
    then raise exception 'Glosa encerrada. Abra nova ocorrência para registro adicional';end if;
 old_snapshot:=case when act='OPEN_CASE' then null else to_jsonb(case_row) end;

 if act='OPEN_CASE' then
   action_date:=nullif(p_data->>'denied_on','')::date;
   value_amount:=nullif(p_data->>'denied_amount','')::numeric;
   if action_date is null or action_date<attendance.date or action_date>current_date
      or value_amount is null or value_amount<=0 or value_amount>999999999999.99
      or length(trim(coalesce(p_data->>'reason',''))) not between 5 and 2000
      or length(coalesce(p_data->>'payer_reference',''))>120
      then raise exception 'Informe data, valor e motivo válidos para a glosa';end if;
   insert into public.billing_denial_cases(
      billing_record_id,billing_entity_id,denied_on,denied_amount,reason,payer_reference,
      notes,created_by,updated_by)
   values(charge.id,charge.billing_entity_id,action_date,value_amount,
      trim(p_data->>'reason'),nullif(trim(p_data->>'payer_reference'),''),
      note_value,p_actor,p_actor) returning * into case_row;
   event_name:='OPENED';

 elsif act='FILE_APPEAL' then
   action_date:=nullif(p_data->>'filed_on','')::date;
   value_amount:=nullif(p_data->>'appealed_amount','')::numeric;
   if action_date is null or action_date<case_row.denied_on or action_date>current_date
     or value_amount is null or value_amount<=0 or value_amount>case_row.denied_amount
     or length(trim(coalesce(p_data->>'protocol',''))) not between 3 and 120
   then raise exception 'Informe data, valor e protocolo do recurso válidos';end if;
   if exists(select 1 from public.billing_denial_appeals where denial_id=case_row.id and decision='PENDING')
   then raise exception 'Já existe recurso aguardando decisão';end if;
   insert into public.billing_denial_appeals(
      denial_id,filed_on,appealed_amount,protocol,notes,created_by)
   values(case_row.id,action_date,value_amount,trim(p_data->>'protocol'),note_value,p_actor)
   returning * into appeal_row;
   update public.billing_denial_cases set status='APPEALED',
      updated_at=clock_timestamp(),updated_by=p_actor where id=case_row.id;
   event_name:='APPEAL_FILED';

 elsif act='DECIDE_APPEAL' then
   select * into appeal_row from public.billing_denial_appeals
     where id=nullif(p_data->>'appeal_id','')::uuid and denial_id=case_row.id for update;
   if appeal_row.id is null or appeal_row.decision<>'PENDING'
      then raise exception 'Recurso não está pendente';end if;
   action_date:=nullif(p_data->>'decision_on','')::date;
   value_amount:=coalesce(nullif(p_data->>'approved_amount','')::numeric,0);
   if p_data->>'decision' not in ('ACCEPTED','PARTIAL','REJECTED')
     or action_date is null or action_date<appeal_row.filed_on or action_date>current_date
     or value_amount<0 or value_amount>appeal_row.appealed_amount
     or (p_data->>'decision'='ACCEPTED' and value_amount<>appeal_row.appealed_amount)
     or (p_data->>'decision'='PARTIAL' and (value_amount<=0 or value_amount>=appeal_row.appealed_amount))
     or (p_data->>'decision'='REJECTED' and value_amount<>0)
   then raise exception 'Decisão ou valor deferido incompatível com o recurso';end if;
   update public.billing_denial_appeals set decision=p_data->>'decision',
     decision_on=action_date,approved_amount=value_amount,
     decision_notes=note_value,decided_by=p_actor where id=appeal_row.id
     returning * into appeal_row;
   update public.billing_denial_cases set status=case when recovered_amount>0 then 'PARTIAL' else 'DECIDED' end,
     updated_at=clock_timestamp(),updated_by=p_actor where id=case_row.id;
   event_name:='APPEAL_DECIDED';

 elsif act='REGISTER_RECOVERY' then
   select * into appeal_row from public.billing_denial_appeals
     where id=nullif(p_data->>'appeal_id','')::uuid and denial_id=case_row.id for update;
   action_date:=nullif(p_data->>'recovered_on','')::date;
   value_amount:=nullif(p_data->>'amount','')::numeric;
   if appeal_row.id is null or appeal_row.decision not in ('ACCEPTED','PARTIAL')
     or action_date is null or action_date<appeal_row.decision_on or action_date>current_date
     or value_amount is null or value_amount<=0
     or length(trim(coalesce(p_data->>'receipt_reference',''))) not between 3 and 120
     or case_row.recovered_amount+value_amount>case_row.denied_amount
     or value_amount+(select coalesce(sum(amount),0) from public.billing_denial_recoveries
                       where appeal_id=appeal_row.id)>appeal_row.approved_amount
   then raise exception 'Recuperação excede o deferimento ou faltam comprovantes';end if;
   insert into public.billing_denial_recoveries(
      denial_id,appeal_id,recovered_on,amount,receipt_reference,notes,created_by)
   values(case_row.id,appeal_row.id,action_date,value_amount,
      trim(p_data->>'receipt_reference'),note_value,p_actor);
   update public.billing_denial_cases set recovered_amount=recovered_amount+value_amount,
     status=case when recovered_amount+value_amount=denied_amount then 'RECOVERED' else 'PARTIAL' end,
     updated_at=clock_timestamp(),updated_by=p_actor where id=case_row.id;
   event_name:='RECOVERY_RECORDED';

 elsif act='CLOSE_CASE' then
   if length(trim(coalesce(p_data->>'closing_reason',''))) not between 5 and 1000
     then raise exception 'Informe o motivo do encerramento';end if;
   if exists(select 1 from public.billing_denial_appeals where denial_id=case_row.id and decision='PENDING')
     then raise exception 'Resolva o recurso pendente antes de encerrar';end if;
   update public.billing_denial_cases set status='CLOSED',closed_at=clock_timestamp(),
     closed_by=p_actor,closing_reason=trim(p_data->>'closing_reason'),
     updated_at=clock_timestamp(),updated_by=p_actor where id=case_row.id;
   event_name:='CLOSED';
 end if;

 select * into case_row from public.billing_denial_cases where id=case_row.id;
 result_id:=case_row.id;
 insert into public.billing_denial_events(denial_id,actor_id,event_type,before_snapshot,after_snapshot)
 values(result_id,p_actor,event_name,old_snapshot,
   jsonb_build_object('case',to_jsonb(case_row),
     'appeal',case when appeal_row.id is null then null else to_jsonb(appeal_row) end,
     'payload',p_data));
 return result_id;
end;
$$;

revoke all on table public.billing_denial_cases,public.billing_denial_appeals,
 public.billing_denial_recoveries,public.billing_denial_events from public,anon,authenticated;
grant all on table public.billing_denial_cases,public.billing_denial_appeals,
 public.billing_denial_recoveries,public.billing_denial_events to service_role;
alter table public.billing_denial_cases enable row level security;
alter table public.billing_denial_appeals enable row level security;
alter table public.billing_denial_recoveries enable row level security;
alter table public.billing_denial_events enable row level security;
revoke all on function public.save_billing_denial(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_billing_denial(bigint,jsonb) to service_role;
