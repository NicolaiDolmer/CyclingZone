-- 2026-08-23 · Manglende FK-indekser (cutover-aftenens rod-årsags-fix).
-- APPLIED TIL PROD 23/8 ca. 20:15 via MCP (ejer-GO 4b) — denne fil er skema-paritet,
-- idempotent (CREATE INDEX IF NOT EXISTS), sikker at genkøre.
--
-- Baggrund: D1-komprimeringens AI-oprydning (144 AI-hold, ~2.850 ryttere) døde på
-- authenticator-rollens statement_timeout=8s, fordi hver rytter-/hold-sletning
-- tvang seq-scans i refererende tabeller uden indeks på FK-kolonnen (fx
-- race_stage_roles.rider_id 7.170 rækker, activity_feed 5.274, training_plans
-- 4.911). Det er præcis unindexed-FK-klassen Supabase-advisors flager.
-- Kombineret med chunkede deletes i aiTeamGenerator.js (samme PR) gled
-- oprydningen igennem på 149 s.

create index if not exists idx_riders_ai_team_id on public.riders(ai_team_id);
create index if not exists idx_race_stage_roles_rider_id on public.race_stage_roles(rider_id);
create index if not exists idx_activity_feed_team_id on public.activity_feed(team_id);
create index if not exists idx_activity_feed_rider_id on public.activity_feed(rider_id);
create index if not exists idx_training_plans_rider_id on public.training_plans(rider_id);
create index if not exists idx_auctions_expired_intake_team_id on public.auctions(expired_intake_team_id);
create index if not exists idx_auctions_seller_team_id on public.auctions(seller_team_id);
create index if not exists idx_auctions_current_bidder_id on public.auctions(current_bidder_id);
create index if not exists idx_race_incidents_rider_id on public.race_incidents(rider_id);
create index if not exists idx_scout_actions_rider_id on public.scout_actions(rider_id);
create index if not exists idx_scout_assignments_rider_id on public.scout_assignments(rider_id);
create index if not exists idx_identity_events_team_id on public.identity_events(team_id);
create index if not exists idx_transfer_listings_seller_team_id on public.transfer_listings(seller_team_id);
create index if not exists idx_auction_proxy_bids_team_id on public.auction_proxy_bids(team_id);
create index if not exists idx_season_standings_team_id on public.season_standings(team_id);
create index if not exists idx_transfer_offers_rider_id on public.transfer_offers(rider_id);
create index if not exists idx_admin_log_target_rider_id on public.admin_log(target_rider_id);
create index if not exists idx_season_documentaries_team_id on public.season_documentaries(team_id);
create index if not exists idx_swap_offers_offered_rider_id on public.swap_offers(offered_rider_id);
create index if not exists idx_swap_offers_receiving_team_id on public.swap_offers(receiving_team_id);
create index if not exists idx_swap_offers_proposing_team_id on public.swap_offers(proposing_team_id);
create index if not exists idx_swap_offers_requested_rider_id on public.swap_offers(requested_rider_id);
create index if not exists idx_training_week_plans_rider_id on public.training_week_plans(rider_id);
create index if not exists idx_team_rider_role_rules_rider_id on public.team_rider_role_rules(rider_id);
create index if not exists idx_fairplay_flags_team_id_lo on public.fairplay_flags(team_id_lo);
create index if not exists idx_fairplay_flags_team_id_hi on public.fairplay_flags(team_id_hi);
create index if not exists idx_forum_posts_team_id on public.forum_posts(team_id);
create index if not exists idx_forum_replies_team_id on public.forum_replies(team_id);
create index if not exists idx_board_request_log_team_id on public.board_request_log(team_id);
create index if not exists idx_player_feedback_team_id on public.player_feedback(team_id);
create index if not exists idx_pending_race_result_rows_rider_id on public.pending_race_result_rows(rider_id);
create index if not exists idx_hall_of_fame_team_id on public.hall_of_fame(team_id);
create index if not exists idx_fairplay_whitelisted_pairs_team_id_hi on public.fairplay_whitelisted_pairs(team_id_hi);

-- Post-verify (kørt 23/8): genkør FK-uden-indeks-forespørgslen fra cutover-loggen —
-- 0 rækker med has_leading_index=false for tabeller der refererer riders/teams.
