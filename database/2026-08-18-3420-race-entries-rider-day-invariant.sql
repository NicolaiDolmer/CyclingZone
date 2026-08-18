-- #3420 — Håndhæv "1 rytter = 1 løb pr. in-game-dag" I DATABASEN, ikke kun i
-- applikationslaget.
--
-- Rod-årsag (se issue #3420 for fuld baggrund): reglen er brudt fire gange på ti
-- dage i fire forskellige varianter (#3113, #3119, #3122, 5/8 Team Fakta) — hver
-- gang rettet ét lag for højt, i én af de FIRE separate skrivere til race_entries
-- (proaktiv sweep raceEntryGenerator.js, runtime auto-fyld raceRunner.js, PUT
-- /selection via replace_race_selection-RPC'en, POST /races/distribution/
-- regenerate). Fem uafhængige postmortems (.claude/learnings/2026-06-23 til
-- 2026-07-05) dokumenterede klassen FØR de fire seneste hændelser. Ni brud i alt.
-- Klassen overlever hvert enkelt applikationsfix, fordi invarianten ikke har et
-- sted at bo hvor den ikke kan omgås.
--
-- Fix: denormalisér løbets in-game-dag-span ned på race_entries.binding_span
-- (vedligeholdt af triggere fra race_stage_schedule + race_withdrawals) og lad
-- Postgres afvise overlappet med en EXCLUDE-constraint (btree_gist, samme mønster
-- som issuets forslag). binding_span er NULL (ikke-bindende) i de tre bevidste
-- undtagelser:
--   • afmeldte løb (race_withdrawals for entry'ens team_id) — Rod A, #1823
--   • Monumenter (game_day >= 100000-sentinel, MONUMENT_GAMEDAY_BASE i
--     raceCalendarLanePacker.js) — bevidst binding-fri, samme som app-lagets
--     naive vindue (loadTeamBindingContext afleder et PRÆCIST pulje-lokalt vindue
--     til pre-flight-UX, men DB-backstoppet her er bevidst grovere: NULL = ingen
--     håndhævelse for Monumenter, jf. issuets eget forslag)
--   • løb uden (fuldt game_day-backfillet) schedule
--
-- Verificeret READ-ONLY mod prod (execute_sql, Supabase MCP) 18/8 2026:
--   • btree_gist: IKKE installeret (bekræfter issuets 6/8-måling)
--   • race_stage_schedule: 0 rækker uden game_day (spannet kan altid udledes)
--   • race_entries: 99.342 rækker (vokset fra issuets 56.484 pr. 6/8, normal
--     sæson-vækst — konstraint-tilføjelsen er stadig billig at indeksere)
--   • KENDTE EKSISTERENDE BRUD (mål-metode: samme game_day-span + samme
--     eligibility-krydsning som backend/lib/riderEligibility.filterEligibleEntries
--     — ekskluderer "ghost"-entries fra FØR en handel, hvor entry.team_id ikke
--     længere matcher rytterens NUVÆRENDE riders.team_id, jf. #1906/#1823/#1800):
--       - Sæson 1 (afsluttet): 783 overlappende (rider_id, span)-par, 617 distinkte
--         ryttere — al historisk debt fra FØR #3113/#3119/#3122-fixene, INGEN af
--         disse løb er aktive.
--       - Sæson 2 (aktiv): NØJAGTIGT 4 par, alle samme rytter-par
--         (a4963698-5c84-4b7c-a960-ce678e2b6d6a "Tour des Hauts Plateaux" gd[0,7]
--         × f7acf9c3-9fb9-48b9-9e33-3a919da97511 "Tour de Malaisie" gd[0,7]),
--         alle Team Brutaliste, begge løb status='completed' — matcher issuets
--         28/7-måling ("4 tilbage — alle Team Brutaliste, alle færdigafviklede,
--         ingen aktive") eksakt. Berørte rytter-id'er: 31b851b6-1864-4dfe-adff-
--         11ccac10f2c8, c638cb6f-df9f-4fe8-bb9f-2f61dc6d6aff, b90dfce5-bbda-47e3-
--         8392-db7ae29d7ba4, 7f29fa3f-6805-41a4-97ee-5546eb7dd4ec.
--   Disse 787 rækker (783 S1 + 4 S2) er PRÆCIS hvorfor DO-blokken nedenfor nægter
--   at tilføje constraint'en før de er ryddet/undtaget — se "Ryd/undtag"-opgaven
--   i #3420. Denne migration SÆTTER backfillede binding_span-værdier på alle
--   rækker (inkl. de brudte), men rejser en eksplicit, navngiven fejl i stedet
--   for constraint'ens generiske 23P01 hvis man forsøger at tilføje EXCLUDE-
--   constraint'en mens brud stadig findes — se "no_rider_double_booking"-DO-
--   blokken nedenfor.
--
-- Idempotent: extension/kolonne bruger IF NOT EXISTS, funktioner er CREATE OR
-- REPLACE, triggere droppes+genskabes, constraint-tilføjelsen er guardet af en
-- eksistens-tjek. Ikke-destruktiv (ingen DELETE/DROP af data). APPLY IKKE her —
-- orkestrator applier post-merge under #2642-rammerne, EFTER de 787 kendte brud
-- er ryddet/undtaget (constraint-DO-blokken vil ellers rejse en eksplicit fejl,
-- ikke fejle tavst eller destruktivt).
--
-- Refs #3420, #3113, #3119, #3122, #1823, #3114, #2256.

begin;

create extension if not exists btree_gist;

alter table public.race_entries add column if not exists binding_span int4range;

comment on column public.race_entries.binding_span is
  '#3420: løbets in-game-dag-span [min(game_day), max(game_day)] for DENNE entry''s
  race_id, vedligeholdt af triggere (race_entries_set_binding_span,
  race_stage_schedule_resync_binding, race_withdrawals_resync_binding). NULL =
  ikke-bindende (afmeldt løb, Monument-sentinel game_day>=100000, eller løb uden
  fuldt game_day-backfillet schedule). Bærer no_rider_double_booking-EXCLUDE-
  constraint''en (gist, rider_id WITH =, binding_span WITH &&).';

-- Ren beregningsfunktion: løbets binding_span for ÉT (race_id, team_id)-par.
-- STABLE (ikke IMMUTABLE — læser andre tabeller), SQL (ingen procedural-logik
-- nødvendig). Kaldes af alle tre triggere nedenfor, så beregningen kun bor ét sted.
create or replace function public.race_entries_binding_span(p_race_id uuid, p_team_id uuid)
returns int4range
language sql
stable
set search_path to 'public', 'pg_catalog'
as $$
  select case
    when exists (
      select 1 from public.race_withdrawals w
       where w.race_id = p_race_id and w.team_id = p_team_id
    ) then null::int4range
    else (
      select case
        when count(*) = 0 then null::int4range
        -- delvist backfillet schedule (nogle rækker mangler game_day) → kan ikke
        -- udlede et sikkert span, spejler raceBindingWindow's useGameDay-alt-eller-intet.
        when count(*) filter (where s.game_day is null) > 0 then null::int4range
        -- Monument-sentinel (MONUMENT_GAMEDAY_BASE i raceCalendarLanePacker.js) —
        -- bevidst binding-fri i DB-backstoppet, #3114.
        when min(s.game_day) >= 100000 then null::int4range
        else int4range(min(s.game_day), max(s.game_day), '[]')
      end
      from public.race_stage_schedule s
      where s.race_id = p_race_id
    )
  end;
$$;

comment on function public.race_entries_binding_span(uuid, uuid) is
  '#3420: ren beregning af race_entries.binding_span for ét (race_id, team_id)-par.
  NULL for afmeldte løb, Monument-sentinel-løb, og løb uden fuldt game_day-
  backfillet schedule. Ellers int4range(min(game_day), max(game_day), inklusiv).';

-- Trigger 1: race_entries selv — sæt binding_span ved INSERT eller ved UPDATE af
-- race_id/team_id (aldrig ved fx race_role-update, jf. raceEntryGenerator.js'
-- vacate/promote-opdateringer, som IKKE skal genberegne).
create or replace function public.race_entries_set_binding_span() returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  new.binding_span := public.race_entries_binding_span(new.race_id, new.team_id);
  return new;
end;
$$;

drop trigger if exists trg_race_entries_set_binding_span on public.race_entries;
create trigger trg_race_entries_set_binding_span
  before insert or update of race_id, team_id on public.race_entries
  for each row execute function public.race_entries_set_binding_span();

-- Trigger 2: race_stage_schedule-ændringer (kalender-generering/reschedule) skal
-- resynkronisere binding_span for ALLE et løbs eksisterende entries på tværs af
-- alle hold. Row-level (ikke statement-level) — schedule-mutationer er sjældne
-- (sæson-opsætning/reschedule, ikke per-request), så gentagen genberegning pr.
-- etape-række i samme batch er acceptabel.
create or replace function public.race_stage_schedule_resync_binding() returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_race_id uuid := coalesce(new.race_id, old.race_id);
begin
  update public.race_entries
     set binding_span = public.race_entries_binding_span(race_id, team_id)
   where race_id = v_race_id;
  return null; -- AFTER-trigger, returværdi ignoreres
end;
$$;

drop trigger if exists trg_race_stage_schedule_resync_binding on public.race_stage_schedule;
create trigger trg_race_stage_schedule_resync_binding
  after insert or update or delete on public.race_stage_schedule
  for each row execute function public.race_stage_schedule_resync_binding();

-- Trigger 3: race_withdrawals-ændringer (afmelding/gen-tilmelding) skal
-- resynkronisere binding_span for netop DET holds entries i DET løb — Rod A,
-- #1823 (afmeldte løb binder ikke; gen-tilmelding genopretter bindingen).
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
  return null;
end;
$$;

drop trigger if exists trg_race_withdrawals_resync_binding on public.race_withdrawals;
create trigger trg_race_withdrawals_resync_binding
  after insert or update or delete on public.race_withdrawals
  for each row execute function public.race_withdrawals_resync_binding();

-- Backfill: sæt binding_span for ALLE eksisterende rækker (inkl. de 787 kendte
-- brudte — de skal have et span for at DO-blokken nedenfor kan TÆLLE og RAPPORTERE
-- konflikterne; constraint'en tilføjes ikke før de er ryddet, se nedenfor).
update public.race_entries
   set binding_span = public.race_entries_binding_span(race_id, team_id);

-- Constraint-tilføjelse, guardet: nægter at tilføje EXCLUDE-constraint'en mens
-- overlappende (rider_id, binding_span)-par stadig findes i data — rejser en
-- EKSPLICIT, navngiven fejl (med optælling) i stedet for at Postgres fejler
-- generisk på selve ALTER TABLE, ELLER (værre) i stedet for at constraint'en
-- lander oven på brud den aldrig kunne validere. Idempotent: allerede tilføjet
-- → no-op ved gentagen kørsel.
do $$
declare
  v_conflict_count integer;
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'no_rider_double_booking'
       and conrelid = 'public.race_entries'::regclass
  ) then
    select count(*) into v_conflict_count
      from public.race_entries a
      join public.race_entries b
        on a.rider_id = b.rider_id
       and a.binding_span && b.binding_span
       and (a.race_id::text < b.race_id::text)
     where a.binding_span is not null and b.binding_span is not null;

    if v_conflict_count > 0 then
      raise exception 'no_rider_double_booking: % overlappende (rider_id, binding_span)-par findes stadig i race_entries — ryd/undtag dem FØR denne migration kan tilføje EXCLUDE-constraint''en (PR-body for #3420 lister målingen: 783 S1 + 4 S2 pr. 18/8). Constraint IKKE tilføjet.', v_conflict_count
      using errcode = 'check_violation';
    end if;

    alter table public.race_entries
      add constraint no_rider_double_booking
      exclude using gist (rider_id with =, binding_span with &&)
      where (binding_span is not null);
  end if;
end $$;

-- #3420 acceptkriterium (23P01 → navngiven fejl, ikke en rå 500, jf. #3098):
-- gentag den EKSISTERENDE app-lagsgaranti INDE i replace_race_selection-RPC'en
-- (PUT /selection, #2256/#3076/#3290) OGSÅ mod DB-backstoppet. RPC'ens egen
-- pre-check (uændret ovenfor i funktionskroppen) burde altid fange en konflikt
-- FØR selve INSERT'en — men er den ALLIGEVEL forkert (den KLASSE bugs #3420
-- findes for at gøre umulig), fanger denne EXCEPTION-blok Postgres' egen
-- exclusion_violation (23P01, fra no_rider_double_booking) og oversætter den til
-- SAMME 'selection_rider_bound'-fejlkode som pre-checket allerede giver — så
-- ruten (backend/lib/raceSelection.js: `rpcErr.message.includes("selection_rider_bound")`)
-- svarer 409 med den eksisterende i18n-besked, ikke en opak 500.
create or replace function public.replace_race_selection(p_team_id uuid, p_race_id uuid, p_rider_ids uuid[], p_roles text[])
 returns void
 language plpgsql
 set search_path to 'public', 'pg_catalog'
as $function$
DECLARE
  v_len int := coalesce(array_length(p_rider_ids, 1), 0);
  v_start int;
  v_end int;
  v_full boolean;
  v_season_id uuid;
  v_league_division_id integer;
  v_is_monument boolean;
BEGIN
  IF coalesce(array_length(p_roles, 1), 0) <> v_len THEN
    RAISE EXCEPTION 'selection_invalid_body' USING ERRCODE = 'check_violation';
  END IF;

  -- Serialisér mod samtidige skriv til samme hold (samme nøgle som move_race_entry).
  PERFORM pg_advisory_xact_lock(hashtext(p_team_id::text));

  -- Binding-guard UNDER lås (#2256): afvis hvis en af de gemte ryttere allerede er
  -- committet i et ANDET, ikke-afmeldt løb hvis in-game-dag-vindue overlapper dette løbs.
  -- #3076: kun løb i SAMME sæson kan binde — game_day er sæson-relativ.
  IF v_len > 0 THEN
    SELECT r.season_id, r.league_division_id INTO v_season_id, v_league_division_id
      FROM races r WHERE r.id = p_race_id;

    SELECT min(s.game_day), max(s.game_day), count(*) = count(s.game_day)
      INTO v_start, v_end, v_full
      FROM race_stage_schedule s
     WHERE s.race_id = p_race_id;

    -- #3290: er DETTE løb et Monument (hele dets schedule i 100000-sentinelbåndet)?
    -- Så er {v_start,v_end} det naive vindue der aldrig kan overlappe et normalt løb —
    -- aflede i stedet det pulje-lokale game_day-vindue (samme afledning som app-laget).
    v_is_monument := v_full AND v_start IS NOT NULL AND v_start >= 100000;
    IF v_is_monument THEN
      SELECT min(s2.game_day), max(s2.game_day)
        INTO v_start, v_end
        FROM race_stage_schedule s2
        JOIN races r2 ON r2.id = s2.race_id
       WHERE r2.season_id = v_season_id
         AND r2.league_division_id IS NOT DISTINCT FROM v_league_division_id
         AND s2.game_day IS NOT NULL AND s2.game_day < 100000
         AND (s2.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date IN (
           SELECT DISTINCT (s1.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date
             FROM race_stage_schedule s1
            WHERE s1.race_id = p_race_id
         );
      v_full := v_start IS NOT NULL;
    END IF;

    -- Kun når DETTE løb er fuldt game_day-backfillet (ellers legacy-fallback i
    -- app-laget) ELLER har fået et gyldigt afledt Monument-vindue ovenfor.
    IF v_full AND v_start IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
          FROM race_entries e
          JOIN races r2 ON r2.id = e.race_id
          JOIN LATERAL (
            SELECT
              CASE WHEN naive.n_is_monument THEN mon.d_start ELSE naive.n_start END AS w_start,
              CASE WHEN naive.n_is_monument THEN mon.d_end ELSE naive.n_end END AS w_end,
              CASE WHEN naive.n_is_monument THEN mon.d_start IS NOT NULL ELSE naive.n_full END AS w_full
              FROM (
                SELECT min(s2.game_day) AS n_start,
                       max(s2.game_day) AS n_end,
                       count(*) = count(s2.game_day) AS n_full,
                       coalesce(bool_and(s2.game_day IS NOT NULL AND s2.game_day >= 100000), false) AS n_is_monument
                  FROM race_stage_schedule s2
                 WHERE s2.race_id = e.race_id
              ) naive
              LEFT JOIN LATERAL (
                -- #3290: samme pulje-lokale afledning som ovenfor, men for et af
                -- holdets ANDRE committede løb — kører kun reelt når det ER et
                -- Monument (naive.n_is_monument), ellers NULL (uden effekt, se CASE).
                SELECT min(s3.game_day) AS d_start, max(s3.game_day) AS d_end
                  FROM race_stage_schedule s3
                  JOIN races r3 ON r3.id = s3.race_id
                 WHERE naive.n_is_monument
                   AND r3.season_id = r2.season_id
                   AND r3.league_division_id IS NOT DISTINCT FROM r2.league_division_id
                   AND s3.game_day IS NOT NULL AND s3.game_day < 100000
                   AND (s3.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date IN (
                     SELECT DISTINCT (s4.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date
                       FROM race_stage_schedule s4
                      WHERE s4.race_id = e.race_id
                   )
              ) mon ON true
          ) w ON true
         WHERE e.team_id = p_team_id
           AND e.race_id <> p_race_id
           AND r2.season_id IS NOT DISTINCT FROM v_season_id
           AND e.rider_id = ANY (p_rider_ids)
           AND NOT EXISTS (
             SELECT 1 FROM race_withdrawals rw
              WHERE rw.race_id = e.race_id AND rw.team_id = p_team_id
           )
           AND w.w_full
           AND w.w_start IS NOT NULL
           AND w.w_start <= v_end
           AND v_start <= w.w_end
      ) THEN
        RAISE EXCEPTION 'selection_rider_bound' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- Erstat holdets entries for løbet atomisk (hele delete+insert i denne transaktion).
  DELETE FROM race_entries WHERE race_id = p_race_id AND team_id = p_team_id;

  IF v_len > 0 THEN
    -- #3420: DB-backstoppet (no_rider_double_booking, EXCLUDE USING gist) er den
    -- SIDSTE linje hvis guarden ovenfor alligevel skulle tage fejl (den klasse bugs
    -- #3420 findes for at gøre umulig). Oversæt dens 23P01 til SAMME navngivne fejl
    -- som guarden ovenfor giver, i stedet for at lade en rå exclusion_violation nå
    -- kalderen som en opak 500.
    BEGIN
      INSERT INTO race_entries (race_id, rider_id, team_id, race_role, is_auto_filled)
      SELECT p_race_id, p_rider_ids[i], p_team_id, p_roles[i], false
      FROM generate_series(1, v_len) AS g(i);
    EXCEPTION WHEN exclusion_violation THEN
      RAISE EXCEPTION 'selection_rider_bound' USING ERRCODE = 'check_violation';
    END;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.replace_race_selection(uuid, uuid, uuid[], text[]) IS
  'Atomisk erstat holdets race_entries for ét løb (#2173) + overlap-binding-guard '
  'under advisory-lås (#2256), sæson-scopet (#3076), Monument-pulje-lokal afledning '
  '(#3290, spejler backend/lib/raceBinding.js), + #3420: oversætter DB-backstoppets '
  '(no_rider_double_booking) 23P01 til samme selection_rider_bound-fejlkode som '
  'app-lags-guarden ovenfor. Afviser selection_rider_bound hvis en gemt rytter '
  'allerede er committet i et andet ikke-afmeldt løb med overlappende game_day-vindue '
  '(Monument-løb afleder vinduet pulje-lokalt fra normale løb i samme sæson+pulje på '
  'samme danske kalenderdag i stedet for det naive 100000-sentinelvindue). '
  'is_auto_filled=false (manuel udtagelse).';

commit;

-- Post-verify (kør efter apply, alle read-only):
--   1. select extname from pg_extension where extname = 'btree_gist';                    -- 1 række
--   2. select count(*) from race_entries where binding_span is null;                      -- forventet: afmeldte + Monument + schedule-løse entries (IKKE 0)
--   3. select pg_get_constraintdef(oid) from pg_constraint
--        where conname = 'no_rider_double_booking' and conrelid = 'race_entries'::regclass; -- 1 række hvis brud var ryddet FØR apply
--   4. En bevidst dobbeltbooking via rå SQL (samme rider_id, overlappende binding_span,
--      ingen withdrawal/Monument) skal nu afvises af Postgres med 23P01 — acceptkriterium 1 i #3420.
--   5. select count(*) from race_entries a join race_entries b
--        on a.rider_id=b.rider_id and a.binding_span && b.binding_span and a.race_id < b.race_id
--        where a.binding_span is not null and b.binding_span is not null;                  -- forventet 0 EFTER oprydning; > 0 før
