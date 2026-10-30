-- RN Integra 2B/3d1: organization-scoped immutable financial logs.
-- Transitional RN Gestao-only guard remains; second-tenant onboarding MUST stay blocked.
BEGIN;
DO $preflight$
BEGIN
 IF (SELECT count(*) FROM public.organizations)<>1
    OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE slug='rn-gestao' AND active)
 THEN RAISE EXCEPTION 'RN Gestao must remain the only operating organization'; END IF;
 IF to_regprocedure('public.rn_finance_single_organization_id()') IS NULL
    OR to_regprocedure('public.guard_rn_finance_organization()') IS NULL
 THEN RAISE EXCEPTION 'Financial organization guard is required'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN ('financial_logs','financial_log_changes')
      AND column_name='organization_id')
 THEN RAISE EXCEPTION 'Financial logs are already organization scoped'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.financial_logs'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.financial_log_changes'::regclass)
 THEN RAISE EXCEPTION 'Financial audit tables must retain RLS'; END IF;
END;
$preflight$;

-- ADD COLUMN DEFAULT fills historic immutable logs without UPDATE/DELETE.
-- Do not disable the immutable_log trigger or destroy audit history.
ALTER TABLE public.financial_logs
 ADD COLUMN organization_id uuid NOT NULL DEFAULT public.rn_finance_single_organization_id();
ALTER TABLE public.financial_log_changes
 ADD COLUMN organization_id uuid NOT NULL DEFAULT public.rn_finance_single_organization_id();

ALTER TABLE public.financial_logs ADD CONSTRAINT financial_logs_organization_fk
 FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.financial_log_changes ADD CONSTRAINT financial_log_changes_organization_fk
 FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX financial_logs_id_org_unique ON public.financial_logs(id,organization_id);
CREATE INDEX financial_logs_org_recent_idx ON public.financial_logs(organization_id,created_at DESC,id);
CREATE INDEX financial_log_changes_org_parent_idx ON public.financial_log_changes(organization_id,log_id);

-- Keep the original single-column FK for legacy callers; enforce the same
-- organization on parent/child separately with a composite FK.
ALTER TABLE public.financial_log_changes ADD CONSTRAINT org_link_financial_log_changes_log_id
 FOREIGN KEY (log_id,organization_id) REFERENCES public.financial_logs(id,organization_id);

CREATE TRIGGER guard_rn_finance_organization
 BEFORE INSERT OR UPDATE ON public.financial_logs
 FOR EACH ROW EXECUTE FUNCTION public.guard_rn_finance_organization();
CREATE TRIGGER guard_rn_finance_organization
 BEFORE INSERT OR UPDATE ON public.financial_log_changes
 FOR EACH ROW EXECUTE FUNCTION public.guard_rn_finance_organization();

COMMIT;
