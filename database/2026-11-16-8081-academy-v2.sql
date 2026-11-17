-- #8081 / #6944 (ejervalg 16/11): akademisiden udgave A bag kontakten academy_page_v2_8081,
-- og akademiets aldersfokus som fjerde felt i profilen.
--
-- 1. academy_intake_profiles.age_focus: NULL = Blandet, ellers '16' | '17' | '18' | '19'.
--    Samme raekke og samme effective_from som nationalitet og type (et ur for hele profilen).
--    Eksisterende raekker faar NULL (Blandet), hvilket er dagens adfaerd.
-- 2. save_academy_intake_profile_8081: soester til save_academy_intake_profile med et felt
--    mere. Den gamle funktion faar samme krop + bevarer seneste aldersfokus (se nederst).
-- 3. Kontakten academy_page_v2_8081 seedes "off". Taending er ejer-only, og foerst naar ugens
--    traek bruger aldersfokus (vaegtningen er IKKE bygget i #8081).
--
-- Additiv og idempotent: kolonne og CHECK kun hvis de mangler, CREATE OR REPLACE FUNCTION,
-- INSERT ... ON CONFLICT DO NOTHING. Koeres post-merge af auto-migrate (#2642).
SET lock_timeout = '3s';

ALTER TABLE public.academy_intake_profiles
  ADD COLUMN IF NOT EXISTS age_focus text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'academy_intake_profiles_age_focus_check'
       AND conrelid = 'public.academy_intake_profiles'::regclass
  ) THEN
    ALTER TABLE public.academy_intake_profiles
      ADD CONSTRAINT academy_intake_profiles_age_focus_check
      CHECK (age_focus IS NULL OR age_focus IN ('16', '17', '18', '19'));
  END IF;
END
$$;

COMMENT ON COLUMN public.academy_intake_profiles.age_focus IS
  '#8081/#6944: akademiets aldersfokus. NULL = Blandet. Virker fra raekkens effective_from som resten af profilen.';

-- Gem en ny ventende profil med aldersfokus atomisk: samme advisory-laas, oprydning og
-- indsaettelse som save_academy_intake_profile (2026-10-15-6666-academy-intake-profiles.sql).
BEGIN;
CREATE OR REPLACE FUNCTION public.save_academy_intake_profile_8081(
  p_team_id uuid,
  p_origins text[],
  p_rider_types text[],
  p_age_focus text,
  p_effective_from timestamptz,
  p_now timestamptz
) RETURNS bigint
  LANGUAGE plpgsql
  -- Forward-guard (#927, advisor 0011): search_path i SAMME statement.
  SET search_path = public, pg_catalog
  AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_team_id IS NULL OR p_effective_from IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'save_academy_intake_profile_8081: team, effective_from og now er paakraevet';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('academy_intake_profiles:' || p_team_id::text, 0));
  DELETE FROM public.academy_intake_profiles
   WHERE team_id = p_team_id
     AND effective_from > p_now;
  INSERT INTO public.academy_intake_profiles (team_id, origins, rider_types, age_focus, effective_from)
  VALUES (p_team_id, coalesce(p_origins, '{}'), coalesce(p_rider_types, '{}'), p_age_focus, p_effective_from)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ACL: service_role only. Oprettelse og REVOKE/GRANT i SAMME transaktion: en ny funktion har
-- EXECUTE for PUBLIC som default, saa den maa aldrig staa committet foer laasningen.
REVOKE ALL     ON FUNCTION public.save_academy_intake_profile_8081(uuid, text[], text[], text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_academy_intake_profile_8081(uuid, text[], text[], text, timestamptz, timestamptz) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.save_academy_intake_profile_8081(uuid, text[], text[], text, timestamptz, timestamptz) TO service_role;
COMMIT;

-- Den gamle gem-funktion (PUT /api/academy/profile, akademisiden foer udgave A) bevarer nu
-- holdets seneste aldersfokus i sin nye raekke i stedet for at nulstille det til Blandet
-- (Codex-fund paa PR #8271: falder siden tilbage til den gamle editor, maa et gem af
-- nationalitet/type ikke slette alderen). Samme signatur og samme laas; uden aldersfokus
-- (alle raekker NULL) er adfaerden praecis som foer. CREATE OR REPLACE bevarer ACL'en.
CREATE OR REPLACE FUNCTION public.save_academy_intake_profile(
  p_team_id uuid,
  p_origins text[],
  p_rider_types text[],
  p_effective_from timestamptz,
  p_now timestamptz
) RETURNS bigint
  LANGUAGE plpgsql
  -- Forward-guard (#927, advisor 0011): search_path i SAMME statement.
  SET search_path = public, pg_catalog
  AS $$
DECLARE
  v_id bigint;
  v_age_focus text;
BEGIN
  IF p_team_id IS NULL OR p_effective_from IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'save_academy_intake_profile: team, effective_from og now er paakraevet';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('academy_intake_profiles:' || p_team_id::text, 0));
  SELECT age_focus INTO v_age_focus
    FROM public.academy_intake_profiles
   WHERE team_id = p_team_id
   ORDER BY effective_from DESC, created_at DESC
   LIMIT 1;
  DELETE FROM public.academy_intake_profiles
   WHERE team_id = p_team_id
     AND effective_from > p_now;
  INSERT INTO public.academy_intake_profiles (team_id, origins, rider_types, age_focus, effective_from)
  VALUES (p_team_id, coalesce(p_origins, '{}'), coalesce(p_rider_types, '{}'), v_age_focus, p_effective_from)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

INSERT INTO public.app_config (key, value, description)
VALUES (
  'academy_page_v2_8081',
  '"off"'::jsonb,
  'Switch for the academy page, version A (#8081): overview + tabs (This week''s intake, Your talents, Profile and age) and the age focus in the academy profile. off = the academy page as before. Do not turn on before the weekly intake uses the age focus. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;
