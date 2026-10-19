-- Registro transacional de autorizações fiscais: operador != aprovador.
-- A senha é verificada na API. Nunca é fornecida nem gravada neste RPC.
-- Encapsula a operação fiscal e sua trilha de auditoria na mesma transação.
create or replace function public.save_billing_with_manager_approval(
 p_actor bigint,p_approver bigint,p_kind text,p_data jsonb)
returns uuid language plpgsql set search_path to ''
as $$
declare
 operator_row public.users%rowtype;
 manager_row public.users%rowtype;
 original_invoice public.invoices%rowtype;
 new_invoice public.invoices%rowtype;
 saved_id uuid;
 operation_id uuid:=gen_random_uuid();
begin
 if p_kind not in ('cancel_invoice','replace_invoice','undo_invoice') then
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
 if original_invoice.issue_date>=date_trunc('month',timezone('America/Sao_Paulo',now()))::date then
   raise exception 'Fluxo de autorização reservado às NFs de meses anteriores';
 end if;
 -- O financeiro antigo exige o perfil de gerente para executar a alteração.
 -- A trilha adicional abaixo registra o operador original de forma explícita.
 saved_id:=public.save_billing(p_approver,p_kind,p_data);
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
$$;
revoke all on function public.save_billing_with_manager_approval(bigint,bigint,text,jsonb)
 from public,anon,authenticated;
grant execute on function public.save_billing_with_manager_approval(bigint,bigint,text,jsonb)
 to service_role;
