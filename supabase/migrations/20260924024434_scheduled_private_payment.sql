-- Materialize a scheduled Particular attendance only when an authorized financial
-- write requests it. Existing save_billing validation, locks, audit operation and
-- transaction remain authoritative. GET requests never create financial records.
-- The exact anchor fails closed if the prior function has changed unexpectedly.
do $migration$
declare definition text; anchor text := $anchor$ elsif p_kind='record' then
  a:=public.financial_attendance(p_data->>'appointment_id');$anchor$;
 replacement text := $replacement$ elsif p_kind='record' then
  if not exists(select 1 from public.attendances where id=p_data->>'appointment_id')
     and p_data->>'billing_method'='PARTICULAR' then
   select clinical into a from jsonb_array_elements(coalesce(state->'appointments','[]')) clinical
    where clinical->>'id'=p_data->>'appointment_id';
   if a is null or a->>'forma_cobranca' is distinct from 'PARTICULAR' then
    raise exception 'Use a forma de cobrança informada no agendamento';
   end if;
   if role_name<>'general_manager' and not exists(select 1 from public.agenda_access g
      where g.user_id=p_actor and g.professional_id in(a->>'doctorId',a->>'anesthetistId')) then
    raise exception 'Agenda sem permissão';
   end if;
   insert into public.attendances(id,appointment_id,origin,patient_id,doctor_id,date,procedure,insurance,billing_method,status)
    values(a->>'id',a->>'id','AGENDA',nullif(a->>'patientId',''),a->>'doctorId',(a->>'date')::date,
     coalesce(a->>'procedure','Procedimento'),coalesce(a->>'insurance',(select p->>'insurance'
       from jsonb_array_elements(coalesce(state->'patients','[]')) p where p->>'id'=a->>'patientId'),''),
     'PARTICULAR',a->>'status');
  end if;
  a:=public.financial_attendance(p_data->>'appointment_id');$replacement$;
begin
 select pg_get_functiondef('public.save_billing(bigint,text,jsonb)'::regprocedure) into definition;
 if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
  raise exception 'Unexpected save_billing definition; review scheduled payment migration';
 end if;
 execute replace(definition,anchor,replacement);
end;
$migration$;
revoke all on function public.save_billing(bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_billing(bigint,text,jsonb) to service_role;

