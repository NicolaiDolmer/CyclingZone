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
-- pre-flight) ruller HELE kaldet tilbage — ingen delvist gemte løb. Frosne felter/pulje-
-- binding/trupstørrelse håndhæves IKKE her (se begrundelse ovenfor) — de er allerede
-- håndhævet af prepareSelectionChange før kaldet.
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
-- Refs #1146 #3934 #4173 #2642 #2637
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

    -- Erstat holdets entries for DETTE løb atomisk (samme kerne som replace_race_selection).
    -- Binding-guarden ligger IKKE her (i modsætning til replace_race_selection) — den er
    -- app-lagets ansvar FØR kaldet (peer- + DB-konflikter, se api.js), fordi et enkelt
    -- løbs pre-check her ikke kan se resten af SAMME batches ændringer endnu. Det
    -- udskudte constraint-tjek nedenfor er backstoppet.
    delete from public.race_entries where race_id = v_race_id and team_id = p_team_id;

    if v_len > 0 then
      insert into public.race_entries (race_id, rider_id, team_id, race_role, is_auto_filled)
      select v_race_id, v_rider_ids[i], p_team_id, v_roles[i], false
      from generate_series(1, v_len) as g(i);
    end if;
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
  (api.js) validerer roller/trupstørrelse/frosne felter/pulje-binding FØR kaldet — samme
  regler som PUT /:raceId/selection (prepareSelectionChange).';

commit;
