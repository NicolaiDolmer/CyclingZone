-- database/2026-08-04-3249-form-reset-decay-claim.sql
-- #3249 — claim-tabel (idempotens pr. sæson) mod dobbelt-decay i
-- applySeasonFormReset (backend/lib/seasonFormReset.js). Samme mønster som
-- season_fatigue_reset_runs (#2910, database/2026-07-25-season-start-hooks.sql)
-- og academy_season_intake_runs (#2911): claim-FØRST, PK-kollision på season_id
-- betyder "allerede kørt for denne sæson".
--
-- KUN mode "decay" claimer denne tabel — "baseline" og "band" er allerede
-- bevisligt idempotente (ren konstant-funktion hhv. seedet på rytter+sæson,
-- se seasonFormReset.js' modul-docstring) og har ikke brug for en guard.
--
-- completed_at NULL + rækken findes = en kørsel døde undervejs (formen er
-- delvist decayet) → manuel undersøgelse, ikke blind retry.
--
-- Ren skema-migration, INGEN seeds. Idempotent (CREATE TABLE IF NOT EXISTS) —
-- sikker at replaye.

CREATE TABLE IF NOT EXISTS season_form_reset_runs (
  season_id UUID PRIMARY KEY REFERENCES seasons(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  riders INTEGER,
  changed INTEGER,
  avg_before NUMERIC(5,1),
  avg_after NUMERIC(5,1),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Service-role-only (ingen policies = deny for anon/authenticated; service
-- role bypasser RLS). Spejler season_fatigue_reset_runs.
ALTER TABLE season_form_reset_runs ENABLE ROW LEVEL SECURITY;
