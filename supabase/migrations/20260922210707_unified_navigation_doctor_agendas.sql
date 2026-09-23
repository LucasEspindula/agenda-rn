-- Incremental navigation / central doctor administration. No financial domain changes.
-- Keep SECURITY INVOKER and the existing manager-only operation and audit transaction.
create or replace function public.save_doctor_directory(p_actor bigint,p_kind text,p_data jsonb) returns text language plpgsql security invoker set search_path='' as $$
declare sid text; old_row jsonb; result_row jsonb; old_agenda jsonb; new_agenda jsonb;
begin
 perform pg_advisory_xact_lock(194701,1);
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then raise exception 'Somente a gerência pode alterar o cadastro central'; end if;
 sid:=coalesce(nullif(p_data->>'id',''),gen_random_uuid()::text);
 perform public.financial_operation(p_actor,'doctor',sid);
 if p_kind='doctor' then
  select to_jsonb(d) into old_row from public.doctors d where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Médico alterado. Atualize a página'; end if;
  if coalesce(length(trim(p_data->>'name')),0)<2 then raise exception 'Informe o nome'; end if;
  if not coalesce(public.valid_medical_specialty(p_data->>'specialty'),false) then raise exception 'Selecione uma especialidade da lista';end if;
  if nullif(trim(p_data->>'crm'),'') is not null and exists(select 1 from public.doctors where id<>sid and lower(trim(crm))=lower(trim(p_data->>'crm'))) then raise exception 'CRM já cadastrado. Use o médico existente'; end if;
  insert into public.doctors(id,name,crm,specialty,category,active,scheduling_enabled,billing_enabled,invoice_enabled,updated_at,updated_by)
   values(sid,trim(p_data->>'name'),trim(coalesce(p_data->>'crm','')),trim(coalesce(p_data->>'specialty','')),case when public.is_anesthesiologist(p_data->>'specialty') then 'anesthetist' else 'doctor' end,coalesce((p_data->>'active')::boolean,true),coalesce((p_data->>'scheduling_enabled')::boolean,(old_row->>'scheduling_enabled')::boolean,true),coalesce((p_data->>'billing_enabled')::boolean,(old_row->>'billing_enabled')::boolean,true),coalesce((p_data->>'invoice_enabled')::boolean,(old_row->>'invoice_enabled')::boolean,true),clock_timestamp(),p_actor)
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

 -- Provision only when first configured or when the scheduling service is enabled again.
 -- Editing a doctor must not override an explicitly paused agenda or custom hours.
 if p_kind='doctor' and (result_row->>'scheduling_enabled')::boolean then
  select to_jsonb(a) into old_agenda from public.doctor_agendas a where a.doctor_id=sid;
  if old_agenda is null or not coalesce((old_row->>'scheduling_enabled')::boolean,false) then
   insert into public.doctor_agendas(doctor_id,active,settings,updated_at,updated_by)
    values(sid,true,jsonb_build_object('workStart','07:00','workEnd','19:00'),clock_timestamp(),p_actor)
    on conflict(doctor_id) do update set active=true,updated_at=clock_timestamp(),updated_by=p_actor
    returning to_jsonb(doctor_agendas.*) into new_agenda;
   insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data) values(p_actor,'agenda',sid,old_agenda,new_agenda);
  end if;
 end if;
 insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data) values(p_actor,p_kind,sid,old_row,result_row);
 update public.app_state set payload=payload,updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond') where id=1;
 perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);return sid;
end;$$;
revoke all on function public.save_doctor_directory(bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_doctor_directory(bigint,text,jsonb) to service_role;

-- Backfill only missing agendas. No invented human author or changes to existing settings.
insert into public.doctor_agendas(doctor_id,active,settings)
select id,true,jsonb_build_object('workStart','07:00','workEnd','19:00')
from public.doctors d where scheduling_enabled
and not exists(select 1 from public.doctor_agendas a where a.doctor_id=d.id);
-- Refresh the canonical projection without changing clinical or financial records.
update public.app_state set payload=payload,updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond') where id=1;
