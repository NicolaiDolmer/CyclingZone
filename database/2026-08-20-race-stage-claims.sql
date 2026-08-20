-- #4026: cross-process etape-claim. In-process-overlap-guarden (#2090, cron.js)
-- daekker ikke to samtidige backend-instanser (zombie-deploy 20/8: to releases
-- koerte 18:00-sweepet samtidig; kun stale-tick-409'eren forhindrede dobbelt-
-- simulering). En etape claimes atomisk FOER simulering via PK-konflikt paa
-- (race_id, stage_index); lease-udloeb + CAS-steal haandteres i applikationen
-- (backend/lib/adminSimulateRace.js — STAGE_CLAIM_LEASE_MS).
--
-- Idempotent: create table if not exists + betinget RLS-enable.

create table if not exists race_stage_claims (
  race_id uuid not null references races(id) on delete cascade,
  stage_index integer not null,
  claimed_at timestamptz not null default now(),
  -- hostname paa den claimende proces — goer en evt. zombie-instans synlig
  -- direkte i tabellen/loggen (to forskellige claimed_by samme aften = alarm).
  claimed_by text,
  primary key (race_id, stage_index)
);

-- Service-role-only: RLS ON uden policies = ingen klient-adgang (samme moenster
-- som oevrige interne driftstabeller).
alter table race_stage_claims enable row level security;
