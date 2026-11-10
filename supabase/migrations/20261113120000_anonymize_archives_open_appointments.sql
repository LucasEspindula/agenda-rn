-- Anonimização (LGPD): os agendamentos passados que ficaram em aberto passam a ser arquivados junto
-- com o paciente. Antes ficavam ativos na agenda, apontando para um paciente arquivado, e qualquer
-- edição da secretária falhava com "Histórico sem permissão".
-- O paciente anonimizado não tem atendimento (a função recusa) nem agendamento futuro (idem), então
-- só sobram passados nunca concluídos: nada clínico ou fiscal é perdido.

create or replace function public.anonymize_patient(p_actor bigint,p_org uuid,p_patient text,p_reason text) returns jsonb
language plpgsql set search_path='' as $$
declare paths jsonb; appts text[]; n_docs integer;
begin
 perform pg_advisory_xact_lock(194701,1);
 perform public.require_organization_manager(p_actor,p_org);
 if coalesce(char_length(btrim(p_reason)),0)<10 then raise exception 'Descreva o motivo do pedido (mínimo 10 caracteres)'; end if;
 perform 1 from public.patients where id=p_patient and organization_id=p_org for update;
 if not found then raise exception 'Paciente não encontrado'; end if;
 if exists(select 1 from public.attendances where patient_id=p_patient and organization_id=p_org) then
  raise exception 'Paciente com atendimento realizado: os dados precisam ser mantidos por obrigação legal (prontuário e fiscal). Use a exportação.';
 end if;
 if exists(select 1 from public.appointments where patient_id=p_patient and organization_id=p_org and cancelled_at is null and archived_at is null and date>=current_date) then
  raise exception 'Cancele os agendamentos futuros do paciente antes de anonimizar';
 end if;
 select coalesce(array_agg(id),'{}') into appts from public.appointments where patient_id=p_patient and organization_id=p_org;
 perform public.financial_operation(p_actor,'lgpd',p_patient);
 perform set_config('rn.anonymize','on',true);
 update public.patients set name='Paciente anonimizado',cpf=null,phone=null,email=null,card_number=null,address=null,address_zip=null,
  address_number=null,address_complement=null,address_neighborhood=null,address_city=null,address_state=null,
  newborn=false,guardian_name=null,archived_at=coalesce(archived_at,clock_timestamp()),archived_by=coalesce(archived_by,p_actor)
  where id=p_patient and organization_id=p_org;
 update public.appointments set notes=null,suggested_by_name=null,suggested_by_email=null,reschedule_reason=null,suggestion_reason=null,
  cancel_reason=case when cancel_reason is not null then '[removido por anonimização]' end
  where id=any(appts) and organization_id=p_org;
 -- Agendamentos que ficaram em aberto (passados, nem atendidos nem cancelados) saem da agenda junto
 -- com o paciente; sem isso ficavam órfãos e qualquer edição falhava com "Histórico sem permissão".
 update public.appointments set archived_at=clock_timestamp(),archived_by=p_actor
  where id=any(appts) and organization_id=p_org and cancelled_at is null and archived_at is null;
 update public.patient_history_events set text='[conteúdo removido por anonimização]' where patient_id=p_patient and organization_id=p_org;
 update public.appointment_reschedules set reason='[removido por anonimização]' where appointment_id=any(appts) and organization_id=p_org;
 update public.audit_logs set description='Registro de paciente anonimizado',
  metadata=case when jsonb_typeof(metadata)='object' then metadata
   ||case when metadata ? 'before' then jsonb_build_object('before',public.anonymized_appointment_json(metadata->'before')) else '{}'::jsonb end
   ||case when metadata ? 'after' then jsonb_build_object('after',public.anonymized_appointment_json(metadata->'after')) else '{}'::jsonb end
   else metadata end
  where organization_id=p_org and (patient_id=p_patient or appointment_id=any(appts));
 update public.agenda_requests set
  proposed_payload=public.anonymized_appointment_json(proposed_payload),
  previous_payload=public.anonymized_appointment_json(previous_payload)
  where organization_id=p_org and appointment_id=any(appts);
 -- Versões antigas usadas no merge também guardavam os dados pessoais.
 update public.agenda_row_versions set data=public.agenda_row_json('patients',p_patient,p_org)
  where organization_id=p_org and entity='patients' and row_id=p_patient;
 update public.agenda_row_versions set data=public.anonymized_appointment_json(data)
  where organization_id=p_org and entity='appointments' and row_id=any(appts);
 with gone as (delete from public.surgery_documents where patient_id=p_patient and organization_id=p_org returning object_path)
 select coalesce(jsonb_agg(object_path),'[]'::jsonb),count(*) into paths,n_docs from gone;
 update public.agenda_settings set revision=date_trunc('milliseconds',greatest(clock_timestamp(),revision+interval '1 millisecond')) where organization_id=p_org;
 perform set_config('rn.anonymize','',true);
 perform public.record_security_event(p_org,p_actor,'patient_anonymized',p_patient,jsonb_build_object('reason',left(btrim(p_reason),500),'appointments',coalesce(array_length(appts,1),0),'documents',n_docs),null);
 perform set_config('rn.operation','',true); perform set_config('rn.actor','',true); perform set_config('rn.organization','',true);
 return jsonb_build_object('objectPaths',paths,'appointments',coalesce(array_length(appts,1),0),'documents',n_docs);
end;$$;

-- Correção dos órfãos já existentes: pacientes anonimizados antes desta versão.
do $$
declare orgs uuid[];
begin
 with fixed as (
  update public.appointments a set archived_at=clock_timestamp()
   from public.patients p
   where p.id=a.patient_id and p.organization_id=a.organization_id
     and p.archived_at is not null and p.name='Paciente anonimizado'
     and a.cancelled_at is null and a.archived_at is null and a.date<current_date
     and not exists(select 1 from public.attendances t where t.appointment_id=a.id)
   returning a.organization_id)
 select coalesce(array_agg(distinct organization_id),'{}') into orgs from fixed;
 -- Nova revisão para as abas abertas recarregarem a agenda sem o órfão.
 update public.agenda_settings set revision=date_trunc('milliseconds',greatest(clock_timestamp(),revision+interval '1 millisecond'))
  where organization_id=any(orgs);
end;$$;
