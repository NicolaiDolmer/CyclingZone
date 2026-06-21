-- #1499: deskriptive udbruds-etiketter på race_results.
--
-- Rent ADDITIVT + balance-NEUTRALT display-lag: motoren modellerer ALLEREDE udbrud
-- (selectBreakawayBonuses → components.breakaway). Disse to kolonner gemmer en EFTER-
-- løb-etiket afledt UDELUKKENDE af motorens eksisterende output (raceSimulator.js
-- deriveBreakawayStatus / raceRunner.js). De rører IKKE finalScore, rang, point eller
-- kalibreringen — race-gaten forbliver bit-identisk grøn.
--
--   in_breakaway     = rytteren var en udvalgt escapee (components.breakaway > 0).
--                      Den PRÆCISE konvention fra kalibrerings-loggen 2026-06-16 +
--                      BREAKAWAY_TARGETS-gaten.
--   breakaway_caught = escapee BLEV indhentet før mål (mindst én ikke-escapee
--                      finishede foran ham). false når in_breakaway=false ELLER
--                      escapeen holdt hjem (ingen ikke-escapee foran).
--
-- Sættes kun på etape-/endags-gc-finish-rækker; alle øvrige result_types (trøjer,
-- klassementer, hold) bærer dem som false. Importerede PCM-rækker => false (intet flag).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS + re-grant = no-op). Rollback:
--   ALTER TABLE race_results DROP COLUMN in_breakaway, DROP COLUMN breakaway_caught;
--
-- KOLONNE-PRIVILEGIE-NOTE (#1162/#1309): race_results har i prod kolonne-niveau-
-- privilegier (verificeret 2026-06-21: hver kolonne har sin egen GRANT pr. rolle).
-- Tabellen har ganske vist OGSÅ en table-level SELECT-grant der dækker fremtidige
-- kolonner, men vi tilføjer den EKSPLICITTE kolonne-grant alligevel (belt-and-suspenders,
-- overlever en evt. fremtidig table-level REVOKE) — ellers risikerer frontend
-- "permission denied for table race_results" på de nye kolonner.

BEGIN;

ALTER TABLE race_results ADD COLUMN IF NOT EXISTS in_breakaway BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE race_results ADD COLUMN IF NOT EXISTS breakaway_caught BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN race_results.in_breakaway IS
  'Deskriptivt (#1499): rytteren var i (morgen-)udbruddet for denne etape (components.breakaway > 0). '
  'Rent display-lag — påvirker IKKE rang/point/finish_time.';
COMMENT ON COLUMN race_results.breakaway_caught IS
  'Deskriptivt (#1499): escapee blev indhentet før mål (mindst én ikke-escapee finishede foran). '
  'false når in_breakaway=false eller udbruddet holdt hjem.';

-- Eksplicit kolonne-grant til frontend-rollerne (fail-closed-sikring, jf. #1309-hotfix).
GRANT SELECT (in_breakaway, breakaway_caught) ON public.race_results TO anon, authenticated;

COMMIT;

-- PostgREST schema-cache reload (GRANT trigger normalt reload; eksplicit NOTIFY koster intet).
NOTIFY pgrst, 'reload schema';
