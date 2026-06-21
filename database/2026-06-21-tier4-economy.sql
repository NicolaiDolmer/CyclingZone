-- ============================================================
-- Forever-relaunch FORM-FREEZE (#1608): tier-4 økonomi — loan_config-rækker
-- ============================================================
--
-- Følgemigration til 2026-06-21-league-divisions-pyramid.sql (4-tier-pyramiden).
-- Her landes loan_config for tier 4 (bunden) så lån-RPC'erne ikke fejler for
-- div-4-hold. Tallene er GRANIT-FROSNE (ejer-godkendt 2026-06-21) og spejler
-- backend/lib/economyConstants.js:
--   DEBT_CEILING_BY_DIVISION[4] = 400000.
--
-- KOBLINGS-FUND (verificeret mod prod 2026-06-21):
--   * loan_config har en CHECK-constraint (loan_config_division_check) der i dag
--     kun tillader division 1-3. Den SKAL udvides til 1-4 FØR vi kan INSERT'e
--     div-4-rækker — ellers fejler migrationen. (teams-CHECK'en udvides i
--     pyramide-migrationen; loan_config er en SEPARAT tabel og rør IKKE deraf.)
--   * createEmergencyLoan (loanEngine.js:326) KASTER hvis der mangler en
--     emergency-row for holdets division. Nødlån udstedes automatisk af cron ved
--     payroll for at dække løn → en manglende div-4 emergency-row ville crashe
--     payroll for ethvert div-4-hold der ikke kan dække løn. Derfor seedes ALLE
--     tre låntyper (short/long/emergency) for div 4 — samme mønster som prod har
--     for div 1-3 (emergency.debt_ceiling = divisionens loft). Opgaven nævnte
--     "short+long", men emergency er en runtime-nødvendighed (ikke gold-plating).
--
-- loan_config-skema (matcher prod + database/.../seed-relaunch-rehearsal.sql):
--   (division, loan_type, origination_fee_pct, interest_rate_pct, seasons, debt_ceiling)
-- Per-type-rater er identiske med div 1-3 (kun debt_ceiling skalerer pr. division).
--
-- Idempotent: CHECK droppes/gen-tilføjes med IF EXISTS; INSERT bruger
-- ON CONFLICT (division, loan_type) DO NOTHING (unique-constraint
-- loan_config_division_loan_type_key). Kan køres flere gange uden fejl.
-- Anvendes automatisk ved deploy (Supabase auto-migrate). EJEREN MERGER.

-- ─── Udvid loan_config tier-domæne til 1-4 ──────────────────────────────────────
ALTER TABLE loan_config DROP CONSTRAINT IF EXISTS loan_config_division_check;
ALTER TABLE loan_config ADD CONSTRAINT loan_config_division_check CHECK (division IN (1, 2, 3, 4));

-- ─── Seed tier-4 loan_config (short/long/emergency, ceiling = 400000) ────────────
INSERT INTO loan_config (division, loan_type, origination_fee_pct, interest_rate_pct, seasons, debt_ceiling) VALUES
  (4, 'short',     0.03, 0.08, 3, 400000),
  (4, 'long',      0.05, 0.12, 5, 400000),
  (4, 'emergency', 0.10, 0.20, 1, 400000)
ON CONFLICT (division, loan_type) DO NOTHING;

-- pgrst_ddl_watch reloader normalt ved DDL; eksplicit NOTIFY koster intet (#1162).
NOTIFY pgrst, 'reload schema';
