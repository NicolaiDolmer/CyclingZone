-- 2026-07-16 — Forward-guard (DB-lag) for #1847: løbshistorik skal overleve rytter-/
-- hold-sletning. Navne-snapshot-triggers + defensiv backfill. EJEREN merger PR'en;
-- apply er et SEPARAT manuelt post-merge-skridt (aldrig automatisk).
--
-- ROD-ÅRSAG + EVIDENS (#1847, verificeret READ-ONLY mod prod 16/7)
--   race_results.rider_id/team_id er ON DELETE SET NULL (bevidst: historik bevares
--   når ryttere/hold forsvinder). #1847 talte 13.262 "forældreløse" rækker
--   (rider_id IS NULL) og hypotiserede en voksende datalæk. Målingen viste sig at
--   blande to ting sammen:
--     • 9.707 rækker (70%) er team-klassifikationer (result_type IN ('team','team_day'))
--       hvor rider_id er NULL BY DESIGN (raceRunner.buildRaceResults skriver dem
--       sådan). De "vokser" med hver løbs-finalisering — det var "+24 på minutter"-
--       observationen 15/7 (1.188 team-rækker indsat alene den dag), IKKE en læk.
--     • 4.100 rækker er ægte rytter-orphans — 100% fra slettede AI-hold
--       (team_name LIKE 'AI %', 54 hold, 89 løb, første 29/6 = AI-churn efter
--       relaunch, jf. #2407/#2377). Lækkilden ER bekræftet AI-hold-churn.
--   ALLE 4.100 har rider_name + team_name denormaliseret → de vises stadig korrekt
--   (RaceDetailPage/RaceHistoryPage/RiderStats læser navnekolonnerne). 0 rækker i
--   hele tabellen (240.700) mangler navne-snapshot. De 146 orphan-rækker med
--   prize_money > 0 ligger alle i UDBETALTE løb (races.prize_paid_at IS NOT NULL).
--
-- HVORFOR INGEN DELETE-OPRYDNING
--   At slette de 13.807 rider_id-NULL-rækker ville fjerne team-klassifikationen fra
--   HVERT afviklet løb og slå huller i historiske resultatlister (ranks der mangler
--   i etape-/GC-tabeller spillere har kørt imod) — det modsatte af palmarès-målet
--   (#1997). Rækkerne er display-sikre historik, ikke affald. Derfor bevarer denne
--   migration ALT og lukker i stedet det egentlige hul: at display-sikkerheden i dag
--   kun holder fordi insert-stierne tilfældigvis populerer navnene. Skulle en række
--   mangle snapshottet når dens rytter/hold slettes, er navnet tabt for altid.
--
-- HVAD DENNE GUARD GØR
--   1) Defensiv, idempotent backfill af manglende rider_name/team_name fra de
--      stadig-levende FK-mål (spejler 2026-06-29-race-results-team-name-backfill.sql;
--      pt. 0 rækker — ren fremtidssikring mod re-run på en ældre snapshot).
--   2) BEFORE DELETE-triggers på riders og teams der snapshotter navnet ind i
--      race_results-rækker som mangler det, FØR FK'en SET NULL'er attributionen.
--      Dækker ALLE delete-stier (AI-trim, admin-ops, manuel SQL) — JS-spejlingen i
--      aiTeamGenerator.snapshotRaceResultNamesForTeams dækker kun AI-trim-stierne.
--   Idx-note: idx_race_results_rider_id + idx_race_results_team_id findes allerede
--   (verificeret i prod 16/7) → trigger-UPDATEs er index-backed.
--
-- ⚠️ IKKE-DESTRUKTIV: ingen DELETE, ingen rækker fjernes. UPDATEs rører kun rækker
--    hvor navnefeltet er NULL (IS NULL-guard → aldrig overskrivning).
--
-- IDEMPOTENT: CREATE OR REPLACE + DROP TRIGGER IF EXISTS + WHERE ... IS NULL.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_snapshot_result_names_on_rider_delete ON public.riders;
--   DROP FUNCTION IF EXISTS public.snapshot_race_result_rider_name();
--   DROP TRIGGER IF EXISTS trg_snapshot_result_names_on_team_delete ON public.teams;
--   DROP FUNCTION IF EXISTS public.snapshot_race_result_team_name();
--   (Backfill-UPDATEs er forward-only datakorrektion; ingen down-migration.)
--
-- VERIFIKATION (efter apply):
--   SELECT count(*) FROM race_results
--   WHERE (rider_id IS NOT NULL AND rider_name IS NULL AND result_type NOT IN ('team','team_day'))
--      OR (team_id IS NOT NULL AND team_name IS NULL);   -- forventet: 0
--   SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_snapshot_result_names%'; -- 2 rækker

BEGIN;

-- 1) Defensiv backfill (pt. no-op i prod — 0 at-risk rækker 16/7).
UPDATE race_results
SET rider_name = NULLIF(TRIM(COALESCE(riders.firstname, '') || ' ' || COALESCE(riders.lastname, '')), '')
FROM riders
WHERE race_results.rider_id = riders.id
  AND race_results.rider_name IS NULL;

UPDATE race_results
SET team_name = teams.name
FROM teams
WHERE race_results.team_id = teams.id
  AND race_results.team_name IS NULL;

-- 2a) Navne-snapshot ved rytter-sletning.
CREATE OR REPLACE FUNCTION public.snapshot_race_result_rider_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  UPDATE race_results
  SET rider_name = NULLIF(TRIM(COALESCE(OLD.firstname, '') || ' ' || COALESCE(OLD.lastname, '')), '')
  WHERE rider_id = OLD.id
    AND rider_name IS NULL;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_result_names_on_rider_delete ON public.riders;
CREATE TRIGGER trg_snapshot_result_names_on_rider_delete
  BEFORE DELETE ON public.riders
  FOR EACH ROW
  EXECUTE FUNCTION public.snapshot_race_result_rider_name();

-- 2b) Navne-snapshot ved hold-sletning.
CREATE OR REPLACE FUNCTION public.snapshot_race_result_team_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  UPDATE race_results
  SET team_name = OLD.name
  WHERE team_id = OLD.id
    AND team_name IS NULL;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_result_names_on_team_delete ON public.teams;
CREATE TRIGGER trg_snapshot_result_names_on_team_delete
  BEFORE DELETE ON public.teams
  FOR EACH ROW
  EXECUTE FUNCTION public.snapshot_race_result_team_name();

COMMIT;
