-- Preserve professional IDs: appointments and financial links keep their references.
create table public.doctors (
 id text primary key, name text not null check(length(trim(name)) between 2 and 160),
 crm text not null default '', specialty text not null default '', category text not null check(category in ('doctor','anesthetist')),
 active boolean not null default true, details jsonb not null default '{}',
 updated_at timestamptz not null default now(), updated_by bigint references public.users(id)
);
create table public.doctor_agendas (
 doctor_id text primary key references public.doctors(id), active boolean not null default true,
 settings jsonb not null default '{}', updated_at timestamptz not null default now(), updated_by bigint references public.users(id)
);
create table public.directory_audit (
 id bigint generated always as identity primary key, actor_id bigint references public.users(id),
 kind text not null, record_id text not null, before_data jsonb, after_data jsonb, created_at timestamptz not null default now()
);
insert into public.doctors(id,name,crm,specialty,category,active,details)
 select p->>'id',p->>'name',coalesce(p->>'crm',''),coalesce(p->>'specialty',''),coalesce(p->>'category','doctor'),coalesce((p->>'active')::boolean,true),p-'id'-'name'-'crm'-'specialty'-'category'-'active'
 from public.app_state s cross join lateral jsonb_array_elements(s.payload->'professionals') p where s.id=1;
insert into public.doctor_agendas(doctor_id) select id from public.doctors;
alter table public.billing_doctor_entities add constraint billing_doctor_reference foreign key(doctor_id) references public.doctors(id);
alter table public.doctors enable row level security;
alter table public.doctor_agendas enable row level security;
alter table public.directory_audit enable row level security;
revoke all on public.doctors,public.doctor_agendas,public.directory_audit from public,anon,authenticated;
grant select,insert,update on public.doctors,public.doctor_agendas to service_role;
grant select,insert on public.directory_audit to service_role;
grant usage,select on sequence public.directory_audit_id_seq to service_role;

-- Compatibility projection for the existing scheduling client, never an editable registry.
create function public.project_central_doctors() returns trigger language plpgsql security invoker set search_path='' as $$
declare appointment jsonb; previous jsonb; professional text;
begin
 for appointment in select value from jsonb_array_elements(coalesce(new.payload->'appointments','[]')) loop
  previous:=null;
  if tg_op='UPDATE' then select value into previous from jsonb_array_elements(coalesce(old.payload->'appointments','[]')) where value->>'id'=appointment->>'id'; end if;
  if previous is null or previous->>'doctorId' is distinct from appointment->>'doctorId' or previous->>'anesthetistId' is distinct from appointment->>'anesthetistId' then
   foreach professional in array array[appointment->>'doctorId',appointment->>'anesthetistId'] loop
    if nullif(professional,'') is not null and not exists(select 1 from public.doctors where id=professional and active) then raise exception 'Médico inexistente ou inativo'; end if;
   end loop;
   if not exists(select 1 from public.doctor_agendas where doctor_id in(appointment->>'doctorId',appointment->>'anesthetistId') and active) then raise exception 'Configure uma agenda ativa para o médico antes de agendar'; end if;
  end if;
 end loop;
 new.payload:=jsonb_set(new.payload,'{professionals}',coalesce((select jsonb_agg(d.details||jsonb_build_object('id',d.id,'name',d.name,'crm',d.crm,'specialty',d.specialty,'category',d.category,'active',d.active,'agendaEnabled',coalesce(a.active,false),'agendaSettings',coalesce(a.settings,'{}'::jsonb)) order by d.name) from public.doctors d left join public.doctor_agendas a on a.doctor_id=d.id),'[]'));
 return new;
end;$$;
revoke all on function public.project_central_doctors() from public,anon,authenticated;
grant execute on function public.project_central_doctors() to service_role;
create trigger central_doctor_projection before insert or update of payload on public.app_state for each row execute function public.project_central_doctors();
update public.app_state set payload=payload,updated_at=clock_timestamp() where id=1;

create function public.save_doctor_directory(p_actor bigint,p_kind text,p_data jsonb) returns text language plpgsql security invoker set search_path='' as $$
declare sid text; old_row jsonb; result_row jsonb;
begin
 perform pg_advisory_xact_lock(194701,1);
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then raise exception 'Somente a gerência pode alterar o cadastro central'; end if;
 sid:=coalesce(nullif(p_data->>'id',''),gen_random_uuid()::text);
 if p_kind='doctor' then
  select to_jsonb(d) into old_row from public.doctors d where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Médico alterado. Atualize a página'; end if;
  if coalesce(length(trim(p_data->>'name')),0)<2 or coalesce(p_data->>'category','') not in ('doctor','anesthetist') then raise exception 'Informe nome e categoria'; end if;
  if nullif(trim(p_data->>'crm'),'') is not null and exists(select 1 from public.doctors where id<>sid and lower(trim(crm))=lower(trim(p_data->>'crm'))) then raise exception 'CRM já cadastrado. Use o médico existente'; end if;
  insert into public.doctors(id,name,crm,specialty,category,active,updated_at,updated_by)
   values(sid,trim(p_data->>'name'),trim(coalesce(p_data->>'crm','')),trim(coalesce(p_data->>'specialty','')),p_data->>'category',coalesce((p_data->>'active')::boolean,true),clock_timestamp(),p_actor)
   on conflict(id) do update set name=excluded.name,crm=excluded.crm,specialty=excluded.specialty,category=excluded.category,active=excluded.active,updated_at=excluded.updated_at,updated_by=p_actor returning to_jsonb(doctors.*) into result_row;
 elsif p_kind='agenda' then
  if not exists(select 1 from public.doctors where id=sid) then raise exception 'Médico não cadastrado'; end if;
  select to_jsonb(a) into old_row from public.doctor_agendas a where doctor_id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Agenda alterada. Atualize a página'; end if;
  if coalesce(p_data->>'workStart','')!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_data->>'workEnd','')!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or p_data->>'workStart'>=p_data->>'workEnd' then raise exception 'Horário da agenda inválido'; end if;
  insert into public.doctor_agendas(doctor_id,active,settings,updated_at,updated_by) values(sid,coalesce((p_data->>'active')::boolean,true),jsonb_build_object('workStart',p_data->>'workStart','workEnd',p_data->>'workEnd'),clock_timestamp(),p_actor)
  on conflict(doctor_id) do update set active=excluded.active,settings=excluded.settings,updated_at=excluded.updated_at,updated_by=p_actor returning to_jsonb(doctor_agendas.*) into result_row;
 else raise exception 'Operação inválida'; end if;
 insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data) values(p_actor,p_kind,sid,old_row,result_row);
 update public.app_state set payload=payload,updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond') where id=1;
 return sid;
end;$$;
revoke all on function public.save_doctor_directory(bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_doctor_directory(bigint,text,jsonb) to service_role;

-- Remove obsolete validity fields; billing_records retain historical ownership.
alter table public.billing_doctor_entities drop column starts_on, drop column ends_on;
alter table public.invoice_billing_records add column id uuid not null default gen_random_uuid();
create unique index invoice_item_id on public.invoice_billing_records(id);
create or replace function public.save_billing(p_actor bigint,p_kind text,p_data jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare role_name text; sid uuid; old_row jsonb; result_row jsonb; state jsonb; a jsonb;
 entity uuid; invoice_id uuid; item uuid; record public.billing_records%rowtype; old_items jsonb;
begin
 perform pg_advisory_xact_lock(194701,1);
 perform pg_advisory_xact_lock(194701,2);
 select role into role_name from public.users where id=p_actor;
 if role_name is null or role_name not in ('general_manager','secretary') then raise exception 'Acesso negado'; end if;
 select payload into state from public.app_state where id=1;
 sid:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
 if p_kind in ('entity','link','delete_entity','delete_link') and role_name<>'general_manager' then raise exception 'Somente a gerência pode configurar entidades'; end if;
 if p_kind in ('delete_entity','delete_link') then
  if p_kind='delete_entity' then
   select to_jsonb(e) into old_row from public.billing_entities e where id=sid;
  else
   select to_jsonb(l) into old_row from public.billing_doctor_entities l where id=sid;
  end if;
  if old_row is null then raise exception 'Registro não encontrado'; end if;
  if (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Registro alterado. Atualize a página'; end if;
  if p_kind='delete_entity' then
   if exists(select 1 from public.billing_records where billing_entity_id=sid) or exists(select 1 from public.invoices where billing_entity_id=sid) or exists(select 1 from public.billing_doctor_entities where billing_entity_id=sid) then raise exception 'Entidade possui vínculos ou histórico financeiro. Inative-a para preservar o histórico'; end if;
   delete from public.billing_entities where id=sid;
  else
   delete from public.billing_doctor_entities where id=sid;
  end if;
 elsif p_kind='entity' then
  select to_jsonb(e) into old_row from public.billing_entities e where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Registro alterado por outro usuário. Atualize a página'; end if;
  if coalesce(p_data->>'person_type','') not in ('PF','PJ') or length(regexp_replace(coalesce(p_data->>'tax_id',''),'[^0-9]','','g'))<>(case when p_data->>'person_type'='PF' then 11 else 14 end) then raise exception 'Informe CPF/CNPJ e tipo de pessoa'; end if;
  insert into public.billing_entities(id,name,tax_id,person_type,trade_name,active,updated_at,updated_by)
  values(sid,trim(p_data->>'name'),regexp_replace(p_data->>'tax_id','[^0-9]','','g'),p_data->>'person_type',nullif(trim(p_data->>'trade_name'),''),coalesce((p_data->>'active')::boolean,true),clock_timestamp(),p_actor)
  on conflict(id) do update set name=excluded.name,tax_id=excluded.tax_id,person_type=excluded.person_type,trade_name=excluded.trade_name,active=excluded.active,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(billing_entities.*) into result_row;
 elsif p_kind='link' then
  select to_jsonb(l) into old_row from public.billing_doctor_entities l where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Vínculo alterado. Atualize a página'; end if;
  if not exists(select 1 from public.doctors where id=p_data->>'doctor_id') then raise exception 'Médico inexistente'; end if;
  if not exists(select 1 from public.billing_entities where id=(p_data->>'billing_entity_id')::uuid and active) then raise exception 'Entidade inativa ou inexistente'; end if;
  if exists(select 1 from public.billing_doctor_entities where doctor_id=p_data->>'doctor_id' and billing_entity_id=(p_data->>'billing_entity_id')::uuid and id<>sid) then raise exception 'Este vínculo já existe. Edite o vínculo cadastrado'; end if;
  insert into public.billing_doctor_entities(id,doctor_id,billing_entity_id,active,updated_at,updated_by)
  values(sid,p_data->>'doctor_id',(p_data->>'billing_entity_id')::uuid,coalesce((p_data->>'active')::boolean,true),clock_timestamp(),p_actor)
  on conflict(id) do update set active=excluded.active,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(billing_doctor_entities.*) into result_row;
 elsif p_kind='record' then
  select x into a from jsonb_array_elements(coalesce(state->'appointments','[]')||coalesce(state->'cancelledAppointments','[]')) x where x->>'id'=p_data->>'appointment_id';
  if a is null then raise exception 'Atendimento inexistente'; end if;
  if role_name<>'general_manager' and not exists(select 1 from public.agenda_access where user_id=p_actor and professional_id in (a->>'doctorId',a->>'anesthetistId')) then raise exception 'Agenda sem permissão'; end if;
  select to_jsonb(b) into old_row from public.billing_records b where appointment_id=p_data->>'appointment_id';
  if old_row is not null then sid:=(old_row->>'id')::uuid; else sid:=gen_random_uuid(); end if;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Financeiro alterado por outro usuário. Atualize'; end if;
  if exists(select 1 from public.invoice_billing_records where billing_record_id=sid) then raise exception 'Edite o pagamento e os dados fiscais na NF/lote vinculada'; end if;
  entity:=(p_data->>'billing_entity_id')::uuid;
  if entity is null or (old_row->>'billing_entity_id' is distinct from entity::text and not exists(
   select 1 from public.billing_doctor_entities l join public.billing_entities e on e.id=l.billing_entity_id
   where l.billing_entity_id=entity and l.doctor_id in (a->>'doctorId',a->>'anesthetistId') and l.active and e.active
)) then raise exception 'Selecione uma entidade vinculada ao médico'; end if;
  if p_data->>'billing_method' not in ('PARTICULAR','CONVENIO') or p_data->>'payment_status' not in ('PENDENTE','PAGO') then raise exception 'Forma de cobrança ou status inválido'; end if;
  if p_data->>'billing_method'='CONVENIO' and p_data->>'payment_status'='PAGO' then raise exception 'Registre o pagamento do convênio na NF/lote'; end if;
  if p_data->>'payment_status'='PAGO' and (nullif(p_data->>'paid_at','') is null or nullif(p_data->>'received_amount','') is null) then raise exception 'Pagamento particular exige valor e data'; end if;
  insert into public.billing_records(id,appointment_id,billing_entity_id,billing_method,payment_status,invoice_number,received_amount,paid_at,notes,updated_at,updated_by)
  values(sid,p_data->>'appointment_id',entity,p_data->>'billing_method',p_data->>'payment_status',case when p_data->>'billing_method'='PARTICULAR' then nullif(trim(p_data->>'invoice_number'),'') end,
   case when p_data->>'billing_method'='PARTICULAR' then nullif(p_data->>'received_amount','')::numeric end,
   case when p_data->>'billing_method'='PARTICULAR' then nullif(p_data->>'paid_at','')::date end,nullif(trim(p_data->>'notes'),''),clock_timestamp(),p_actor)
  on conflict(id) do update set billing_entity_id=excluded.billing_entity_id,billing_method=excluded.billing_method,payment_status=excluded.payment_status,invoice_number=excluded.invoice_number,received_amount=excluded.received_amount,paid_at=excluded.paid_at,notes=excluded.notes,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(billing_records.*) into result_row;
 elsif p_kind='invoice' then
  if role_name<>'general_manager' then raise exception 'Somente a gerência pode gerenciar lotes'; end if;
  select to_jsonb(i) into old_row from public.invoices i where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'NF alterada por outro usuário. Atualize'; end if;
  entity:=(p_data->>'billing_entity_id')::uuid;
  if nullif(trim(p_data->>'payer'),'') is null or nullif(trim(p_data->>'invoice_number'),'') is null or nullif(p_data->>'issue_date','') is null then raise exception 'Preencha número, pagador e emissão'; end if;
  if jsonb_typeof(p_data->'record_ids') is distinct from 'array' or (jsonb_array_length(p_data->'record_ids')=0 and nullif(p_data->>'paid_at','') is not null) then raise exception 'Vincule pelo menos um atendimento antes de confirmar o pagamento'; end if;
  select coalesce(jsonb_agg(billing_record_id),'[]') into old_items from public.invoice_billing_records where invoice_billing_records.invoice_id=sid;
  for item in select value::uuid from jsonb_array_elements_text(p_data->'record_ids') loop
   select * into record from public.billing_records where id=item;
   if not found or record.billing_entity_id<>entity or record.billing_method<>'CONVENIO' then raise exception 'Atendimento incompatível com a entidade ou cobrança'; end if;
   if exists(select 1 from public.invoice_billing_records where billing_record_id=item and invoice_billing_records.invoice_id<>sid) then raise exception 'Atendimento já vinculado a outra NF'; end if;
   select x into a from jsonb_array_elements(coalesce(state->'appointments','[]')) x where x->>'id'=record.appointment_id;
   if a is null then raise exception 'Atendimento cancelado ou inexistente'; end if;
   if not exists(select 1 from public.invoice_billing_records where invoice_billing_records.invoice_id=sid and billing_record_id=item) then
    if coalesce(a->>'status','')<>'realized' or record.payment_status<>'PENDENTE' then raise exception 'Somente atendimentos realizados e pendentes podem ser vinculados'; end if;
   end if;
   if lower(trim(coalesce(nullif(a->>'insurance',''),(select x->>'insurance' from jsonb_array_elements(state->'patients') x where x->>'id'=a->>'patientId'),'')))<>lower(trim(p_data->>'payer')) then raise exception 'Convênio do atendimento diferente do pagador'; end if;
  end loop;
  insert into public.invoices(id,billing_entity_id,invoice_number,payer,issue_date,total_amount,net_amount,paid_at,notes,updated_at,updated_by)
  values(sid,entity,trim(p_data->>'invoice_number'),trim(p_data->>'payer'),(p_data->>'issue_date')::date,nullif(p_data->>'total_amount','')::numeric,nullif(p_data->>'net_amount','')::numeric,nullif(p_data->>'paid_at','')::date,nullif(trim(p_data->>'notes'),''),clock_timestamp(),p_actor)
  on conflict(id) do update set billing_entity_id=excluded.billing_entity_id,invoice_number=excluded.invoice_number,payer=excluded.payer,issue_date=excluded.issue_date,total_amount=excluded.total_amount,net_amount=excluded.net_amount,paid_at=excluded.paid_at,notes=excluded.notes,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(invoices.*) into result_row;
  update public.billing_records set payment_status='PENDENTE',updated_at=clock_timestamp(),updated_by=p_actor where id in(select billing_record_id from public.invoice_billing_records where invoice_billing_records.invoice_id=sid);
  delete from public.invoice_billing_records where invoice_billing_records.invoice_id=sid;
  insert into public.invoice_billing_records(invoice_id,billing_record_id) select distinct sid,value::uuid from jsonb_array_elements_text(p_data->'record_ids');
  update public.billing_records set payment_status=case when nullif(p_data->>'paid_at','') is null then 'PENDENTE' else 'PAGO' end,received_amount=null,paid_at=null,invoice_number=null,updated_at=clock_timestamp(),updated_by=p_actor where id in(select value::uuid from jsonb_array_elements_text(p_data->'record_ids'));
  old_row:=coalesce(old_row,'{}')||jsonb_build_object('record_ids',old_items);
  result_row:=result_row||jsonb_build_object('record_ids',p_data->'record_ids');
 else raise exception 'Operação inválida'; end if;
 insert into public.billing_audit(actor_id,action,record_id,before_data,after_data) values(p_actor,p_kind,sid,old_row,result_row);
 return sid;
end;$$;
revoke all on function public.save_billing(bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_billing(bigint,text,jsonb) to service_role;
