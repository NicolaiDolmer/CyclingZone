-- #1816 — Retroaktiv re-skalering af eksisterende præmiepenge (÷20).
--
-- KONTEKST: PRIZE_PER_POINT sænkes 1500 → 75 (faktor 20) i economyConstants.js.
-- Det rammer kun FREMTIDIGE imports. Denne migration bringer den ALLEREDE optjente/
-- udbetalte præmie ned på samme skala, så live-økonomien er konsistent med den nye
-- konstant — som om præmie altid havde været point × 75.
--
-- PROD-TILSTAND VED SKRIVNING (verificeret read-only 2026-06-23, sæson 1 aktiv, 5/60
-- løbsdage, 6 completed+udbetalte løb):
--   • race_results: 295 præmie-rækker, alle nøjagtigt points_earned × 1500 (0 mismatch).
--     ÷20 = points_earned × 75 EKSAKT (ingen afrunding).
--   • finance_transactions type='prize': summen pr. hold er altid et multiplum af 1500,
--     så 19/20-clawback er et eksakt heltal — ingen drift.
--   • Rigtige hold (27): snit-balance 457.895, snit-præmie modtaget kun 122.667
--     (de fleste præmie-CZ$ gik til AI-hold). Clawback → snit-balance 341.361.
--     VERIFICERET: 0 rigtige hold går i minus (laveste lander på 13.916).
--
-- DESIGN ("meningsfuld nedsættelse"):
--   1. race_results.prize_money  → points_earned × 75  (race-resultatdata, ren genberegning).
--   2. teams.balance             → træk 19/20 af hver holds modtagne præmie tilbage
--                                   (beregnet fra de OPRINDELIGE prize-transaktioner).
--   3. finance_transactions      → prize-beløb ÷20, så finance-loggen + reconciliation
--      (type='prize')              (getSeasonPrizePreview: Σresults vs Σfinance) matcher.
--
-- IDEMPOTENS (#401 replay-sikkerhed): de tre data-mutationer er IKKE selv-idempotente
-- (clawback/÷20 ville køre igen ved replay og korrumpere data). Hele mutations-blokken
-- er derfor pakket i en one-shot DO-blok der no-op'er hvis backup-tabellen allerede er
-- udfyldt (= migrationen er anvendt før). DDL er CREATE TABLE IF NOT EXISTS. Et DR-replay
-- af hele migrations-loggen er dermed et rent no-op. Backup-tabellen er rollback-kilden.
--
-- EFTER DENNE MIGRATION (obligatorisk): kør rytter-værdi-genberegning, så
--   prize_earnings_bonus (fast-vindue-snit af prize_money) + de GENERATED market_value/
--   salary følger ÷20-skalaen:
--     node backend/scripts/recalculateRiderSalaries.js

BEGIN;

-- Idempotent DDL: rollback-/replay-værns-tabel.
CREATE TABLE IF NOT EXISTS prize_rescale_backup_20260623 (
  source     text    NOT NULL,   -- 'race_result' | 'team_balance' | 'finance_tx'
  ref_id     uuid    NOT NULL,
  old_value  bigint  NOT NULL
);

-- One-shot mutations-blok: kører KUN hvis backuppen er tom (første anvendelse).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM prize_rescale_backup_20260623 LIMIT 1) THEN
    RAISE NOTICE '#1816 præmie-re-skalering allerede anvendt (backup ikke tom) — idempotent no-op.';
    RETURN;
  END IF;

  -- Snapshot (rollback-kilde) for alle tre kilder, FØR mutation.
  INSERT INTO prize_rescale_backup_20260623 (source, ref_id, old_value)
  SELECT 'race_result', id, prize_money FROM race_results WHERE prize_money > 0;

  INSERT INTO prize_rescale_backup_20260623 (source, ref_id, old_value)
  SELECT 'team_balance', id, balance FROM teams;

  INSERT INTO prize_rescale_backup_20260623 (source, ref_id, old_value)
  SELECT 'finance_tx', id, amount FROM finance_transactions WHERE type = 'prize';

  -- 1. Re-skalér race_results (= points_earned × 75 = old/20, eksakt).
  UPDATE race_results
  SET prize_money = points_earned * 75
  WHERE prize_money > 0;

  -- 2. Clawback på balance: træk 19/20 af modtaget præmie tilbage, beregnet fra de
  --    ORIGINALE beløb i backuppen (før trin 3 re-skalerer transaktionerne).
  WITH per_team AS (
    SELECT ft.team_id, SUM(b.old_value) - SUM(b.old_value / 20) AS clawback
    FROM prize_rescale_backup_20260623 b
    JOIN finance_transactions ft ON ft.id = b.ref_id
    WHERE b.source = 'finance_tx' AND ft.team_id IS NOT NULL
    GROUP BY ft.team_id
  )
  UPDATE teams t
  SET balance = t.balance - pt.clawback
  FROM per_team pt
  WHERE pt.team_id = t.id;

  -- 3. Re-skalér prize-transaktionerne (finance-log + reconciliation konsistens).
  UPDATE finance_transactions
  SET amount = amount / 20
  WHERE type = 'prize';

  RAISE NOTICE '#1816 præmie-re-skalering anvendt (÷20).';
END $$;

-- Verifikation (read-only — sikker på replay). Inspicér output i migration-loggen.
-- 3a. Alle præmie-rækker nu = points_earned × 75, 0 mismatch:
SELECT '#1816 race_results_check' AS check,
       count(*) AS prize_rows,
       count(*) FILTER (WHERE prize_money = points_earned * 75) AS exact_x75,
       count(*) FILTER (WHERE prize_money <> points_earned * 75) AS mismatch
FROM race_results WHERE prize_money > 0;

-- 3b. Per-løb reconciliation holder (Σ udbetalbare results = Σ finance prize):
SELECT '#1816 reconciliation' AS check,
       count(*) AS paid_races,
       count(*) FILTER (WHERE results_total = finance_total) AS ok,
       count(*) FILTER (WHERE results_total <> finance_total) AS drift
FROM (
  SELECT r.id,
         COALESCE(SUM(rr.prize_money) FILTER (WHERE rr.team_id IS NOT NULL), 0) AS results_total,
         (SELECT COALESCE(SUM(ft.amount), 0) FROM finance_transactions ft
          WHERE ft.type = 'prize' AND ft.race_id = r.id) AS finance_total
  FROM races r
  LEFT JOIN race_results rr ON rr.race_id = r.id
  WHERE r.prize_paid_at IS NOT NULL
  GROUP BY r.id
) recon;

-- 3c. Ingen rigtige hold i minus efter clawback:
SELECT '#1816 real_teams_after' AS check,
       count(*) AS real_teams,
       round(avg(balance)) AS avg_balance,
       min(balance) AS min_balance,
       count(*) FILTER (WHERE balance < 0) AS negative_teams
FROM teams
WHERE is_ai = false AND is_test_account = false AND is_frozen = false AND is_bank = false;

COMMIT;
