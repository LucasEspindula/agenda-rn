-- RN Integra — phase 1 of organization isolation (additive foundation).
-- IMPORTANT: this does not enable multi-organization onboarding or data access.
-- Existing business tables, app_state(id=1), sessions and authorization stay unchanged.
-- Phase 2+ must enforce organization scope in *every* API, RPC and Storage path.
BEGIN;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  kind text NOT NULL CHECK (kind IN ('MANAGEMENT_COMPANY','CLINIC','SOLO_DOCTOR')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_memberships (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('general_manager','secretary','doctor')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

-- Authorized server-side membership lookup; the PK covers organization listings.
CREATE INDEX organization_memberships_active_user_idx
  ON public.organization_memberships(user_id, organization_id) WHERE active;

-- Private server-managed metadata. Never expose these to anon/authenticated.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organizations, public.organization_memberships
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.organizations, public.organization_memberships TO service_role;

-- Preserve today's RN Gestão users in exactly one legacy operating organization.
-- This is NOT a license to create another organization: patient/financial data
-- are still in global tables until their own migration and access controls.
INSERT INTO public.organizations (slug, name, kind)
VALUES ('rn-gestao', 'RN Gestão', 'MANAGEMENT_COMPANY')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.organization_memberships (organization_id, user_id, role)
SELECT o.id, u.id, u.role
FROM public.organizations AS o
CROSS JOIN public.users AS u
WHERE o.slug = 'rn-gestao'
  AND u.role IN ('general_manager','secretary','doctor')
ON CONFLICT (organization_id, user_id) DO NOTHING;

COMMIT;
