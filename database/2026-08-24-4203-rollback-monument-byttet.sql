-- ROLLBACK af #4203-byttet (database/2026-08-24-4203-monumenter-ud-af-gt-vinduer.sql).
--
-- HVORFOR. Byttet flyttede fire Monumenter ud af GT-vinduerne som ejeren bad om, og
-- bestod sin egen post-verify (trin 3b: intet Monument inde i et GT-vindue). Men den
-- gate var blind for en ANDEN ejer-laast regel: #4075, at et Monument har sin EGEN,
-- EKSKLUSIVE loebsdag, saa hver eneste rytter kan stille op. Maalt i prod umiddelbart
-- efter kørslen delte alle fire flyttede Monumenter dag med 1-2 andre loeb:
--
--   Milano-Riviera          ld  9  med Tour du Leman + Tour of South Australia
--   De Vlaamse Ronde        ld 31  med Tour des Emirats + Tour de la Vistule
--   L'Enfer du Nord         ld 35  med Tour des Volcans d'Auvergne
--   La Doyenne des Ardennes ld 42  med Vuelta Vasca
--
-- Den daglige kalender-invariant-audit fangede det med det samme (invariant
-- calendar_monument_exclusive_game_day, tilfoejet 24/8 i PR #4169). Det er praecis
-- den arbejdsdeling #4176 blev bygget for: en migration kan bestaa sin egen gate og
-- alligevel bryde en regel den ikke kender.
--
-- HVORFOR IKKE FIKSE FREMAD. Maalt: D1 har 40 loebsdage med kun eet loeb, men kun 6 af
-- dem ligger UDEN for et GT-vindue, og der skal bruges fire. De to ejer-regler kan
-- altsaa ikke begge holdes i S3's kalender, hvor tre Grand Tours fylder 70 % af
-- divisionens saeson. Det er GT-komprimeringen der skal loeses foerst (#4176), ikke
-- placeringen af Monumenterne. Ejer-beslutning 24/8: rul tilbage nu, tag det rigtigt
-- sammen med komprimeringen.
--
-- HVAD DER GENDANNES.
--   1. De otte loebs schedule (game_day + scheduled_at) fra backup_4203_old_schedule
--      samt races.game_day_start.
--   2. De udtagelser assistenten har lavet PAA DE OTTE LOEB siden byttet fjernes, saa
--      felterne ikke staar med to generationer oven i hinanden.
--   3. De 356 udtagelser byttet fjernede gendannes fra backup_4203_removed_entries.
--
-- Verificeret read-only FOER kørslen: de 356 kolliderer med NUL beholdte udtagelser paa
-- deres gamle loebsdage (season-filtreret mod sæson 3). Rollbacken kan altsaa ikke
-- bryde no_rider_double_booking_day.
--
-- MELLEMTILSTAND: constraint'en udsaettes til commit, se noten ved set constraints.
--
-- IDEMPOTENT via markoer-tabellen backup_4203_rolled_back_at: anden kørsel er en no-op.
-- Uden den ville et gentaget kald slette de udtagelser assistenten laver EFTER
-- rollbacken, fordi slette-reglen er tidsbaseret.
--
-- Ingen data gaar tabt: begge backup-tabeller bevares efter kørslen.

begin;

-- Mellemtilstands-problemet, faktisk maalt: foerste forsoeg 24/8 21:54 fejlede med
--   Key (rider_id, season_id, game_day)=(..., 26) already exists
-- La Doyenne flyttes TILBAGE til loebsdag 26 mens La Classique Bretonne flyttes VAEK
-- fra 26. Schedule-opdateringen rammer alle otte loeb i eet statement, og AFTER ROW-
-- triggeren genopbygger dag-raekkerne pr. raekke. Rammer La Doyennes genopbygning
-- foerst, holder begge loeb dag 26 samtidig, og den UMIDDELBARE constraint afviser.
-- Slut-tilstanden er lovlig (verificeret: nul kollisioner), det er kun vejen dertil
-- der ikke er det. Derfor udsaettes constraint'en til commit. Det er praecis dét den
-- er DEFERRABLE for (#3934/#4163) — samme greb som apply_race_entry_unit_batch bruger.
set constraints public.no_rider_double_booking_day deferred;

create table if not exists public.backup_4203_rolled_back_at (
  rullet_at timestamptz primary key default now(),
  raekker_gendannet integer,
  sweep_raekker_fjernet integer
);

do $$
declare
  v_t0        timestamptz;
  v_fjernet   integer := 0;
  v_gendannet integer := 0;
  v_delt      integer;
  v_dublet    integer;
  v_forkert   integer;
begin
  if exists (select 1 from public.backup_4203_rolled_back_at) then
    raise notice '#4203 rollback: allerede kørt, springer over (idempotent).';
    return;
  end if;

  select min(fjernet_at) into v_t0 from public.backup_4203_removed_entries;
  if v_t0 is null then
    raise exception '#4203 rollback: backup_4203_removed_entries er tom, intet at gendanne.'
      using errcode = 'no_data_found';
  end if;

  -- 1. Assistentens efterfoelgende udtagelser paa de otte loeb fjernes foerst, saa
  --    dag-raekkerne er frie naar schedule flyttes tilbage.
  with slettet as (
    delete from public.race_entries e
     where e.race_id in (select race_id from public.backup_4203_old_schedule)
       and e.created_at > v_t0
    returning 1
  ) select count(*) into v_fjernet from slettet;

  -- 2. Schedule tilbage. Triggeren (race_stage_schedule_resync_binding, #4173)
  --    genopbygger race_entry_days for alle hold i loebet.
  update public.race_stage_schedule s
     set game_day = b.game_day, scheduled_at = b.scheduled_at
    from public.backup_4203_old_schedule b
   where s.race_id = b.race_id and s.stage_number = b.stage_number
     and (s.game_day is distinct from b.game_day or s.scheduled_at is distinct from b.scheduled_at);

  update public.races r
     set game_day_start = b.game_day
    from public.backup_4203_old_schedule b
   where r.id = b.race_id and r.game_day_start is distinct from b.game_day;

  -- 3. De fjernede udtagelser tilbage.
  with gendannet as (
    insert into public.race_entries (race_id, rider_id, team_id, race_role, is_auto_filled)
    select b.race_id, b.rider_id, b.team_id, b.race_role, b.is_auto_filled
      from public.backup_4203_removed_entries b
    on conflict do nothing
    returning 1
  ) select count(*) into v_gendannet from gendannet;

  -- ------------------------------------------------------------ post-verify
  -- 4a. Alle otte loeb ligger igen paa deres gamle slot.
  select count(*) into v_forkert
    from public.backup_4203_old_schedule b
    join public.race_stage_schedule s on s.race_id = b.race_id and s.stage_number = b.stage_number
   where s.game_day <> b.game_day or s.scheduled_at <> b.scheduled_at;
  if v_forkert > 0 then
    raise exception '#4203 rollback 4a: % etape-raekker er ikke tilbage paa deres gamle slot.', v_forkert
      using errcode = 'check_violation';
  end if;

  -- 4b. #4075 holder igen: intet Monument deler loebsdag med et andet loeb i puljen.
  select count(*) into v_delt
    from public.races m
    join public.race_stage_schedule ms on ms.race_id = m.id
   where m.season_id = '00000000-0000-0000-0000-000000000003'
     and m.race_class = 'Monuments'
     and exists (
       select 1 from public.races o
         join public.race_stage_schedule os on os.race_id = o.id
        where o.season_id = m.season_id
          and o.league_division_id = m.league_division_id
          and o.id <> m.id
          and os.game_day = ms.game_day
     );
  if v_delt > 0 then
    raise exception '#4203 rollback 4b: % monument-etape(r) deler stadig loebsdag — #4075 ikke genoprettet.', v_delt
      using errcode = 'check_violation';
  end if;

  -- 4c. Rytter-dags-invarianten (#4173).
  select count(*) into v_dublet from (
    select rider_id, season_id, game_day from public.race_entry_days
     group by 1, 2, 3 having count(distinct race_id) > 1
  ) k;
  if v_dublet > 0 then
    raise exception '#4203 rollback 4c: % (rytter, saeson, loebsdag)-noegler har 2+ loeb.', v_dublet
      using errcode = 'check_violation';
  end if;

  insert into public.backup_4203_rolled_back_at (raekker_gendannet, sweep_raekker_fjernet)
  values (v_gendannet, v_fjernet);

  raise notice '#4203 rollback: % sweep-raekker fjernet, % udtagelser gendannet. Monumenterne har igen deres loebsdag alene.',
    v_fjernet, v_gendannet;
end $$;

commit;
