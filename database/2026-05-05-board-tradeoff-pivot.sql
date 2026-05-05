-- S-02g · Manager-konkurrence + mid-season + drej-låsninger
-- Master roadmap: docs/slices/02-board-redesign-MASTER.md (S-02g leverer-listen)
--
-- Tilføjer 3 nye kolonner på board_profiles:
--   1. tradeoff_active_until_season_id  — UUID ref til seasons.id. Når sat = der ligger
--      en deferred tradeoff-stramning på næste plan-renewal i denne sæson. Clears efter apply.
--   2. tradeoff_payload                  — JSONB med stramnings-detaljer:
--        { kind: 'tighten_identity_riders', delta: 1 }   (lower_results_pressure approved)
--        { kind: 'raise_sponsor_growth_target', delta_pct: 5 }   (ease_identity_requirements approved)
--      Læses ved auto-accept + manager-renewal i goal-generation, anvendes vha. applyTradeoffTighteningToGoals.
--   3. major_pivot_used_at               — TIMESTAMPTZ. Sat når en MAJOR focus-skift-request
--      er approved (more_youth_focus FRA star_signing ELLER more_results_focus FRA youth_development).
--      Cool-down: må kun bruges ÉN gang pr. plan-livscyklus. Reset til NULL når plan renews
--      (via samme upsert-path som seasons_completed=0).
--
-- Mid-season-banner (F2) introducerer ingen nye DB-felter — banner-state spores via
-- notifications-tabel m. dedup på (team_id, season_id, related_id=board_id, type='board_critical',
-- title prefix 'Mid-season check'). Notification dedup-vindue (24h) er ikke relevant her
-- fordi vi tjekker på exact-match titel + season_id.

BEGIN;

-- 1. tradeoff_active_until_season_id — FK til seasons (NULL = ingen aktiv tradeoff)
ALTER TABLE board_profiles
  ADD COLUMN IF NOT EXISTS tradeoff_active_until_season_id UUID REFERENCES seasons(id) ON DELETE SET NULL;

-- 2. tradeoff_payload — JSONB stramnings-payload (NULL ved ingen aktiv tradeoff)
ALTER TABLE board_profiles
  ADD COLUMN IF NOT EXISTS tradeoff_payload JSONB;

-- 3. major_pivot_used_at — timestamp for ÉN MAJOR pivot pr. plan-livscyklus
ALTER TABLE board_profiles
  ADD COLUMN IF NOT EXISTS major_pivot_used_at TIMESTAMPTZ;

-- Index for cleanup-cron lookups (find aktive tradeoffs der skal anvendes)
CREATE INDEX IF NOT EXISTS idx_board_profiles_tradeoff_active
  ON board_profiles(tradeoff_active_until_season_id)
  WHERE tradeoff_active_until_season_id IS NOT NULL;

COMMENT ON COLUMN board_profiles.tradeoff_active_until_season_id IS
  'S-02g: Deferred tradeoff-stramning fra approved board request. Anvendes på næste renewal når active_season.id matcher. Clears til NULL efter apply.';

COMMENT ON COLUMN board_profiles.tradeoff_payload IS
  'S-02g: Tradeoff-detaljer pr. request-type. lower_results_pressure → {kind: tighten_identity_riders, delta: 1}. ease_identity_requirements → {kind: raise_sponsor_growth_target, delta_pct: 5}.';

COMMENT ON COLUMN board_profiles.major_pivot_used_at IS
  'S-02g: Sat når MAJOR focus-skift-request approved (krydsninger youth↔star). Reset til NULL ved plan-renewal. Blokerer videre MAJOR pivots i samme plan-livscyklus.';

COMMIT;
