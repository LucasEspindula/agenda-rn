-- Additive domain expansion. Existing IDs and financial sources remain intact.
alter table public.doctors add column scheduling_enabled boolean not null default true;
alter table public.doctors add column billing_enabled boolean not null default true;
alter table public.doctors add column invoice_enabled boolean not null default true;

create table public.attendances(
 id text primary key default gen_random_uuid()::text,
 appointment_id text unique,
 origin text not null check(origin in ('AGENDA','FATURAMENTO_MANUAL','FISCAL_MANUAL')),
 patient_id text,
 doctor_id text not null references public.doctors(id),
 date date not null,
 procedure text not null,
 insurance text not null default '',
 billing_method text check(billing_method in ('PARTICULAR','CONVENIO')),
 status text not null default 'realized',
 billing_entity_id uuid references public.billing_entities(id),
 created_at timestamptz,created_by bigint references public.users(id),
 updated_at timestamptz,updated_by bigint references public.users(id),
 check((origin='AGENDA' and appointment_id is not null) or (origin<>'AGENDA' and appointment_id is null))
);
alter table public.billing_records alter column appointment_id drop not null;
alter table public.billing_records add column attendance_id text references public.attendances(id);
alter table public.billing_records add column settlement_mode text not null default 'INVOICE' check(settlement_mode in ('DIRECT','INVOICE'));
update public.billing_records set settlement_mode='DIRECT' where billing_method='PARTICULAR';

-- Existing appointment IDs remain the attendance IDs; manual IDs never enter app_state.appointments.
insert into public.attendances(id,appointment_id,origin,patient_id,doctor_id,date,procedure,insurance,billing_method,status,billing_entity_id)
select a->>'id',a->>'id','AGENDA',nullif(a->>'patientId',''),coalesce(nullif(a->>'doctorId',''),a->>'anesthetistId'),(a->>'date')::date,coalesce(a->>'procedure','Procedimento'),coalesce(nullif(a->>'insurance',''),p->>'insurance',''),public.appointment_billing_method(a,b.billing_method),coalesce(a->>'status','realized'),b.billing_entity_id
from public.app_state s cross join lateral jsonb_array_elements(coalesce(s.payload->'appointments','[]')||coalesce(s.payload->'cancelledAppointments','[]')) a
left join lateral (select value p from jsonb_array_elements(coalesce(s.payload->'patients','[]')) where value->>'id'=a->>'patientId' limit 1) pt on true
left join public.billing_records b on b.appointment_id=a->>'id'
where s.id=1 and (a->>'status'='realized' or b.id is not null);
-- Prefer an unambiguous receiving doctor when the historic bill belongs to the anesthetist.
update public.attendances t set doctor_id=x.doctor_id from (
 select t.id,min(l.doctor_id) doctor_id from public.attendances t join public.app_state s on s.id=1
 cross join lateral jsonb_array_elements(coalesce(s.payload->'appointments','[]')||coalesce(s.payload->'cancelledAppointments','[]')) a
 join public.billing_doctor_entities l on l.billing_entity_id=t.billing_entity_id and l.doctor_id in(a->>'doctorId',a->>'anesthetistId')
 where a->>'id'=t.appointment_id group by t.id having count(distinct l.doctor_id)=1
) x where t.id=x.id;
update public.billing_records b set attendance_id=t.id from public.attendances t where t.appointment_id=b.appointment_id;
do $$begin if exists(select 1 from public.billing_records where attendance_id is null) then raise exception 'Faturamento órfão: revisar antes de migrar'; end if;end;$$;
alter table public.billing_records alter column attendance_id set not null;
create unique index billing_attendance_unique on public.billing_records(attendance_id);

create table public.company_associates(
 id uuid primary key default gen_random_uuid(),billing_entity_id uuid not null references public.billing_entities(id),
 name text not null check(length(trim(name)) between 2 and 160),doctor_id text references public.doctors(id),active boolean not null default true,
 created_at timestamptz,created_by bigint references public.users(id),updated_at timestamptz,updated_by bigint references public.users(id),
 unique(id,billing_entity_id)
);
create unique index associate_doctor_unique on public.company_associates(billing_entity_id,doctor_id) where doctor_id is not null;
create table public.company_expenses(
 id uuid primary key default gen_random_uuid(),billing_entity_id uuid not null references public.billing_entities(id),
 description text not null check(length(trim(description)) between 2 and 500),category text not null default '',supplier text not null default '',
 competence_date date not null,due_date date,paid_at date,amount numeric(12,2) not null check(amount>=0 and amount<=9999999999.99),
 status text not null check(status in ('PENDENTE','PAGO')),notes text,paid_by_associate_id uuid,
 created_at timestamptz,created_by bigint references public.users(id),updated_at timestamptz,updated_by bigint references public.users(id),
 foreign key(paid_by_associate_id,billing_entity_id) references public.company_associates(id,billing_entity_id),
 check(status<>'PAGO' or (paid_at is not null and paid_by_associate_id is not null))
);
create table public.financial_logs(
 id uuid primary key,actor_id bigint references public.users(id),actor_name text not null,actor_email text,
 kind text not null,record_id text,created_at timestamptz not null default clock_timestamp()
);
create table public.financial_log_changes(
 id bigint generated always as identity primary key,log_id uuid not null references public.financial_logs(id),
 record_type text not null,record_id text not null,action text not null,before_data jsonb,after_data jsonb
);
create index financial_logs_period on public.financial_logs(created_at desc);
create index financial_changes_event on public.financial_log_changes(log_id,id);
create index attendance_doctor_date on public.attendances(doctor_id,date);
create index expenses_entity_payment on public.company_expenses(billing_entity_id,paid_at);

do $$declare t text;begin
 foreach t in array array['billing_records','invoices','invoice_billing_records','billing_entities','billing_doctor_entities','doctors'] loop
  execute format('alter table public.%I add column if not exists created_at timestamptz',t);
  execute format('alter table public.%I add column if not exists created_by bigint references public.users(id)',t);
  execute format('alter table public.%I add column if not exists updated_at timestamptz',t);
  execute format('alter table public.%I add column if not exists updated_by bigint references public.users(id)',t);
 end loop;
 foreach t in array array['attendances','company_associates','company_expenses','financial_logs','financial_log_changes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert on public.%I to service_role',t);
 end loop;
end;$$;
grant update on public.attendances,public.company_associates,public.company_expenses to service_role;
grant usage,select on sequence public.financial_log_changes_id_seq to service_role;
revoke update,delete,truncate on public.financial_logs,public.financial_log_changes from service_role;

create function public.financial_operation(p_actor bigint,p_kind text,p_id text) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.users where id=p_actor and role in ('general_manager','secretary','doctor')) then raise exception 'Acesso negado';end if;
 perform set_config('rn.actor',p_actor::text,true);perform set_config('rn.operation',gen_random_uuid()::text,true);
 perform set_config('rn.kind',p_kind,true);perform set_config('rn.record',coalesce(p_id,''),true);
end;$$;
create function public.financial_stamp() returns trigger language plpgsql security invoker set search_path='' as $$
declare actor bigint:=nullif(current_setting('rn.actor',true),'')::bigint;
begin
 if actor is null then raise exception 'Alteração financeira exige autoria';end if;
 if tg_op='INSERT' then new.created_by:=actor;new.created_at:=clock_timestamp();else new.created_by:=old.created_by;new.created_at:=old.created_at;end if;
 new.updated_by:=actor;new.updated_at:=clock_timestamp();return new;
end;$$;
create function public.financial_log_snapshot(v jsonb) returns jsonb language sql stable security invoker set search_path='' as $$
 select case when v is null then null else v||jsonb_build_object('_labels',jsonb_strip_nulls(jsonb_build_object(
 'doctor_id',(select name from public.doctors where id=v->>'doctor_id'),
 'billing_entity_id',(select name from public.billing_entities where id::text=v->>'billing_entity_id'),
 'paid_by_associate_id',(select name from public.company_associates where id::text=v->>'paid_by_associate_id'),
 'invoice_id',(select invoice_number from public.invoices where id::text=v->>'invoice_id'),
 'patient_id',(select p->>'name' from public.app_state s cross join lateral jsonb_array_elements(coalesce(s.payload->'patients','[]')) p where s.id=1 and p->>'id'=v->>'patient_id' limit 1)
 ))) end
$$;
create function public.financial_log_change() returns trigger language plpgsql security invoker set search_path='' as $$
declare actor public.users%rowtype;op uuid:=nullif(current_setting('rn.operation',true),'')::uuid;before_value jsonb;after_value jsonb;rid text;
begin
 if op is null then raise exception 'Alteração financeira exige log';end if;
 select * into actor from public.users where id=nullif(current_setting('rn.actor',true),'')::bigint;
 if actor.id is null then raise exception 'Autor inválido';end if;
 before_value:=case when tg_op<>'INSERT' then to_jsonb(old)-'details' end;after_value:=case when tg_op<>'DELETE' then to_jsonb(new)-'details' end;
 if tg_op='UPDATE' and (before_value-'updated_by'-'updated_at')=(after_value-'updated_by'-'updated_at') then return new;end if;
 rid:=coalesce(after_value->>'id',before_value->>'id');
 before_value:=public.financial_log_snapshot(before_value);after_value:=public.financial_log_snapshot(after_value);
 insert into public.financial_logs(id,actor_id,actor_name,actor_email,kind,record_id) values(op,actor.id,coalesce(nullif(actor.name,''),actor.email,'Não informado'),actor.email,current_setting('rn.kind'),nullif(current_setting('rn.record'),'')) on conflict(id) do nothing;
 insert into public.financial_log_changes(log_id,record_type,record_id,action,before_data,after_data) values(op,tg_table_name,rid,tg_op,before_value,after_value);
 return coalesce(new,old);
end;$$;
create function public.immutable_financial_log() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Logs de faturamento são imutáveis';end;$$;
create trigger immutable_log before update or delete or truncate on public.financial_logs for each statement execute function public.immutable_financial_log();
create trigger immutable_log before update or delete or truncate on public.financial_log_changes for each statement execute function public.immutable_financial_log();
-- Triggers installed after compatibility backfills and function replacements below.
