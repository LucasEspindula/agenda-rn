-- Preserve professional IDs: appointments and financial links keep their references.
create table public.doctors (
 id text primary key, name text not null check(length(trim(name)) between 2 and 160),
 crm text not null default '', specialty text not null default '', category text not null check(category in ('doctor','anesthetist')),
 active boolean not null default true, details jsonb not null default '{}',
 updated_at timestamptz not null default now(), updated_by bigint references public.users(id)
);
create table public.doctor_agendas (
 doctor_id text primary key references public.doctors(id), active boolean not null default true,
 settings jsonb not null default '{}', updated_at timestamptz not null default now(), updated_by bigint references public.users(id)
);
create table public.directory_audit (
 id bigint generated always as identity primary key, actor_id bigint references public.users(id),
 kind text not null, record_id text not null, before_data jsonb, after_data jsonb, created_at timestamptz not null default now()
);
insert into public.doctors(id,name,crm,specialty,category,active,details)
 select p->>'id',p->>'name',coalesce(p->>'crm',''),coalesce(p->>'specialty',''),coalesce(p->>'category','doctor'),coalesce((p->>'active')::boolean,true),p-'id'-'name'-'crm'-'specialty'-'category'-'active'
 from public.app_state s cross join lateral jsonb_array_elements(s.payload->'professionals') p where s.id=1;
insert into public.doctor_agendas(doctor_id) select id from public.doctors;
alter table public.billing_doctor_entities add constraint billing_doctor_reference foreign key(doctor_id) references public.doctors(id);
alter table public.doctors enable row level security;
alter table public.doctor_agendas enable row level security;
alter table public.directory_audit enable row level security;
revoke all on public.doctors,public.doctor_agendas,public.directory_audit from public,anon,authenticated;
grant select,insert,update on public.doctors,public.doctor_agendas to service_role;
grant select,insert on public.directory_audit to service_role;
grant usage,select on sequence public.directory_audit_id_seq to service_role;

-- Compatibility projection for the existing scheduling client, never an editable registry.
create function public.project_central_doctors() returns trigger language plpgsql security invoker set search_path='' as $$
declare appointment jsonb; previous jsonb; professional text;
begin
 for appointment in select value from jsonb_array_elements(coalesce(new.payload->'appointments','[]')) loop
  previous:=null;
  if tg_op='UPDATE' then select value into previous from jsonb_array_elements(coalesce(old.payload->'appointments','[]')) where value->>'id'=appointment->>'id'; end if;
  if previous is null or previous->>'doctorId' is distinct from appointment->>'doctorId' or previous->>'anesthetistId' is distinct from appointment->>'anesthetistId' then
   foreach professional in array array[appointment->>'doctorId',appointment->>'anesthetistId'] loop
    if nullif(professional,'') is not null and not exists(select 1 from public.doctors where id=professional and active) then raise exception 'Médico inexistente ou inativo'; end if;
   end loop;
   if not exists(select 1 from public.doctor_agendas where doctor_id in(appointment->>'doctorId',appointment->>'anesthetistId') and active) then raise exception 'Configure uma agenda ativa para o médico antes de agendar'; end if;
  end if;
 end loop;
 new.payload:=jsonb_set(new.payload,'{professionals}',coalesce((select jsonb_agg(d.details||jsonb_build_object('id',d.id,'name',d.name,'crm',d.crm,'specialty',d.specialty,'category',d.category,'active',d.active,'agendaEnabled',coalesce(a.active,false),'agendaSettings',coalesce(a.settings,'{}'::jsonb)) order by d.name) from public.doctors d left join public.doctor_agendas a on a.doctor_id=d.id),'[]'));
 return new;
end;$$;
revoke all on function public.project_central_doctors() from public,anon,authenticated;
grant execute on function public.project_central_doctors() to service_role;
create trigger central_doctor_projection before insert or update of payload on public.app_state for each row execute function public.project_central_doctors();
update public.app_state set payload=payload,updated_at=clock_timestamp() where id=1;

create function public.save_doctor_directory(p_actor bigint,p_kind text,p_data jsonb) returns text language plpgsql security invoker set search_path='' as $$
declare sid text; old_row jsonb; result_row jsonb;
begin
 perform pg_advisory_xact_lock(194701,1);
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then raise exception 'Somente a gerência pode alterar o cadastro central'; end if;
 sid:=coalesce(nullif(p_data->>'id',''),gen_random_uuid()::text);
 if p_kind='doctor' then
  select to_jsonb(d) into old_row from public.doctors d where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Médico alterado. Atualize a página'; end if;
  if coalesce(length(trim(p_data->>'name')),0)<2 or coalesce(p_data->>'category','') not in ('doctor','anesthetist') then raise exception 'Informe nome e categoria'; end if;
  if nullif(trim(p_data->>'crm'),'') is not null and exists(select 1 from public.doctors where id<>sid and lower(trim(crm))=lower(trim(p_data->>'crm'))) then raise exception 'CRM já cadastrado. Use o médico existente'; end if;
  insert into public.doctors(id,name,crm,specialty,category,active,updated_at,updated_by)
   values(sid,trim(p_data->>'name'),trim(coalesce(p_data->>'crm','')),trim(coalesce(p_data->>'specialty','')),p_data->>'category',coalesce((p_data->>'active')::boolean,true),clock_timestamp(),p_actor)
   on conflict(id) do update set name=excluded.name,crm=excluded.crm,specialty=excluded.specialty,category=excluded.category,active=excluded.active,updated_at=excluded.updated_at,updated_by=p_actor returning to_jsonb(doctors.*) into result_row;
 elsif p_kind='agenda' then
  if not exists(select 1 from public.doctors where id=sid) then raise exception 'Médico não cadastrado'; end if;
  select to_jsonb(a) into old_row from public.doctor_agendas a where doctor_id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Agenda alterada. Atualize a página'; end if;
  if coalesce(p_data->>'workStart','')!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_data->>'workEnd','')!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or p_data->>'workStart'>=p_data->>'workEnd' then raise exception 'Horário da agenda inválido'; end if;
  insert into public.doctor_agendas(doctor_id,active,settings,updated_at,updated_by) values(sid,coalesce((p_data->>'active')::boolean,true),jsonb_build_object('workStart',p_data->>'workStart','workEnd',p_data->>'workEnd'),clock_timestamp(),p_actor)
  on conflict(doctor_id) do update set active=excluded.active,settings=excluded.settings,updated_at=excluded.updated_at,updated_by=p_actor returning to_jsonb(doctor_agendas.*) into result_row;
 else raise exception 'Operação inválida'; end if;
 insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data) values(p_actor,p_kind,sid,old_row,result_row);
 update public.app_state set payload=payload,updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond') where id=1;
 return sid;
end;$$;
revoke all on function public.save_doctor_directory(bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_doctor_directory(bigint,text,jsonb) to service_role;
