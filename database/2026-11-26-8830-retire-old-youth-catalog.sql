-- #8830 (ejer 26/11): det gamle ungdomskatalog pensioneres, nu hvor U23- og juniorkalenderen
-- er mini-udgaver af seniorens D1-loeb (#7471, 2026-11-26-7471-youth-mini-editions.sql).
--
-- Blødt og reversibelt: kun retired_at saettes; ingen raekke slettes (rule 38). En
-- pensioneret race_pool-raekke kan ikke vaelges til nye kalendere (tierCalendarMaterializer
-- laeser .is("retired_at", null)), men historiske saesoners races peger stadig paa den.
-- Rulles tilbage med: UPDATE public.race_pool SET retired_at = NULL
--   WHERE retired_at = '<tidsstemplet fra post-verify>' AND squad IN ('u23', 'junior');
--
-- Vagt: et niveaus gamle katalog pensioneres KUN hvis niveauets mini-udgaver findes og er
-- aktive, saa en ungdomskalender aldrig kan staa uden katalog. Idempotent: allerede
-- pensionerede raekker og mini-raekkerne roeres ikke.
-- Applies post-merge (auto-migrate.yml), efter 7471-migrationen (filnavnets raekkefoelge).
-- Post-verify:
--   SELECT squad, (external_id LIKE '%-mini-%') AS mini, retired_at IS NULL AS active, count(*)
--   FROM public.race_pool WHERE squad IN ('u23', 'junior') GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
BEGIN;
SET LOCAL lock_timeout = '3s';

UPDATE public.race_pool rp
SET retired_at = now()
FROM (VALUES ('u23', 'u23-mini-'), ('junior', 'jun-mini-')) AS lvl(squad, prefix)
WHERE rp.squad = lvl.squad
  AND rp.retired_at IS NULL
  AND rp.external_id NOT LIKE lvl.prefix || '%'
  AND EXISTS (
    SELECT 1 FROM public.race_pool m
    WHERE m.squad = lvl.squad AND m.retired_at IS NULL AND m.external_id LIKE lvl.prefix || '%'
  );

COMMIT;
NOTIFY pgrst, 'reload schema';
