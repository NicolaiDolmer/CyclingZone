-- #2414 — Balance-drift-vagt: natlig kredibilitets-scorecard mod LIVE prod-resultater.
--
-- Persisterer ÉN række pr. UTC-kalenderdag med de aggregerede dominans/varians-
-- metrikker (backend/lib/balanceDriftMetrics.js's computeDayMetrics()-output) +
-- deres grøn/gul/rød-klassifikation mod de kanoniske bånd. Admin-fladen (14-dages
-- trend) læser DERFRA i stedet for at genberegne mod race_results/race_simulation_*
-- ved hvert side-load — nattens job er den ENESTE writer.
--
-- Read-only vagt: denne tabel er jobbets EGEN tilstand, ikke en mutation af
-- spildata (race_results/race_simulation_runs/race_incidents røres aldrig).
create table if not exists race_balance_drift_daily (
  metric_date date primary key,
  metrics jsonb not null,       -- computeDayMetrics()-output: {favoriteWinRate, ...}
  statuses jsonb not null,      -- classifyDay()-output: {metric: {value, band, status}}
  computed_at timestamptz not null default now()
);

comment on table race_balance_drift_daily is
  '#2414 — natlig snapshot af race v3-dominans/varians-metrikker mod prod-data. Read-only-jobbets egen tilstand, ikke spildata.';

-- RLS: admin-only læsning (samme mønster som andre interne scorecard/audit-tabeller).
-- service_role (cron + admin-endpoint) bypasser RLS uændret.
alter table race_balance_drift_daily enable row level security;

drop policy if exists "balance_drift_daily_no_client_access" on race_balance_drift_daily;
create policy "balance_drift_daily_no_client_access" on race_balance_drift_daily
  for all
  using (false)
  with check (false);
