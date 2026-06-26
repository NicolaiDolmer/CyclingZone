-- #1927 — Engangs-datakorrektion: akademi-løn frosset for højt efter evne-nerf.
--
-- BAGGRUND
--   salary er frosset ved signering (#1309) og opdateres ikke når værdi falder.
--   riderValueRefresh (#1364) genberegner base_value/market_value ved evne-
--   ændringer men rører ALDRIG salary. Da en nerf sænkede unge rytteres evner
--   (→ værdi↓) blev deres frosne løn efterladt for høj.
--
-- OMFANG (verificeret read-only mod prod 2026-06-26)
--   38 akademiryttere på rigtige spiller-hold, samlet ~121.388 CZ$ for meget i
--   løn. Senior-løn er sund (0 berørte, median løn/værdi-ratio 1,00) og røres
--   IKKE. Ingen AI/test/frosne hold berørt. Fuld før/efter-liste i PR-body + #1927.
--
-- KORREKTION
--   Sæt akademi-løn = ungdomsraten 0,10 × market_value (academyFlag
--   ACADEMY.SALARY_RATE = 0.10, "10% af market_value"), gulvet på 1.
--   KUN NEDAD — ingen rytter får hævet løn (only-lower-guard).
--
-- ⚠️ Migration auto-applies i prod ved merge — EJEREN merger PR'en (database/*.sql).
--    Verificér FØRST mod en disposabel Supabase-branch hvis i tvivl.
--
-- IDEMPOTENT: only-lower-guarden (salary > fair) gør en re-run til no-op.
--
-- ROLLBACK: pre-korrektions-lønninger er dokumenteret i PR-body/#1927 + dækket af
--   DB-backup. Ingen automatisk down-migration (forward-only datakorrektion).
--
-- SYSTEMISK FOLLOW-UP (ikke i denne migration, se #1927): riderValueRefresh skal
--   genberegne løn for HOLDLØSE ryttere (løn afledes live af værdi), men lade
--   kontrakt-bundne (team_id NOT NULL) være frosne indtil ny kontrakt forhandles.

BEGIN;

UPDATE riders
SET salary = GREATEST(1, ROUND(0.10 * market_value)::int)
WHERE is_academy = true
  AND market_value > 0
  AND salary > GREATEST(1, ROUND(0.10 * market_value)::int);

COMMIT;
