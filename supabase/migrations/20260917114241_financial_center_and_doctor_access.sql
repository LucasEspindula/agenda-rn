-- Additive financial-center revision. Apply after invoice_direct_appointment_linking.
alter table public.invoice_billing_records add column if not exists received_amount numeric(12,2) check(received_amount>=0 and received_amount<='9999999999.99'::numeric);
comment on column public.invoice_billing_records.received_amount is 'Optional actual individual receipt from payer statement. Never allocated from invoice totals.';
create or replace function public.save_billing(p_actor bigint,p_kind text,p_data jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare role_name text; sid uuid; old_row jsonb; result_row jsonb; state jsonb; a jsonb;
 entity uuid; item uuid; record public.billing_records%rowtype; old_items jsonb; appointment_ids jsonb; selected_records uuid[]:='{}'; appt_id text; payer_name text; before_records jsonb; old_record jsonb; before_item_values jsonb; amount_entry record;
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
  if public.appointment_billing_method(a) is not null and public.appointment_billing_method(a) is distinct from p_data->>'billing_method' then raise exception 'Use a forma de cobrança informada no agendamento'; end if;
  insert into public.billing_records(id,appointment_id,billing_entity_id,billing_method,payment_status,invoice_number,received_amount,paid_at,notes,updated_at,updated_by)
  values(sid,p_data->>'appointment_id',entity,p_data->>'billing_method',p_data->>'payment_status',case when p_data->>'billing_method'='PARTICULAR' then nullif(trim(p_data->>'invoice_number'),'') end,
   case when p_data->>'billing_method'='PARTICULAR' then nullif(p_data->>'received_amount','')::numeric end,
   case when p_data->>'billing_method'='PARTICULAR' then nullif(p_data->>'paid_at','')::date end,nullif(trim(p_data->>'notes'),''),clock_timestamp(),p_actor)
  on conflict(id) do update set billing_entity_id=excluded.billing_entity_id,billing_method=excluded.billing_method,payment_status=excluded.payment_status,invoice_number=excluded.invoice_number,received_amount=excluded.received_amount,paid_at=excluded.paid_at,notes=excluded.notes,updated_at=excluded.updated_at,updated_by=p_actor
  returning to_jsonb(billing_records.*) into result_row;
  -- A financial edit also updates the explicit scheduling choice atomically.
  update public.app_state st set payload=jsonb_set(st.payload,'{appointments}',coalesce((select jsonb_agg(case when x->>'id'=p_data->>'appointment_id' then x||jsonb_build_object('forma_cobranca',p_data->>'billing_method') else x end order by n) from jsonb_array_elements(st.payload->'appointments') with ordinality arr(x,n)),'[]')),updated_at=greatest(clock_timestamp(),st.updated_at+interval '1 millisecond') where st.id=1;
 elsif p_kind='invoice' then
  if role_name<>'general_manager' then raise exception 'Somente a gerência pode gerenciar lotes'; end if;
  select to_jsonb(i) into old_row from public.invoices i where id=sid;
  if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'NF alterada por outro usuário. Atualize'; end if;
  entity:=(p_data->>'billing_entity_id')::uuid;
  if nullif(trim(p_data->>'payer'),'') is null or nullif(trim(p_data->>'invoice_number'),'') is null or nullif(p_data->>'issue_date','') is null then raise exception 'Preencha número, pagador e emissão'; end if;
  payer_name:=public.billing_payer_key(p_data->>'payer');
  if not exists(
   select 1 from (
    select value->>'insurance' as name from jsonb_array_elements(coalesce(state->'patients','[]'))
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
    appointment_ids:=appointment_ids||jsonb_build_array(record.appointment_id);
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
   select x into a from jsonb_array_elements(coalesce(state->'appointments','[]')) x where x->>'id'=appt_id;
   if a is null then raise exception 'Atendimento cancelado ou inexistente'; end if;
   select * into record from public.billing_records b where b.appointment_id=appt_id;
   if a->>'status' is distinct from 'realized' then raise exception 'Somente atendimentos realizados podem ser vinculados'; end if;
   if public.appointment_billing_method(a,record.billing_method) is distinct from 'CONVENIO' then raise exception 'Atendimento não é cobrado por convênio'; end if;
   if public.billing_payer_key(coalesce(nullif(trim(a->>'insurance'),''),(select x->>'insurance' from jsonb_array_elements(coalesce(state->'patients','[]')) x where x->>'id'=a->>'patientId'),''))<>payer_name then raise exception 'Convênio do atendimento diferente do pagador'; end if;
   if not exists(select 1 from public.invoice_billing_records ib where ib.invoice_id=sid and ib.billing_record_id=record.id and record.billing_entity_id=entity) and not exists(select 1 from public.billing_doctor_entities l join public.billing_entities be on be.id=l.billing_entity_id and be.active where l.billing_entity_id=entity and l.active and l.doctor_id in(a->>'doctorId',a->>'anesthetistId')) then raise exception 'Médico sem vínculo ativo com a entidade recebedora'; end if;
   if record.id is not null and exists(select 1 from public.invoice_billing_records ib where ib.billing_record_id=record.id and ib.invoice_id<>sid) then raise exception 'Atendimento já vinculado a outra NF'; end if;
   if record.id is not null and (record.billing_method<>'CONVENIO' or (record.payment_status='PAGO' and not exists(select 1 from public.invoice_billing_records ib where ib.billing_record_id=record.id and ib.invoice_id=sid))) then raise exception 'Faturamento individual já configurado ou pago. Revise antes de vincular'; end if;
   old_record:=case when record.id is not null then to_jsonb(record) end;
   if record.id is null then
    insert into public.billing_records(appointment_id,billing_entity_id,billing_method,payment_status,received_amount,paid_at,invoice_number,updated_at,updated_by)
    values(appt_id,entity,'CONVENIO','PENDENTE',null,null,null,clock_timestamp(),p_actor) returning * into record;
   else
    update public.billing_records b set billing_entity_id=entity,received_amount=null,paid_at=null,invoice_number=null,updated_at=clock_timestamp(),updated_by=p_actor where b.id=record.id returning b.* into record;
   end if;
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
  update public.invoice_billing_records ib set received_amount=(p_data->'item_amounts'->>b.appointment_id)::numeric from public.billing_records b where b.id=ib.billing_record_id and ib.invoice_id=sid and (p_data->'item_amounts') ? b.appointment_id;
  old_row:=coalesce(old_row,'{}')||jsonb_build_object('record_ids',old_items,'records',before_records,'items',before_item_values);
  result_row:=result_row||jsonb_build_object('record_ids',to_jsonb(selected_records),'appointment_ids',appointment_ids,'items',(select coalesce(jsonb_agg(to_jsonb(ib)),'[]') from public.invoice_billing_records ib where ib.invoice_id=sid));
 else raise exception 'Operação inválida'; end if;
 insert into public.billing_audit(actor_id,action,record_id,before_data,after_data) values(p_actor,p_kind,sid,old_row,result_row);
 return sid;
end;$$;
revoke all on function public.save_billing(bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_billing(bigint,text,jsonb) to service_role;
-- Professional identity is independent of authentication and agenda permissions.
alter table public.users add column if not exists doctor_id text references public.doctors(id);
create unique index if not exists users_doctor_identity_unique on public.users(doctor_id) where doctor_id is not null;
with matches as (
 select u.id,d.id doctor_id,count(*) over(partition by u.id) user_matches,count(*) over(partition by d.id) doctor_matches
 from public.users u join public.doctors d on lower(trim(regexp_replace(u.name,'^Dr[.]?[[:space:]]+','','i')))=lower(trim(regexp_replace(d.name,'^Dr[.]?[[:space:]]+','','i')))
 where u.role='doctor' and u.doctor_id is null and exists(select 1 from public.agenda_access a where a.user_id=u.id and a.professional_id=d.id)
)
update public.users u set doctor_id=m.doctor_id from matches m where u.id=m.id and m.user_matches=1 and m.doctor_matches=1 and not exists(select 1 from public.users x where x.doctor_id=m.doctor_id);
-- Unresolved legacy identities can remain until edited; new/changed accounts must be linked.
create or replace function public.validate_user_doctor_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if new.role<>'doctor' and new.doctor_id is not null then raise exception 'Somente usuário médico pode ter identidade profissional'; end if;
 if new.role='doctor' and new.doctor_id is null then
  if tg_op='INSERT' then raise exception 'Selecione o médico deste acesso'; end if;
  if old.role is distinct from new.role or old.doctor_id is distinct from new.doctor_id then raise exception 'Selecione o médico deste acesso'; end if;
 end if;
 return new;
end;$$;
drop trigger if exists user_doctor_identity on public.users;
create trigger user_doctor_identity before insert or update on public.users for each row execute function public.validate_user_doctor_identity();

create or replace function public.save_user_access(p_actor bigint,p_data jsonb,p_credentials jsonb default null) returns bigint language plpgsql security invoker set search_path='' as $$
declare uid bigint:=nullif(p_data->>'id','')::bigint; old_account public.users%rowtype; did text:=nullif(p_data->>'doctor_id',''); email_value text:=lower(trim(p_data->>'email')); role_value text:=p_data->>'role'; grant_id text;
begin
 perform pg_advisory_xact_lock(194701,1);
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then raise exception 'Acesso restrito à gerência'; end if;
 if role_value not in ('general_manager','secretary','doctor') or role_value is null or email_value is null or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(email_value)>254 then raise exception 'Dados de acesso inválidos'; end if;
 if role_value='doctor' and (did is null or not exists(select 1 from public.doctors where id=did)) then raise exception 'Selecione um médico existente'; end if;
 if role_value<>'doctor' then did:=null; end if;
 if uid=p_actor and role_value<>'general_manager' then raise exception 'Outro gerente deve alterar seu nível de acesso'; end if;
 if uid is not null then
  select * into old_account from public.users where id=uid for update;
  if not found then raise exception 'Usuário inexistente'; end if;
  if p_data ? 'updated_at' and old_account.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Acesso alterado por outro usuário. Atualize'; end if;
 end if;
 if exists(select 1 from public.users where lower(email)=email_value and id is distinct from uid) then raise exception 'Já existe uma conta com este e-mail'; end if;
 if did is not null and exists(select 1 from public.users where doctor_id=did and id is distinct from uid) then raise exception 'Este médico já possui um acesso'; end if;
 if uid is null and p_credentials is null then raise exception 'Informe uma senha inicial'; end if;
 if p_credentials is not null and (coalesce(p_credentials->>'hash','') !~ '^pbkdf2-sha256\$600000\$[A-Za-z0-9+/=]+$' or length(coalesce(p_credentials->>'salt',''))<20) then raise exception 'Credencial inválida'; end if;
 if p_data ? 'agendaIds' then
  if jsonb_typeof(p_data->'agendaIds') is distinct from 'array' then raise exception 'Agendas inválidas'; end if;
  for grant_id in select jsonb_array_elements_text(p_data->'agendaIds') loop
   if not exists(select 1 from public.doctors where id=grant_id) then raise exception 'Agenda inexistente'; end if;
  end loop;
 end if;
 if uid is null then
  insert into public.users(email,name,role,doctor_id,password_hash,password_salt) values(email_value,coalesce(p_data->>'name',''),role_value,did,p_credentials->>'hash',p_credentials->>'salt') returning id into uid;
 else
  update public.users set email=email_value,name=coalesce(p_data->>'name',''),role=role_value,doctor_id=did,password_hash=coalesce(p_credentials->>'hash',password_hash),password_salt=coalesce(p_credentials->>'salt',password_salt),updated_at=clock_timestamp() where id=uid;
 end if;
 delete from public.sessions where user_id=uid;
 if p_data ? 'agendaIds' or role_value='general_manager' then
  delete from public.agenda_access where user_id=uid;
  if role_value<>'general_manager' then
   insert into public.agenda_access(user_id,professional_id) select uid,value from (select distinct jsonb_array_elements_text(p_data->'agendaIds') value) x;
  end if;
 end if;
 if did is not null and not exists(select 1 from public.agenda_access where user_id=uid and professional_id=did) then insert into public.agenda_access(user_id,professional_id) values(uid,did); end if;
 insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data) values(p_actor,'user_access',uid::text,case when old_account.id is not null then jsonb_build_object('email',old_account.email,'role',old_account.role,'doctor_id',old_account.doctor_id) end,jsonb_build_object('email',email_value,'role',role_value,'doctor_id',did,'password_changed',p_credentials is not null,'agendaIds',(select coalesce(jsonb_agg(professional_id),'[]') from public.agenda_access where user_id=uid)));
 return uid;
end;$$;
create or replace function public.save_doctor_with_access(p_actor bigint,p_kind text,p_data jsonb,p_access jsonb default null,p_credentials jsonb default null) returns text language plpgsql security invoker set search_path='' as $$
declare did text; account_id bigint; access_data jsonb;
begin
 did:=public.save_doctor_directory(p_actor,p_kind,p_data);
 if p_access is not null then
  if p_kind<>'doctor' then raise exception 'Acesso pertence ao médico, não à agenda'; end if;
  select id into account_id from public.users where doctor_id=did;
  if (p_access->>'id')::bigint is distinct from account_id then raise exception 'Acesso alterado por outro usuário. Atualize'; end if;
  access_data:=p_access||jsonb_build_object('id',account_id,'doctor_id',did,'role','doctor','name',p_data->>'name');
  perform public.save_user_access(p_actor,access_data,p_credentials);
 end if;
 return did;
end;$$;
revoke all on function public.validate_user_doctor_identity() from public,anon,authenticated;
revoke all on function public.save_user_access(bigint,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.save_doctor_with_access(bigint,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_user_access(bigint,jsonb,jsonb),public.save_doctor_with_access(bigint,text,jsonb,jsonb,jsonb) to service_role;
