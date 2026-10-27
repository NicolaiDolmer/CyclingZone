-- #5982: luksushjaelperen ('luxury_helper') som syvende race_role. ADDITIV.
-- Ejer 26/10 (designbord S10): kaptajnens luksushjaelper, hoejst én pr. hold, med i
-- s5_profiles_v3. Spec: docs/superpowers/specs/2026-10-25-taktik-roller-design.md
-- (§5, §9, §11) og docs/RACE_ENGINE_RULES.md §1.
--
-- Constrainten er det permanente vokabular; API'et er gaten. raceSelection.js og
-- raceStageRolesApi.js afviser rollen i loeb paa revisioner foer s5_profiles_v3.
-- Appens vaelger kommer som opfoelgning, saa indtil da baerer ingen raekke rollen.
-- Eksisterende raekker roeres ikke (udvidelsen tilfoejer kun en gyldig vaerdi).
--
-- Bygger oven paa 2026-10-25-5981-co-captain-role.sql (co_captain er med i listen).
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + navngivet ADD CONSTRAINT ... NOT VALID +
-- VALIDATE CONSTRAINT (samme constraint-navne som #5981) og CREATE UNIQUE INDEX
-- CONCURRENTLY IF NOT EXISTS. Re-run = no-op. NOT VALID + VALIDATE: ADD tager kun en
-- kort laas og scanner ikke tabellen; VALIDATE scanner med en svagere laas, saa
-- spillernes skrivninger til race_entries ikke blokeres af scanningen.
--
-- Applies af CI ved merge (.github/workflows/auto-migrate.yml). Ingen agent har
-- koert SQL mod prod for denne fil.

-- Lock safety (#6342, docs/MIGRATIONS.md): giv op hurtigt i stedet for at blokere
-- spillernes laesninger; auto-migrate kan koeres igen.
SET lock_timeout = '3s';

-- ── 1) race_entries.race_role: + 'luxury_helper' ──────────────────────────────
ALTER TABLE public.race_entries
  DROP CONSTRAINT IF EXISTS race_entries_race_role_check;

ALTER TABLE public.race_entries
  ADD CONSTRAINT race_entries_race_role_check
    CHECK (race_role IN ('captain', 'sprint_captain', 'hunter', 'helper', 'free_role', 'co_captain', 'luxury_helper'))
    NOT VALID;

ALTER TABLE public.race_entries
  VALIDATE CONSTRAINT race_entries_race_role_check;

-- Hoejst én luksushjaelper pr. (loeb, hold), som de andre eksklusive roller.
-- CONCURRENTLY (top-level, uden transaktion): blokerer ikke skrivninger til race_entries.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_race_entries_luxury_helper
  ON public.race_entries(race_id, team_id) WHERE race_role = 'luxury_helper';

COMMENT ON COLUMN public.race_entries.race_role IS
  '#1307/#2352/#5981/#5982: captain/sprint_captain/hunter/helper/free_role/co_captain/luxury_helper. Default helper. free_role = 0 work-cost, 0 holdbidrag. co_captain (#5981) = delt kaptajn. luxury_helper (#5982) = luksushjaelper. Begge kun i loeb paa s5_profiles_v3+ og hoejst én pr. hold.';

-- ── 2) race_stage_roles.race_role: + 'luxury_helper' ──────────────────────────
ALTER TABLE public.race_stage_roles
  DROP CONSTRAINT IF EXISTS race_stage_roles_race_role_check;

ALTER TABLE public.race_stage_roles
  ADD CONSTRAINT race_stage_roles_race_role_check
    CHECK (race_role IN ('captain', 'sprint_captain', 'helper', 'hunter', 'free_role', 'co_captain', 'luxury_helper'))
    NOT VALID;

ALTER TABLE public.race_stage_roles
  VALIDATE CONSTRAINT race_stage_roles_race_role_check;

-- ── Post-verify (KOER MANUELT efter merge; ingen del af migrationen) ──────────
--
--    SELECT conrelid::regclass, conname, convalidated, pg_get_constraintdef(oid)
--      FROM pg_constraint
--     WHERE conname IN ('race_entries_race_role_check', 'race_stage_roles_race_role_check');
--    -- forventet: begge indeholder 'luxury_helper' og 'co_captain', convalidated = true
--
--    SELECT indexname FROM pg_indexes WHERE indexname = 'uq_race_entries_luxury_helper';
--    -- forventet: én raekke
--
--    SELECT count(*) FROM public.race_entries WHERE race_role = 'luxury_helper';
--    -- forventet: 0 (appens vaelger findes endnu ikke; opfoelgning efter #7265)
