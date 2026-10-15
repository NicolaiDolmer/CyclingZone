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
