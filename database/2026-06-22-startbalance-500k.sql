-- #1717 (ejer-besluttet 2026-06-22, forever-relaunch): startbalance 800000 → 500000.
--
-- Denne migration ændrer KUN kolonne-DEFAULT for fremtidige INSERTs uden eksplicit
-- balance. Normal team-create sætter balance = INITIAL_BALANCE eksplicit
-- (teamProfileEngine.DEFAULT_TEAM_VALUES), så default'en er en fallback — men holdes
-- i sync med koden per economyConstants.js-konventionen ("ændring kræver migration").
--
-- EKSISTERENDE holds balance er IKKE rørt her. Den blev justeret separat 2026-06-22
-- (−300k delta = 800k−500k, "bevar forbrug"-valg), med backup i tabellen
-- teams_balance_backup_20260622. Re-UPDATE her ville dobbelt-trække — derfor kun DEFAULT.
--
-- Idempotent: SET DEFAULT kan køres flere gange uden bivirkning.

ALTER TABLE teams ALTER COLUMN balance SET DEFAULT 500000;
