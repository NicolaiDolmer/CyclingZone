-- Sæson-loop-incident 2026-05-21 — rollback til sæson 1 (post-#412/v3.85)
-- ============================================================
--
-- Incident: processSeasonAutoTransitionCron + processSquadEnforcementCron +
-- processDeadlineDayCron filtrerede kun på status='closed' uden at skelne
-- racing-windows (oprettet via transitionToNextSeason med closed_at=null) fra
-- deadline-lukkede windows. Resultat: hver 5-10 min fyrede en ny transition.
-- 0 → 1 (23:15 — korrekt), 1 → 2 (23:25), 2 → 3 (23:35), 3 → 4 (23:45).
--
-- Akut stop kl 23:48 via separat SQL: sæson 4 sat til 'completed' + sæson 4-vinduet
-- markeret som fully wrapped. Cron-loop stoppet inden 4 → 5.
--
-- Denne rollback:
--   1. Refund team-balancer (4× sponsor + salary + loan_interest skal fjernes)
--   2. Slet 192 finance_transactions for sæson 2, 3, 4
--   3. Slet transfer_windows for sæson 2, 3, 4
--   4. Slet sæson 2, 3, 4
--   5. Restore sæson 1 til 'active' status, end_date=null
--   6. Renset sæson 1's racing-window — fjern ghost-timestamps fra cron-loopen
--
-- Code-fix (samme commit) sikrer at racing-windows aldrig igen matches af cron:
--   - seasonAutoTransition.js: .not("closed_at", "is", null)
--   - squadEnforcement.js: .not("closed_at", "is", null)
--   - deadlineDayReport.js: guard early return på racing-window
--
-- Rollback af denne rollback (hvis nødvendig — IKKE recommended):
--   Findes ikke. Sæson 2-4 var rene ghost-states uden brugerinteraktion
--   (0 notifikationer, 0 standings, 0 race-results). Tabet er kun audit-data.

BEGIN;

-- 1. Audit-snapshot inden rollback (saved som admin_log entry for sporbarhed)
INSERT INTO admin_log (admin_user_id, action_type, description, meta)
VALUES (
  NULL,
  'season_repaired',
  'Sæson-loop rollback 2026-05-21: slet sæson 2-4 + refund teams. Se meta.affected for detaljer.',
  jsonb_build_object(
    'incident_date', '2026-05-21',
    'ghost_seasons_deleted', ARRAY[2, 3, 4],
    'finance_transactions_to_delete', (
      SELECT COUNT(*) FROM finance_transactions
      WHERE season_id IN (
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000004'
      )
    ),
    'total_refund_amount', (
      SELECT SUM(amount)::BIGINT FROM finance_transactions
      WHERE season_id IN (
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000004'
      )
    ),
    'pre_rollback_balances', (
      SELECT jsonb_object_agg(name, balance)
      FROM teams
      WHERE is_ai = false AND is_bank = false AND user_id IS NOT NULL
    )
  )
);

-- 2. Refund team-balancer — fjern net delta fra sæson 2, 3, 4
-- Net delta er det total amount fra finance_transactions vi sletter.
-- For sponsor (positive) + salary (negative) + loan_interest (negative) = net positive.
-- Vi subtraherer det fra balancen for at returnere til pre-loop state.
UPDATE teams t
SET balance = t.balance - sub.net_delta
FROM (
  SELECT team_id, SUM(amount)::BIGINT as net_delta
  FROM finance_transactions
  WHERE season_id IN (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004'
  )
  GROUP BY team_id
) sub
WHERE t.id = sub.team_id;

-- 3. Slet finance_transactions for sæson 2, 3, 4
DELETE FROM finance_transactions
WHERE season_id IN (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004'
);

-- 4. Slet transfer_windows for sæson 2, 3, 4
DELETE FROM transfer_windows
WHERE season_id IN (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004'
);

-- 5. Slet sæson 2, 3, 4
DELETE FROM seasons
WHERE id IN (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004'
);

-- 6. Restore sæson 1 til 'active' status (sæson 4 was sat til 'completed' i akut-stop)
UPDATE seasons
SET status = 'active', end_date = NULL
WHERE id = '00000000-0000-0000-0000-000000000001';

-- 7. Renset sæson 1's racing-window — ghost-timestamps fra cron-loopen
-- Sæson 1's vindue blev oprettet 21:15 og fik final_whistle + squad_enforcement
-- sat 21:20 af cron-loopen. Med fixet på plads vil cron'erne aldrig røre racing-
-- vinduer igen (closed_at=null filter), men vi nuller alligevel disse felter
-- så vinduet ser "rent" ud i admin-UI.
UPDATE transfer_windows
SET final_whistle_sent_at = NULL,
    squad_enforcement_completed_at = NULL
WHERE id = '00000000-0000-0000-0000-00000001aaaa';

COMMIT;
