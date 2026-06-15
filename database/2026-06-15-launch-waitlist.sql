-- Launch waitlist — lean email capture for the public TdF landing page (#672).
-- Separat fra founder_supporter_waitlist (som har NOT NULL interest_level/preferred_tier
-- + intet navn-felt og tjener premium-pris-surveyen). Denne tabel er ren: email + valgfrit
-- navn + consent + attribution. To sider, to job (spec 2026-06-14-landing-page-brand-direction).
--
-- GDPR: consent_given_at obligatorisk (BUSINESS_STRATEGY.md §8), samme kontrakt som founder-tabellen.
--
-- Idempotent: IF NOT EXISTS + DROP POLICY IF EXISTS så auto-migrate kan re-køre uden side-effekter.
--
-- Rollback:
--   DROP TABLE IF EXISTS launch_waitlist;
--   (is_admin() bevares — delt af founder-tabellen + admin-dashboards.)

-- 1. Helper: is_admin() — genbruges på tværs af admin-RLS. CREATE OR REPLACE så migrationen
--    kan køre selvstændigt (identisk definition som 2026-05-15-founder-supporter-waitlist.sql).
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' FROM public.users WHERE id = auth.uid()),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- 2. Tabel: launch_waitlist.
CREATE TABLE IF NOT EXISTS public.launch_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Email er den primære (og eneste påkrævede) kontakt for denne landing.
  email text NOT NULL,
  -- Valgfrit fornavn — bruges kun til personlig launch-mail.
  name text,

  -- GDPR — hard krav (BUSINESS_STRATEGY.md §8). Sættes client-side ved consent-checkbox.
  consent_given_at timestamptz NOT NULL,

  -- Attribution (first-touch): utm_source / utm_campaign / utm_medium fra query-string.
  source text,
  utm_campaign text,
  utm_medium text,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.launch_waitlist IS
  'Lean email-waitlist for den offentlige TdF-landing (#672). Email + valgfrit navn + consent + attribution. Adskilt fra founder_supporter_waitlist (premium-pris-survey).';

-- 3. Case-insensitiv unik email (samme partial-index-mønster som founder-tabellen).
CREATE UNIQUE INDEX IF NOT EXISTS launch_waitlist_email_lower_uniq
  ON public.launch_waitlist (lower(email));

-- Index for admin-listevisning (nyeste først).
CREATE INDEX IF NOT EXISTS launch_waitlist_created_desc
  ON public.launch_waitlist (created_at DESC);

-- 4. RLS.
ALTER TABLE public.launch_waitlist ENABLE ROW LEVEL SECURITY;

-- INSERT: anon kan tilmelde sig hvis consent_given_at er sat.
DROP POLICY IF EXISTS launch_waitlist_anon_insert ON public.launch_waitlist;
CREATE POLICY launch_waitlist_anon_insert
  ON public.launch_waitlist
  FOR INSERT
  TO anon
  WITH CHECK (consent_given_at IS NOT NULL);

-- INSERT: authenticated kan også tilmelde sig (logget-ind users der rammer landing via delt link).
DROP POLICY IF EXISTS launch_waitlist_authenticated_insert ON public.launch_waitlist;
CREATE POLICY launch_waitlist_authenticated_insert
  ON public.launch_waitlist
  FOR INSERT
  TO authenticated
  WITH CHECK (consent_given_at IS NOT NULL);

-- SELECT: kun admin (via is_admin() helper). Service_role bypasser RLS automatisk.
DROP POLICY IF EXISTS launch_waitlist_admin_select ON public.launch_waitlist;
CREATE POLICY launch_waitlist_admin_select
  ON public.launch_waitlist
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- UPDATE/DELETE: ingen policy → kun service_role kan mutere.
