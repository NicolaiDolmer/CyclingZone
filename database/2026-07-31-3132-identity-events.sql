-- #3132 (fair-play epic #3131, lag 1 — bevis) — persistér identitets-telemetri
-- holdbart. Da fair-play-sagen #2776 skulle efterforskes, fandtes IP-historikken
-- ikke længere: auth.audit_log_entries er tom (kort Supabase-retention),
-- auth.sessions viser kun AKTIVE sessioner, og signup_attribution.first_seen_at
-- er en localStorage-stempel der nulstilles af inkognito. Ingen af de tre kan
-- besvare "kom disse to konti fra samme maskine?" bagudrettet.
--
-- Denne tabel er egen, service_role-only telemetri: én række pr. signup + én
-- række pr. værdibærende handling (transfer accepteret, auktionsbud, lån
-- optaget, swap accepteret). Ren bevisopsamling — INGEN detektion/scoring her
-- (det er #3135). Ejer-beslutning 30/7 (se epic #3131): delt IP alene må ALDRIG
-- flagge nogen — multi-konto pr. husstand er tilladt.
--
-- Retention: 180 dage (ejer-mandat 30/7), håndhævet af cron
-- (backend/cron.js runIdentityEventsRetentionCron).
create table if not exists public.identity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  event_type text not null,
  entity_id text,
  ip inet,
  ip_prefix inet,
  user_agent text,
  accept_language text,
  timezone_offset_minutes integer,
  first_seen_at text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

comment on table public.identity_events is
  '#3132 — holdbar identitets-telemetri (signup + værdibærende handlinger) til fair-play-efterforskning. service_role-only, 180-dages retention. Ikke et detektions-/scoring-system (se #3135).';
comment on column public.identity_events.event_type is
  'signup | transfer_accepted | auction_bid | loan_taken | swap_accepted | auth_sessions_backfill (engangs-backfill fra auth.sessions ved migrationens apply-tidspunkt)';
comment on column public.identity_events.entity_id is
  'id på den relaterede række (transfer_offers.id / auctions.id / loans.id / swap_offers.id) — text så vi ikke skal FK''e på tværs af flere kilde-tabeller.';
comment on column public.identity_events.ip_prefix is
  'Afledt ved skrivning (trigger): /24 for IPv4, /64 for IPv6. Bruges til korrelations-queries (#3135) uden at kræve fuld IP i hver query.';
comment on column public.identity_events.first_seen_at is
  'Kun ved signup: kopi af signup_attribution.first_seen_at (klient-localStorage first-touch-stempel) på oprettelsestidspunktet, til korrelation.';

create index if not exists identity_events_user_id_created_at_idx
  on public.identity_events (user_id, created_at desc);
create index if not exists identity_events_ip_prefix_idx
  on public.identity_events (ip_prefix);
create index if not exists identity_events_created_at_idx
  on public.identity_events (created_at);

-- Afledt ip_prefix ved skrivning (INSERT/UPDATE), så korrelations-queries (#3135)
-- aldrig behøver at maskere fuld IP selv — og så det ikke kan glemmes af en
-- fremtidig insert-sti.
create or replace function public.identity_events_set_ip_prefix()
returns trigger as $$
begin
  if new.ip is not null then
    if family(new.ip) = 4 then
      new.ip_prefix := set_masklen(new.ip, 24);
    else
      new.ip_prefix := set_masklen(new.ip, 64);
    end if;
  else
    new.ip_prefix := null;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists identity_events_derive_ip_prefix on public.identity_events;
create trigger identity_events_derive_ip_prefix
  before insert or update on public.identity_events
  for each row execute function public.identity_events_set_ip_prefix();

-- RLS: ingen klient-adgang overhovedet (samme mønster som ops_alert_state /
-- race_balance_drift_daily). service_role (backend) bypasser RLS uændret —
-- aldrig eksponeret via anon/authenticated, aldrig via API til spillere.
alter table public.identity_events enable row level security;

drop policy if exists "identity_events_no_client_access" on public.identity_events;
create policy "identity_events_no_client_access" on public.identity_events
  for all
  using (false)
  with check (false);

-- Backfill (#3132 AC): red hvad der kan reddes fra auth.sessions FØR det
-- udløber (kun aktive/ikke-udløbne sessioner — 497 rækker / 169 af 179 brugere
-- pr. 2026-07-30). Idempotent: guardet af NOT EXISTS på session-id i entity_id,
-- så en migration-replay aldrig dubletterer. Defensivt DO-block: hvis
-- auth.sessions ikke (længere) har ip/user_agent-kolonner i det miljø
-- migrationen kører i, logges en advarsel i stedet for at fejle hele filen.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'sessions' and column_name = 'ip'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'sessions' and column_name = 'user_agent'
  ) then
    insert into public.identity_events
      (user_id, team_id, event_type, entity_id, ip, user_agent, created_at)
    select
      s.user_id,
      t.id,
      'auth_sessions_backfill',
      s.id::text,
      s.ip,
      s.user_agent,
      coalesce(s.updated_at, s.created_at, now())
    from auth.sessions s
    left join public.teams t on t.user_id = s.user_id
    where (s.ip is not null or s.user_agent is not null)
      and not exists (
        select 1 from public.identity_events ie
        where ie.event_type = 'auth_sessions_backfill' and ie.entity_id = s.id::text
      );
  else
    raise notice 'identity_events backfill sprunget over: auth.sessions.ip/user_agent findes ikke i dette miljø';
  end if;
end $$;
