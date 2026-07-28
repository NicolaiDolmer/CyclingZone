-- ============================================================
-- Rangliste-matview refresh: skær lock-vinduet ned pr. matview (#3013)
-- ============================================================
--
-- ROD-ÅRSAG: public.refresh_ranking_matviews() kører fire
-- REFRESH MATERIALIZED VIEW-statements UDEN CONCURRENTLY i ÉN plpgsql-krop,
-- altså ÉN transaktion. ACCESS EXCLUSIVE-lås pr. matview holdes til HELE
-- funktionen er færdig, ikke pr. statement. Målt i prod (26/7, 19 dages
-- pg_stat_statements-vindue): 2.878 kald, gennemsnit 1.163 ms, MAKSIMUM
-- 7.808 ms mod et statement_timeout på 8.000 ms. Kadence: 10-min cron
-- (backend/cron.js:1195) + hver race-finalization (backend/lib/raceRunner.js).
-- Læsere: /rider-rankings, /standings, /results, Global Rank-widget,
-- holdprofil, /seasons.
--
-- VERIFICERET FØR denne migration blev skrevet (execute_sql mod prod,
-- project_id ghwvkxzhsbbltzfnuhhz, 27/7):
--   1. Funktionskroppen matcher issuet 1:1 (4x REFRESH + heartbeat-upsert,
--      pg_proc.prosrc).
--   2. Alle fire matviews HAR allerede et UNIQUE index OG er populated
--      (pg_matviews.ispopulated = true for alle fire):
--        rider_rankings_mv_pk      UNIQUE (season_id, rider_id)
--        team_race_points_mv_pk    UNIQUE (season_id, team_id, race_id)
--        team_standings_ext_mv_pk  UNIQUE (season_id, team_id)
--        global_rank_mv_pk         UNIQUE (team_id)
--      → intet nyt UNIQUE-index er nødvendigt. Denne migration opretter dem
--      alligevel defensivt (IF NOT EXISTS) som beskyttelse mod fremtidig drift.
--
-- DEN TEKNISKE FÆLDE (issuets punkt "Forhindringen" + acceptkriterie #1):
-- REFRESH MATERIALIZED VIEW CONCURRENTLY kan IKKE afvikles inde fra NOGEN
-- Postgres-funktion/-procedure, uanset sprog (plpgsql/sql) og uanset om den
-- indpakkende transaktion er implicit eller eksplicit BEGIN. Kommandoen
-- kræver isTopLevel=true i ProcessUtility, og enhver statement udført via SPI
-- (dvs. fra INDE i en funktionskrop) passerer altid isTopLevel=false — det er
-- ikke en detalje ved VORES funktion, det er hvordan Postgres' executor
-- skelner klient-udstedte top-niveau-kommandoer fra SPI-kald. Splitter man
-- refresh_ranking_matviews() op i fire mindre funktioner og kalder dem via
-- separate RPC'er, rammer man PRÆCIS samme fejl for hver af de fire, fordi
-- hver af dem STADIG er en funktionskrop kaldt via supabase-js/PostgREST →
-- SPI. Det er allerede dokumenteret i den oprindelige migration (2026-07-04-
-- ranking-matviews.sql, linje 26-31): "REFRESH ... CONCURRENTLY kan IKKE køre
-- inde i en plpgsql-funktion ... UNIQUE-index oprettes alligevel ... (åbner
-- for CONCURRENTLY via pg_cron senere hvis read-blocking bliver et problem)."
-- Det er præcis den situation vi er i nu. IKKE empirisk re-testet mod denne
-- specifikke prod-instans i denne session (ville kræve en mutation), men
-- baseret på Postgres' dokumenterede engine-adfærd (PreventInTransactionBlock
-- + SPI-eksekvering), konsistent på tværs af alle Postgres-versioner inkl.
-- 17.6, og allerede lagt til grund af projektets EGEN tidligere migration.
--
-- KONSEKVENS FOR DENNE MIGRATION: den kan IKKE "omskrive funktionen til
-- CONCURRENTLY" og forvente at RPC-kaldet virker — det ville skifte det
-- nuværende (langsomme, men FUNGERENDE) lock-vindue ud med en funktion der
-- fejler ved hvert kald. I stedet leverer denne migration den delvise
-- gevinst der ER sikker og opnåelig UDEN transport-ændring (issuets "Vej 1"):
-- split de fire REFRESH-statements i FIRE separate funktioner/transaktioner,
-- så hver matviews lås tages og frigives for sig i stedet for at blive holdt
-- til den SIDSTE af de fire er færdig. Reducerer ikke lock-tiden til nul,
-- men skærer MAKSIMUM pr. læser ned fra "sum af alle fire" til "den
-- langsomste af de fire" — direkte angreb på issuets kerne-risiko (max
-- 7.808 ms mod 8.000 ms statement_timeout).
--
-- DEN FULDE FJERNELSE af lock'en (ægte CONCURRENTLY, nul blokering) kræver
-- en transport-ændring uden for database-laget: enten pg_cron (issuets
-- "Vej 2" — extension IKKE installeret i dag, ny driftsflade, usynlig for
-- den nuværende Sentry-heartbeat) eller en rå pg-forbindelse fra Node
-- (issuets "Vej 3" — ny afhængighed, anden forbindelsesvej end resten af
-- backenden). Begge er eksplicit UBESLUTTEDE trade-offs i issuet — vælges
-- IKKE unilateralt her. Se PR-beskrivelsen for anbefaling + næste skridt.
--
-- BAGUDKOMPATIBILITET: den gamle public.refresh_ranking_matviews() bevares
-- (CREATE OR REPLACE, samme non-concurrent fire-i-én-transaktion-adfærd som
-- i dag) som fallback, i tilfælde af at denne migration appliceres FØR
-- backend-deployet der begynder at kalde de fire nye funktioner separat
-- (auto-migrate og Railway-deploy er ikke atomiske). Ingen regression i det
-- vindue — samme lock-profil som i dag, bare ikke bedre endnu.
--
-- Idempotent (CREATE OR REPLACE / IF NOT EXISTS). EJEREN/ORKESTRATOREN
-- APPLIER EFTER MERGE (rammer i #2642) — denne fil køres IKKE som en del af
-- at skrive den.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.refresh_rider_rankings_mv();
--   DROP FUNCTION IF EXISTS public.refresh_team_standings_ext_mv();
--   DROP FUNCTION IF EXISTS public.refresh_team_race_points_mv();
--   DROP FUNCTION IF EXISTS public.refresh_global_rank_mv();
--   -- refresh_ranking_matviews() selv rulles IKKE tilbage af rollback her,
--   -- den forbliver den samme 4-i-1-transaktion-krop som før denne migration.

-- ─── Defensivt: UNIQUE-index (no-op i dag, se verifikation ovenfor) ─────────────
CREATE UNIQUE INDEX IF NOT EXISTS rider_rankings_mv_pk      ON public.rider_rankings_mv     (season_id, rider_id);
CREATE UNIQUE INDEX IF NOT EXISTS team_race_points_mv_pk    ON public.team_race_points_mv   (season_id, team_id, race_id);
CREATE UNIQUE INDEX IF NOT EXISTS team_standings_ext_mv_pk  ON public.team_standings_ext_mv (season_id, team_id);
CREATE UNIQUE INDEX IF NOT EXISTS global_rank_mv_pk         ON public.global_rank_mv        (team_id);

-- ─── Fire granulære refresh-funktioner (én matview, én transaktion hver) ────────
-- Bevidst PLAIN REFRESH (ikke CONCURRENTLY) — se "DEN TEKNISKE FÆLDE" ovenfor.
-- Gevinsten kommer fra at splitte TRANSAKTIONEN, ikke fra CONCURRENTLY.
CREATE OR REPLACE FUNCTION public.refresh_rider_rankings_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.rider_rankings_mv;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_team_standings_ext_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.team_standings_ext_mv;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_team_race_points_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.team_race_points_mv;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_global_rank_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.global_rank_mv;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_rider_rankings_mv()     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_team_standings_ext_mv() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_team_race_points_mv()   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_global_rank_mv()        FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_rider_rankings_mv()     TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_team_standings_ext_mv() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_team_race_points_mv()   TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_global_rank_mv()        TO service_role;

-- ─── Bagudkompatibel wrapper (uændret adfærd — se "BAGUDKOMPATIBILITET") ────────
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

-- pgrst schema-reload (billigt; matcher de tidligere ranking-migrationer).
NOTIFY pgrst, 'reload schema';
