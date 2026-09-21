-- RN Integra: independent services, attendances, audit and company finance.
-- Source: next-stage.sql
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


-- Source: next-stage-attendance.sql
create function public.financial_attendance(p_id text) returns jsonb language sql stable security invoker set search_path='' as $$
 select to_jsonb(t)||jsonb_build_object('doctorId',t.doctor_id,'patientId',t.patient_id,'forma_cobranca',t.billing_method) from public.attendances t where t.id=p_id
$$;

-- Resolve the financial owner once, when a real agenda occurrence first enters finance.
-- Existing records keep their owner, including after changes to company links.
create function public.attribute_financial_attendance(p_id text,p_entity uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.attendances%rowtype;alternate text;
begin
 select * into t from public.attendances where id=p_id;
 if t.id is null then return null;end if;
 if t.appointment_id is not null and not exists(select 1 from public.billing_records where attendance_id=t.id)
 and not exists(select 1 from public.billing_doctor_entities where doctor_id=t.doctor_id and billing_entity_id=p_entity and active) then
  select a->>'anesthetistId' into alternate from public.app_state s cross join lateral jsonb_array_elements(coalesce(s.payload->'appointments','[]')) a where s.id=1 and a->>'id'=t.appointment_id;
  if alternate is not null and exists(select 1 from public.billing_doctor_entities where doctor_id=alternate and billing_entity_id=p_entity and active) then
   update public.attendances set doctor_id=alternate where id=t.id;
  end if;
 end if;
 return public.financial_attendance(p_id);
end;$$;

create function public.sync_financial_attendances() returns trigger language plpgsql security invoker set search_path='' as $$
declare a jsonb;patient jsonb;owner text;t public.attendances%rowtype;
begin
 for a in select value from jsonb_array_elements(coalesce(new.payload->'appointments','[]')||coalesce(new.payload->'cancelledAppointments','[]')) loop
  select * into t from public.attendances where appointment_id=a->>'id';
  if a->>'status'<>'realized' and t.id is null then continue;end if;
  select value into patient from jsonb_array_elements(coalesce(new.payload->'patients','[]')) where value->>'id'=a->>'patientId';
  owner:=coalesce(t.doctor_id,nullif(a->>'doctorId',''),a->>'anesthetistId');
  if t.id is null then
   insert into public.attendances(id,appointment_id,origin,patient_id,doctor_id,date,procedure,insurance,billing_method,status) values(a->>'id',a->>'id','AGENDA',nullif(a->>'patientId',''),owner,(a->>'date')::date,coalesce(a->>'procedure','Procedimento'),coalesce(nullif(a->>'insurance',''),patient->>'insurance',''),public.appointment_billing_method(a),a->>'status');
  elsif (t.patient_id,t.date,t.procedure,t.insurance,t.billing_method,t.status) is distinct from (nullif(a->>'patientId',''),(a->>'date')::date,coalesce(a->>'procedure','Procedimento'),coalesce(nullif(a->>'insurance',''),patient->>'insurance',''),public.appointment_billing_method(a,t.billing_method),a->>'status') then
   update public.attendances set patient_id=nullif(a->>'patientId',''),date=(a->>'date')::date,procedure=coalesce(a->>'procedure','Procedimento'),insurance=coalesce(nullif(a->>'insurance',''),patient->>'insurance',''),billing_method=public.appointment_billing_method(a,t.billing_method),status=a->>'status' where id=t.id;
  end if;
 end loop;
 return new;
end;$$;

create function public.save_manual_attendance(p_actor bigint,p_data jsonb) returns text language plpgsql security invoker set search_path='' as $$
declare sid text:=coalesce(nullif(p_data->>'id',''),gen_random_uuid()::text);old_row public.attendances%rowtype;d public.doctors%rowtype;entity uuid:=(p_data->>'billing_entity_id')::uuid;method text:=p_data->>'billing_method';patient text:=p_data->>'patient_id';
begin
 perform pg_advisory_xact_lock(194701,1);perform pg_advisory_xact_lock(194701,2);
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then raise exception 'Acesso restrito à gerência';end if;
 perform public.financial_operation(p_actor,'attendance',sid);
 select * into old_row from public.attendances where id=sid;
 if old_row.id is not null and (old_row.origin='AGENDA' or old_row.updated_at is distinct from (p_data->>'updated_at')::timestamptz) then raise exception 'Edite a origem correta ou atualize o atendimento';end if;
 if exists(select 1 from public.billing_records b join public.invoice_billing_records ib on ib.billing_record_id=b.id where b.attendance_id=sid) then raise exception 'Atendimento vinculado a NF não pode ter sua identificação alterada';end if;
 select * into d from public.doctors where id=p_data->>'doctor_id';
 if d.id is null or not d.active or not(d.billing_enabled or d.invoice_enabled) then raise exception 'Médico sem serviço financeiro/fiscal habilitado';end if;
 if method='CONVENIO' and not exists(select 1 from public.app_state s cross join lateral jsonb_array_elements(s.payload->'patients') p where public.billing_payer_key(p->>'insurance')=public.billing_payer_key(p_data->>'insurance') and nullif(p->>'insurance','') is not null) and not exists(select 1 from public.attendances where public.billing_payer_key(insurance)=public.billing_payer_key(p_data->>'insurance') and insurance<>'') then raise exception 'Selecione um convênio existente';end if;
 if nullif(patient,'') is null and length(trim(coalesce(p_data->>'patient_name','')))>=2 then
  if exists(select 1 from public.app_state s cross join lateral jsonb_array_elements(s.payload->'patients') p where s.id=1 and lower(trim(p->>'name'))=lower(trim(p_data->>'patient_name')) and p->>'doctorId'=d.id) then raise exception 'Paciente já cadastrado para este médico. Selecione o cadastro existente';end if;
  patient:=gen_random_uuid()::text;
  update public.app_state set payload=jsonb_set(payload,'{patients}',coalesce(payload->'patients','[]')||jsonb_build_array(jsonb_build_object('id',patient,'name',trim(p_data->>'patient_name'),'doctorId',d.id,'insurance',coalesce(p_data->>'insurance','')))),updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond') where id=1;
 end if;
 if not exists(select 1 from public.app_state s cross join lateral jsonb_array_elements(s.payload->'patients') p where s.id=1 and p->>'id'=patient) then raise exception 'Selecione um paciente existente';end if;
 if method is null or method not in ('PARTICULAR','CONVENIO') or nullif(trim(p_data->>'procedure'),'') is null or nullif(p_data->>'date','') is null then raise exception 'Preencha procedimento, data e forma de cobrança';end if;
 if not exists(select 1 from public.billing_doctor_entities l join public.billing_entities e on e.id=l.billing_entity_id where l.doctor_id=d.id and l.billing_entity_id=entity and l.active and e.active) and old_row.billing_entity_id is distinct from entity then raise exception 'Entidade não vinculada ao médico';end if;
 if entity is null then raise exception 'Selecione a entidade recebedora';end if;
 if exists(select 1 from public.billing_records where attendance_id=sid and payment_status='PAGO') then raise exception 'Atendimento pago: preserve sua identificação financeira';end if;
 insert into public.attendances(id,origin,patient_id,doctor_id,date,procedure,insurance,billing_method,status,billing_entity_id)
 values(sid,case when d.billing_enabled then 'FATURAMENTO_MANUAL' else 'FISCAL_MANUAL' end,patient,d.id,(p_data->>'date')::date,trim(p_data->>'procedure'),case when method='CONVENIO' then public.billing_payer_key(p_data->>'insurance') else '' end,method,'realized',entity)
 on conflict(id) do update set patient_id=excluded.patient_id,doctor_id=excluded.doctor_id,date=excluded.date,procedure=excluded.procedure,insurance=excluded.insurance,billing_method=excluded.billing_method,billing_entity_id=excluded.billing_entity_id;
 insert into public.billing_records(attendance_id,appointment_id,billing_entity_id,billing_method,payment_status,settlement_mode)
 values(sid,null,entity,method,'PENDENTE',case when method='PARTICULAR' or not d.invoice_enabled then 'DIRECT' else 'INVOICE' end)
 on conflict(attendance_id) do update set billing_entity_id=excluded.billing_entity_id,billing_method=excluded.billing_method,settlement_mode=excluded.settlement_mode,received_amount=null,paid_at=null,invoice_number=null;
 perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);return sid;
end;$$;


-- Source: next-stage-billing.sql
create or replace function public.save_billing(p_actor bigint,p_kind text,p_data jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare role_name text; sid uuid; old_row jsonb; result_row jsonb; state jsonb; a jsonb;
 entity uuid; item uuid; record public.billing_records%rowtype; old_items jsonb; appointment_ids jsonb; selected_records uuid[]:='{}'; appt_id text; payer_name text; before_records jsonb; old_record jsonb; before_item_values jsonb; amount_entry record; mode text; physician public.doctors%rowtype;
begin
 perform pg_advisory_xact_lock(194701,1);
 perform pg_advisory_xact_lock(194701,2);
 select role into role_name from public.users where id=p_actor;
 if role_name is null or role_name not in ('general_manager','secretary') then raise exception 'Acesso negado'; end if;
 if p_kind='record' then p_data:=p_data||jsonb_build_object('appointment_id',coalesce(p_data->>'attendance_id',p_data->>'appointment_id'));end if;
 if p_kind='invoice' and p_data ? 'attendance_ids' then p_data:=p_data||jsonb_build_object('appointment_ids',p_data->'attendance_ids');end if;
 select payload into state from public.app_state where id=1;
 sid:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
 perform public.financial_operation(p_actor,p_kind,sid::text);
 if p_kind in ('entity','link','delete_entity','delete_link') and role_name<>'general_manager' then raise exception 'Somente a gerência pode configurar entidades'; end if;
 if p_kind in ('delete_entity','delete_link') then
  if p_kind='delete_entity' then
   select to_jsonb(e) into old_row from public.billing_entities e where id=sid;
  else
   select to_jsonb(l) into old_row from public.billing_doctor_entities l where id=sid;
  end if;
  if old_row is null then raise exception 'Registro não encontrado'; end if;
  if (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Registro alterado. Atualize a página'; end if;
  if p_kind='delete_entity' then
   if exists(select 1 from public.billing_records where billing_entity_id=sid) or exists(select 1 from public.invoices where billing_entity_id=sid) or exists(select 1 from public.billing_doctor_entities where billing_entity_id=sid) then raise exception 'Entidade possui vínculos ou histórico financeiro. Inative-a para preservar o histórico'; end if;
   delete from public.billing_entities where id=sid;
  else
   delete from public.billing_doctor_entities where id=sid;
  end if;
 elsif p_kind='entity' then
  select to_jsonb(e) into old_row from public.billing_entities e where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Registro alterado por outro usuário. Atualize a página'; end if;
  if coalesce(p_data->>'person_type','') not in ('PF','PJ') or length(regexp_replace(coalesce(p_data->>'tax_id',''),'[^0-9]','','g'))<>(case when p_data->>'person_type'='PF' then 11 else 14 end) then raise exception 'Informe CPF/CNPJ e tipo de pessoa'; end if;
  insert into public.billing_entities(id,name,tax_id,person_type,trade_name,active,updated_at,updated_by)
  values(sid,trim(p_data->>'name'),regexp_replace(p_data->>'tax_id','[^0-9]','','g'),p_data->>'person_type',nullif(trim(p_data->>'trade_name'),''),coalesce((p_data->>'active')::boolean,true),clock_timestamp(),p_actor)
  on conflict(id) do update set name=excluded.name,tax_id=excluded.tax_id,person_type=excluded.person_type,trade_name=excluded.trade_name,active=excluded.active,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(billing_entities.*) into result_row;
 elsif p_kind='link' then
  select to_jsonb(l) into old_row from public.billing_doctor_entities l where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Vínculo alterado. Atualize a página'; end if;
  if not exists(select 1 from public.doctors where id=p_data->>'doctor_id') then raise exception 'Médico inexistente'; end if;
  if not exists(select 1 from public.billing_entities where id=(p_data->>'billing_entity_id')::uuid and active) then raise exception 'Entidade inativa ou inexistente'; end if;
  if exists(select 1 from public.billing_doctor_entities where doctor_id=p_data->>'doctor_id' and billing_entity_id=(p_data->>'billing_entity_id')::uuid and id<>sid) then raise exception 'Este vínculo já existe. Edite o vínculo cadastrado'; end if;
  insert into public.billing_doctor_entities(id,doctor_id,billing_entity_id,active,updated_at,updated_by)
  values(sid,p_data->>'doctor_id',(p_data->>'billing_entity_id')::uuid,coalesce((p_data->>'active')::boolean,true),clock_timestamp(),p_actor)
  on conflict(id) do update set active=excluded.active,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(billing_doctor_entities.*) into result_row;
 elsif p_kind='record' then
  a:=public.financial_attendance(p_data->>'appointment_id');
  if a is null then raise exception 'Atendimento inexistente'; end if;
  if role_name<>'general_manager' and not exists(select 1 from public.app_state s cross join lateral jsonb_array_elements(coalesce(s.payload->'appointments','[]')) clinical join public.agenda_access g on g.user_id=p_actor and g.professional_id in(clinical->>'doctorId',clinical->>'anesthetistId') where s.id=1 and clinical->>'id'=a->>'appointment_id') then raise exception 'Agenda sem permissão'; end if;
  select to_jsonb(b) into old_row from public.billing_records b where attendance_id=p_data->>'appointment_id';
  if old_row is not null then sid:=(old_row->>'id')::uuid; else sid:=gen_random_uuid(); end if;
  perform set_config('rn.record',sid::text,true);
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Financeiro alterado por outro usuário. Atualize'; end if;
  if exists(select 1 from public.invoice_billing_records where billing_record_id=sid) then raise exception 'Edite o pagamento e os dados fiscais na NF/lote vinculada'; end if;
  entity:=(p_data->>'billing_entity_id')::uuid;
  a:=public.attribute_financial_attendance(p_data->>'appointment_id',entity);
  if entity is null or (old_row->>'billing_entity_id' is distinct from entity::text and not exists(
   select 1 from public.billing_doctor_entities l join public.billing_entities e on e.id=l.billing_entity_id
   where l.billing_entity_id=entity and l.doctor_id in (a->>'doctorId',a->>'anesthetistId') and l.active and e.active
)) then raise exception 'Selecione uma entidade vinculada ao médico'; end if;
  if p_data->>'billing_method' not in ('PARTICULAR','CONVENIO') or p_data->>'payment_status' not in ('PENDENTE','PAGO') then raise exception 'Forma de cobrança ou status inválido'; end if;
  select * into physician from public.doctors where id=a->>'doctorId';
  if not physician.billing_enabled then raise exception 'Controle financeiro não habilitado para o médico';end if;
  mode:=case when p_data->>'billing_method'='PARTICULAR' or old_row->>'settlement_mode'='DIRECT' or not physician.invoice_enabled then 'DIRECT' else 'INVOICE' end;
  if mode='INVOICE' and p_data->>'payment_status'='PAGO' then raise exception 'Registre o pagamento do convênio na NF/lote'; end if;
  if p_data->>'payment_status'='PAGO' and (nullif(p_data->>'paid_at','') is null or nullif(p_data->>'received_amount','') is null) then raise exception 'Pagamento particular exige valor e data'; end if;
  if public.appointment_billing_method(a) is not null and public.appointment_billing_method(a) is distinct from p_data->>'billing_method' then raise exception 'Use a forma de cobrança informada no agendamento'; end if;
  insert into public.billing_records(id,attendance_id,appointment_id,settlement_mode,billing_entity_id,billing_method,payment_status,invoice_number,received_amount,paid_at,notes,updated_at,updated_by)
  values(sid,p_data->>'appointment_id',a->>'appointment_id',mode,entity,p_data->>'billing_method',p_data->>'payment_status',case when p_data->>'billing_method'='PARTICULAR' then nullif(trim(p_data->>'invoice_number'),'') end,
   case when mode='DIRECT' then nullif(p_data->>'received_amount','')::numeric end,
   case when mode='DIRECT' then nullif(p_data->>'paid_at','')::date end,nullif(trim(p_data->>'notes'),''),clock_timestamp(),p_actor)
  on conflict(id) do update set settlement_mode=excluded.settlement_mode,billing_entity_id=excluded.billing_entity_id,billing_method=excluded.billing_method,payment_status=excluded.payment_status,invoice_number=excluded.invoice_number,received_amount=excluded.received_amount,paid_at=excluded.paid_at,notes=excluded.notes,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(billing_records.*) into result_row;
  update public.attendances set billing_entity_id=entity,billing_method=p_data->>'billing_method' where id=p_data->>'appointment_id';
  -- Preserve compatibility with the explicit scheduling choice.
  update public.app_state st set payload=jsonb_set(st.payload,'{appointments}',coalesce((select jsonb_agg(case when x->>'id'=a->>'appointment_id' then x||jsonb_build_object('forma_cobranca',p_data->>'billing_method') else x end order by n) from jsonb_array_elements(st.payload->'appointments') with ordinality arr(x,n)),'[]')),updated_at=greatest(clock_timestamp(),st.updated_at+interval '1 millisecond') where st.id=1;
 elsif p_kind='invoice' then
  if role_name<>'general_manager' then raise exception 'Somente a gerência pode gerenciar lotes'; end if;
  select to_jsonb(i) into old_row from public.invoices i where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'NF alterada por outro usuário. Atualize'; end if;
  entity:=(p_data->>'billing_entity_id')::uuid;
  if nullif(trim(p_data->>'payer'),'') is null or nullif(trim(p_data->>'invoice_number'),'') is null or nullif(p_data->>'issue_date','') is null then raise exception 'Preencha número, pagador e emissão'; end if;
  payer_name:=public.billing_payer_key(p_data->>'payer');
  if not exists(
   select 1 from (
    select insurance as name from public.attendances
    union all select value->>'insurance' as name from jsonb_array_elements(coalesce(state->'patients','[]'))
    union all select value->>'insurance' from jsonb_array_elements(coalesce(state->'appointments','[]'))
    union all select old_row->>'payer'
   ) payers where public.billing_payer_key(name)=payer_name and payer_name<>''
  ) then raise exception 'Selecione um pagador existente no sistema'; end if;
  if not exists(select 1 from public.billing_entities where id=entity and (active or old_row->>'billing_entity_id'=entity::text)) then raise exception 'Entidade inativa ou inexistente'; end if;
  if p_data ? 'appointment_ids' then
   appointment_ids:=p_data->'appointment_ids';
   if jsonb_typeof(appointment_ids) is distinct from 'array' then raise exception 'Lista de atendimentos inválida'; end if;
  else
   -- Compatibility for an already open older client. Every supplied ID must exist.
   if jsonb_typeof(p_data->'record_ids') is distinct from 'array' then raise exception 'Lista de atendimentos inválida'; end if;
   appointment_ids:='[]';
   for item in select value::uuid from jsonb_array_elements_text(p_data->'record_ids') loop
    select * into record from public.billing_records where id=item;
    if not found then raise exception 'Faturamento inexistente'; end if;
    appointment_ids:=appointment_ids||jsonb_build_array(record.attendance_id);
   end loop;
  end if;
  if jsonb_array_length(appointment_ids)=0 and nullif(p_data->>'paid_at','') is not null then raise exception 'Vincule pelo menos um atendimento antes de confirmar o pagamento'; end if;
  if p_data ? 'item_amounts' then
   if jsonb_typeof(p_data->'item_amounts') is distinct from 'object' then raise exception 'Valores individuais inválidos'; end if;
   for amount_entry in select * from jsonb_each(p_data->'item_amounts') loop
    if not (appointment_ids ? amount_entry.key) or jsonb_typeof(amount_entry.value) not in ('number','null') then raise exception 'Valor individual inválido ou atendimento não selecionado'; end if;
    if jsonb_typeof(amount_entry.value)='number' and ((amount_entry.value::text)::numeric<0 or (amount_entry.value::text)::numeric>9999999999.99 or round((amount_entry.value::text)::numeric,2)<>(amount_entry.value::text)::numeric) then raise exception 'Valor individual deve ser positivo ou zero, com até duas casas decimais'; end if;
   end loop;
  end if;
  select coalesce(jsonb_agg(to_jsonb(ib)),'[]') into before_item_values from public.invoice_billing_records ib where ib.invoice_id=sid;
  select coalesce(jsonb_agg(billing_record_id),'[]') into old_items from public.invoice_billing_records where invoice_billing_records.invoice_id=sid;
  select coalesce(jsonb_agg(to_jsonb(b)),'[]') into before_records from public.billing_records b where b.id in(select billing_record_id from public.invoice_billing_records where invoice_billing_records.invoice_id=sid);
  for appt_id in select distinct value from jsonb_array_elements_text(appointment_ids) loop
   a:=public.attribute_financial_attendance(appt_id,entity);
   if a is null then raise exception 'Atendimento cancelado ou inexistente'; end if;
   select * into record from public.billing_records b where b.attendance_id=appt_id;
   if a->>'status' is distinct from 'realized' then raise exception 'Somente atendimentos realizados podem ser vinculados'; end if;
   if public.appointment_billing_method(a,record.billing_method) is distinct from 'CONVENIO' then raise exception 'Atendimento não é cobrado por convênio'; end if;
   if public.billing_payer_key(coalesce(nullif(trim(a->>'insurance'),''),(select x->>'insurance' from jsonb_array_elements(coalesce(state->'patients','[]')) x where x->>'id'=a->>'patientId'),''))<>payer_name then raise exception 'Convênio do atendimento diferente do pagador'; end if;
   if not exists(select 1 from public.invoice_billing_records ib where ib.invoice_id=sid and ib.billing_record_id=record.id and record.billing_entity_id=entity) and not exists(select 1 from public.billing_doctor_entities l join public.billing_entities be on be.id=l.billing_entity_id and be.active where l.billing_entity_id=entity and l.active and l.doctor_id in(a->>'doctorId',a->>'anesthetistId')) then raise exception 'Médico sem vínculo ativo com a entidade recebedora'; end if;
   if not exists(select 1 from public.invoice_billing_records where invoice_id=sid and billing_record_id=record.id) and not exists(select 1 from public.doctors where id=a->>'doctorId' and invoice_enabled) then raise exception 'Gestão de NF não habilitada para o médico';end if;
   if record.id is not null and record.settlement_mode='DIRECT' then raise exception 'Atendimento utiliza pagamento direto, sem gestão de NF';end if;
   if record.id is not null and exists(select 1 from public.invoice_billing_records ib where ib.billing_record_id=record.id and ib.invoice_id<>sid) then raise exception 'Atendimento já vinculado a outra NF'; end if;
   if record.id is not null and (record.billing_method<>'CONVENIO' or (record.payment_status='PAGO' and not exists(select 1 from public.invoice_billing_records ib where ib.billing_record_id=record.id and ib.invoice_id=sid))) then raise exception 'Faturamento individual já configurado ou pago. Revise antes de vincular'; end if;
   old_record:=case when record.id is not null then to_jsonb(record) end;
   if record.id is null then
    insert into public.billing_records(attendance_id,appointment_id,settlement_mode,billing_entity_id,billing_method,payment_status,received_amount,paid_at,invoice_number,updated_at,updated_by)
    values(appt_id,a->>'appointment_id','INVOICE',entity,'CONVENIO','PENDENTE',null,null,null,clock_timestamp(),p_actor) returning * into record;
   else
    update public.billing_records b set billing_entity_id=entity,received_amount=null,paid_at=null,invoice_number=null,updated_at=clock_timestamp(),updated_by=p_actor where b.id=record.id returning b.* into record;
   end if;
   update public.attendances set billing_entity_id=entity where id=appt_id;
   selected_records:=array_append(selected_records,record.id);
   insert into public.billing_audit(actor_id,action,record_id,before_data,after_data) values(p_actor,'invoice_record_prepared',record.id,old_record,to_jsonb(record));
  end loop;
  insert into public.invoices(id,billing_entity_id,invoice_number,payer,issue_date,total_amount,net_amount,paid_at,notes,updated_at,updated_by)
  values(sid,entity,trim(p_data->>'invoice_number'),payer_name,(p_data->>'issue_date')::date,nullif(p_data->>'total_amount','')::numeric,nullif(p_data->>'net_amount','')::numeric,nullif(p_data->>'paid_at','')::date,nullif(trim(p_data->>'notes'),''),clock_timestamp(),p_actor)
  on conflict(id) do update set billing_entity_id=excluded.billing_entity_id,invoice_number=excluded.invoice_number,payer=excluded.payer,issue_date=excluded.issue_date,total_amount=excluded.total_amount,net_amount=excluded.net_amount,paid_at=excluded.paid_at,notes=excluded.notes,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(invoices.*) into result_row;
  update public.billing_records set payment_status='PENDENTE',updated_at=clock_timestamp(),updated_by=p_actor where id in(select billing_record_id from public.invoice_billing_records where invoice_billing_records.invoice_id=sid);
  delete from public.invoice_billing_records where invoice_billing_records.invoice_id=sid and not(billing_record_id=any(selected_records));
  insert into public.invoice_billing_records(invoice_id,billing_record_id) select sid,unnest(selected_records) on conflict(invoice_id,billing_record_id) do nothing;
  update public.billing_records set payment_status=case when nullif(p_data->>'paid_at','') is null then 'PENDENTE' else 'PAGO' end,received_amount=null,paid_at=null,invoice_number=null,updated_at=clock_timestamp(),updated_by=p_actor where id=any(selected_records);
  update public.invoice_billing_records ib set received_amount=(p_data->'item_amounts'->>b.attendance_id)::numeric from public.billing_records b where b.id=ib.billing_record_id and ib.invoice_id=sid and (p_data->'item_amounts') ? b.attendance_id;
  old_row:=coalesce(old_row,'{}')||jsonb_build_object('record_ids',old_items,'records',before_records,'items',before_item_values);
  result_row:=result_row||jsonb_build_object('record_ids',to_jsonb(selected_records),'appointment_ids',appointment_ids,'items',(select coalesce(jsonb_agg(to_jsonb(ib)),'[]') from public.invoice_billing_records ib where ib.invoice_id=sid));
 else raise exception 'Operação inválida'; end if;
 insert into public.billing_audit(actor_id,action,record_id,before_data,after_data) values(p_actor,p_kind,sid,old_row,result_row);
 perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);
 return sid;
end;$$;
revoke all on function public.save_billing(bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_billing(bigint,text,jsonb) to service_role;


-- Source: next-stage-directory.sql
create or replace function public.project_central_doctors() returns trigger language plpgsql security invoker set search_path='' as $$
declare appointment jsonb; previous jsonb; professional text;
begin
 for appointment in select value from jsonb_array_elements(coalesce(new.payload->'appointments','[]')) loop
  previous:=null;
  if tg_op='UPDATE' then select value into previous from jsonb_array_elements(coalesce(old.payload->'appointments','[]')) where value->>'id'=appointment->>'id'; end if;
  if previous is null or previous->>'doctorId' is distinct from appointment->>'doctorId' or previous->>'anesthetistId' is distinct from appointment->>'anesthetistId' then
   foreach professional in array array[appointment->>'doctorId',appointment->>'anesthetistId'] loop
    if nullif(professional,'') is not null and not exists(select 1 from public.doctors where id=professional and active) then raise exception 'Médico inexistente ou inativo'; end if;
   end loop;
   if not exists(select 1 from public.doctor_agendas where doctor_id in(appointment->>'doctorId',appointment->>'anesthetistId') and active and exists(select 1 from public.doctors d where d.id=doctor_id and d.scheduling_enabled)) then raise exception 'Configure uma agenda ativa para o médico antes de agendar'; end if;
  end if;
 end loop;
 new.payload:=jsonb_set(new.payload,'{professionals}',coalesce((select jsonb_agg(d.details||jsonb_build_object('id',d.id,'name',d.name,'crm',d.crm,'specialty',d.specialty,'category',d.category,'active',d.active,'scheduling_enabled',d.scheduling_enabled,'billing_enabled',d.billing_enabled,'invoice_enabled',d.invoice_enabled,'agendaEnabled',coalesce(a.active,false) and d.scheduling_enabled,'agendaSettings',coalesce(a.settings,'{}'::jsonb)) order by d.name) from public.doctors d left join public.doctor_agendas a on a.doctor_id=d.id),'[]'));
 return new;
end;$$;
revoke all on function public.project_central_doctors() from public,anon,authenticated;
grant execute on function public.project_central_doctors() to service_role;



create or replace function public.save_doctor_directory(p_actor bigint,p_kind text,p_data jsonb) returns text language plpgsql security invoker set search_path='' as $$
declare sid text; old_row jsonb; result_row jsonb;
begin
 perform pg_advisory_xact_lock(194701,1);
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then raise exception 'Somente a gerência pode alterar o cadastro central'; end if;
 sid:=coalesce(nullif(p_data->>'id',''),gen_random_uuid()::text);
 perform public.financial_operation(p_actor,'doctor',sid);
 if p_kind='doctor' then
  select to_jsonb(d) into old_row from public.doctors d where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Médico alterado. Atualize a página'; end if;
  if coalesce(length(trim(p_data->>'name')),0)<2 or coalesce(p_data->>'category','') not in ('doctor','anesthetist') then raise exception 'Informe nome e categoria'; end if;
  if nullif(trim(p_data->>'crm'),'') is not null and exists(select 1 from public.doctors where id<>sid and lower(trim(crm))=lower(trim(p_data->>'crm'))) then raise exception 'CRM já cadastrado. Use o médico existente'; end if;
  insert into public.doctors(id,name,crm,specialty,category,active,scheduling_enabled,billing_enabled,invoice_enabled,updated_at,updated_by)
   values(sid,trim(p_data->>'name'),trim(coalesce(p_data->>'crm','')),trim(coalesce(p_data->>'specialty','')),p_data->>'category',coalesce((p_data->>'active')::boolean,true),coalesce((p_data->>'scheduling_enabled')::boolean,(old_row->>'scheduling_enabled')::boolean,true),coalesce((p_data->>'billing_enabled')::boolean,(old_row->>'billing_enabled')::boolean,true),coalesce((p_data->>'invoice_enabled')::boolean,(old_row->>'invoice_enabled')::boolean,true),clock_timestamp(),p_actor)
   on conflict(id) do update set name=excluded.name,crm=excluded.crm,specialty=excluded.specialty,category=excluded.category,active=excluded.active,scheduling_enabled=excluded.scheduling_enabled,billing_enabled=excluded.billing_enabled,invoice_enabled=excluded.invoice_enabled,updated_at=excluded.updated_at,updated_by=p_actor returning to_jsonb(doctors.*) into result_row;
 elsif p_kind='agenda' then
  if not exists(select 1 from public.doctors where id=sid and scheduling_enabled) then raise exception 'Agendamento não habilitado para o médico';end if;
  if not exists(select 1 from public.doctors where id=sid) then raise exception 'Médico não cadastrado'; end if;
  select to_jsonb(a) into old_row from public.doctor_agendas a where doctor_id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Agenda alterada. Atualize a página'; end if;
  if coalesce(p_data->>'workStart','')!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_data->>'workEnd','')!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or p_data->>'workStart'>=p_data->>'workEnd' then raise exception 'Horário da agenda inválido'; end if;
  insert into public.doctor_agendas(doctor_id,active,settings,updated_at,updated_by) values(sid,coalesce((p_data->>'active')::boolean,true),jsonb_build_object('workStart',p_data->>'workStart','workEnd',p_data->>'workEnd'),clock_timestamp(),p_actor)
  on conflict(doctor_id) do update set active=excluded.active,settings=excluded.settings,updated_at=excluded.updated_at,updated_by=p_actor returning to_jsonb(doctor_agendas.*) into result_row;
 else raise exception 'Operação inválida'; end if;
 insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data) values(p_actor,p_kind,sid,old_row,result_row);
 update public.app_state set payload=payload,updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond') where id=1;
 perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);return sid;
end;$$;
revoke all on function public.save_doctor_directory(bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_doctor_directory(bigint,text,jsonb) to service_role;


-- Source: next-stage-agenda.sql
create or replace function public.guard_invoice_appointments() returns trigger language plpgsql security invoker set search_path='' as $$
declare a jsonb; entry record; method text; payer text; previous jsonb;
begin
 for a in select value from jsonb_array_elements(coalesce(new.payload->'appointments','[]')) loop
  method:=public.appointment_billing_method(a);
  if method is not null and method not in ('PARTICULAR','CONVENIO') then raise exception 'Forma de cobrança inválida'; end if;
 end loop;
 for entry in select b.appointment_id,i.payer,b.billing_method,b.billing_entity_id from public.billing_records b join public.invoice_billing_records ib on ib.billing_record_id=b.id join public.invoices i on i.id=ib.invoice_id where b.appointment_id is not null loop
  select value into a from jsonb_array_elements(coalesce(new.payload->'appointments','[]')) where value->>'id'=entry.appointment_id;
  select value into previous from jsonb_array_elements(coalesce(old.payload->'appointments','[]')) where value->>'id'=entry.appointment_id;
  payer:=coalesce(nullif(trim(a->>'insurance'),''),(select value->>'insurance' from jsonb_array_elements(coalesce(new.payload->'patients','[]')) where value->>'id'=a->>'patientId'),'');
  if a is null or a->>'status' is distinct from 'realized' or public.appointment_billing_method(a,entry.billing_method) is distinct from 'CONVENIO' or public.billing_payer_key(payer)<>public.billing_payer_key(entry.payer)
   or a->>'doctorId' is distinct from previous->>'doctorId' or a->>'anesthetistId' is distinct from previous->>'anesthetistId' or a->>'patientId' is distinct from previous->>'patientId' then
   raise exception 'Atendimento vinculado a uma NF. Remova o vínculo na NF antes de alterar cobrança, convênio, médico, paciente ou realização';
  end if;
 end loop;
 return new;
end;$$;
revoke all on function public.guard_invoice_appointments() from public,anon,authenticated;

create or replace function public.commit_agenda_change(p_expected timestamptz, p_payload jsonb, p_revision timestamptz, p_audit jsonb,
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
  perform public.financial_operation(coalesce(p_actor,(p_audit->0->>'actor_user_id')::bigint),'agenda',p_request_id);
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
  perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);
  return true;
end;
$$;
revoke all on function public.commit_agenda_change(timestamptz,jsonb,timestamptz,jsonb,text,text,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_agenda_change(timestamptz,jsonb,timestamptz,jsonb,text,text,bigint,text,jsonb) to service_role;


-- Source: next-stage-expenses.sql
create function public.save_company_finance(p_actor bigint,p_kind text,p_data jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare sid uuid:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());entity uuid:=(p_data->>'billing_entity_id')::uuid;old_row jsonb;associate uuid:=nullif(p_data->>'paid_by_associate_id','')::uuid;
begin
 perform pg_advisory_xact_lock(194701,2);
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then raise exception 'Acesso restrito à gerência';end if;
 perform public.financial_operation(p_actor,p_kind,sid::text);
 if p_kind='associate' then select to_jsonb(a) into old_row from public.company_associates a where id=sid;
 elsif p_kind='expense' then select to_jsonb(e) into old_row from public.company_expenses e where id=sid;
 else raise exception 'Operação inválida';end if;
 if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Registro alterado. Atualize';end if;
 if old_row is not null and old_row->>'billing_entity_id' is distinct from entity::text then raise exception 'A entidade histórica não pode ser alterada';end if;
 if not exists(select 1 from public.billing_entities where id=entity and (active or old_row is not null)) then raise exception 'Entidade inativa ou inexistente';end if;
 if p_kind='associate' then
  insert into public.company_associates(id,billing_entity_id,name,doctor_id,active) values(sid,entity,trim(p_data->>'name'),nullif(p_data->>'doctor_id',''),coalesce((p_data->>'active')::boolean,true))
  on conflict(id) do update set name=excluded.name,doctor_id=excluded.doctor_id,active=excluded.active;
 else
  if associate is not null and not exists(select 1 from public.company_associates where id=associate and billing_entity_id=entity and (active or old_row->>'paid_by_associate_id'=associate::text)) then raise exception 'Associado inválido para a empresa';end if;
  insert into public.company_expenses(id,billing_entity_id,description,category,supplier,competence_date,due_date,paid_at,amount,status,notes,paid_by_associate_id)
  values(sid,entity,trim(p_data->>'description'),coalesce(p_data->>'category',''),coalesce(p_data->>'supplier',''),(p_data->>'competence_date')::date,nullif(p_data->>'due_date','')::date,case when p_data->>'status'='PAGO' then nullif(p_data->>'paid_at','')::date end,(p_data->>'amount')::numeric,p_data->>'status',p_data->>'notes',case when p_data->>'status'='PAGO' then associate end)
  on conflict(id) do update set description=excluded.description,category=excluded.category,supplier=excluded.supplier,competence_date=excluded.competence_date,due_date=excluded.due_date,paid_at=excluded.paid_at,amount=excluded.amount,status=excluded.status,notes=excluded.notes,paid_by_associate_id=excluded.paid_by_associate_id;
 end if;
 perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);return sid;
end;$$;

create function public.stamp_patient_authorship() returns trigger language plpgsql security invoker set search_path='' as $$
declare p jsonb;previous jsonb;result jsonb:='[]';actor bigint:=nullif(current_setting('rn.actor',true),'')::bigint;
begin
 for p in select value from jsonb_array_elements(coalesce(new.payload->'patients','[]')) loop
  previous:=null;
  if tg_op='UPDATE' then select value into previous from jsonb_array_elements(coalesce(old.payload->'patients','[]')) where value->>'id'=p->>'id';end if;
  if previous is null or (previous-'created_by'-'created_at'-'updated_by'-'updated_at') is distinct from (p-'created_by'-'created_at'-'updated_by'-'updated_at') then
   if actor is null then raise exception 'Cadastro de paciente exige autoria';end if;
   p:=p||jsonb_build_object('created_by',case when previous is null then to_jsonb(actor) else previous->'created_by' end,'created_at',case when previous is null then to_jsonb(clock_timestamp()) else previous->'created_at' end,'updated_by',actor,'updated_at',clock_timestamp());
  else p:=(p-'created_by'-'created_at'-'updated_by'-'updated_at')||(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(previous) where key in('created_by','created_at','updated_by','updated_at'));
  end if;
  result:=result||jsonb_build_array(p);
 end loop;
 new.payload:=jsonb_set(new.payload,'{patients}',result);return new;
end;$$;
create trigger patient_authorship before insert or update of payload on public.app_state for each row execute function public.stamp_patient_authorship();
create trigger sync_attendances after insert or update of payload on public.app_state for each row execute function public.sync_financial_attendances();
do $$declare t text;f record;begin
 foreach t in array array['attendances','billing_records','invoices','invoice_billing_records','billing_entities','billing_doctor_entities','doctors','company_associates','company_expenses'] loop
  execute format('create trigger financial_stamp before insert or update on public.%I for each row execute function public.financial_stamp()',t);
  execute format('create trigger financial_log_change after insert or update or delete on public.%I for each row execute function public.financial_log_change()',t);
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('financial_operation','financial_log_snapshot','financial_stamp','financial_log_change','immutable_financial_log','financial_attendance','attribute_financial_attendance','sync_financial_attendances','save_manual_attendance','save_company_finance','stamp_patient_authorship') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end;$$;
