-- #4534 — frys-guarden i replace_race_selection_bulk gaelder nu BEGGE retninger.
--
-- BAGGRUND. Saesonmatrixens gem-vagt var asymmetrisk: tilfoejelse til et startet loeb
-- blev afvist (selection_race_started), men REN FJERNELSE gik igennem (#2637-undtagelsen,
-- "en skadet rytter skal altid kunne fjernes"). Live-test 31/8 (Discord 22:08-22:22):
-- en spiller fjernede sin kaptajn fra et IGANGVAERENDE etapeloeb via matrixen — rytteren
-- forsvandt fra feltet, kunne ikke gen-tilfoejes og blev straks ledig til andre loeb.
-- Ejer-beslutning (Discord 22:21): frivillig udtraeden findes ikke som mekanik endnu;
-- fjernelse blokeres som tilfoejelse.
--
-- App-laget (prepareSelectionChange, backend/lib/raceSelection.js) afviser nu ubetinget
-- ved stages_completed>0 — denne fil spejler den regel i RPC'ens egen TOCTOU-backstop
-- (regel 2 i hovedloopet), som ellers stadig ville tillade en ren fjernelse i vinduet
-- mellem app-lagets pre-flight og transaktionens commit (praecis det vindue backstoppet
-- findes for). Regel 1 (status <> 'scheduled' -> selection_race_not_open) er uaendret.
-- v_current_rider_ids-opslaget (delmaengde-testen fra #4310/FUND4) bortfalder — der er
-- ingen delmaengde-undtagelse at teste laengere.
--
-- IDEMPOTENT. CREATE OR REPLACE; ingen data roeres af denne fil. Ikke destruktiv
-- (#2642-rammer).
--
-- POST-VERIFY (read-only, koer efter apply):
--   1. select pg_get_functiondef('public.replace_race_selection_bulk(uuid,jsonb,jsonb)'::regprocedure);
--      -- forventet: "if v_frozen then raise exception 'selection_race_started'" UDEN
--      -- delmaengde-test; ingen reference til v_current_rider_ids.
--   2. select proname from pg_proc where proname = 'replace_race_selection_bulk'; -- 1 raekke
--
-- Refs #4534 #1146 #2637 #2074 #4310
begin;

create or replace function public.replace_race_selection_bulk(
  p_team_id uuid,
  p_changes jsonb,
  p_auto_releases jsonb default '[]'::jsonb
)
returns void
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_change jsonb;
  v_release jsonb;
  v_race_id uuid;
  v_rider_ids uuid[];
  v_roles text[];
  v_len int;
  v_frozen boolean;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'selection_invalid_body' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_changes) > 60 then
    raise exception 'selection_bulk_too_large' using errcode = 'check_violation';
  end if;

  -- Serialisér mod samtidige skriv til samme hold (samme noegle som replace_race_selection/
  -- apply_race_entry_unit_batch/move_race_entry).
  perform pg_advisory_xact_lock(hashtext(p_team_id::text));

  -- Udskyd dobbeltbooking-checket til batchens afslutning (#3934-moensteret): en lovlig
  -- swap mellem to p_changes-loeb maa gerne eksistere midlertidigt inden for DENNE
  -- transaktion, uanset hvilken raekkefoelge p_changes leverer dem i.
  set constraints no_rider_double_booking_day deferred;

  -- #2637-frigivelser (auto-udtagne ryttere i IKKE-beroerte loeb) FOER selve erstatningen,
  -- saa de nye p_changes-raekker aldrig midlertidigt mangler deres frigjorte plads.
  for v_release in select * from jsonb_array_elements(coalesce(p_auto_releases, '[]'::jsonb)) loop
    -- Forward-guard for FRIGIVELSER (FUND3, CodeRabbit-review af #4316-PR'en): en
    -- #2637-frigivelse er kun `resolvable` naar entryen er auto-udtaget OG loebet IKKE
    -- er startet — et loeb der startede MELLEM app-lagets klassifikation og denne
    -- transaktion afvises her. Fejlkoden er `selection_rider_bound` (ikke
    -- `selection_race_started`): app-laget ville have lagt praecis denne konflikt i
    -- `blocking` og svaret 409 selection_rider_bound (saveSelectionBulk mapper koden).
    if exists (
      select 1 from public.races r
       where r.id = (v_release->>'race_id')::uuid
         and coalesce(r.stages_completed, 0) > 0
    ) then
      raise exception 'selection_rider_bound' using errcode = 'check_violation';
    end if;

    delete from public.race_entries
     where race_id = (v_release->>'race_id')::uuid
       and team_id = p_team_id
       and rider_id = (v_release->>'rider_id')::uuid
       and is_auto_filled = true;

    -- Redundant backstop (FUND2, #4310-refutation, verificeret i
    -- backend/lib/testdb/raceSelectionBulkRpc.integration.test.js): DELETE'en cascader
    -- allerede race_entry_days via race_entry_days_entry_fkey ON DELETE CASCADE;
    -- rebuild-kaldet goer korrektheden uafhaengig af at en fremtidig migration bevarer
    -- den cascade, og daekker at loebet OGSAA optraeder i p_changes senere i batchen.
    perform public.race_entry_days_rebuild((v_release->>'race_id')::uuid, p_team_id);
  end loop;

  for v_change in select * from jsonb_array_elements(p_changes) loop
    v_race_id := (v_change->>'race_id')::uuid;

    select array_agg(x::uuid) into v_rider_ids
      from jsonb_array_elements_text(coalesce(v_change->'rider_ids', '[]'::jsonb)) t(x);
    v_rider_ids := coalesce(v_rider_ids, '{}'::uuid[]);

    select array_agg(x) into v_roles
      from jsonb_array_elements_text(coalesce(v_change->'roles', '[]'::jsonb)) t(x);
    v_roles := coalesce(v_roles, '{}'::text[]);

    v_len := coalesce(array_length(v_rider_ids, 1), 0);
    if coalesce(array_length(v_roles, 1), 0) <> v_len then
      raise exception 'selection_invalid_body' using errcode = 'check_violation';
    end if;

    -- Forward-guard som TOCTOU-backstop (#2074/#4310) — spejler prepareSelectionChange
    -- (backend/lib/raceSelection.js) 1:1 som TO ADSKILTE regler:
    --   1) status <> 'scheduled' -> UBETINGET afvisning (selection_race_not_open).
    --   2) stages_completed > 0  -> UBETINGET afvisning (selection_race_started).
    -- #4534: regel 2's tidligere delmaengde-undtagelse ("kun REN FJERNELSE tilladt",
    -- #1825/#2637) er fjernet — frivillig udtraeden findes ikke som mekanik endnu
    -- (ejer-beslutning 31/8), saa et startet loebs lineup er laast i begge retninger.
    -- App-laget haandhaever samme regler FOER kaldet; dette fanger et loeb der skiftede
    -- tilstand MENS batchen blev forberedt (fx et stage-scheduler-tick midt i bulk-save).
    if exists (
      select 1 from public.races r
       where r.id = v_race_id and r.status <> 'scheduled'
    ) then
      raise exception 'selection_race_not_open' using errcode = 'check_violation';
    end if;

    select coalesce(r.stages_completed, 0) > 0
      into v_frozen
      from public.races r
     where r.id = v_race_id;

    if v_frozen then
      raise exception 'selection_race_started' using errcode = 'check_violation';
    end if;

    -- Erstat holdets entries for DETTE loeb atomisk (samme kerne som replace_race_selection).
    -- Peer-/DB-binding-guarden ligger IKKE her — app-lagets ansvar FOER kaldet (se api.js);
    -- det udskudte constraint-tjek nedenfor er backstoppet.
    delete from public.race_entries where race_id = v_race_id and team_id = p_team_id;

    if v_len > 0 then
      insert into public.race_entries (race_id, rider_id, team_id, race_role, is_auto_filled)
      select v_race_id, v_rider_ids[i], p_team_id, v_roles[i], false
      from generate_series(1, v_len) as g(i);
    end if;

    -- Redundant backstop (FUND2) — samme begrundelse som i frigivelses-loopet ovenfor.
    perform public.race_entry_days_rebuild(v_race_id, p_team_id);
  end loop;

  -- Tving det udskudte check til at koere HER (#3934-moensteret): fanger en dobbeltbooking
  -- app-lagets pre-flight oversaa (TOCTOU mod en samtidig skriver), oversat til den
  -- navngivne fejl i stedet for en opak unique_violation ved commit.
  begin
    set constraints no_rider_double_booking_day immediate;
  exception when unique_violation then
    raise exception 'selection_rider_bound' using errcode = 'check_violation';
  end;
end;
$function$;

comment on function public.replace_race_selection_bulk(uuid, jsonb, jsonb) is
  '#1146: erstat holdets race_entries for FLERE loeb atomisk i en transaktion
  (saesonmatrix "Gem plan"). Advisory-laas pr. hold (samme noegle som
  replace_race_selection), no_rider_double_booking_day udskudt til batchens afslutning saa
  en lovlig swap mellem to p_changes-loeb er raekkefoelge-uafhaengig (#3934-moensteret).
  p_auto_releases frigiver #2637-konflikter i UBEROERTE loeb i SAMME transaktion. App-laget
  (api.js) validerer roller/trupstoerrelse/pulje-binding FOER kaldet — samme regler som PUT
  /:raceId/selection (prepareSelectionChange). Egen SQL-niveau forward-guard (#2074/#4310)
  afviser en TOCTOU-aendring af et loeb der blev startet/frosset/afsluttet efter app-lagets
  pre-flight; #4534: frys-reglen gaelder BEGGE retninger (ingen fjernelses-undtagelse).';

commit;
