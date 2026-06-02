-- #962 fyld-fra-toppen: engangs-migration der bringer den nuværende division-
-- fordeling i overensstemmelse med den nye invariant. Før i dag fik alle nye hold
-- division=3 (hardcodet), så hele beta-feltet sad i bunden og spillet føltes dødt.
--
-- Ny invariant (se DIVISION_CAPACITY i backend/lib/economyConstants.js): fyld de
-- højeste divisioner først — div 1 til 20 menneske-hold, så div 2 til 20, og
-- resten i div 3 (overflow / blød cap).
--
-- Rækkefølge: tidligst oprettede hold rykkes øverst, så de første spillere mødes
-- i toppen og spillet føles levende fra dag 1. Kun AKTIVE MENNESKE-hold rangeres
-- (is_ai = false, is_frozen = false). AI-hold tæller ikke mod kapaciteten og
-- beholder deres nuværende division; frosne hold røres ikke.
--
-- Grænserne 20/40 = DIVISION_CAPACITY (20) hhv. 2×DIVISION_CAPACITY. Hold dem i
-- sync hvis kapaciteten ændres i economyConstants.js.
--
-- Idempotent: kør igen er sikkert — den producerer samme fordeling så længe
-- created_at/id er stabile.
--
-- Rollback (sætter alle aktive menneske-hold tilbage i div 3 som før):
--   UPDATE teams SET division = 3 WHERE is_ai = false AND is_frozen = false;

WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM teams
  WHERE is_ai = false AND is_frozen = false
)
UPDATE teams t
SET division = CASE
  WHEN r.rn <= 20 THEN 1
  WHEN r.rn <= 40 THEN 2
  ELSE 3
END
FROM ranked r
WHERE t.id = r.id
  AND t.division IS DISTINCT FROM (CASE
    WHEN r.rn <= 20 THEN 1
    WHEN r.rn <= 40 THEN 2
    ELSE 3
  END);
