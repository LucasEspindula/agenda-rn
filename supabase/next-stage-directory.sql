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
