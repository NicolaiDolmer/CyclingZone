-- database/2026-09-26-4385-upkeep-per-race-day.sql
-- #4385: upkeep som løbende rejse-/personaleudgift pr. seniorløbsdag i stedet for
-- ét fladt træk ved sæsonstart (ejer-beslutning 26/9, fire låste valg).
--
-- To additive, idempotente ændringer:
--
-- 1. app_config-nøglen 'upkeep_per_race_day' (DEFAULT 'off' = UÆNDRET adfærd:
--    fladt upkeep ved sæsonstart som i dag). Læses af
--    backend/lib/upkeepPerRaceDayFlag.ts og gater BÅDE
--    economyEngine.processTeamSeasonPayroll trin 5 (intet fladt træk når 'on')
--    og upkeepPerRaceDay.chargeRaceDayTravelStaffToDate (træk pr. seniorløbsdag
--    når 'on'). ON CONFLICT DO NOTHING — overskriver ALDRIG en værdi ejeren har sat.
--    Fail-safe hvis nøglen mangler/læsningen fejler: 'off'. 'beta' læses som 'off'.
--
--    Flippet er EJER-ONLY og skal ske FØR sæsonskiftets "Udfør sæsonskifte" (12c):
--      UPDATE public.app_config SET value='"on"'::jsonb  WHERE key='upkeep_per_race_day';
--    Rollback (tilbage til fladt sæsonstart-upkeep fra næste sæsonskifte):
--      UPDATE public.app_config SET value='"off"'::jsonb WHERE key='upkeep_per_race_day';
--
-- 2. finance_transactions_type_check udvides med 'travel_staff' (én linje pr.
--    hold pr. seniorløbsdag). Uden den fejler det første træk med
--    check_violation (23514) midt i auto-prize-sweepen. Listen er
--    2026-09-04-4376-clawback-finance-type.sql (verificeret identisk med prod
--    26/9) + den nye værdi. DROP IF EXISTS + ADD er idempotent.

BEGIN;

INSERT INTO public.app_config (key, value, description)
VALUES ('upkeep_per_race_day', '"off"'::jsonb,
  'Upkeep pr. seniorløbsdag (#4385). ''off'' (default) = fladt divisions-upkeep trækkes ved sæsonstart som hidtil. ''on'' = intet fladt træk ved sæsonstart; i stedet én ''travel_staff''-post pr. hold pr. seniorløbsdag holdet havde mindst én rytter til start på, trukket ved løbsafregningen (auto-prize-sweepen). U23/junior-løb er gratis. Fail-safe ''off'' ved manglende nøgle/fejlet læsning; ''beta'' læses som ''off''. Flippes af ejeren FØR "Udfør sæsonskifte".')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE finance_transactions
  DROP CONSTRAINT IF EXISTS finance_transactions_type_check;

ALTER TABLE finance_transactions
  ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (
    'sponsor', 'prize', 'salary', 'transfer_in', 'transfer_out', 'interest', 'bonus',
    'starting_budget', 'loan_received', 'loan_repayment', 'loan_interest',
    'emergency_loan', 'admin_adjustment', 'auto_squad_purchase', 'auto_squad_sale',
    'squad_violation_fine', 'academy_signing', 'academy_drift', 'upkeep',
    'forced_debt_sale', 'facility_purchase', 'facility_upkeep', 'staff_salary',
    'staff_severance', 'scout_travel', 'parachute', 'sponsor_race_day',
    'sponsor_signing_bonus', 'sponsor_result_bonus', 'sponsor_objective_bonus',
    'division_adjustment', 'sponsor_division_correction_clawback', 'travel_staff'
  ));

COMMIT;

-- Post-verify:
--   SELECT value FROM public.app_config WHERE key = 'upkeep_per_race_day';   -- "off"
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'finance_transactions_type_check';                       -- indeholder 'travel_staff'
