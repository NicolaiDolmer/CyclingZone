-- #1146 — bulk-gem-endpoint til sæsonmatrixens kladde-model.
--
-- BEHOV. Sæsonmatrixen lader manageren redigere MANGE løbs udtagelse som en kladde og
-- gemme det HELE med et klik ("Gem plan", ejer-beslutning 25/8, kommentar #1146). Et kald
-- pr. løb (PUT /:raceId/selection, N gange) rammer to problemer:
--   1. marketWriteLimiter tillader 30 skrivninger/60s (backend/lib/rateLimiters.js:64-70) —
--      en kladde med >30 celler ville fejle midtvejs.
--   2. En LOVLIG swap (en rytter flyttes fra løb A til løb B i SAMME gem) er rækkefølge-
--      afhængig med replace_race_selection's PRE-CHECK-mønster: gemmes B før A i to
--      separate kald, ser B's pre-check stadig A's (endnu ikke slettede) entry og afviser
--      en helt lovlig flytning.
--
-- LØSNING. Genbruger IKKE apply_race_entry_unit_batch (#3934) direkte — den rører KUN
-- is_auto_filled=true-rækker (sweep-diffs: vacate/delete/insert/promote) og kender ikke
-- til manager-rollerne (captain/sprint_captain/hunter/free_role) eller validateSelection-
-- kontrakten. I stedet: en NY RPC efter SAMME mønster (advisory-lås pr. hold,
-- no_rider_double_booking_day-checket UDSKUDT til batchens afslutning, så en lovlig swap
-- mellem to p_changes-løb er rækkefølge-uafhængig).
--
-- App-laget (backend/routes/api.js, PUT /races/selection/bulk) har allerede valideret
-- HVER ændring før dette kald: samme prepareSelectionChange (backend/lib/
-- raceSelection.js) som single-endpointet PUT /:raceId/selection genbruger (roller mod
-- VALID_RACE_ROLES, trupstørrelse pr. klasse, lineup-frozen+fjernelse-undtagelse,
-- pulje-binding), plus peer- og DB-binding-konflikter (samme #2637-klassifikation som
-- single-endpointet: auto-udtaget+ikke-startet løb frigives automatisk, alt andet
-- afvises navngivet FØR noget som helst skrives). Denne RPC's egen deferred-check er
-- derfor et BACKSTOP mod en SAMTIDIG skriver fra en anden session (TOCTOU) — ikke den
-- primære validering, ligesom replace_race_selection's egen guard er det for single-
-- endpointet.
--
-- p_changes: jsonb-array [{ "race_id": uuid, "rider_ids": [uuid,...], "roles": [text,...] }].
--   Erstatter holdets race_entries for HVERT løb fuldstændigt (samme semantik som
--   replace_race_selection pr. løb), is_auto_filled=false.
-- p_auto_releases: jsonb-array [{ "race_id": uuid, "rider_id": uuid }] — #2637-mønsteret:
--   ryttere der frigives fra et AUTO-udtaget, IKKE-startet løb UDENFOR denne batch, fordi
--   de nu bindes af en af p_changes' løb (app-laget klassificerer resolvable/blocking, kun
--   resolvable ender her). Udføres FØR p_changes, i SAMME transaktion — giver bulk-
--   kaldet stærkere atomicitet end single-endpointet i dag (der frigiver via et separat,
--   IKKE-transaktionelt kald FØR sin egen RPC, se PUT /:raceId/selection).
--
-- ALT-ELLER-INTET. En fejl (ukendt rolle-længde, dobbeltbooking der overlever app-lagets
-- pre-flight) ruller HELE kaldet tilbage — ingen delvist gemte løb. Pulje-binding/
-- trupstørrelse håndhæves IKKE her (se begrundelse ovenfor) — de er allerede håndhævet
-- af prepareSelectionChange før kaldet. Frys-guarden (stages_completed>0/status≠scheduled)
-- HAR derimod sin egen SQL-backstop nedenfor (#4310-refutation, spejler
-- apply_race_entry_unit_batch's sweep_race_lineup_frozen) — se hovedloopet.
--
-- race_entry_days-OPRYDNING (#4310-refutation, verificeret via
-- backend/lib/testdb/raceSelectionBulkRpc.integration.test.js mod ægte Postgres-DDL):
-- trg_race_entries_sync_days (database/2026-08-24-4173-...sql) fyrer KUN på insert/update
-- af race_id/team_id, ALDRIG på DELETE — men race_entry_days_entry_fkey er selv ON DELETE
-- CASCADE fra race_entry_days(race_id,rider_id) → race_entries(race_id,rider_id), så hver
-- delete i hovedloopet/auto-release-loopet nedenfor rydder sine race_entry_days-rækker
-- SYNKRONT via denne cascade, uanset om løbets ønskeliste bagefter er tom eller ej. De
-- eksplicitte race_entry_days_rebuild-kald i loopene er derfor et bevidst REDUNDANT
-- backstop (defense-in-depth), ikke en rettelse af et hul — se kommentarerne inline.
--
-- IDEMPOTENT. CREATE OR REPLACE; ingen data røres af denne fil. Ejeren applier post-merge
-- under #2642-rammerne (idempotent + post-verify, ikke destruktiv). APPLY IKKE her.
--
-- POST-VERIFY (read-only, kør efter apply):
--   1. select pg_get_functiondef('public.replace_race_selection_bulk(uuid,jsonb,jsonb)'::regprocedure);
--      -- forventet: SET CONSTRAINTS no_rider_double_booking_day DEFERRED, loop over
--      -- p_changes, SET CONSTRAINTS ... IMMEDIATE til sidst.
--   2. select proname from pg_proc where proname = 'replace_race_selection_bulk'; -- 1 række
--
-- Refs #1146 #3934 #4173 #2642 #2637 #2074 #4310
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
  v_current_rider_ids uuid[];
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'selection_invalid_body' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_changes) > 60 then
    raise exception 'selection_bulk_too_large' using errcode = 'check_violation';
  end if;

  -- Serialisér mod samtidige skriv til samme hold (samme nøgle som replace_race_selection/
  -- apply_race_entry_unit_batch/move_race_entry).
  perform pg_advisory_xact_lock(hashtext(p_team_id::text));

  -- Udskyd dobbeltbooking-checket til batchens afslutning (#3934-mønsteret): en lovlig
  -- swap mellem to p_changes-løb må gerne eksistere midlertidigt inden for DENNE
  -- transaktion, uanset hvilken rækkefølge p_changes leverer dem i.
  set constraints no_rider_double_booking_day deferred;

  -- #2637-frigivelser (auto-udtagne ryttere i IKKE-berørte løb) FØR selve erstatningen,
  -- så de nye p_changes-rækker aldrig midlertidigt mangler deres frigjorte plads.
  for v_release in select * from jsonb_array_elements(coalesce(p_auto_releases, '[]'::jsonb)) loop
    delete from public.race_entries
     where race_id = (v_release->>'race_id')::uuid
       and team_id = p_team_id
       and rider_id = (v_release->>'rider_id')::uuid
       and is_auto_filled = true;

    -- FUND2 (#4310-refutation) — VERIFICERET (ikke antaget, se integrationstesten
    -- backend/lib/testdb/raceSelectionBulkRpc.integration.test.js): trg_race_entries_sync_days
    -- fyrer KUN på insert/update af race_id/team_id (database/2026-08-24-4173-...sql:150-152)
    -- — ALDRIG på DELETE. Rensningen af den frigivne rytters race_entry_days-rækker sker HER
    -- alligevel, fordi race_entry_days_entry_fkey er FOREIGN KEY (race_id, rider_id)
    -- REFERENCES race_entries(race_id, rider_id) ON DELETE CASCADE (samme fil, linje 62-64):
    -- selve DELETE'en ovenfor cascader synkront, uafhængigt af triggeren. Dette rebuild-kald
    -- er derfor et REDUNDANT backstop (defense-in-depth, ikke en bugfix) — det gør RPC'ens
    -- korrekthed uafhængig af at en fremtidig migration ikke svækker den cascade (fx til SET
    -- NULL), og dækker desuden det tilfælde at det frigivne løb OGSÅ optræder i p_changes
    -- senere i samme batch.
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

    -- FUND1 (#4310-refutation): forward-guard, spejler prepareSelectionChange
    -- (backend/lib/raceSelection.js) og apply_race_entry_unit_batch's
    -- sweep_race_lineup_frozen (#2074, database/2026-08-24-4173-...sql:318-326). Et løb
    -- hvis status ikke er 'scheduled', eller hvis feltet er LÅST (stages_completed>0), må
    -- kun modtage en RENT FJERNENDE ændring (v_rider_ids ⊆ de entries holdet allerede har
    -- for løbet) — ellers afvises hele batchen. Dette er et BACKSTOP mod TOCTOU: app-laget
    -- har allerede håndhævet præcis denne regel FØR kaldet (mod en race-række læst ved
    -- requestens start) — dette tjek fanger et løb der overgik til frosset/afsluttet
    -- MENS batchen blev forberedt (fx et stage-scheduler-tick midt i en lang bulk-save).
    select (r.status <> 'scheduled' or coalesce(r.stages_completed, 0) > 0)
      into v_frozen
      from public.races r
     where r.id = v_race_id;

    if v_frozen then
      select coalesce(array_agg(rider_id), '{}'::uuid[]) into v_current_rider_ids
        from public.race_entries
       where race_id = v_race_id and team_id = p_team_id;

      if not (v_rider_ids <@ v_current_rider_ids) then
        raise exception 'selection_race_started' using errcode = 'check_violation';
      end if;
    end if;

    -- Erstat holdets entries for DETTE løb atomisk (samme kerne som replace_race_selection).
    -- Peer-/DB-binding-guarden ligger IKKE her (i modsætning til replace_race_selection) —
    -- den er app-lagets ansvar FØR kaldet (peer- + DB-konflikter, se api.js), fordi et
    -- enkelt løbs pre-check her ikke kan se resten af SAMME batches ændringer endnu. Det
    -- udskudte constraint-tjek nedenfor er backstoppet.
    delete from public.race_entries where race_id = v_race_id and team_id = p_team_id;

    if v_len > 0 then
      insert into public.race_entries (race_id, rider_id, team_id, race_role, is_auto_filled)
      select v_race_id, v_rider_ids[i], p_team_id, v_roles[i], false
      from generate_series(1, v_len) as g(i);
    end if;

    -- FUND2 (#4310-refutation) — VERIFICERET, samme konklusion som ovenfor: DELETE'en
    -- (linje 159) cascader allerede korrekt via race_entry_days_entry_fkey ON DELETE CASCADE
    -- for hver slettet race_entries-række, UANSET om feltet bagefter gøres tomt (v_len=0,
    -- ingen insert, triggeren fyrer derfor ikke — se citatet ovenfor) eller genfyldes
    -- (v_len>0, triggeren fyrer OGSÅ, redundant men harmløst). Dette rebuild-kald er derfor
    -- et bevidst REDUNDANT backstop (defense-in-depth, ikke en bugfix): RPC'ens korrekthed
    -- afhænger dermed ikke alene af at en fremtidig migration bevarer ON DELETE CASCADE på
    -- race_entry_days_entry_fkey. Idempotent — samme funktion triggeren selv kalder.
    perform public.race_entry_days_rebuild(v_race_id, p_team_id);
  end loop;

  -- Tving det udskudte check til at køre HER (#3934-mønsteret): fanger en dobbeltbooking
  -- app-lagets pre-flight overså (TOCTOU mod en samtidig skriver), oversat til den
  -- navngivne fejl i stedet for en opak unique_violation ved commit.
  begin
    set constraints no_rider_double_booking_day immediate;
  exception when unique_violation then
    raise exception 'selection_rider_bound' using errcode = 'check_violation';
  end;
end;
$function$;

comment on function public.replace_race_selection_bulk(uuid, jsonb, jsonb) is
  '#1146: erstat holdets race_entries for FLERE løb atomisk i en transaktion
  (sæsonmatrix "Gem plan"). Advisory-lås pr. hold (samme nøgle som
  replace_race_selection), no_rider_double_booking_day udskudt til batchens afslutning så
  en lovlig swap mellem to p_changes-løb er rækkefølge-uafhængig (#3934-mønsteret).
  p_auto_releases frigiver #2637-konflikter i UBERØRTE løb i SAMME transaktion. App-laget
  (api.js) validerer roller/trupstørrelse/pulje-binding FØR kaldet — samme regler som PUT
  /:raceId/selection (prepareSelectionChange). Egen SQL-niveau forward-guard (#2074/#4310)
  afviser en TOCTOU-tilføjelse til et løb der blev frosset/afsluttet efter app-lagets
  pre-flight, med samme fejlkode (selection_race_started) som prepareSelectionChange.';

commit;
