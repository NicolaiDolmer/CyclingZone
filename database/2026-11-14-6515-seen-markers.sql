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
-- tabel-grants; klienten laeser/skriver aldrig tabellen direkte. De to nye
-- funktioner er SECURITY INVOKER og kun kaldbare af service_role.
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT data_type, is_nullable, column_default FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'user_ui_prefs' AND column_name = 'seen_markers';
--      -- jsonb, NO, '{}'::jsonb
--   2. SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_ui_prefs'::regclass;  -- true
--   3. SELECT grantee, privilege_type FROM information_schema.role_table_grants
--       WHERE table_schema = 'public' AND table_name = 'user_ui_prefs';  -- kun service_role (+ postgres)
--   4. SELECT r, has_function_privilege(r, 'public.merge_seen_markers_6515(uuid,jsonb)', 'EXECUTE')
--       FROM unnest(ARRAY['anon','authenticated','service_role']) r;  -- false, false, true
--
-- Rollback: DROP FUNCTION IF EXISTS public.merge_seen_markers_6515(uuid, jsonb);
--           DROP FUNCTION IF EXISTS public.seen_markers_newest_6515(jsonb, jsonb);
--           ALTER TABLE public.user_ui_prefs DROP COLUMN IF EXISTS seen_markers;
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

-- Fletning pr. markør: den nyeste værdi vinder. Byte-orden (COLLATE "C"), så
-- sammenligningen er den samme som klientens og backendens strengsammenligning
-- i JavaScript; en sprog-sortering kunne vende rækkefølgen af to tidsstempler.
-- En ikke-streng i den gemte række tæller som fraværende.
CREATE OR REPLACE FUNCTION public.seen_markers_newest_6515(p_current jsonb, p_patch jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(p_current, '{}'::jsonb) || COALESCE((
    SELECT jsonb_object_agg(p.key, p.value)
    FROM jsonb_each(COALESCE(p_patch, '{}'::jsonb)) AS p(key, value)
    WHERE jsonb_typeof(p.value) = 'string'
      AND (jsonb_typeof(p_current -> p.key) IS DISTINCT FROM 'string'
           OR (p.value #>> '{}') COLLATE "C" > (p_current ->> p.key) COLLATE "C")
  ), '{}'::jsonb)
$$;

-- Atomisk skrivning (Codex-fund på PR #8169): før læste backenden rækken, flettede
-- i Node og skrev hele objektet tilbage, så to samtidige kald for samme bruger
-- kunne overskrive hinanden (fx patch notes og roadmap mod en tom række, eller en
-- ældre værdi oven i en nyere). Nu flettes der i én INSERT ... ON CONFLICT DO
-- UPDATE mod den aktuelle række; Postgres låser rækken, og det andet kald fletter
-- oven i det første. Intet skrives, når intet rykker frem. Returnerer rækkens
-- markører efter kaldet.
CREATE OR REPLACE FUNCTION public.merge_seen_markers_6515(p_user_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_markers jsonb;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'p_patch must be a json object' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_ui_prefs AS cur (user_id, seen_markers)
  VALUES (p_user_id, public.seen_markers_newest_6515('{}'::jsonb, p_patch))
  ON CONFLICT (user_id) DO UPDATE
    SET seen_markers = public.seen_markers_newest_6515(cur.seen_markers, EXCLUDED.seen_markers),
        updated_at = now()
    WHERE public.seen_markers_newest_6515(cur.seen_markers, EXCLUDED.seen_markers) IS DISTINCT FROM cur.seen_markers
  RETURNING cur.seen_markers INTO v_markers;

  IF v_markers IS NULL THEN
    -- Intet rykkede frem (rækken er låst af ON CONFLICT): læs den gemte tilstand.
    SELECT cur.seen_markers INTO v_markers FROM public.user_ui_prefs AS cur WHERE cur.user_id = p_user_id;
  END IF;
  RETURN COALESCE(v_markers, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.seen_markers_newest_6515(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seen_markers_newest_6515(jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.merge_seen_markers_6515(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_seen_markers_6515(uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
