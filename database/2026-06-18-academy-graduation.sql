-- #932 akademi-promotion-flow ved 22: pending-graduerings-tabel + notification-typer.
-- Beslutninger (ejer 18/6): soft default + override; sælg på normalt marked;
-- promover via ny senior-løn. Spec: docs/superpowers/specs/2026-06-18-academy-promotion-flow-design.md
--
-- ⚠️ Migration auto-applies i prod ved merge — EJEREN merger PR'en. Verificér FØRST
--    mod en disposabel Supabase-branch (notifications-constraint: seneste def vinder).

BEGIN;

-- 1. academy_graduation: akademiryttere der har passeret 21 og afventer valg.
--    Mens status='pending' beholder rytteren is_academy=true (uden for senior-cap).
CREATE TABLE IF NOT EXISTS academy_graduation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES seasons(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','promoted','sold','released','expired')),
  deadline TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (rider_id, season_id)
);
COMMENT ON TABLE academy_graduation IS
  'Akademi-graduering (#932): akademiryttere der har passeret 21 og afventer '
  'promover/sælg/slip. status pending->promoted/sold/released/expired. '
  'Mens pending: rytteren beholder is_academy=true (uden for senior-cap).';
CREATE INDEX IF NOT EXISTS idx_academy_graduation_team_status
  ON academy_graduation(team_id, status);

ALTER TABLE academy_graduation ENABLE ROW LEVEL SECURITY;
-- Hold-ejeren læser eget kuld. Skrivning sker service-role (backend), ingen client-write-policy.
DROP POLICY IF EXISTS academy_graduation_owner_read ON academy_graduation;
CREATE POLICY academy_graduation_owner_read ON academy_graduation
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

-- 2. Notification-typer: tilføj graduerings-typer. (Constraint ALTER'es flere gange —
--    seneste vinder. Listen herunder = den nuværende schema.sql-snapshot + 2 nye.)
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'bid_received','bid_placed','auction_won','auction_lost','auction_outbid','auction_proxy_outbid',
  'transfer_offer_received','transfer_offer_accepted','transfer_offer_rejected','transfer_counter',
  'transfer_offer_withdrawn','transfer_interest',
  'new_race','race_results_imported','season_started','season_ended',
  'board_update','board_critical','salary_paid','sponsor_paid',
  'watchlist_rider_listed','watchlist_rider_auction','loan_created','emergency_loan','loan_paid_off',
  'deadline_day_warning','auction_cancelled','squad_enforced','rider_retired',
  'academy_intake_ready','academy_signed','academy_rejected',
  'academy_graduation_ready','academy_graduated'
));

COMMIT;
