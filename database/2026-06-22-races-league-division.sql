-- ============================================================
-- Per-division race-kalender (launch-checklist #2): races.league_division_id
-- ============================================================
--
-- Binder hvert sæson-løb (races-række) til en specifik liga-pulje
-- (league_divisions.id), så hver division/pulje kan have sin EGEN kalender —
-- "Division 1 kører deres egne løb". NULL = fælles/sæson-bredt løb (legacy +
-- bagudkompatibelt: raceRunner.fillMissingTeamEntries læser allerede
-- race.league_division_id og falder tilbage til "alle hold" når den er NULL).
--
-- Idempotent (IF NOT EXISTS). Additiv — rører ikke eksisterende races-rows.
-- EJEREN MERGER (migration auto-applies i prod, jf. AGENTS.md).
--
-- RLS/GRANT: races bruger TABEL-niveau RLS (kun én SELECT-policy findes, jf.
-- 2026-05-20-race-edited-admin-action.sql) — IKKE kolonne-privilegier som
-- riders/rider_derived_abilities (#1309/#1162). En ny kolonne er derfor
-- automatisk klient-læsbar; intet separat GRANT SELECT (col) er nødvendigt.

ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS league_division_id INTEGER REFERENCES league_divisions(id);

-- Hot-path: stage-scheduleren + standings/grupperingen filtrerer på
-- (season_id, league_division_id) når per-division-kalendre er i brug.
CREATE INDEX IF NOT EXISTS idx_races_season_pool
  ON public.races(season_id, league_division_id);

-- pgrst_ddl_watch reloader normalt ved DDL; eksplicit NOTIFY koster intet (#1162).
NOTIFY pgrst, 'reload schema';
