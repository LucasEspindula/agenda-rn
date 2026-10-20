-- Ações fiscais sensíveis exigem aprovação autenticada do Gerente Geral em todo período.
-- Reativação é transacional, auditada e bloqueada se outra NF tiver vínculo ativo.
create or replace function public.restore_billing_invoice(p_actor bigint,p_data jsonb)
returns uuid language plpgsql security invoker set search_path=''
as $function$
declare
 i public.invoices%rowtype;
 line record;
 pending_request public.invoice_requests%rowtype;
 request_total integer;
begin
 if (select role from public.users where id=p_actor) is distinct from 'general_manager'
 then raise exception 'Exige autorização do Gerente Geral'; end if;
 if nullif(trim(p_data->>'reason'),'') is null
 then raise exception 'Informe o motivo da restauração'; end if;
 if nullif(p_data->>'id','') is null
 then raise exception 'NF inválida'; end if;

 select * into i from public.invoices where id=(p_data->>'id')::uuid for update;
 if i.id is null then raise exception 'NF não encontrada'; end if;
 if i.status not in ('CANCELLED','REPLACED') or i.voided_at is not null
 then raise exception 'Somente NFs canceladas ou substituídas não desfeitas podem ser reativadas'; end if;
 if i.updated_at is distinct from (p_data->>'updated_at')::timestamptz
 then raise exception 'NF alterada por outro usuário. Atualize a página'; end if;
 if not exists(select 1 from public.invoice_billing_records where invoice_id=i.id)
 then raise exception 'NF sem atendimentos vinculados não pode ser reativada automaticamente'; end if;

 -- Reativação de uma NF substituída exige desativação prévia da substituta.
 if i.replaced_by_invoice_id is not null and exists (
   select 1 from public.invoices next_invoice
   where next_invoice.id=i.replaced_by_invoice_id
     and next_invoice.status='ACTIVE' and next_invoice.voided_at is null
 ) then
  raise exception 'A NF substituta ainda está ativa. Cancele ou regularize a substituta antes de reativar esta NF';
 end if;
 -- Concurrency: row locks serialize restores involving the same cobrança.
 for line in
  select ib.billing_record_id
  from public.invoice_billing_records ib
  where ib.invoice_id=i.id order by ib.billing_record_id for update
 loop
  perform 1 from public.billing_records b where b.id=line.billing_record_id for update;
  if exists (
   select 1 from public.invoice_billing_records other_ib
   join public.invoices other_invoice on other_invoice.id=other_ib.invoice_id
   where other_ib.billing_record_id=line.billing_record_id
    and other_ib.invoice_id<>i.id and other_ib.is_active
  ) then
   raise exception 'Atendimento já vinculado a outra NF ativa. Regularize a NF atual antes de restaurar a anterior';
  end if;
  if exists (
   select 1 from public.invoice_requests ir
   where ir.billing_record_id=line.billing_record_id and ir.status='ISSUED'
    and ir.invoice_id is distinct from i.id
  ) then
   raise exception 'Solicitação fiscal já vinculada a outra NF. Regularize-a antes de restaurar a anterior';
  end if;
 end loop;

 perform public.financial_operation(p_actor,'restore_invoice',i.id::text);
 update public.invoice_billing_records
 set is_active=true where invoice_id=i.id;
 if i.recipient_type='CONVENIO' then
  update public.billing_records b
  set payment_status=case when i.paid_at is not null then 'PAGO' else 'PENDENTE' end
  where b.id in (select ib.billing_record_id from public.invoice_billing_records ib where ib.invoice_id=i.id);
 else
  -- Uma única solicitação ativa por cobrança: não trocar solicitações de outra NF.
  for line in select distinct ib.billing_record_id from public.invoice_billing_records ib where ib.invoice_id=i.id loop
   select count(*) into request_total from public.invoice_requests req
    where req.billing_record_id=line.billing_record_id and req.status in ('PENDING','ISSUED');
   if request_total>1 then raise exception 'Há solicitações fiscais concorrentes para o mesmo pagamento'; end if;
   update public.invoice_requests
   set status='ISSUED',invoice_id=i.id
   where billing_record_id=line.billing_record_id and status='PENDING' and invoice_id is null;
  end loop;
 end if;
 update public.invoices
 set status='ACTIVE', cancelled_at=null,cancelled_by=null,cancellation_reason=null,
     replaced_by_invoice_id=null
 where id=i.id;
 perform set_config('rn.operation','',true);
 perform set_config('rn.actor','',true);
 return i.id;
end;
$function$;

-- O wrapper já guarda operador e aprovador em financial_logs e financial_log_changes.
-- Agora também cobre o mês corrente e a restauração, sempre na mesma transação.
CREATE OR REPLACE FUNCTION public.save_billing_with_manager_approval(p_actor bigint, p_approver bigint, p_kind text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 operator_row public.users%rowtype;
 manager_row public.users%rowtype;
 original_invoice public.invoices%rowtype;
 new_invoice public.invoices%rowtype;
 saved_id uuid;
 operation_id uuid:=gen_random_uuid();
begin
 if p_kind not in ('cancel_invoice','replace_invoice','undo_invoice','restore_invoice') then
   raise exception 'Autorização restrita à alteração fiscal de NF';
 end if;
 select * into operator_row from public.users where id=p_actor;
 select * into manager_row from public.users where id=p_approver;
 if operator_row.id is null or operator_row.role not in ('general_manager','secretary')
    or manager_row.id is null or manager_row.role<>'general_manager' then
   raise exception 'Operador ou aprovador sem autorização';
 end if;
 select * into original_invoice from public.invoices
  where id=(p_data->>'id')::uuid;
 if original_invoice.id is null then raise exception 'NF não encontrada';end if;
 -- O financeiro antigo exige o perfil de gerente para executar a alteração.
 -- A trilha adicional abaixo registra o operador original de forma explícita.
 if p_kind='restore_invoice' then
  saved_id:=public.restore_billing_invoice(p_approver,p_data);
 else
  saved_id:=public.save_billing(p_approver,p_kind,p_data);
 end if;
 if p_kind='replace_invoice' then
  select * into new_invoice from public.invoices where id=saved_id;
 end if;
 insert into public.financial_logs(id,actor_id,actor_name,actor_email,kind,record_id)
 values(operation_id,operator_row.id,
  coalesce(nullif(operator_row.name,''),operator_row.email),
  operator_row.email,'manager_approval',original_invoice.id::text);
 insert into public.financial_log_changes(log_id,record_type,record_id,action,before_data,after_data)
 values(operation_id,'billing_manager_authorization',original_invoice.id::text,'INSERT',null,
  jsonb_build_object(
   'invoice_id',original_invoice.id,
   'invoice_number',original_invoice.invoice_number,
   'action_kind',p_kind,
   'authorized_by_id',manager_row.id,
   'authorized_by_name',coalesce(nullif(manager_row.name,''),manager_row.email),
   'operator_id',operator_row.id,
   'operator_name',coalesce(nullif(operator_row.name,''),operator_row.email),
   'operator_role',operator_row.role,
   'replacement_invoice_number',case when p_kind='replace_invoice'
    then new_invoice.invoice_number else null end
  ));
 return saved_id;
end;
$function$;

