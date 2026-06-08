-- Progression L1 — scouting & skjult potentiale (#1138 / epic #1136)
-- ============================================================
-- Ejer-besluttet 2026-06-07/08: scouting = BEGRÆNSET KAPACITET (N slots/sæson),
-- ingen penge (fair-premium). Estimatet er PER-MANAGER (seedet) og indsnævres
-- trinvist mod den sande potentiale (riders.potentiale) jo mere man scouter.
--
-- Display-lag v1 (#1138): estimatet beregnes i frontend ud fra (sand potentiale +
-- scout-niveau + seed). Backend ejer KUN ledgeren — antal scout-handlinger pr.
-- (hold, rytter) → scout-niveau, og antal handlinger pr. (hold, sæson) → brugte
-- slots. Ægte server-skjuling af potentiale er en separat senere slice.
--
-- Event-ledger frem for muteret tæller, fordi det giver BÅDE afledninger gratis,
-- er idempotens-venligt, og kræver ingen sæson-reset-hook (slots udledes pr.
-- aktiv sæson). Additiv + idempotent — rører intet eksisterende flow.

CREATE TABLE IF NOT EXISTS scout_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
  rider_id    UUID NOT NULL REFERENCES riders(id)  ON DELETE CASCADE,
  season_id   UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Scout-niveau pr. (hold, rytter) = COUNT(*) → hurtig aggregering pr. hold.
CREATE INDEX IF NOT EXISTS idx_scout_actions_team_rider
  ON scout_actions (team_id, rider_id);

-- Brugte slots pr. (hold, sæson) = COUNT(*) → hurtig kapacitets-check.
CREATE INDEX IF NOT EXISTS idx_scout_actions_team_season
  ON scout_actions (team_id, season_id);

COMMENT ON TABLE scout_actions IS
  'Progression L1 (#1138): event-ledger for scout-handlinger. '
  'COUNT pr. (team,rider) = scout-niveau; COUNT pr. (team,season) = brugte slots. '
  'Estimat-bredde udledes af niveau i frontend (display-lag v1).';

-- RLS: et hold må kun se/skrive sine egne scout-handlinger. Backend bruger
-- service-role (bypasser RLS) til alle scouting-routes, men policy'en holder
-- direkte klient-læsning sikker hvis vi senere eksponerer den.
ALTER TABLE scout_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scout_actions_own_select" ON scout_actions;
CREATE POLICY "scout_actions_own_select" ON scout_actions
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "scout_actions_own_insert" ON scout_actions;
CREATE POLICY "scout_actions_own_insert" ON scout_actions
  FOR INSERT TO authenticated
  WITH CHECK (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));
