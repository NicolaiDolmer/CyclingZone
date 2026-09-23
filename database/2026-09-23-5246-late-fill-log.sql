-- #5246 · Maal egen holdudtagelse: late-fill-log + bevar auto-flag.
--
-- Opfoelger til assistent-flip-maalingen 14/9 (#5136). To huller gjorde den
-- maaling til en proxy i stedet for et direkte tal:
--
--   1. INGEN LOG-TABEL for late-fill-sweepen. backend/lib/raceEntryGeneratorSweep.js
--      skriver intet til DB (modsat email_sweep_runs, scout_sweep_runs,
--      market_value_sunday_sweep_log) -- fejl gaar kun til Sentry. #5136's egen
--      §5-konklusion: "Ingen maalbar log ... antal koersler kan kun udledes
--      indirekte". Fix: race_entry_generator_runs, EEN raekke pr. koersel,
--      OGSAA ved 0 fyld (0-fyld er stadig signal: "sweepen koerte, fandt intet").
--
--   2. AUTO-FLAGET FORSVINDER SPORLOEST VED MANUELT GEM. race_entries havde kun
--      is_auto_filled (ingen updated_at/selected_by/auto_filled_at), og
--      replace_race_selection sletter holdets raekker og indsaetter nye med
--      is_auto_filled=false. #5136 §2 maatte derfor gaette "selvrettelser" som
--      proxy paa (loeb,hold)-par med et manuelt gem i et tidsvindue -- fandt
--      NOEJAGTIGT 1 hold paa den maade, med en eksplicit advarsel om at metoden
--      er upraecis. Fix: race_entries.auto_filled_at (NULL = manuelt) +
--      race_entry_overrides (EEN raekke pr. replace_race_selection-kald, FOER
--      delete+insert, med had_auto_filled + auto_source af de raekker der blev
--      erstattet) -- saa selvrettelser laeses direkte, ikke som proxy.
--
-- TO AUTO-KILDER (#5136 §1's egen skelnen, bevaret her som en enum-agtig TEXT-
-- kolonne, samme moenster som email_sweep_runs.email_type):
--   'late_fill'    -- raceEntryGeneratorSweep.js -> raceEntryGenerator.js, FOER
--                      loebsstart, mode-gated (assistant_selection_mode).
--   'start_rescue' -- raceRunner.js's fillMissingTeamEntries, VED loebsstart,
--                      IKKE mode-gated (uaendret af late_fill-flippet).
--
-- SCOPE-AFGRAENSNING (denne lane ejer KUN raceEntryGeneratorSweep.js,
-- raceRunner.js, denne migration og docs/ASSISTANT_LATE_FILL.md -- IKKE
-- raceEntryGenerator.js, som er den faktiske INSERT-kilde bag sweepen):
--   * auto_filled_at saettes af en TRIGGER (race_entries_stamp_auto_fill_trg),
--     ikke af applikationskoden -- den fanger ALLE nuvaerende og fremtidige
--     skrivere af is_auto_filled=true (raceEntryGenerator.js, raceRunner.js,
--     sweep, admin-regenerate-genvejen, mm.) uden at nogen af dem skal aendres.
--     Samme filosofi som #3420: "invarianten skal have et sted at bo hvor den
--     ikke kan omgaas" -- en DB-trigger fremfor endnu et sted app-laget kan
--     glemme at saette et felt.
--   * auto_filled_source kan KUN saettes praecist af applikationskode der
--     eksplicit sender feltet. raceRunner.js (denne lanes ejerskab) goer det:
--     'start_rescue'. raceEntryGenerator.js (UDENFOR ejerskab) goer det IKKE --
--     triggeren giver den default 'late_fill' for enhver is_auto_filled=true-
--     raekke uden et eksplicit source. Det daekker praecist sweepens skrivninger
--     (issuets krav), men OGSAA generatorens to andre kaldere (seasonTransition.js
--     ved saesonskifte, admin-genvejen POST /admin/seasons/:id/generate-entries)
--     -- de tre kan ikke skelnes fra hinanden paa source-kolonnen uden at aendre
--     raceEntryGenerator.js. Kendt, dokumenteret begraensning -- se
--     docs/ASSISTANT_LATE_FILL.md §3 og PR-beskrivelsen for #5246.
--
-- FLAG_GATED_EMPTY_TABLES (backend/scripts/audit-feature-liveness.js) -- INGEN
-- entry tilfoejet, bevidst:
--   * race_entry_generator_runs: auto_entry_generator_enabled er "on" i prod
--     (verificeret read-only via Supabase MCP under denne session) OG sweepen
--     koerer baade ved boot (cron.js's "Run immediately on start"-blok) og
--     hver 60. min, og skriver NU een raekke PR. koersel uanset fyld -- tabellen
--     faar derfor rows inden for sekunder efter naeste deploy, ikke en periode
--     hvor den er "sund men tom".
--   * race_entry_overrides: replace_race_selection kaldes af enhver normal
--     "Gem plan"-handling i saesonmatrixen (PUT /:raceId/selection) -- en af de
--     hyppigste skrive-stier i spillet. Faar rows praktisk talt straks.
--   Begge er derfor allerede "bevist levende" inden nogen fremtidig audit-
--   koersel naar at se dem tomme -- se ogsaa PERMANENT_EMPTY_TABLES' klasse-2-
--   moenster (sjaeldne opt-in-handlinger) i samme fil, som IKKE passer her,
--   fordi ingen af de to skrivestier er sjaeldne.
--
-- RLS: begge nye tabeller enabled, INGEN policy, kun service_role -- samme
-- moenster som email_sweep_runs/market_value_sunday_sweep_log (#5153: en
-- udokumenteret advisor-WARN maa aldrig staa >7 dage; denne migration undgaar
-- den helt ved at spejle det eksisterende moenster 1:1).
--
-- IDEMPOTENT: CREATE TABLE/COLUMN/CONSTRAINT IF NOT EXISTS, CREATE OR REPLACE
-- FUNCTION, DROP TRIGGER IF EXISTS foer CREATE TRIGGER. Ikke-destruktiv (ingen
-- DELETE/DROP af data). APPLY IKKE her -- orkestrator applier post-merge under
-- #2642-rammerne (auto-migrate.yml); Claude post-verificerer med SELECT.
--
-- INGEN ADFAERDSAENDRING: de to nye kolonner er nullable uden DEFAULT der
-- aendrer eksisterende skrivninger; ingen eksisterende INSERT/UPDATE i repoet
-- satte allerede auto_filled_at/auto_filled_source foer denne migration (nye
-- kolonnenavne), saa CHECK-constrainten nedenfor er trivielt opfyldt af al
-- eksisterende data (is_auto_filled=false-raekker har begge felter NULL by
-- default paa en frisk ADD COLUMN; is_auto_filled=true-raekker opfylder
-- betingelsens foerste gren uanset felternes vaerdi). replace_race_selection's
-- egen binding-guard-logik er BYTE-for-byte uaendret fra 2026-08-18-3420's
-- version -- eneste tilfoejelse er override-log-INSERT'et foer delete+insert.
--
-- POST-VERIFY (koeres EFTER apply, alle read-only):
--   1. SELECT column_name, data_type FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='race_entry_generator_runs'
--       ORDER BY ordinal_position;
--   2. SELECT column_name, data_type FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='race_entries'
--         AND column_name IN ('auto_filled_at','auto_filled_source');
--   3. SELECT column_name, data_type FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='race_entry_overrides'
--       ORDER BY ordinal_position;
--   4. SELECT tgname FROM pg_trigger WHERE tgname = 'race_entries_stamp_auto_fill_trg';  -- 1 raekke
--   5. SELECT proname FROM pg_proc WHERE proname = 'replace_race_selection';  -- 1 raekke
--   6. SELECT grantee, privilege_type FROM information_schema.role_table_grants
--       WHERE table_schema='public' AND table_name IN
--       ('race_entry_generator_runs','race_entry_overrides');  -- kun service_role
--   7. Efter foerste sweep-koersel: SELECT count(*) FROM race_entry_generator_runs;  -- >=1
--
-- Rollback:
--   DROP TRIGGER IF EXISTS race_entries_stamp_auto_fill_trg ON public.race_entries;
--   DROP FUNCTION IF EXISTS public.race_entries_stamp_auto_fill();
--   ALTER TABLE public.race_entries
--     DROP CONSTRAINT IF EXISTS race_entries_auto_fill_stamp_consistency,
--     DROP CONSTRAINT IF EXISTS race_entries_auto_filled_source_check,
--     DROP COLUMN IF EXISTS auto_filled_at,
--     DROP COLUMN IF EXISTS auto_filled_source;
--   DROP TABLE IF EXISTS public.race_entry_generator_runs;
--   DROP TABLE IF EXISTS public.race_entry_overrides;
--   -- replace_race_selection: gendan den forrige krop fra
--   -- database/2026-08-18-3420-race-entries-rider-day-invariant.sql (CREATE OR REPLACE).
--
-- Refs #5246 #5136 #4201

begin;

-- ── 1) race_entry_generator_runs ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.race_entry_generator_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  -- Den EFFEKTIVE tilstand generatoren koerte med (raceEntryGenerator.js' egen
  -- `mode`-returvaerdi, "proactive"|"late_fill" -- fail-safe kan have overstyret
  -- app_config, se raceEntryGeneratorSweep.js's #4201-kommentar).
  mode TEXT,
  late_fill_hours INTEGER,
  -- result.races / result.teams / result.inserted fra runRaceEntryGenerator --
  -- se raceEntryGeneratorSweep.js for feltmapningen + dens begraensning
  -- (teams_filled = "hold behandlet i mindst een pulje", ikke en streng
  -- "lykkedes for ALLE dets ryttere"-taelling).
  races_considered INT NOT NULL DEFAULT 0,
  teams_filled INT NOT NULL DEFAULT 0,
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
  'Lukker #5136 §5''s "ingen maalbar log"-hul. service-role only.';

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
      CHECK (auto_filled_source IS NULL OR auto_filled_source IN ('late_fill', 'start_rescue'));
  END IF;
END $$;

-- Backstop-invariant (samme filosofi som #3420's DB-EXCLUDE ved siden af
-- app-lagets guard): is_auto_filled=false (manuelt) SKAL have begge stempel-
-- felter NULL. Trivielt opfyldt af al eksisterende data -- se header ovenfor.
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

-- Stempler auto_filled_at/auto_filled_source ved ENHVER insert/update der (gen-)
-- saetter is_auto_filled, uanset hvilken af de fire skrivere til race_entries
-- (raceEntryGenerator.js, raceRunner.js, replace_race_selection, admin-
-- regenerate) der udfoerer den -- se header-scope-afsnittet. COALESCE bevarer
-- et eksplicit source (raceRunner.js saetter 'start_rescue') og et allerede-
-- staemplet auto_filled_at ved en UPDATE der blot rebekraefter is_auto_filled
-- (fx en rolle-opdatering skrevet som `.update({is_auto_filled:true, ...})`) --
-- den ORIGINALE fyld-tid/-kilde overskrives ikke af et senere "roer".
CREATE OR REPLACE FUNCTION public.race_entries_stamp_auto_fill()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.is_auto_filled THEN
    NEW.auto_filled_at := COALESCE(NEW.auto_filled_at, now());
    NEW.auto_filled_source := COALESCE(NEW.auto_filled_source, 'late_fill');
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
  '#5246: ''late_fill'' (raceEntryGeneratorSweep -> raceEntryGenerator, foer start, '
  'trigger-default) eller ''start_rescue'' (raceRunner.fillMissingTeamEntries, ved '
  'start, eksplicit sat af app-laget). NULL naar auto_filled_at er NULL.';

-- ── 3) race_entry_overrides ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.race_entry_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL,
  team_id UUID NOT NULL,
  overridden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Havde de ERSTATTEDE raekker (foer dette gem) mindst een auto-fyldt entry?
  had_auto_filled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Kilden hvis had_auto_filled=true og alle auto-fyldte raekker delte SAMME
  -- kilde; 'mixed' hvis de erstattede raekker havde BEGGE kilder; NULL hvis
  -- had_auto_filled=false. Se replace_race_selection's INSERT nedenfor.
  auto_source TEXT
);

-- Maale-SQL'ens groft filter (docs/ASSISTANT_LATE_FILL.md §3): "selvrettelser"
-- = COUNT(*) FILTER (WHERE had_auto_filled) GROUP BY overridden_at::date.
CREATE INDEX IF NOT EXISTS race_entry_overrides_overridden_at_idx
  ON public.race_entry_overrides (overridden_at);
CREATE INDEX IF NOT EXISTS race_entry_overrides_race_team_idx
  ON public.race_entry_overrides (race_id, team_id);

ALTER TABLE public.race_entry_overrides ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.race_entry_overrides FROM anon, authenticated;
GRANT ALL ON public.race_entry_overrides TO service_role;

COMMENT ON TABLE public.race_entry_overrides IS
  '#5246: en raekke pr. replace_race_selection-kald (ethvert "Gem plan"-gem), skrevet '
  'FOER delete+insert, med om de ERSTATTEDE raekker var auto-fyldte. Lukker #5136 §2''s '
  'proxy-maaling ("1 hold" via tidsvindue-gaet) -- selvrettelser laeses nu direkte: '
  'COUNT(*) FILTER (WHERE had_auto_filled). service-role only (skrevet fra RPC''en, '
  'kaldt via service-role -- se database/2026-07-11-revoke-rpc-grants-2327.sql).';

-- ── 4) replace_race_selection: skriv override-raekke FOER delete+insert ────────────
--
-- IDENTISK krop til database/2026-08-18-3420-race-entries-rider-day-invariant.sql's
-- version (binding-guard-logikken er byte-for-byte uaendret) + ÉT nyt INSERT lige
-- foer "Erstat holdets entries"-kommentaren. Signaturen er uaendret
-- (uuid, uuid, uuid[], text[]), saa eksisterende GRANT/REVOKE-tildelinger fra
-- 2026-07-11-revoke-rpc-grants-2327.sql overlever denne CREATE OR REPLACE uaendret.

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

  -- #5246: log FOER erstatningen om de raekker der er ved at blive slettet var
  -- auto-fyldte, saa selvrettelser af assistenten kan taelles direkte (#5136 §2).
  -- Aggregat over 0 raekker (foerste gem for dette loeb/hold) giver bool_or=NULL,
  -- COALESCE'et til false -- "ingen auto-fyld at overskrive" er korrekt her, ikke
  -- ukendt. Flere kilder blandt de erstattede raekker -> 'mixed' (sjaeldent: kun
  -- muligt hvis baade late-fill og start-redning har ramt SAMME (loeb,hold) foer
  -- et gem, fx en delvis start-redning oven paa en tidligere late-fill-fyldt trup).
  INSERT INTO race_entry_overrides (race_id, team_id, had_auto_filled, auto_source)
  SELECT
    p_race_id,
    p_team_id,
    COALESCE(bool_or(is_auto_filled), false),
    CASE
      WHEN NOT COALESCE(bool_or(is_auto_filled), false) THEN NULL
      WHEN count(DISTINCT auto_filled_source) FILTER (WHERE is_auto_filled) = 1
        THEN (array_agg(DISTINCT auto_filled_source) FILTER (WHERE is_auto_filled))[1]
      ELSE 'mixed'
    END
  FROM race_entries
  WHERE race_id = p_race_id AND team_id = p_team_id;

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
  'is_auto_filled=false (manuel udtagelse). #5246: logger en race_entry_overrides-'
  'række FØR delete+insert med om de erstattede rækker var auto-fyldte.';

commit;
