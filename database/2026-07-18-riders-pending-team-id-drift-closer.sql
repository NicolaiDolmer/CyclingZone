-- #2628 — Skema-drift: riders.pending_team_id findes i prod, men var ALDRIG
-- committet som en migration i database/. Denne fil er en DRIFT-LUKKER, ikke
-- en ny feature-migration: den gør prod-tilstanden eksplicit/reproducerbar og
-- lukker hullet i PGlite-kontrakt-test-harnessen (backend/lib/testdb/createTestDb.js).
--
-- OPRINDELSE (verificeret via git log -S + PR-historik, se PR-body for detaljer):
--   `pending_team_id` er ældre end den nuværende database/-migrationsdisciplin.
--   Commit 450156c4 ("Transfer window system...", 16/4-2026) bruger allerede
--   kolonnen i backend/routes/api.js og frontend uden nogen tilhørende
--   database/*.sql-fil — kolonnen er altså blevet tilføjet direkte i prod
--   (Supabase Studio/SQL-editor) FØR migrationsmappen fik den håndhævede
--   "al DDL er en committet fil"-konvention. database/schema.sql har ALDRIG
--   indeholdt kolonnen (bekræftet: `git log -p -S pending_team_id -- database/schema.sql`
--   giver 0 hits). Senere commits (fx 22499d30, #1995/#2579) genbruger og
--   bygger videre på en allerede-eksisterende kolonne uden selv at oprette den.
--
-- PROD-TILSTAND verificeret read-only 18/7-2026 (Supabase MCP, information_schema
-- + pg_indexes, project ghwvkxzhsbbltzfnuhhz):
--   - riders.pending_team_id: uuid, NULL-able, ingen DEFAULT
--   - FK riders_pending_team_id_fkey → teams(id), ON DELETE SET NULL, ON UPDATE NO ACTION
--   - Index idx_riders_pending_team_id (allerede committet — men i en fil
--     (2026-06-16-rls-initplan-and-hot-indexes.sql) som IKKE er en del af
--     RACE_HUB_SCHEMA_FILES, derfor gentaget her IF NOT EXISTS så harnessen
--     selvstændigt afspejler prod uden at afhænge af den anden fils load-orden)
--
-- Idempotent: ADD COLUMN/CONSTRAINT/INDEX er alle IF NOT EXISTS-vagtet.
-- Anvendt mod prod = no-op (kolonnen/FK/index findes allerede) — se PR-body:
-- ejeren beslutter selv om/hvornår denne fil applies, ingen auto-apply.

BEGIN;

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS pending_team_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'riders'
      AND constraint_name = 'riders_pending_team_id_fkey'
  ) THEN
    ALTER TABLE public.riders
      ADD CONSTRAINT riders_pending_team_id_fkey
      FOREIGN KEY (pending_team_id) REFERENCES public.teams(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_riders_pending_team_id ON public.riders (pending_team_id);

-- #2241-guard + prod-spejling: prod har column-level SELECT til anon+authenticated
-- (verificeret read-only 18/7 via information_schema.column_privileges) — uden
-- granten ville en klient-query der rører kolonnen stille 403'e (#2238-klassen).
-- Idempotent (GRANT er additivt) og no-op mod prod.
GRANT SELECT (pending_team_id) ON public.riders TO anon, authenticated;

COMMIT;
