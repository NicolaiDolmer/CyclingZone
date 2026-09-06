-- =============================================================================
-- 2026-09-06 · #4879 - race_incidents faar v4-paritet (alvorsgrad + tidsgraense)
-- =============================================================================
-- BAGGRUND: loebsmotor v4 (#3855) skriver fra og med denne PR sine egne uheld
-- til race_incidents, praecis som v3 goer. To ting i v4's udfaldsrum findes
-- ikke i den nuvaerende tabel:
--
--   1. ALVORSGRAD (#2944, ejer-beslutning 6/9). v4's trappe har tre styrt-trin
--      (let / haardt / alvorligt). v3 havde ét. Uden kolonnen kan spilfladen
--      ikke skelne "taber 40 sek." fra "ude i 4 dage", og trappen ville
--      forsvinde i persisteringen. Mekaniske uheld har INGEN alvorsakse og
--      skrives derfor med severity = NULL.
--
--   2. TIDSGRAENSEN (#2582, ejer-beslutning 6/9). En rytter uden for
--      tidsgraensen (OTL) kommer i maal, men er ude af loebet. race_results har
--      ingen status-kolonne, saa markeringen bor her — samme moenster som
--      #4418's kind='injury' for en rytter der ikke kunne stille til start.
--      kind='time_limit' + outcome='abandon' (genbrugt, saa
--      loadAbandonedRiderIds filtrerer ham ud af naeste etapes startliste uden
--      en ny gren) + injury_days = NULL: en tidsgraense er ikke en skade
--      (docs/RACE_ENGINE_RULES.md §2c).
--
--   3. 3 KM-REGLEN. Et styrt inden for de sidste 3 km paa en flad etape koster
--      placering, ikke tid. v4 kalder det udfald 'protected_three_km_rule'.
--      Skrev vi det som 'time_loss' med 0 sekunder, ville DNF-/recap-fladen
--      fortaelle at rytteren tabte tid, hvilket han netop ikke gjorde.
--
-- SCOPE: én ny NULLABLE kolonne + to udvidede CHECK-constraints. Ingen data
-- muteres, ingen eksisterende raekke bliver ugyldig ('crash'/'mechanical'/
-- 'injury' og 'time_loss'/'abandon' er uroerte), ingen kolonne fjernes.
-- v3-stien skriver severity = NULL og er dermed bit-identisk med foer.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + DROP CONSTRAINT IF EXISTS + ADD.
-- Kan koeres igen uden effekt.
--
-- ROLLBACK (kun muligt hvis ingen v4-raekker er skrevet endnu):
--   ALTER TABLE public.race_incidents DROP COLUMN IF EXISTS severity;
--   ALTER TABLE public.race_incidents DROP CONSTRAINT IF EXISTS race_incidents_kind_check;
--   ALTER TABLE public.race_incidents ADD CONSTRAINT race_incidents_kind_check
--     CHECK (kind = ANY (ARRAY['crash','mechanical','injury']));
--   ALTER TABLE public.race_incidents DROP CONSTRAINT IF EXISTS race_incidents_outcome_check;
--   ALTER TABLE public.race_incidents ADD CONSTRAINT race_incidents_outcome_check
--     CHECK (outcome = ANY (ARRAY['time_loss','abandon']));
--
-- Refs #4879, #3855, #2944, #2582, #4520, #1176
-- =============================================================================

ALTER TABLE public.race_incidents
  ADD COLUMN IF NOT EXISTS severity text;

ALTER TABLE public.race_incidents
  DROP CONSTRAINT IF EXISTS race_incidents_severity_check;

ALTER TABLE public.race_incidents
  ADD CONSTRAINT race_incidents_severity_check
  CHECK (severity IS NULL OR severity = ANY (ARRAY['light'::text, 'hard'::text, 'serious'::text]));

ALTER TABLE public.race_incidents
  DROP CONSTRAINT IF EXISTS race_incidents_kind_check;

ALTER TABLE public.race_incidents
  ADD CONSTRAINT race_incidents_kind_check
  CHECK (kind = ANY (ARRAY['crash'::text, 'mechanical'::text, 'injury'::text, 'time_limit'::text]));

ALTER TABLE public.race_incidents
  DROP CONSTRAINT IF EXISTS race_incidents_outcome_check;

ALTER TABLE public.race_incidents
  ADD CONSTRAINT race_incidents_outcome_check
  CHECK (outcome = ANY (ARRAY['time_loss'::text, 'abandon'::text, 'protected_three_km_rule'::text]));

COMMENT ON COLUMN public.race_incidents.severity IS
  'Styrtets alvorstrin (#2944, loebsmotor v4): light | hard | serious. NULL for '
  'alt der ikke er et styrt med alvorsakse — mekaniske uheld, kind=injury (#4418), '
  'kind=time_limit (#2582) og ALLE v3-raekker (v3 har kun ét styrt-trin). '
  'Kun et styrt maa saette injury_days (#4520).';

COMMENT ON COLUMN public.race_incidents.kind IS
  'Haendelsens art. crash/mechanical opstaar UNDER etapen (race engine v3 #1176, '
  'v4''s trappe #2944). injury (#4418) er ikke en haendelse i loebet: rytteren blev '
  'skadet uden for loebet og kunne ikke stille til start. time_limit (#2582) er '
  'v4''s tidsgraense: rytteren KOM i maal, men uden for graensen, og er ude af '
  'loebet — skrives med outcome=abandon saa loadAbandonedRiderIds filtrerer ham '
  'ud af naeste etape. injury_days paa en time_limit-raekke stammer ALTID fra et '
  'styrt paa samme etape (UNIQUE-noeglen tillader kun én raekke pr. rytter pr. '
  'etape) — aldrig fra tidsgraensen selv.';
