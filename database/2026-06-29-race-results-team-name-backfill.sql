-- #1993 — Engangs-backfill: snapshot holdnavn på eksisterende race_results.
--
-- BAGGRUND
--   race_results.team_name blev historisk altid skrevet null ved import (begge
--   skrive-stier: raceResultsEngine.buildRaceResultsFromPending +
--   raceRunner.buildRaceResults). Hold-attributionen hang derfor alene på
--   team_id-FK'en, som er ON DELETE SET NULL (schema.sql). Slettes/nulstilles et
--   hold mister resultatet AL attribution, og præmie-udbetaleren springer
--   NULL-team-rækker over (prizePayoutEngine: `if (!r.team_id) continue`) → den
--   præmie fordamper lydløst. Verificeret i prod: sejrs-rækker med team_name=null.
--
--   Begge skrive-stier populerer nu team_name fremadrettet (samme PR). Denne
--   migration lukker historikken: den kopierer det navn team_id stadig peger på.
--
-- OMFANG
--   Alle race_results hvor team_id er sat OG team_name er null. Rækker hvor
--   team_id allerede er nullet (holdet slettet før denne fix) kan ikke
--   backfilles — navnet er tabt; de forbliver null (intet at kopiere fra).
--
-- ⚠️ Migration auto-applies i prod ved merge — EJEREN merger PR'en (database/*.sql).
--
-- IDEMPOTENT: WHERE team_name IS NULL gør en re-run til no-op (allerede-satte
--   navne røres ikke). Forward-only datakorrektion; ingen down-migration.

BEGIN;

UPDATE race_results
SET team_name = teams.name
FROM teams
WHERE race_results.team_id = teams.id
  AND race_results.team_name IS NULL;

COMMIT;
