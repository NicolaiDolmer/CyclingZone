-- #3639 — trænings-slot-vagt: daglig tælling af døde træningsfokus.
--
-- Baggrund: 11/8 stod 117 spiller-ejede ryttere i et træningsfokus hvor ALLE
-- fokussets evner allerede havde nået deres livstidsloft (træningen gav nul), og
-- yderligere 741 havde mindst én død evne. Ingen målte det, så det tog uger og
-- tre spillerrapporter før nogen opdagede det. Enhver fremtidig loft-ændring
-- (23/8-pakken, 1-99-remappen i #3564) kan gentage det.
--
-- Denne tabel er vagtens hukommelse: én række pr. (dag, fokus) plus en total-
-- række med focus='__total__'. Skrives af cron'ens træningsslot-vagt
-- (backend/lib/trainingSlotHealthWatch.js), som upserter → idempotent, tryg
-- selvom tick'et løber flere gange samme dag (fx ved deploy-genstart).
--
-- Idempotent: kan køres igen uden effekt.

create table if not exists public.training_slot_health_daily (
  snapshot_date       date    not null,
  focus               text    not null,
  riders_in_training  integer not null default 0,
  dead_slots          integer not null default 0,
  partial_slots       integer not null default 0,
  generated_at        timestamptz not null default now(),
  primary key (snapshot_date, focus)
);

comment on table public.training_slot_health_daily is
  '#3639: daglig tælling af træningsfokus uden hovedrum. dead_slots = ALLE fokussets evner på livstidsloftet (træning giver nul); partial_slots = mindst én, men ikke alle. focus=''__total__'' er dagens sum. Skrives af cron''ens træningsslot-vagt.';

-- Trend-opslag ("hvordan har tallet flyttet sig?") går altid bagfra i tid.
create index if not exists idx_training_slot_health_daily_date
  on public.training_slot_health_daily (snapshot_date desc);

-- Service-role-only, samme mønster som growth_metric_snapshots: RLS slået til
-- UDEN policies → ingen anon/authenticated-adgang overhovedet. Vagten skriver
-- med service-nøglen, som går uden om RLS.
alter table public.training_slot_health_daily enable row level security;
