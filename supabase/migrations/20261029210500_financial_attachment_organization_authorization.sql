-- RN Integra 2B/2b2a: tenant-bound payment proof authorization and new Storage paths.
-- Existing legacy objects retain their paths for read/history compatibility.
-- RN Gestão remains the only operating organization; NO multi-tenant onboarding.
BEGIN;

CREATE OR REPLACE FUNCTION public.authorized_financial_attachment_actor(actor bigint, invoice uuid, record uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
 v_org uuid;
 v_role text;
BEGIN
 -- Preserve the XOR target contract and fail closed if another tenant exists.
 IF (invoice IS NULL)=(record IS NULL) THEN RETURN false; END IF;
 v_org:=public.rn_finance_single_organization_id();
 SELECT u.role INTO v_role
 FROM public.users u
 JOIN public.organization_memberships m ON m.user_id=u.id
 WHERE u.id=actor AND u.active AND m.active
   AND m.organization_id=v_org AND m.role=u.role;
 IF v_role NOT IN ('general_manager','secretary') OR v_role IS NULL
 THEN RETURN false; END IF;

 IF record IS NOT NULL THEN
   -- Managers still require a real target from their organization.
   IF NOT EXISTS(SELECT 1 FROM public.billing_records b
                 WHERE b.id=record AND b.organization_id=v_org)
   THEN RETURN false; END IF;
   IF v_role='general_manager' THEN RETURN true; END IF;
   RETURN EXISTS(
     SELECT 1 FROM public.billing_records b
     JOIN public.attendances a ON a.id=b.attendance_id AND a.organization_id=v_org
     WHERE b.id=record AND b.organization_id=v_org
       AND EXISTS(
         SELECT 1 FROM public.agenda_access g
         WHERE g.user_id=actor
           AND (
             g.professional_id=a.doctor_id
             OR EXISTS(
               SELECT 1 FROM public.app_state s
               CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.payload->'appointments','[]'::jsonb)) ap(value)
               WHERE s.organization_id=v_org
                 AND ap.value->>'id'=a.appointment_id
                 AND nullif(ap.value->>'anesthetistId','')=g.professional_id
             )
           )
       )
   );
 END IF;

 IF NOT EXISTS(SELECT 1 FROM public.invoices i WHERE i.id=invoice AND i.organization_id=v_org)
 THEN RETURN false; END IF;
 IF v_role='general_manager' THEN RETURN true; END IF;

 -- Every item must belong to an attendance the secretary can access.
 -- LEFT JOIN intentionally denies broken or missing item relationships.
 RETURN EXISTS(
   SELECT 1 FROM public.invoice_billing_records ib
   WHERE ib.invoice_id=invoice AND ib.organization_id=v_org
 )
 AND NOT EXISTS(
   SELECT 1
   FROM public.invoice_billing_records ib
   LEFT JOIN public.billing_records b
     ON b.id=ib.billing_record_id AND b.organization_id=v_org
   LEFT JOIN public.attendances a
     ON a.id=b.attendance_id AND a.organization_id=v_org
   WHERE ib.invoice_id=invoice AND ib.organization_id=v_org
     AND (
       b.id IS NULL OR a.id IS NULL
       OR NOT EXISTS(
         SELECT 1 FROM public.agenda_access g
         WHERE g.user_id=actor
           AND (
             g.professional_id=a.doctor_id
             OR EXISTS(
               SELECT 1 FROM public.app_state s
               CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.payload->'appointments','[]'::jsonb)) ap(value)
               WHERE s.organization_id=v_org
                 AND ap.value->>'id'=a.appointment_id
                 AND nullif(ap.value->>'anesthetistId','')=g.professional_id
             )
           )
       )
     )
 );
END;
$function$;

CREATE OR REPLACE FUNCTION public.begin_financial_attachment(p_actor bigint, p_invoice uuid, p_record uuid, p_filename text, p_mime text, p_size bigint, p_replaces uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, storage_path text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 attachment_id uuid:=gen_random_uuid();
 current_attachment public.financial_attachments%rowtype;
 v_org uuid;
begin
 v_org:=public.require_rn_agenda_actor_organization(p_actor);
 if (p_invoice is null)=(p_record is null) then
  raise exception 'Informe exatamente um pagamento';
 end if;
 if not public.authorized_financial_attachment_actor(p_actor,p_invoice,p_record) then
  raise exception 'Acesso negado';
 end if;
 if p_invoice is not null and not exists(
  select 1 from public.invoices i
  where i.id=p_invoice and i.organization_id=v_org and i.recipient_type='CONVENIO' and i.status='ACTIVE'
   and i.voided_at is null and i.paid_at is not null
 ) then
  raise exception 'NF paga não encontrada';
 end if;
 if p_record is not null and not exists(
  select 1 from public.billing_records b
  where b.id=p_record and b.organization_id=v_org and b.payment_status='PAGO' and b.paid_at is not null
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
  where fa.id=p_replaces and fa.organization_id=v_org
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
  format('org/%s/payment-proofs/%s/%s',v_org,coalesce(p_invoice,p_record),attachment_id),
  p_filename,p_mime,p_size,p_replaces
 );
 return query
  select attachment_id,format('org/%s/payment-proofs/%s/%s',v_org,coalesce(p_invoice,p_record),attachment_id);
end;
$function$;

REVOKE ALL ON FUNCTION public.authorized_financial_attachment_actor(bigint,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorized_financial_attachment_actor(bigint,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.begin_financial_attachment(bigint,uuid,uuid,text,text,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_financial_attachment(bigint,uuid,uuid,text,text,bigint,uuid) TO service_role;

COMMIT;
