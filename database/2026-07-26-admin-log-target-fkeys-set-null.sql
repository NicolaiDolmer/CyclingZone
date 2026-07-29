-- Cutover 26/7 (#2851-reconcile / #2846): admin_log er en audit-tabel — dens
-- rækker skal overleve at subjektet slettes (samme design som activity_feed og
-- race_results). De oprindelige FK'er var NO ACTION og blokerede AI-trim, når en
-- admin-handling havde rørt en AI-rytter (én auction_cancel-række fra 29/6
-- stoppede sletningen af 24 AI-hold under pyramide-komprimeringen).
--
-- APPLIED i prod 26/7 ~21:15 via Supabase MCP (migration
-- 'admin_log_target_fkeys_set_null') + post-verificeret (confdeltype='n' for
-- begge). Denne fil er repo-recorden. Idempotent: drop if exists + add.
--
-- NB: loans.team_id + transfer_offers.seller_team_id/rider_id har fortsat
-- NO ACTION (0 blokerende rækker 26/7) — bevidst udeladt her; de er ikke
-- audit-tabeller og fortjener egen semantik-beslutning.

alter table admin_log drop constraint if exists admin_log_target_rider_id_fkey;
alter table admin_log add constraint admin_log_target_rider_id_fkey
  foreign key (target_rider_id) references riders(id) on delete set null;

alter table admin_log drop constraint if exists admin_log_target_team_id_fkey;
alter table admin_log add constraint admin_log_target_team_id_fkey
  foreign key (target_team_id) references teams(id) on delete set null;

-- Post-verify:
--   select conname, confdeltype from pg_constraint
--   where conname in ('admin_log_target_rider_id_fkey','admin_log_target_team_id_fkey');
--   → begge 'n' (SET NULL)
