-- Rider derived-ability history (#2000 Part 2 / #918) — Development-fanens datalag
-- ============================================================================
-- Erstatter den PCM-baserede rider_stat_history-feed (UCI/sheets-sync, død post-
-- relaunch, #1207). Snapshotter den fulde 15-evne-vektor (rider_derived_abilities)
-- over tid, så Udvikling-fanen kan tegne rytterens udvikling (overall-rating pr.
-- ryttertype, #2000) UDEN at læse PCM-kolonner.
--
-- Additiv + idempotent. Fodres af to best-effort write-hooks (rating-uafhængigt):
--   1. dailyTrainingEngine.runTeamTrainingDay  → source='daily_training' (pr. tick m. gevinst)
--   2. riderProgressionEngine.developRidersForSeason → source='season_transition' (pr. sæson, alle)
-- Migrationen seeder desuden ÉT 'baseline'-punkt pr. rytter fra nuværende abilities,
-- så fanen ikke er tom indtil første tick/transition.
--
-- abilities lagres som JSONB (ikke 15 kolonner): matcher rider_development_log's
-- mønster, og type-ratingen er en ren VISNINGS-projektion (abilities → rating pr.
-- type) der påføres ved læsning — så rating-formlen kan kalibreres (#1378) uden
-- data-migration. RLS-lukket: kun service-role skriver/læser; frontend læser via
-- backend-API (GET /api/riders/:id/development), spejler rider_derived_abilities.

CREATE TABLE IF NOT EXISTS rider_derived_ability_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id      UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,                  -- logisk dag (tick_date / transition-dato); x-akse + dedup
  source        TEXT NOT NULL                   -- provenance + lader grafen skelne milepæl vs daglig
                  CHECK (source IN ('daily_training', 'season_transition', 'baseline')),
  season_number INTEGER,                         -- sat når kendt (kontekst)
  abilities     JSONB NOT NULL,                  -- fulde 15-evne-vektor (post-tick / post-udvikling)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rider_id, snapshot_date, source)       -- idempotens: re-run skriver ikke dubletter
);

-- #918 tegner én rytters bane: hurtigt opslag pr. rytter, sorteret kronologisk.
CREATE INDEX IF NOT EXISTS idx_rider_ability_history_rider
  ON rider_derived_ability_history (rider_id, snapshot_date);

COMMENT ON TABLE rider_derived_ability_history IS
  'Per-snapshot evne-vektor (#2000/#918) til Udvikling-fanen. Fodres af daily-training- '
  'og season-transition-hooks (best-effort). Type-rating beregnes ved visning fra abilities.';

-- RLS: kun service-role (motoren + backend-API). Ingen public policy → spejler
-- rider_derived_abilities/rider_development_log's lukkede mønster.
ALTER TABLE rider_derived_ability_history ENABLE ROW LEVEL SECURITY;

-- ── Baseline-seed: ét punkt pr. rytter fra nuværende abilities ────────────────
-- Gør fanen meningsfuld fra dag 1 (før første tick/transition). ON CONFLICT DO
-- NOTHING → re-kørsel af migrationen er sikker; rører ikke senere rigtige snapshots.
INSERT INTO rider_derived_ability_history (rider_id, snapshot_date, source, season_number, abilities)
SELECT
  rda.rider_id,
  CURRENT_DATE,
  'baseline',
  (SELECT number FROM seasons WHERE status = 'active' ORDER BY number DESC LIMIT 1),
  jsonb_build_object(
    'climbing',     rda.climbing,
    'time_trial',   rda.time_trial,
    'flat',         rda.flat,
    'tempo',        rda.tempo,
    'sprint',       rda.sprint,
    'acceleration', rda.acceleration,
    'punch',        rda.punch,
    'endurance',    rda.endurance,
    'recovery',     rda.recovery,
    'durability',   rda.durability,
    'descending',   rda.descending,
    'cobblestone',  rda.cobblestone,
    'positioning',  rda.positioning,
    'aggression',   rda.aggression,
    'tactics',      rda.tactics
  )
FROM rider_derived_abilities rda
ON CONFLICT (rider_id, snapshot_date, source) DO NOTHING;
