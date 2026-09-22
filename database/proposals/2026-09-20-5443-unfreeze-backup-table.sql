-- #5443 · Backup-tabel for dagens smalle oplåsning af riders.valuation_type.
--
-- IKKE en migration: den ligger bevidst i database/proposals/ så auto-migrate
-- IKKE kører den ved merge. Den køres MANUELT af orkestratøren umiddelbart før
-- apply-kørslen, præcis som #3345's frysnings-SQL blev det.
--
-- Rækkefølge:
--   1. denne SQL
--   2. CONFIRM_UNFREEZE_5443=yes infisical run --env=prod --silent -- \
--        node backend/scripts/dev/unfreezeValuationTypeToday5443.mjs --apply
--
-- Scriptet nægter at skrive hvis tabellen ikke findes, så rækkefølgen kan ikke
-- byttes om ved et uheld.
--
-- Rollback (lægger de gamle tal tilbage):
--   CONFIRM_UNFREEZE_5443=yes infisical run --env=prod --silent -- \
--     node backend/scripts/dev/unfreezeValuationTypeToday5443.mjs --rollback

create table if not exists public.backup_5443_valuation_type_20260920 (
  rider_id uuid primary key,
  valuation_type text,
  base_value integer,
  current_production_value integer,
  market_value integer,
  taget_at timestamptz not null default now()
);

-- RLS slået til UDEN policies: kun service_role kan læse og skrive. Samme
-- mønster som de øvrige backup_*-tabeller — en backup af spillervendte tal må
-- aldrig kunne læses af anon/authenticated.
alter table public.backup_5443_valuation_type_20260920 enable row level security;

revoke all on public.backup_5443_valuation_type_20260920 from anon, authenticated;

-- Verify efter kørsel (forventet: én række pr. rytter scriptet rørte):
--   select count(*) from public.backup_5443_valuation_type_20260920;
