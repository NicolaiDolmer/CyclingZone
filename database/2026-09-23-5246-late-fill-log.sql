-- #5246 · Maal egen holdudtagelse: late-fill-log + bevar auto-flag.
--
-- Opfoelger til assistent-flip-maalingen 14/9 (#5136). To huller gjorde den
-- maaling til en proxy i stedet for et direkte tal:
--
--   1. INGEN LOG-TABEL for late-fill-sweepen. backend/lib/raceEntryGeneratorSweep.js
--      skrev intet til DB (modsat email_sweep_runs, scout_sweep_runs,
--      market_value_sunday_sweep_log) -- fejl gik kun til Sentry. Fix:
--      race_entry_generator_runs, EEN raekke pr. koersel, OGSAA ved 0 fyld.
--
--   2. AUTO-FLAGET FORSVANDT SPORLOEST VED MANUELT GEM. race_entries havde kun
--      is_auto_filled, og replace_race_selection / replace_race_selection_bulk
--      sletter holdets raekker og indsaetter nye med is_auto_filled=false. #5136 §2
--      maatte derfor gaette "selvrettelser" ud fra et tidsvindue. Fix:
--      race_entries.auto_filled_at + auto_filled_source, og race_entry_overrides
--      (EEN raekke pr. erstattet (loeb,hold) i et gem, skrevet FOER delete+insert,
--      med om de erstattede raekker var auto-fyldte og fra hvilken kilde).
--
-- KILDER (race_entries.auto_filled_source) -- saettes EKSPLICIT af hver skriver
-- (backend/lib/raceEntryAutoFillSource.js). Triggeren giver INGEN default: en
-- auto-raekke uden kilde (alle raekker fra foer denne migration, eller en ny
-- skriver der glemmer feltet) staar som NULL og taelles som 'unknown' i
-- maalingen, aldrig som late_fill.
--   'late_fill'    -- assistenten (sweep, mode=late_fill) fyldte et menneskeholds tomme trup.
--   'opt_in'       -- assistenten (sweep, mode=opt_in) fyldte et menneskehold der har sagt ja.
--   'start_rescue' -- raceRunner.fillMissingTeamEntries ved loebsstart.
--   'manager_auto' -- managerens egen knap: POST /races/:raceId/selection/auto og
--                     Race Hubs POST /races/distribution/regenerate.
--   'ai_generator' -- raceEntryGenerator.js for et AI-hold (sweep, saesonskifte, admin-genvej).
--
-- FUNKTIONER (tre CREATE OR REPLACE, hver taget ORDRET fra den NYESTE migration der
-- definerer den, og bekraeftet read-only mod prod med pg_get_functiondef 24/9):
--   * replace_race_selection      -- 2026-08-27-4283-selection-guard-spaend.sql
--     (race_entry_days + generate_series-guarden). Eneste tilfoejelse: INSERT INTO
--     race_entry_overrides foer delete+insert.
--   * replace_race_selection_bulk -- 2026-08-31-4534-selection-frozen-both-directions.sql.
--     Eneste tilfoejelse: INSERT INTO race_entry_overrides pr. p_changes-loeb foer
--     loebets delete+insert (saesonmatrixens "Gem plan").
--   * apply_race_entry_unit_batch -- 2026-08-24-4173-rider-binding-per-game-day.sql.
--     Eneste tilfoejelse: insert'en laeser en valgfri auto_filled_source pr. raekke
--     fra payloaden (generatorens ai_generator/late_fill/opt_in). En payload uden
--     noeglen giver NULL, saa en aeldre backend virker uaendret.
--   Signaturerne er uaendrede, saa GRANT/REVOKE fra 2026-07-11-revoke-rpc-grants-2327.sql
--   og funktions-kommentarerne overlever CREATE OR REPLACE uaendret.
--
-- DEPLOY-RAEKKEFOELGE: auto-migrate.yml koerer denne fil ca. 3 min EFTER at backend
-- er deployet. Backend er skrevet til begge raekkefoelger: en insert med
-- auto_filled_source proeves igen uden feltet hvis kolonnen mangler (PGRST204/42703),
-- og en manglende race_entry_generator_runs springes stille over (PGRST205/42P01).
-- Omvendt virker en aeldre backend mod den nye DB: ingen kilde = NULL = unknown.
--
-- FLAG_GATED_EMPTY_TABLES (backend/scripts/audit-feature-liveness.js) -- INGEN
-- entry tilfoejet, bevidst: sweepen koerer ved boot og hver time og skriver altid en
-- raekke; race_entry_overrides skrives af ethvert "Gem plan". Begge faar rows straks.
--
-- RLS: begge nye tabeller enabled, INGEN policy, kun service_role -- samme
-- moenster som email_sweep_runs/market_value_sunday_sweep_log (#5153).
--
-- IDEMPOTENT: CREATE TABLE/COLUMN/INDEX IF NOT EXISTS, constraints i DO-blokke med
-- pg_constraint-tjek, CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS foer
-- CREATE TRIGGER. Ikke-destruktiv (ingen DELETE/DROP af data). Applies af
-- auto-migrate.yml post-merge (#2642); Claude post-verificerer med SELECT.
--
-- POST-VERIFY (koeres EFTER apply, alle read-only):
--   1. SELECT column_name, data_type FROM information_schema.columns
--       WHERE table_schema='public' AND table_name IN ('race_entry_generator_runs','race_entry_overrides')
--       ORDER BY table_name, ordinal_position;
--   2. SELECT column_name FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='race_entries'
--         AND column_name IN ('auto_filled_at','auto_filled_source');  -- 2 raekker
--   3. SELECT pg_get_constraintdef(oid) FROM pg_constraint
--       WHERE conname = 'race_entries_auto_filled_source_check';  -- 5 kilder
--   4. SELECT tgname FROM pg_trigger WHERE tgname = 'race_entries_stamp_auto_fill_trg';  -- 1 raekke
--   5. SELECT pg_get_functiondef('public.replace_race_selection(uuid,uuid,uuid[],text[])'::regprocedure);
--      -- forventet: race_entry_days/generate_series-guarden (4283) + race_entry_overrides-INSERT,
--      -- INGEN 100000-gren og INGEN exclusion_violation-fangst.
--   6. SELECT pg_get_functiondef('public.replace_race_selection_bulk(uuid,jsonb,jsonb)'::regprocedure);
--   7. SELECT pg_get_functiondef('public.apply_race_entry_unit_batch(uuid,jsonb)'::regprocedure);
--   8. SELECT grantee, privilege_type FROM information_schema.role_table_grants
--       WHERE table_schema='public' AND table_name IN
--       ('race_entry_generator_runs','race_entry_overrides');  -- kun service_role (+ postgres)
--   9. Efter foerste sweep-koersel: SELECT count(*) FROM race_entry_generator_runs;  -- >=1
--
-- Rollback:
--   DROP TRIGGER IF EXISTS race_entries_stamp_auto_fill_trg ON public.race_entries;
--   DROP FUNCTION IF EXISTS public.race_entries_stamp_auto_fill();
--   -- Genskab de tre funktioner fra deres kilde-migrationer (se FUNKTIONER ovenfor)
--   -- FOER tabellerne droppes, ellers fejler et gem paa den manglende race_entry_overrides.
--   ALTER TABLE public.race_entries
--     DROP CONSTRAINT IF EXISTS race_entries_auto_fill_stamp_consistency,
--     DROP CONSTRAINT IF EXISTS race_entries_auto_filled_source_check,
--     DROP COLUMN IF EXISTS auto_filled_at,
--     DROP COLUMN IF EXISTS auto_filled_source;
--   DROP TABLE IF EXISTS public.race_entry_generator_runs;
--   DROP TABLE IF EXISTS public.race_entry_overrides;
--
-- Refs #5246 #5136 #4201

begin;

-- ── 1) race_entry_generator_runs ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.race_entry_generator_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  -- Den EFFEKTIVE tilstand generatoren koerte med (runRaceEntryGenerator's `mode`-
  -- returvaerdi; opt_in kan fail-safe'e til proactive). Ved en generator-fejl: den
  -- konfigurerede tilstand.
  mode TEXT,
  late_fill_hours INTEGER,
  races_considered INT NOT NULL DEFAULT 0,
  -- Hold der FAKTISK fik mindst een ny race_entries-raekke i koerslen (result.teams_written).
  teams_filled INT NOT NULL DEFAULT 0,
  -- Nye race_entries-raekker skrevet i koerslen (result.inserted).
  entries_written INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Maale-SQL'ens vindue-query (docs/ASSISTANT_LATE_FILL.md): WHERE started_at >= ...
CREATE INDEX IF NOT EXISTS race_entry_generator_runs_started_at_idx
  ON public.race_entry_generator_runs (started_at);

ALTER TABLE public.race_entry_generator_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.race_entry_generator_runs FROM anon, authenticated;
GRANT ALL ON public.race_entry_generator_runs TO service_role;

COMMENT ON TABLE public.race_entry_generator_runs IS
  '#5246: en raekke pr. koersel af raceEntryGeneratorSweep.js (kun naar den faktisk '
  'kalder generatoren -- flag_off/no_active_season skriver intet), OGSAA ved 0 fyld. '
  'teams_filled = hold der fik mindst een ny raekke. service-role only.';

-- ── 2) race_entries.auto_filled_at / auto_filled_source + stamp-trigger ────────────

ALTER TABLE public.race_entries ADD COLUMN IF NOT EXISTS auto_filled_at TIMESTAMPTZ;
ALTER TABLE public.race_entries ADD COLUMN IF NOT EXISTS auto_filled_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'race_entries_auto_filled_source_check'
       AND conrelid = 'public.race_entries'::regclass
  ) THEN
    ALTER TABLE public.race_entries
      ADD CONSTRAINT race_entries_auto_filled_source_check
      CHECK (auto_filled_source IS NULL OR auto_filled_source IN (
        'late_fill', 'opt_in', 'start_rescue', 'manager_auto', 'ai_generator'
      ));
  END IF;
END $$;

-- Backstop-invariant: is_auto_filled=false (manuelt) SKAL have begge stempel-felter
-- NULL. Trivielt opfyldt af al eksisterende data (nye kolonner er NULL ved ADD COLUMN).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'race_entries_auto_fill_stamp_consistency'
       AND conrelid = 'public.race_entries'::regclass
  ) THEN
    ALTER TABLE public.race_entries
      ADD CONSTRAINT race_entries_auto_fill_stamp_consistency
      CHECK (is_auto_filled = true OR (auto_filled_at IS NULL AND auto_filled_source IS NULL));
  END IF;
END $$;

-- Stempler auto_filled_at ved ENHVER insert/update der (gen-)saetter is_auto_filled,
-- uanset skriver. auto_filled_source roeres IKKE for auto-raekker (skriveren saetter
-- den eksplicit; mangler den, forbliver den NULL = unknown). COALESCE bevarer et
-- allerede-staemplet auto_filled_at ved en UPDATE der blot rebekraefter is_auto_filled.
-- En manuel raekke (is_auto_filled=false) faar begge felter ryddet.
CREATE OR REPLACE FUNCTION public.race_entries_stamp_auto_fill()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.is_auto_filled THEN
    NEW.auto_filled_at := COALESCE(NEW.auto_filled_at, now());
  ELSE
    NEW.auto_filled_at := NULL;
    NEW.auto_filled_source := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS race_entries_stamp_auto_fill_trg ON public.race_entries;
CREATE TRIGGER race_entries_stamp_auto_fill_trg
  BEFORE INSERT OR UPDATE OF is_auto_filled ON public.race_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.race_entries_stamp_auto_fill();

COMMENT ON COLUMN public.race_entries.auto_filled_at IS
  '#5246: NULL = manuelt udtaget (eller aldrig auto-fyldt). Sat af '
  'race_entries_stamp_auto_fill_trg naar is_auto_filled=true, ryddet naar false.';
COMMENT ON COLUMN public.race_entries.auto_filled_source IS
  '#5246: hvem skrev auto-raekken: late_fill | opt_in | start_rescue | manager_auto | '
  'ai_generator. Saettes eksplicit af skriveren; NULL paa en auto-raekke = ukendt '
  '(fx fra foer #5246).';

-- ── 3) race_entry_overrides ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.race_entry_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL,
  team_id UUID NOT NULL,
  overridden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Havde de ERSTATTEDE raekker (foer dette gem) mindst een auto-fyldt entry?
  had_auto_filled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Kilden hvis alle erstattede auto-raekker delte SAMME kilde; 'unknown' hvis de
  -- alle var uden kilde; 'mixed' ved flere forskellige; NULL hvis had_auto_filled=false.
  auto_source TEXT
);

CREATE INDEX IF NOT EXISTS race_entry_overrides_overridden_at_idx
  ON public.race_entry_overrides (overridden_at);
CREATE INDEX IF NOT EXISTS race_entry_overrides_race_team_idx
  ON public.race_entry_overrides (race_id, team_id);

ALTER TABLE public.race_entry_overrides ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.race_entry_overrides FROM anon, authenticated;
GRANT ALL ON public.race_entry_overrides TO service_role;

COMMENT ON TABLE public.race_entry_overrides IS
  '#5246: en raekke pr. (loeb,hold) som et gem erstatter (replace_race_selection og '
  'replace_race_selection_bulk), skrevet FOER delete+insert, med om de ERSTATTEDE '
  'raekker var auto-fyldte. Selvrettelser = COUNT(*) FILTER (WHERE had_auto_filled). '
  'service-role only (skrevet fra RPC''erne, kaldt via service-role).';

-- ── 4) replace_race_selection: 4283-kroppen + override-log ─────────────────────────

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
  -- committet i et ANDET, ikke-afmeldt løb der deler en løbsdag med dette løbs SPÆND
  -- (#4217 — hele min..max inkl. hvile-/pausedage, samme mængde som
  -- race_entry_days_rebuild skriver). #3076: kun løb i SAMME sæson kan binde.
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
          JOIN generate_series(v_start, v_end) AS gs(game_day)
            ON gs.game_day = d.game_day
         WHERE d.team_id = p_team_id
           AND d.race_id <> p_race_id
           AND d.season_id IS NOT DISTINCT FROM v_season_id
           AND d.rider_id = ANY (p_rider_ids)
      ) THEN
        RAISE EXCEPTION 'selection_rider_bound' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- #5246: log FOER erstatningen om de raekker der slettes var auto-fyldte, saa
  -- selvrettelser taelles direkte (#5136 §2). 0 raekker (foerste gem) giver
  -- had_auto_filled=false. En auto-raekke uden kilde taeller som 'unknown'.
  INSERT INTO race_entry_overrides (race_id, team_id, had_auto_filled, auto_source)
  SELECT
    p_race_id,
    p_team_id,
    COALESCE(bool_or(is_auto_filled), false),
    CASE
      WHEN NOT COALESCE(bool_or(is_auto_filled), false) THEN NULL
      WHEN count(DISTINCT COALESCE(auto_filled_source, 'unknown')) FILTER (WHERE is_auto_filled) = 1
        THEN min(COALESCE(auto_filled_source, 'unknown')) FILTER (WHERE is_auto_filled)
      ELSE 'mixed'
    END
  FROM race_entries
  WHERE race_id = p_race_id AND team_id = p_team_id;

  -- Erstat holdets entries for løbet atomisk (hele delete+insert i denne transaktion).
  DELETE FROM race_entries WHERE race_id = p_race_id AND team_id = p_team_id;

  IF v_len > 0 THEN
    INSERT INTO race_entries (race_id, rider_id, team_id, race_role, is_auto_filled)
    SELECT p_race_id, p_rider_ids[i], p_team_id, p_roles[i], false
    FROM generate_series(1, v_len) AS g(i);
  END IF;
END;
$function$;

-- ── 5) replace_race_selection_bulk: 4534-kroppen + override-log pr. loeb ────────────

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

    -- #5246: log FOER erstatningen af DETTE loeb om de raekker der slettes var
    -- auto-fyldte -- samme regel som replace_race_selection (se den ovenfor).
    insert into public.race_entry_overrides (race_id, team_id, had_auto_filled, auto_source)
    select
      v_race_id,
      p_team_id,
      coalesce(bool_or(is_auto_filled), false),
      case
        when not coalesce(bool_or(is_auto_filled), false) then null
        when count(distinct coalesce(auto_filled_source, 'unknown')) filter (where is_auto_filled) = 1
          then min(coalesce(auto_filled_source, 'unknown')) filter (where is_auto_filled)
        else 'mixed'
      end
    from public.race_entries
    where race_id = v_race_id and team_id = p_team_id;

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

-- ── 6) apply_race_entry_unit_batch: 4173-kroppen + kilde pr. ny raekke ──────────────

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

    -- #5246: auto_filled_source er valgfri pr. raekke i payloaden (NULL uden noeglen).
    insert into public.race_entries (race_id, rider_id, team_id, race_role, is_auto_filled, auto_filled_source)
    select v_race_id, (i->>'rider_id')::uuid, p_team_id, i->>'race_role', true, i->>'auto_filled_source'
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

commit;
