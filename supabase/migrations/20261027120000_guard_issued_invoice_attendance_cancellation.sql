-- RN Integra: prevent removing/cancelling appointments and attendances covered by
-- an issued (ACTIVE, non-void) fiscal document, including shared invoices.
-- Independent of UI / REST / RPC pathways. Existing fiscal guards remain intact.
-- Non-active/inactive invoice links keep their existing protections, without
-- incorrectly being treated as an issued document by this new guard.

CREATE OR REPLACE FUNCTION public.guard_issued_invoice_agenda_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  -- All normal agenda and billing mutations already serialize on this key.
  PERFORM pg_advisory_xact_lock(194701,1);
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(coalesce(OLD.payload->'appointments','[]'::jsonb)) previous
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(NEW.payload->'appointments','[]'::jsonb)) current_appointment
      WHERE current_appointment->>'id'=previous->>'id'
        AND current_appointment->>'status' IS DISTINCT FROM 'cancelled'
    )
    AND EXISTS (
      SELECT 1
      FROM public.billing_records b
      JOIN public.attendances a ON a.id=b.attendance_id
      JOIN public.invoice_billing_records item ON item.billing_record_id=b.id
      JOIN public.invoices invoice ON invoice.id=item.invoice_id
      WHERE (b.appointment_id=previous->>'id' OR a.appointment_id=previous->>'id')
        AND item.is_active
        AND invoice.status='ACTIVE'
        AND invoice.voided_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='Não é possível cancelar ou excluir este atendimento, pois existe uma Nota Fiscal emitida vinculada a ele.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_issued_invoice_agenda_cancellation ON public.app_state;
CREATE TRIGGER guard_issued_invoice_agenda_cancellation
BEFORE UPDATE OF payload ON public.app_state
FOR EACH ROW
EXECUTE FUNCTION public.guard_issued_invoice_agenda_cancellation();

CREATE OR REPLACE FUNCTION public.guard_issued_invoice_attendance_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='UPDATE' AND
     (NEW.status IS DISTINCT FROM 'cancelled' OR OLD.status='cancelled') THEN
    RETURN NEW;
  END IF;

  -- Prevent concurrent invoice creation through financial RPC from racing
  -- against an attendance cancellation.
  PERFORM pg_advisory_xact_lock(194701,1);

  IF EXISTS (
    SELECT 1
    FROM public.billing_records b
    JOIN public.invoice_billing_records item ON item.billing_record_id=b.id
    JOIN public.invoices invoice ON invoice.id=item.invoice_id
    WHERE b.attendance_id=OLD.id
      AND item.is_active
      AND invoice.status='ACTIVE'
      AND invoice.voided_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='Não é possível cancelar ou excluir este atendimento, pois existe uma Nota Fiscal emitida vinculada a ele.';
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_issued_invoice_attendance_mutation ON public.attendances;
CREATE TRIGGER guard_issued_invoice_attendance_mutation
BEFORE UPDATE OF status OR DELETE ON public.attendances
FOR EACH ROW
EXECUTE FUNCTION public.guard_issued_invoice_attendance_mutation();

-- RLS, existing privileges and public API grants remain unchanged.
