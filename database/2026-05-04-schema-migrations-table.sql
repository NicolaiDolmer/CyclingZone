-- Schema migrations bookkeeping — bruges af .github/workflows/auto-migrate.yml.
-- Workflow tjekker hvilke filer i database/2026-*.sql der ikke er i schema_migrations
-- og kører dem mod live DB. Idempotent: ON CONFLICT DO NOTHING for re-run-sikkerhed.
--
-- Backfill-listen markerer alle migrations applied til live DB FØR auto-migrate-workflow
-- blev sat op (2026-05-04) — kørt manuelt via dashboard / Supabase MCP / migration-PRs.

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (filename, applied_at) VALUES
  ('database/2026-04-22-auctions-seller-team-id-nullable.sql',        '2026-04-22'::timestamptz),
  ('database/2026-04-22-board-request-log.sql',                       '2026-04-22'::timestamptz),
  ('database/2026-04-23-discord-settings.sql',                        '2026-04-23'::timestamptz),
  ('database/2026-04-23-season-standings-rank-and-rebuild.sql',       '2026-04-23'::timestamptz),
  ('database/2026-04-24-board-parallel-plans.sql',                    '2026-04-24'::timestamptz),
  ('database/2026-04-24-dyn-cyclist-import-type.sql',                 '2026-04-24'::timestamptz),
  ('database/2026-04-24-watchlist-notification-type.sql',             '2026-04-24'::timestamptz),
  ('database/2026-04-25-economy-retuning.sql',                        '2026-04-25'::timestamptz),
  ('database/2026-04-25-economy-scale-4000x.sql',                     '2026-04-25'::timestamptz),
  ('database/2026-04-25-rider-value-growth.sql',                      '2026-04-25'::timestamptz),
  ('database/2026-04-26-online-status.sql',                           '2026-04-26'::timestamptz),
  ('database/2026-04-26-race-results-sheets-import-type.sql',         '2026-04-26'::timestamptz),
  ('database/2026-04-26-window-pending-transfers.sql',                '2026-04-26'::timestamptz),
  ('database/2026-04-29-backfill-season6-emergency-loan-finance.sql', '2026-04-29'::timestamptz),
  ('database/2026-04-29-finance-notification-contract-types.sql',     '2026-04-29'::timestamptz),
  ('database/2026-04-29-uci-men-race-points.sql',                     '2026-04-29'::timestamptz),
  ('database/2026-04-30-economy-light-tune-v176.sql',                 '2026-04-30'::timestamptz),
  ('database/2026-04-30-rider-market-value.sql',                      '2026-04-30'::timestamptz),
  ('database/2026-04-30-transfer-offer-archive.sql',                  '2026-04-30'::timestamptz),
  ('database/2026-05-01-fix-uci-points-google-sheet-sync.sql',        '2026-05-01'::timestamptz),
  ('database/2026-05-01-fix-uci-points-name-mismatch.sql',            '2026-05-01'::timestamptz),
  ('database/2026-05-02-auction-timing-config.sql',                   '2026-05-02'::timestamptz),
  ('database/2026-05-02-deadline-day-final-whistle.sql',              '2026-05-02'::timestamptz),
  ('database/2026-05-02-deadline-day.sql',                            '2026-05-02'::timestamptz),
  ('database/2026-05-02-fix-uci-points-bulk-all.sql',                 '2026-05-02'::timestamptz),
  ('database/2026-05-02-prize-payout-control.sql',                    '2026-05-02'::timestamptz),
  ('database/2026-05-03-discord-dm-opt-out.sql',                      '2026-05-03'::timestamptz),
  ('database/2026-05-04-auctions-is-flash.sql',                       '2026-05-04'::timestamptz),
  ('database/2026-05-04-schema-migrations-table.sql',                 NOW())
ON CONFLICT (filename) DO NOTHING;
