-- #6515 · "Har set patch notes / roadmap" gemt på brugeren, ikke på enheden.
--
-- Før huskede kun browseren, hvornår spilleren sidst så patch notes og roadmap,
-- så en note læst på telefonen gav stadig en gul prik på computeren.
--
-- Genbruger brugerens række til små visningsvalg (public.user_ui_prefs, #7778)
-- i stedet for en ny tabel: én ny jsonb-kolonne, seen_markers. Egen kolonne og
-- ikke en nøgle i prefs, fordi /api/me/ui-prefs skriver prefs om med kun sine
-- egne kendte nøgler, og fordi en markør kun må rykke frem (nyeste vinder),
-- hvor et visningsvalg er "sidste valg vinder".
--
-- Kun backenden læser og skriver (GET/PUT /api/me/seen-markers), og kun de
-- markører backend/lib/seenMarkers6515.js kender. Hver bruger rører kun sin egen
-- række (backenden skriver altid med den indloggedes user_id). Klientens
-- localStorage er hurtig første visning og faldvej.
--
-- ADDITIV OG IDEMPOTENT. Applies post-merge af auto-migrate.yml (#2642), efter
-- 2026-11-12-7778-user-ui-prefs.sql (filnavne køres i rækkefølge).
-- DEPLOY-RAEKKEFOELGE: backend kan naa prod foer migrationen; GET svarer da
-- { available: false } og PUT 503, og klienten bruger sin lokale kopi som i dag
-- (42703/PGRST204 haandteres).
--
-- RLS: uaendret fra #7778 (enabled, INGEN policy, kun service_role). Ingen nye
-- grants; klienten laeser/skriver aldrig tabellen direkte.
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT data_type, is_nullable, column_default FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'user_ui_prefs' AND column_name = 'seen_markers';
--      -- jsonb, NO, '{}'::jsonb
--   2. SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_ui_prefs'::regclass;  -- true
--   3. SELECT grantee, privilege_type FROM information_schema.role_table_grants
--       WHERE table_schema = 'public' AND table_name = 'user_ui_prefs';  -- kun service_role (+ postgres)
--
-- Rollback: ALTER TABLE public.user_ui_prefs DROP COLUMN IF EXISTS seen_markers;
--
-- Refs #6515
-- data-api-access: {"table":"public.user_ui_prefs","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Per-user display choices and seen markers; only the backend /api/me/ui-prefs and /api/me/seen-markers routes read and write them"}

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.user_ui_prefs
  ADD COLUMN IF NOT EXISTS seen_markers jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_ui_prefs_seen_markers_is_object'
      AND conrelid = 'public.user_ui_prefs'::regclass
  ) THEN
    ALTER TABLE public.user_ui_prefs
      ADD CONSTRAINT user_ui_prefs_seen_markers_is_object CHECK (jsonb_typeof(seen_markers) = 'object');
  END IF;
END
$$;

COMMENT ON COLUMN public.user_ui_prefs.seen_markers IS
  '#6515: when the user last saw patch notes / roadmap (keys in backend/lib/seenMarkers6515.js). '
  'Markers only move forward; the client keeps a fast local copy.';

NOTIFY pgrst, 'reload schema';

COMMIT;
