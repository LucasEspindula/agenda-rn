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
  a:=public.financial_attendance(p_data->>'appointment_id');
  if a is null then raise exception 'Atendimento inexistente'; end if;
  if role_name<>'general_manager' and not exists(select 1 from public.app_state s cross join lateral jsonb_array_elements(coalesce(s.payload->'appointments','[]')) clinical join public.agenda_access g on g.user_id=p_actor and g.professional_id in(clinical->>'doctorId',clinical->>'anesthetistId') where s.id=1 and clinical->>'id'=a->>'appointment_id') then raise exception 'Agenda sem permissão'; end if;
  select to_jsonb(b) into old_row from public.billing_records b where attendance_id=p_data->>'appointment_id';
  if old_row is not null then sid:=(old_row->>'id')::uuid; else sid:=gen_random_uuid(); end if;
  perform set_config('rn.record',sid::text,true);
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
 elsif p_kind='invoice' then
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
   if public.billing_payer_key(coalesce(nullif(trim(a->>'insurance'),''),(select x->>'insurance' from jsonb_array_elements(coalesce(state->'patients','[]')) x where x->>'id'=a->>'patientId'),''))<>payer_name then raise exception 'Convênio do atendimento diferente do pagador'; end if;
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
