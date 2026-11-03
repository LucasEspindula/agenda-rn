-- Etapa A1: agenda normalizada em tabelas próprias (corte direto).
-- A agenda é dona de pacientes, consultas, bloqueios, regras e hospitais.
-- O faturamento só recebe dados por public.attendances e fica desligado até
-- ser reconstruído; app_state fica congelado até a etapa A2.

-- ---------------------------------------------------------------------------
-- Organização única (Fase 2B pausada)
-- ---------------------------------------------------------------------------
create or replace function public.rn_agenda_organization_id() returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare rn_org_id uuid;
begin
 select id into rn_org_id from public.organizations where slug='rn-gestao' and active;
 if rn_org_id is null or (select count(*) from public.organizations)<>1 then
  raise exception 'Organização de operação inválida. Acesso bloqueado';
 end if;
 return rn_org_id;
end;$$;

create unique index if not exists doctors_organization_id_id_key on public.doctors(organization_id,id);

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table public.agenda_settings(
 organization_id uuid primary key references public.organizations(id),
 work_start time not null default '07:00',
 work_end time not null default '19:00',
 timezone text not null default 'America/Sao_Paulo',
 revision timestamptz not null default date_trunc('milliseconds',clock_timestamp()),
 created_at timestamptz not null default now(), created_by bigint,
 updated_at timestamptz not null default now(), updated_by bigint,
 row_version integer not null default 1,
 check (work_start<work_end)
);

create table public.hospitals(
 id text primary key,
 organization_id uuid not null references public.organizations(id),
 name text not null check (char_length(btrim(name)) between 1 and 300),
 abbreviation text check (abbreviation is null or char_length(abbreviation)<=16),
 archived_at timestamptz, archived_by bigint,
 created_at timestamptz not null default now(), created_by bigint,
 updated_at timestamptz not null default now(), updated_by bigint,
 row_version integer not null default 1,
 unique (organization_id,id)
);
create unique index hospitals_active_name_key on public.hospitals(organization_id,lower(btrim(name))) where archived_at is null;

create table public.patients(
 id text primary key,
 organization_id uuid not null references public.organizations(id),
 owner_professional_id text not null,
 name text not null check (char_length(btrim(name)) between 1 and 300),
 cpf text check (cpf ~ '^[0-9]{11}$'),
 phone text, email text, insurance text, card_number text,
 address text, address_zip text, address_number text, address_complement text,
 address_neighborhood text, address_city text, address_state text,
 newborn boolean not null default false,
 guardian_name text,
 archived_at timestamptz, archived_by bigint,
 created_at timestamptz not null default now(), created_by bigint,
 updated_at timestamptz not null default now(), updated_by bigint,
 row_version integer not null default 1,
 unique (organization_id,id),
 foreign key (organization_id,owner_professional_id) references public.doctors(organization_id,id),
 check (not newborn or nullif(btrim(guardian_name),'') is not null)
);
create unique index patients_owner_cpf_key on public.patients(organization_id,owner_professional_id,cpf)
 where cpf is not null and not newborn;
create index patients_owner_idx on public.patients(organization_id,owner_professional_id);

create table public.appointments(
 id text primary key,
 organization_id uuid not null references public.organizations(id),
 professional_id text,
 anesthetist_id text,
 patient_id text,
 hospital_id text,
 date date not null,
 time time not null,
 duration_min integer not null check (duration_min between 1 and 1440),
 status text not null check (status in ('scheduled','confirmed','authorized','analysis','realized')),
 care_type text not null default 'outpatient' check (care_type in ('outpatient','inpatient')),
 procedure text not null default 'Procedimento',
 insurance text,
 billing_method text check (billing_method in ('PARTICULAR','CONVENIO')),
 guide_expiry text,
 opme boolean not null default false,
 reports boolean not null default false,
 exams boolean not null default false,
 notes text,
 status_updated_at timestamptz,
 reschedule_reason text,
 suggestion_reason text,
 suggested_by_name text,
 suggested_by_email text,
 cancelled_at timestamptz, cancel_reason text, cancelled_by bigint,
 archived_at timestamptz, archived_by bigint,
 created_at timestamptz not null default now(), created_by bigint,
 updated_at timestamptz not null default now(), updated_by bigint,
 row_version integer not null default 1,
 unique (organization_id,id),
 check (professional_id is not null or anesthetist_id is not null),
 check (cancelled_at is null or nullif(btrim(cancel_reason),'') is not null),
 foreign key (organization_id,professional_id) references public.doctors(organization_id,id),
 foreign key (organization_id,anesthetist_id) references public.doctors(organization_id,id),
 foreign key (organization_id,patient_id) references public.patients(organization_id,id),
 foreign key (organization_id,hospital_id) references public.hospitals(organization_id,id)
);
create index appointments_professional_day_idx on public.appointments(organization_id,professional_id,date);
create index appointments_anesthetist_day_idx on public.appointments(organization_id,anesthetist_id,date);
create index appointments_patient_idx on public.appointments(organization_id,patient_id);

create table public.appointment_reschedules(
 id text primary key,
 organization_id uuid not null references public.organizations(id),
 appointment_id text not null,
 position integer not null check (position>=0),
 from_date text, from_time text, to_date text, to_time text,
 reason text, proposed_by text, proposed_at text,
 created_at timestamptz not null default now(), created_by bigint,
 updated_at timestamptz not null default now(), updated_by bigint,
 row_version integer not null default 1,
 unique (organization_id,id),
 unique (appointment_id,position),
 foreign key (organization_id,appointment_id) references public.appointments(organization_id,id)
);

create table public.patient_history_events(
 id text primary key,
 organization_id uuid not null references public.organizations(id),
 patient_id text not null,
 appointment_id text,
 type text not null check (char_length(type) between 1 and 200),
 text text not null default '',
 at timestamptz not null,
 actor_user_id bigint,
 created_at timestamptz not null default now(), created_by bigint,
 updated_at timestamptz not null default now(), updated_by bigint,
 row_version integer not null default 1,
 unique (organization_id,id),
 foreign key (organization_id,patient_id) references public.patients(organization_id,id)
);
create index patient_history_patient_idx on public.patient_history_events(organization_id,patient_id,at);

create table public.schedule_blocks(
 id text primary key,
 organization_id uuid not null references public.organizations(id),
 professional_id text not null,
 hospital_id text,
 date date not null,
 start_time time not null,
 end_time time not null,
 reason text not null check (char_length(btrim(reason)) between 1 and 1000),
 created_at timestamptz not null default now(), created_by bigint,
 updated_at timestamptz not null default now(), updated_by bigint,
 row_version integer not null default 1,
 unique (organization_id,id),
 check (start_time<end_time),
 foreign key (organization_id,professional_id) references public.doctors(organization_id,id),
 foreign key (organization_id,hospital_id) references public.hospitals(organization_id,id)
);
create index schedule_blocks_day_idx on public.schedule_blocks(organization_id,professional_id,date);

create table public.scheduling_rules(
 id text primary key,
 organization_id uuid not null references public.organizations(id),
 professional_id text not null,
 hospital_id text,
 name text not null default '',
 severity text not null default 'preference',
 weekday smallint check (weekday between 0 and 6),
 occurrence text check (occurrence in ('1','2','3','4','5','last')),
 start_time time,
 end_time time,
 max_patients integer check (max_patients is null or max_patients>=0),
 procedure_contains text not null default '',
 preferred_times time[] not null default '{}',
 forbidden_times time[] not null default '{}',
 block_all_day boolean not null default false,
 enabled boolean not null default true,
 created_at timestamptz not null default now(), created_by bigint,
 updated_at timestamptz not null default now(), updated_by bigint,
 row_version integer not null default 1,
 unique (organization_id,id),
 foreign key (organization_id,professional_id) references public.doctors(organization_id,id),
 foreign key (organization_id,hospital_id) references public.hospitals(organization_id,id)
);

-- Versão de cada linha no formato legado, com a revisão global em que foi
-- gravada: base do merge de três vias do PUT legado (concorrência por registro).
create table public.agenda_row_versions(
 organization_id uuid not null references public.organizations(id),
 entity text not null check (entity in ('patients','appointments','hospitals','scheduleBlocks','schedulingRules')),
 row_id text not null,
 row_version integer not null,
 revision timestamptz not null,
 data jsonb,
 primary key (entity,row_id,row_version)
);
create index agenda_row_versions_revision_idx on public.agenda_row_versions(entity,row_id,revision desc);

-- ---------------------------------------------------------------------------
-- Guards genéricos: organização, formato de id, versão, imutabilidade
-- ---------------------------------------------------------------------------
create or replace function public.guard_agenda_row() returns trigger
language plpgsql security invoker set search_path='' as $$
declare rn_org_id uuid:=public.rn_agenda_organization_id();
        actor bigint:=nullif(current_setting('rn.actor',true),'')::bigint;
begin
 if tg_op='DELETE' then
  if tg_table_name in ('schedule_blocks','scheduling_rules') then return old; end if;
  raise exception 'Exclusão direta bloqueada; use o arquivamento.';
 end if;
 if tg_op='INSERT' then
  new.organization_id:=coalesce(new.organization_id,rn_org_id);
  if new.organization_id<>rn_org_id then raise exception 'Registro fora da organização atual'; end if;
  if coalesce(current_setting('rn.agenda_migration',true),'')<>'on'
    and new.id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception 'Identificador inválido';
  end if;
  new.created_at:=clock_timestamp(); new.created_by:=coalesce(new.created_by,actor);
  new.updated_at:=new.created_at; new.updated_by:=coalesce(new.updated_by,new.created_by);
  new.row_version:=1;
  return new;
 end if;
 if tg_table_name in ('patient_history_events','appointment_reschedules') then
  raise exception 'Histórico é imutável';
 end if;
 if new.organization_id is distinct from old.organization_id or new.id is distinct from old.id then
  raise exception 'Alteração de organização ou identificador não permitida';
 end if;
 new.created_at:=old.created_at; new.created_by:=old.created_by;
 new.updated_at:=clock_timestamp(); new.updated_by:=coalesce(actor,old.updated_by);
 new.row_version:=old.row_version+1;
 return new;
end;$$;

create or replace function public.guard_agenda_settings_row() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Configuração da agenda não pode ser excluída'; end if;
 if new.organization_id<>public.rn_agenda_organization_id() then raise exception 'Registro fora da organização atual'; end if;
 if tg_op='UPDATE' then new.row_version:=old.row_version+1; new.updated_at:=clock_timestamp(); end if;
 return new;
end;$$;

create trigger a_guard_agenda_settings before insert or update or delete on public.agenda_settings for each row execute function public.guard_agenda_settings_row();
create trigger a_guard_agenda_row before insert or update or delete on public.hospitals for each row execute function public.guard_agenda_row();
create trigger a_guard_agenda_row before insert or update or delete on public.patients for each row execute function public.guard_agenda_row();
create trigger a_guard_agenda_row before insert or update or delete on public.appointments for each row execute function public.guard_agenda_row();
create trigger a_guard_agenda_row before insert or update or delete on public.appointment_reschedules for each row execute function public.guard_agenda_row();
create trigger a_guard_agenda_row before insert or update or delete on public.patient_history_events for each row execute function public.guard_agenda_row();
create trigger a_guard_agenda_row before insert or update or delete on public.schedule_blocks for each row execute function public.guard_agenda_row();
create trigger a_guard_agenda_row before insert or update or delete on public.scheduling_rules for each row execute function public.guard_agenda_row();

-- ---------------------------------------------------------------------------
-- Pacientes: autoria e dono permanente
-- ---------------------------------------------------------------------------
create or replace function public.guard_patient_row() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.created_by is null then raise exception 'Cadastro de paciente exige autoria'; end if;
 new.guardian_name:=nullif(btrim(coalesce(new.guardian_name,'')),'');
 if not new.newborn then new.guardian_name:=null; end if;
 if tg_op='UPDATE' and new.owner_professional_id is distinct from old.owner_professional_id then
  -- Correção de cadastro feito no médico errado: só sem consultas e sem
  -- histórico clínico (eventos ligados a consultas).
  if exists(select 1 from public.appointments a where a.patient_id=old.id)
    or exists(select 1 from public.patient_history_events h where h.patient_id=old.id and h.appointment_id is not null) then
   raise exception 'O médico responsável não pode ser alterado: o paciente já possui consultas ou histórico.';
  end if;
 end if;
 return new;
end;$$;
create trigger b_guard_patient before insert or update on public.patients for each row execute function public.guard_patient_row();

-- ---------------------------------------------------------------------------
-- Consultas: médicos, dono do paciente, convênio e disponibilidade
-- ---------------------------------------------------------------------------
create or replace function public.guard_appointment_row() returns trigger
language plpgsql security invoker set search_path='' as $$
declare owner text; patient_insurance text;
begin
 if coalesce(current_setting('rn.agenda_migration',true),'')='on' then return new; end if;
 if tg_op='INSERT' or new.professional_id is distinct from old.professional_id or new.anesthetist_id is distinct from old.anesthetist_id then
  if new.anesthetist_id is not null and not exists(select 1 from public.doctors where id=new.anesthetist_id and public.is_anesthesiologist(specialty)) then
   raise exception 'Selecione um médico com especialidade Anestesiologia';
  end if;
  if exists(select 1 from unnest(array[new.professional_id,new.anesthetist_id]) p(id) where p.id is not null
     and not exists(select 1 from public.doctors d where d.id=p.id and d.active)) then
   raise exception 'Médico inexistente ou inativo';
  end if;
  if not exists(select 1 from public.doctor_agendas a join public.doctors d on d.id=a.doctor_id
     where a.doctor_id in (new.professional_id,new.anesthetist_id) and a.active and d.scheduling_enabled) then
   raise exception 'Configure uma agenda ativa para o médico antes de agendar';
  end if;
 end if;
 if new.patient_id is not null and (tg_op='INSERT' or new.patient_id is distinct from old.patient_id
    or new.professional_id is distinct from old.professional_id or new.anesthetist_id is distinct from old.anesthetist_id) then
  select owner_professional_id,insurance into owner,patient_insurance from public.patients where id=new.patient_id;
  if owner is distinct from coalesce(new.professional_id,new.anesthetist_id) then
   raise exception 'O paciente pertence a outro médico. Cadastre-o na agenda deste profissional.';
  end if;
  if new.insurance is null then new.insurance:=patient_insurance; end if;
 end if;
 if new.cancelled_at is not null and (tg_op='INSERT' or old.cancelled_at is null) then
  new.cancelled_by:=coalesce(new.cancelled_by,nullif(current_setting('rn.actor',true),'')::bigint);
 end if;
 return new;
end;$$;
create trigger b_guard_appointment before insert or update on public.appointments for each row execute function public.guard_appointment_row();

create or replace function public.agenda_minutes(t time) returns integer
language sql immutable set search_path='' as $$ select extract(hour from t)::int*60+extract(minute from t)::int $$;

create or replace function public.guard_appointment_availability() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
 b record; r record; s record;
 day_value date; occ integer; wd integer; beginning integer; ending integer;
 work_start integer; work_end integer; t time; used_count integer;
 settings jsonb;
begin
 if coalesce(current_setting('rn.agenda_migration',true),'')='on' then return new; end if;
 perform pg_advisory_xact_lock(194701,1);
 if new.cancelled_at is not null or new.archived_at is not null then return new; end if;
 if tg_op='UPDATE' and old.cancelled_at is null and old.archived_at is null and
   (old.date,old.time,old.duration_min,old.professional_id,old.anesthetist_id,old.hospital_id,old.procedure)
   is not distinct from (new.date,new.time,new.duration_min,new.professional_id,new.anesthetist_id,new.hospital_id,new.procedure) then
  return new;
 end if;
 day_value:=new.date; wd:=extract(dow from day_value)::int;
 occ:=((extract(day from day_value)::int-1)/7)+1;
 beginning:=public.agenda_minutes(new.time); ending:=beginning+new.duration_min;
 if ending<=beginning then
  raise exception using errcode='P0001',message='Horário indisponível: duração inválida.';
 end if;

 -- Bloqueios manuais valem para cirurgião e anestesista.
 for b in select * from public.schedule_blocks
   where organization_id=new.organization_id and date=new.date
     and professional_id in (coalesce(new.professional_id,''),coalesce(new.anesthetist_id,'')) loop
  if beginning<public.agenda_minutes(b.end_time) and ending>public.agenda_minutes(b.start_time) then
   raise exception using errcode='P0001',message='Horário indisponível: bloqueio do profissional.';
  end if;
 end loop;
 if new.professional_id is null then return new; end if;

 select a.settings into settings from public.doctor_agendas a where a.doctor_id=new.professional_id;
 select * into s from public.agenda_settings where organization_id=new.organization_id;
 work_start:=public.agenda_minutes(coalesce(nullif(settings->>'workStart','')::time,s.work_start,'07:00'::time));
 work_end:=public.agenda_minutes(coalesce(nullif(settings->>'workEnd','')::time,s.work_end,'19:00'::time));

 for r in select * from public.scheduling_rules
   where organization_id=new.organization_id and professional_id=new.professional_id and enabled
     and (block_all_day or severity='block') loop
  if r.weekday is not null and r.weekday<>wd then continue; end if;
  if r.occurrence is not null then
   if r.occurrence='last' then
    if extract(month from day_value+7)::int=extract(month from day_value)::int then continue; end if;
   elsif r.occurrence::int<>occ then continue; end if;
  end if;
  if r.block_all_day then
   raise exception using errcode='P0001',message='Horário indisponível: dia totalmente bloqueado.';
  end if;
  if r.start_time is not null and public.agenda_minutes(r.start_time)>work_start
     and beginning<least(public.agenda_minutes(r.start_time),work_end) and ending>work_start then
   raise exception using errcode='P0001',message='Horário indisponível: antes da janela permitida.';
  end if;
  if r.end_time is not null and public.agenda_minutes(r.end_time)<work_end
     and beginning<work_end and ending>greatest(public.agenda_minutes(r.end_time),work_start) then
   raise exception using errcode='P0001',message='Horário indisponível: após a janela permitida.';
  end if;
  foreach t in array r.forbidden_times loop
   if beginning<least(public.agenda_minutes(t)+30,work_end) and ending>public.agenda_minutes(t) then
    raise exception using errcode='P0001',message='Horário indisponível: horário proibido.';
   end if;
  end loop;
  if r.hospital_id is not null and r.hospital_id is distinct from new.hospital_id then continue; end if;
  if r.procedure_contains<>'' and position(lower(r.procedure_contains) in lower(new.procedure))=0 then continue; end if;
  if cardinality(r.preferred_times)>0 and not (new.time=any(r.preferred_times)) then
   raise exception using errcode='P0001',message='Horário indisponível: fora dos horários permitidos.';
  end if;
  if coalesce(r.max_patients,0)>0 then
   select count(*) into used_count from public.appointments a
    where a.organization_id=new.organization_id and a.id<>new.id and a.professional_id=new.professional_id
      and a.date=new.date and a.cancelled_at is null and a.archived_at is null
      and (r.hospital_id is null or a.hospital_id=r.hospital_id);
   if used_count>=r.max_patients then
    raise exception using errcode='P0001',message='Horário indisponível: limite diário atingido.';
   end if;
  end if;
 end loop;
 return new;
end;$$;
create trigger c_guard_appointment_availability before insert or update on public.appointments for each row execute function public.guard_appointment_availability();

-- Única leitura cruzada da agenda: NF emitida impede cancelar/arquivar.
create or replace function public.guard_appointment_issued_invoice() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (old.cancelled_at is null and new.cancelled_at is not null) or (old.archived_at is null and new.archived_at is not null) then
  perform pg_advisory_xact_lock(194701,1);
  if exists(
   select 1 from public.billing_records b
   join public.attendances a on a.id=b.attendance_id
   join public.invoice_billing_records item on item.billing_record_id=b.id
   join public.invoices invoice on invoice.id=item.invoice_id
   where (b.appointment_id=old.id or a.appointment_id=old.id)
     and item.is_active and invoice.status='ACTIVE' and invoice.voided_at is null) then
   raise exception using errcode='P0001',message='Não é possível cancelar ou arquivar: atendimento vinculado a Nota Fiscal emitida.';
  end if;
 end if;
 return new;
end;$$;
create trigger d_guard_appointment_issued_invoice before update on public.appointments for each row execute function public.guard_appointment_issued_invoice();

-- Porta única para o faturamento.
create or replace function public.sync_appointment_attendance() returns trigger
language plpgsql security invoker set search_path='' as $$
declare t public.attendances%rowtype; owner text; historical_insurance text;
begin
 if coalesce(current_setting('rn.agenda_migration',true),'')='on' then return null; end if;
 select * into t from public.attendances where appointment_id=new.id;
 if new.status<>'realized' and t.id is null then return null; end if;
 owner:=coalesce(t.doctor_id,new.professional_id,new.anesthetist_id);
 historical_insurance:=coalesce(new.insurance,t.insurance,(select insurance from public.patients where id=new.patient_id),'');
 if t.id is not null and tg_op='UPDATE' and old.insurance is not distinct from new.insurance
   and exists(select 1 from public.billing_records b join public.invoice_billing_records ib on ib.billing_record_id=b.id where b.attendance_id=t.id) then
  historical_insurance:=t.insurance;
 end if;
 if t.id is null then
  insert into public.attendances(id,appointment_id,origin,patient_id,doctor_id,date,procedure,insurance,billing_method,status,organization_id)
  values(new.id,new.id,'AGENDA',new.patient_id,owner,new.date,new.procedure,historical_insurance,new.billing_method,new.status,new.organization_id);
 elsif (t.patient_id,t.date,t.procedure,t.insurance,t.billing_method,t.status)
   is distinct from (new.patient_id,new.date,new.procedure,historical_insurance,coalesce(new.billing_method,t.billing_method),new.status) then
  update public.attendances set patient_id=new.patient_id,date=new.date,procedure=new.procedure,insurance=historical_insurance,
   billing_method=coalesce(new.billing_method,t.billing_method),status=new.status where id=t.id;
 end if;
 return null;
end;$$;
create trigger e_sync_appointment_attendance after insert or update on public.appointments for each row execute function public.sync_appointment_attendance();

-- ---------------------------------------------------------------------------
-- Formato legado (schemaVersion 7) montado a partir das tabelas
-- ---------------------------------------------------------------------------
create or replace function public.agenda_hhmi(t time) returns text
language sql immutable set search_path='' as $$ select to_char(t,'HH24:MI') $$;

create or replace function public.agenda_iso(t timestamptz) returns text
language sql stable set search_path='' as $$ select to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

create or replace function public.agenda_hospital_json(h public.hospitals) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',h.id,'name',h.name,'abbreviation',coalesce(h.abbreviation,''))
$$;

create or replace function public.agenda_patient_json(p public.patients) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'doctorId',p.owner_professional_id,'name',p.name,'cpf',coalesce(p.cpf,''),
  'phone',coalesce(p.phone,''),'email',coalesce(p.email,''),'insurance',coalesce(p.insurance,''),'cardNumber',coalesce(p.card_number,''),
  'address',coalesce(p.address,''),'addressZip',coalesce(p.address_zip,''),'addressNumber',coalesce(p.address_number,''),
  'addressComplement',coalesce(p.address_complement,''),'addressNeighborhood',coalesce(p.address_neighborhood,''),
  'addressCity',coalesce(p.address_city,''),'addressState',coalesce(p.address_state,''),
  'newborn',p.newborn,'guardianName',coalesce(p.guardian_name,''),
  'created_at',public.agenda_iso(p.created_at),'created_by',p.created_by,'updated_at',public.agenda_iso(p.updated_at),'updated_by',p.updated_by)
$$;

create or replace function public.agenda_appointment_json(a public.appointments) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object('cancelledAt',public.agenda_iso(a.cancelled_at),'cancelReason',a.cancel_reason,
   'statusUpdatedAt',public.agenda_iso(a.status_updated_at),'suggestedByName',a.suggested_by_name,'suggestedByEmail',a.suggested_by_email,
   'insurance',a.insurance,'forma_cobranca',a.billing_method))
  ||jsonb_build_object('id',a.id,'doctorId',coalesce(a.professional_id,''),'anesthetistId',a.anesthetist_id,'patientId',coalesce(a.patient_id,''),
  'hospitalId',coalesce(a.hospital_id,''),'date',to_char(a.date,'YYYY-MM-DD'),'time',public.agenda_hhmi(a.time),'duration',a.duration_min,
  'status',a.status,'careType',a.care_type,'procedure',a.procedure,'guideExpiry',coalesce(a.guide_expiry,''),
  'opme',a.opme,'reports',a.reports,'exams',a.exams,'notes',coalesce(a.notes,''),
  'rescheduleReason',coalesce(a.reschedule_reason,''),'suggestionReason',coalesce(a.suggestion_reason,''),
  'rescheduleHistory',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('fromDate',r.from_date,'fromTime',r.from_time,
     'toDate',r.to_date,'toTime',r.to_time,'reason',r.reason,'proposedBy',r.proposed_by,'createdAt',r.proposed_at)) order by r.position)
   from public.appointment_reschedules r where r.appointment_id=a.id),'[]'::jsonb))
$$;

create or replace function public.agenda_block_json(b public.schedule_blocks) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',b.id,'professionalId',b.professional_id,'hospitalId',null,'date',to_char(b.date,'YYYY-MM-DD'),
  'start',public.agenda_hhmi(b.start_time),'end',public.agenda_hhmi(b.end_time),'reason',b.reason)
$$;

create or replace function public.agenda_rule_json(r public.scheduling_rules) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'professionalId',r.professional_id,'hospitalId',r.hospital_id,'name',r.name,'severity',r.severity,
  'weekday',coalesce(r.weekday::text,''),'occurrence',coalesce(r.occurrence,''),
  'start',coalesce(public.agenda_hhmi(r.start_time),''),'end',coalesce(public.agenda_hhmi(r.end_time),''),
  'maxPatients',r.max_patients,'procedureContains',r.procedure_contains,
  'preferredTimes',array_to_string(array(select public.agenda_hhmi(x) from unnest(r.preferred_times) x),','),
  'forbiddenTimes',array_to_string(array(select public.agenda_hhmi(x) from unnest(r.forbidden_times) x),','),
  'blockAllDay',r.block_all_day,'enabled',r.enabled)
$$;

create or replace function public.agenda_history_json(h public.patient_history_events) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',h.id,'patientId',h.patient_id,'appointmentId',h.appointment_id,'type',h.type,'text',h.text,'at',public.agenda_iso(h.at))
$$;

create or replace function public.agenda_row_json(p_entity text,p_id text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 case p_entity
  when 'patients' then select public.agenda_patient_json(x) into result from public.patients x where id=p_id;
  when 'appointments' then select public.agenda_appointment_json(x)||jsonb_build_object('_cancelled',x.cancelled_at is not null,'_archived',x.archived_at is not null) into result from public.appointments x where id=p_id;
  when 'hospitals' then select public.agenda_hospital_json(x)||jsonb_build_object('_archived',x.archived_at is not null) into result from public.hospitals x where id=p_id;
  when 'scheduleBlocks' then select public.agenda_block_json(x) into result from public.schedule_blocks x where id=p_id;
  when 'schedulingRules' then select public.agenda_rule_json(x) into result from public.scheduling_rules x where id=p_id;
  else raise exception 'Entidade inválida';
 end case;
 return result;
end;$$;

create or replace function public.agenda_row_version_of(p_entity text,p_id text) returns integer
language plpgsql stable security invoker set search_path='' as $$
declare v integer;
begin
 case p_entity
  when 'patients' then select row_version into v from public.patients where id=p_id;
  when 'appointments' then select row_version into v from public.appointments where id=p_id;
  when 'hospitals' then select row_version into v from public.hospitals where id=p_id;
  when 'scheduleBlocks' then select row_version into v from public.schedule_blocks where id=p_id;
  when 'schedulingRules' then select row_version into v from public.scheduling_rules where id=p_id;
  else raise exception 'Entidade inválida';
 end case;
 return v;
end;$$;

create or replace function public.record_agenda_row_version(p_org uuid,p_entity text,p_id text,p_revision timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
declare v integer:=public.agenda_row_version_of(p_entity,p_id);
begin
 -- Linha apagada (bloqueio/regra): versão com data nula marca a exclusão.
 if v is null then
  v:=coalesce((select max(row_version) from public.agenda_row_versions where entity=p_entity and row_id=p_id),0)+1;
 end if;
 insert into public.agenda_row_versions(organization_id,entity,row_id,row_version,revision,data)
 values(p_org,p_entity,p_id,v,p_revision,public.agenda_row_json(p_entity,p_id))
 on conflict (entity,row_id,row_version) do update set revision=excluded.revision,data=excluded.data;
end;$$;

-- ---------------------------------------------------------------------------
-- RPCs da agenda
-- ---------------------------------------------------------------------------
create or replace function public.require_rn_agenda_actor_organization(p_actor bigint) returns uuid
language plpgsql security invoker set search_path='' as $$
DECLARE rn_org_id uuid;
BEGIN
 -- Fail closed: Fase 2B pausada, apenas a organização RN Gestão opera.
 rn_org_id:=public.rn_agenda_organization_id();
 IF p_actor IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.users u JOIN public.organization_memberships m ON m.user_id=u.id
  WHERE u.id=p_actor AND u.active AND m.active AND m.organization_id=rn_org_id AND m.role=u.role
 ) THEN RAISE EXCEPTION 'Acesso à organização negado'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.agenda_settings WHERE organization_id=rn_org_id) THEN
  RAISE EXCEPTION 'Agenda da organização indisponível';
 END IF;
 RETURN rn_org_id;
END;$$;

create or replace function public.agenda_revision(p_actor bigint) returns timestamptz
language plpgsql stable security invoker set search_path='' as $$
begin
 return (select revision from public.agenda_settings where organization_id=public.require_rn_agenda_actor_organization(p_actor));
end;$$;

create or replace function public.load_agenda_state(p_actor bigint) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare org uuid:=public.require_rn_agenda_actor_organization(p_actor); s public.agenda_settings%rowtype;
begin
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
  'appointments',coalesce((select jsonb_agg(public.agenda_appointment_json(a) order by a.date,a.time,a.id) from public.appointments a where a.organization_id=org and a.cancelled_at is null and a.archived_at is null),'[]'::jsonb),
  'cancelledAppointments',coalesce((select jsonb_agg(public.agenda_appointment_json(a) order by a.cancelled_at,a.id) from public.appointments a where a.organization_id=org and a.cancelled_at is not null and a.archived_at is null),'[]'::jsonb),
  'patientHistory',coalesce((select jsonb_agg(public.agenda_history_json(h) order by h.at,h.id) from public.patient_history_events h where h.organization_id=org),'[]'::jsonb),
  'schedulingRules',coalesce((select jsonb_agg(public.agenda_rule_json(r) order by r.created_at,r.id) from public.scheduling_rules r where r.organization_id=org),'[]'::jsonb),
  'scheduleBlocks',coalesce((select jsonb_agg(public.agenda_block_json(b) order by b.date,b.start_time,b.id) from public.schedule_blocks b where b.organization_id=org),'[]'::jsonb)
 ));
end;$$;

-- Versões-base para o merge de três vias: para cada chave, a versão vigente
-- na revisão que o cliente leu e a versão atual.
create or replace function public.agenda_row_bases(p_actor bigint,p_revision timestamptz,p_keys jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare org uuid:=public.require_rn_agenda_actor_organization(p_actor);
begin
 return coalesce((select jsonb_agg(jsonb_build_object('entity',k.entity,'id',k.id,
   'currentVersion',public.agenda_row_version_of(k.entity,k.id),
   'baseVersion',base.row_version,'base',base.data))
  from jsonb_to_recordset(coalesce(p_keys,'[]'::jsonb)) k(entity text,id text)
  left join lateral (select v.row_version,v.data from public.agenda_row_versions v
    where v.organization_id=org and v.entity=k.entity and v.row_id=k.id and v.revision<=p_revision
    order by v.revision desc,v.row_version desc limit 1) base on true),'[]'::jsonb);
end;$$;

create or replace function public.agenda_time_list(p_value text) returns time[]
language plpgsql immutable set search_path='' as $$
declare item text; result time[]:='{}';
begin
 foreach item in array regexp_split_to_array(coalesce(p_value,''),',') loop
  item:=btrim(item);
  if item='' then continue; end if;
  if item !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Horário inválido na regra: %',item; end if;
  result:=result||item::time;
 end loop;
 return result;
end;$$;

create or replace function public.apply_agenda_changes(
 p_actor bigint,p_ops jsonb,p_audit jsonb default '[]'::jsonb,p_request_id text default null,
 p_decision text default null,p_note text default null,p_notification jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 org uuid; new_revision timestamptz; op jsonb; d jsonb; kind text; expected integer; rid text;
 request_status text; touched jsonb:='[]'::jsonb; t jsonb; existing integer; rs jsonb; pos integer;
begin
 perform pg_advisory_xact_lock(194701,1);
 org:=public.require_rn_agenda_actor_organization(p_actor);
 if p_request_id is not null then
  select status into request_status from public.agenda_requests where id=p_request_id for update;
  if request_status is distinct from 'pending' then
   return jsonb_build_object('ok',false,'conflict','request');
  end if;
  if p_decision not in ('accepted','denied') then raise exception 'Invalid decision'; end if;
 end if;
 perform public.financial_operation(p_actor,'agenda',p_request_id);
 update public.agenda_settings set revision=date_trunc('milliseconds',greatest(clock_timestamp(),revision+interval '1 millisecond')),updated_by=p_actor
  where organization_id=org returning revision into new_revision;

 for op in select value from jsonb_array_elements(coalesce(p_ops,'[]'::jsonb)) loop
  kind:=op->>'op'; d:=coalesce(op->'data','{}'::jsonb); rid:=coalesce(d->>'id',op->>'id');
  expected:=nullif(op->>'expectedVersion','')::integer;
  if kind in ('upsert_patient','archive_patient') then
   if kind='archive_patient' then
    update public.patients set archived_at=clock_timestamp(),archived_by=p_actor where id=rid and organization_id=org and row_version=expected and archived_at is null;
   elsif expected is null then
    insert into public.patients(id,organization_id,owner_professional_id,name,cpf,phone,email,insurance,card_number,address,address_zip,
      address_number,address_complement,address_neighborhood,address_city,address_state,newborn,guardian_name,created_by)
    values(rid,org,d->>'doctorId',btrim(d->>'name'),nullif(d->>'cpf',''),d->>'phone',d->>'email',d->>'insurance',d->>'cardNumber',d->>'address',
      d->>'addressZip',d->>'addressNumber',d->>'addressComplement',d->>'addressNeighborhood',d->>'addressCity',d->>'addressState',
      coalesce((d->>'newborn')::boolean,false),d->>'guardianName',p_actor)
    on conflict (id) do nothing;
   else
    update public.patients set owner_professional_id=d->>'doctorId',name=btrim(d->>'name'),cpf=nullif(d->>'cpf',''),phone=d->>'phone',email=d->>'email',
      insurance=d->>'insurance',card_number=d->>'cardNumber',address=d->>'address',address_zip=d->>'addressZip',address_number=d->>'addressNumber',
      address_complement=d->>'addressComplement',address_neighborhood=d->>'addressNeighborhood',address_city=d->>'addressCity',
      address_state=d->>'addressState',newborn=coalesce((d->>'newborn')::boolean,false),guardian_name=d->>'guardianName'
    where id=rid and organization_id=org and row_version=expected;
   end if;
   if not found then raise exception using errcode='P0001',message='Conflito de edição: paciente alterado por outra pessoa.'; end if;
   touched:=touched||jsonb_build_array(jsonb_build_object('entity','patients','id',rid));
  elsif kind in ('upsert_appointment','archive_appointment') then
   if kind='archive_appointment' then
    update public.appointments set archived_at=clock_timestamp(),archived_by=p_actor where id=rid and organization_id=org and row_version=expected and archived_at is null;
    if not found then raise exception using errcode='P0001',message='Conflito de edição: agendamento alterado por outra pessoa.'; end if;
   else
    if expected is null then
     insert into public.appointments(id,organization_id,professional_id,anesthetist_id,patient_id,hospital_id,date,time,duration_min,status,care_type,
       procedure,insurance,billing_method,guide_expiry,opme,reports,exams,notes,status_updated_at,reschedule_reason,suggestion_reason,
       suggested_by_name,suggested_by_email,cancelled_at,cancel_reason,created_by)
     values(rid,org,nullif(d->>'doctorId',''),nullif(d->>'anesthetistId',''),nullif(d->>'patientId',''),nullif(d->>'hospitalId',''),
       (d->>'date')::date,(d->>'time')::time,(d->>'duration')::integer,d->>'status',coalesce(nullif(d->>'careType',''),'outpatient'),
       coalesce(nullif(d->>'procedure',''),'Procedimento'),d->>'insurance',nullif(d->>'forma_cobranca',''),d->>'guideExpiry',
       coalesce((d->>'opme')::boolean,false),coalesce((d->>'reports')::boolean,false),coalesce((d->>'exams')::boolean,false),d->>'notes',
       nullif(d->>'statusUpdatedAt','')::timestamptz,d->>'rescheduleReason',d->>'suggestionReason',d->>'suggestedByName',d->>'suggestedByEmail',
       case when (op->>'cancelled')::boolean then coalesce(nullif(d->>'cancelledAt','')::timestamptz,clock_timestamp()) end,
       case when (op->>'cancelled')::boolean then coalesce(nullif(btrim(d->>'cancelReason'),''),'Não informado') end,p_actor)
     on conflict (id) do nothing;
    else
     update public.appointments set professional_id=nullif(d->>'doctorId',''),anesthetist_id=nullif(d->>'anesthetistId',''),
       patient_id=nullif(d->>'patientId',''),hospital_id=nullif(d->>'hospitalId',''),date=(d->>'date')::date,time=(d->>'time')::time,
       duration_min=(d->>'duration')::integer,status=d->>'status',care_type=coalesce(nullif(d->>'careType',''),'outpatient'),
       procedure=coalesce(nullif(d->>'procedure',''),'Procedimento'),insurance=d->>'insurance',billing_method=nullif(d->>'forma_cobranca',''),
       guide_expiry=d->>'guideExpiry',opme=coalesce((d->>'opme')::boolean,false),reports=coalesce((d->>'reports')::boolean,false),
       exams=coalesce((d->>'exams')::boolean,false),notes=d->>'notes',status_updated_at=nullif(d->>'statusUpdatedAt','')::timestamptz,
       reschedule_reason=d->>'rescheduleReason',suggestion_reason=d->>'suggestionReason',suggested_by_name=d->>'suggestedByName',
       suggested_by_email=d->>'suggestedByEmail',
       cancelled_at=case when (op->>'cancelled')::boolean then coalesce(cancelled_at,nullif(d->>'cancelledAt','')::timestamptz,clock_timestamp()) end,
       cancel_reason=case when (op->>'cancelled')::boolean then coalesce(nullif(btrim(d->>'cancelReason'),''),'Não informado') end,
       cancelled_by=case when (op->>'cancelled')::boolean then cancelled_by end
     where id=rid and organization_id=org and row_version=expected;
    end if;
    if not found then raise exception using errcode='P0001',message='Conflito de edição: agendamento alterado por outra pessoa.'; end if;
    -- Remarcações são append-only: só entradas além das já gravadas.
    select count(*) into existing from public.appointment_reschedules where appointment_id=rid;
    pos:=0;
    for rs in select value from jsonb_array_elements(case when jsonb_typeof(d->'rescheduleHistory')='array' then d->'rescheduleHistory' else '[]'::jsonb end) loop
     if pos>=existing then
      insert into public.appointment_reschedules(id,organization_id,appointment_id,position,from_date,from_time,to_date,to_time,reason,proposed_by,proposed_at)
      values(gen_random_uuid()::text,org,rid,pos,rs->>'fromDate',rs->>'fromTime',rs->>'toDate',rs->>'toTime',rs->>'reason',rs->>'proposedBy',rs->>'createdAt');
     end if;
     pos:=pos+1;
    end loop;
   end if;
   touched:=touched||jsonb_build_array(jsonb_build_object('entity','appointments','id',rid));
  elsif kind='append_history' then
   insert into public.patient_history_events(id,organization_id,patient_id,appointment_id,type,text,at,actor_user_id,created_by)
   values(rid,org,d->>'patientId',nullif(d->>'appointmentId',''),d->>'type',coalesce(d->>'text',''),
     coalesce(nullif(d->>'at','')::timestamptz,clock_timestamp()),p_actor,p_actor)
   on conflict (id) do nothing;
  elsif kind in ('upsert_block','delete_block') then
   if kind='delete_block' then
    delete from public.schedule_blocks where id=rid and organization_id=org and row_version=expected;
   elsif expected is null then
    insert into public.schedule_blocks(id,organization_id,professional_id,date,start_time,end_time,reason,created_by)
    values(rid,org,d->>'professionalId',(d->>'date')::date,(d->>'start')::time,(d->>'end')::time,btrim(d->>'reason'),p_actor)
    on conflict (id) do nothing;
   else
    update public.schedule_blocks set professional_id=d->>'professionalId',date=(d->>'date')::date,start_time=(d->>'start')::time,
      end_time=(d->>'end')::time,reason=btrim(d->>'reason')
    where id=rid and organization_id=org and row_version=expected;
   end if;
   if not found then raise exception using errcode='P0001',message='Conflito de edição: bloqueio alterado por outra pessoa.'; end if;
   touched:=touched||jsonb_build_array(jsonb_build_object('entity','scheduleBlocks','id',rid));
  elsif kind in ('upsert_rule','delete_rule') then
   if kind='delete_rule' then
    delete from public.scheduling_rules where id=rid and organization_id=org and row_version=expected;
   elsif expected is null then
    insert into public.scheduling_rules(id,organization_id,professional_id,hospital_id,name,severity,weekday,occurrence,start_time,end_time,
      max_patients,procedure_contains,preferred_times,forbidden_times,block_all_day,enabled,created_by)
    values(rid,org,d->>'professionalId',nullif(d->>'hospitalId',''),coalesce(d->>'name',''),coalesce(nullif(d->>'severity',''),'preference'),
      nullif(d->>'weekday','')::smallint,nullif(d->>'occurrence',''),nullif(d->>'start','')::time,nullif(d->>'end','')::time,
      nullif(d->>'maxPatients','')::integer,coalesce(d->>'procedureContains',''),public.agenda_time_list(d->>'preferredTimes'),
      public.agenda_time_list(d->>'forbiddenTimes'),coalesce((d->>'blockAllDay')::boolean,false),coalesce((d->>'enabled')::boolean,true),p_actor)
    on conflict (id) do nothing;
   else
    update public.scheduling_rules set professional_id=d->>'professionalId',hospital_id=nullif(d->>'hospitalId',''),name=coalesce(d->>'name',''),
      severity=coalesce(nullif(d->>'severity',''),'preference'),weekday=nullif(d->>'weekday','')::smallint,occurrence=nullif(d->>'occurrence',''),
      start_time=nullif(d->>'start','')::time,end_time=nullif(d->>'end','')::time,max_patients=nullif(d->>'maxPatients','')::integer,
      procedure_contains=coalesce(d->>'procedureContains',''),preferred_times=public.agenda_time_list(d->>'preferredTimes'),
      forbidden_times=public.agenda_time_list(d->>'forbiddenTimes'),block_all_day=coalesce((d->>'blockAllDay')::boolean,false),
      enabled=coalesce((d->>'enabled')::boolean,true)
    where id=rid and organization_id=org and row_version=expected;
   end if;
   if not found then raise exception using errcode='P0001',message='Conflito de edição: regra alterada por outra pessoa.'; end if;
   touched:=touched||jsonb_build_array(jsonb_build_object('entity','schedulingRules','id',rid));
  elsif kind in ('upsert_hospital','archive_hospital') then
   if kind='archive_hospital' then
    update public.hospitals set archived_at=clock_timestamp(),archived_by=p_actor where id=rid and organization_id=org and row_version=expected and archived_at is null;
   elsif expected is null then
    insert into public.hospitals(id,organization_id,name,abbreviation,created_by)
    values(rid,org,btrim(d->>'name'),nullif(btrim(coalesce(d->>'abbreviation','')),''),p_actor) on conflict (id) do nothing;
   else
    update public.hospitals set name=btrim(d->>'name'),abbreviation=nullif(btrim(coalesce(d->>'abbreviation','')),'')
    where id=rid and organization_id=org and row_version=expected;
   end if;
   if not found then raise exception using errcode='P0001',message='Conflito de edição: hospital alterado por outra pessoa.'; end if;
   touched:=touched||jsonb_build_array(jsonb_build_object('entity','hospitals','id',rid));
  elsif kind='save_settings' then
   update public.agenda_settings set work_start=(d->>'workStart')::time,work_end=(d->>'workEnd')::time,updated_by=p_actor where organization_id=org;
  else
   raise exception 'Operação de agenda inválida';
  end if;
 end loop;

 for t in select distinct value from jsonb_array_elements(touched) loop
  perform public.record_agenda_row_version(org,t->>'entity',t->>'id',new_revision);
 end loop;
 if p_request_id is not null then
  update public.agenda_requests set status=p_decision,decided_by=p_actor,decision_note=p_note,decided_at=new_revision where id=p_request_id;
 end if;
 insert into public.audit_logs(id,actor_user_id,actor_name,actor_role,action,professional_id,appointment_id,patient_id,description,metadata,created_at)
  select x.id,x.actor_user_id,x.actor_name,x.actor_role,x.action,x.professional_id,x.appointment_id,x.patient_id,x.description,x.metadata,coalesce(x.created_at,new_revision)
  from jsonb_to_recordset(coalesce(p_audit,'[]'::jsonb)) as x(id text,actor_user_id bigint,actor_name text,actor_role text,action text,professional_id text,
   appointment_id text,patient_id text,description text,metadata jsonb,created_at timestamptz);
 if p_notification is not null then
  insert into public.notifications(id,user_id,type,request_id,message,created_at)
  values(p_notification->>'id',(p_notification->>'user_id')::bigint,p_notification->>'type',p_request_id,p_notification->>'message',new_revision);
 end if;
 perform set_config('rn.operation','',true); perform set_config('rn.actor','',true);
 return jsonb_build_object('ok',true,'revision',public.agenda_iso(new_revision));
end;$$;

-- Código anterior à A1 não pode mais gravar o documento legado.
create or replace function public.commit_agenda_change(p_expected timestamp with time zone,p_payload jsonb,p_revision timestamp with time zone,
 p_audit jsonb,p_request_id text default null,p_decision text default null,p_actor bigint default null,p_note text default null,p_notification jsonb default null) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 raise exception using errcode='P0001',message='Agenda migrada; atualize a página.';
end;$$;

-- Cadastro central de médicos: avisa os clientes pela revisão global.
create or replace function public.save_doctor_directory(p_actor bigint, p_kind text, p_data jsonb)
 RETURNS text LANGUAGE plpgsql SET search_path TO '' AS $function$
declare sid text; old_row jsonb; result_row jsonb; old_agenda jsonb; new_agenda jsonb; rn_org_id uuid;
begin
 perform pg_advisory_xact_lock(194701,1);
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);
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
 update public.agenda_settings set revision=date_trunc('milliseconds',greatest(clock_timestamp(),revision+interval '1 millisecond')) where organization_id=rn_org_id;
 if not found then raise exception 'Agenda da organização indisponível'; end if;
 perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);return sid;
end;$function$;

-- Logs financeiros: nome do paciente vem da tabela da agenda.
create or replace function public.financial_log_snapshot(v jsonb) returns jsonb
language sql stable set search_path='' as $$
 select case when v is null then null else v||jsonb_build_object('_labels',jsonb_strip_nulls(jsonb_build_object(
 'doctor_id',(select name from public.doctors where organization_id=public.rn_finance_single_organization_id() and id=v->>'doctor_id'),
 'billing_entity_id',(select name from public.billing_entities where organization_id=public.rn_finance_single_organization_id() and id::text=v->>'billing_entity_id'),
 'paid_by_doctor_entity_link_id',(select d.name from public.billing_doctor_entities l join public.doctors d on d.id=l.doctor_id and d.organization_id=l.organization_id where l.organization_id=public.rn_finance_single_organization_id() and l.id::text=v->>'paid_by_doctor_entity_link_id'),
 'paid_by_associate_id',(select name from public.company_associates where id::text=v->>'paid_by_associate_id'),
 'invoice_id',(select invoice_number from public.invoices where organization_id=public.rn_finance_single_organization_id() and id::text=v->>'invoice_id'),
 'patient_id',(select p.name from public.patients p where p.organization_id=public.rn_finance_single_organization_id() and p.id=v->>'patient_id')
 ))) end
$$;

-- ---------------------------------------------------------------------------
-- Faturamento desligado até a reconstrução (corpos originais no histórico Git)
-- ---------------------------------------------------------------------------
create or replace function public.billing_paused() returns void
language plpgsql set search_path='' as $$
begin raise exception using errcode='P0001',message='Faturamento em reconstrução.'; end;$$;

create or replace function public.attribute_financial_attendance(p_id text,p_entity uuid) returns jsonb
language plpgsql set search_path='' as $$ begin perform public.billing_paused(); return null; end;$$;
create or replace function public.authorized_financial_attachment_actor(actor bigint,invoice uuid,record uuid) returns boolean
language plpgsql stable set search_path='' as $$ begin return false; end;$$;
create or replace function public.finish_private_payment(p_actor bigint,p_id uuid,p_data jsonb) returns void
language plpgsql set search_path='' as $$ begin perform public.billing_paused(); end;$$;
create or replace function public.preview_billing_month(p_actor bigint,p_entity uuid,p_month text) returns jsonb
language plpgsql set search_path='' as $$ begin perform public.billing_paused(); return null; end;$$;
create or replace function public.save_billing_fiscal_core(p_actor bigint,p_kind text,p_data jsonb) returns uuid
language plpgsql set search_path='' as $$ begin perform public.billing_paused(); return null; end;$$;
create or replace function public.save_billing_legacy_single_charge(p_actor bigint,p_kind text,p_data jsonb) returns uuid
language plpgsql set search_path='' as $$ begin perform public.billing_paused(); return null; end;$$;
create or replace function public.save_manual_attendance(p_actor bigint,p_data jsonb) returns text
language plpgsql set search_path='' as $$ begin perform public.billing_paused(); return null; end;$$;
create or replace function public.save_professional_charge(p_actor bigint,p_data jsonb) returns uuid
language plpgsql set search_path='' as $$ begin perform public.billing_paused(); return null; end;$$;
create or replace function public.save_professional_charge_core(p_actor bigint,p_data jsonb) returns uuid
language plpgsql set search_path='' as $$ begin perform public.billing_paused(); return null; end;$$;
create or replace function public.update_pending_invoice_request(p_actor bigint,p_data jsonb) returns uuid
language plpgsql set search_path='' as $$ begin perform public.billing_paused(); return null; end;$$;

-- ---------------------------------------------------------------------------
-- Migração dos dados de teste do documento legado
-- ---------------------------------------------------------------------------
do $$
declare org uuid:=public.rn_agenda_organization_id(); s jsonb; rev timestamptz:=date_trunc('milliseconds',clock_timestamp());
 n_in integer; n_out integer; t jsonb;
begin
 perform set_config('rn.agenda_migration','on',true);
 select payload into s from public.app_state where organization_id=org;
 s:=coalesce(s,'{}'::jsonb);
 insert into public.agenda_settings(organization_id,work_start,work_end,revision)
 values(org,coalesce(nullif(s->'settings'->>'workStart','')::time,'07:00'),coalesce(nullif(s->'settings'->>'workEnd','')::time,'19:00'),rev);

 insert into public.hospitals(id,organization_id,name,abbreviation,created_by)
 select h->>'id',org,btrim(h->>'name'),nullif(btrim(coalesce(h->>'abbreviation','')),''),null
 from jsonb_array_elements(coalesce(s->'hospitals','[]')) h
 where nullif(btrim(h->>'name'),'') is not null
 on conflict do nothing;

 insert into public.patients(id,organization_id,owner_professional_id,name,cpf,phone,email,insurance,card_number,address,address_zip,address_number,
   address_complement,address_neighborhood,address_city,address_state,created_by)
 select p->>'id',org,p->>'doctorId',btrim(p->>'name'),nullif(p->>'cpf',''),p->>'phone',p->>'email',p->>'insurance',p->>'cardNumber',p->>'address',
   p->>'addressZip',p->>'addressNumber',p->>'addressComplement',p->>'addressNeighborhood',p->>'addressCity',p->>'addressState',
   coalesce(nullif(p->>'created_by','')::bigint,(select min(u.id) from public.users u where u.role='general_manager'))
 from jsonb_array_elements(coalesce(s->'patients','[]')) p
 where exists(select 1 from public.doctors d where d.organization_id=org and d.id=p->>'doctorId') and nullif(btrim(p->>'name'),'') is not null
 on conflict do nothing;

 insert into public.appointments(id,organization_id,professional_id,anesthetist_id,patient_id,hospital_id,date,time,duration_min,status,care_type,procedure,
   insurance,billing_method,guide_expiry,opme,reports,exams,notes,status_updated_at,reschedule_reason,suggestion_reason,suggested_by_name,suggested_by_email,
   cancelled_at,cancel_reason)
 select a->>'id',org,nullif(a->>'doctorId',''),nullif(a->>'anesthetistId',''),
   case when exists(select 1 from public.patients p where p.id=a->>'patientId' and p.owner_professional_id=coalesce(nullif(a->>'doctorId',''),a->>'anesthetistId')) then a->>'patientId' end,
   case when exists(select 1 from public.hospitals h where h.id=a->>'hospitalId') then a->>'hospitalId' end,
   (a->>'date')::date,(a->>'time')::time,(a->>'duration')::integer,
   case when a->>'status' in ('scheduled','confirmed','authorized','analysis','realized') then a->>'status' else 'scheduled' end,
   coalesce(nullif(a->>'careType',''),'outpatient'),coalesce(nullif(a->>'procedure',''),'Procedimento'),a->>'insurance',
   case when a->>'forma_cobranca' in ('PARTICULAR','CONVENIO') then a->>'forma_cobranca' end,a->>'guideExpiry',
   coalesce((a->>'opme')::boolean,false),coalesce((a->>'reports')::boolean,false),coalesce((a->>'exams')::boolean,false),a->>'notes',
   nullif(a->>'statusUpdatedAt','')::timestamptz,a->>'rescheduleReason',a->>'suggestionReason',a->>'suggestedByName',a->>'suggestedByEmail',
   case when c then coalesce(nullif(a->>'cancelledAt','')::timestamptz,rev) end,
   case when c then coalesce(nullif(btrim(a->>'cancelReason'),''),'Não informado') end
 from (select value a,false c from jsonb_array_elements(coalesce(s->'appointments','[]'))
       union all select value,true from jsonb_array_elements(coalesce(s->'cancelledAppointments','[]'))) x
 where exists(select 1 from public.doctors d where d.id=coalesce(nullif(a->>'doctorId',''),a->>'anesthetistId'))
   and (nullif(a->>'anesthetistId','') is null or exists(select 1 from public.doctors d where d.id=a->>'anesthetistId'))
 on conflict do nothing;

 insert into public.appointment_reschedules(id,organization_id,appointment_id,position,from_date,from_time,to_date,to_time,reason,proposed_by,proposed_at)
 select gen_random_uuid()::text,org,a.id,(r.ordinality-1)::integer,r.value->>'fromDate',r.value->>'fromTime',r.value->>'toDate',r.value->>'toTime',
   r.value->>'reason',r.value->>'proposedBy',r.value->>'createdAt'
 from (select value from jsonb_array_elements(coalesce(s->'appointments','[]')) union all select value from jsonb_array_elements(coalesce(s->'cancelledAppointments','[]'))) x
 join public.appointments a on a.id=x.value->>'id'
 cross join lateral jsonb_array_elements(case when jsonb_typeof(x.value->'rescheduleHistory')='array' then x.value->'rescheduleHistory' else '[]' end) with ordinality r;

 insert into public.patient_history_events(id,organization_id,patient_id,appointment_id,type,text,at)
 select h->>'id',org,h->>'patientId',nullif(h->>'appointmentId',''),coalesce(nullif(h->>'type',''),'Registro'),coalesce(h->>'text',''),
   coalesce(nullif(h->>'at','')::timestamptz,rev)
 from jsonb_array_elements(coalesce(s->'patientHistory','[]')) h
 where exists(select 1 from public.patients p where p.id=h->>'patientId')
 on conflict do nothing;

 insert into public.schedule_blocks(id,organization_id,professional_id,date,start_time,end_time,reason)
 select b->>'id',org,b->>'professionalId',(b->>'date')::date,(b->>'start')::time,(b->>'end')::time,coalesce(nullif(btrim(b->>'reason'),''),'Bloqueio')
 from jsonb_array_elements(coalesce(s->'scheduleBlocks','[]')) b
 where exists(select 1 from public.doctors d where d.id=b->>'professionalId') and b->>'start'<b->>'end'
 on conflict do nothing;

 insert into public.scheduling_rules(id,organization_id,professional_id,hospital_id,name,severity,weekday,occurrence,start_time,end_time,max_patients,
   procedure_contains,preferred_times,forbidden_times,block_all_day,enabled)
 select r->>'id',org,r->>'professionalId',case when exists(select 1 from public.hospitals h where h.id=r->>'hospitalId') then r->>'hospitalId' end,
   coalesce(r->>'name',''),coalesce(nullif(r->>'severity',''),'preference'),nullif(r->>'weekday','')::smallint,nullif(r->>'occurrence',''),
   nullif(r->>'start','')::time,nullif(r->>'end','')::time,nullif(r->>'maxPatients','')::integer,coalesce(r->>'procedureContains',''),
   public.agenda_time_list(r->>'preferredTimes'),public.agenda_time_list(r->>'forbiddenTimes'),
   coalesce((r->>'blockAllDay')::boolean,false),coalesce((r->>'enabled')::boolean,true)
 from jsonb_array_elements(coalesce(s->'schedulingRules','[]')) r
 where exists(select 1 from public.doctors d where d.id=r->>'professionalId')
 on conflict do nothing;

 for t in
  select jsonb_build_object('entity','patients','id',id) from public.patients
  union all select jsonb_build_object('entity','appointments','id',id) from public.appointments
  union all select jsonb_build_object('entity','hospitals','id',id) from public.hospitals
  union all select jsonb_build_object('entity','scheduleBlocks','id',id) from public.schedule_blocks
  union all select jsonb_build_object('entity','schedulingRules','id',id) from public.scheduling_rules
 loop
  perform public.record_agenda_row_version(org,t->>'entity',t->>'id',rev);
 end loop;

 select jsonb_array_length(coalesce(s->'patients','[]')),(select count(*) from public.patients) into n_in,n_out;
 raise notice 'A1 pacientes: % no documento, % migrados',n_in,n_out;
 select jsonb_array_length(coalesce(s->'appointments','[]'))+jsonb_array_length(coalesce(s->'cancelledAppointments','[]')),(select count(*) from public.appointments) into n_in,n_out;
 raise notice 'A1 agendamentos: % no documento, % migrados',n_in,n_out;
 select jsonb_array_length(coalesce(s->'patientHistory','[]')),(select count(*) from public.patient_history_events) into n_in,n_out;
 raise notice 'A1 histórico: % no documento, % migrados',n_in,n_out;
 perform set_config('rn.agenda_migration','',true);
end;$$;

-- Sugestões pendentes foram feitas sobre o documento antigo.
update public.agenda_requests set status='denied',decision_note='migração A1',decided_at=now() where status='pending';

-- ---------------------------------------------------------------------------
-- Congelamento do documento legado (removido na A2)
-- ---------------------------------------------------------------------------
drop trigger if exists a_snapshot_appointment_insurance on public.app_state;
drop trigger if exists central_doctor_projection on public.app_state;
drop trigger if exists guard_agenda_appointment_availability on public.app_state;
drop trigger if exists guard_issued_invoice_agenda_cancellation on public.app_state;
drop trigger if exists invoice_appointment_guard on public.app_state;
drop trigger if exists patient_authorship on public.app_state;
drop trigger if exists sync_attendances on public.app_state;

create or replace function public.freeze_app_state() returns trigger
language plpgsql set search_path='' as $$
begin raise exception using errcode='P0001',message='Agenda migrada; atualize a página.'; end;$$;
create trigger app_state_frozen before insert or update or delete on public.app_state for each row execute function public.freeze_app_state();

-- ---------------------------------------------------------------------------
-- Privilégios: tabelas e RPCs só para service_role
-- ---------------------------------------------------------------------------
alter table public.agenda_settings enable row level security;
alter table public.hospitals enable row level security;
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_reschedules enable row level security;
alter table public.patient_history_events enable row level security;
alter table public.schedule_blocks enable row level security;
alter table public.scheduling_rules enable row level security;
alter table public.agenda_row_versions enable row level security;
revoke all on public.agenda_settings,public.hospitals,public.patients,public.appointments,public.appointment_reschedules,
 public.patient_history_events,public.schedule_blocks,public.scheduling_rules,public.agenda_row_versions from public,anon,authenticated;
grant select,insert,update,delete on public.agenda_settings,public.hospitals,public.patients,public.appointments,public.appointment_reschedules,
 public.patient_history_events,public.schedule_blocks,public.scheduling_rules,public.agenda_row_versions to service_role;

revoke all on function public.rn_agenda_organization_id(),public.load_agenda_state(bigint),public.agenda_revision(bigint),
 public.agenda_row_bases(bigint,timestamptz,jsonb),public.apply_agenda_changes(bigint,jsonb,jsonb,text,text,text,jsonb),
 public.record_agenda_row_version(uuid,text,text,timestamptz),public.agenda_row_json(text,text),public.agenda_row_version_of(text,text),
 public.agenda_time_list(text),public.billing_paused(),public.commit_agenda_change(timestamptz,jsonb,timestamptz,jsonb,text,text,bigint,text,jsonb)
 from public,anon,authenticated;
grant execute on function public.rn_agenda_organization_id(),public.load_agenda_state(bigint),public.agenda_revision(bigint),
 public.agenda_row_bases(bigint,timestamptz,jsonb),public.apply_agenda_changes(bigint,jsonb,jsonb,text,text,text,jsonb),
 public.record_agenda_row_version(uuid,text,text,timestamptz),public.agenda_row_json(text,text),public.agenda_row_version_of(text,text),
 public.agenda_time_list(text),public.billing_paused()
 to service_role;
