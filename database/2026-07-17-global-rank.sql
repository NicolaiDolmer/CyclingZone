-- ============================================================
-- Global Rank: rangliste på tværs af alle managers (#2453)
-- ============================================================
--
-- DESIGN LÅST (ejer-godkendt 17/7, se issue #2453-kommentar "Design LÅST").
-- Denne migration ERSTATTER en tidligere draft-udgave (2-sæsoners vindue med
-- faste division/sæson-vægte) med det låste design:
--
--   * Navn: "Global Rank" (bruges ordret på både EN og DA — IKKE oversat til
--     "World Ranking"/"World Tour").
--   * Point pr. løbsresultat, vægtet efter løbets prestige/tier. Kalenderens
--     tiers/klasser (race_points, keyed på race_class) indkoder allerede denne
--     vægtning — samme point som season_standings.total_points (ingen ny
--     parallel point-kilde).
--   * HENFALD: alle point HALVERES ved hvert sæsonskifte (multiplikation ved
--     rollover). Ingen rullende dato-vindue, ingen hård udløbsdato. Selv-
--     begrænsende: konstant P point/sæson konvergerer mod 2P (geometrisk
--     række P + P/2 + P/4 + … ), ingen uendelig inflation.
--   * Skjul inaktive: managere uden en season_standings-række i nogen af de
--     seneste 2 sæsoner er skjult fra listen. Point BEVARES i data (uændret
--     hvis manageren ikke har spillet) — korrekt rank ved comeback.
--
-- ARKITEKTUR (afviger bevidst fra draften): "alle point halveres ved
-- sæsonskifte" kræver en PERSISTENT saldo (kan ikke genudledes fra en aggregat-
-- matview hver gang — halveringen SKAL forankres et sted). Løsning:
--   * team_global_rank_points: den "bankede" saldo (alle FØRDIGE sæsoner,
--     allerede henfaldet). Muteres KUN ved sæsonskifte (halveres + tilføjer
--     den netop afsluttede sæsons point).
--   * global_rank_mv: banked_points + IGANGVÆRENDE sæsons season_standings.
--     total_points = live global point-tal. Matview + freshness-heartbeat
--     (samme mønster som rider_rankings_mv, #2196/#2204/#2206) — INGEN live-
--     aggregering per request.
--   * global_rank_weekly_snapshot: rang pr. hold ved seneste ugentlige
--     snapshot (til "▲/▼ siden sidste uge"-pilene i UI).
--   * global_rank_season_start_snapshot: rang pr. hold ved sæson-start (til
--     "Climbers of the season"-panelet: pladser vundet siden sæsonstart).
--
-- FILTER (matcher StandingsPage-mønsteret): ekskluderer is_test_account,
-- is_frozen, is_bank. AI-hold INKLUDERES (matcher /standings), markeres
-- diskret i UI.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE). EJEREN MERGER — matview
-- populeres ved CREATE (ikke WITH NO DATA) → aktuel straks efter auto-migrate.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.global_rank_season_start_snapshot;
--   DROP TABLE IF EXISTS public.global_rank_weekly_snapshot;
--   DROP MATERIALIZED VIEW IF EXISTS public.global_rank_mv;
--   DROP TABLE IF EXISTS public.team_global_rank_points;
--   DROP FUNCTION IF EXISTS public.apply_global_rank_season_rollover(uuid);
--   DROP FUNCTION IF EXISTS public.take_global_rank_weekly_snapshot();
--   -- + gendan refresh_ranking_matviews()-krop fra 2026-07-04-rankings-heartbeat.sql
--   -- (fjern global_rank_mv-refresh-linjen)

-- ─── team_global_rank_points: bankede (allerede henfaldne) point pr. hold ───────
CREATE TABLE IF NOT EXISTS public.team_global_rank_points (
  team_id       UUID PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  banked_points NUMERIC NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.team_global_rank_points ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read team_global_rank_points" ON public.team_global_rank_points;
CREATE POLICY "Public read team_global_rank_points" ON public.team_global_rank_points FOR SELECT USING (true);
GRANT SELECT ON public.team_global_rank_points TO anon, authenticated;

-- ─── Ugentligt/sæson-start bevægelses-snapshot ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.global_rank_weekly_snapshot (
  team_id      UUID PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  global_rank  INTEGER,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.global_rank_weekly_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read global_rank_weekly_snapshot" ON public.global_rank_weekly_snapshot;
CREATE POLICY "Public read global_rank_weekly_snapshot" ON public.global_rank_weekly_snapshot FOR SELECT USING (true);
GRANT SELECT ON public.global_rank_weekly_snapshot TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.global_rank_season_start_snapshot (
  team_id      UUID PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  season_id    UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  global_rank  INTEGER,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.global_rank_season_start_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read global_rank_season_start_snapshot" ON public.global_rank_season_start_snapshot;
CREATE POLICY "Public read global_rank_season_start_snapshot" ON public.global_rank_season_start_snapshot FOR SELECT USING (true);
GRANT SELECT ON public.global_rank_season_start_snapshot TO anon, authenticated;

-- ─── global_rank_mv: banked + igangværende sæson, rang blandt AKTIVE managere ───
CREATE MATERIALIZED VIEW IF NOT EXISTS public.global_rank_mv AS
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
  WHERE t.is_test_account = false AND t.is_frozen = false AND t.is_bank = false
)
SELECT
  team_id, name, division, is_ai, banked_points, season_points, global_points,
  active_recent, is_rookie,
  -- Rang beregnes KUN blandt aktive managere (inaktive er skjult fra listen,
  -- men beholder deres point + rankes korrekt igen når de kommer tilbage).
  CASE WHEN active_recent
    THEN RANK() OVER (PARTITION BY active_recent ORDER BY global_points DESC)
    ELSE NULL
  END AS global_rank
FROM base;

CREATE UNIQUE INDEX IF NOT EXISTS global_rank_mv_pk    ON public.global_rank_mv (team_id);
CREATE INDEX        IF NOT EXISTS global_rank_mv_score ON public.global_rank_mv (global_points DESC);
GRANT SELECT ON public.global_rank_mv TO anon, authenticated;

-- ─── Udvid den eksisterende refresh-RPC med global_rank_mv ──────────────────────
-- Fuld krop gentaget (CREATE OR REPLACE erstatter definitionen fra rankings-
-- heartbeat-migrationen + den forrige global-rank-draft). Ingen nyt call-site:
-- den eksisterende kæde (race-finalization + 10-min cron-fallback) dækker
-- global_rank_mv gratis.
CREATE OR REPLACE FUNCTION public.refresh_ranking_matviews()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.rider_rankings_mv;
  REFRESH MATERIALIZED VIEW public.team_standings_ext_mv;
  REFRESH MATERIALIZED VIEW public.team_race_points_mv;
  REFRESH MATERIALIZED VIEW public.global_rank_mv;

  INSERT INTO public.matview_refresh_heartbeat (matview_group, refreshed_at)
  VALUES ('ranking', now())
  ON CONFLICT (matview_group) DO UPDATE SET refreshed_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_ranking_matviews() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_ranking_matviews() TO service_role;

-- ─── Sæsonskifte-rollover: HALVÉR alle bankede point + tilføj afsluttet sæson ───
-- Kaldes af backend/lib/seasonTransition.js lige efter previous season markeres
-- 'completed'. Idempotent-nok til re-run (halvering er en simpel formel — et
-- dobbelt-kald ville halvere for meget, så orkestratoren logger fasen og
-- springer den IKKE automatisk over ved retry; se seasonTransition.js-kommentar).
CREATE OR REPLACE FUNCTION public.apply_global_rank_season_rollover(p_completed_season_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Sørg for at alle hold har en række (nye hold der aldrig har spillet endnu).
  INSERT INTO public.team_global_rank_points (team_id, banked_points)
  SELECT t.id, 0 FROM public.teams t
  ON CONFLICT (team_id) DO NOTHING;

  -- Halvér EKSISTERENDE saldo + tilføj den netop afsluttede sæsons point, i ét trin:
  -- ny_saldo = (gammel_saldo + sæson_point) * 0.5.
  UPDATE public.team_global_rank_points gp
  SET banked_points = ROUND((gp.banked_points + COALESCE(ss.total_points, 0)) * 0.5, 2),
      updated_at = now()
  FROM public.season_standings ss
  WHERE ss.team_id = gp.team_id AND ss.season_id = p_completed_season_id;

  -- Hold UDEN en season_standings-række denne sæson (inaktive) halveres uden tilføjelse.
  UPDATE public.team_global_rank_points gp
  SET banked_points = ROUND(gp.banked_points * 0.5, 2),
      updated_at = now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.season_standings ss
    WHERE ss.team_id = gp.team_id AND ss.season_id = p_completed_season_id
  );

  -- Frisk matview så "sæson-start"-snapshottet nedenfor afspejler de nye saldi.
  REFRESH MATERIALIZED VIEW public.global_rank_mv;

  -- Sæson-start-snapshot for den NYE (netop åbnede) sæson — basis for
  -- "Climbers of the season"-panelet. Overskriver forrige sæsons snapshot
  -- (vi har kun brug for ÉT: den aktuelle sæsons startpunkt).
  INSERT INTO public.global_rank_season_start_snapshot (team_id, season_id, global_rank, captured_at)
  SELECT team_id, s.id, global_rank, now()
  FROM public.global_rank_mv, (SELECT id FROM public.seasons WHERE status = 'active' ORDER BY number DESC LIMIT 1) s
  ON CONFLICT (team_id) DO UPDATE SET
    season_id   = EXCLUDED.season_id,
    global_rank = EXCLUDED.global_rank,
    captured_at = EXCLUDED.captured_at;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_global_rank_season_rollover(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_global_rank_season_rollover(uuid) TO service_role;

-- ─── Ugentligt bevægelses-snapshot ("▲/▼ siden sidste uge") ─────────────────────
-- No-op medmindre >= 7 dage siden seneste snapshot (kaldes dagligt fra cron,
-- effektivt ugentlig kadence — samme "dagligt-tjek, ugentlig-effekt"-mønster
-- som andre 24h-crons i backend/cron.js).
CREATE OR REPLACE FUNCTION public.take_global_rank_weekly_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  last_snapshot TIMESTAMPTZ;
BEGIN
  SELECT MAX(captured_at) INTO last_snapshot FROM public.global_rank_weekly_snapshot;
  IF last_snapshot IS NOT NULL AND last_snapshot > now() - INTERVAL '7 days' THEN
    RETURN;
  END IF;

  INSERT INTO public.global_rank_weekly_snapshot (team_id, global_rank, captured_at)
  SELECT team_id, global_rank, now() FROM public.global_rank_mv
  ON CONFLICT (team_id) DO UPDATE SET
    global_rank  = EXCLUDED.global_rank,
    captured_at  = EXCLUDED.captured_at;
END;
$$;

REVOKE ALL ON FUNCTION public.take_global_rank_weekly_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.take_global_rank_weekly_snapshot() TO service_role;

-- pgrst schema-reload (billigt; matcher de tidligere ranking-migrationer).
NOTIFY pgrst, 'reload schema';
