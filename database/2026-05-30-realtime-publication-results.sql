-- #783 (+ Standings/Resultater-klynge): Tilføj public.season_standings,
-- public.race_results + public.seasons til supabase_realtime publication så
-- frontend's postgres_changes-subscriptions faktisk modtager INSERT/UPDATE-events
-- efter en resultat-import.
--
-- Discovery: kun auctions + auction_bids lå i publicationen (jf.
-- 2026-05-08-realtime-publication-auctions.sql). StandingsPage, ResultaterPage
-- og DashboardPage hentede derfor kun data ved mount og forblev stale efter en
-- import indtil hård reload. RLS er enabled på alle tre med en "Public read"
-- SELECT-policy (using true), så realtime leverer events til indloggede klienter.
--
-- ALTER PUBLICATION er idempotent vha. NOT EXISTS-tjek mod pg_publication_tables.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'season_standings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.season_standings;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'race_results'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.race_results;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'seasons'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.seasons;
  END IF;
END $$;
