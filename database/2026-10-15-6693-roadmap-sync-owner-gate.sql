-- =============================================================================
-- 2026-10-15 · #6693 - ejer-gate paa auto-oprettede roadmap-punkter
-- =============================================================================
-- scripts/roadmap-sync-registry.mjs opretter roadmap_items ud fra
-- docs/FEATURE_REGISTRY.yml. Punkterne oprettes SKJULT (approved = false) med
-- markeringen publish_on_beta = true. De bliver synlige foerst naar kontakten
-- (app_config.<flag_key>) staar paa beta eller on. Flag-flips er ejer-only, saa
-- ejeren ser punktets tekst ved flip-go.
--
-- Hvorfor en ny trigger og ikke sync-scriptet: sync koerer kun efter merge til
-- main, mens et flag-flip sker i databasen uden noget push. Et punkt ville saa
-- forblive skjult til naeste registerrettelse. Triggeren nedenfor reagerer i
-- samme transaktion som flippet.
--
-- Hvorfor en ny trigger og ikke en udvidelse af de eksisterende funktioner:
-- de tre eksisterende (roadmap_items_sync_flag, app_config_sync_roadmap,
-- roadmap_resync_flags fra 2026-10-05-5387-roadmap-hub.sql) roeres ikke. Den
-- nye BEFORE-trigger paa roadmap_items fyrer naar de flytter punktets status
-- (flip, oprettelse paa et flag der allerede er beta, drift-afstemning), og
-- fyrer efter roadmap_items_sync_flag (triggere fyrer i navneorden), saa den
-- ser den status den trigger lige har sat. Et flip kan stadig ikke vaeltes:
-- app_config_sync_roadmap fanger alle fejl fra sin UPDATE, ogsaa fra denne
-- trigger.
--
-- Ejerens redigering vinder: retter nogen titel, approved eller flag_key, eller
-- arkiverer punktet, mens markeringen stadig staar, fjernes markeringen, og
-- triggeren roerer aldrig punktet igen. sort_order/horizon/issue_ref er ikke
-- redigering i den forstand (admin-fanen flytter punkter op og ned).
--
-- Unikt flag_key: sync er idempotent paa flag_key; det unikke partielle indeks
-- goer det til en garanti. Maalt read-only mod prod 15/10: 0 dubletter.
-- CONCURRENTLY, saa filen maa IKKE pakkes i en transaktion (auto-migrate koerer
-- `psql -f` uden BEGIN).
--
-- Additiv + idempotent. Ingen data flyttes eller slettes.
-- APPLY IKKE her: auto-migrate.yml applier post-merge (#2642).
-- =============================================================================

SET lock_timeout = '3s';

-- 1. Markering --------------------------------------------------------------
ALTER TABLE public.roadmap_items ADD COLUMN IF NOT EXISTS publish_on_beta BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.roadmap_items.publish_on_beta IS
  'Sat af scripts/roadmap-sync-registry.mjs (#6693): punktet er skjult og bliver approved, naar kontakten (flag_key) gaar i beta eller on. Fjernes ved publicering og naar ejeren redigerer titel/approved/flag_key eller arkiverer.';

-- 2. Publicering ved beta/on -------------------------------------------------
CREATE OR REPLACE FUNCTION public.roadmap_items_publish_on_beta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_stage TEXT;
BEGIN
  IF NOT NEW.publish_on_beta THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (
       NEW.title_en IS DISTINCT FROM OLD.title_en
    OR NEW.title_da IS DISTINCT FROM OLD.title_da
    OR NEW.approved IS DISTINCT FROM OLD.approved
    OR NEW.flag_key IS DISTINCT FROM OLD.flag_key
    OR (NEW.status = 'archived' AND OLD.status IS DISTINCT FROM 'archived')
  ) THEN
    NEW.publish_on_beta := FALSE;
    RETURN NEW;
  END IF;
  IF NEW.flag_key IS NULL OR NEW.status = 'archived' THEN
    RETURN NEW;
  END IF;
  SELECT value #>> '{}' INTO v_stage FROM public.app_config WHERE key = NEW.flag_key;
  IF v_stage IN ('beta', 'on', 'true') THEN
    NEW.approved := TRUE;
    NEW.publish_on_beta := FALSE;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.roadmap_items_publish_on_beta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS roadmap_items_sync_publish ON public.roadmap_items;
CREATE TRIGGER roadmap_items_sync_publish
  BEFORE INSERT OR UPDATE ON public.roadmap_items
  FOR EACH ROW EXECUTE FUNCTION public.roadmap_items_publish_on_beta();

-- 3. Unikt flag_key ----------------------------------------------------------
-- Et afbrudt CONCURRENTLY-byg efterlader et INVALID indeks, som IF NOT EXISTS
-- ellers ville springe tavst over. Vagten fejler hoejlydt i stedet. En dublet
-- fejler ogsaa hoejlydt, med navnet paa noeglen.
DO $$
DECLARE
  v_dup TEXT;
  v_bad TEXT;
BEGIN
  SELECT string_agg(flag_key, ', ') INTO v_dup FROM (
    SELECT flag_key FROM public.roadmap_items
    WHERE flag_key IS NOT NULL GROUP BY flag_key HAVING count(*) > 1
  ) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'roadmap_items har flere punkter paa samme flag_key: %. Ret dem i admin-fanen og genkoer migrationen.', v_dup;
  END IF;
  SELECT c.relname INTO v_bad
  FROM pg_class c
  JOIN pg_index i ON i.indexrelid = c.oid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'roadmap_items_flag_key_uniq' AND NOT i.indisvalid;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID indeks fra et afbrudt byg: %. DROP INDEX CONCURRENTLY public.roadmap_items_flag_key_uniq og genkoer migrationen.', v_bad;
  END IF;
END $$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS roadmap_items_flag_key_uniq
  ON public.roadmap_items (flag_key) WHERE flag_key IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- Post-verify (read-only, koeres efter apply):
--   1. SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
--        WHERE table_name = 'roadmap_items' AND column_name = 'publish_on_beta';  -- boolean, NO, false
--   2. SELECT count(*) FROM roadmap_items WHERE publish_on_beta;                  -- 0 (intet er synket endnu)
--   3. SELECT tgname FROM pg_trigger WHERE tgrelid = 'roadmap_items'::regclass AND NOT tgisinternal;
--        -- roadmap_items_sync_flag + roadmap_items_sync_publish
--   4. SELECT i.indisvalid, i.indisunique FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
--        WHERE c.relname = 'roadmap_items_flag_key_uniq';                         -- true, true
--   5. has_function_privilege('authenticated', 'public.roadmap_items_publish_on_beta()', 'EXECUTE') = false
--   6. SELECT status, approved, count(*) FROM roadmap_items GROUP BY 1, 2;       -- uaendret ift. foer apply
--   Roer ALDRIG en rigtig kontakt i prod for at teste (ejer-only); triggeren er
--   daekket af backend/lib/testdb/roadmapSyncOwnerGate.integration.test.js.
--
-- Rollback: staar med vilje ikke som SQL her (auto-migrate koerer database/2026-*.sql).
-- Skal det fjernes: et manuelt, ejer-gated script i database/manual/ der dropper
-- triggeren roadmap_items_sync_publish og dens funktion. Kolonnen og indekset er
-- bagudkompatible og kan blive staaende.
