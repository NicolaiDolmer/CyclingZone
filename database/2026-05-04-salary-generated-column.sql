-- Salary bliver GENERATED STORED column.
-- Eliminerer dual-formula konflikten permanent: økonomi-cron skrev 10% via economyEngine.js,
-- mens auktioner og transfers skrev 15% via marketUtils.js. Salary flød mellem de to satser
-- afhængigt af timing. Efter denne migration kan ingen application-path skrive salary
-- direkte — DB beregner den fra uci_points + prize_earnings_bonus.
--
-- Formel matcher economyEngine.js (SALARY_RATE = 0.10, MIN_RIDER_UCI_POINTS = 5,
-- RIDER_VALUE_FACTOR = 4000): max(1, round((max(5, uci_points) * 4000 + prize_earnings_bonus) * 0.10)).
--
-- Forudsætninger:
-- 1. Alle code-paths der skrev `salary` direkte er fjernet (auctionFinalization.js, transferExecution.js,
--    routes/api.js loan-buyout, economyEngine.js updateRiderValues, scripts/import_riders.py).
-- 2. Funktionerne calculateMarketSalary og calculateAuctionSalary er slettet.
--
-- Rollback: DROP COLUMN + ADD COLUMN INTEGER DEFAULT 0; gendan tidligere kode-paths via git revert.

ALTER TABLE riders DROP COLUMN salary;

ALTER TABLE riders ADD COLUMN salary INTEGER GENERATED ALWAYS AS (
  GREATEST(1, ROUND(
    (GREATEST(5, uci_points) * 4000 + prize_earnings_bonus) * 0.10
  ))::INTEGER
) STORED;
