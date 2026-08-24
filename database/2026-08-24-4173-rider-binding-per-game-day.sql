-- #4173 — bind rytteren på de løbsdage han FAKTISK kører, ikke på hele spændet.
--
-- ROD-ÅRSAG. `race_entries.binding_span` er `int4range(min(game_day), max(game_day))`
-- — et INTERVAL, ikke en mængde. `no_rider_double_booking` afviser to entries for samme
-- rytter når intervallerne overlapper. Et etapeløb med en pause binder derfor rytteren på
-- pausedagene, hvor han ingenting kører.
--
-- Målt i prod 24/8 (sæson 3, før første start):
--   · Tour des Émirats: 7 etaper på løbsdag 8-13 (én pause) — spændet overlapper 7 andre løb
--   · Tour de l'Île de Hainan + Volta Algarvia: samme mønster i alle fire D3-puljer
--   · egomadsen fandt det selv i kalender-visningen: "emirats kører samtidig med 5 løb og
--     derfor låser rigtig meget" (#staff-chat 24/8 10:27)
--
-- Det arbejder direkte imod det formål komprimeringen findes for. @thelamba, #general
-- 24/8 07:43: "the races have been compressed a bit to avoid riders being locked for a
-- long time" — bindingen udvider præcis dét komprimeringen strammer.
--
-- Det er også dét der blokerer #4161-akse-reparationen: en korrekt in-game-akse spreder
-- et løbs etaper ud over den globale tæller, og med interval-binding ville D1 gå fra 1 til
-- 42 tomme bundne dage.
--
-- HVORFOR IKKE MULTIRANGE. `int4multirange` har `&&`, men Postgres 17 har INGEN GiST-
-- opklasse for multirange-typer (verificeret mod prod: pg_opclass har gist_uuid_ops men
-- intet for int4multirange). En EXCLUDE-constraint på multirange kan derfor ikke bygges.
-- Mængde-semantik kræver én række pr. (udtagelse, løbsdag) og en almindelig UNIQUE.
--
-- HVAD DER ÆNDRES.
--   · Ny tabel `race_entry_days` — én række pr. (løb, rytter, løbsdag).
--   · UNIQUE (rider_id, season_id, game_day) DEFERRABLE bærer nu invarianten.
--     season_id er IKKE valgfri: game_day er sæson-RELATIV og nulstilles hver sæson, så
--     uden den ville en S3-entry på løbsdag 4 kollidere med en S2-entry på løbsdag 4
--     (samme fejlklasse som #3070).
--   · DEFERRABLE INITIALLY IMMEDIATE — samme kontrakt som #3934/#4163, så
--     apply_race_entry_unit_batch fortsat kan lave lovlige swaps inden for én transaktion.
--   · FK (race_id, rider_id) → race_entries ON DELETE CASCADE, så en slettet udtagelse
--     rydder sine dage uden en femte trigger.
--   · `binding_span` BEVARES og vedligeholdes uændret, men bærer ikke længere en
--     constraint. Den er nu diagnostik (scripts/dev/verify-4155-staging.sql m.fl.).
--   · De fire eksisterende triggere udvides til også at genopbygge dag-rækkerne. Samme
--     fire skrivere, samme betingelser — beregningen bor stadig ét sted.
--
-- IDEMPOTENT. Tabel/constraint/kolonne bruger IF NOT EXISTS eller eksistens-guards,
-- funktioner er CREATE OR REPLACE, triggere droppes+genskabes. Ikke-destruktiv: ingen
-- DROP af data, og den gamle EXCLUDE-constraint droppes FØRST når den nye er på plads og
-- verificeret konfliktfri.
--
-- MÅLT FØR APPLY (prod 24/8, read-only): 76.284 dag-rækker for 2.560 ryttere over 314 løb.
-- Konflikter under mængde-semantik: 0. Constrainten kan altså tilføjes rent.
--
-- Refs #4173 #4161 #4162 #3420 #3934 #4163 #3070 #1823 #3114

begin;

-- ── 1. Tabellen ──────────────────────────────────────────────────────────────────
create table if not exists public.race_entry_days (
  race_id   uuid    not null,
  rider_id  uuid    not null,
  season_id uuid    not null,
  game_day  integer not null,
  team_id   uuid    not null,
  constraint race_entry_days_pkey primary key (race_id, rider_id, game_day),
  constraint race_entry_days_entry_fkey
    foreign key (race_id, rider_id)
    references public.race_entries(race_id, rider_id) on delete cascade
);

comment on table public.race_entry_days is
  '#4173: én række pr. (løb, rytter, løbsdag) — den EKSAKTE udgave af race_entries.binding_span.
  Bærer invarianten "1 rytter = 1 løb pr. in-game-dag" via UNIQUE (rider_id, season_id, game_day).
  Rækker findes KUN for bindende udtagelser: ikke færdigkørte løb, ikke afmeldte, ikke
  Monument-sentinel, og kun når hele løbets schedule har game_day. Vedligeholdes af de samme
  fire triggere som binding_span.';

create index if not exists race_entry_days_rider_season_idx
  on public.race_entry_days (rider_id, season_id, game_day);
create index if not exists race_entry_days_race_idx
  on public.race_entry_days (race_id);

-- ── 2. Genopbygnings-funktionen ──────────────────────────────────────────────────
-- Samme betingelser som race_entries_binding_span() — ét sted, så de to repræsentationer
-- ikke kan drive fra hinanden.
create or replace function public.race_entry_days_rebuild(p_race_id uuid, p_team_id uuid)
returns void
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  delete from public.race_entry_days d
   where d.race_id = p_race_id and d.team_id = p_team_id;

  -- Færdigkørte løb er ikke-bindende (ejer-valg 18/8, #3420-opfølgning).
  if exists (select 1 from public.races r where r.id = p_race_id and r.status = 'completed') then
    return;
  end if;

  -- Afmeldt løb for netop dette hold (Rod A, #1823).
  if exists (
    select 1 from public.race_withdrawals w
     where w.race_id = p_race_id and w.team_id = p_team_id
  ) then
    return;
  end if;

  -- Delvist backfillet schedule, eller Monument-sentinel (#3114): ikke-bindende.
  if exists (
    select 1 from public.race_stage_schedule s
     where s.race_id = p_race_id and s.game_day is null
  ) then
    return;
  end if;
  if (select min(s.game_day) from public.race_stage_schedule s where s.race_id = p_race_id) >= 100000 then
    return;
  end if;

  insert into public.race_entry_days (race_id, rider_id, season_id, game_day, team_id)
  select e.race_id, e.rider_id, r.season_id, s.game_day, e.team_id
    from public.race_entries e
    join public.races r on r.id = e.race_id
    join public.race_stage_schedule s on s.race_id = e.race_id
   where e.race_id = p_race_id
     and e.team_id = p_team_id
     and s.game_day is not null
  on conflict (race_id, rider_id, game_day) do nothing;
end;
$$;

comment on function public.race_entry_days_rebuild(uuid, uuid) is
  '#4173: genopbyg race_entry_days for ét (race_id, team_id)-par. Sletter altid først, og
  indsætter kun hvis udtagelsen er bindende — samme fire betingelser som
  race_entries_binding_span() bruger til at returnere NULL.';

-- ── 3. De fire triggere udvides ──────────────────────────────────────────────────
-- Trigger 1: race_entries. binding_span sættes stadig i BEFORE (kolonnen skal have sin
-- værdi før rækken skrives), men dag-rækkerne kræver at rækken FINDES (FK'en), så de
-- bygges i en separat AFTER-trigger.
create or replace function public.race_entries_sync_days() returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  if tg_op = 'UPDATE' and (old.race_id is distinct from new.race_id or old.team_id is distinct from new.team_id) then
    perform public.race_entry_days_rebuild(old.race_id, old.team_id);
  end if;
  perform public.race_entry_days_rebuild(new.race_id, new.team_id);
  return null;
end;
$$;

drop trigger if exists trg_race_entries_sync_days on public.race_entries;
create trigger trg_race_entries_sync_days
  after insert or update of race_id, team_id on public.race_entries
  for each row execute function public.race_entries_sync_days();

-- Trigger 2: race_stage_schedule — kalender-mutationer rammer ALLE hold i løbet.
create or replace function public.race_stage_schedule_resync_binding() returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_race_id uuid := coalesce(new.race_id, old.race_id);
  v_team_id uuid;
begin
  update public.race_entries
     set binding_span = public.race_entries_binding_span(race_id, team_id)
   where race_id = v_race_id;

  for v_team_id in
    select distinct team_id from public.race_entries where race_id = v_race_id
  loop
    perform public.race_entry_days_rebuild(v_race_id, v_team_id);
  end loop;
  return null;
end;
$$;

-- Trigger 3: race_withdrawals — kun det ene holds entries i det ene løb.
create or replace function public.race_withdrawals_resync_binding() returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_race_id uuid := coalesce(new.race_id, old.race_id);
  v_team_id uuid := coalesce(new.team_id, old.team_id);
begin
  update public.race_entries
     set binding_span = public.race_entries_binding_span(race_id, team_id)
   where race_id = v_race_id and team_id = v_team_id;
  perform public.race_entry_days_rebuild(v_race_id, v_team_id);
  return null;
end;
$$;

-- Trigger 4: races.status — et løb der bliver 'completed' frigiver sine ryttere.
create or replace function public.races_status_resync_binding() returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_team_id uuid;
begin
  update public.race_entries
     set binding_span = public.race_entries_binding_span(race_id, team_id)
   where race_id = new.id;

  for v_team_id in
    select distinct team_id from public.race_entries where race_id = new.id
  loop
    perform public.race_entry_days_rebuild(new.id, v_team_id);
  end loop;
  return null;
end;
$$;

-- ── 4. Backfill ──────────────────────────────────────────────────────────────────
-- Sæt-baseret, ikke pr. (race, team) — 76k rækker på én gang frem for tusindvis af
-- funktionskald. Betingelserne er de SAMME som race_entry_days_rebuild()'s; afvig ikke
-- her uden at rette begge.
delete from public.race_entry_days;

insert into public.race_entry_days (race_id, rider_id, season_id, game_day, team_id)
select e.race_id, e.rider_id, r.season_id, s.game_day, e.team_id
  from public.race_entries e
  join public.races r on r.id = e.race_id
  join public.race_stage_schedule s on s.race_id = e.race_id
 where r.status is distinct from 'completed'
   and s.game_day is not null
   and not exists (
     select 1 from public.race_withdrawals w
      where w.race_id = e.race_id and w.team_id = e.team_id
   )
   and not exists (
     select 1 from public.race_stage_schedule s2
      where s2.race_id = e.race_id and s2.game_day is null
   )
   and (select min(s3.game_day) from public.race_stage_schedule s3 where s3.race_id = e.race_id) < 100000
on conflict (race_id, rider_id, game_day) do nothing;

-- ── 5. Invarianten ───────────────────────────────────────────────────────────────
-- Guardet på samme måde som #3420: tæl og rejs en navngiven fejl frem for at lade
-- Postgres fejle generisk på ALTER TABLE.
do $$
declare
  v_conflicts integer;
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'no_rider_double_booking_day'
       and conrelid = 'public.race_entry_days'::regclass
  ) then
    select count(*) into v_conflicts from (
      select rider_id, season_id, game_day
        from public.race_entry_days
       group by rider_id, season_id, game_day
      having count(distinct race_id) > 1
    ) k;

    if v_conflicts > 0 then
      raise exception '#4173: % (rytter, sæson, løbsdag)-nøgler har 2+ løb — ryd dem FØR constrainten kan tilføjes. Constraint IKKE tilføjet.', v_conflicts
      using errcode = 'check_violation';
    end if;

    alter table public.race_entry_days
      add constraint no_rider_double_booking_day
      unique (rider_id, season_id, game_day)
      deferrable initially immediate;
  end if;
end $$;

-- ── 6. Den gamle interval-constraint droppes ────────────────────────────────────
-- FØRST her: den nye invariant er på plads og verificeret konfliktfri ovenfor, så der er
-- intet vindue uden beskyttelse. Kolonnen binding_span BEVARES som diagnostik.
alter table public.race_entries drop constraint if exists no_rider_double_booking;

comment on column public.race_entries.binding_span is
  '#3420, nu DIAGNOSTIK ONLY (#4173): løbets in-game-dag-SPÆND [min, max]. Bar tidligere
  EXCLUDE-constrainten no_rider_double_booking, men et spænd binder også de dage et løb
  holder pause. Invarianten ligger nu i race_entry_days (én række pr. faktisk løbsdag).
  Kolonnen vedligeholdes fortsat af de fire triggere og bruges af verifikations-scripts.';

-- ── 7. apply_race_entry_unit_batch: skift til den nye constraint ─────────────────
-- RPC'en (#3934/#4163) udskyder dobbeltbooking-checket til batchens afslutning, saa en
-- swaps insert maa eksistere FOER dens delete inden for samme transaktion. Den refererer
-- constrainten ved NAVN to steder og fanger dens fejlkode - begge skal med over, ellers
-- fejler hver eneste sweep-batch med "constraint does not exist".
--
-- Fejlkoden skifter samtidig: EXCLUDE gav 23P01 (exclusion_violation), UNIQUE giver
-- 23505 (unique_violation). Den oversatte fejl 'sweep_rider_bound' er uaendret, saa
-- JS-laget (raceEntryGenerator.js) ser praecis samme kontrakt som foer.
create or replace function public.apply_race_entry_unit_batch(p_team_id uuid, p_units jsonb)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_catalog'
as $batch$
declare
  v_unit jsonb;
  v_race_id uuid;
  v_vacate uuid[];
  v_deletes uuid[];
  v_rows bigint;
  v_inserted int := 0;
  v_removed int := 0;
  v_role_updated int := 0;
begin
  if p_units is null or jsonb_typeof(p_units) <> 'array' then
    raise exception 'sweep_invalid_batch' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_team_id::text));

  -- Udskyd dobbeltbooking-checket til batchens afslutning: en swaps insert maa
  -- gerne eksistere FOER dens delete inden for DENNE transaktion. Alle andre
  -- transaktioner ser stadig kun lovlige committede tilstande.
  set constraints no_rider_double_booking_day deferred;

  for v_unit in select * from jsonb_array_elements(p_units) loop
    v_race_id := (v_unit->>'race_id')::uuid;

    -- Forward-guard (#2074, spejler JS-laget): et igangvaerende/afsluttet loebs
    -- felt er frosset - hele batchen afvises eksplicit i stedet for at skrive.
    if exists (
      select 1 from public.races r
       where r.id = v_race_id
         and (coalesce(r.stages_completed, 0) > 0 or r.status <> 'scheduled')
    ) then
      raise exception 'sweep_race_lineup_frozen' using errcode = 'check_violation';
    end if;

    v_vacate := coalesce(
      (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_unit->'vacate', '[]'::jsonb)) t(x)),
      '{}'::uuid[]);
    v_deletes := coalesce(
      (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_unit->'deletes', '[]'::jsonb)) t(x)),
      '{}'::uuid[]);

    -- Vacate: special-rolle -> helper (frigoer uq_race_entries_*-slottet, CYCLINGZONE-2D).
    if array_length(v_vacate, 1) is not null then
      update public.race_entries
         set race_role = 'helper'
       where race_id = v_race_id and team_id = p_team_id
         and is_auto_filled = true and rider_id = any (v_vacate);
    end if;

    -- Delete FOER insert (raekkefoelgen er fri under transaktions-atomicitet; delete
    -- foerst minimerer hvor meget det udskudte check skal taale).
    if array_length(v_deletes, 1) is not null then
      delete from public.race_entries
       where race_id = v_race_id and team_id = p_team_id
         and is_auto_filled = true and rider_id = any (v_deletes);
      get diagnostics v_rows = row_count;
      v_removed := v_removed + v_rows;
    end if;

    insert into public.race_entries (race_id, rider_id, team_id, race_role, is_auto_filled)
    select v_race_id, (i->>'rider_id')::uuid, p_team_id, i->>'race_role', true
      from jsonb_array_elements(coalesce(v_unit->'inserts', '[]'::jsonb)) i
    on conflict (race_id, rider_id) do nothing;
    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;

    update public.race_entries e
       set race_role = p.race_role
      from (
        select (i->>'rider_id')::uuid as rider_id, i->>'race_role' as race_role
          from jsonb_array_elements(coalesce(v_unit->'promotions', '[]'::jsonb)) i
      ) p
     where e.race_id = v_race_id and e.team_id = p_team_id
       and e.is_auto_filled = true and e.rider_id = p.rider_id;
    get diagnostics v_rows = row_count;
    v_role_updated := v_role_updated + v_rows;
  end loop;

  -- Tving det udskudte check til at koere HER (inde i funktionen) i stedet for ved
  -- transaktions-commit - ellers kan EXCEPTION-blokken ikke fange fejlen, og kalderen
  -- ville faa en raa unique_violation i stedet for en navngiven fejl.
  begin
    set constraints no_rider_double_booking_day immediate;
  exception when unique_violation then
    raise exception 'sweep_rider_bound' using errcode = 'check_violation';
  end;

  return jsonb_build_object(
    'inserted', v_inserted,
    'removed', v_removed,
    'role_updated', v_role_updated
  );
end;
$batch$;

-- ── 8. replace_race_selection: guard på dag-MÆNGDEN, ikke spændet ────────────────
-- RPC'ens egen forhåndskontrol (#2256, under advisory-lås) brugte stadig den naive
-- {min,max}(game_day)-overlaps-test (w_start <= v_end AND v_start <= w_end) — præcis
-- den interval-semantik constrainten er holdt op med at bruge. Uden dette skridt kan
-- manageren stadig ikke gemme en rytter i et løb der ligger i et andet løbs PAUSE:
-- DB'en tillader det nu, men RPC'en afviser først med 'selection_rider_bound'.
--
-- Guarden læser race_entry_days direkte: rækkerne findes KUN for bindende udtagelser
-- (ikke completed, ikke afmeldt, fuldt backfillet, ikke monument-sentinel), så
-- withdrawal-/status-filtrene fra den gamle LATERAL bortfalder — de er allerede
-- indlejret i tabellens vedligehold (race_entry_days_rebuild). Sæson-scope (#3076) og
-- team-scope bevares. v_full-gaten bevares også: et delvist backfillet løb binder i
-- app-lagets CET-legacy-rum og skal ikke dag-matches mod game_day-rummet her.
CREATE OR REPLACE FUNCTION public.replace_race_selection(p_team_id uuid, p_race_id uuid, p_rider_ids uuid[], p_roles text[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_len int := coalesce(array_length(p_rider_ids, 1), 0);
  v_start int;
  v_end int;
  v_full boolean;
  v_season_id uuid;
BEGIN
  IF coalesce(array_length(p_roles, 1), 0) <> v_len THEN
    RAISE EXCEPTION 'selection_invalid_body' USING ERRCODE = 'check_violation';
  END IF;

  -- Serialisér mod samtidige skriv til samme hold (samme nøgle som move_race_entry).
  PERFORM pg_advisory_xact_lock(hashtext(p_team_id::text));

  -- Binding-guard UNDER lås (#2256): afvis hvis en af de gemte ryttere allerede er
  -- committet i et ANDET, ikke-afmeldt løb der DELER en faktisk løbsdag med dette løbs
  -- schedule (#4173 — mængde, ikke spænd). #3076: kun løb i SAMME sæson kan binde.
  IF v_len > 0 THEN
    SELECT r.season_id INTO v_season_id
      FROM races r WHERE r.id = p_race_id;

    SELECT min(s.game_day), max(s.game_day), count(*) = count(s.game_day)
      INTO v_start, v_end, v_full
      FROM race_stage_schedule s
     WHERE s.race_id = p_race_id;

    -- Kun når DETTE løb er fuldt game_day-backfillet (ellers legacy-fallback i app-laget).
    IF v_full AND v_start IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
          FROM race_entry_days d
          JOIN race_stage_schedule s
            ON s.race_id = p_race_id
           AND s.game_day = d.game_day
         WHERE d.team_id = p_team_id
           AND d.race_id <> p_race_id
           AND d.season_id IS NOT DISTINCT FROM v_season_id
           AND d.rider_id = ANY (p_rider_ids)
      ) THEN
        RAISE EXCEPTION 'selection_rider_bound' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- Erstat holdets entries for løbet atomisk (hele delete+insert i denne transaktion).
  DELETE FROM race_entries WHERE race_id = p_race_id AND team_id = p_team_id;

  IF v_len > 0 THEN
    INSERT INTO race_entries (race_id, rider_id, team_id, race_role, is_auto_filled)
    SELECT p_race_id, p_rider_ids[i], p_team_id, p_roles[i], false
    FROM generate_series(1, v_len) AS g(i);
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.replace_race_selection(uuid, uuid, uuid[], text[]) IS
  'Atomisk erstat holdets race_entries for ét løb (#2173) + binding-guard under '
  'advisory-lås (#2256), sæson-scopet (#3076). #4173: guarden matcher på DELTE '
  'faktiske løbsdage via race_entry_days (mængde-semantik) — et etapeløb med pause '
  'binder ikke pausedagene. Afviser selection_rider_bound hvis en gemt rytter '
  'allerede er committet i et andet ikke-afmeldt løb på en delt løbsdag. '
  'is_auto_filled=false (manuel udtagelse).';

commit;
