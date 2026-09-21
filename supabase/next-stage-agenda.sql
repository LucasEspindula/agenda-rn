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
