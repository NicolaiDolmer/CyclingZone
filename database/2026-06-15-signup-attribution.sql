-- Signup attribution (#679 — acquisition tracking).
-- First-touch source (utm_* + referrer + landing path) is captured client-side at
-- the visitor's FIRST visit (stored in localStorage) and persisted here only when
-- they create an account. Basis: legitimate interest, first-party, no cross-site
-- tracking (documented in the privacy policy).
--
-- Backend writes via service_role (bypasses RLS). The data is sensitive acquisition
-- intel → NO anon/authenticated access: RLS is enabled with no policies, so only
-- service_role (backend + admin tooling) can read/write.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS — auto-migrate can re-run safely.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.signup_attribution;

CREATE TABLE IF NOT EXISTS public.signup_attribution (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_term      text,
  utm_content   text,
  referrer      text,
  landing_path  text,
  first_seen_at timestamptz,
  signed_up_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.signup_attribution ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only service_role may read/write. anon/authenticated
-- clients get nothing (no SELECT/INSERT privilege, no RLS policy).

COMMENT ON TABLE public.signup_attribution IS
  'First-touch acquisition source per signup (utm/referrer/landing). Captured client-side at first visit, persisted at signup. Legitimate interest, first-party, no cross-site tracking. service_role-only.';
