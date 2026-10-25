-- #5981: delt kaptajn ('co_captain') som sjette race_role. ADDITIV.
-- Spec: docs/superpowers/specs/2026-10-25-taktik-roller-design.md §5 + §11
-- (ejer-beslutninger 25/10: ny rolle, hoejst én pr. hold, med i s5_profiles_v3).
--
-- Constrainten er det permanente vokabular; API'et er gaten. Saa laenge intet loeb
-- er bundet til s5_profiles_v3 (slukket), afviser raceSelection.js og
-- raceStageRolesApi.js rollen, og ingen raekke kan baere den. Eksisterende raekker
-- roeres ikke (udvidelsen tilfoejer kun en gyldig vaerdi).
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + navngivet ADD CONSTRAINT (samme
-- moenster som 2026-07-12-race-v3-s1-work-cost.sql og 2026-09-06-4632-effort-
-- five-steps.sql) + CREATE UNIQUE INDEX IF NOT EXISTS. Re-run = no-op.
--
-- Applies af CI ved merge (.github/workflows/auto-migrate.yml). Ingen agent har
-- koert SQL mod prod for denne fil.

-- ── 1) race_entries.race_role: + 'co_captain' ─────────────────────────────────
ALTER TABLE public.race_entries
  DROP CONSTRAINT IF EXISTS race_entries_race_role_check;

ALTER TABLE public.race_entries
  ADD CONSTRAINT race_entries_race_role_check
    CHECK (race_role IN ('captain', 'sprint_captain', 'hunter', 'helper', 'free_role', 'co_captain'));

-- Hoejst én delt kaptajn pr. (loeb, hold), som de andre leder-roller.
CREATE UNIQUE INDEX IF NOT EXISTS uq_race_entries_co_captain
  ON public.race_entries(race_id, team_id) WHERE race_role = 'co_captain';

COMMENT ON COLUMN public.race_entries.race_role IS
  '#1307/#2352/#5981: captain/sprint_captain/hunter/helper/free_role/co_captain. Default helper. free_role = 0 work-cost, 0 holdbidrag. co_captain (#5981) = delt kaptajn, kun i loeb paa s5_profiles_v3+, hoejst én pr. hold og kun med en kaptajn.';

-- ── 2) race_stage_roles.race_role: + 'co_captain' ─────────────────────────────
-- Den oprindelige CHECK er en INLINE column-CHECK i 2026-07-12-race-v3-s1-work-cost.sql
-- (CREATE TABLE public.race_stage_roles), dvs. Postgres-navnet
-- 'race_stage_roles_race_role_check', som vi genskaber.
ALTER TABLE public.race_stage_roles
  DROP CONSTRAINT IF EXISTS race_stage_roles_race_role_check;

ALTER TABLE public.race_stage_roles
  ADD CONSTRAINT race_stage_roles_race_role_check
    CHECK (race_role IN ('captain', 'sprint_captain', 'helper', 'hunter', 'free_role', 'co_captain'));

-- ── Post-verify (KOER MANUELT efter merge; ingen del af migrationen) ──────────
--
--    SELECT conrelid::regclass, conname, pg_get_constraintdef(oid)
--      FROM pg_constraint
--     WHERE conname IN ('race_entries_race_role_check', 'race_stage_roles_race_role_check');
--    -- forventet: begge indeholder 'co_captain'
--
--    SELECT indexname FROM pg_indexes WHERE indexname = 'uq_race_entries_co_captain';
--    -- forventet: én raekke
--
--    SELECT count(*) FROM public.race_entries WHERE race_role = 'co_captain';
--    -- forventet: 0 (ingen skrivevej foer et loeb er bundet til s5_profiles_v3)
