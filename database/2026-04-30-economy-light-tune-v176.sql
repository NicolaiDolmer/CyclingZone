-- Economy light-tune v1.76
-- Raise short/long loan debt ceilings to match economy scale (was 240-360K, now 600-1200K).
-- Emergency ceilings kept as-is (already large enough as safety net).

UPDATE loan_config SET debt_ceiling = 1200000 WHERE division = 1 AND loan_type IN ('short', 'long');
UPDATE loan_config SET debt_ceiling = 900000  WHERE division = 2 AND loan_type IN ('short', 'long');
UPDATE loan_config SET debt_ceiling = 600000  WHERE division = 3 AND loan_type IN ('short', 'long');
