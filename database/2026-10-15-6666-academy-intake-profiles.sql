-- #6666: akademiets profil (nationalitet/region + ryttertype), D-039 + ejer-
-- beslutning 15/10 punkt 4-5. Hver aendring er en ny raekke med effective_from =
-- gemt + 14 dage; den aktive profil er den nyeste raekke hvis effective_from er
-- passeret. Backend (service role) laeser og skriver; ingen klient-adgang.
-- Additiv og idempotent: ny tabel, intet eksisterende roeres.
-- data-api-access: {"table":"public.academy_intake_profiles","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","DELETE"]},"sequences":{"public.academy_intake_profiles_id_seq":{"anon":[],"authenticated":[],"service_role":["USAGE","SELECT"]}},"reason":"Backend reads the academy profile for GET /api/academy/me and the weekly pull, and writes it via PUT /api/academy/profile; clients never read it directly"}
SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.academy_intake_profiles (
  id bigserial PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  origins text[] NOT NULL DEFAULT '{}',
  rider_types text[] NOT NULL DEFAULT '{}',
  effective_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS academy_intake_profiles_team_effective_idx
  ON public.academy_intake_profiles (team_id, effective_from DESC);

ALTER TABLE public.academy_intake_profiles ENABLE ROW LEVEL SECURITY;

-- Service-role-only: ingen policies, ingen klient-grants. REVOKE+GRANT i een
-- transaktion, saa service_role aldrig staar uden adgang mellem de to.
BEGIN;
REVOKE ALL ON TABLE public.academy_intake_profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.academy_intake_profiles TO service_role;
REVOKE ALL ON SEQUENCE public.academy_intake_profiles_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.academy_intake_profiles_id_seq TO service_role;
COMMIT;

COMMENT ON TABLE public.academy_intake_profiles IS
  '#6666: akademiets oenskede profil pr. hold. origins = ISO2 eller region:<noegle>; rider_types = arketype-noegler. Virker fra effective_from (gemt + 14 dage). Service-role-only.';

-- Gem en ny ventende profil atomisk (Codex-fund paa PR #6673). Uden en
-- serialisering kunne to samtidige PUT /api/academy/profile for samme hold
-- (fx to faner) hver indsaette sin raekke og derefter slette den andens, saa
-- ingen ventende profil stod tilbage. Her sker oprydning og indsaettelse i een
-- transaktion bag en advisory-laas pr. hold: den sidst gemte vinder, og fejler
-- indsaettelsen, rulles sletningen tilbage (det tidligere valg gaar aldrig tabt).
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
BEGIN
  IF p_team_id IS NULL OR p_effective_from IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'save_academy_intake_profile: team, effective_from og now er paakraevet';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('academy_intake_profiles:' || p_team_id::text, 0));
  DELETE FROM public.academy_intake_profiles
   WHERE team_id = p_team_id
     AND effective_from > p_now;
  INSERT INTO public.academy_intake_profiles (team_id, origins, rider_types, effective_from)
  VALUES (p_team_id, coalesce(p_origins, '{}'), coalesce(p_rider_types, '{}'), p_effective_from)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ACL: service_role only, samme moenster som demote_rider_to_academy.
REVOKE ALL     ON FUNCTION public.save_academy_intake_profile(uuid, text[], text[], timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_academy_intake_profile(uuid, text[], text[], timestamptz, timestamptz) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.save_academy_intake_profile(uuid, text[], text[], timestamptz, timestamptz) TO service_role;
