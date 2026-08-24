-- #4163 — Gen-etablér DEFERRABLE på no_rider_double_booking.
--
-- Rod-årsag (målt mod prod 24/8 ~09:30 DK, fuld diagnose i issue #4163):
-- #3934 (18/8) gjorde constrainten DEFERRABLE INITIALLY IMMEDIATE, så batch-RPC'en
-- apply_race_entry_unit_batch kan køre `set constraints ... deferred` og dermed lave
-- lovlige rytter-swaps mellem to overlappende løb (insert i det ene + delete i det
-- andet inden for ÉN transaktion).
--
-- #4155-reparationen (database/2026-08-23-4155-s3-gameday-repair.sql, prod 24/8)
-- droppede constrainten før schedule-skrivningen og genskabte den til sidst UDEN
-- `deferrable initially immediate`. Post-verify tjekkede kun at constrainten FANDTES
-- (verify 4), ikke at den var deferrable — så reverteringen gik uopdaget igennem.
--
-- Konsekvens (prod, hvert tick siden reparationen): RPC'ens `set constraints ...
-- deferred` fejler → hele holdets batch afvises → JS-laget falder tilbage til per-
-- enheds-vejen (insert FØR delete, "aldrig-tommere"-garantien) → en rytter der skal
-- flyttes mellem to overlappende løb er transient dobbeltbooket → 23P01 → enheden
-- fejler. Deterministisk dødvande: 56 enheder 05:51, 140 enheder 06:51 (CYCLINGZONE-2D
-- / CYCLINGZONE-32, begge regressed). Præcis dødvandet #3934 fjernede.
--
-- Denne migration er idempotent og adfærds-neutral for alle eksisterende skrivere:
-- INITIALLY IMMEDIATE betyder at checket stadig kører pr. statement som standard.
-- Kun en transaktion der EKSPLICIT beder om `deferred` (RPC'en) får udskudt check.
--
-- Bemærk: ADD CONSTRAINT validerer ALLE eksisterende rækker og fejler hvis noget
-- overlapper. Det er med vilje — er der ægte dobbeltbookinger tilbage efter #4155,
-- skal denne migration fejle højlydt i stedet for at cementere dem.
--
-- Refs #4163 #4155 #3934 #3420 #4159

begin;

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'no_rider_double_booking'
       and conrelid = 'public.race_entries'::regclass
       and not condeferrable
  ) then
    alter table public.race_entries drop constraint no_rider_double_booking;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'no_rider_double_booking'
       and conrelid = 'public.race_entries'::regclass
  ) then
    alter table public.race_entries
      add constraint no_rider_double_booking
      exclude using gist (rider_id with =, binding_span with &&)
      where (binding_span is not null)
      deferrable initially immediate;
  end if;
end $$;

-- Hård gate i SAMME transaktion: er constrainten ikke deferrable nu, rulles alt tilbage.
do $$
declare
  v_deferrable boolean;
begin
  select condeferrable into v_deferrable
    from pg_constraint
   where conname = 'no_rider_double_booking'
     and conrelid = 'public.race_entries'::regclass;

  if v_deferrable is distinct from true then
    raise exception 'no_rider_double_booking er ikke deferrable efter migrationen (condeferrable=%)', v_deferrable;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------- Post-verify
-- verify 1: constrainten er deferrable initially immediate (forventet t / f)
select conname, condeferrable, condeferred
  from pg_constraint
 where conname = 'no_rider_double_booking'
   and conrelid = 'public.race_entries'::regclass;

-- verify 2: ingen ægte dobbeltbookinger tilbage (forventet 0)
select count(*) as overlapping_pairs
  from public.race_entries a
  join public.race_entries b
    on a.rider_id = b.rider_id
   and a.race_id < b.race_id
   and a.binding_span && b.binding_span
 where a.binding_span is not null
   and b.binding_span is not null;
