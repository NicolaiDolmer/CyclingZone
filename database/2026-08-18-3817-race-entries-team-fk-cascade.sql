-- #3817 — race_entries_team_id_fkey: ON DELETE SET NULL -> ON DELETE CASCADE.
-- =============================================================================
--
-- SYMPTOM (verificeret mod prod 18/8): 36 race_entries-raekker havde
-- team_id IS NULL (alle is_auto_filled=true, 12 loeb, oprettet 29/6-22/7,
-- alle paa afsluttede loeb i saeson 1). Se backend/scripts/audit-orphaned-
-- race-entries.js for et gentageligt, laese-kun report af det praecise antal.
--
-- ROD-AARSAG: race_entries_team_id_fkey var ON DELETE SET NULL, mens saeskend-
-- FK'en race_entries_rider_id_fkey allerede er ON DELETE CASCADE. Naar et hold
-- slettes, forsvandt entries derfor ikke som rytter-sletning goer -- de fik
-- bare team_id = NULL og blev liggende for evigt: entry-generatorens diff
-- arbejder pr. (race_id, team_id)-enhed og filtrerer hver skrivning paa
-- .eq("team_id", teamId) (backend/lib/raceEntryGenerator.js, applyUnitDiff).
-- En raekke med team_id = NULL matcher ingen enhed og er derfor usynlig for
-- sin egen oprydning -- for evigt, ikke kun indtil naeste sweep.
--
-- FIX: match rider_id-FK'en. Naar et hold slettes, forsvinder dets rytteres
-- entries nu ligesom naar en rytter selv slettes -- ingen holdloese rester.
--
-- SCOPE: aendrer KUN adfaerd for FREMTIDIGE team-sletninger. Rorer IKKE de
-- 36 eksisterende historiske raekker (afsluttede loeb, afsluttet saeson,
-- ingen aktiv skade pt. -- se issue #3817 "Nuvaerende skade: ingen aktiv").
-- Om de 36 skal repareres/slettes er en separat ejer-gated beslutning
-- (issue #3817, "Foreslaaede naeste skridt" #3) og haandteres IKKE her.
--
-- IDEMPOTENT: DROP CONSTRAINT IF EXISTS + betinget re-add (DO-blok-guard
-- springer re-add'en over hvis constrainten allerede er CASCADE) -- re-run
-- er et no-op. Ingen data-mutation, ingen table-rewrite (FK-typen aendres,
-- ikke kolonnen).
--
-- OWNER-GATE: denne fil koeres IKKE automatisk. Applies af Claude EFTER
-- ejer-review, jf. hard rule 9 / #2642-rammerne i AGENTS.md.
--
-- ROLLBACK:
--   ALTER TABLE public.race_entries DROP CONSTRAINT IF EXISTS race_entries_team_id_fkey;
--   ALTER TABLE public.race_entries
--     ADD CONSTRAINT race_entries_team_id_fkey
--     FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;
--
-- VERIFIKATION (efter apply, koer mod prod):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname = 'race_entries_team_id_fkey';
--   -> FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
--
--   -- De 36 historiske raekker skal fortsat vaere uroerte (uaendret antal):
--   SELECT count(*) FROM race_entries WHERE team_id IS NULL;  -- forventet: 36 (uaendret)

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'race_entries_team_id_fkey'
      AND confdeltype = 'c' -- allerede CASCADE
  ) THEN
    ALTER TABLE public.race_entries
      DROP CONSTRAINT IF EXISTS race_entries_team_id_fkey;

    ALTER TABLE public.race_entries
      ADD CONSTRAINT race_entries_team_id_fkey
      FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;
