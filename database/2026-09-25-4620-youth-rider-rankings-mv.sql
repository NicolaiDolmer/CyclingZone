-- =============================================================================
-- 2026-09-25 — #5647 (Y7 / plan S5): ungdoms-rytterranglisten
-- =============================================================================
-- Applies af auto-migrate.yml ved merge (#2642). Claude post-verificerer
-- (kommandoer nederst). Rent additiv: nyt matview + ny refresh-RPC. Seniorens
-- rider_rankings_mv er urørt (den tæller kun seniorløb efter #5535).
--
-- ── MODEL ──────────────────────────────────────────────────────────────────
-- Plan 2026-09-23 §2.0 V2 + §2b: spejl af rider_rankings_mv (samme kolonner i
-- samme rækkefølge) plus `squad`, bygget KUN på løb med `races.squad <> 'senior'`.
-- Nøgle `(season_id, squad, rider_id)`. Point følger LØBETS trup, ikke
-- rytterens: en rytter der flyttes op midt i sæsonen står derfor med de
-- rigtige point i begge lister. `prize_earned` beholdes for samme form som
-- seniorlisten (ungdomsløb udbetaler ingen præmier i v1, så den er 0).
--
-- ── REFRESH ────────────────────────────────────────────────────────────────
-- refresh_youth_rider_rankings_mv(): én matview, én transaktion, PLAIN REFRESH
-- (samme mønster og begrundelse som database/2026-07-27-3013-refresh-matviews-
-- concurrently.sql). Kaldes af backend/lib/refreshRankingMatviews.js sammen
-- med de fire seniorviews (race-finalisering + cron-fallback).
--
-- ── GRANTS (#5088/#5176) ───────────────────────────────────────────────────
-- Supabase giver anon/authenticated SELECT ved CREATE. REVOKE ALL eksplicit;
-- kun service_role læser (backend/routes/rankings.ts). Refresh-RPC'en kun for
-- service_role.
--
-- ── IDEMPOTENS ─────────────────────────────────────────────────────────────
-- CREATE MATERIALIZED VIEW IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION og REVOKE/GRANT er sikre at køre igen.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS public.refresh_youth_rider_rankings_mv();
--   DROP MATERIALIZED VIEW IF EXISTS public.youth_rider_rankings_mv;

BEGIN;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.youth_rider_rankings_mv AS
SELECT
  ra.season_id,
  rr.rider_id,
  SUM(rr.points_earned)                                                              AS points,
  SUM(rr.prize_money)                                                                AS prize_earned,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'stage')                   AS stage_wins,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'gc' AND ra.race_type = 'stage_race') AS gc_wins,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'gc' AND ra.race_type = 'single')     AS classic_wins,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'points')                  AS pts_wins,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'mountain')                AS mtn_wins,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'young')                   AS young_wins,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'leader')                  AS yellow_days,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'points_day')              AS green_days,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'mountain_day')            AS polka_days,
  COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'young_day')               AS white_days,
  COUNT(*) FILTER (WHERE rr.result_type IN ('stage','gc') AND rr.rank BETWEEN 1 AND 3)  AS top3,
  COUNT(*) FILTER (WHERE rr.result_type IN ('stage','gc') AND rr.rank BETWEEN 1 AND 10) AS top10,
  ra.squad
FROM public.race_results rr
JOIN public.races ra ON ra.id = rr.race_id
WHERE rr.rider_id IS NOT NULL
  AND ra.squad <> 'senior'
GROUP BY ra.season_id, ra.squad, rr.rider_id;

CREATE UNIQUE INDEX IF NOT EXISTS youth_rider_rankings_mv_pk
  ON public.youth_rider_rankings_mv (season_id, squad, rider_id);
CREATE INDEX IF NOT EXISTS youth_rider_rankings_mv_season
  ON public.youth_rider_rankings_mv (season_id, squad, points DESC);

REVOKE ALL ON TABLE public.youth_rider_rankings_mv FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.youth_rider_rankings_mv TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_youth_rider_rankings_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.youth_rider_rankings_mv;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_youth_rider_rankings_mv() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_youth_rider_rankings_mv() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Post-merge verifikation (read-only, køres af Claude efter auto-migrate) ──
-- V1. Grants (forvent INGEN 'anon=' og INGEN 'authenticated='):
--   SELECT array_to_string(c.relacl, '|') FROM pg_class c
--   WHERE c.oid = 'public.youth_rider_rankings_mv'::regclass;
-- V2. Indekser (forvent youth_rider_rankings_mv_pk UNIQUE + _season):
--   SELECT indexrelid::regclass, indisunique FROM pg_index
--   WHERE indrelid = 'public.youth_rider_rankings_mv'::regclass;
-- V3. Refresh-RPC'en kører som service_role (backend-cron) uden fejl, og
--     matview_refresh_heartbeat ('ranking') bliver ved med at opdatere.
-- V4. Tør: 0 rækker (ingen afgjorte ungdomsløb endnu).
-- V5. get_advisors(type: 'security'): ingen nye fund.
