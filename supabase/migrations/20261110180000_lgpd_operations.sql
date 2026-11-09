-- LGPD e operação: exportação e anonimização de paciente, eventos de segurança,
-- manutenção diária e verificação de saúde.
-- A organização é a controladora dos dados de pacientes; a gerência executa os pedidos
-- dos titulares. Dados com obrigação legal de guarda (atendimento realizado → prontuário
-- e fiscal) não são anonimizados (LGPD art. 16, I).

-- 1. Eventos de segurança (somente acréscimo; limpeza só pela manutenção, após 1 ano).
create table if not exists public.security_events(
 id bigserial primary key,
 organization_id uuid references public.organizations(id),
 actor_user_id bigint references public.users(id),
 kind text not null check (kind in ('login_success','login_failure','login_unverified','password_reset','invite_accepted',
   'organization_switch','patient_export','patient_anonymized')),
 target text,
 details jsonb not null default '{}'::jsonb,
 ip_hash text,
 created_at timestamptz not null default now()
);
create index if not exists security_events_org_created_idx on public.security_events(organization_id,created_at desc);
create index if not exists security_events_created_idx on public.security_events(created_at);
alter table public.security_events enable row level security;
revoke all on public.security_events from public,anon,authenticated;
grant select,insert,delete on public.security_events to service_role;

create or replace function public.guard_security_event() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then raise exception 'Evento de segurança é imutável'; end if;
 if tg_op='DELETE' and coalesce(current_setting('rn.maintenance',true),'')<>'on' then raise exception 'Evento de segurança é imutável'; end if;
 return coalesce(new,old);
end;$$;
drop trigger if exists guard_security_event on public.security_events;
create trigger guard_security_event before update or delete on public.security_events for each row execute function public.guard_security_event();

create or replace function public.record_security_event(p_org uuid,p_actor bigint,p_kind text,p_target text,p_details jsonb,p_ip_hash text) returns void
language sql set search_path='' as $$
 insert into public.security_events(organization_id,actor_user_id,kind,target,details,ip_hash)
 values(p_org,p_actor,p_kind,left(p_target,200),coalesce(p_details,'{}'::jsonb),left(p_ip_hash,128))
$$;

-- 2. Histórico continua imutável, exceto dentro da anonimização (rn.anonymize).
create or replace function public.guard_agenda_row() returns trigger
language plpgsql set search_path='' as $$
declare ctx uuid:=public.current_organization_id();
        actor bigint:=nullif(current_setting('rn.actor',true),'')::bigint;
begin
 if tg_op='DELETE' then
  if ctx is not null and old.organization_id<>ctx then raise exception 'Registro fora da organização atual'; end if;
  if tg_table_name in ('schedule_blocks','scheduling_rules') then return old; end if;
  raise exception 'Exclusão direta bloqueada; use o arquivamento.';
 end if;
 if tg_op='INSERT' then
  new.organization_id:=coalesce(new.organization_id,ctx);
  if new.organization_id is null then raise exception 'Registro sem organização'; end if;
  if ctx is not null and new.organization_id<>ctx then raise exception 'Registro fora da organização atual'; end if;
  if coalesce(current_setting('rn.agenda_migration',true),'')<>'on'
    and new.id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception 'Identificador inválido';
  end if;
  new.created_at:=clock_timestamp(); new.created_by:=coalesce(new.created_by,actor);
  new.updated_at:=new.created_at; new.updated_by:=coalesce(new.updated_by,new.created_by);
  new.row_version:=1;
  return new;
 end if;
 if tg_table_name in ('patient_history_events','appointment_reschedules') and coalesce(current_setting('rn.anonymize',true),'')<>'on' then
  raise exception 'Histórico é imutável';
 end if;
 if new.organization_id is distinct from old.organization_id or new.id is distinct from old.id then
  raise exception 'Alteração de organização ou identificador não permitida';
 end if;
 if ctx is not null and old.organization_id<>ctx then raise exception 'Registro fora da organização atual'; end if;
 new.created_at:=old.created_at; new.created_by:=old.created_by;
 new.updated_at:=clock_timestamp(); new.updated_by:=coalesce(actor,old.updated_by);
 new.row_version:=old.row_version+1;
 return new;
end;$$;

create or replace function public.require_organization_manager(p_actor bigint,p_org uuid) returns void
language plpgsql set search_path='' as $$
begin
 perform public.use_organization(p_actor,p_org);
 if not exists(select 1 from public.users u join public.organization_memberships m on m.user_id=u.id and m.organization_id=p_org and m.active and m.role='general_manager'
   where u.id=p_actor and u.role='general_manager' and u.active) then raise exception 'Acesso restrito à gerência'; end if;
end;$$;

-- 3. Exportação (pedido de acesso do titular): tudo o que o sistema guarda do paciente.
create or replace function public.export_patient_data(p_actor bigint,p_org uuid,p_patient text) returns jsonb
language plpgsql set search_path='' as $$
declare p public.patients%rowtype; result jsonb;
begin
 perform public.require_organization_manager(p_actor,p_org);
 select * into p from public.patients where id=p_patient and organization_id=p_org;
 if not found then raise exception 'Paciente não encontrado'; end if;
 result:=jsonb_build_object(
  'exportedAt',now(),
  'organization',(select name from public.organizations where id=p_org),
  'patient',to_jsonb(p)-'organization_id'-'row_version',
  'appointments',coalesce((select jsonb_agg((to_jsonb(a)-'organization_id'-'row_version')||jsonb_build_object(
     'professional',(select name from public.doctors where id=a.professional_id),
     'anesthetist',(select name from public.doctors where id=a.anesthetist_id),
     'hospital',(select name from public.hospitals where id=a.hospital_id and organization_id=p_org)) order by a.date,a.time)
   from public.appointments a where a.patient_id=p_patient and a.organization_id=p_org),'[]'::jsonb),
  'reschedules',coalesce((select jsonb_agg(to_jsonb(r)-'organization_id'-'row_version' order by r.appointment_id,r.position)
   from public.appointment_reschedules r join public.appointments a on a.id=r.appointment_id and a.organization_id=p_org
   where a.patient_id=p_patient and r.organization_id=p_org),'[]'::jsonb),
  'history',coalesce((select jsonb_agg(jsonb_build_object('type',h.type,'text',h.text,'at',h.at,'appointmentId',h.appointment_id) order by h.at)
   from public.patient_history_events h where h.patient_id=p_patient and h.organization_id=p_org),'[]'::jsonb),
  'documents',coalesce((select jsonb_agg(jsonb_build_object('name',d.name,'category',d.category,'size',d.size,'createdAt',d.created_at,'appointmentId',d.appointment_id) order by d.created_at)
   from public.surgery_documents d where d.patient_id=p_patient and d.organization_id=p_org and d.status='ready'),'[]'::jsonb));
 perform public.record_security_event(p_org,p_actor,'patient_export',p_patient,'{}'::jsonb,null);
 perform set_config('rn.organization','',true);
 return result;
end;$$;

-- 4. Anonimização (pedido de eliminação do titular), quando não há obrigação de guarda.
-- Cópia de consulta em JSON (versões, auditoria, solicitações) sem texto livre do paciente.
create or replace function public.anonymized_appointment_json(p_data jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select case when p_data is null or jsonb_typeof(p_data)<>'object' then p_data else
  (p_data-'notes'-'suggestedByName'-'suggestedByEmail'-'rescheduleReason'-'suggestionReason'-'cancelReason'-'rescheduleHistory')
  ||case when p_data ? 'cancelReason' then jsonb_build_object('cancelReason','[removido por anonimização]') else '{}'::jsonb end
  ||case when jsonb_typeof(p_data->'rescheduleHistory')='array' then jsonb_build_object('rescheduleHistory',coalesce((select jsonb_agg(
      case when jsonb_typeof(e)='object' then e||'{"reason":"[removido por anonimização]"}'::jsonb else e end) from jsonb_array_elements(p_data->'rescheduleHistory') e),'[]'::jsonb))
    else '{}'::jsonb end
 end
$$;

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

-- 5. Manutenção diária e saúde.
create or replace function public.run_maintenance() returns jsonb
language plpgsql set search_path='' as $$
declare s integer; t integer; r integer; e integer;
begin
 delete from public.sessions where expires_at<now()-interval '1 day'; get diagnostics s=row_count;
 delete from public.auth_tokens where expires_at<now()-interval '30 days'; get diagnostics t=row_count;
 delete from public.security_rate_limits where expires_at<now(); get diagnostics r=row_count;
 perform set_config('rn.maintenance','on',true);
 delete from public.security_events where created_at<now()-interval '365 days'; get diagnostics e=row_count;
 perform set_config('rn.maintenance','',true);
 return jsonb_build_object('sessions',s,'tokens',t,'rateLimits',r,'securityEvents',e);
end;$$;

create or replace function public.health_check() returns jsonb
language sql stable set search_path='' as $$ select jsonb_build_object('db','ok','at',now()) $$;

revoke all on function public.anonymized_appointment_json(jsonb),public.record_security_event(uuid,bigint,text,text,jsonb,text),public.require_organization_manager(bigint,uuid),
 public.export_patient_data(bigint,uuid,text),public.anonymize_patient(bigint,uuid,text,text),public.run_maintenance(),public.health_check(),
 public.guard_security_event() from public,anon,authenticated;
grant execute on function public.anonymized_appointment_json(jsonb),public.record_security_event(uuid,bigint,text,text,jsonb,text),public.require_organization_manager(bigint,uuid),
 public.export_patient_data(bigint,uuid,text),public.anonymize_patient(bigint,uuid,text,text),public.run_maintenance(),public.health_check()
 to service_role;
