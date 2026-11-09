-- Fase 2B-M1 — isolamento por organização no núcleo (agenda, cadastro e acessos).
-- A organização vem SEMPRE do vínculo ativo do usuário autenticado, nunca do navegador.
-- Remove o bloqueio "exatamente uma organização" das funções da agenda, sessão e acessos,
-- e passa a validar cada gravação contra a organização do autor (rn.actor).
-- O faturamento continua desligado; suas tabelas ficam escopadas pela mesma regra.

-- 0. Uma organização ativa por usuário (seleção de clínica no login fica para depois).
create unique index if not exists organization_memberships_one_active_per_user
 on public.organization_memberships(user_id) where active;

-- 1. Organização do usuário: vínculo ativo com o mesmo papel, em organização ativa.
create or replace function public.actor_organization_id(p_actor bigint) returns uuid
language plpgsql stable set search_path='' as $$
declare v uuid;
begin
 select m.organization_id into v from public.users u
  join public.organization_memberships m on m.user_id=u.id and m.active and m.role=u.role
  join public.organizations o on o.id=m.organization_id and o.active
 where u.id=p_actor and u.active;
 if v is null then raise exception 'Acesso à organização negado'; end if;
 return v;
end;$$;

-- 2. Organização da operação em curso (rn.actor); nula quando não há autor definido.
create or replace function public.current_organization_id() returns uuid
language plpgsql stable set search_path='' as $$
declare a bigint:=nullif(current_setting('rn.actor',true),'')::bigint;
begin
 if a is null then return null; end if;
 return public.actor_organization_id(a);
end;$$;

-- Organização de um usuário qualquer (vínculo ativo, senão o mais recente).
create or replace function public.user_organization_id(p_user bigint) returns uuid
language sql stable set search_path='' as $$
 select organization_id from public.organization_memberships where user_id=p_user
 order by active desc, updated_at desc nulls last limit 1
$$;

-- 3. Funções antigas de "organização única" passam a significar "organização do autor".
create or replace function public.require_rn_agenda_actor_organization(p_actor bigint) returns uuid
language plpgsql stable set search_path='' as $$
declare v uuid;
begin
 if p_actor is null then raise exception 'Acesso à organização negado'; end if;
 v:=public.actor_organization_id(p_actor);
 if not exists (select 1 from public.agenda_settings where organization_id=v) then
  raise exception 'Agenda da organização indisponível';
 end if;
 return v;
end;$$;

create or replace function public.rn_agenda_organization_id() returns uuid
language plpgsql stable set search_path='' as $$
declare v uuid:=public.current_organization_id();
begin
 if v is null then raise exception 'Organização de operação inválida. Acesso bloqueado'; end if;
 return v;
end;$$;

create or replace function public.rn_finance_single_organization_id() returns uuid
language plpgsql stable set search_path='' as $$
declare v uuid:=public.current_organization_id();
begin
 if v is null then raise exception 'Organização de operação inválida. Acesso bloqueado'; end if;
 return v;
end;$$;

-- Defaults financeiros (inclui doctors e attendances): organização da operação.
do $$ declare r record; begin
 for r in select table_name from information_schema.columns
  where table_schema='public' and column_name='organization_id' and column_default like '%rn_finance_single_organization_id()%'
 loop execute format('alter table public.%I alter column organization_id set default public.current_organization_id()',r.table_name); end loop;
end $$;

-- 4. Guardas: o registro precisa ter organização e, havendo autor, ser da organização dele.
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
 if tg_table_name in ('patient_history_events','appointment_reschedules') then
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

create or replace function public.guard_agenda_settings_row() returns trigger
language plpgsql set search_path='' as $$
declare ctx uuid:=public.current_organization_id();
begin
 if tg_op='DELETE' then raise exception 'Configuração da agenda não pode ser excluída'; end if;
 if new.organization_id is null or (ctx is not null and new.organization_id<>ctx) then raise exception 'Registro fora da organização atual'; end if;
 if tg_op='UPDATE' then
  if new.organization_id is distinct from old.organization_id then raise exception 'Registro fora da organização atual'; end if;
  new.row_version:=old.row_version+1; new.updated_at:=clock_timestamp();
 end if;
 return new;
end;$$;

create or replace function public.guard_rn_finance_organization() returns trigger
language plpgsql set search_path='' as $$
declare ctx uuid:=public.current_organization_id();
begin
 if new.organization_id is null then raise exception 'Registro financeiro sem organização'; end if;
 if ctx is not null and new.organization_id<>ctx then raise exception 'Registro financeiro fora da organização autorizada'; end if;
 if tg_op='UPDATE' and old.organization_id is distinct from new.organization_id then
  raise exception 'Transferência de organização financeira proibida';
 end if;
 return new;
end;$$;

-- 5. Leituras por identificador ficam restritas à organização informada.
create or replace function public.agenda_row_json(p_entity text,p_id text,p_org uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 case p_entity
  when 'patients' then select public.agenda_patient_json(x) into result from public.patients x where id=p_id and organization_id=p_org;
  when 'appointments' then select public.agenda_appointment_json(x)||jsonb_build_object('_cancelled',x.cancelled_at is not null,'_archived',x.archived_at is not null) into result from public.appointments x where id=p_id and organization_id=p_org;
  when 'hospitals' then select public.agenda_hospital_json(x)||jsonb_build_object('_archived',x.archived_at is not null) into result from public.hospitals x where id=p_id and organization_id=p_org;
  when 'scheduleBlocks' then select public.agenda_block_json(x) into result from public.schedule_blocks x where id=p_id and organization_id=p_org;
  when 'schedulingRules' then select public.agenda_rule_json(x) into result from public.scheduling_rules x where id=p_id and organization_id=p_org;
  else raise exception 'Entidade inválida';
 end case;
 return result;
end;$$;

create or replace function public.agenda_row_version_of(p_entity text,p_id text,p_org uuid) returns integer
language plpgsql stable security invoker set search_path='' as $$
declare v integer;
begin
 case p_entity
  when 'patients' then select row_version into v from public.patients where id=p_id and organization_id=p_org;
  when 'appointments' then select row_version into v from public.appointments where id=p_id and organization_id=p_org;
  when 'hospitals' then select row_version into v from public.hospitals where id=p_id and organization_id=p_org;
  when 'scheduleBlocks' then select row_version into v from public.schedule_blocks where id=p_id and organization_id=p_org;
  when 'schedulingRules' then select row_version into v from public.scheduling_rules where id=p_id and organization_id=p_org;
  else raise exception 'Entidade inválida';
 end case;
 return v;
end;$$;

-- Versões de 2 argumentos: organização da operação (sem autor, nada é encontrado).
create or replace function public.agenda_row_json(p_entity text,p_id text) returns jsonb
language sql stable security invoker set search_path='' as $$ select public.agenda_row_json(p_entity,p_id,public.current_organization_id()) $$;
create or replace function public.agenda_row_version_of(p_entity text,p_id text) returns integer
language sql stable security invoker set search_path='' as $$ select public.agenda_row_version_of(p_entity,p_id,public.current_organization_id()) $$;

create or replace function public.record_agenda_row_version(p_org uuid,p_entity text,p_id text,p_revision timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
declare v integer:=public.agenda_row_version_of(p_entity,p_id,p_org);
begin
 if v is null then
  v:=coalesce((select max(row_version) from public.agenda_row_versions where organization_id=p_org and entity=p_entity and row_id=p_id),0)+1;
 end if;
 insert into public.agenda_row_versions(organization_id,entity,row_id,row_version,revision,data)
 values(p_org,p_entity,p_id,v,p_revision,public.agenda_row_json(p_entity,p_id,p_org))
 on conflict (entity,row_id,row_version) do update set revision=excluded.revision,data=excluded.data
  where public.agenda_row_versions.organization_id=excluded.organization_id;
end;$$;

create or replace function public.agenda_row_bases(p_actor bigint,p_revision timestamptz,p_keys jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare org uuid:=public.require_rn_agenda_actor_organization(p_actor);
begin
 return coalesce((select jsonb_agg(jsonb_build_object('entity',k.entity,'id',k.id,
   'currentVersion',public.agenda_row_version_of(k.entity,k.id,org),
   'baseVersion',base.row_version,'base',base.data))
  from jsonb_to_recordset(coalesce(p_keys,'[]'::jsonb)) k(entity text,id text)
  left join lateral (select v.row_version,v.data from public.agenda_row_versions v
    where v.organization_id=org and v.entity=k.entity and v.row_id=k.id and v.revision<=p_revision
    order by v.revision desc,v.row_version desc limit 1) base on true),'[]'::jsonb);
end;$$;

-- 6. Tabelas que ainda não tinham organização: coluna obrigatória + guarda.
-- A organização é derivada do usuário/médico referenciado e conferida contra o autor.
create or replace function public.guard_tenant_row() returns trigger
language plpgsql set search_path='' as $$
declare ctx uuid:=public.current_organization_id(); spec text; kind text; col text; ref text; derived uuid; row_data jsonb; first_derived uuid; i integer;
begin
 if tg_op='DELETE' then
  if ctx is not null and old.organization_id<>ctx then raise exception 'Registro fora da organização atual'; end if;
  return old;
 end if;
 if tg_op='UPDATE' then
  if new.organization_id is distinct from old.organization_id then raise exception 'Alteração de organização não permitida'; end if;
  if ctx is not null and old.organization_id<>ctx then raise exception 'Registro fora da organização atual'; end if;
 end if;
 row_data:=to_jsonb(new);
 for i in 0..tg_nargs-1 loop
  spec:=tg_argv[i]; kind:=split_part(spec,':',1); col:=split_part(spec,':',2); ref:=row_data->>col;
  if ref is null or ref='' then continue; end if;
  derived:=case kind when 'user' then public.user_organization_id(ref::bigint)
                     when 'doctor' then (select organization_id from public.doctors where id=ref) end;
  if derived is null then raise exception 'Vínculo sem organização (%)',col; end if;
  if first_derived is null then first_derived:=derived; end if;
  -- Todos os vínculos da linha precisam ser da mesma organização (entre si e com a informada).
  if derived<>first_derived or (new.organization_id is not null and derived<>new.organization_id) then raise exception 'Vínculo de outra organização (%)',col; end if;
 end loop;
 new.organization_id:=coalesce(new.organization_id,first_derived,ctx);
 if new.organization_id is null then raise exception 'Registro sem organização'; end if;
 if ctx is not null and new.organization_id<>ctx then raise exception 'Registro fora da organização atual'; end if;
 if first_derived is not null and first_derived<>new.organization_id then raise exception 'Vínculo de outra organização'; end if;
 return new;
end;$$;

do $$
declare spec record; rn uuid;
begin
 select id into rn from public.organizations where slug='rn-gestao';
 for spec in select * from (values
   ('audit_logs',array['user:actor_user_id','doctor:professional_id']),
   ('notifications',array['user:user_id']),
   ('agenda_requests',array['user:requested_by','doctor:professional_id']),
   ('agenda_access',array['user:user_id','doctor:professional_id']),
   ('doctor_agendas',array['doctor:doctor_id']),
   ('surgery_documents',array['user:uploaded_by']),
   ('directory_audit',array['user:actor_id'])
  ) t(tbl,args)
 loop
  if to_regclass('public.'||spec.tbl) is null then continue; end if;
  execute format('alter table public.%I add column if not exists organization_id uuid references public.organizations(id)',spec.tbl);
  execute format('update public.%I set organization_id=%L where organization_id is null',spec.tbl,rn);
  execute format('alter table public.%I alter column organization_id set not null',spec.tbl);
  execute format('create index if not exists %I on public.%I(organization_id)',spec.tbl||'_org_idx',spec.tbl);
  execute format('drop trigger if exists guard_tenant_row on public.%I',spec.tbl);
  execute format('create trigger guard_tenant_row before insert or update or delete on public.%I for each row execute function public.guard_tenant_row(%s)',
   spec.tbl,(select string_agg(quote_literal(a),',') from unnest(spec.args) a));
 end loop;
end $$;
create index if not exists audit_logs_org_created_idx on public.audit_logs(organization_id,created_at desc);

-- 7. Sessão: vínculo ativo em qualquer organização ativa; devolve a organização.
create or replace function public.session_context(p_token_hash text)
returns jsonb language plpgsql stable set search_path to '' as $function$
declare
 v_user public.users%rowtype; v_org public.organizations%rowtype;
 v_services jsonb:='{"scheduling_enabled":false,"billing_enabled":false,"invoice_enabled":false}'::jsonb;
 v_agendas text[]:='{}';
begin
 if p_token_hash is null or length(p_token_hash)>100 then return null; end if;
 select u.* into v_user from public.sessions s join public.users u on u.id=s.user_id
  where s.token_hash=p_token_hash and s.expires_at>now();
 if not found or not v_user.active or v_user.role not in ('general_manager','secretary','doctor') then return null; end if;
 select o.* into v_org from public.organization_memberships m join public.organizations o on o.id=m.organization_id
  where m.user_id=v_user.id and m.active and m.role=v_user.role and o.active;
 if not found then return null; end if;
 if v_user.role='doctor' and v_user.doctor_id is not null then
  select jsonb_build_object('scheduling_enabled',d.scheduling_enabled,'billing_enabled',d.billing_enabled,'invoice_enabled',d.invoice_enabled)
   into v_services from public.doctors d where d.id=v_user.doctor_id and d.active and d.organization_id=v_org.id;
  v_services:=coalesce(v_services,'{"scheduling_enabled":false,"billing_enabled":false,"invoice_enabled":false}'::jsonb);
 end if;
 if v_user.role<>'general_manager' then
  select coalesce(array_agg(distinct x),'{}') into v_agendas from (
   select a.professional_id::text x from public.agenda_access a join public.doctors d on d.id=a.professional_id and d.organization_id=v_org.id
    where a.user_id=v_user.id and a.organization_id=v_org.id
   union select v_user.doctor_id where v_user.role='doctor' and v_user.doctor_id is not null
  ) t;
 end if;
 return jsonb_build_object(
  'account',jsonb_build_object('id',v_user.id,'email',v_user.email,'name',v_user.name,'role',v_user.role,'doctorId',v_user.doctor_id),
  'organization',jsonb_build_object('id',v_org.id,'slug',v_org.slug,'name',v_org.name),
  'services',v_services,
  'agendaIds',to_jsonb(v_agendas));
end;$function$;

create or replace function public.agenda_sync_signal(p_token_hash text)
returns jsonb language plpgsql stable set search_path to '' as $function$
declare
 v_session jsonb:=public.session_context(p_token_hash);
 v_id bigint; v_role text; v_org uuid; v_agendas text[]; v_revision timestamptz; v_workflow timestamptz;
begin
 if v_session is null then return null; end if;
 v_id:=(v_session->'account'->>'id')::bigint; v_role:=v_session->'account'->>'role'; v_org:=(v_session->'organization'->>'id')::uuid;
 select coalesce(array_agg(value),'{}') into v_agendas from jsonb_array_elements_text(v_session->'agendaIds');
 select revision into v_revision from public.agenda_settings where organization_id=v_org;
 select max(t) into v_workflow from (
  select (select l.created_at from public.audit_logs l where v_role='general_manager' and l.organization_id=v_org order by l.created_at desc limit 1) t
  union all select (select l.created_at from public.audit_logs l where v_role='secretary' and l.organization_id=v_org and l.professional_id=any(v_agendas) order by l.created_at desc limit 1)
  union all select (select n.created_at from public.notifications n where n.user_id=v_id and n.organization_id=v_org order by n.created_at desc limit 1)
  union all select (select max(n.read_at) from public.notifications n where n.user_id=v_id and n.organization_id=v_org)
  union all select (select r.created_at from public.agenda_requests r where v_role='doctor' and r.organization_id=v_org and r.requested_by=v_id and r.professional_id=any(v_agendas) order by r.created_at desc limit 1)
 ) s;
 return jsonb_build_object('session',v_session,'revision',v_revision,'workflowRevision',v_workflow);
end;$function$;

-- 8. Cadastro de médicos: tudo dentro da organização do gerente; CRM único por organização.
create or replace function public.save_doctor_directory(p_actor bigint, p_kind text, p_data jsonb)
returns text language plpgsql set search_path to '' as $function$
declare sid text; old_row jsonb; result_row jsonb; old_agenda jsonb; new_agenda jsonb; org uuid;
begin
 perform pg_advisory_xact_lock(194701,1);
 org:=public.require_rn_agenda_actor_organization(p_actor);
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then raise exception 'Somente a gerência pode alterar o cadastro central'; end if;
 sid:=coalesce(nullif(p_data->>'id',''),gen_random_uuid()::text);
 if exists(select 1 from public.doctors where id=sid and organization_id<>org) then raise exception 'Médico não cadastrado'; end if;
 perform public.financial_operation(p_actor,'doctor',sid);
 if p_kind='doctor' then
  select to_jsonb(d) into old_row from public.doctors d where id=sid and organization_id=org;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Médico alterado. Atualize a página'; end if;
  if coalesce(length(trim(p_data->>'name')),0)<2 then raise exception 'Informe o nome'; end if;
  if not coalesce(public.valid_medical_specialty(p_data->>'specialty'),false) then raise exception 'Selecione uma especialidade da lista';end if;
  if nullif(trim(p_data->>'crm'),'') is not null and exists(select 1 from public.doctors where organization_id=org and id<>sid and lower(trim(crm))=lower(trim(p_data->>'crm'))) then raise exception 'CRM já cadastrado. Use o médico existente'; end if;
  insert into public.doctors(id,organization_id,name,crm,specialty,category,active,scheduling_enabled,billing_enabled,invoice_enabled,updated_at,updated_by)
   values(sid,org,trim(p_data->>'name'),trim(coalesce(p_data->>'crm','')),trim(coalesce(p_data->>'specialty','')),case when public.is_anesthesiologist(p_data->>'specialty') then 'anesthetist' else 'doctor' end,coalesce((p_data->>'active')::boolean,true),coalesce((p_data->>'scheduling_enabled')::boolean,(old_row->>'scheduling_enabled')::boolean,true),coalesce((p_data->>'billing_enabled')::boolean,(old_row->>'billing_enabled')::boolean,true),coalesce((p_data->>'invoice_enabled')::boolean,(old_row->>'invoice_enabled')::boolean,true),clock_timestamp(),p_actor)
   on conflict(id) do update set name=excluded.name,crm=excluded.crm,specialty=excluded.specialty,category=excluded.category,active=excluded.active,scheduling_enabled=excluded.scheduling_enabled,billing_enabled=excluded.billing_enabled,invoice_enabled=excluded.invoice_enabled,updated_at=excluded.updated_at,updated_by=p_actor
   where public.doctors.organization_id=org
   returning to_jsonb(doctors.*) into result_row;
  if result_row is null then raise exception 'Médico não cadastrado'; end if;
 elsif p_kind='agenda' then
  if not exists(select 1 from public.doctors where id=sid and organization_id=org) then raise exception 'Médico não cadastrado'; end if;
  if not exists(select 1 from public.doctors where id=sid and organization_id=org and scheduling_enabled) then raise exception 'Agendamento não habilitado para o médico';end if;
  select to_jsonb(a) into old_row from public.doctor_agendas a where doctor_id=sid and organization_id=org;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Agenda alterada. Atualize a página'; end if;
  if coalesce(p_data->>'workStart','')!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_data->>'workEnd','')!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or p_data->>'workStart'>=p_data->>'workEnd' then raise exception 'Horário da agenda inválido'; end if;
  insert into public.doctor_agendas(doctor_id,organization_id,active,settings,updated_at,updated_by) values(sid,org,coalesce((p_data->>'active')::boolean,true),jsonb_build_object('workStart',p_data->>'workStart','workEnd',p_data->>'workEnd'),clock_timestamp(),p_actor)
  on conflict(doctor_id) do update set active=excluded.active,settings=excluded.settings,updated_at=excluded.updated_at,updated_by=p_actor returning to_jsonb(doctor_agendas.*) into result_row;
 else raise exception 'Operação inválida'; end if;
 if p_kind='doctor' and (result_row->>'scheduling_enabled')::boolean then
  select to_jsonb(a) into old_agenda from public.doctor_agendas a where a.doctor_id=sid and a.organization_id=org;
  if old_agenda is null or not coalesce((old_row->>'scheduling_enabled')::boolean,false) then
   insert into public.doctor_agendas(doctor_id,organization_id,active,settings,updated_at,updated_by)
    values(sid,org,true,jsonb_build_object('workStart','07:00','workEnd','19:00'),clock_timestamp(),p_actor)
    on conflict(doctor_id) do update set active=true,updated_at=clock_timestamp(),updated_by=p_actor
    returning to_jsonb(doctor_agendas.*) into new_agenda;
   insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data,organization_id) values(p_actor,'agenda',sid,old_agenda,new_agenda,org);
  end if;
 end if;
 insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data,organization_id) values(p_actor,p_kind,sid,old_row,result_row,org);
 update public.agenda_settings set revision=date_trunc('milliseconds',greatest(clock_timestamp(),revision+interval '1 millisecond')) where organization_id=org;
 if not found then raise exception 'Agenda da organização indisponível'; end if;
 perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);return sid;
end;$function$;

-- 9. Acessos: a gerência só cria, altera ou desativa contas da própria organização.
create or replace function public.save_user_access(p_actor bigint, p_data jsonb, p_credentials jsonb default null::jsonb)
returns bigint language plpgsql set search_path to '' as $function$
declare uid bigint:=nullif(p_data->>'id','')::bigint; old_account public.users%rowtype; did text:=nullif(p_data->>'doctor_id',''); email_value text:=lower(trim(p_data->>'email')); role_value text:=p_data->>'role'; grant_id text; org uuid; desired_active boolean;
begin
 perform pg_advisory_xact_lock(194701,1);
 org:=public.actor_organization_id(p_actor);
 if not exists(
  select 1 from public.users actor
  join public.organization_memberships membership on membership.user_id=actor.id
  where actor.id=p_actor and actor.role='general_manager' and actor.active
    and membership.organization_id=org and membership.role='general_manager' and membership.active
 ) then raise exception 'Acesso restrito à gerência'; end if;
 if role_value not in ('general_manager','secretary','doctor') or role_value is null or email_value is null or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(email_value)>254 then raise exception 'Dados de acesso inválidos'; end if;
 if role_value='doctor' and (did is null or not exists(select 1 from public.doctors where id=did and organization_id=org)) then raise exception 'Selecione um médico existente'; end if;
 if role_value<>'doctor' then did:=null; end if;
 if uid=p_actor and role_value<>'general_manager' then raise exception 'Outro gerente deve alterar seu nível de acesso'; end if;
 if uid is not null then
  select * into old_account from public.users where id=uid for update;
  if not found then raise exception 'Usuário inexistente'; end if;
  if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=uid)
      or exists(select 1 from public.organization_memberships where user_id=uid and organization_id<>org)
   then raise exception 'Conta fora da organização atual'; end if;
  if p_data ? 'updated_at' and old_account.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Acesso alterado por outro usuário. Atualize'; end if;
 end if;
 if p_data ? 'active' and jsonb_typeof(p_data->'active') <> 'boolean' then raise exception 'Situação de acesso inválida'; end if;
 if uid is null and p_data ? 'active' then raise exception 'Novo acesso deve começar ativo'; end if;
 desired_active:=case when uid is null then true when p_data ? 'active' then (p_data->>'active')::boolean else old_account.active end;
 if uid=p_actor and not desired_active then raise exception 'Outro gerente deve desativar seu acesso'; end if;
 if exists(select 1 from public.users where lower(email)=email_value and id is distinct from uid) then raise exception 'Já existe uma conta com este e-mail'; end if;
 if did is not null and exists(select 1 from public.users where doctor_id=did and id is distinct from uid) then raise exception 'Este médico já possui um acesso'; end if;
 if uid is null and p_credentials is null then raise exception 'Informe uma senha inicial'; end if;
 if p_credentials is not null and (coalesce(p_credentials->>'hash','') !~ '^pbkdf2-sha256\$600000\$[A-Za-z0-9+/=]+$' or length(coalesce(p_credentials->>'salt',''))<20) then raise exception 'Credencial inválida'; end if;
 if p_data ? 'agendaIds' then
  if jsonb_typeof(p_data->'agendaIds') is distinct from 'array' then raise exception 'Agendas inválidas'; end if;
  for grant_id in select jsonb_array_elements_text(p_data->'agendaIds') loop
   if not exists(select 1 from public.doctors where id=grant_id and organization_id=org) then raise exception 'Agenda inexistente'; end if;
  end loop;
 end if;
 if uid is null then
  insert into public.users(email,name,role,doctor_id,password_hash,password_salt,active) values(email_value,coalesce(p_data->>'name',''),role_value,did,p_credentials->>'hash',p_credentials->>'salt',true) returning id into uid;
  insert into public.organization_memberships(organization_id,user_id,role,active) values(org,uid,role_value,true);
 else
  update public.users set email=email_value,name=coalesce(p_data->>'name',''),role=role_value,doctor_id=did,active=desired_active,password_hash=coalesce(p_credentials->>'hash',password_hash),password_salt=coalesce(p_credentials->>'salt',password_salt),updated_at=clock_timestamp() where id=uid;
  update public.organization_memberships set role=role_value,active=desired_active,updated_at=clock_timestamp() where organization_id=org and user_id=uid;
  if not found then raise exception 'Vínculo da organização não encontrado'; end if;
 end if;
 delete from public.sessions where user_id=uid;
 if p_data ? 'agendaIds' or role_value='general_manager' then
  delete from public.agenda_access where user_id=uid and organization_id=org;
  if role_value<>'general_manager' then
   insert into public.agenda_access(user_id,professional_id,organization_id) select uid,value,org from (select distinct jsonb_array_elements_text(p_data->'agendaIds') value) x;
  end if;
 end if;
 if did is not null and not exists(select 1 from public.agenda_access where user_id=uid and professional_id=did) then insert into public.agenda_access(user_id,professional_id,organization_id) values(uid,did,org); end if;
 insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data,organization_id) values(p_actor,'user_access',uid::text,case when old_account.id is not null then jsonb_build_object('email',old_account.email,'role',old_account.role,'doctor_id',old_account.doctor_id,'active',old_account.active) end,jsonb_build_object('email',email_value,'role',role_value,'doctor_id',did,'active',desired_active,'password_changed',p_credentials is not null,'agendaIds',(select coalesce(jsonb_agg(professional_id),'[]') from public.agenda_access where user_id=uid)),org);
 return uid;
end;$function$;

create or replace function public.deactivate_user_access(p_actor bigint, p_target bigint)
returns boolean language plpgsql set search_path to '' as $function$
declare org uuid; target_user public.users%rowtype;
begin
 perform pg_advisory_xact_lock(194701,1);
 org:=public.actor_organization_id(p_actor);
 if not exists (
  select 1 from public.users actor
  join public.organization_memberships membership on membership.user_id=actor.id
  where actor.id=p_actor and actor.role='general_manager' and actor.active
    and membership.organization_id=org and membership.role='general_manager' and membership.active
 ) then raise exception 'Acesso restrito à gerência'; end if;
 if p_target is null or p_target=p_actor then raise exception 'O gerente não pode desativar seu próprio acesso'; end if;
 select * into target_user from public.users where id=p_target for update;
 if not found then raise exception 'Usuário inexistente'; end if;
 if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=p_target)
    or exists(select 1 from public.organization_memberships where organization_id<>org and user_id=p_target)
 then raise exception 'Conta fora da organização atual'; end if;
 if not target_user.active then
  delete from public.sessions where user_id=p_target;
  return false;
 end if;
 update public.users set active=false,updated_at=clock_timestamp() where id=p_target;
 update public.organization_memberships set active=false,updated_at=clock_timestamp() where organization_id=org and user_id=p_target;
 delete from public.sessions where user_id=p_target;
 insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data,organization_id)
 values(p_actor,'user_access',p_target::text,
        jsonb_build_object('email',target_user.email,'role',target_user.role,'active',true),
        jsonb_build_object('email',target_user.email,'role',target_user.role,'active',false,'access_revoked',true),org);
 return true;
end;$function$;

revoke all on function public.actor_organization_id(bigint),public.current_organization_id(),public.user_organization_id(bigint),
 public.agenda_row_json(text,text,uuid),public.agenda_row_version_of(text,text,uuid),public.guard_tenant_row() from public,anon,authenticated;
grant execute on function public.actor_organization_id(bigint),public.current_organization_id(),public.user_organization_id(bigint),
 public.agenda_row_json(text,text,uuid),public.agenda_row_version_of(text,text,uuid) to service_role;
