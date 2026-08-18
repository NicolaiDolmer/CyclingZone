-- #3934 — Gør sweepens rytter-swaps LOVLIGE under #3420-constrainten i stedet
-- for at lappe endnu en retry-gren oven på dem.
--
-- Rod-årsag (fuld diagnose i issue #3934, prod-incident 18/8): #3420-constrainten
-- (no_rider_double_booking, applied 18/8 07:56 DK) checker IMMEDIATE pr. række.
-- Sweepens diff-writer (raceEntryGenerator.js) skriver via PostgREST — hver
-- upsert/delete er sin EGEN transaktion, så "aldrig-tommere"-garantien måtte
-- sikres med insert-FØR-delete pr. (race,team)-enhed. En rytter-flytning mellem
-- to overlappende løb for samme hold er to separate enheder: insert i det nye løb
-- rammer constrainten FØR delete i det gamle er kørt → transient dobbeltbooking →
-- 23P01 → hele enhedens upsert afvises. Deterministisk dødvande: samme ~350
-- enheder fejlede hvert tick (CYCLINGZONE-32/-2D) og kunne aldrig selvhele.
--
-- Fix i tre dele (ejer-go 18/8 på verdensklasse-retningen, ikke retry-hotfixet):
--   1. Constrainten gøres DEFERRABLE INITIALLY IMMEDIATE. Nul adfærdsændring for
--      alle eksisterende single-statement-skrivere (checket kører stadig pr.
--      statement som standard) — men en transaktion der EKSPLICIT beder om det
--      (SET CONSTRAINTS ... DEFERRED) får checket udskudt, så en swap er lovlig
--      som helhed uden at "midtvejs" nogensinde er synlig committet tilstand.
--      Invarianten holder uændret for ENHVER committet tilstand.
--   2. Ny RPC apply_race_entry_unit_batch: applier ALLE et holds enheds-diffs
--      (vacate/delete/insert/promote) i ÉN transaktion med deferred check.
--      Atomicitet overtager aldrig-tommere-garantien (crash = rollback), så
--      rækkefølgen er fri og cross-enheds-swaps trivielle. SET CONSTRAINTS ...
--      IMMEDIATE til sidst tvinger det udskudte check til at køre INDE i
--      funktionen, hvor EXCEPTION-blokken kan fange 23P01 og oversætte til den
--      navngivne fejl 'sweep_rider_bound' (#3098-mønsteret, samme princip som
--      replace_race_selection's 'selection_rider_bound').
--   3. Trigger på races.status: enhver status-ændring resynkroniserer løbets
--      entries' binding_span via den kanoniske race_entries_binding_span().
--      Lukker det sekundære hul fra 18/8: completion ændrer races.status, men
--      #3420-triggerne sidder på race_entries/race_stage_schedule/
--      race_withdrawals — så færdige løbs entries beholdt deres spans og
--      blokerede ryttere på game days der stadig kørte (datarepareret engangs
--      18/8: 1.703 rækker / 12 løb; DETTE er forward-guarden).
--
-- Idempotent: constraint-ombygningen er guardet på condeferrable, funktioner er
-- CREATE OR REPLACE, triggeren droppes+genskabes. Ikke-destruktiv (ingen
-- DELETE/DROP af data; drop+re-add af constrainten sker i ÉN transaktion og
-- revaliderer eksisterende rækker). APPLY IKKE her — orkestrator applier
-- post-merge under #2642-rammerne.
--
-- Refs #3934, #3420, #3906, #2642.

begin;

-- 1. Constraint → DEFERRABLE INITIALLY IMMEDIATE. Postgres kan ikke ALTER en
-- exclusion-constraint til deferrable, så drop+re-add — i SAMME transaktion, så
-- der aldrig findes et committet øjeblik uden backstop. Guardet på condeferrable
-- → no-op ved gentagen kørsel. Re-add revaliderer alle rækker (fejler eksplicit
-- hvis nye brud skulle være opstået siden 18/8-backfillen).
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

-- 2. RPC: applier et holds enheds-diffs atomisk. p_units er en jsonb-array:
--   [{ "race_id": uuid,
--      "vacate":     [rider_id, ...],                      -- special-rolle → helper
--      "deletes":    [rider_id, ...],                      -- forældede auto-rækker
--      "inserts":    [{"rider_id": uuid, "race_role": text}, ...],
--      "promotions": [{"rider_id": uuid, "race_role": text}, ...] }, ...]
-- Serialiserer pr. hold med SAMME advisory-lås som replace_race_selection/
-- move_race_entry (hashtext(team_id)), så en manager-gem og sweepen aldrig
-- flætter deres skriv. Rører KUN is_auto_filled=true-rækker (delete/update);
-- inserts skrives med is_auto_filled=true og ON CONFLICT DO NOTHING på PK'en
-- (ghost-rækker under et andet hold springes over — spejler ignoreDuplicates i
-- den gamle JS-vej; næste tick samler dem op). Returnerer tællinger til loggen.
create or replace function public.apply_race_entry_unit_batch(p_team_id uuid, p_units jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'pg_catalog'
as $function$
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

  -- Udskyd dobbeltbooking-checket til batchens afslutning: en swaps insert må
  -- gerne eksistere FØR dens delete inden for DENNE transaktion. Alle andre
  -- transaktioner ser stadig kun lovlige committede tilstande.
  set constraints no_rider_double_booking deferred;

  for v_unit in select * from jsonb_array_elements(p_units) loop
    v_race_id := (v_unit->>'race_id')::uuid;

    -- Forward-guard (#2074, spejler JS-laget): et igangværende/afsluttet løbs
    -- felt er frosset — hele batchen afvises eksplicit i stedet for at skrive.
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

    -- Vacate: special-rolle → helper (frigør uq_race_entries_*-slottet, CYCLINGZONE-2D).
    if array_length(v_vacate, 1) is not null then
      update public.race_entries
         set race_role = 'helper'
       where race_id = v_race_id and team_id = p_team_id
         and is_auto_filled = true and rider_id = any (v_vacate);
    end if;

    -- Delete FØR insert (rækkefølgen er fri under transaktions-atomicitet; delete
    -- først minimerer hvor meget det udskudte check skal tåle).
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

    -- Vacate-rækker hvis ENDELIGE rolle er helper tælles som rolle-opdateret
    -- (promotions dækker resten) — JS-laget leverer tællegrundlaget i vacate/
    -- promotions-felterne, så totalerne her matcher den gamle vejs semantik tæt
    -- nok til driftslog-formål uden dobbeltbogholderi.
  end loop;

  -- Tving det udskudte check til at køre HER (inde i funktionen) i stedet for
  -- ved transaktions-commit — ellers kan EXCEPTION-blokken ikke fange 23P01, og
  -- kalderen ville få en rå exclusion_violation i stedet for en navngiven fejl.
  begin
    set constraints no_rider_double_booking immediate;
  exception when exclusion_violation then
    raise exception 'sweep_rider_bound' using errcode = 'check_violation';
  end;

  return jsonb_build_object(
    'inserted', v_inserted,
    'removed', v_removed,
    'role_updated', v_role_updated
  );
end;
$function$;

comment on function public.apply_race_entry_unit_batch(uuid, jsonb) is
  '#3934: applier ALLE et holds (race,team)-enheds-diffs fra entry-sweepen i ÉN '
  'transaktion under advisory-lås (samme nøgle som replace_race_selection) med '
  'no_rider_double_booking DEFERRED — cross-enheds rytter-swaps er lovlige som '
  'helhed, atomicitet erstatter insert-før-delete som aldrig-tommere-garanti. '
  'SET CONSTRAINTS IMMEDIATE til sidst oversætter 23P01 til sweep_rider_bound '
  '(#3098-mønsteret). Rører kun is_auto_filled=true-rækker; frosne løb afvises '
  'med sweep_race_lineup_frozen.';

-- 3. Forward-guard for det sekundære hul: races.status-ændringer resynkroniserer
-- løbets entries' binding_span via den kanoniske funktion (completed → NULL,
-- genåbning → span igen). Uden denne beholdt færdige løbs entries deres spans
-- og blokerede ryttere på game days der stadig kørte (prod 18/8, 12 løb).
create or replace function public.races_status_resync_binding() returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  update public.race_entries
     set binding_span = public.race_entries_binding_span(race_id, team_id)
   where race_id = new.id;
  return null; -- AFTER-trigger, returværdi ignoreres
end;
$$;

drop trigger if exists trg_races_status_resync_binding on public.races;
create trigger trg_races_status_resync_binding
  after update of status on public.races
  for each row
  when (old.status is distinct from new.status)
  execute function public.races_status_resync_binding();

commit;

-- Post-verify (kør efter apply, alle read-only):
--   1. select condeferrable, condeferred from pg_constraint
--        where conname = 'no_rider_double_booking';            -- (true, false)
--   2. select proname from pg_proc where proname = 'apply_race_entry_unit_batch'; -- 1 række
--   3. select tgname from pg_trigger where tgname = 'trg_races_status_resync_binding'; -- 1 række
--   4. select count(*) from race_entries e join races r on r.id = e.race_id
--        where r.status = 'completed' and e.binding_span is not null;  -- 0 (og BLIVER 0 fremover)
--   5. Næste sweep-tick i Railway-loggen: failed_units skal falde fra ~350 mod 0.
