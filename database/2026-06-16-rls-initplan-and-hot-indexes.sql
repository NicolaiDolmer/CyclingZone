-- =============================================================================
-- Advisor quick-wins: RLS initplan-optimering + hot indexes
-- =============================================================================
-- Kilde: Supabase performance advisor (snapshot 2026-06-16), project ghwvkxzhsbbltzfnuhhz.
--
-- DEL 1 — auth_rls_initplan (lint 0003), 44 policies:
--   Postgres re-evaluerer auth.uid() per RÆKKE når den står "bart" i en RLS-policy.
--   Wrappet i (select auth.uid()) evalueres den én gang pr. query (initplan), hvilket
--   fjerner per-row-overhead ved skala. Supabase-anbefaling:
--   https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
--   ALTER POLICY ændrer KUN USING/WITH CHECK-udtrykket — rolle, kommando og navn
--   bevares uændret. Alle policy-bodies er hentet 1:1 fra prod (pg_policies);
--   eneste ændring er auth.uid() -> (select auth.uid()). Ingen adgangs-semantik ændres.
--
-- DEL 2 — hot indexes (advisor index_advisor + unindexed_foreign_keys):
--   Fire højfrekvente / relaunch-kritiske flows (auktion, squad, race-resultater).
--   Hver er BÅDE en index_advisor-anbefaling OG en unindexed-FK. Resten af
--   FK-/index-backloggen ligger i #1375 Phase 2.
--
-- Idempotent: ALTER POLICY sætter samme udtryk ved replay; CREATE INDEX IF NOT EXISTS.
-- Refs #525 (advisor-hardening-spor), #1375 (perf-tracker).

BEGIN;

-- DEL 1: RLS initplan-optimering ------------------------------------------------

-- academy_intake
ALTER POLICY "academy_intake_owner_read" ON public.academy_intake
  USING (team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid()))));

-- admin_log
ALTER POLICY "Admins can view admin log" ON public.admin_log
  USING (EXISTS ( SELECT 1 FROM users WHERE ((users.id = (select auth.uid())) AND (users.role = 'admin'::text))));

-- auction_bids
ALTER POLICY "Teams can insert bids" ON public.auction_bids
  WITH CHECK ((select auth.uid()) IN ( SELECT teams.user_id FROM teams WHERE (teams.id = auction_bids.team_id)));

-- auction_proxy_bids
ALTER POLICY "Own proxy bids" ON public.auction_proxy_bids
  USING (EXISTS ( SELECT 1 FROM teams WHERE ((teams.id = auction_proxy_bids.team_id) AND (teams.user_id = (select auth.uid())))));

-- board_profiles
ALTER POLICY "Own board" ON public.board_profiles
  USING (team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid()))));

-- discord_settings
ALTER POLICY "Admin only discord_settings" ON public.discord_settings
  USING ((select auth.uid()) IN ( SELECT users.id FROM users WHERE (users.role = 'admin'::text)));

-- finance_transactions
ALTER POLICY "Own finances" ON public.finance_transactions
  USING (team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid()))));

-- loan_agreements
ALTER POLICY "Loan participants can read own agreements" ON public.loan_agreements
  USING ((from_team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid())))) OR (to_team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid())))));

-- loans
ALTER POLICY "Managers can view own loans" ON public.loans
  USING (team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid()))));

-- notifications
ALTER POLICY "Users can delete own notifications" ON public.notifications
  USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can read own notifications" ON public.notifications
  USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own notifications" ON public.notifications
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- pending_race_result_rows
ALTER POLICY "Admin delete pending rows" ON public.pending_race_result_rows
  USING ((select auth.uid()) IN ( SELECT users.id FROM users WHERE (users.role = 'admin'::text)));
ALTER POLICY "Admin update pending rows" ON public.pending_race_result_rows
  USING ((select auth.uid()) IN ( SELECT users.id FROM users WHERE (users.role = 'admin'::text)));
ALTER POLICY "Owner or admin insert pending rows" ON public.pending_race_result_rows
  WITH CHECK ((EXISTS ( SELECT 1 FROM pending_race_results p WHERE ((p.id = pending_race_result_rows.pending_id) AND (p.submitted_by = (select auth.uid()))))) OR is_admin());
ALTER POLICY "Owner or admin read pending rows" ON public.pending_race_result_rows
  USING (EXISTS ( SELECT 1 FROM pending_race_results p WHERE ((p.id = pending_race_result_rows.pending_id) AND ((p.submitted_by = (select auth.uid())) OR is_admin()))));

-- pending_race_results
ALTER POLICY "Admin can update pending results" ON public.pending_race_results
  USING ((select auth.uid()) IN ( SELECT users.id FROM users WHERE (users.role = 'admin'::text)));
ALTER POLICY "Managers can insert pending results" ON public.pending_race_results
  WITH CHECK ((select auth.uid()) = submitted_by);
ALTER POLICY "Managers can read own submissions" ON public.pending_race_results
  USING (((select auth.uid()) = submitted_by) OR ((select auth.uid()) IN ( SELECT users.id FROM users WHERE (users.role = 'admin'::text))));

-- player_events
ALTER POLICY "Managers can insert own events" ON public.player_events
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Managers can read own events" ON public.player_events
  USING ((select auth.uid()) = user_id);

-- race_classes
ALTER POLICY "Admins can manage race_classes" ON public.race_classes
  USING (EXISTS ( SELECT 1 FROM users WHERE ((users.id = (select auth.uid())) AND (users.role = 'admin'::text))));

-- race_points
ALTER POLICY "Admins can manage race_points" ON public.race_points
  USING (EXISTS ( SELECT 1 FROM users WHERE ((users.id = (select auth.uid())) AND (users.role = 'admin'::text))));

-- rider_profile_views
ALTER POLICY "Authenticated can insert own rider views" ON public.rider_profile_views
  WITH CHECK ((select auth.uid()) = user_id);

-- rider_watchlist
ALTER POLICY "Own watchlist only" ON public.rider_watchlist
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- roadmap_votes
ALTER POLICY "Users can insert own roadmap votes" ON public.roadmap_votes
  WITH CHECK (((select auth.uid()) = user_id) AND (EXISTS ( SELECT 1 FROM roadmap_items i WHERE ((i.id = roadmap_votes.item_id) AND i.approved AND (i.status = 'active'::text)))));
ALTER POLICY "Users can read own roadmap votes" ON public.roadmap_votes
  USING (((select auth.uid()) = user_id) OR is_admin());
ALTER POLICY "Users can update own roadmap votes" ON public.roadmap_votes
  USING ((select auth.uid()) = user_id) WITH CHECK (((select auth.uid()) = user_id) AND (EXISTS ( SELECT 1 FROM roadmap_items i WHERE ((i.id = roadmap_votes.item_id) AND i.approved AND (i.status = 'active'::text)))));

-- scout_actions
ALTER POLICY "scout_actions_own_insert" ON public.scout_actions
  WITH CHECK (team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid()))));
ALTER POLICY "scout_actions_own_select" ON public.scout_actions
  USING (team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid()))));

-- swap_offers
ALTER POLICY "Swap participants can read own offers" ON public.swap_offers
  USING ((proposing_team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid())))) OR (receiving_team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid())))));

-- training_day_runs
ALTER POLICY "training_day_runs_select" ON public.training_day_runs
  USING (team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid()))));

-- training_plans
ALTER POLICY "training_plans_own_delete" ON public.training_plans
  USING (team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid()))));
ALTER POLICY "training_plans_own_insert" ON public.training_plans
  WITH CHECK (team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid()))));
ALTER POLICY "training_plans_own_select" ON public.training_plans
  USING (team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid()))));
ALTER POLICY "training_plans_own_update" ON public.training_plans
  USING (team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid())))) WITH CHECK (team_id IN ( SELECT teams.id FROM teams WHERE (teams.user_id = (select auth.uid()))));

-- transfer_listings
ALTER POLICY "Owners can insert listings" ON public.transfer_listings
  WITH CHECK ((select auth.uid()) IN ( SELECT teams.user_id FROM teams WHERE (teams.id = transfer_listings.seller_team_id)));
ALTER POLICY "Owners can update listings" ON public.transfer_listings
  USING ((select auth.uid()) IN ( SELECT teams.user_id FROM teams WHERE (teams.id = transfer_listings.seller_team_id)));

-- transfer_offers
ALTER POLICY "Buyers can insert offers" ON public.transfer_offers
  WITH CHECK ((select auth.uid()) IN ( SELECT teams.user_id FROM teams WHERE (teams.id = transfer_offers.buyer_team_id)));
ALTER POLICY "Involved parties can read offers" ON public.transfer_offers
  USING (((select auth.uid()) IN ( SELECT teams.user_id FROM teams WHERE (teams.id = transfer_offers.buyer_team_id))) OR ((select auth.uid()) IN ( SELECT teams.user_id FROM teams WHERE (teams.id = transfer_offers.seller_team_id))) OR ((select auth.uid()) IN ( SELECT users.id FROM users WHERE (users.role = 'admin'::text))));
ALTER POLICY "Involved parties can update offers" ON public.transfer_offers
  USING (((select auth.uid()) IN ( SELECT teams.user_id FROM teams WHERE (teams.id = transfer_offers.buyer_team_id))) OR ((select auth.uid()) IN ( SELECT teams.user_id FROM teams WHERE (teams.id = transfer_offers.seller_team_id))));

-- users
ALTER POLICY "Users can read own profile" ON public.users
  USING ((select auth.uid()) = id);
ALTER POLICY "Users can update own profile" ON public.users
  USING ((select auth.uid()) = id) WITH CHECK ((select auth.uid()) = id);

-- xp_log
ALTER POLICY "Own xp log" ON public.xp_log
  USING ((select auth.uid()) = user_id);


-- DEL 2: hot indexes -----------------------------------------------------------
-- riders.pending_team_id: auktion/squad-pending — advisor cost 1451 -> 6.75 (9.4k+ calls)
CREATE INDEX IF NOT EXISTS idx_riders_pending_team_id ON public.riders (pending_team_id);
-- race_results FK'er: joines i alle race-resultat-queries
CREATE INDEX IF NOT EXISTS idx_race_results_rider_id ON public.race_results (rider_id);
CREATE INDEX IF NOT EXISTS idx_race_results_team_id ON public.race_results (team_id);
-- auction_bids.team_id: auktions-bud-opslag (10k+ calls)
CREATE INDEX IF NOT EXISTS idx_auction_bids_team_id ON public.auction_bids (team_id);

COMMIT;

-- =============================================================================
-- Verifikation efter apply (forventet output):
--
-- 1) Alle 44 policies wrappet (forventet: 0 rækker tilbage med "bart" auth.uid()):
--    SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname='public'
--      AND (qual ~ 'auth\.uid\(\)' OR with_check ~ 'auth\.uid\(\)')
--      AND NOT (COALESCE(qual,'')||COALESCE(with_check,'') ~ 'select auth\.uid');
--    → forventet: 0 rows
--
-- 2) Indexes findes:
--    SELECT indexname FROM pg_indexes WHERE schemaname='public'
--      AND indexname IN ('idx_riders_pending_team_id','idx_race_results_rider_id',
--                        'idx_race_results_team_id','idx_auction_bids_team_id');
--    → forventet: 4 rows
--
-- 3) Adgangs-regression: random auth user ser stadig kun egne rækker
--    (RLS-semantik uændret — kun evaluerings-tidspunkt flyttet).
-- =============================================================================
