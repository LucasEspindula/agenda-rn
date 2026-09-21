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
