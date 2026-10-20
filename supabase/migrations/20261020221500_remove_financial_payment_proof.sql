-- A remoção de um comprovante pronto deve ser auditável, não apagar o pagamento
-- nem destruir evidências financeiras. O arquivo deixa de ser atual; metadados,
-- armazenamento privado e log permanecem consultáveis no histórico autorizado.
alter table public.financial_attachments
 drop constraint financial_attachments_deactivation_reason_check;
alter table public.financial_attachments
 add constraint financial_attachments_deactivation_reason_check
 check (deactivation_reason in ('REPLACED','PAYMENT_REVERSED','REMOVED_BY_USER'));

create or replace function public.remove_financial_attachment(p_actor bigint,p_id uuid)
returns void
language plpgsql
security invoker
set search_path=''
as $function$
declare
 attachment public.financial_attachments%rowtype;
begin
 select * into attachment
 from public.financial_attachments
 where id=p_id
 for update;

 if attachment.id is null or attachment.status<>'READY'
    or not attachment.is_current or attachment.deactivated_at is not null then
  raise exception 'O comprovante já não está ativo';
 end if;
 if not public.authorized_financial_attachment_actor(
    p_actor,attachment.invoice_id,attachment.billing_record_id) then
  raise exception 'Sem permissão para excluir este comprovante';
 end if;

 perform public.financial_operation(p_actor,'payment_proof',
  coalesce(attachment.invoice_id,attachment.billing_record_id)::text);

 update public.financial_attachments
 set is_current=false,
     deactivated_at=clock_timestamp(),
     deactivation_reason='REMOVED_BY_USER'
 where id=attachment.id and status='READY' and is_current;

 if not found then raise exception 'Não foi possível remover o comprovante';end if;
end;
$function$;

revoke all on function public.remove_financial_attachment(bigint,uuid)
 from public,anon,authenticated;
grant execute on function public.remove_financial_attachment(bigint,uuid)
 to service_role;
