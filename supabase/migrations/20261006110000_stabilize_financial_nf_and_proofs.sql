-- Correct the proof preparation function without changing its authorization or lifecycle.
-- RETURNS TABLE(id, storage_path) makes unqualified id references ambiguous in PL/pgSQL.
create or replace function public.begin_financial_attachment(
 p_actor bigint,
 p_invoice uuid,
 p_record uuid,
 p_filename text,
 p_mime text,
 p_size bigint,
 p_replaces uuid default null
) returns table(id uuid,storage_path text)
language plpgsql
security invoker
set search_path=''
as $$
declare
 attachment_id uuid:=gen_random_uuid();
 current_attachment public.financial_attachments%rowtype;
begin
 if (p_invoice is null)=(p_record is null) then
  raise exception 'Informe exatamente um pagamento';
 end if;
 if not public.authorized_financial_attachment_actor(p_actor,p_invoice,p_record) then
  raise exception 'Acesso negado';
 end if;
 if p_invoice is not null and not exists(
  select 1 from public.invoices i
  where i.id=p_invoice and i.recipient_type='CONVENIO' and i.status='ACTIVE'
   and i.voided_at is null and i.paid_at is not null
 ) then
  raise exception 'NF paga não encontrada';
 end if;
 if p_record is not null and not exists(
  select 1 from public.billing_records b
  where b.id=p_record and b.payment_status='PAGO' and b.paid_at is not null
   and b.received_amount is not null
   and (b.billing_method='PARTICULAR' or b.settlement_mode='DIRECT')
 ) then
  raise exception 'Pagamento direto não encontrado';
 end if;
 if p_filename is null or p_filename<>trim(p_filename)
   or p_filename~'[\\/[:cntrl:]]' or length(p_filename)>200
   or p_mime not in ('application/pdf','image/jpeg','image/png')
   or p_size<=0 or p_size>10485760 then
  raise exception 'Comprovante inválido';
 end if;
 if p_replaces is not null then
  select fa.* into current_attachment
  from public.financial_attachments fa
  where fa.id=p_replaces
  for update;
  if current_attachment.id is null or not current_attachment.is_current
    or current_attachment.status<>'READY'
    or current_attachment.invoice_id is distinct from p_invoice
    or current_attachment.billing_record_id is distinct from p_record then
   raise exception 'Comprovante atual não encontrado';
  end if;
 end if;
 perform public.financial_operation(p_actor,'payment_proof',coalesce(p_invoice,p_record)::text);
 insert into public.financial_attachments(
  id,document_type,invoice_id,billing_record_id,storage_path,
  original_filename,mime_type,file_size,replaces_attachment_id
 ) values(
  attachment_id,'PAYMENT_PROOF',p_invoice,p_record,
  format('payment-proofs/%s/%s',coalesce(p_invoice,p_record),attachment_id),
  p_filename,p_mime,p_size,p_replaces
 );
 return query
  select attachment_id,format('payment-proofs/%s/%s',coalesce(p_invoice,p_record),attachment_id);
end;
$$;

revoke all on function public.begin_financial_attachment(bigint,uuid,uuid,text,text,bigint,uuid)
 from public,anon,authenticated;
grant execute on function public.begin_financial_attachment(bigint,uuid,uuid,text,text,bigint,uuid)
 to service_role;
