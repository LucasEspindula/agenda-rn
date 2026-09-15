-- Additive extension; no clinical data is copied into financial tables.
alter table public.billing_entities add column person_type text check(person_type in ('PF','PJ'));
alter table public.billing_entities add column trade_name text;
alter table public.billing_entities add column updated_at timestamptz not null default now();
alter table public.billing_entities add column updated_by bigint references public.users(id);
create table public.billing_doctor_entities (
 id uuid primary key default gen_random_uuid(), doctor_id text not null,
 billing_entity_id uuid not null references public.billing_entities(id),
 starts_on date not null, ends_on date, active boolean not null default true,
 updated_at timestamptz not null default now(), updated_by bigint references public.users(id),
 check(ends_on is null or ends_on>=starts_on)
);
create index on public.billing_doctor_entities(doctor_id,billing_entity_id,starts_on);
alter table public.invoices add column payer text;
alter table public.invoices add column net_amount numeric(12,2) check(net_amount>=0);
alter table public.invoices add column notes text;
alter table public.invoices add column updated_at timestamptz not null default now();
alter table public.invoices add column updated_by bigint references public.users(id);
alter table public.invoices add constraint invoice_positive_total check(total_amount>=0);
create unique index one_invoice_per_billing_record on public.invoice_billing_records(billing_record_id);
create table public.billing_audit (
 id bigint generated always as identity primary key, actor_id bigint not null references public.users(id),
 action text not null, record_id uuid not null, before_data jsonb, after_data jsonb,
 created_at timestamptz not null default now()
);
alter table public.billing_doctor_entities enable row level security;
alter table public.billing_audit enable row level security;
revoke all on public.billing_doctor_entities,public.billing_audit from public,anon,authenticated;
grant select,insert,update,delete on public.billing_doctor_entities to service_role;
grant select,insert on public.billing_audit to service_role;
grant usage,select on sequence public.billing_audit_id_seq to service_role;

-- All related writes and their audit entry commit together. Only the backend may call this.
create function public.save_billing(p_actor bigint,p_kind text,p_data jsonb) returns uuid
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
 if p_kind in ('entity','link') and role_name<>'general_manager' then raise exception 'Somente a gerência pode configurar entidades'; end if;
 if p_kind='entity' then
  select to_jsonb(e) into old_row from public.billing_entities e where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Registro alterado por outro usuário. Atualize a página'; end if;
  if p_data->>'person_type' not in ('PF','PJ') or length(regexp_replace(coalesce(p_data->>'tax_id',''),'[^0-9]','','g'))<>(case when p_data->>'person_type'='PF' then 11 else 14 end) then raise exception 'Informe CPF/CNPJ e tipo de pessoa'; end if;
  insert into public.billing_entities(id,name,tax_id,person_type,trade_name,active,updated_at,updated_by)
  values(sid,trim(p_data->>'name'),regexp_replace(p_data->>'tax_id','[^0-9]','','g'),p_data->>'person_type',nullif(trim(p_data->>'trade_name'),''),coalesce((p_data->>'active')::boolean,true),clock_timestamp(),p_actor)
  on conflict(id) do update set name=excluded.name,tax_id=excluded.tax_id,person_type=excluded.person_type,trade_name=excluded.trade_name,active=excluded.active,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(billing_entities.*) into result_row;
 elsif p_kind='link' then
  select to_jsonb(l) into old_row from public.billing_doctor_entities l where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Vínculo alterado. Atualize a página'; end if;
  if not exists(select 1 from jsonb_array_elements(state->'professionals') x where x->>'id'=p_data->>'doctor_id') then raise exception 'Médico inexistente'; end if;
  if not exists(select 1 from public.billing_entities where id=(p_data->>'billing_entity_id')::uuid and active) then raise exception 'Entidade inativa ou inexistente'; end if;
  insert into public.billing_doctor_entities(id,doctor_id,billing_entity_id,starts_on,ends_on,active,updated_at,updated_by)
  values(sid,p_data->>'doctor_id',(p_data->>'billing_entity_id')::uuid,(p_data->>'starts_on')::date,nullif(p_data->>'ends_on','')::date,coalesce((p_data->>'active')::boolean,true),clock_timestamp(),p_actor)
  on conflict(id) do update set starts_on=excluded.starts_on,ends_on=excluded.ends_on,active=excluded.active,updated_at=excluded.updated_at,updated_by=p_actor
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
   and l.starts_on<=(a->>'date')::date and (l.ends_on is null or l.ends_on>=(a->>'date')::date))) then raise exception 'Selecione uma entidade vinculada ao médico na data do atendimento'; end if;
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
  if jsonb_typeof(p_data->'record_ids') is distinct from 'array' or jsonb_array_length(p_data->'record_ids')=0 then raise exception 'Vincule pelo menos um atendimento'; end if;
  select coalesce(jsonb_agg(billing_record_id),'[]') into old_items from public.invoice_billing_records where invoice_billing_records.invoice_id=sid;
  for item in select value::uuid from jsonb_array_elements_text(p_data->'record_ids') loop
   select * into record from public.billing_records where id=item;
   if not found or record.billing_entity_id<>entity or record.billing_method<>'CONVENIO' then raise exception 'Atendimento incompatível com a entidade ou cobrança'; end if;
   if exists(select 1 from public.invoice_billing_records where billing_record_id=item and invoice_billing_records.invoice_id<>sid) then raise exception 'Atendimento já vinculado a outra NF'; end if;
   select x into a from jsonb_array_elements(coalesce(state->'appointments','[]')) x where x->>'id'=record.appointment_id;
   if a is null then raise exception 'Atendimento cancelado ou inexistente'; end if;
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
