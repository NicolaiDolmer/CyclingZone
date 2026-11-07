-- =============================================================================
-- 2026-11-07 · #7789 - roadmap-admin: kategori paa punkterne + stemme-raekker
-- til grafen
-- =============================================================================
-- Ejer 6/11: roadmap-admin skal virke som spoergeskema-panelet: en graf med
-- vigtighed mod idé-score pr. punkt, boble efter antal stemmere, samme graf pr.
-- kategori og filter paa aktive managere og division.
--
-- 1. roadmap_items.category: valgfri fritekst, som kun admin saetter, og som
--    kun admin-grafen viser. Omraadet (engine) er spillernes faste inddeling;
--    kategorien er ejerens egen, finere gruppering af de samme punkter. NULL =
--    ingen kategori, og grafen viser da punktet under dets omraade.
--    IKKE HEMMELIG: kolonnen kan laeses via PostgREST paa samme vilkaar som
--    titel og omraade (de eksisterende SELECT-policies + tabel-grants), fordi
--    den kun grupperer punkter der i forvejen er offentlige. Skriv aldrig noget
--    i kategorien, spillerne ikke maa se. Skal noget skjules, hoerer det i en
--    admin-beskyttet tabel, ikke her.
--
-- 2. roadmap_admin_vote_rows(): stemmerne som ét jsonb-objekt til grafens
--    filtre. Hvorfor ét objekt og ikke en tabel: PostgREST lofter antal
--    raekker pr. svar, og stemmerne er allerede flere end loftet. Hvorfor en
--    RPC og ikke viewet: division haenger paa holdet og aktivitet paa kontoen,
--    og begge tilhoerer ANDRE brugere end admin. Ingen user_id forlader
--    databasen: en stemmer er et loebenummer, som kun gaelder i dette svar.
--    "Aktiv" er samme vindue som spoergeskema-panelet (backend/lib/
--    surveyResults.js, ACTIVE_WINDOW_DAYS), saa de to flader betyder det samme.
--
-- Additiv + idempotent. Ingen eksisterende raekke aendres, viewet
-- roadmap_item_scores og RLS roeres ikke (tabel-grants daekker den nye kolonne,
-- tjekket read-only mod prod 7/11).
-- APPLY IKKE her: auto-migrate.yml applier post-merge (#2642).
--
-- Rollback (kun hvis noedvendigt):
--   DROP FUNCTION IF EXISTS public.roadmap_admin_vote_rows();
--   ALTER TABLE public.roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_category_check;
--   ALTER TABLE public.roadmap_items DROP COLUMN IF EXISTS category;

SET lock_timeout = '3s';
BEGIN;

-- 1. roadmap_items.category --------------------------------------------------
ALTER TABLE public.roadmap_items ADD COLUMN IF NOT EXISTS category TEXT;

-- En tom eller meget lang tekst er en tastefejl, ikke en kategori.
ALTER TABLE public.roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_category_check;
ALTER TABLE public.roadmap_items ADD CONSTRAINT roadmap_items_category_check
  CHECK (category IS NULL OR char_length(btrim(category)) BETWEEN 1 AND 40);

COMMENT ON COLUMN public.roadmap_items.category IS
  'Admins egen kategori til roadmap-grafen (#7789). NULL = punktet vises under sit omraade (engine).';

-- 2. roadmap_admin_vote_rows() -----------------------------------------------
-- voters: [[division, aktiv], ...] i loebenummer-orden.
-- votes:  [[item_id, loebenummer, vigtighed, idé], ...]; Ved ikke (#7788) har
--         begge tal NULL og tæller som svar, men ikke i snittene.
-- secdef-lint: allow roadmap_admin_vote_rows (backendens admin-route kalder den som service_role; gaten er auth.role() i kroppen)
CREATE OR REPLACE FUNCTION public.roadmap_admin_vote_rows()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH voters AS (
    SELECT v.user_id, (ROW_NUMBER() OVER (ORDER BY v.user_id) - 1)::int AS idx
    FROM (SELECT DISTINCT user_id FROM public.roadmap_votes) v
  ), team AS (
    -- Én manager har ét menneskehold i dag; DISTINCT ON holder svaret til én
    -- raekke pr. stemmer, hvis det en dag aendrer sig.
    SELECT DISTINCT ON (t.user_id) t.user_id, t.division
    FROM public.teams t
    WHERE t.user_id IS NOT NULL AND NOT t.is_ai
    ORDER BY t.user_id, t.created_at
  )
  SELECT jsonb_build_object(
    'voters', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(tm.division, COALESCE(u.last_seen > NOW() - INTERVAL '7 days', FALSE)) ORDER BY vo.idx)
      FROM voters vo
      LEFT JOIN team tm ON tm.user_id = vo.user_id
      LEFT JOIN public.users u ON u.id = vo.user_id
    ), '[]'::jsonb),
    'votes', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(v.item_id, vo.idx, v.importance_score, v.idea_score))
      FROM public.roadmap_votes v
      JOIN voters vo ON vo.user_id = v.user_id
    ), '[]'::jsonb)
  )
  WHERE auth.role() = 'service_role';
$$;
REVOKE ALL ON FUNCTION public.roadmap_admin_vote_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roadmap_admin_vote_rows() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Post-verify (read-only, koeres efter apply):
--   1. SELECT data_type, is_nullable FROM information_schema.columns
--        WHERE table_name = 'roadmap_items' AND column_name = 'category';      -- text, YES
--   2. SELECT conname FROM pg_constraint WHERE conname = 'roadmap_items_category_check';  -- 1 raekke
--   3. SELECT count(*) FROM roadmap_items WHERE category IS NOT NULL;          -- 0 lige efter apply
--   4. has_function_privilege('authenticated', 'public.roadmap_admin_vote_rows()', 'EXECUTE') = false
--   5. Som service_role: jsonb_array_length(roadmap_admin_vote_rows()->'votes')
--        = (SELECT count(*) FROM roadmap_votes).
