-- RN Integra — Etapa 2B/2b1: physical tenant keys for the core financial graph.
-- Safe RN Gestão-only transition. The operating database contains test records.
-- Does NOT open multi-company operation or make service_role reads tenant-safe.
BEGIN;

DO $preflight$
DECLARE t text;
BEGIN
 IF (SELECT count(*) FROM public.organizations)<>1
    OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE slug='rn-gestao' AND active)
 THEN RAISE EXCEPTION 'RN Gestão is not the sole operating organization'; END IF;

 FOREACH t IN ARRAY ARRAY[
  'doctors','billing_entities','billing_doctor_entities','attendances',
  'billing_records','invoices','invoice_billing_records','invoice_requests',
  'financial_attachments'
 ] LOOP
   IF to_regclass('public.'||t) IS NULL THEN
     RAISE EXCEPTION 'Missing core financial table %',t;
   END IF;
   IF EXISTS (
     SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=t AND column_name='organization_id'
   ) THEN RAISE EXCEPTION 'Column organization_id already exists on %',t;
   END IF;
   IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid=to_regclass('public.'||t)) THEN
     RAISE EXCEPTION 'RLS must already be enabled on %',t;
   END IF;
 END LOOP;
END;$preflight$;

-- Default is a transitional compatibility measure. It deliberately fails closed
-- if ANY second organization appears, even if all accounts are just test data.
CREATE OR REPLACE FUNCTION public.rn_finance_single_organization_id()
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path TO ''
AS $function$
DECLARE org_id uuid;
BEGIN
 IF (SELECT count(*) FROM public.organizations) <> 1
 THEN RAISE EXCEPTION 'Organização de operação inválida. Acesso bloqueado'; END IF;
 SELECT id INTO org_id FROM public.organizations WHERE slug='rn-gestao' AND active;
 IF org_id IS NULL
 THEN RAISE EXCEPTION 'Organização de operação inválida. Acesso bloqueado'; END IF;
 RETURN org_id;
END;$function$;

CREATE OR REPLACE FUNCTION public.guard_rn_finance_organization()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
DECLARE active_id uuid;
BEGIN
 active_id:=public.rn_finance_single_organization_id();
 IF NEW.organization_id IS DISTINCT FROM active_id
 THEN RAISE EXCEPTION 'Registro financeiro fora da organização autorizada'; END IF;
 IF TG_OP='UPDATE' AND OLD.organization_id IS DISTINCT FROM NEW.organization_id
 THEN RAISE EXCEPTION 'Transferência de organização financeira proibida'; END IF;
 RETURN NEW;
END;$function$;

REVOKE ALL ON FUNCTION public.rn_finance_single_organization_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_rn_finance_organization() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rn_finance_single_organization_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_rn_finance_organization() TO service_role;

-- Adding a DEFAULT to a new NOT NULL column also populates old tuples.
-- This avoids UPDATE-triggering thousands of historical business operations.
DO $columns$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY[
  'doctors','billing_entities','billing_doctor_entities','attendances',
  'billing_records','invoices','invoice_billing_records','invoice_requests',
  'financial_attachments'
 ] LOOP
  EXECUTE format(
   'ALTER TABLE public.%I ADD COLUMN organization_id uuid NOT NULL DEFAULT public.rn_finance_single_organization_id()',
   t
  );
  EXECUTE format(
   'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT',
   t, t||'_organization_fk'
  );
  EXECUTE format(
   'CREATE UNIQUE INDEX %I ON public.%I (id, organization_id)',
   t||'_id_org_unique',t
  );
  EXECUTE format(
   'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_rn_finance_organization()',
   'guard_rn_finance_organization',t
  );
 END LOOP;
END;$columns$;

-- Composite FKs enforce that a child and its parent belong to the SAME tenant.
-- Keep the existing single-column FKs for backwards compatibility and existing
-- actions; preserve CASCADE on invoice-item links, as the legacy FKs do.
DO $relationships$
DECLARE r record;
BEGIN
 FOR r IN
  SELECT * FROM (VALUES
   ('billing_doctor_entities','doctor_id','doctors',false),
   ('billing_doctor_entities','billing_entity_id','billing_entities',false),
   ('attendances','doctor_id','doctors',false),
   ('attendances','billing_entity_id','billing_entities',false),
   ('billing_records','billing_entity_id','billing_entities',false),
   ('billing_records','attendance_id','attendances',false),
   ('billing_records','professional_id','doctors',false),
   ('invoices','billing_entity_id','billing_entities',false),
   ('invoices','replaced_by_invoice_id','invoices',false),
   ('invoice_billing_records','invoice_id','invoices',true),
   ('invoice_billing_records','billing_record_id','billing_records',true),
   ('invoice_requests','attendance_id','attendances',false),
   ('invoice_requests','billing_record_id','billing_records',false),
   ('invoice_requests','billing_entity_id','billing_entities',false),
   ('invoice_requests','doctor_id','doctors',false),
   ('invoice_requests','invoice_id','invoices',false),
   ('financial_attachments','invoice_id','invoices',false),
   ('financial_attachments','billing_record_id','billing_records',false),
   ('financial_attachments','replaces_attachment_id','financial_attachments',false),
   ('financial_attachments','replaced_by_attachment_id','financial_attachments',false)
  ) AS links(child_table, child_column, parent_table, cascade_delete)
 LOOP
   EXECUTE format(
     'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I,organization_id) REFERENCES public.%I(id,organization_id)%s',
     r.child_table,
     'org_link_'||r.child_table||'_'||r.child_column,
     r.child_column,r.parent_table,
     CASE WHEN r.cascade_delete THEN ' ON DELETE CASCADE' ELSE '' END
   );
 END LOOP;
END;$relationships$;

COMMIT;
