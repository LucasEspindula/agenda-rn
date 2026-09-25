-- Incremental fiscal workflow. No historical payment or legacy NF is rewritten.
create function public.valid_cpf(v text) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare s text:=regexp_replace(coalesce(v,''),'[^0-9]','','g');n int;k int;t int;
begin
 if length(s)<>11 or s=repeat(substr(s,1,1),11) then return false;end if;
 for n in 10..11 loop t:=0;for k in 1..n-1 loop t:=t+substr(s,k,1)::int*(n+1-k);end loop;t:=(t*10)%11;if t=10 then t:=0;end if;if t<>substr(s,n,1)::int then return false;end if;end loop;return true;
end;$$;
alter table public.invoices add column recipient_type text not null default 'CONVENIO' check(recipient_type in ('PARTICULAR','CONVENIO')),
 add column recipient_kind text,add column recipient_name text,add column recipient_tax_id text,add column recipient_address text,add column patient_id text,add column patient_name_snapshot text;
alter table public.invoices add constraint private_invoice_identity check(recipient_type<>'PARTICULAR' or (recipient_kind is not null and recipient_kind in ('PATIENT','OTHER') and recipient_name is not null and length(trim(recipient_name))>0 and recipient_tax_id is not null and recipient_tax_id ~ '^[0-9]{11}$' and public.valid_cpf(recipient_tax_id) and patient_id is not null));
create table public.invoice_requests(
 id uuid primary key default gen_random_uuid(),attendance_id text not null references public.attendances(id),billing_record_id uuid not null references public.billing_records(id),billing_entity_id uuid not null references public.billing_entities(id),
 status text not null default 'PENDING' check(status in ('PENDING','ISSUED','CANCELLED')),
 taker_kind text not null check(taker_kind in ('PATIENT','OTHER')),taker_name text not null check(length(trim(taker_name)) between 1 and 200),taker_tax_id text not null check(taker_tax_id ~ '^[0-9]{11}$' and public.valid_cpf(taker_tax_id)),taker_address text,notes text,
 received_amount_snapshot numeric(12,2) not null check(received_amount_snapshot>=0),paid_at_snapshot date not null,
 patient_id text not null,patient_name_snapshot text not null,doctor_id text not null references public.doctors(id),doctor_name_snapshot text not null,attendance_date_snapshot date not null,procedure_snapshot text not null,entity_name_snapshot text not null,entity_tax_id_snapshot text,
 invoice_id uuid unique references public.invoices(id),created_at timestamptz not null default now(),created_by bigint not null references public.users(id),updated_at timestamptz not null default now(),updated_by bigint not null references public.users(id),check((status='ISSUED')=(invoice_id is not null))
);
create unique index invoice_requests_active_attendance on public.invoice_requests(attendance_id) where status in ('PENDING','ISSUED');
create unique index invoice_requests_active_record on public.invoice_requests(billing_record_id) where status in ('PENDING','ISSUED');
create index invoice_requests_queue on public.invoice_requests(status,created_at);
alter table public.invoice_requests enable row level security;
revoke all on public.invoice_requests from public,anon,authenticated;
grant select,insert,update on public.invoice_requests to service_role;
create trigger financial_stamp before insert or update on public.invoice_requests for each row execute function public.financial_stamp();
create trigger financial_log_change after insert or update or delete on public.invoice_requests for each row execute function public.financial_log_change();
comment on column public.billing_records.invoice_number is 'Deprecated historical compatibility. New documents use invoices. Legacy records require explicit review; fiscal identity is never inferred from current patient data.';
create function public.protect_invoice_request() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Preserve o histórico da solicitação fiscal';end if;
 if tg_op='UPDATE' and ((to_jsonb(new)-array['status','invoice_id','updated_at','updated_by']) is distinct from (to_jsonb(old)-array['status','invoice_id','updated_at','updated_by']) or old.status<>'PENDING' or new.status not in ('PENDING','ISSUED','CANCELLED')) then raise exception 'Snapshot fiscal imutável. Reverta o pagamento antes da emissão e confirme novamente para corrigir';end if;
 return new;
end;$$;
create trigger protect_invoice_request before update or delete on public.invoice_requests for each row execute function public.protect_invoice_request();

-- Helpers run inside save_billing's authorization, advisory locks and audit operation.
create function public.prepare_private_payment(p_old jsonb,p_data jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.invoice_requests%rowtype;
begin
 if nullif(trim(p_data->>'invoice_number'),'') is distinct from nullif(trim(p_old->>'invoice_number'),'') then raise exception 'Registre o número de NF no Faturamento, em Notas Fiscais';end if;
 if nullif(trim(p_old->>'invoice_number'),'') is not null then
  if (p_old->>'payment_status') is distinct from p_data->>'payment_status' or (p_old->>'received_amount')::numeric is distinct from (p_data->>'received_amount')::numeric or (p_old->>'paid_at')::date is distinct from (p_data->>'paid_at')::date or p_old->>'billing_entity_id' is distinct from p_data->>'billing_entity_id' then raise exception 'NF legada emitida. Solicite correção fiscal/manual ao Faturamento';end if;return true;
 end if;
 select * into r from public.invoice_requests where billing_record_id=(p_old->>'id')::uuid and status in ('PENDING','ISSUED');
 if r.id is null then return false;end if;
 if p_data ? 'fiscal' and p_data->'fiscal'<>'null'::jsonb and (p_data->'fiscal'->>'taker_kind' is distinct from r.taker_kind or trim(p_data->'fiscal'->>'taker_name') is distinct from r.taker_name or regexp_replace(p_data->'fiscal'->>'taker_tax_id','[^0-9]','','g') is distinct from r.taker_tax_id or nullif(trim(p_data->'fiscal'->>'taker_address'),'') is distinct from r.taker_address or nullif(trim(p_data->'fiscal'->>'notes'),'') is distinct from r.notes) then raise exception 'Snapshot fiscal já confirmado. Reverta o pagamento antes da emissão para corrigir';end if;
 if p_data->>'billing_method'='PARTICULAR' and p_data->>'payment_status'='PAGO' and (p_data->>'received_amount')::numeric=r.received_amount_snapshot and (p_data->>'paid_at')::date=r.paid_at_snapshot and p_data->>'billing_entity_id'=r.billing_entity_id::text and nullif(trim(p_data->>'notes'),'') is not distinct from nullif(trim(p_old->>'notes'),'') then return true;end if;
 if r.status='ISSUED' then raise exception 'NF já emitida. Solicite correção fiscal/manual ao Faturamento antes de alterar o pagamento';end if;
 if p_data->>'payment_status' is distinct from 'PENDENTE' or p_data->>'billing_method' is distinct from 'PARTICULAR' then raise exception 'Solicitação fiscal existente. Reverta para Pendente antes de corrigir e confirmar os dados';end if;return false;
end;$$;
create function public.finish_private_payment(p_actor bigint,p_id uuid,p_data jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare b public.billing_records%rowtype;a public.attendances%rowtype;f jsonb:=p_data->'fiscal';patient jsonb;cpf text;
begin
 select * into b from public.billing_records where id=p_id;
 if b.payment_status='PENDENTE' then update public.invoice_requests set status='CANCELLED' where billing_record_id=p_id and status='PENDING';return;end if;
 if b.billing_method<>'PARTICULAR' then return;end if;
 if nullif(trim(b.invoice_number),'') is not null then raise exception 'NF particular legada: preserve o documento e solicite regularização fiscal à gerência';end if;
 if f is null or coalesce(f->>'taker_kind','') not in ('PATIENT','OTHER') or nullif(trim(f->>'taker_name'),'') is null or not public.valid_cpf(f->>'taker_tax_id') then raise exception 'Confirme o pagamento e solicite NF com nome e CPF válido do tomador';end if;
 cpf:=regexp_replace(f->>'taker_tax_id','[^0-9]','','g');select * into a from public.attendances where id=b.attendance_id;
 select p into patient from public.app_state s cross join lateral jsonb_array_elements(s.payload->'patients') p where s.id=1 and p->>'id'=a.patient_id;
 if patient is null or nullif(trim(patient->>'name'),'') is null then raise exception 'Paciente não encontrado para confirmação fiscal';end if;
 if f->>'taker_kind'='PATIENT' and nullif(patient->>'cpf','') is not null and regexp_replace(patient->>'cpf','[^0-9]','','g')<>cpf then raise exception 'CPF diferente do cadastro. Corrija o paciente ou selecione Outra pessoa';end if;
 if f->>'taker_kind'='PATIENT' then
  update public.app_state set payload=jsonb_set(payload,'{patients}',(select jsonb_agg(case when p->>'id'=a.patient_id then p||jsonb_build_object('cpf',cpf)||case when nullif(trim(f->>'taker_address'),'') is not null then jsonb_build_object('address',trim(f->>'taker_address')) else '{}'::jsonb end else p end order by n) from jsonb_array_elements(payload->'patients') with ordinality x(p,n))),updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond') where id=1;
 end if;
 insert into public.invoice_requests(attendance_id,billing_record_id,billing_entity_id,taker_kind,taker_name,taker_tax_id,taker_address,notes,received_amount_snapshot,paid_at_snapshot,patient_id,patient_name_snapshot,doctor_id,doctor_name_snapshot,attendance_date_snapshot,procedure_snapshot,entity_name_snapshot,entity_tax_id_snapshot)
 select a.id,b.id,b.billing_entity_id,f->>'taker_kind',trim(f->>'taker_name'),cpf,nullif(trim(f->>'taker_address'),''),nullif(trim(f->>'notes'),''),b.received_amount,b.paid_at,a.patient_id,patient->>'name',a.doctor_id,d.name,a.date,a.procedure,e.name,e.tax_id from public.billing_entities e cross join public.doctors d where e.id=b.billing_entity_id and d.id=a.doctor_id;
end;$$;
create function public.save_private_invoice(p_actor bigint,p_data jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.invoice_requests%rowtype;i public.invoices%rowtype;sid uuid;ids jsonb:=coalesce(p_data->'attendance_ids',p_data->'appointment_ids');
begin
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then raise exception 'Somente a gerência pode registrar NF';end if;
 select * into r from public.invoice_requests where id=nullif(p_data->>'request_id','')::uuid or (invoice_id=nullif(p_data->>'id','')::uuid and status='ISSUED') for update;
 if r.id is null or r.status='CANCELLED' then raise exception 'Selecione uma solicitação fiscal pendente';end if;
 if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)<>1 or ids->>0 is distinct from r.attendance_id then raise exception 'NF Particular exige exatamente um atendimento, fixado pela solicitação';end if;
 if p_data->>'billing_entity_id' is distinct from r.billing_entity_id::text then raise exception 'Empresa diferente da solicitação fiscal';end if;
 if nullif(trim(p_data->>'invoice_number'),'') is null or nullif(p_data->>'issue_date','') is null then raise exception 'Informe número da NF e data de emissão';end if;
 if r.status='ISSUED' then
  select * into i from public.invoices where id=r.invoice_id;
  if nullif(p_data->>'id','') is null then
   if i.invoice_number=trim(p_data->>'invoice_number') and i.issue_date=(p_data->>'issue_date')::date and i.total_amount is not distinct from nullif(p_data->>'total_amount','')::numeric and i.net_amount is not distinct from nullif(p_data->>'net_amount','')::numeric then return i.id;end if;raise exception 'Solicitação já emitida. Atualize a lista';end if;
  if i.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'NF alterada. Atualize a página';end if;
  update public.invoices set invoice_number=trim(p_data->>'invoice_number'),issue_date=(p_data->>'issue_date')::date,total_amount=nullif(p_data->>'total_amount','')::numeric,net_amount=nullif(p_data->>'net_amount','')::numeric,notes=nullif(trim(p_data->>'notes'),'') where id=i.id;return i.id;
 end if;
 if not exists(select 1 from public.billing_records where id=r.billing_record_id and billing_method='PARTICULAR' and payment_status='PAGO' and received_amount=r.received_amount_snapshot and paid_at=r.paid_at_snapshot and billing_entity_id=r.billing_entity_id) then raise exception 'Pagamento incompatível com a solicitação';end if;
 insert into public.invoices(billing_entity_id,invoice_number,issue_date,total_amount,net_amount,paid_at,payer,notes,recipient_type,recipient_kind,recipient_name,recipient_tax_id,recipient_address,patient_id,patient_name_snapshot)
 values(r.billing_entity_id,trim(p_data->>'invoice_number'),(p_data->>'issue_date')::date,nullif(p_data->>'total_amount','')::numeric,nullif(p_data->>'net_amount','')::numeric,r.paid_at_snapshot,r.taker_name,nullif(trim(p_data->>'notes'),''),'PARTICULAR',r.taker_kind,r.taker_name,r.taker_tax_id,r.taker_address,r.patient_id,r.patient_name_snapshot) returning id into sid;
 insert into public.invoice_billing_records(invoice_id,billing_record_id) values(sid,r.billing_record_id);
 update public.invoice_requests set status='ISSUED',invoice_id=sid where id=r.id;return sid;
end;$$;
create function public.check_fiscal_integrity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.invoices i where i.recipient_type='PARTICULAR' and ((select count(*) from public.invoice_billing_records x where x.invoice_id=i.id)<>1 or not exists(select 1 from public.invoice_requests r join public.billing_records b on b.id=r.billing_record_id join public.invoice_billing_records x on x.billing_record_id=b.id and x.invoice_id=i.id where r.invoice_id=i.id and r.status='ISSUED' and b.billing_method='PARTICULAR' and i.billing_entity_id=r.billing_entity_id and i.recipient_tax_id=r.taker_tax_id and i.recipient_name=r.taker_name and i.recipient_address is not distinct from r.taker_address and i.patient_id=r.patient_id and i.recipient_kind=r.taker_kind))) then raise exception 'NF Particular exige exatamente um atendimento e sua solicitação emitida';end if;
 if exists(select 1 from public.invoice_requests r join public.billing_records b on b.id=r.billing_record_id where r.status in ('PENDING','ISSUED') and (b.attendance_id<>r.attendance_id or b.billing_method<>'PARTICULAR' or b.payment_status<>'PAGO' or b.received_amount is distinct from r.received_amount_snapshot or b.paid_at is distinct from r.paid_at_snapshot or b.billing_entity_id<>r.billing_entity_id)) then raise exception 'Pagamento e solicitação fiscal incompatíveis';end if;
 if exists(select 1 from public.invoice_billing_records x join public.invoices i on i.id=x.invoice_id join public.billing_records b on b.id=x.billing_record_id where i.recipient_type<>b.billing_method) then raise exception 'Tipo de tomador incompatível com atendimento';end if;return null;
end;$$;
create constraint trigger fiscal_invoice_integrity after insert or update or delete on public.invoices deferrable initially deferred for each row execute function public.check_fiscal_integrity();
create constraint trigger fiscal_item_integrity after insert or update or delete on public.invoice_billing_records deferrable initially deferred for each row execute function public.check_fiscal_integrity();
create constraint trigger fiscal_request_integrity after insert or update or delete on public.invoice_requests deferrable initially deferred for each row execute function public.check_fiscal_integrity();
create constraint trigger fiscal_payment_integrity after insert or update or delete on public.billing_records deferrable initially deferred for each row execute function public.check_fiscal_integrity();

create or replace function public.save_billing(p_actor bigint,p_kind text,p_data jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare role_name text; sid uuid; old_row jsonb; result_row jsonb; state jsonb; a jsonb;
 entity uuid; item uuid; record public.billing_records%rowtype; old_items jsonb; appointment_ids jsonb; selected_records uuid[]:='{}'; appt_id text; payer_name text; before_records jsonb; old_record jsonb; before_item_values jsonb; amount_entry record; mode text; physician public.doctors%rowtype;
begin
 perform pg_advisory_xact_lock(194701,1);
 perform pg_advisory_xact_lock(194701,2);
 select role into role_name from public.users where id=p_actor;
 if role_name is null or role_name not in ('general_manager','secretary') then raise exception 'Acesso negado'; end if;
 if p_kind='record' then p_data:=p_data||jsonb_build_object('appointment_id',coalesce(p_data->>'attendance_id',p_data->>'appointment_id'));end if;
 if p_kind='invoice' and p_data ? 'attendance_ids' then p_data:=p_data||jsonb_build_object('appointment_ids',p_data->'attendance_ids');end if;
 select payload into state from public.app_state where id=1;
 sid:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
 perform public.financial_operation(p_actor,p_kind,sid::text);
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
  if not exists(select 1 from public.attendances where id=p_data->>'appointment_id')
     and p_data->>'billing_method'='PARTICULAR' then
   select clinical into a from jsonb_array_elements(coalesce(state->'appointments','[]')) clinical
    where clinical->>'id'=p_data->>'appointment_id';
   if a is null or a->>'forma_cobranca' is distinct from 'PARTICULAR' then
    raise exception 'Use a forma de cobrança informada no agendamento';
   end if;
   if role_name<>'general_manager' and not exists(select 1 from public.agenda_access g
      where g.user_id=p_actor and g.professional_id in(a->>'doctorId',a->>'anesthetistId')) then
    raise exception 'Agenda sem permissão';
   end if;
   insert into public.attendances(id,appointment_id,origin,patient_id,doctor_id,date,procedure,insurance,billing_method,status)
    values(a->>'id',a->>'id','AGENDA',nullif(a->>'patientId',''),a->>'doctorId',(a->>'date')::date,
     coalesce(a->>'procedure','Procedimento'),coalesce(a->>'insurance',(select p->>'insurance'
       from jsonb_array_elements(coalesce(state->'patients','[]')) p where p->>'id'=a->>'patientId'),''),
     'PARTICULAR',a->>'status');
  end if;
  a:=public.financial_attendance(p_data->>'appointment_id');
  if a is null then raise exception 'Atendimento inexistente'; end if;
  if role_name<>'general_manager' and not exists(select 1 from public.app_state s cross join lateral jsonb_array_elements(coalesce(s.payload->'appointments','[]')) clinical join public.agenda_access g on g.user_id=p_actor and g.professional_id in(clinical->>'doctorId',clinical->>'anesthetistId') where s.id=1 and clinical->>'id'=a->>'appointment_id') then raise exception 'Agenda sem permissão'; end if;
  select to_jsonb(b) into old_row from public.billing_records b where attendance_id=p_data->>'appointment_id';
  if old_row is not null then sid:=(old_row->>'id')::uuid; else sid:=gen_random_uuid(); end if;
  perform set_config('rn.record',sid::text,true);
  if public.prepare_private_payment(old_row,p_data) then perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);return sid;end if;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Financeiro alterado por outro usuário. Atualize'; end if;
  if exists(select 1 from public.invoice_billing_records where billing_record_id=sid) then raise exception 'Edite o pagamento e os dados fiscais na NF/lote vinculada'; end if;
  entity:=(p_data->>'billing_entity_id')::uuid;
  a:=public.attribute_financial_attendance(p_data->>'appointment_id',entity);
  if entity is null or (old_row->>'billing_entity_id' is distinct from entity::text and not exists(
   select 1 from public.billing_doctor_entities l join public.billing_entities e on e.id=l.billing_entity_id
   where l.billing_entity_id=entity and l.doctor_id in (a->>'doctorId',a->>'anesthetistId') and l.active and e.active
)) then raise exception 'Selecione uma entidade vinculada ao médico'; end if;
  if p_data->>'billing_method' not in ('PARTICULAR','CONVENIO') or p_data->>'payment_status' not in ('PENDENTE','PAGO') then raise exception 'Forma de cobrança ou status inválido'; end if;
  select * into physician from public.doctors where id=a->>'doctorId';
  if not physician.billing_enabled then raise exception 'Controle financeiro não habilitado para o médico';end if;
  mode:=case when p_data->>'billing_method'='PARTICULAR' or old_row->>'settlement_mode'='DIRECT' or not physician.invoice_enabled then 'DIRECT' else 'INVOICE' end;
  if mode='INVOICE' and p_data->>'payment_status'='PAGO' then raise exception 'Registre o pagamento do convênio na NF/lote'; end if;
  if p_data->>'payment_status'='PAGO' and (nullif(p_data->>'paid_at','') is null or nullif(p_data->>'received_amount','') is null) then raise exception 'Pagamento particular exige valor e data'; end if;
  if public.appointment_billing_method(a) is not null and public.appointment_billing_method(a) is distinct from p_data->>'billing_method' then raise exception 'Use a forma de cobrança informada no agendamento'; end if;
  insert into public.billing_records(id,attendance_id,appointment_id,settlement_mode,billing_entity_id,billing_method,payment_status,invoice_number,received_amount,paid_at,notes,updated_at,updated_by)
  values(sid,p_data->>'appointment_id',a->>'appointment_id',mode,entity,p_data->>'billing_method',p_data->>'payment_status',case when p_data->>'billing_method'='PARTICULAR' then nullif(trim(p_data->>'invoice_number'),'') end,
   case when mode='DIRECT' then nullif(p_data->>'received_amount','')::numeric end,
   case when mode='DIRECT' then nullif(p_data->>'paid_at','')::date end,nullif(trim(p_data->>'notes'),''),clock_timestamp(),p_actor)
  on conflict(id) do update set settlement_mode=excluded.settlement_mode,billing_entity_id=excluded.billing_entity_id,billing_method=excluded.billing_method,payment_status=excluded.payment_status,invoice_number=excluded.invoice_number,received_amount=excluded.received_amount,paid_at=excluded.paid_at,notes=excluded.notes,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(billing_records.*) into result_row;
  update public.attendances set billing_entity_id=entity,billing_method=p_data->>'billing_method' where id=p_data->>'appointment_id';
  -- Preserve compatibility with the explicit scheduling choice.
  update public.app_state st set payload=jsonb_set(st.payload,'{appointments}',coalesce((select jsonb_agg(case when x->>'id'=a->>'appointment_id' then x||jsonb_build_object('forma_cobranca',p_data->>'billing_method') else x end order by n) from jsonb_array_elements(st.payload->'appointments') with ordinality arr(x,n)),'[]')),updated_at=greatest(clock_timestamp(),st.updated_at+interval '1 millisecond') where st.id=1;
  perform public.finish_private_payment(p_actor,sid,p_data);
 elsif p_kind='invoice' then
  if coalesce(p_data->>'recipient_type','CONVENIO')='PARTICULAR' then
   sid:=public.save_private_invoice(p_actor,p_data);perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);return sid;
  end if;
  if exists(select 1 from public.invoices where id=sid and recipient_type='PARTICULAR') then raise exception 'Não altere o tipo de uma NF emitida';end if;
  if role_name<>'general_manager' then raise exception 'Somente a gerência pode gerenciar lotes'; end if;
  select to_jsonb(i) into old_row from public.invoices i where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'NF alterada por outro usuário. Atualize'; end if;
  entity:=(p_data->>'billing_entity_id')::uuid;
  if nullif(trim(p_data->>'payer'),'') is null or nullif(trim(p_data->>'invoice_number'),'') is null or nullif(p_data->>'issue_date','') is null then raise exception 'Preencha número, pagador e emissão'; end if;
  payer_name:=public.billing_payer_key(p_data->>'payer');
  if not exists(
   select 1 from (
    select insurance as name from public.attendances
    union all select value->>'insurance' as name from jsonb_array_elements(coalesce(state->'patients','[]'))
    union all select value->>'insurance' from jsonb_array_elements(coalesce(state->'appointments','[]'))
    union all select old_row->>'payer'
   ) payers where public.billing_payer_key(name)=payer_name and payer_name<>''
  ) then raise exception 'Selecione um pagador existente no sistema'; end if;
  if not exists(select 1 from public.billing_entities where id=entity and (active or old_row->>'billing_entity_id'=entity::text)) then raise exception 'Entidade inativa ou inexistente'; end if;
  if p_data ? 'appointment_ids' then
   appointment_ids:=p_data->'appointment_ids';
   if jsonb_typeof(appointment_ids) is distinct from 'array' then raise exception 'Lista de atendimentos inválida'; end if;
  else
   -- Compatibility for an already open older client. Every supplied ID must exist.
   if jsonb_typeof(p_data->'record_ids') is distinct from 'array' then raise exception 'Lista de atendimentos inválida'; end if;
   appointment_ids:='[]';
   for item in select value::uuid from jsonb_array_elements_text(p_data->'record_ids') loop
    select * into record from public.billing_records where id=item;
    if not found then raise exception 'Faturamento inexistente'; end if;
    appointment_ids:=appointment_ids||jsonb_build_array(record.attendance_id);
   end loop;
  end if;
  if jsonb_array_length(appointment_ids)=0 and nullif(p_data->>'paid_at','') is not null then raise exception 'Vincule pelo menos um atendimento antes de confirmar o pagamento'; end if;
  if p_data ? 'item_amounts' then
   if jsonb_typeof(p_data->'item_amounts') is distinct from 'object' then raise exception 'Valores individuais inválidos'; end if;
   for amount_entry in select * from jsonb_each(p_data->'item_amounts') loop
    if not (appointment_ids ? amount_entry.key) or jsonb_typeof(amount_entry.value) not in ('number','null') then raise exception 'Valor individual inválido ou atendimento não selecionado'; end if;
    if jsonb_typeof(amount_entry.value)='number' and ((amount_entry.value::text)::numeric<0 or (amount_entry.value::text)::numeric>9999999999.99 or round((amount_entry.value::text)::numeric,2)<>(amount_entry.value::text)::numeric) then raise exception 'Valor individual deve ser positivo ou zero, com até duas casas decimais'; end if;
   end loop;
  end if;
  select coalesce(jsonb_agg(to_jsonb(ib)),'[]') into before_item_values from public.invoice_billing_records ib where ib.invoice_id=sid;
  select coalesce(jsonb_agg(billing_record_id),'[]') into old_items from public.invoice_billing_records where invoice_billing_records.invoice_id=sid;
  select coalesce(jsonb_agg(to_jsonb(b)),'[]') into before_records from public.billing_records b where b.id in(select billing_record_id from public.invoice_billing_records where invoice_billing_records.invoice_id=sid);
  for appt_id in select distinct value from jsonb_array_elements_text(appointment_ids) loop
   a:=public.attribute_financial_attendance(appt_id,entity);
   if a is null then raise exception 'Atendimento cancelado ou inexistente'; end if;
   select * into record from public.billing_records b where b.attendance_id=appt_id;
   if a->>'status' is distinct from 'realized' then raise exception 'Somente atendimentos realizados podem ser vinculados'; end if;
   if public.appointment_billing_method(a,record.billing_method) is distinct from 'CONVENIO' then raise exception 'Atendimento não é cobrado por convênio'; end if;
   if public.billing_payer_key(coalesce(a->>'insurance',''))<>payer_name then raise exception 'Convênio do atendimento diferente do pagador'; end if;
   if not exists(select 1 from public.invoice_billing_records ib where ib.invoice_id=sid and ib.billing_record_id=record.id and record.billing_entity_id=entity) and not exists(select 1 from public.billing_doctor_entities l join public.billing_entities be on be.id=l.billing_entity_id and be.active where l.billing_entity_id=entity and l.active and l.doctor_id in(a->>'doctorId',a->>'anesthetistId')) then raise exception 'Médico sem vínculo ativo com a entidade recebedora'; end if;
   if not exists(select 1 from public.invoice_billing_records where invoice_id=sid and billing_record_id=record.id) and not exists(select 1 from public.doctors where id=a->>'doctorId' and invoice_enabled) then raise exception 'Gestão de NF não habilitada para o médico';end if;
   if record.id is not null and record.settlement_mode='DIRECT' then raise exception 'Atendimento utiliza pagamento direto, sem gestão de NF';end if;
   if record.id is not null and exists(select 1 from public.invoice_billing_records ib where ib.billing_record_id=record.id and ib.invoice_id<>sid) then raise exception 'Atendimento já vinculado a outra NF'; end if;
   if record.id is not null and (record.billing_method<>'CONVENIO' or (record.payment_status='PAGO' and not exists(select 1 from public.invoice_billing_records ib where ib.billing_record_id=record.id and ib.invoice_id=sid))) then raise exception 'Faturamento individual já configurado ou pago. Revise antes de vincular'; end if;
   old_record:=case when record.id is not null then to_jsonb(record) end;
   if record.id is null then
    insert into public.billing_records(attendance_id,appointment_id,settlement_mode,billing_entity_id,billing_method,payment_status,received_amount,paid_at,invoice_number,updated_at,updated_by)
    values(appt_id,a->>'appointment_id','INVOICE',entity,'CONVENIO','PENDENTE',null,null,null,clock_timestamp(),p_actor) returning * into record;
   else
    update public.billing_records b set billing_entity_id=entity,received_amount=null,paid_at=null,invoice_number=null,updated_at=clock_timestamp(),updated_by=p_actor where b.id=record.id returning b.* into record;
   end if;
   update public.attendances set billing_entity_id=entity where id=appt_id;
   selected_records:=array_append(selected_records,record.id);
   insert into public.billing_audit(actor_id,action,record_id,before_data,after_data) values(p_actor,'invoice_record_prepared',record.id,old_record,to_jsonb(record));
  end loop;
  insert into public.invoices(id,billing_entity_id,invoice_number,payer,issue_date,total_amount,net_amount,paid_at,notes,updated_at,updated_by)
  values(sid,entity,trim(p_data->>'invoice_number'),payer_name,(p_data->>'issue_date')::date,nullif(p_data->>'total_amount','')::numeric,nullif(p_data->>'net_amount','')::numeric,nullif(p_data->>'paid_at','')::date,nullif(trim(p_data->>'notes'),''),clock_timestamp(),p_actor)
  on conflict(id) do update set billing_entity_id=excluded.billing_entity_id,invoice_number=excluded.invoice_number,payer=excluded.payer,issue_date=excluded.issue_date,total_amount=excluded.total_amount,net_amount=excluded.net_amount,paid_at=excluded.paid_at,notes=excluded.notes,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(invoices.*) into result_row;
  update public.billing_records set payment_status='PENDENTE',updated_at=clock_timestamp(),updated_by=p_actor where id in(select billing_record_id from public.invoice_billing_records where invoice_billing_records.invoice_id=sid);
  delete from public.invoice_billing_records where invoice_billing_records.invoice_id=sid and not(billing_record_id=any(selected_records));
  insert into public.invoice_billing_records(invoice_id,billing_record_id) select sid,unnest(selected_records) on conflict(invoice_id,billing_record_id) do nothing;
  update public.billing_records set payment_status=case when nullif(p_data->>'paid_at','') is null then 'PENDENTE' else 'PAGO' end,received_amount=null,paid_at=null,invoice_number=null,updated_at=clock_timestamp(),updated_by=p_actor where id=any(selected_records);
  update public.invoice_billing_records ib set received_amount=(p_data->'item_amounts'->>b.attendance_id)::numeric from public.billing_records b where b.id=ib.billing_record_id and ib.invoice_id=sid and (p_data->'item_amounts') ? b.attendance_id;
  old_row:=coalesce(old_row,'{}')||jsonb_build_object('record_ids',old_items,'records',before_records,'items',before_item_values);
  result_row:=result_row||jsonb_build_object('record_ids',to_jsonb(selected_records),'appointment_ids',appointment_ids,'items',(select coalesce(jsonb_agg(to_jsonb(ib)),'[]') from public.invoice_billing_records ib where ib.invoice_id=sid));
 else raise exception 'Operação inválida'; end if;
 insert into public.billing_audit(actor_id,action,record_id,before_data,after_data) values(p_actor,p_kind,sid,old_row,result_row);
 perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);
 return sid;
end;$$;
revoke all on function public.save_billing(bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_billing(bigint,text,jsonb) to service_role;


create or replace function public.guard_invoice_appointments() returns trigger language plpgsql security invoker set search_path='' as $$
declare a jsonb; entry record; method text; payer text; previous jsonb;
begin
 for a in select value from jsonb_array_elements(coalesce(new.payload->'appointments','[]')) loop
  method:=public.appointment_billing_method(a);
  if method is not null and method not in ('PARTICULAR','CONVENIO') then raise exception 'Forma de cobrança inválida'; end if;
 end loop;
 for entry in select b.appointment_id,i.payer,b.billing_method,b.billing_entity_id from public.billing_records b join public.invoice_billing_records ib on ib.billing_record_id=b.id join public.invoices i on i.id=ib.invoice_id where b.appointment_id is not null and i.recipient_type='CONVENIO' loop
  select value into a from jsonb_array_elements(coalesce(new.payload->'appointments','[]')) where value->>'id'=entry.appointment_id;
  select value into previous from jsonb_array_elements(coalesce(old.payload->'appointments','[]')) where value->>'id'=entry.appointment_id;
  payer:=coalesce(a->>'insurance','');
  if a is null or a->>'status' is distinct from 'realized' or public.appointment_billing_method(a,entry.billing_method) is distinct from 'CONVENIO' or (public.billing_payer_key(payer)<>public.billing_payer_key(entry.payer) and (a->>'insurance' is distinct from previous->>'insurance' or nullif(trim(previous->>'insurance'),'') is not null))
   or a->>'doctorId' is distinct from previous->>'doctorId' or a->>'anesthetistId' is distinct from previous->>'anesthetistId' or a->>'patientId' is distinct from previous->>'patientId' then
   raise exception 'Atendimento vinculado a uma NF. Remova o vínculo na NF antes de alterar cobrança, convênio, médico, paciente ou realização';
  end if;
 end loop;
 for entry in select b.appointment_id,r.patient_id from public.invoice_requests r join public.billing_records b on b.id=r.billing_record_id where r.status in ('PENDING','ISSUED') and b.appointment_id is not null loop
  select value into a from jsonb_array_elements(coalesce(new.payload->'appointments','[]')||coalesce(new.payload->'cancelledAppointments','[]')) where value->>'id'=entry.appointment_id;
  if a is null or a->>'patientId' is distinct from entry.patient_id or a->>'forma_cobranca' is distinct from 'PARTICULAR' then raise exception 'Atendimento com solicitação fiscal: preserve paciente e cobrança';end if;
 end loop;
 return new;
end;$$;
revoke all on function public.guard_invoice_appointments() from public,anon,authenticated;


revoke all on function public.valid_cpf(text) from public,anon,authenticated;
grant execute on function public.valid_cpf(text) to service_role;
revoke all on function public.protect_invoice_request() from public,anon,authenticated;
grant execute on function public.protect_invoice_request() to service_role;
revoke all on function public.prepare_private_payment(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_private_payment(jsonb,jsonb) to service_role;
revoke all on function public.finish_private_payment(bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_private_payment(bigint,uuid,jsonb) to service_role;
revoke all on function public.save_private_invoice(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_private_invoice(bigint,jsonb) to service_role;
revoke all on function public.check_fiscal_integrity() from public,anon,authenticated;
grant execute on function public.check_fiscal_integrity() to service_role;
