-- RN Integra — 2B/3a: organization-scoped payment composition and portal submissions.
-- Current database has test data only. This is the transitional RN Gestao-only model.
-- A second organization MUST remain blocked until API, RLS and Storage isolation is complete.
BEGIN;

DO $preflight$
DECLARE t text;
BEGIN
  IF (SELECT count(*) FROM public.organizations) <> 1
    OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE slug='rn-gestao' AND active)
  THEN RAISE EXCEPTION 'RN Gestão must be the sole operating organization'; END IF;

  IF to_regprocedure('public.rn_finance_single_organization_id()') IS NULL
     OR to_regprocedure('public.guard_rn_finance_organization()') IS NULL
  THEN RAISE EXCEPTION 'The 2B/2b1 organization guards are required'; END IF;

  FOREACH t IN ARRAY ARRAY[
    'payment_parts',
    'billing_portal_submissions',
    'billing_portal_submission_events'
  ] LOOP
    IF to_regclass('public.'||t) IS NULL
    THEN RAISE EXCEPTION 'Missing financial auxiliary table: %',t; END IF;
    IF EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name=t
                AND column_name='organization_id')
    THEN RAISE EXCEPTION 'organization_id already exists on: %',t; END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||t))
    THEN RAISE EXCEPTION 'RLS must be enabled on: %',t; END IF;
  END LOOP;
END;
$preflight$;

-- ADD COLUMN DEFAULT populates existing rows without running historical UPDATE
-- triggers such as financial_stamp, financial_log_change or fiscal_parts_integrity.
DO $add_tenant_keys$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payment_parts',
    'billing_portal_submissions',
    'billing_portal_submission_events'
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
      'CREATE UNIQUE INDEX %I ON public.%I(id,organization_id)',
      t||'_id_org_unique',t
    );
    EXECUTE format(
      'CREATE TRIGGER guard_rn_finance_organization BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_rn_finance_organization()',
      t
    );
  END LOOP;
END;
$add_tenant_keys$;

-- A child row cannot point at a parent from a different organization.
-- Nullable references remain nullable. Legacy single-column FKs are retained.
ALTER TABLE public.payment_parts
  ADD CONSTRAINT org_link_payment_parts_billing_record_id
  FOREIGN KEY (billing_record_id,organization_id)
  REFERENCES public.billing_records(id,organization_id);

ALTER TABLE public.payment_parts
  ADD CONSTRAINT org_link_payment_parts_invoice_id
  FOREIGN KEY (invoice_id,organization_id)
  REFERENCES public.invoices(id,organization_id);

ALTER TABLE public.billing_portal_submissions
  ADD CONSTRAINT org_link_billing_portal_submissions_billing_record_id
  FOREIGN KEY (billing_record_id,organization_id)
  REFERENCES public.billing_records(id,organization_id);

ALTER TABLE public.billing_portal_submission_events
  ADD CONSTRAINT org_link_billing_portal_submission_events_submission_id
  FOREIGN KEY (submission_id,organization_id)
  REFERENCES public.billing_portal_submissions(id,organization_id);

COMMIT;
