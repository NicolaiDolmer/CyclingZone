-- #2730 — Ops-alarm dedup-state: gør boot-kørte ops-alarmer restart-robuste.
--
-- Balance-drift-vagten (#2414) er boot-kørt (cron.js) OG på 24h-timer. Fordi
-- 24h-timeren nulstilles ved HVER deploy — og der deployes mange gange/dag —
-- fyrede boot-kørslen alarmen på hver deploy for et vedvarende bånd-brud →
-- Discord-spam (ét ping pr. deploy, bekræftet korrelation deploy-tid ↔
-- ops-webhook-post). Rod-årsagen er dedup der ikke overlever en proces-restart
-- (samme klasse som CYCLINGZONE-31/#2434's in-memory-dedup).
--
-- Denne tabel persisterer den SIDST-alarmerede signatur pr. alarm-nøgle, så
-- vagten kun alarmerer når brud-sættet ÆNDRER sig (edge-triggered). Backend-
-- jobbets egen tilstand, ikke spildata.
create table if not exists ops_alert_state (
  alert_key text primary key,
  signature text not null default '',   -- stabil signatur af sidst-alarmerede tilstand
  last_alerted_at timestamptz,          -- hvornår der sidst blev sendt en alarm
  updated_at timestamptz not null default now()
);

comment on table ops_alert_state is
  '#2730 — restart-robust dedup for boot-kørte ops-alarmer (balance-drift m.fl.). Én række pr. alarm-nøgle med sidst-alarmerede signatur. Backend-jobbets egen tilstand, ikke spildata.';

-- RLS: ingen klient-adgang (samme mønster som race_balance_drift_daily).
-- service_role (cron) bypasser RLS uændret.
alter table ops_alert_state enable row level security;

drop policy if exists "ops_alert_state_no_client_access" on ops_alert_state;
create policy "ops_alert_state_no_client_access" on ops_alert_state
  for all
  using (false)
  with check (false);
