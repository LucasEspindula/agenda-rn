-- RN Integra — Etapa 2B/3b: organization keys for denial, closing and expense graphs.
-- RN Gestão remains the sole operating tenant. The current records are test-only.
-- Do not onboard another tenant until all APIs/Storage and per-tenant authorization are isolated.
BEGIN;

DO $preflight$
DECLARE t text;
BEGIN
 IF (SELECT count(*) FROM public.organizations) <> 1
    OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE slug='rn-gestao' AND active)
 THEN RAISE EXCEPTION 'RN Gestão must remain the sole operating organization'; END IF;
 IF to_regprocedure('public.rn_finance_single_organization_id()') IS NULL
    OR to_regprocedure('public.guard_rn_finance_organization()') IS NULL
 THEN RAISE EXCEPTION 'Financial tenant guards are missing'; END IF;

 FOREACH t IN ARRAY ARRAY[
   'billing_denial_cases','billing_denial_appeals','billing_denial_events',
   'billing_denial_recoveries','billing_monthly_closings',
   'billing_monthly_closing_events','company_associates','company_expenses'
 ] LOOP
   IF to_regclass('public.'||t) IS NULL
   THEN RAISE EXCEPTION 'Missing financial auxiliary table: %',t; END IF;
   IF EXISTS(SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=t AND column_name='organization_id')
   THEN RAISE EXCEPTION 'organization_id already exists on %',t; END IF;
   IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||t))
   THEN RAISE EXCEPTION 'RLS must be enabled on %',t; END IF;
 END LOOP;
END;
$preflight$;

-- DEFAULT backfills test rows without UPDATE, so we do not replay immutable closing
-- or historical financial audit triggers as a side effect of tenant isolation.
DO $tenant_columns$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY[
   'billing_denial_cases','billing_denial_appeals','billing_denial_events',
   'billing_denial_recoveries','billing_monthly_closings',
   'billing_monthly_closing_events','company_associates','company_expenses'
 ] LOOP
   EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN organization_id uuid NOT NULL DEFAULT public.rn_finance_single_organization_id()',
      t
   );
   EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT',
      t, t||'_organization_fk'
   );
   EXECUTE format('CREATE UNIQUE INDEX %I ON public.%I(id,organization_id)',t||'_id_org_unique',t);
   EXECUTE format(
      'CREATE TRIGGER guard_rn_finance_organization BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_rn_finance_organization()',
      t
   );
 END LOOP;
END;
$tenant_columns$;

-- Keep legacy one-column FKs and add tenant-consistent links.
-- Nullable relationship columns stay optional. Parent table unique (id,organization_id)
-- indexes already exist for billing_records, billing_entities, doctors and
-- billing_doctor_entities from 2B/2b1.
DO $tenant_relationships$
DECLARE link record;
BEGIN
 FOR link IN
   SELECT * FROM (VALUES
     ('billing_denial_cases','billing_record_id','billing_records'),
     ('billing_denial_cases','billing_entity_id','billing_entities'),
     ('billing_denial_appeals','denial_id','billing_denial_cases'),
     ('billing_denial_events','denial_id','billing_denial_cases'),
     ('billing_denial_recoveries','denial_id','billing_denial_cases'),
     ('billing_denial_recoveries','appeal_id','billing_denial_appeals'),
     ('billing_monthly_closings','billing_entity_id','billing_entities'),
     ('billing_monthly_closing_events','billing_entity_id','billing_entities'),
     ('company_associates','billing_entity_id','billing_entities'),
     ('company_associates','doctor_id','doctors'),
     ('company_expenses','billing_entity_id','billing_entities'),
     ('company_expenses','paid_by_associate_id','company_associates'),
     ('company_expenses','paid_by_doctor_entity_link_id','billing_doctor_entities')
   ) AS links(child_table,child_column,parent_table)
 LOOP
   EXECUTE format(
     'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I,organization_id) REFERENCES public.%I(id,organization_id)',
     link.child_table,
     'org_link_'||link.child_table||'_'||link.child_column,
     link.child_column,
     link.parent_table
   );
 END LOOP;
END;
$tenant_relationships$;

COMMIT;
