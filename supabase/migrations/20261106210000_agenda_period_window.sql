-- Agenda por período: o navegador recebe as consultas (ativas e canceladas) com data
-- a partir de p_since e o histórico desse período, em vez da agenda inteira.
-- p_since nulo = agenda completa (mesmo resultado de load_agenda_state).
-- Pacientes, profissionais, hospitais, regras e bloqueios continuam completos:
-- regras/bloqueios/hospitais são removíveis por ausência no merge e precisam vir inteiros.
-- Gravações continuam seguras: o servidor carrega o estado completo e nunca remove
-- pacientes, consultas ou histórico por ausência (lib/agenda/diff.ts, lib/security/state.ts).

create index if not exists appointments_org_date_idx on public.appointments(organization_id,date);
create index if not exists patient_history_org_at_idx on public.patient_history_events(organization_id,at);

create or replace function public.load_agenda_window(p_actor bigint,p_since date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare org uuid:=public.require_rn_agenda_actor_organization(p_actor); s public.agenda_settings%rowtype;
begin
 if p_since is null then return public.load_agenda_state(p_actor); end if;
 select * into s from public.agenda_settings where organization_id=org;
 return jsonb_build_object('revision',public.agenda_iso(s.revision),'state',jsonb_build_object(
  'schemaVersion',7,
  'settings',jsonb_build_object('workStart',public.agenda_hhmi(s.work_start),'workEnd',public.agenda_hhmi(s.work_end)),
  'professionals',coalesce((select jsonb_agg(coalesce(d.details,'{}'::jsonb)||jsonb_build_object('id',d.id,'name',d.name,'crm',coalesce(d.crm,''),
     'specialty',coalesce(d.specialty,''),'category',d.category,'active',d.active,'scheduling_enabled',d.scheduling_enabled,
     'billing_enabled',d.billing_enabled,'invoice_enabled',d.invoice_enabled,
     'agendaEnabled',coalesce(a.active,false) and d.scheduling_enabled,'agendaSettings',coalesce(a.settings,'{}'::jsonb)) order by d.name)
   from public.doctors d left join public.doctor_agendas a on a.doctor_id=d.id where d.organization_id=org),'[]'::jsonb),
  'hospitals',coalesce((select jsonb_agg(public.agenda_hospital_json(h) order by h.name) from public.hospitals h where h.organization_id=org and h.archived_at is null),'[]'::jsonb),
  'patients',coalesce((select jsonb_agg(public.agenda_patient_json(p) order by p.name,p.id) from public.patients p where p.organization_id=org and p.archived_at is null),'[]'::jsonb),
  'appointments',coalesce((select jsonb_agg(public.agenda_appointment_json(a) order by a.date,a.time,a.id) from public.appointments a
     where a.organization_id=org and a.cancelled_at is null and a.archived_at is null and a.date>=p_since),'[]'::jsonb),
  'cancelledAppointments',coalesce((select jsonb_agg(public.agenda_appointment_json(a) order by a.cancelled_at,a.id) from public.appointments a
     where a.organization_id=org and a.cancelled_at is not null and a.archived_at is null and a.date>=p_since),'[]'::jsonb),
  'patientHistory',coalesce((select jsonb_agg(public.agenda_history_json(h) order by h.at,h.id) from public.patient_history_events h
     where h.organization_id=org and (h.at>=p_since::timestamptz or exists (select 1 from public.appointments a
       where a.organization_id=org and a.id=h.appointment_id and a.date>=p_since))),'[]'::jsonb),
  'schedulingRules',coalesce((select jsonb_agg(public.agenda_rule_json(r) order by r.created_at,r.id) from public.scheduling_rules r where r.organization_id=org),'[]'::jsonb),
  'scheduleBlocks',coalesce((select jsonb_agg(public.agenda_block_json(b) order by b.date,b.start_time,b.id) from public.schedule_blocks b where b.organization_id=org),'[]'::jsonb)
 ));
end;$$;

revoke all on function public.load_agenda_window(bigint,date) from public,anon,authenticated;
grant execute on function public.load_agenda_window(bigint,date) to service_role;
