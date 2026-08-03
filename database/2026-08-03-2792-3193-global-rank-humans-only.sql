-- ============================================================
-- Global Rank: kun menneskelige managere (#2792) + refresh-konsistens
-- for #3193 ("global rank matcher ikke de viste tal")
-- ============================================================
--
-- #2792 (ejer-direktiv 31/7, Discord #feedback-from-dolmer): Global Rank
-- (leveret i #2453/PR #2563) skal KUN indeholde menneskeligt styrede hold.
-- AI-fyld-hold optog pladser i RANK()-beregningen og blev kun markeret med et
-- badge i UI — badget fjernes i samme PR (frontend), men den egentlige
-- ranglisteudvanding sad i selve matview'et: base-CTE'ens WHERE i
-- database/2026-07-17-global-rank.sql filtrerede is_test_account/is_frozen/
-- is_bank, men IKKE is_ai.
--
-- DISKRIMINATOR: den kanoniske "rigtigt manager-hold"-diskriminator som
-- resten af motoren bruger (backend/lib/humanTeamFilter.js, #2852) —
-- is_ai/is_bank/is_frozen/is_test_account alle = false. Denne migration
-- tilføjer KUN den manglende `is_ai = false` til det eksisterende filter,
-- ingen ny diskriminator opfindes.
--
-- MOTOR-SIKKERHED (ejer-krav 31/7: "verificér at motor-logikken ikke læser
-- den filtrerede liste" — global_rank_mv bruges også til pyramide-
-- komprimering i de tidlige sæsoner): grep-verificeret FØR denne migration —
-- backend/lib/pyramidCompression.js og resten af promotion/relegation-stien
-- læser season_standings.total_points DIREKTE og har sin egen ORDER BY;
-- INGEN backend-fil importerer/læser global_rank_mv eller dens global_rank-
-- kolonne (kun globalRankWeeklySnapshot.js/seasonTransition.js, som kalder de
-- to RPC'er nedenfor til SNAPSHOT/rollover-formål, ikke motor-afgørelser).
-- AI-filtreringen her rammer derfor UDELUKKENDE visningen.
--
-- KOORDINERET MED #3193 (Discord-bug, @thelamba 31/7: "Global rank not
-- mathing right?" — Wander Riders burde ligge nr. 4 iflg. de viste tal).
-- DIAGNOSE (execute_sql mod prod, project_id ghwvkxzhsbbltzfnuhhz, 3/8):
--   * global_rank_mv's egen RANK()-logik er selv-konsistent: rang og
--     global_points stemmer ALTID overens inden for samme snapshot (verificeret
--     for de 15 højest rangerede rækker + specifikt for Wander Riders: rank=8
--     følger korrekt af global_points=7527.50 som 8.-højeste blandt aktive
--     hold, ingen ties). Hypotese 2 (sorterings-/tiebreak-fejl) er AFKRÆFTET.
--   * Live season_standings.total_points for Wander Riders (7066) == mv'ets
--     season_points (7066) på målingstidspunktet, heartbeat 14 min gammel —
--     INGEN staleness lige nu, så den historiske skærmbillede-tilstand kan
--     ikke gen-skabes direkte. MEN roden er strukturel og dateret: /standings
--     læser season_standings LIVE (frontend/src/pages/StandingsPage.jsx),
--     mens Global Rank læser global_rank_mv (periodisk snapshot). I
--     backend/lib/raceRunner.js opdateres season_standings TIDLIGT i
--     løbs-finalization (updateStandings), men matview-refresh
--     (refreshRankingMatviewsSafe) blev først kaldt HELT SIDST — EFTER
--     processBoardWeekend + notifyDiscord (ekstern webhook-latens) +
--     notifyInApp. I det vindue viser /standings friske tal mens Global Rank
--     stadig viser løbets FØR-tilstand. Fikset i SAMME PR: refresh flyttet
--     til lige efter updateStandings (Node-ændring, ingen SQL nødvendig for
--     selve fixet — se raceRunner.js). Denne migration bidrager en frisk,
--     fuldt konsistent global_rank_mv-rebuild + gentagne snapshots, så
--     spillerne kun oplever ÉT rangliste-skifte fra #2792+#3193 tilsammen.
--
-- MATERIALIZED VIEW understøtter ikke CREATE OR REPLACE i Postgres — DROP +
-- CREATE er eneste vej. Idempotent (IF EXISTS/IF NOT EXISTS på hvert trin,
-- UPSERT på snapshot-rækkerne) — sikker at re-køre.
--
-- Rollback:
--   -- gendan den oprindelige base-CTE (fjern "AND t.is_ai = false" fra
--   -- WHERE-klausulen) — se database/2026-07-17-global-rank.sql for den
--   -- fulde oprindelige DDL, og kør den (DROP+CREATE) igen.

DROP MATERIALIZED VIEW IF EXISTS public.global_rank_mv;

CREATE MATERIALIZED VIEW public.global_rank_mv AS
WITH active_season AS (
  SELECT id AS season_id FROM public.seasons WHERE status = 'active' ORDER BY number DESC LIMIT 1
),
current_pts AS (
  SELECT ss.team_id, ss.total_points
  FROM public.season_standings ss, active_season a
  WHERE ss.season_id = a.season_id
),
last_two_seasons AS (
  SELECT id AS season_id, ROW_NUMBER() OVER (ORDER BY number DESC) AS recency_rank
  FROM public.seasons
  WHERE status IN ('active', 'completed')
),
activity AS (
  -- "aktiv" = mindst én season_standings-række i en af de seneste 2 sæsoner.
  SELECT ss.team_id, true AS active_recent
  FROM public.season_standings ss
  JOIN last_two_seasons lts ON lts.season_id = ss.season_id AND lts.recency_rank <= 2
  GROUP BY ss.team_id
),
rookie AS (
  -- "rookie" = ingen season_standings-række fra en TIDLIGERE sæson end den aktive.
  SELECT t.id AS team_id,
    NOT EXISTS (
      SELECT 1 FROM public.season_standings ss2, active_season a2
      WHERE ss2.team_id = t.id AND ss2.season_id <> a2.season_id
    ) AS is_rookie
  FROM public.teams t
),
base AS (
  SELECT
    t.id                                   AS team_id,
    t.name,
    t.division,
    t.is_ai,
    COALESCE(gp.banked_points, 0)          AS banked_points,
    COALESCE(cp.total_points, 0)           AS season_points,
    COALESCE(gp.banked_points, 0) + COALESCE(cp.total_points, 0) AS global_points,
    COALESCE(act.active_recent, false)     AS active_recent,
    COALESCE(r.is_rookie, true)            AS is_rookie
  FROM public.teams t
  LEFT JOIN public.team_global_rank_points gp ON gp.team_id = t.id
  LEFT JOIN current_pts cp ON cp.team_id = t.id
  LEFT JOIN activity act ON act.team_id = t.id
  LEFT JOIN rookie r ON r.team_id = t.id
  -- #2792: + t.is_ai = false — den kanoniske menneske-hold-diskriminator
  -- (backend/lib/humanTeamFilter.js) er nu FULDT anvendt her (var tidligere
  -- kun delvis: is_test_account/is_frozen/is_bank, uden is_ai).
  WHERE t.is_test_account = false AND t.is_frozen = false AND t.is_bank = false AND t.is_ai = false
)
SELECT
  team_id, name, division, is_ai, banked_points, season_points, global_points,
  active_recent, is_rookie,
  -- Rang beregnes KUN blandt aktive menneske-managere (inaktive er skjult fra
  -- listen, AI-hold er slet ikke i puljen længere).
  CASE WHEN active_recent
    THEN RANK() OVER (PARTITION BY active_recent ORDER BY global_points DESC)
    ELSE NULL
  END AS global_rank
FROM base;

CREATE UNIQUE INDEX IF NOT EXISTS global_rank_mv_pk    ON public.global_rank_mv (team_id);
CREATE INDEX        IF NOT EXISTS global_rank_mv_score ON public.global_rank_mv (global_points DESC);
GRANT SELECT ON public.global_rank_mv TO anon, authenticated;

-- ─── #2792 acceptkriterie: re-tag friske uge-/sæsonstart-snapshots ──────────
-- De eksisterende snapshot-rækker blev taget MENS AI-hold stadig var i
-- puljen, så deres global_rank-tal indeholder AI-holdenes pladser. Uden
-- re-snapshot ville "▲/▼ siden sidste uge" + "Climbers of the season" vise et
-- kunstigt engangshop for ALLE hold — ikke fordi nogen rykkede sig relativt
-- til andre MENNESKER, men fordi puljen blev tyndere. take_global_rank_weekly_
-- snapshot() har en 7-dages cooldown-guard, så vi tømmer bordet først: en tom
-- tabel gør guardens `last_snapshot IS NULL`-gren sand, og funktionen tager
-- straks en frisk baseline mod det NYE (menneske-only) global_rank_mv.
DELETE FROM public.global_rank_weekly_snapshot;
SELECT public.take_global_rank_weekly_snapshot();

-- Sæson-start-snapshottet har ingen selvstændig "tag nu"-RPC (kun embedded i
-- apply_global_rank_season_rollover, som IKKE skal kaldes her — den halverer
-- også team_global_rank_points, et sæsonskifte-only-skridt). Samme INSERT ...
-- ON CONFLICT-mønster som rollover-funktionen bruger, kørt standalone mod det
-- friske mv. AI-hold har ingen række i global_rank_mv længere, så deres
-- gamle season-start-snapshot-rækker efterlades (harmløse — aldrig slået op,
-- da frontend kun matcher team_id'er der findes i det aktive mv).
INSERT INTO public.global_rank_season_start_snapshot (team_id, season_id, global_rank, captured_at)
SELECT mv.team_id, s.id, mv.global_rank, now()
FROM public.global_rank_mv mv, (SELECT id FROM public.seasons WHERE status = 'active' ORDER BY number DESC LIMIT 1) s
ON CONFLICT (team_id) DO UPDATE SET
  season_id   = EXCLUDED.season_id,
  global_rank = EXCLUDED.global_rank,
  captured_at = EXCLUDED.captured_at;

-- pgrst schema-reload (billigt; matcher de tidligere ranking-migrationer).
NOTIFY pgrst, 'reload schema';
