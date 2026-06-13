-- #1308 akademi-MVP: is_academy-flag, academy_intake-kuld, youth-auktion-markering,
-- finance/notification-typer, column-privilege, feature-flag.
-- Beslutninger (ejer 13/6): is_academy-flag (ikke separat squad-tabel); kun menneske-hold;
-- fuld u-auktion-loop. Akademiryttere ekskluderes fra senior-30-cap i runtime (ikke i DB).
-- Rollback: DROP COLUMN riders.is_academy, auctions.is_youth; DROP TABLE academy_intake;
--   DELETE FROM app_config WHERE key='academy_enabled'; REVOKE SELECT (is_academy) ...;
--   gen-declare de gamle type-CHECKs uden academy-typerne.

BEGIN;

-- 1. is_academy på riders. Akademiryttere har team_id (ejet) men tæller IKKE mod senior-cap.
ALTER TABLE riders ADD COLUMN IF NOT EXISTS is_academy BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN riders.is_academy IS
  'Akademi-rytter (#1308). team_id = ejende hold, men ekskluderet fra senior-30-cap '
  '(getTeamMarketState/squadEnforcement/race-selection). Inkluderet i daglig træning '
  'med ungdoms-multiplikator. Promotion til senior = is_academy=false + senior-plads.';
CREATE INDEX IF NOT EXISTS idx_riders_team_academy ON riders(team_id, is_academy);

-- 2. is_youth på auctions (Fase B; harmløs default false nu).
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS is_youth BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN auctions.is_youth IS
  'Ungdomsauktion (#1308): afvist akademi-kandidat. Vinder placeres i akademi (8-plads-cap). '
  'Ingen bud -> free agent (team_id NULL).';

-- 3. academy_intake: kuld af tilbudte kandidater pr. hold pr. sæson.
CREATE TABLE IF NOT EXISTS academy_intake (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES seasons(id),
  is_serious BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'offered'
    CHECK (status IN ('offered','signed','rejected','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (team_id, rider_id)
);
COMMENT ON TABLE academy_intake IS
  'Akademi-intake-kuld (#1308): kandidater tilbudt et hold ved sæsonstart. status offered->signed/rejected/expired.';
CREATE INDEX IF NOT EXISTS idx_academy_intake_team_status ON academy_intake(team_id, status);

ALTER TABLE academy_intake ENABLE ROW LEVEL SECURITY;
-- Hold-ejeren kan læse eget kuld. Skrivning sker service-role (backend), ingen client-write-policy.
CREATE POLICY academy_intake_owner_read ON academy_intake
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

-- 4. Finance + notification typer: re-deklareret med de NUVÆRENDE typer (hentet fra prod
--    13/6) + akademi-typer tilføjet. Kun ADD af nye typer => ingen eksisterende række brydes.
ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_type_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (
  'sponsor','prize','salary','transfer_in','transfer_out','interest','bonus','starting_budget',
  'loan_received','loan_repayment','loan_interest','emergency_loan','admin_adjustment',
  'auto_squad_purchase','auto_squad_sale','squad_violation_fine',
  'academy_signing','academy_drift'
));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'bid_received','bid_placed','auction_won','auction_lost','auction_outbid','auction_proxy_outbid',
  'transfer_offer_received','transfer_offer_accepted','transfer_offer_rejected','transfer_counter',
  'transfer_offer_withdrawn','transfer_interest','new_race','race_results_imported',
  'season_started','season_ended','board_update','board_critical','salary_paid','sponsor_paid',
  'watchlist_rider_listed','watchlist_rider_auction','loan_created','emergency_loan','loan_paid_off',
  'deadline_day_warning','auction_cancelled','squad_enforced','rider_retired',
  'academy_intake_ready','academy_signed','academy_rejected'
));

-- 5. Column-privilege (#1162 fail-closed): is_academy SKAL eksplicit GRANTes til klient-læsning,
--    ellers er nye riders-kolonner usynlige for anon/authenticated.
GRANT SELECT (is_academy) ON riders TO anon, authenticated;

-- 6. Feature-flag (idempotent; default OFF til relaunch). app_config.value er jsonb.
INSERT INTO app_config (key, value)
VALUES ('academy_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
