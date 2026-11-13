-- #7778 · Visningsvalg gemt på brugeren (fx "Skjul rute" på løbssiden).
--
-- Ejer 12/11 (valg 6): valget huskes på brugeren, på tværs af etaper, sider og
-- enheder. Repoet havde intet sted til den slags (users har kun discord_dm_prefs,
-- email_prefs og consent_preferences, som hver har sit eget formål), så dette er
-- den mindste additive løsning: én række pr. bruger med et jsonb-objekt.
--
-- Kun backenden læser og skriver (GET/PUT /api/me/ui-prefs), og kun nøgler på
-- serverens allowlist (backend/lib/userUiPrefs.js) kan gemmes. Klientens
-- localStorage er kun en hurtig kopi; denne tabel er sandheden.
--
-- ADDITIV OG IDEMPOTENT. Applies post-merge af auto-migrate.yml (#2642).
-- DEPLOY-RAEKKEFOELGE: backend kan naa prod foer migrationen; GET svarer da {}
-- og PUT svarer 503 uden at vaelte siden (42P01/PGRST205 haandteres).
--
-- RLS: enabled, INGEN policy, kun service_role. Klienten laeser/skriver aldrig
-- tabellen direkte.
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_ui_prefs'::regclass;  -- true
--   2. SELECT grantee, privilege_type FROM information_schema.role_table_grants
--       WHERE table_schema = 'public' AND table_name = 'user_ui_prefs';  -- kun service_role (+ postgres)
--
-- Rollback: DROP TABLE IF EXISTS public.user_ui_prefs;
--
-- Refs #7778
-- data-api-access: {"table":"public.user_ui_prefs","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Per-user display choices; only the backend /api/me/ui-prefs route reads and writes them"}

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.user_ui_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_ui_prefs_prefs_is_object CHECK (jsonb_typeof(prefs) = 'object')
);

ALTER TABLE public.user_ui_prefs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_ui_prefs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_ui_prefs TO service_role;

COMMENT ON TABLE public.user_ui_prefs IS
  '#7778: per-user display choices (allowlisted keys in backend/lib/userUiPrefs.js), '
  'e.g. race_route_hidden. service_role only; the client keeps a fast local copy.';

NOTIFY pgrst, 'reload schema';

COMMIT;
