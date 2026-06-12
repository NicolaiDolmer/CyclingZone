-- #1307: Holdudtagelse + kaptajn/hjælpere + udbruds-jæger.
-- race_role pr. startfelt-række. Skrives KUN via backend (service_role) — RLS
-- uændret (read=authenticated, write=admin/service_role, jf. slice2-migrationen).
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.

ALTER TABLE public.race_entries
  ADD COLUMN IF NOT EXISTS race_role TEXT NOT NULL DEFAULT 'helper'
    CHECK (race_role IN ('captain', 'sprint_captain', 'hunter', 'helper'));

-- Max én af hver leder-rolle pr. (løb, hold).
CREATE UNIQUE INDEX IF NOT EXISTS uq_race_entries_captain
  ON public.race_entries(race_id, team_id) WHERE race_role = 'captain';
CREATE UNIQUE INDEX IF NOT EXISTS uq_race_entries_sprint_captain
  ON public.race_entries(race_id, team_id) WHERE race_role = 'sprint_captain';
CREATE UNIQUE INDEX IF NOT EXISTS uq_race_entries_hunter
  ON public.race_entries(race_id, team_id) WHERE race_role = 'hunter';

COMMENT ON COLUMN public.race_entries.race_role IS
  '#1307: captain/sprint_captain/hunter/helper. Default helper. Manager-udtagelse sætter roller; autopick sætter captain (+ evt. sprint_captain).';