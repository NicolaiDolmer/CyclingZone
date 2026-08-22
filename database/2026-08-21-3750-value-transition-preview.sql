-- #3750/#4000 · Preview-tabel til admin-siden "Værdi-overgangen".
-- Ejer-ønske 21/8: værdierne (og de forventede lønninger) skal kunne SES og
-- vurderes inde i appen før apply — ikke kun i CLI-dry-runs.
--
-- Tabellen er en REN forhåndsvisning: den skrives kun af
-- backend/scripts/buildValueTransitionPreview.js (service role), læses kun af
-- admin-endpointet, og rører ingen spil-tilstand. Kan trunkeres/genbygges frit.
-- Idempotent (IF NOT EXISTS hele vejen).

CREATE TABLE IF NOT EXISTS value_transition_preview (
  rider_id uuid PRIMARY KEY REFERENCES riders(id) ON DELETE CASCADE,
  team_id uuid,
  value_now bigint NOT NULL,
  value_damped bigint,              -- v4 med k=100-dæmpning + ×1,230-normalisering, FØR c
  cpv_now bigint,                   -- current_production_value som gemt i dag
  cpv_damped bigint,                -- CPV under dæmpet model
  salary_now bigint,                -- rider.salary som gemt (frossen kontrakt)
  salary_expected bigint,           -- computeFrozenSalary(cpv_damped) = forventet S3-løn ved genberegning EFTER dæmpnings-flip
  salary_expected_no_damp bigint,   -- computeFrozenSalary(cpv_now) = forventet S3-løn HVIS dæmpningen ikke flippes før søndag
  valuation_type text,              -- frossen type (den værdien beregnes af i dag)
  primary_type text,                -- ny caps-baseret type (#3353-skiftet)
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS value_transition_preview_team_idx
  ON value_transition_preview (team_id);

ALTER TABLE value_transition_preview ENABLE ROW LEVEL SECURITY;
-- Ingen policies med vilje: kun service role (backend) kan læse/skrive.
-- Admin-endpointet i backend/routes/api.js er den eneste læsevej.
