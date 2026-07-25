-- #2910 + #2911 — sæsonstart-hooks: flag-rækker (fail-safe OFF) + claim-tabel til
-- akademiets sæson-optagelse. Idempotent: kan replayes uden fejl og uden at
-- overskrive en flag-værdi ejeren allerede har flippet.

-- ── #2911 · claim-tabel (idempotens pr. hold + sæson) ───────────────────────
-- academy_intake-rækkerne kan IKKE bruges som guard (søndags-drippet skriver
-- dem også for samme season_id), og academy_intake_ticks kan ikke bruges fordi
-- sæsonskiftet selv kører på en søndag — drippet ville have claimet dagen først.
-- Mønster: academy_intake_ticks (claim-FØRST, PK-kollision = allerede kørt).
CREATE TABLE IF NOT EXISTS academy_season_intake_runs (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, season_id)
);

-- Service-role-only (ingen policies = deny for anon/authenticated; service role
-- bypasser RLS). Spejler academy_intake_ticks.
ALTER TABLE academy_season_intake_runs ENABLE ROW LEVEL SECURITY;

-- ── Flag-rækker · begge OFF ─────────────────────────────────────────────────
-- ON CONFLICT DO NOTHING: en re-run må ALDRIG slå en mekanik fra som ejeren har
-- slået til (eller til igen efter en kill-switch).
INSERT INTO app_config (key, value, description)
VALUES
  ('season_fatigue_reset_enabled', '"off"'::jsonb,
   '#2910 - saesonskiftet giver feltet restitution (3 hviledage gennem den daglige model). off = uaendret adfaerd.'),
  ('season_academy_intake_enabled', '"off"'::jsonb,
   '#2911 - saeson-optagelse til akademiet ved skiftet (top-up til 8 pladser, maks 3 pr. hold). off = uaendret adfaerd.')
ON CONFLICT (key) DO NOTHING;
