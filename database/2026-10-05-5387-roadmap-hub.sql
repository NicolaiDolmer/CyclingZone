-- Roadmap-hub (#5387, #5388, spor 1 = #6149): plan/idé-opdeling, kendte fejl,
-- admin-tal, del punkt og beta-koblingen til app_config.
-- Spec: docs/superpowers/specs/2026-10-04-roadmap-hub-design.md §5.
-- Plan: docs/superpowers/plans/2026-10-04-roadmap-hub.md, spor 1.
--
-- Additiv + idempotent. Ingen data flyttes eller slettes, ingen stemmer ændres.
-- 'active' beholder sin betydning (idé åben for afstemning), så den nuværende
-- klient virker uændret mellem apply og frontend-deploy.
-- APPLY IKKE her: auto-migrate.yml applier post-merge (#2642).
--
-- Pre-check (read-only mod prod 4/10):
--   - status-CHECK hedder roadmap_items_status_check (active, shipped, archived).
--   - app_config.value er JSONB; stadie-flag er JSON-strenge ("off"/"beta"/"on"),
--     ældre flag er JSON-booleans. Triggerne læser derfor value #>> '{}'.
--   - Ingen eksisterende triggere på roadmap_items, roadmap_votes eller app_config.
--   - Grant-mønster for nye tabeller (efter #2830-cutover får nye tabeller kun
--     SELECT som default): skrive-grants gives eksplicit, som i
--     2026-09-08-4943-survey-grants-hotfix.sql. RLS afgør resten.
--   - Policies bruger (select auth.uid()) (initplan-mønstret fra
--     2026-06-16-rls-initplan-and-hot-indexes.sql).
--   - anon har ikke EXECUTE på is_admin() (#5153), så anon-policies kalder den ikke.
--
-- Rollback: se note i bunden af filen.

-- 1. roadmap_items ---------------------------------------------------------
ALTER TABLE roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_status_check;
ALTER TABLE roadmap_items ADD CONSTRAINT roadmap_items_status_check
  CHECK (status IN ('active', 'planned', 'in_progress', 'shipped', 'archived'));

ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS horizon TEXT NOT NULL DEFAULT 'next';
ALTER TABLE roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_horizon_check;
ALTER TABLE roadmap_items ADD CONSTRAINT roadmap_items_horizon_check
  CHECK (horizon IN ('next', 'later'));

ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS issue_ref INTEGER;

-- Beta-kobling (§5.6): flag_key er en nøgle i app_config.
ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS flag_key TEXT;
ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS beta_since TIMESTAMPTZ;
ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS beta_soon BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS live_soon BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS roadmap_items_flag_key_idx ON roadmap_items (flag_key) WHERE flag_key IS NOT NULL;

DROP POLICY IF EXISTS "Authenticated can read approved roadmap items" ON roadmap_items;
CREATE POLICY "Authenticated can read approved roadmap items"
  ON roadmap_items FOR SELECT TO authenticated
  USING ((approved AND status IN ('active', 'planned', 'in_progress', 'shipped')) OR public.is_admin());

DROP POLICY IF EXISTS "Anon can read approved roadmap items" ON roadmap_items;
CREATE POLICY "Anon can read approved roadmap items"
  ON roadmap_items FOR SELECT TO anon
  USING (approved AND status IN ('active', 'planned', 'in_progress', 'shipped'));

-- 2. roadmap_votes ---------------------------------------------------------
-- Planlagte punkter har kun vigtighed. Idéer (active) kræver fortsat begge tal.
-- Stemmer på punkter i gang, færdige eller arkiverede er låst og bevaret.
ALTER TABLE roadmap_votes ALTER COLUMN idea_score DROP NOT NULL;

DROP POLICY IF EXISTS "Users can insert own roadmap votes" ON roadmap_votes;
CREATE POLICY "Users can insert own roadmap votes"
  ON roadmap_votes FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM roadmap_items i
      WHERE i.id = roadmap_votes.item_id
        AND i.approved
        AND (i.status = 'planned' OR (i.status = 'active' AND roadmap_votes.idea_score IS NOT NULL))
    )
  );

-- USING er filteret på den GAMLE række: en stemme på et låst punkt (in_progress,
-- shipped, archived) kan hverken ændres eller flyttes. WITH CHECK validerer den nye.
DROP POLICY IF EXISTS "Users can update own roadmap votes" ON roadmap_votes;
CREATE POLICY "Users can update own roadmap votes"
  ON roadmap_votes FOR UPDATE TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM roadmap_items i
      WHERE i.id = roadmap_votes.item_id
        AND i.approved
        AND i.status IN ('active', 'planned')
    )
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM roadmap_items i
      WHERE i.id = roadmap_votes.item_id
        AND i.approved
        AND (i.status = 'planned' OR (i.status = 'active' AND roadmap_votes.idea_score IS NOT NULL))
    )
  );

-- En stemmes identitet (item_id, user_id) er fast: den kan ikke flyttes til et
-- andet punkt eller en anden bruger. Trigger frem for kolonne-grant, fordi
-- PostgREST-upsert (onConflict: user_id,item_id) sender item_id/user_id med i
-- SET med samme værdi; det skal fortsat virke.
CREATE OR REPLACE FUNCTION public.roadmap_votes_lock_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'roadmap vote item_id/user_id cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.roadmap_votes_lock_identity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS roadmap_votes_lock_identity ON roadmap_votes;
CREATE TRIGGER roadmap_votes_lock_identity
  BEFORE UPDATE ON roadmap_votes
  FOR EACH ROW EXECUTE FUNCTION public.roadmap_votes_lock_identity();

-- 3. roadmap_item_scores: formlen er uændret, nye kolonner tilføjes SIDST
--    (CREATE OR REPLACE VIEW må kun tilføje kolonner i enden).
--    idea_votes = antal stemmer med idea_score (planlagte punkter har kun vigtighed).
CREATE OR REPLACE VIEW roadmap_item_scores
  WITH (security_invoker = true) AS
SELECT
  i.id AS item_id,
  i.engine,
  i.title_en,
  i.approved,
  i.status,
  COUNT(v.id) AS votes,
  ROUND(AVG(v.idea_score)::numeric, 2) AS avg_idea,
  ROUND(AVG(v.importance_score)::numeric, 2) AS avg_importance,
  ROUND(((AVG(v.importance_score) * 0.6 + AVG(v.idea_score) * 0.4) * sqrt(COUNT(v.id)))::numeric, 2) AS steering_score,
  i.title_da,
  i.sort_order,
  i.horizon,
  i.issue_ref,
  COUNT(v.idea_score) AS idea_votes,
  ROUND(STDDEV_SAMP(v.importance_score)::numeric, 2) AS sd_importance
FROM roadmap_items i
LEFT JOIN roadmap_votes v ON v.item_id = i.id
GROUP BY i.id, i.engine, i.title_en, i.approved, i.status, i.title_da, i.sort_order, i.horizon, i.issue_ref;

-- 4. Kendte fejl -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS known_issues (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area        TEXT NOT NULL CHECK (area IN ('races', 'training', 'youth', 'market', 'club', 'other')),
  status      TEXT NOT NULL DEFAULT 'checking' CHECK (status IN ('checking', 'confirmed', 'fixing', 'fixed', 'dismissed')),
  title_en    TEXT NOT NULL,
  title_da    TEXT NOT NULL,
  published   BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  issue_ref   INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS known_issue_updates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id    UUID NOT NULL REFERENCES known_issues(id) ON DELETE CASCADE,
  body_en     TEXT NOT NULL,
  body_da     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS known_issue_updates_issue_idx
  ON known_issue_updates (issue_id, created_at DESC);

CREATE TABLE IF NOT EXISTS known_issue_reports (
  issue_id    UUID NOT NULL REFERENCES known_issues(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX IF NOT EXISTS known_issue_reports_user_idx ON known_issue_reports (user_id);

ALTER TABLE known_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE known_issue_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE known_issue_reports ENABLE ROW LEVEL SECURITY;

-- Tabel-grants (efter #2830 får nye tabeller kun SELECT som default; uden
-- disse rammer en skrivning 42501 før RLS overhovedet evalueres, jf. #4943).
-- Ingen DELETE på known_issues/known_issue_updates: fejl lukkes via status.
-- Én tabel pr. linje (scripts/lint-sql-policy-grants.mjs læser kun den form).
GRANT SELECT ON public.known_issues TO anon;
GRANT SELECT ON public.known_issue_updates TO anon;
GRANT SELECT, INSERT, UPDATE ON public.known_issues TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.known_issue_updates TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.known_issue_reports TO authenticated;
REVOKE ALL ON public.known_issue_reports FROM anon;

-- To læse-policies pr. tabel, som roadmap_items: anon har ikke EXECUTE på
-- is_admin() (#5153), så anon-policyen må ikke kalde den.
DROP POLICY IF EXISTS "Anon can read published known issues" ON known_issues;
CREATE POLICY "Anon can read published known issues"
  ON known_issues FOR SELECT TO anon
  USING (published);

DROP POLICY IF EXISTS "Authenticated can read published known issues" ON known_issues;
CREATE POLICY "Authenticated can read published known issues"
  ON known_issues FOR SELECT TO authenticated
  USING (published OR public.is_admin());

DROP POLICY IF EXISTS "Admins can insert known issues" ON known_issues;
CREATE POLICY "Admins can insert known issues"
  ON known_issues FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update known issues" ON known_issues;
CREATE POLICY "Admins can update known issues"
  ON known_issues FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Anon can read updates on published known issues" ON known_issue_updates;
CREATE POLICY "Anon can read updates on published known issues"
  ON known_issue_updates FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM known_issues k WHERE k.id = known_issue_updates.issue_id AND k.published));

DROP POLICY IF EXISTS "Authenticated can read updates on published known issues" ON known_issue_updates;
CREATE POLICY "Authenticated can read updates on published known issues"
  ON known_issue_updates FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM known_issues k WHERE k.id = known_issue_updates.issue_id AND k.published)
  );

DROP POLICY IF EXISTS "Admins can insert known issue updates" ON known_issue_updates;
CREATE POLICY "Admins can insert known issue updates"
  ON known_issue_updates FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update known issue updates" ON known_issue_updates;
CREATE POLICY "Admins can update known issue updates"
  ON known_issue_updates FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- §5.4: spilleren læser, opretter og sletter kun egne reports, og kun på
-- publicerede fejl der hverken er rettet eller lukket. Lukkes eller afpubliceres
-- fejlen, fryses optællingen: spilleren kan ikke længere se eller slette sit
-- report. Admin læser alt.
DROP POLICY IF EXISTS "Users can read own known issue reports" ON known_issue_reports;
CREATE POLICY "Users can read own known issue reports"
  ON known_issue_reports FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      (select auth.uid()) = user_id
      AND EXISTS (
        SELECT 1 FROM known_issues k
        WHERE k.id = known_issue_reports.issue_id AND k.published AND k.status NOT IN ('fixed', 'dismissed')
      )
    )
  );

DROP POLICY IF EXISTS "Users can insert own known issue reports" ON known_issue_reports;
CREATE POLICY "Users can insert own known issue reports"
  ON known_issue_reports FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM known_issues k
      WHERE k.id = known_issue_reports.issue_id AND k.published AND k.status NOT IN ('fixed', 'dismissed')
    )
  );

DROP POLICY IF EXISTS "Users can delete own known issue reports" ON known_issue_reports;
CREATE POLICY "Users can delete own known issue reports"
  ON known_issue_reports FOR DELETE TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM known_issues k
      WHERE k.id = known_issue_reports.issue_id AND k.published AND k.status NOT IN ('fixed', 'dismissed')
    )
  );

-- security_invoker: en spiller tæller kun egne reports; admin ser det fulde tal.
CREATE OR REPLACE VIEW known_issue_scores
  WITH (security_invoker = true) AS
SELECT
  k.id AS issue_id,
  k.area,
  k.status,
  k.title_en,
  k.title_da,
  k.published,
  k.sort_order,
  k.issue_ref,
  k.created_at,
  k.closed_at,
  COUNT(r.user_id) AS reports,
  GREATEST(0, EXTRACT(DAY FROM (COALESCE(k.closed_at, NOW()) - k.created_at)))::int AS days_open
FROM known_issues k
LEFT JOIN known_issue_reports r ON r.issue_id = k.id
GROUP BY k.id;
-- Admin-kontrakt via authenticated. anon har ingen adgang til known_issue_reports,
-- så et anon-grant her ville kun give 42501; det fjernes eksplicit (også et
-- eventuelt default-grant fra ALTER DEFAULT PRIVILEGES).
REVOKE ALL ON public.known_issue_scores FROM anon;
GRANT SELECT ON public.known_issue_scores TO authenticated;

-- 5. Admin-nøgletal i ét kald (§5.7) --------------------------------------
-- Nul rækker for alle andre end admin. DEFINER, så tallene ikke afhænger af
-- kalderens RLS på roadmap_votes; gaten er is_admin() i WHERE.
-- secdef-lint: allow roadmap_admin_stats (admin-fanen kalder den som RPC; gaten er is_admin() i kroppen)
CREATE OR REPLACE FUNCTION public.roadmap_admin_stats()
RETURNS TABLE (voters integer, voters_14d integer, votes_total integer, voted_all integer, managed_teams integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH votable AS (
    SELECT id FROM public.roadmap_items WHERE approved AND status IN ('active', 'planned')
  ), per_user AS (
    SELECT v.user_id, COUNT(*) AS n
    FROM public.roadmap_votes v JOIN votable a ON a.id = v.item_id
    GROUP BY v.user_id
  )
  SELECT
    (SELECT COUNT(DISTINCT user_id) FROM public.roadmap_votes)::int,
    (SELECT COUNT(DISTINCT user_id) FROM public.roadmap_votes WHERE updated_at > NOW() - INTERVAL '14 days')::int,
    (SELECT COUNT(*) FROM public.roadmap_votes)::int,
    (SELECT COUNT(*) FROM per_user WHERE n = (SELECT COUNT(*) FROM votable))::int,
    (SELECT COUNT(*) FROM public.teams WHERE user_id IS NOT NULL)::int
  WHERE public.is_admin();
$$;
REVOKE ALL ON FUNCTION public.roadmap_admin_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roadmap_admin_stats() TO authenticated;

-- 6. Del punkt (§5.5, ejer 4/10): resten af et delvist leveret punkt bliver et
--    nyt punkt, og stemmerne kopieres, så de står på begge. Det nye punkt er
--    skjult (approved = false), til ejeren har godkendt teksten. Kilden røres ikke.
-- secdef-lint: allow roadmap_split_item (admin-fanen kalder den som RPC; afviser alle andre end admin med 42501)
CREATE OR REPLACE FUNCTION public.roadmap_split_item(
  p_source UUID, p_title_en TEXT, p_title_da TEXT,
  p_status TEXT DEFAULT 'planned', p_horizon TEXT DEFAULT 'next', p_issue_ref INTEGER DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_src public.roadmap_items%ROWTYPE;
  v_new UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF btrim(coalesce(p_title_en, '')) = '' OR btrim(coalesce(p_title_da, '')) = '' THEN
    RAISE EXCEPTION 'both titles are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_src FROM public.roadmap_items WHERE id = p_source;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source item not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.roadmap_items (engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref)
  VALUES (v_src.engine, v_src.sort_order, btrim(p_title_en), btrim(p_title_da), FALSE,
          coalesce(p_status, 'planned'), coalesce(p_horizon, 'next'), p_issue_ref)
  RETURNING id INTO v_new;
  INSERT INTO public.roadmap_votes (item_id, user_id, idea_score, importance_score, created_at, updated_at)
  SELECT v_new, user_id, idea_score, importance_score, created_at, updated_at
  FROM public.roadmap_votes WHERE item_id = p_source;
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.roadmap_split_item(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roadmap_split_item(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;

-- 7. Beta-kobling (§5.6, ejer 4/10): Beta-fanen følger kontakterne automatisk.
--    SIKKERHEDSKRAV: et flag-flip må ALDRIG kunne fejle eller hænge pga. roadmappet.
--    Triggeren på app_config:
--      - venter aldrig på rækkelåse: den opdaterer kun koblede punkter, der kan
--        låses med det samme (FOR UPDATE SKIP LOCKED);
--      - sætter et kort, funktionslokalt lock_timeout (200ms) inde i sin
--        beskyttede blok, så en tabel-lås på roadmap_items heller ikke kan holde
--        flippet; 55P03 fanges, og kalderens lock_timeout sættes tilbage, også i
--        fejlstien;
--      - fanger alle øvrige fejl i sin egen blok, logger en advarsel og skriver
--        kun i roadmap_items.
--    Det er bevidst best-effort: et punkt, der var låst under flippet, springes
--    over og står ude af takt. public.roadmap_resync_flags() (admin eller
--    service_role) bringer idempotent alle koblede punkter i takt med app_config
--    igen; den køres af scripts/roadmap-drift.mjs eller af admin ved drift.
--    Bevidst IKKE fanget: query_canceled (57014, fx statement_timeout eller en
--    brugers egen afbrydelse). Uden låse-ventetid er triggerens arbejde en
--    indekseret UPDATE af få rækker, så den rammer ikke et 8s-budget.
--    Stadie læses som value #>> '{}': JSON-strengen "beta" -> 'beta', JSON-
--    booleanen true -> 'true'. 'true' tæller som on (ældre boolean-flag).

-- Når et punkt kobles (eller oprettes koblet): læs kontaktens stadie nu.
CREATE OR REPLACE FUNCTION public.roadmap_items_sync_flag() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_stage TEXT;
BEGIN
  IF NEW.flag_key IS NULL OR NEW.status IN ('shipped', 'archived') THEN
    RETURN NEW;
  END IF;
  SELECT value #>> '{}' INTO v_stage FROM public.app_config WHERE key = NEW.flag_key;
  IF v_stage = 'beta' THEN
    NEW.status := 'in_progress';
    NEW.beta_since := COALESCE(NEW.beta_since, NOW());
    NEW.beta_soon := FALSE;
  ELSIF v_stage IN ('on', 'true') THEN
    NEW.status := 'shipped';
    NEW.shipped_at := COALESCE(NEW.shipped_at, NOW());
    NEW.beta_soon := FALSE;
    NEW.live_soon := FALSE;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.roadmap_items_sync_flag() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS roadmap_items_sync_flag ON roadmap_items;
CREATE TRIGGER roadmap_items_sync_flag
  BEFORE INSERT OR UPDATE OF flag_key ON roadmap_items
  FOR EACH ROW EXECUTE FUNCTION public.roadmap_items_sync_flag();

-- Når en kontakt flippes: flyt de koblede punkter. Fejl eller låse her må aldrig
-- vælte eller holde flippet (se kommentaren over).
CREATE OR REPLACE FUNCTION public.app_config_sync_roadmap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_stage TEXT;
  v_lock_timeout TEXT := current_setting('lock_timeout');
BEGIN
  BEGIN
    PERFORM set_config('lock_timeout', '200ms', true);
    v_stage := NEW.value #>> '{}';
    IF v_stage = 'beta' THEN
      UPDATE public.roadmap_items
        SET status = 'in_progress', beta_since = COALESCE(beta_since, NOW()), beta_soon = FALSE, updated_at = NOW()
        WHERE id IN (
          SELECT id FROM public.roadmap_items
          WHERE flag_key = NEW.key AND status NOT IN ('shipped', 'archived')
          FOR UPDATE SKIP LOCKED
        );
    ELSIF v_stage IN ('on', 'true') THEN
      UPDATE public.roadmap_items
        SET status = 'shipped', shipped_at = COALESCE(shipped_at, NOW()), beta_soon = FALSE, live_soon = FALSE, updated_at = NOW()
        WHERE id IN (
          SELECT id FROM public.roadmap_items
          WHERE flag_key = NEW.key AND status NOT IN ('shipped', 'archived')
          FOR UPDATE SKIP LOCKED
        );
    ELSIF v_stage IN ('off', 'false') THEN
      UPDATE public.roadmap_items
        SET beta_since = NULL, live_soon = FALSE, updated_at = NOW()
        WHERE id IN (
          SELECT id FROM public.roadmap_items
          WHERE flag_key = NEW.key AND status = 'in_progress' AND beta_since IS NOT NULL
          FOR UPDATE SKIP LOCKED
        );
    END IF;
    PERFORM set_config('lock_timeout', v_lock_timeout, true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('lock_timeout', v_lock_timeout, true);
    RAISE WARNING 'roadmap sync failed for flag % (run public.roadmap_resync_flags()): %', NEW.key, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.app_config_sync_roadmap() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS app_config_sync_roadmap ON app_config;
CREATE TRIGGER app_config_sync_roadmap
  AFTER INSERT OR UPDATE OF value ON app_config
  FOR EACH ROW EXECUTE FUNCTION public.app_config_sync_roadmap();

-- Afstemning: bringer alle koblede punkter i takt med app_config (samme regler
-- som triggeren) og returnerer antal rettede rækker. Idempotent: et andet kald
-- giver 0. Kun admin (is_admin()) eller service_role. Køres af
-- scripts/roadmap-drift.mjs eller af admin, når et flip har sprunget et låst
-- punkt over. Venter normalt på låse (det er et vedligeholdelseskald, ikke et flip).
-- secdef-lint: allow roadmap_resync_flags (admin/drift-scriptet kalder den som RPC; afviser alle andre end admin og service_role med 42501)
CREATE OR REPLACE FUNCTION public.roadmap_resync_flags() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_n INTEGER;
  v_total INTEGER := 0;
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.roadmap_items r
    SET status = 'in_progress', beta_since = COALESCE(r.beta_since, NOW()), beta_soon = FALSE, updated_at = NOW()
    FROM public.app_config c
    WHERE c.key = r.flag_key AND (c.value #>> '{}') = 'beta'
      AND r.status NOT IN ('shipped', 'archived')
      AND (r.status <> 'in_progress' OR r.beta_since IS NULL OR r.beta_soon);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total := v_total + v_n;

  UPDATE public.roadmap_items r
    SET status = 'shipped', shipped_at = COALESCE(r.shipped_at, NOW()), beta_soon = FALSE, live_soon = FALSE, updated_at = NOW()
    FROM public.app_config c
    WHERE c.key = r.flag_key AND (c.value #>> '{}') IN ('on', 'true')
      AND r.status NOT IN ('shipped', 'archived');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total := v_total + v_n;

  UPDATE public.roadmap_items r
    SET beta_since = NULL, live_soon = FALSE, updated_at = NOW()
    FROM public.app_config c
    WHERE c.key = r.flag_key AND (c.value #>> '{}') IN ('off', 'false')
      AND r.status = 'in_progress' AND r.beta_since IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total := v_total + v_n;

  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public.roadmap_resync_flags() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roadmap_resync_flags() TO authenticated;
GRANT EXECUTE ON FUNCTION public.roadmap_resync_flags() TO service_role;

COMMENT ON TABLE known_issues IS
  'Kendte fejl på /roadmap (#5387). EN+DA i samme række; published gater visning (ejeren godkender teksten). status: checking (meldt ind, ikke bekræftet) -> confirmed -> fixing -> fixed, eller checking -> dismissed (tjekket, intet problem). closed_at sættes ved fixed og dismissed. issue_ref = GitHub-issue, bruges af færdig-rutinen.';
COMMENT ON TABLE known_issue_reports IS
  '"Affects me too": én række pr. (fejl, bruger). Spillere ser kun egne; admin ser alle via known_issue_scores.';
COMMENT ON COLUMN roadmap_items.flag_key IS
  'Nøgle i app_config (#5387 §5.6). Triggere holder status, beta_since og shipped_at i takt med kontakten.';
COMMENT ON COLUMN roadmap_items.beta_soon IS '"Coming to beta" på Beta-fanen (#5387). Nulstilles når kontakten går i beta eller on.';
COMMENT ON COLUMN roadmap_items.live_soon IS '"For everyone soon" på Beta-fanen (#5387). Nulstilles ved on og off.';

NOTIFY pgrst, 'reload schema';

-- Post-verify (read-only, køres efter apply):
--   1. SELECT conname FROM pg_constraint WHERE conrelid = 'roadmap_items'::regclass AND contype = 'c';  -- engine + status + horizon
--   2. SELECT status, count(*) FROM roadmap_items GROUP BY 1;   -- uændret ift. før apply
--   3. SELECT count(*) FROM roadmap_votes;                      -- uændret ift. før apply
--   4. SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'known_issue%';  -- 3 rækker, alle true
--   5. SELECT * FROM roadmap_item_scores LIMIT 1;               -- 15 kolonner
--   6. SELECT tgname FROM pg_trigger WHERE tgname IN ('app_config_sync_roadmap', 'roadmap_items_sync_flag',
--        'roadmap_votes_lock_identity');  -- 3 rækker
--   7. has_function_privilege('anon', 'public.roadmap_admin_stats()', 'EXECUTE') = false,
--      has_function_privilege('anon', 'public.roadmap_resync_flags()', 'EXECUTE') = false,
--      has_function_privilege('authenticated', 'public.app_config_sync_roadmap()', 'EXECUTE') = false,
--      has_table_privilege('anon', 'public.known_issue_scores', 'SELECT') = false.
--   8. SELECT proname, proconfig FROM pg_proc WHERE prosecdef AND proname LIKE ANY
--        (ARRAY['roadmap_%', 'app_config_sync_roadmap']);  -- alle: search_path=public, pg_temp
--   Flip-prøve er ikke nødvendig: triggeren er dækket af integrationstesten
--   (backend/lib/testdb/roadmapHub.integration.test.js). Rør ALDRIG en rigtig
--   kontakt i prod for at teste (ejer-only).
--
-- Rollback: står med vilje IKKE som SQL her (auto-migrate kører database/2026-*.sql,
-- #4677). Skulle det blive nødvendigt, skrives et manual-only-script i
-- database/manual/ med markøren KOERES IKKE AUTOMATISK, ejer-gated. Det fjerner
-- de tre triggere og deres funktioner, de tre RPC'er, known_issue_scores og de tre
-- known_issue-tabeller. roadmap_items/roadmap_votes-ændringerne er
-- bagudkompatible og kan blive stående.
