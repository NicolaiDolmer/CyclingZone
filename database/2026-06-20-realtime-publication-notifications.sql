-- #46: Tilføj public.notifications til supabase_realtime publication så
-- Layout.jsx's notifications-subscription (user_id-filtreret) faktisk modtager
-- INSERT-events og kan refetche header-saldoen live efter transfer/auktions-køb.
--
-- Rod-årsag (verificeret mod prod 2026-06-20): publikationen indeholdt kun
-- auction_bids, auctions, race_results, season_standings, seasons. Layout.jsx:326
-- abonnerer på postgres_changes {table: notifications, filter: user_id=eq.<self>}
-- og refetcher teams.balance ved hvert event (Layout.jsx:330) — men da
-- notifications ikke lå i publikationen, fyrede subscriptionen aldrig, så saldoen
-- i headeren forblev stale efter bud/salg/lån indtil hård reload (#46-symptomet).
-- DashboardPage fanger løb-relaterede ændringer via useRealtimeRefetch(
-- ["seasons","race_results"]) (begge ER i publikationen), men ikke transfer/
-- auktions-køb → inkonsistens mellem flader. Denne migration lukker det hul.
--
-- Sikkerhed: notifications har RLS ON med SELECT-policy (auth.uid() = user_id),
-- så realtime leverer KUN brugerens egne notifikationer. Selve saldoen hentes via
-- en RLS-scoped REST-refetch (Layout.jsx:330, .eq("user_id", self).single()) —
-- ingen ny data-eksponering.
--
-- Bevidst fravalg: teams blev IKKE tilføjet. teams' SELECT-policy er public read
-- (using true) og balance har anon/authenticated kolonne-SELECT-grant, så en
-- teams-realtime-subscription ville fan-out'e ALLE holds saldo-events til ALLE
-- klienter unødigt. notifications-stien er allerede frontendens kanoniske trigger
-- og afgrænset til den indloggede bruger.
--
-- ALTER PUBLICATION er idempotent vha. NOT EXISTS-tjek mod pg_publication_tables
-- (samme mønster som 2026-05-08-realtime-publication-auctions.sql og
-- 2026-05-30-realtime-publication-results.sql, begge verificeret i prod).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
