-- Desempenho da agenda: montar o estado ficou ~4x mais barato (completa 162 → 40 ms; janela 133 → 37 ms).
-- As funções por linha (agenda_appointment_json, agenda_iso, agenda_hhmi...) têm set search_path,
-- e o Postgres nunca incorpora função com SET na consulta: cada linha virava várias chamadas de
-- função completas (um bloqueio = 3, um agendamento = 4 + subconsulta). Aqui o mesmo JSON é
-- escrito direto na consulta, numa única função usada pela agenda completa e pela janela.
-- O resultado é idêntico (conferido no banco e em tests/agenda-normalized-db.test.mjs).
-- As funções por linha continuam existindo para os demais usos (agenda_row_json, versões).

create or replace function public.agenda_state_json(p_org uuid,p_since date) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('revision',to_char(s.revision at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'state',jsonb_build_object(
  'schemaVersion',7,
  'settings',jsonb_build_object('workStart',to_char(s.work_start,'HH24:MI'),'workEnd',to_char(s.work_end,'HH24:MI')),
  'professionals',coalesce((select jsonb_agg(coalesce(d.details,'{}'::jsonb)||jsonb_build_object('id',d.id,'name',d.name,'crm',coalesce(d.crm,''),
     'specialty',coalesce(d.specialty,''),'category',d.category,'active',d.active,'scheduling_enabled',d.scheduling_enabled,
     'billing_enabled',d.billing_enabled,'invoice_enabled',d.invoice_enabled,
     'agendaEnabled',coalesce(a.active,false) and d.scheduling_enabled,'agendaSettings',coalesce(a.settings,'{}'::jsonb)) order by d.name)
   from public.doctors d left join public.doctor_agendas a on a.doctor_id=d.id where d.organization_id=p_org),'[]'::jsonb),
  'hospitals',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'name',h.name,'abbreviation',coalesce(h.abbreviation,'')) order by h.name)
   from public.hospitals h where h.organization_id=p_org and h.archived_at is null),'[]'::jsonb),
  'patients',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'doctorId',p.owner_professional_id,'name',p.name,'cpf',coalesce(p.cpf,''),
     'phone',coalesce(p.phone,''),'email',coalesce(p.email,''),'insurance',coalesce(p.insurance,''),'cardNumber',coalesce(p.card_number,''),
     'address',coalesce(p.address,''),'addressZip',coalesce(p.address_zip,''),'addressNumber',coalesce(p.address_number,''),
     'addressComplement',coalesce(p.address_complement,''),'addressNeighborhood',coalesce(p.address_neighborhood,''),
     'addressCity',coalesce(p.address_city,''),'addressState',coalesce(p.address_state,''),
     'newborn',p.newborn,'guardianName',coalesce(p.guardian_name,''),
     'created_at',to_char(p.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'created_by',p.created_by,
     'updated_at',to_char(p.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updated_by',p.updated_by) order by p.name,p.id)
   from public.patients p where p.organization_id=p_org and p.archived_at is null),'[]'::jsonb),
  'appointments',coalesce((select jsonb_agg(x.j order by x.date,x.time,x.id) from (
    select a.date,a.time,a.id,jsonb_strip_nulls(jsonb_build_object(
      'cancelledAt',to_char(a.cancelled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'cancelReason',a.cancel_reason,
      'statusUpdatedAt',to_char(a.status_updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'suggestedByName',a.suggested_by_name,
      'suggestedByEmail',a.suggested_by_email,'insurance',a.insurance,'forma_cobranca',a.billing_method))
     ||jsonb_build_object('id',a.id,'doctorId',coalesce(a.professional_id,''),'anesthetistId',a.anesthetist_id,'patientId',coalesce(a.patient_id,''),
      'hospitalId',coalesce(a.hospital_id,''),'date',to_char(a.date,'YYYY-MM-DD'),'time',to_char(a.time,'HH24:MI'),'duration',a.duration_min,
      'status',a.status,'careType',a.care_type,'procedure',a.procedure,'guideExpiry',coalesce(a.guide_expiry,''),
      'opme',a.opme,'reports',a.reports,'exams',a.exams,'notes',coalesce(a.notes,''),
      'rescheduleReason',coalesce(a.reschedule_reason,''),'suggestionReason',coalesce(a.suggestion_reason,''),
      'rescheduleHistory',coalesce(rh.items,'[]'::jsonb)) j
    from public.appointments a
    left join lateral (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('fromDate',r.from_date,'fromTime',r.from_time,
       'toDate',r.to_date,'toTime',r.to_time,'reason',r.reason,'proposedBy',r.proposed_by,'createdAt',r.proposed_at)) order by r.position) items
      from public.appointment_reschedules r where r.appointment_id=a.id) rh on true
    where a.organization_id=p_org and a.cancelled_at is null and a.archived_at is null and (p_since is null or a.date>=p_since)) x),'[]'::jsonb),
  'cancelledAppointments',coalesce((select jsonb_agg(x.j order by x.cancelled_at,x.id) from (
    select a.cancelled_at,a.id,jsonb_strip_nulls(jsonb_build_object(
      'cancelledAt',to_char(a.cancelled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'cancelReason',a.cancel_reason,
      'statusUpdatedAt',to_char(a.status_updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'suggestedByName',a.suggested_by_name,
      'suggestedByEmail',a.suggested_by_email,'insurance',a.insurance,'forma_cobranca',a.billing_method))
     ||jsonb_build_object('id',a.id,'doctorId',coalesce(a.professional_id,''),'anesthetistId',a.anesthetist_id,'patientId',coalesce(a.patient_id,''),
      'hospitalId',coalesce(a.hospital_id,''),'date',to_char(a.date,'YYYY-MM-DD'),'time',to_char(a.time,'HH24:MI'),'duration',a.duration_min,
      'status',a.status,'careType',a.care_type,'procedure',a.procedure,'guideExpiry',coalesce(a.guide_expiry,''),
      'opme',a.opme,'reports',a.reports,'exams',a.exams,'notes',coalesce(a.notes,''),
      'rescheduleReason',coalesce(a.reschedule_reason,''),'suggestionReason',coalesce(a.suggestion_reason,''),
      'rescheduleHistory',coalesce(rh.items,'[]'::jsonb)) j
    from public.appointments a
    left join lateral (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('fromDate',r.from_date,'fromTime',r.from_time,
       'toDate',r.to_date,'toTime',r.to_time,'reason',r.reason,'proposedBy',r.proposed_by,'createdAt',r.proposed_at)) order by r.position) items
      from public.appointment_reschedules r where r.appointment_id=a.id) rh on true
    where a.organization_id=p_org and a.cancelled_at is not null and a.archived_at is null and (p_since is null or a.date>=p_since)) x),'[]'::jsonb),
  'patientHistory',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'patientId',h.patient_id,'appointmentId',h.appointment_id,'type',h.type,'text',h.text,
     'at',to_char(h.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by h.at,h.id)
   from public.patient_history_events h
   where h.organization_id=p_org and (p_since is null or h.at>=p_since::timestamptz or exists (select 1 from public.appointments a
     where a.organization_id=p_org and a.id=h.appointment_id and a.date>=p_since))),'[]'::jsonb),
  'schedulingRules',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'professionalId',r.professional_id,'hospitalId',r.hospital_id,'name',r.name,'severity',r.severity,
     'weekday',coalesce(r.weekday::text,''),'occurrence',coalesce(r.occurrence,''),
     'start',coalesce(to_char(r.start_time,'HH24:MI'),''),'end',coalesce(to_char(r.end_time,'HH24:MI'),''),
     'maxPatients',r.max_patients,'procedureContains',r.procedure_contains,
     'preferredTimes',array_to_string(array(select to_char(t,'HH24:MI') from unnest(r.preferred_times) t),','),
     'forbiddenTimes',array_to_string(array(select to_char(t,'HH24:MI') from unnest(r.forbidden_times) t),','),
     'blockAllDay',r.block_all_day,'enabled',r.enabled) order by r.created_at,r.id)
   from public.scheduling_rules r where r.organization_id=p_org),'[]'::jsonb),
  'scheduleBlocks',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'professionalId',b.professional_id,'hospitalId',null,'date',to_char(b.date,'YYYY-MM-DD'),
     'start',to_char(b.start_time,'HH24:MI'),'end',to_char(b.end_time,'HH24:MI'),'reason',b.reason) order by b.date,b.start_time,b.id)
   from public.schedule_blocks b where b.organization_id=p_org),'[]'::jsonb)
 ))
 from public.agenda_settings s where s.organization_id=p_org
$$;

create or replace function public.load_agenda_state(p_actor bigint) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 return public.agenda_state_json(public.require_rn_agenda_actor_organization(p_actor),null);
end;$$;

create or replace function public.load_agenda_window(p_actor bigint,p_since date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 return public.agenda_state_json(public.require_rn_agenda_actor_organization(p_actor),p_since);
end;$$;

revoke all on function public.agenda_state_json(uuid,date) from public,anon,authenticated;
grant execute on function public.agenda_state_json(uuid,date) to service_role;
revoke all on function public.load_agenda_state(bigint) from public,anon,authenticated;
grant execute on function public.load_agenda_state(bigint) to service_role;
revoke all on function public.load_agenda_window(bigint,date) from public,anon,authenticated;
grant execute on function public.load_agenda_window(bigint,date) to service_role;
