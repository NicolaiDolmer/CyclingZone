-- Founder Supporter waitlist — non-binding intent capture for Monetization Validation Sprint 2026-05-18 → 2026-06-17.
-- Refs #359 + SPRINT_DASHBOARD.md Appendix Issue #2 (kanonisk spec).
-- Schema fra Manus: `~\OneDrive\CyclingZone-context\CyclingZone-Manus noter\Cycling Zone — Founder Supporter Waitlist Setup.md`.
-- GDPR: consent_given_at obligatorisk (BUSINESS_STRATEGY.md §8).
-- Tiers: 3 betalte + free per BUSINESS_STRATEGY.md §2 (Patron valideres separat senere).
--
-- Idempotent: IF NOT EXISTS + DROP POLICY IF EXISTS så auto-migrate kan re-køre uden side-effekter.
--
-- Rollback:
--   DROP TABLE IF EXISTS founder_supporter_waitlist;
--   DROP FUNCTION IF EXISTS is_admin();

-- 1. Helper: is_admin() — genbruges af #363 admin-dashboard og fremtidige admin-RLS-policies.
--    Pattern: users.role = 'admin' (text-kolonne på public.users, sat ved seed).
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

COMMENT ON FUNCTION public.is_admin() IS
  'Returns true if the current auth.uid() is admin in public.users. Stable + SECURITY DEFINER so RLS policies can call without recursive RLS-check on users.';

-- 2. Tabel: founder_supporter_waitlist.
CREATE TABLE IF NOT EXISTS public.founder_supporter_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Kontakt: mindst én af email/discord_handle skal være sat (Manus tillader Discord-only).
  email text,
  discord_handle text,
  contact_type text CHECK (contact_type IN ('email','discord','unknown')),

  -- Intent (Manus' 9-felts form).
  interest_level text NOT NULL
    CHECK (interest_level IN ('very','maybe','unsure')),
  preferred_tier text NOT NULL
    CHECK (preferred_tier IN (
      'supporter_monthly',   -- 49 DKK/md
      'supporter_annual',    -- 490 DKK/år
      'pro_analyst_monthly', -- 89 DKK/md
      'free_only'            -- Vil kun have gratis adgang
    )),
  main_reason text,
  valued_benefits text[],
  fairness_red_line text,
  follow_up_consent boolean NOT NULL DEFAULT false,

  -- Attribution: ét felt (utm_source eller manuel tag) per appendix-spec.
  source text,

  -- GDPR — hard krav (BUSINESS_STRATEGY.md §8).
  consent_given_at timestamptz NOT NULL,

  -- Workflow-tracking (Manus' "status"-kolonne).
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','contacted','interviewed','converted','declined')),
  notes text,

  -- Auto-scoring (Manus' formel: interest×tier-vægt + follow_up bonus).
  intent_score int GENERATED ALWAYS AS (
    CASE interest_level
      WHEN 'very' THEN
        CASE preferred_tier
          WHEN 'pro_analyst_monthly' THEN 4
          WHEN 'supporter_monthly'   THEN 3
          WHEN 'supporter_annual'    THEN 3
          ELSE 1
        END
      WHEN 'maybe' THEN
        CASE preferred_tier
          WHEN 'free_only' THEN 1
          ELSE 2
        END
      ELSE 1
    END
    + CASE WHEN follow_up_consent THEN 1 ELSE 0 END
  ) STORED,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Mindst én kontakt-kanal kræves.
  CONSTRAINT contact_present
    CHECK (email IS NOT NULL OR discord_handle IS NOT NULL)
);

COMMENT ON TABLE public.founder_supporter_waitlist IS
  'Non-binding waitlist for Founder Supporter status. Drives Go/No-Go-beslutning efter 30-dages monetization-sprint (#359, SPRINT_DASHBOARD.md).';

COMMENT ON COLUMN public.founder_supporter_waitlist.intent_score IS
  'Auto-computed 1-5 baseret på interest_level + preferred_tier + follow_up_consent. Manus-formel; admin kan tilføje manuel +1 for "clear paid-value reason" via notes-felt.';

COMMENT ON COLUMN public.founder_supporter_waitlist.source IS
  'Utm_source fra query-string ELLER manuel tag (discord_launch / survey / direct_dm / reddit / other). Single field per sprint-dashboard appendix #2.';

-- 3. Unique-constraints (case-insensitive, partial — nullable kolonner).
CREATE UNIQUE INDEX IF NOT EXISTS founder_waitlist_email_lower_uniq
  ON public.founder_supporter_waitlist (lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS founder_waitlist_discord_lower_uniq
  ON public.founder_supporter_waitlist (lower(discord_handle))
  WHERE discord_handle IS NOT NULL;

-- Index for admin-dashboard sortering på intent_score.
CREATE INDEX IF NOT EXISTS founder_waitlist_intent_score_desc
  ON public.founder_supporter_waitlist (intent_score DESC, created_at DESC);

-- 4. RLS.
ALTER TABLE public.founder_supporter_waitlist ENABLE ROW LEVEL SECURITY;

-- INSERT: anon kan tilmelde sig hvis consent_given_at er sat.
DROP POLICY IF EXISTS waitlist_anon_insert ON public.founder_supporter_waitlist;
CREATE POLICY waitlist_anon_insert
  ON public.founder_supporter_waitlist
  FOR INSERT
  TO anon
  WITH CHECK (consent_given_at IS NOT NULL);

-- INSERT: authenticated kan også tilmelde sig (logget-ind users der ser landing page).
DROP POLICY IF EXISTS waitlist_authenticated_insert ON public.founder_supporter_waitlist;
CREATE POLICY waitlist_authenticated_insert
  ON public.founder_supporter_waitlist
  FOR INSERT
  TO authenticated
  WITH CHECK (consent_given_at IS NOT NULL);

-- SELECT: kun admin (via is_admin() helper). Service_role bypasser RLS automatisk.
DROP POLICY IF EXISTS waitlist_admin_select ON public.founder_supporter_waitlist;
CREATE POLICY waitlist_admin_select
  ON public.founder_supporter_waitlist
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- UPDATE/DELETE: ingen policy → kun service_role kan mutere. Admin-dashboard skriver via backend.
