-- #1481 — Reset-rester: indkommende transfers + ønskeliste ikke nulstillet
-- ========================================================================
-- Den fejlbehæftede beta-reset/relaunch kørte på prod 18/6 og efterlod to klasser
-- af stale rows som kode-fixet (backend/lib/betaResetService.js) kun forhindrer
-- FREMOVER. Næste relaunch ligger langt ude i fremtiden, så denne engangs-migration
-- rydder de allerede-efterladte rester nu.
--
-- BUG 1 — hængende indkommende transfers:
--   resetBetaRosters nullede kun pending_team_id for ryttere der FYSISK stod på et
--   manager-hold (team_id IN (manager)). En parkeret "betal nu, registrér ved
--   vindue-åbning"-handel (#19) beholder team_id på SÆLGEREN (ofte AI/bank) og sætter
--   kun pending_team_id = køber-hold. Sådanne rows overlevede reset/relaunch.
--   → Nul pending_team_id for ALLE ryttere hvor pending_team_id peger på et manager-hold.
--   Præcedens: 2026-05-09-season-zero-pending-cleanup.sql.
--
-- BUG 2 — gamle ønskelister mod pensionerede legacy-ryttere:
--   rider_watchlist blev bevidst aldrig nulstillet, så hver manager beholdt sin
--   ønskeliste på tværs af relaunch. Efter retireLegacyRiders peger de rows på
--   pensionerede legacy-ryttere. rider_watchlist er per-bruger (user_id, rider_id)
--   → scoped til manager-brugere (samme diskriminator som UI/reset: ikke-AI, ikke-bank,
--   ikke-frosset, ikke-test).
--
-- Manager-team-filteret matcher managerTeamQuery i betaResetService.js:
--   is_ai = false AND is_bank = false AND is_frozen = false AND is_test_account = false.
--
-- Idempotent: anden kørsel rammer 0 rows (pending_team_id allerede null;
-- manager-watchlist allerede tom). Ingen nye player-facing kolonner → ingen GRANT.

BEGIN;

-- BUG 1: nul hængende indkommende handler der peger på et manager-hold.
UPDATE riders
SET pending_team_id = NULL
WHERE pending_team_id IN (
  SELECT id FROM teams
  WHERE is_ai = false
    AND is_bank = false
    AND is_frozen = false
    AND is_test_account = false
);

-- BUG 2: slet manager-brugeres gamle ønskelister (peger på pensionerede legacy-ryttere).
DELETE FROM rider_watchlist
WHERE user_id IN (
  SELECT user_id FROM teams
  WHERE is_ai = false
    AND is_bank = false
    AND is_frozen = false
    AND is_test_account = false
    AND user_id IS NOT NULL
);

COMMIT;
