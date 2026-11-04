-- #7664 (#7659 trin 3): refresh af team_race_points_mv laeser ~26x faerre buffere.
--
-- Problem (maalt read-only paa prod 4/11, tal paa issuet): planneren vaelger en
-- Merge Join der foeder race_results gennem indekset paa rider_id. Den fysiske
-- raekkefoelge paa disk har ingen sammenhaeng med rider_id, saa hver raekke koster
-- et tilfaeldigt heap-besoeg: refreshen roerer omtrent lige saa mange buffere som
-- tabellen har raekker. En Seq Scan + Hash Join laeser i stedet tabellen een gang
-- lineaert. Det er den samme forespoergsel; kun planen skifter.
--
-- Loesning: funktions-scoped planner-indstillinger paa den overload der selv
-- udfoerer REFRESH (boolean-overloaden; den token-fencede overload kalder den).
-- SET paa en funktion gaelder kun mens funktionen koerer og roerer ingen anden
-- forespoergsel. enable_mergejoin = off er en straf, ikke et forbud: findes der
-- ingen anden plan (fx CONCURRENTLY's diff-join), bruges merge join stadig.
-- work_mem giver HashAggregate luft til at blive i hukommelsen naar ranglisten
-- vokser.
--
-- Matview-definitionen er UROERT: samme SELECT, samme kolonner og typer, samme
-- unikke indeks, ingen DROP. Output-bevis (EXCEPT ALL begge veje = 0) staar paa
-- issuet.
--
-- IDEMPOTENT: ALTER FUNCTION ... SET kan koeres igen uden aendring. Ingen data
-- roeres. Rul tilbage med ALTER FUNCTION ... RESET <navn>.
--
-- VAGT: en senere CREATE OR REPLACE af denne overload uden SET-klausulerne
-- nulstiller dem stille. backend/lib/refreshRankingMatviews.test.js fejler hvis en
-- nyere migration regenererer funktionen uden at genanvende enable_mergejoin.

BEGIN;

ALTER FUNCTION public.refresh_team_race_points_mv(boolean) SET enable_mergejoin = off;
ALTER FUNCTION public.refresh_team_race_points_mv(boolean) SET work_mem = '32MB';

COMMIT;

-- -- Post-merge verifikation (read-only, koeres af Claude efter auto-migrate) --
-- V1. Indstillingerne sidder paa funktionen (forvent search_path + de to nye):
--   SELECT proconfig FROM pg_proc
--   WHERE oid = 'public.refresh_team_race_points_mv(boolean)'::regprocedure;
-- V2. Planen under funktionens indstillinger er Seq Scan + Hash Join, og buffere
--     falder fra ~1,8 mio. til ~70.000 (sammenlign med baseline paa issuet):
--   BEGIN READ ONLY; SET LOCAL enable_mergejoin = off; SET LOCAL work_mem = '32MB';
--   EXPLAIN (ANALYZE, BUFFERS) <matview-definitionen fra pg_matviews>;
-- V3. Refreshen lykkes stadig: ranking_refresh_work_state.completed_version
--     indhenter requested_version efter naeste event, og consecutive_failures = 0.
