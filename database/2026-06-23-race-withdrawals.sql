-- Race Hub Fase 0b: afmeld-state. Et hold kan trække sig fra et løb (frivillig
-- deltagelse). Generatoren + afviklingen springer afmeldte (race, team) over.
-- RLS-mønster spejler race_entries (2026-06-07-race-engine-slice2.sql).
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS før CREATE.
-- schema_migrations-insert håndteres af .github/workflows/auto-migrate.yml.

CREATE TABLE IF NOT EXISTS public.race_withdrawals (
  race_id          UUID NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  team_id          UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  withdrawn_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_reason TEXT,
  PRIMARY KEY (race_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_race_withdrawals_team ON public.race_withdrawals(team_id);

ALTER TABLE public.race_withdrawals ENABLE ROW LEVEL SECURITY;

-- Player-facing: alle authenticated kan læse (afmeldings-status vises i UI).
DROP POLICY IF EXISTS "race_withdrawals_select_authenticated" ON public.race_withdrawals;
CREATE POLICY "race_withdrawals_select_authenticated"
  ON public.race_withdrawals FOR SELECT TO authenticated USING (true);

-- Skrivning sker via service_role (backend-endpoint) — ingen direkte klient-write.
GRANT SELECT ON public.race_withdrawals TO authenticated;

COMMENT ON TABLE public.race_withdrawals IS
  'Race Hub Fase 0b: afmeld-tracking. (race_id, team_id) = holdet har trukket sig fra løbet.';

-- Feature-flag (fail-safe OFF: generatoren er additiv; gammel fillMissingTeamEntries
-- bevares som fallback indtil flaget er bekræftet i prod). value er JSONB i app_config
-- (2026-05-16-app-config.sql) → seed JSON-strengen "off" via '"off"'::jsonb, så
-- featureStage.readFlagStage returnerer JS-strengen "off" (off/beta/on tre-tilstand,
-- spejler stage_scheduler_enabled / race_engine_v2_enabled).
INSERT INTO public.app_config (key, value, description)
VALUES (
  'auto_entry_generator_enabled',
  '"off"'::jsonb,
  'Race Hub Fase 0b: proaktiv entry-generator. on = runRaceEntryGenerator genererer kalenderens trupper ved sæsonstart/ny kalender + admin-trigger; off (default) = gammel reaktiv fillMissingTeamEntries-autofill er eneste sti. Flip kun efter prod-bekræftelse.'
)
ON CONFLICT (key) DO NOTHING;
