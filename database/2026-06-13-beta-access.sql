-- Beta-adgangssystem (#1105-enabler): tester-kohorte + tre-tilstands feature-flags.
-- Idempotent. Spejler is_admin()-mønstret (2026-05-15-founder-supporter-waitlist.sql).
--
-- Rollback:
--   ALTER TABLE public.users DROP COLUMN IF EXISTS is_beta_tester;
--   DROP FUNCTION IF EXISTS public.is_beta_tester();

-- 1. Kohorte-medlemskab på users.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_beta_tester boolean NOT NULL DEFAULT false;

-- 2. Helper: is_beta_tester() — admins er implicit beta. Spejler is_admin().
CREATE OR REPLACE FUNCTION public.is_beta_tester()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' OR is_beta_tester FROM public.users WHERE id = auth.uid()),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_beta_tester() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_beta_tester() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.is_beta_tester() IS
  'True hvis auth.uid() er admin ELLER users.is_beta_tester. Stable + SECURITY DEFINER, spejler is_admin().';

-- 3. Tre-tilstands feature-flags: "off" | "beta" | "on". Sikrer rækker findes (off).
--    Bagudkompat i koden: boolean true/false læses stadig som on/off, så eksisterende
--    rækker (hvis boolean) virker uændret; ejer sætter beta via UPDATE ... '"beta"'.
INSERT INTO public.app_config (key, value, description) VALUES
  ('academy_enabled',        '"off"'::jsonb, 'Akademi (#1308). off|beta|on. beta = beta-testere + admins.'),
  ('daily_training_enabled', '"off"'::jsonb, 'Daglig træning (#1305). off|beta|on.'),
  ('race_engine_v2_enabled', '"off"'::jsonb, 'Race engine v2 (#1102). off|beta|on.')
ON CONFLICT (key) DO NOTHING;
