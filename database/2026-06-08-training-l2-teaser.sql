-- Progression L2 — træning (teaser): sæson-granulær træningsfokus (#1163 / epic #931 / #1136)
-- ============================================================
-- Ejer-besluttet 2026-06-08 (design-session): tynd teaser til 20/6 + fuld
-- Zwift/TrainingPeaks-epic post-launch. En manager vælger en TRÆNINGSFOKUS +
-- intensitet for op til N nøgleryttere pr. sæson. Ved sæson-skift biaser det den
-- passive progressions-motor (#1137) mod cap — MEN biasen er gated bag samme flag
-- (SEASON_RIDER_PROGRESSION_ENABLED) som #1137, så ved launch er dette intent+UI
-- (konsistent med hvordan scouting #1138 shippede som display-v1).
--
-- Event-ledger (additiv, idempotent) som scout_actions — men UNIQUE(team, rider,
-- season) fordi træning er ÉN aktiv plan pr. rytter/sæson (ikke akkumulerende
-- niveau som scouting). Om-målretning = upsert (koster ikke nyt slot); fjern plan
-- = DELETE (frigør slot). Brugte slots pr. (hold, sæson) = COUNT(*) i den sæson.
-- Rører intet eksisterende flow.

CREATE TABLE IF NOT EXISTS training_plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
  rider_id    UUID NOT NULL REFERENCES riders(id)  ON DELETE CASCADE,
  season_id   UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  focus       TEXT NOT NULL,
  intensity   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Ét aktivt fokus pr. (hold, rytter, sæson). Om-målretning upserter denne row.
  CONSTRAINT training_plans_team_rider_season_uniq UNIQUE (team_id, rider_id, season_id)
);

-- Brugte slots pr. (hold, sæson) = COUNT(*) → hurtig kapacitets-check.
CREATE INDEX IF NOT EXISTS idx_training_plans_team_season
  ON training_plans (team_id, season_id);

-- Engine slår op pr. (sæson) og matcher mod rytterens current team_id.
CREATE INDEX IF NOT EXISTS idx_training_plans_season
  ON training_plans (season_id);

COMMENT ON TABLE training_plans IS
  'Progression L2 teaser (#1163): én aktiv træningsfokus pr. (team,rider,season). '
  'COUNT pr. (team,season) = brugte slots. Biaser #1137 mod cap ved sæson-skift '
  '(gated bag SEASON_RIDER_PROGRESSION_ENABLED). focus/intensity valideres i app-kode.';

-- RLS: et hold må kun se/skrive sine egne planer. Backend bruger service-role
-- (bypasser RLS) til alle training-routes; policy'en holder direkte klient-læsning
-- sikker hvis vi senere eksponerer den.
ALTER TABLE training_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "training_plans_own_select" ON training_plans;
CREATE POLICY "training_plans_own_select" ON training_plans
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "training_plans_own_insert" ON training_plans;
CREATE POLICY "training_plans_own_insert" ON training_plans
  FOR INSERT TO authenticated
  WITH CHECK (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "training_plans_own_update" ON training_plans;
CREATE POLICY "training_plans_own_update" ON training_plans
  FOR UPDATE TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()))
  WITH CHECK (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "training_plans_own_delete" ON training_plans;
CREATE POLICY "training_plans_own_delete" ON training_plans
  FOR DELETE TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));
