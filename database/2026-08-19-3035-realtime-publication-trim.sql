-- 2026-08-19 · #3035 — realtime-publikations-trim
--
-- Evidens (audit 19/8, pg_stat_statements): realtime.list_changes stod for 34 %
-- af al DB-tid. Hovedomkostning: race_results (1,03 mio. rækker, ~34k writes i
-- målevinduet) WAL-dekodes + RLS-tjekkes pr. subscriber ved hver løbsafvikling.
--
-- Ændringer (aftalt med ejer 19/8, jf. #3035-kommentaren):
--   UD:  race_results — erstattes som finaliserings-signal af races-rækken, der
--        bumpes pr. etape (apply_stage_result-RPC) og ved løbs-afslutning.
--        Frontend skiftet i samme PR (Dashboard/Resultater/Standings/Board).
--   IND: races (72 updates/vindue) — det nye lette signal.
--        transfer_offers + swap_offers — vækker den døde pending-badge-
--        subscription (useActionSummary); RLS afgrænser events til involverede.
--        activity_feed (77 inserts/vindue) — vækker NotificationsPage-feedet.
--   IKKE ind (bevidst): riders (63k updates/vindue), board_profiles (8k updates;
--        ændres ved finalisering, som races-eventet dækker).
--
-- Idempotent: hver ændring guarded mod pg_publication_tables.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'race_results') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.race_results;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'races') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.races;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'transfer_offers') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transfer_offers;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'swap_offers') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.swap_offers;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'activity_feed') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_feed;
  END IF;
END $$;

-- Post-verify (manuelt efter apply):
--   SELECT tablename FROM pg_publication_tables
--   WHERE pubname='supabase_realtime' ORDER BY 1;
--   -- forventet: activity_feed, auction_bids, auctions, forum_posts,
--   --            forum_replies, notifications, races, season_standings,
--   --            seasons, swap_offers, transfer_offers  (IKKE race_results)
-- Effektmåling (#3035 acceptkriterie 3): sammenlign realtime.list_changes'
-- andel af total_time i pg_stat_statements efter nogle dages drift.
