-- Progression L0 — passiv udviklings-motor (#1137 / epic #1136)
-- ============================================================
-- Ejer-besluttet 2026-06-07: udvikling muterer de afledte abilities DIREKTE
-- (rider_derived_abilities), ikke PCM-stats. Denne migration tilføjer den state
-- motoren har brug for. Additiv + idempotent — bryder intet eksisterende flow.
--
--   1. ability_caps      — uforanderligt loft (potential ability) pr. rytter,
--                          lazy-init fra baseline ved første udviklings-kørsel.
--   2. rider_development_log — én row pr. (rytter, sæson): idempotens-guard
--                          (UNIQUE) OG #918-historik (ability/value-snapshot).
--   3. notification-type 'rider_retired' — semi-auto retirement-varsel.

-- ── 1. Loft pr. rytter (JSONB: { climbing: 90, sprint: 40, ... }) ──────────────
ALTER TABLE rider_derived_abilities
  ADD COLUMN IF NOT EXISTS ability_caps JSONB;

COMMENT ON COLUMN rider_derived_abilities.ability_caps IS
  'Potentiale-loft pr. evne (#1137). Sat ÉN gang fra baseline (lazy-init i '
  'riderProgression). current bevæger sig mod dette loft; uforanderligt.';

-- ── 2. Udviklings-log: idempotens-guard + sæson-snapshot til #918-graf ─────────
CREATE TABLE IF NOT EXISTS rider_development_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id            UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  season_id           UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  season_number       INTEGER,
  age                 INTEGER,
  abilities           JSONB NOT NULL,          -- current abilities EFTER denne sæsons udvikling
  base_value          INTEGER,                 -- base_value EFTER udvikling (graf-punkt)
  retired_this_season BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rider_id, season_id)                 -- idempotens: én udvikling pr. rytter pr. sæson
);

-- #918 tegner én rytters bane: hurtig opslag på rider_id, sorteret efter sæson.
CREATE INDEX IF NOT EXISTS idx_rider_development_log_rider
  ON rider_development_log (rider_id, season_number);

COMMENT ON TABLE rider_development_log IS
  'Progression L0 (#1137): idempotens-guard for season-transition-udvikling + '
  'per-sæson ability/value-snapshot til Udvikling-fanen (#918).';

-- RLS: kun service-role skriver (motoren). Læsning til #918 går via backend-API
-- (service-role), så vi spejler rider_derived_abilities' lukkede mønster: ingen
-- public policy → kun service-role (bypasser RLS) har adgang.
ALTER TABLE rider_development_log ENABLE ROW LEVEL SECURITY;

-- ── 3. Retirement-notifikation ────────────────────────────────────────────────
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'bid_received','bid_placed','auction_won','auction_lost','auction_outbid','auction_proxy_outbid',
  'transfer_offer_received','transfer_offer_accepted','transfer_offer_rejected','transfer_counter',
  'transfer_offer_withdrawn','transfer_interest',
  'new_race','race_results_imported','season_started','season_ended',
  'board_update','board_critical','salary_paid','sponsor_paid',
  'watchlist_rider_listed','watchlist_rider_auction','loan_created','emergency_loan','loan_paid_off',
  'deadline_day_warning','auction_cancelled','squad_enforced',
  'rider_retired'
]::text[]));
