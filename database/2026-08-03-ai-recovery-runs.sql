-- AI-rytter-restitution (#3015) — mutex-tabel for den daglige AI-recovery-sweep.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS. Mønster kopieret 1:1 fra scout_sweep_runs
-- (2026-07-10-scout-assignments.sql): PRIMARY KEY(team_id, tick_date) er selve
-- mutex'en (INSERT-som-reservation, 23505-kollision = "kørt allerede i dag" —
-- se runAiRecoverySweep i backend/lib/aiRecoverySweep.js). Ingen SELECT-policy:
-- kun service-role (cron) rører denne tabel, RLS default-deny for authenticated
-- er tilsigtet (samme som scout_sweep_runs — ingen bruger skal læse den).
--
-- Bevidst IKKE genbrug af training_day_runs: den tabel har CHECK executed_by IN
-- ('manager','assistant') og report er et menneske-rettet trænings-resumé.
-- AI-recovery er en anden, meget mindre mekanik (kun fatigue/form, ingen
-- ability-vækst, ingen skaderisiko) og fortjener sin egen idempotens-anker
-- frem for at overloade menneskeholdenes rapport-skema.

CREATE TABLE IF NOT EXISTS public.ai_recovery_runs (
  team_id          UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  tick_date        DATE NOT NULL,
  riders_recovered INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, tick_date)
);

ALTER TABLE public.ai_recovery_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ai_recovery_runs IS
  'AI-rytter-restitution (#3015): idempotens-anker for den daglige AI-recovery-sweep — '
  'PRIMARY KEY(team_id, tick_date) sikrer at hvert AI-hold kun kører ét dagligt '
  'recovery-tick. Ingen SELECT-policy (service-role only, mirror af scout_sweep_runs).';
