-- #2746 — Løn-backfill: 1.317 ryttere på menneskehold har salary IS NULL før
-- sæson 2-skiftet (27/7 09:00 UTC). Bruger PRODUKTIONENS EGEN lønformel
-- (backend/lib/contractSeed.js computeFrozenSalary + backend/lib/economyConstants.js
-- salaryRateForDivision) — INGEN opfundet formel:
--
--   salary = GREATEST(1, ROUND(base × SALARY_RATE_PROD[division]))
--   base   = current_production_value HVIS > 0, ELLERS 1000 (CONTRACT.BASE_VALUE_FALLBACK)
--   SALARY_RATE_PROD.byDiv = { 1: 0.3029, 2: 0.3238, 3: 0.1481, 4: 0.2087 }, global = 0.1606
--
-- (byDiv/global-satserne er hardcodede her, IKKE læst fra JS — hold dem i sync
-- med backend/lib/economyConstants.js hvis de nogensinde ændres; de er kalibreret
-- 18/7 mod ægte population og forventes stabile).
--
-- SCOPE (målt read-only mod prod 23/7 — se PR for fuld fordeling):
--   NULL-fordeling på riders.team_id IS NOT NULL, grupperet på team-flag:
--     is_ai=true                                    : 2.991 af 3.540 NULL (forventet — se nedenfor)
--     is_ai=false, is_test_account=false, ikke-akademi: 1.317 af 2.239 NULL  ← DENNE migration
--     is_ai=false, is_test_account=true              :    36 af    36 NULL  ← IKKE rørt (test-data)
--     is_academy=true (menneskehold)                  :     0 af   307 NULL  ← allerede fuldt dækket
--
--   Beslutning: backfill DÆKKER KUN menneskehold (is_ai=false, is_bank=false,
--   is_frozen=false, is_test_account=false). AI-ejede ryttere er BEVIDST
--   ekskluderet — processTeamSeasonPayroll/loadHumanSeasonEndTeams debiterer
--   KUN menneskehold for løn (economyEngine.js), så AI-holds salary=NULL har
--   ingen økonomisk effekt og er allerede den dokumenterede invariant i
--   backend/scripts/driftMonitor.js (#2674: "AI-/bank-ejede har legitimt
--   salary=null, verificeret i prod 18/7"). At udfylde AI-løn ville være en
--   ren kosmetisk ændring uden gameplay-effekt og risikerer at maskere den
--   rigtige invariant for fremtidige audits. Test-konti (36 rækker) er
--   bevidst IKKE rørt — de er ikke spillervendte.
--
-- #2674-korrektion: der findes INGEN check_salary_drift-RPC i databasen (aldrig
-- oprettet post-#2594, jf. issue #2674) — denne migration bruger derfor den
-- samme formel som contractSeed.js direkte i SQL, ikke et RPC-genbrug.
--
-- Defensiv guard (adversarielt review 23/7): `AND r.is_academy = false` er
-- tilføjet EKSPLICIT i WHERE, selvom målingen viser 0 akademi-ryttere med
-- NULL-løn i dag (rene menneskehold-akademister er allerede fuldt dækket).
-- Uden guarden ville et FREMTIDIGT gen-run (fx efter en datafejl der
-- midlertidigt giver en akademi-rytter salary=NULL) kunne ramme akademi-
-- ryttere med den forkerte (senior-)formel, i stedet for at fejle synligt.
-- riders.is_academy er NOT NULL DEFAULT FALSE (schema.sql) — ingen COALESCE
-- nødvendig.
--
-- IDEMPOTENT: WHERE salary IS NULL — et gen-run efter første succesfulde kørsel
-- er et no-op (0 rækker rammes).
--
-- Rollback: ikke muligt at genskabe NULL (information tabt er "ingen kontrakt
-- signeret endnu" — det ER det denne migration retter). Ingen andre kolonner
-- røres.

BEGIN;

UPDATE riders r
SET salary = GREATEST(
  1,
  ROUND(
    (CASE WHEN r.current_production_value > 0 THEN r.current_production_value ELSE 1000 END)::numeric
    * (CASE t.division
         WHEN 1 THEN 0.3029
         WHEN 2 THEN 0.3238
         WHEN 3 THEN 0.1481
         WHEN 4 THEN 0.2087
         ELSE 0.1606
       END)
  )
)::integer
FROM teams t
WHERE r.team_id = t.id
  AND r.salary IS NULL
  AND t.is_ai = false
  AND t.is_bank = false
  AND t.is_frozen = false
  AND t.is_test_account = false
  AND r.is_academy = false;

COMMIT;

-- =============================================================================
-- Post-verify (kør manuelt eller lad CI's db-health-tjek dække det)
-- =============================================================================
--
-- 1) 0 NULL tilbage på menneskehold (den kontraktuelle invariant, #1309):
--    SELECT count(*) FROM riders r JOIN teams t ON t.id = r.team_id
--    WHERE r.salary IS NULL AND t.is_ai = false AND t.is_bank = false
--      AND t.is_frozen = false AND t.is_test_account = false;
--    → forventet: 0
--
-- 2) AI-holds NULL-invariant er UÆNDRET (ingen utilsigtet side-effekt):
--    SELECT count(*) FROM riders r JOIN teams t ON t.id = r.team_id
--    WHERE r.salary IS NULL AND t.is_ai = true;
--    → forventet: ~2.991 (uændret fra før migration)
--
-- 3) Ingen løn over runaway-loftet (driftMonitor.js G4-invariant, 240.000):
--    SELECT count(*) FROM riders r JOIN teams t ON t.id = r.team_id
--    WHERE t.is_ai = false AND r.salary > 240000;
--    → forventet: 0 (SALARY_RATE_PROD-satserne er kalibreret under loftet)
