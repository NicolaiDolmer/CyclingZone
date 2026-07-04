-- ============================================================
-- Rangliste-matview refresh-heartbeat (#2196 Del 2, follow-up til #2175)
-- ============================================================
--
-- ROD-ÅRSAG (den regression Del 2 skal fange automatisk): efter Del 1 læser
-- /standings + /rider-rankings fra matviews (rider_rankings_mv m.fl.), der
-- refreshes af public.refresh_ranking_matviews() fra race-finalization
-- (raceRunner.js) + en 10-min cron-fallback (cron.js). Dør DEN refresh-sti
-- (RPC-fejl, cron-tick stopper, finalization-hook brudt) driver matviewsene:
-- ranglisterne bliver STALE/langsomme UDEN en exception — præcis den stille
-- degradering ingen bliver alarmeret om i dag. Stall-watchdog'ens (d)-check
-- fanger det ikke: season_standings og matviewsene opdateres ad SEPARATE stier,
-- så standings kan være friske mens matview-refresh er død.
--
-- LØSNING: et heartbeat-timestamp der opdateres ATOMISK inde i refresh-RPC'en.
-- Fejler en REFRESH ruller hele funktionen tilbage → heartbeat opdateres IKKE.
-- Heartbeat kan derfor ikke lyve: den er "sidste gang alle 3 matviews blev
-- fuldt refreshet". Stall-watchdog-check (e) sammenligner heartbeat mod nyeste
-- race_results.imported_at — vokser lag'et, er refresh-stien stallet → alarm.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / INSERT ... ON CONFLICT).
-- Navngivet så den sorterer EFTER 2026-07-04-ranking-matviews.sql (LC_ALL=C):
-- 'rankings' > 'ranking-' i byte-orden → matviews/RPC findes ved fresh replay.
-- EJEREN MERGER (migration auto-applies i prod via auto-migrate.yml).
--
-- Rollback:
--   -- gendan den heartbeat-fri RPC-krop (fra 2026-07-04-ranking-matviews.sql)
--   DROP TABLE IF EXISTS public.matview_refresh_heartbeat;

-- ─── Heartbeat-tabel: ét timestamp pr. matview-gruppe ───────────────────────────
CREATE TABLE IF NOT EXISTS public.matview_refresh_heartbeat (
  matview_group text PRIMARY KEY,
  refreshed_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS: ren ops-metadata (ét timestamp, ingen PII). Backend læser via service_role
-- (bypasser RLS). RLS enabled + INGEN policy = deny-all for anon/authenticated,
-- service_role uændret. Lukker Supabase security-advisorens "RLS disabled"-flag.
ALTER TABLE public.matview_refresh_heartbeat ENABLE ROW LEVEL SECURITY;

-- ─── Udvid refresh-RPC'en med atomisk heartbeat ─────────────────────────────────
-- Fuld krop gentaget (CREATE OR REPLACE erstatter definitionen fra Del 1-filen).
-- Heartbeat-upsert'en kører KUN hvis alle tre REFRESH lykkes (samme transaktion).
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
  INSERT INTO public.matview_refresh_heartbeat (matview_group, refreshed_at)
  VALUES ('ranking', now())
  ON CONFLICT (matview_group) DO UPDATE SET refreshed_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_ranking_matviews() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_ranking_matviews() TO service_role;

-- Seed baseline: matviewsene ER friske ved migrations-tid (Del 1 populerede dem
-- ved CREATE), så sæt heartbeat = now() → check (e) false-alarmerer ikke i
-- deploy-vinduet FØR første cron-refresh skriver sit eget heartbeat.
INSERT INTO public.matview_refresh_heartbeat (matview_group, refreshed_at)
VALUES ('ranking', now())
ON CONFLICT (matview_group) DO UPDATE SET refreshed_at = now();

-- pgrst schema-reload (billigt; matcher Del 1-filen).
NOTIFY pgrst, 'reload schema';
