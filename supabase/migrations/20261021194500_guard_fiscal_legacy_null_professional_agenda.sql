-- Guard de NFs: registros legados sem professional_id eram incorretamente
-- classificados como atendimentos independentes e impediam QUALQUER escrita na agenda.
-- Preserva restrições de paciente, forma de cobrança, realização e vínculos fiscais.
CREATE OR REPLACE FUNCTION public.guard_invoice_appointments()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  appointment jsonb;
  previous jsonb;
  entry record;
  method text;
  payer text;
begin
  for appointment in select value from jsonb_array_elements(coalesce(new.payload->'appointments','[]'::jsonb)) loop
    method:=public.appointment_billing_method(appointment);
    if method is not null and method not in ('PARTICULAR','CONVENIO') then
      raise exception 'Forma de cobrança inválida';
    end if;
  end loop;

  for entry in
    select b.appointment_id,b.professional_id,b.professional_role,b.attendance_id,
           i.payer,b.billing_method,b.billing_entity_id,
           (b.professional_role is distinct from 'PRIMARY' or
              exists(select 1 from public.billing_records other
                     where other.attendance_id=b.attendance_id and other.id<>b.id)) independent
    from public.billing_records b
    join public.invoice_billing_records ib on ib.billing_record_id=b.id
    join public.invoices i on i.id=ib.invoice_id
    where b.appointment_id is not null and i.recipient_type='CONVENIO' and ib.is_active
  loop
    select value into appointment from jsonb_array_elements(coalesce(new.payload->'appointments','[]'::jsonb))
      where value->>'id'=entry.appointment_id;
    select value into previous from jsonb_array_elements(coalesce(old.payload->'appointments','[]'::jsonb))
      where value->>'id'=entry.appointment_id;
    -- Estado antigo de outra NF não pode impedir alteração de agendamento não relacionado.
    if appointment is not null and appointment is not distinct from previous then continue; end if;
    if appointment is null or appointment->>'status' is distinct from 'realized'
       or appointment->>'doctorId' is distinct from previous->>'doctorId'
       or appointment->>'anesthetistId' is distinct from previous->>'anesthetistId'
       or appointment->>'patientId' is distinct from previous->>'patientId' then
      raise exception 'Atendimento com NF: preserve realização, médico, anestesista e paciente';
    end if;
    if entry.independent and entry.professional_id is not null then
      if entry.professional_id is distinct from appointment->>'doctorId'
         and entry.professional_id is distinct from appointment->>'anesthetistId' then
        raise exception 'Profissional faturado não participa mais do atendimento';
      end if;
    else
      payer:=coalesce(appointment->>'insurance','');
      if public.appointment_billing_method(appointment,entry.billing_method) is distinct from 'CONVENIO'
         or (public.billing_payer_key(payer)<>public.billing_payer_key(entry.payer)
             and (appointment->>'insurance' is distinct from previous->>'insurance'
                or nullif(trim(previous->>'insurance'),'') is not null)) then
        raise exception 'NF legada: preserve convênio e forma de cobrança';
      end if;
    end if;
  end loop;

  for entry in
    select b.appointment_id,b.attendance_id,b.professional_id,b.professional_role,r.patient_id,
      (b.professional_role is distinct from 'PRIMARY' or
       exists(select 1 from public.billing_records other
              where other.attendance_id=b.attendance_id and other.id<>b.id)) independent
    from public.invoice_requests r join public.billing_records b on b.id=r.billing_record_id
    where r.status in ('PENDING','ISSUED') and b.appointment_id is not null
  loop
    select value into appointment
    from jsonb_array_elements(coalesce(new.payload->'appointments','[]'::jsonb)||
                              coalesce(new.payload->'cancelledAppointments','[]'::jsonb))
    where value->>'id'=entry.appointment_id;
    select value into previous
    from jsonb_array_elements(coalesce(old.payload->'appointments','[]'::jsonb)||
                              coalesce(old.payload->'cancelledAppointments','[]'::jsonb))
    where value->>'id'=entry.appointment_id;
    -- Só revalidar o atendimento protegido quando ele tiver sido alterado.
    if appointment is not null and appointment is not distinct from previous then continue; end if;
    if appointment is null or appointment->>'patientId' is distinct from entry.patient_id then
      raise exception 'Atendimento com solicitação fiscal: preserve o paciente';
    end if;
    if entry.independent and entry.professional_id is not null then
      if entry.professional_id is distinct from appointment->>'doctorId'
         and entry.professional_id is distinct from appointment->>'anesthetistId' then
        raise exception 'Profissional da solicitação fiscal não participa do atendimento';
      end if;
    elsif appointment->>'forma_cobranca' is distinct from 'PARTICULAR' then
      raise exception 'Solicitação fiscal legada: preserve a forma particular';
    end if;
  end loop;
  return new;
end;
$function$;
