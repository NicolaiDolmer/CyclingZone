-- E2 balance-retune (strict_fair_v1) — gældsloft D1 short/long: 1.500.000 → 1.200.000.
--
-- Baggrund: v176 (2026-04-30-economy-light-tune-v176.sql) satte D1 short/long til
-- 1.200.000, men en live-prod-query 2026-06-17 viste D1 short/long = 1.500.000
-- (D2=900.000, D3=600.000 matcher allerede). v176's D1-linje er altså enten aldrig
-- anvendt eller hånd-redigeret tilbage. Koden (economyConstants.DEBT_CEILING_BY_DIVISION)
-- siger 1.200.000 → kode og prod er ude af sync. Denne migration bringer prod i sync
-- med det ejer-valgte strict_fair_v1-mål (gældsloft division-skaleret 1.2M/900k/600k).
--
-- Emergency-loftet (1.500.000 på tværs af divisioner) er BEVIDST urørt — det er
-- sikkerhedsnettet og må gerne overstige short/long-loftet (samme valg som v176).
-- Idempotent: D2/D3 er allerede korrekte → no-op; kun D1 ændrer sig reelt.
--
-- Rollback: UPDATE loan_config SET debt_ceiling = 1500000 WHERE division = 1 AND loan_type IN ('short','long');

UPDATE loan_config SET debt_ceiling = 1200000 WHERE division = 1 AND loan_type IN ('short', 'long');
UPDATE loan_config SET debt_ceiling = 900000  WHERE division = 2 AND loan_type IN ('short', 'long');
UPDATE loan_config SET debt_ceiling = 600000  WHERE division = 3 AND loan_type IN ('short', 'long');
