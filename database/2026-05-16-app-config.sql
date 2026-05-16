-- Generic key/value app-config table for feature-flags og runtime-config
-- der skal kunne ændres uden re-deploy. Første use case: survey-CTA-banner
-- (Refs #364, sprint validation uge 2).
--
-- Design:
--   • key TEXT PRIMARY KEY — fx 'survey_banner_enabled', 'survey_banner_url'
--   • value JSONB — flexibel; boolean/string/object alle gyldige
--   • RLS: read = authenticated (public-safe konfig, ingen secrets);
--          write = admin only (RPC eller direkte UPDATE som admin)
--
-- Rationale: én tabel til alle fremtidige flags vs. én tabel per flag.
-- Samme mønster som auction_timing_config, men nøgle-baseret.

CREATE TABLE IF NOT EXISTS public.app_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_config_select_authenticated" ON public.app_config;
CREATE POLICY "app_config_select_authenticated"
  ON public.app_config
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "app_config_admin_write" ON public.app_config;
CREATE POLICY "app_config_admin_write"
  ON public.app_config
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Seed survey-banner flags (default: OFF for normale brugere; admins ser altid via frontend-logik).
INSERT INTO public.app_config (key, value, description)
VALUES
  ('survey_banner_enabled', 'false'::jsonb,
   'When true, survey CTA banner is visible to ALL users on Dashboard. When false, only admins see it (preview-mode). Refs #364.'),
  ('survey_banner_url', '"https://tally.so/r/PLACEHOLDER"'::jsonb,
   'Tally survey URL. Replace with real URL when survey goes live (sprint uge 2, ~2026-05-21). UTM-params appended client-side.')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.app_config IS
  'Generic key/value runtime-config. Read by authenticated; write by admin only. First use case: survey banner flags (#364).';
