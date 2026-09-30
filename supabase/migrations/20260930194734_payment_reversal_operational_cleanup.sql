-- Reset operational receipt data only after the existing authorization/fiscal guards succeed.
-- No backfill: immutable financial logs retain prior values and deleted payment parts.
create or replace function public.save_billing(p_actor bigint,p_kind text,p_data jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare sid uuid; old_invoice public.invoices%rowtype; b public.billing_records%rowtype; a public.attendances%rowtype; r public.invoice_requests%rowtype;
 entry record; key text; recipient jsonb; canonical text; target_id text; total numeric; selected jsonb; previous_payment_status text;
begin
 perform pg_advisory_xact_lock(194701,1);perform pg_advisory_xact_lock(194701,2);
 if not exists(select 1 from public.users where id=p_actor and (role='general_manager' or (role='secretary' and p_kind='record'))) then raise exception 'Acesso negado';end if;
 perform public.financial_operation(p_actor,p_kind,p_data->>'id');
 foreach key in array array['total_amount','net_amount','received_amount','closing_adjustment'] loop
  if nullif(p_data->>key,'') is not null then p_data:=jsonb_set(p_data,array[key],to_jsonb(round((p_data->>key)::numeric,2)));end if;
 end loop;
 if p_kind in ('undo_invoice','cancel_invoice','replace_invoice') then
  select * into old_invoice from public.invoices where id=(p_data->>'id')::uuid for update;
  if old_invoice.id is null then raise exception 'NF não encontrada';end if;
  if old_invoice.status<>'ACTIVE' or old_invoice.voided_at is not null then raise exception 'NF sem vínculo operacional ativo';end if;
  if old_invoice.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'NF alterada. Atualize a página';end if;
  if nullif(trim(p_data->>'reason'),'') is null then raise exception 'Informe o motivo da operação fiscal';end if;
  update public.invoice_billing_records set is_active=false where invoice_id=old_invoice.id;
  update public.billing_records set payment_status='PENDENTE' where billing_method='CONVENIO' and id in(select billing_record_id from public.invoice_billing_records where invoice_id=old_invoice.id);
  select * into r from public.invoice_requests where invoice_id=old_invoice.id;
  if r.id is not null then update public.invoice_requests set status='PENDING',invoice_id=null where id=r.id;end if;
  if p_kind='undo_invoice' then
   update public.invoices set voided_at=clock_timestamp(),voided_by=p_actor,void_reason=trim(p_data->>'reason') where id=old_invoice.id;
  elsif p_kind='cancel_invoice' then
   update public.invoices set status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=p_actor,cancellation_reason=trim(p_data->>'reason') where id=old_invoice.id;
  else
   if jsonb_typeof(p_data->'replacement') is distinct from 'object' then raise exception 'Informe a NF substituta';end if;
   recipient:=(p_data->'replacement')-'id'-'updated_at';
   if recipient->>'recipient_type' is distinct from old_invoice.recipient_type then raise exception 'Preserve o tipo da NF substituída';end if;
   if r.id is not null then recipient:=recipient||jsonb_build_object('request_id',r.id);end if;
   -- The same operation context is retained through creation, allocation and payment parts.
   foreach key in array array['total_amount','net_amount','closing_adjustment'] loop
    if nullif(recipient->>key,'') is not null then recipient:=jsonb_set(recipient,array[key],to_jsonb(round((recipient->>key)::numeric,2)));end if;
   end loop;
   p_data:=recipient;
   update public.invoices set status='REPLACED' where id=old_invoice.id;
  end if;
  if p_kind<>'replace_invoice' then
   perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);return old_invoice.id;
  end if;
 end if;
 if p_kind='record' then
  target_id:=coalesce(p_data->>'attendance_id',p_data->>'appointment_id');
  if exists(select 1 from public.attendances where id=target_id and status='cancelled') then raise exception 'Atendimento cancelado';end if;
  select * into b from public.billing_records where attendance_id=target_id;
  previous_payment_status:=b.payment_status;
  -- Ignore stale client payment values when explicitly returning to pending.
  if b.payment_status='PAGO' and p_data->>'payment_status'='PENDENTE' then
   p_data:=p_data||jsonb_build_object('received_amount',null,'paid_at',null);
  end if;
  if p_data->'fiscal'->>'taker_kind'='PATIENT' then
   select * into r from public.invoice_requests where billing_record_id=b.id and status in ('PENDING','ISSUED');
   select p->>'name' into canonical from public.app_state s cross join lateral jsonb_array_elements(s.payload->'patients') p where s.id=1 and p->>'id'=coalesce((select patient_id from public.attendances where id=target_id),(select ap->>'patientId' from public.app_state st cross join lateral jsonb_array_elements(st.payload->'appointments') ap where ap->>'id'=target_id));
   p_data:=jsonb_set(p_data,'{fiscal,taker_name}',to_jsonb(coalesce(r.taker_name,canonical,'')));
  end if;
 end if;
 if p_kind in ('invoice','replace_invoice') then
  if exists(select 1 from public.invoices where id=nullif(p_data->>'id','')::uuid and (status<>'ACTIVE' or voided_at is not null)) then raise exception 'Documento histórico não pode ser editado';end if;
  if coalesce(p_data->>'recipient_type','CONVENIO')='CONVENIO' then
   selected:=coalesce(p_data->'attendance_ids',p_data->'appointment_ids');
   if jsonb_typeof(selected) is distinct from 'array' or jsonb_array_length(selected)=0 then raise exception 'Selecione os atendimentos da NF';end if;
   if nullif(p_data->>'net_amount','') is null then raise exception 'Informe o valor líquido';end if;
   if jsonb_typeof(p_data->'item_amounts') is distinct from 'object' then raise exception 'Informe o valor de cada atendimento';end if;
   total:=0;
   for key in select distinct value from jsonb_array_elements_text(selected) loop
    if jsonb_typeof(p_data->'item_amounts'->key) is distinct from 'number' then raise exception 'Informe o valor de cada atendimento';end if;
    p_data:=jsonb_set(p_data,array['item_amounts',key],to_jsonb(round((p_data->'item_amounts'->>key)::numeric,2)));
    total:=total+(p_data->'item_amounts'->>key)::numeric;
   end loop;
   if total+coalesce((p_data->>'closing_adjustment')::numeric,0)<>(p_data->>'net_amount')::numeric then raise exception 'A soma dos itens e ajuste deve ser igual ao valor líquido';end if;
  end if;
 end if;
 sid:=public.save_billing_fiscal_core(p_actor,case when p_kind='replace_invoice' then 'invoice' else p_kind end,p_data);
 if p_kind='record' then
  select * into b from public.billing_records where id=sid;
  if b.billing_method='PARTICULAR' and b.payment_status='PAGO' then
   if p_data ? 'payment_parts' then perform public.write_payment_parts(sid,null,p_data->'payment_parts');
    update public.billing_records set payment_composition_verified=true where id=sid;
   elsif not exists(select 1 from public.payment_parts where billing_record_id=sid) and (b.payment_composition_verified or p_data ? 'fiscal' or previous_payment_status is distinct from 'PAGO') then raise exception 'Informe as formas de pagamento';end if;
  elsif previous_payment_status='PAGO' and b.payment_status='PENDENTE' then
   delete from public.payment_parts where billing_record_id=sid;
   update public.billing_records set received_amount=null,paid_at=null,payment_composition_verified=false where id=sid;
  end if;
 elsif p_kind in ('invoice','replace_invoice') then
  update public.invoices set closing_adjustment=coalesce((p_data->>'closing_adjustment')::numeric,0),closing_adjustment_reason=nullif(trim(p_data->>'closing_adjustment_reason'),''),allocation_verified=true where id=sid;
  if coalesce(p_data->>'recipient_type','CONVENIO')='CONVENIO' and nullif(p_data->>'paid_at','') is not null then
   if p_data ? 'payment_parts' then perform public.write_payment_parts(null,sid,p_data->'payment_parts');
    update public.invoices set payment_composition_verified=true where id=sid;
   elsif not exists(select 1 from public.payment_parts where invoice_id=sid) then raise exception 'Informe as formas de pagamento';end if;
  elsif coalesce(p_data->>'recipient_type','CONVENIO')='CONVENIO' then
   delete from public.payment_parts where invoice_id=sid;
   update public.invoices set payment_composition_verified=false where id=sid;
  end if;
  if p_kind='replace_invoice' then update public.invoices set replaced_by_invoice_id=sid where id=old_invoice.id;end if;
 end if;
 perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);return sid;
end;$$;

create or replace function public.protect_fiscal_document() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Preserve o documento fiscal histórico';end if;
 if tg_op='UPDATE' then
  if (old.status<>'ACTIVE' or old.voided_at is not null) and current_setting('rn.kind',true)<>'replace_invoice' then raise exception 'Documento histórico imutável';end if;
  if (new.status is distinct from old.status or new.voided_at is distinct from old.voided_at or new.replaced_by_invoice_id is distinct from old.replaced_by_invoice_id) and current_setting('rn.kind',true) not in ('undo_invoice','cancel_invoice','replace_invoice') then raise exception 'Use a operação fiscal autorizada';end if;
  if (old.allocation_verified and not new.allocation_verified) or (old.payment_composition_verified and not new.payment_composition_verified and not (new.recipient_type='CONVENIO' and new.paid_at is null and coalesce(current_setting('rn.kind',true),'') in ('invoice','replace_invoice'))) then raise exception 'Não remova a validação financeira';end if;
 end if;
 return new;
end;$$;
-- Existing replacements retain their service_role-only ACLs and SECURITY INVOKER.
comment on column public.billing_records.payment_composition_verified is 'Confirmed composition for a paid record; false after reversal or for unreviewed legacy receipts.';
comment on column public.invoices.payment_composition_verified is 'Confirmed composition for a paid invoice; false after payment reversal or for unreviewed legacy receipts.';
