-- #4587 · Re-derivér riders.is_u25 for den AKTIVE sæson efter UCI-reglen
-- (ejer-beslutning 2/9-2026): U25 = saeson-alder <= 25 (foedt i eller efter
-- referenceaar - 25) i stedet for den gamle "< 25". Den 25-aarige taeller nu
-- STADIG med, ligesom UCIs hvide troeje. U23 er UAENDRET af denne migration.
--
-- HVAD DEN GØR
-- Saetter riders.is_u25 = (EXTRACT(YEAR FROM birthdate) >= v_reference_year - 25)
-- for ALLE ryttere MED birthdate, hvor v_reference_year er den AKTIVE saesons
-- referenceaar (LAUNCH_REFERENCE_YEAR + (seasons.number - 1), seasons.status =
-- 'active') - samme formel som backend/lib/riderSeasonAge.js's SSOT
-- (isU25ForReferenceYear/seasonReferenceYear). LAUNCH_REFERENCE_YEAR=2026 er
-- hardkodet her ligesom i SSOT-filen (denne migration er data, ikke kode, saa
-- backend-forward-guarden i riderSeasonAge.test.js dækker den ikke - hold de
-- to i sync manuelt hvis LAUNCH_REFERENCE_YEAR nogensinde aendres).
--
-- Findes ingen aktiv saeson (seasons.status='active' giver 0 raekker), rammer
-- UPDATE'en 0 raekker (CTE'en er tom, ingen JOIN-match) - ingen NULL-hazard.
--
-- HVORFOR
-- riders.is_u25 er en lagret FALLBACK-kolonne (bruges naar saeson-referenceaaret
-- ikke kan slaas op live - se raceRunner.js's loadSeasonReferenceYear-fallback
-- og riderProgressionEngine.js's naeste sæson-slut-koersel). Grænsen aendrede
-- sig fra "< 25" til "<= 25" i #4587 (kode-siden: raceRunner.js,
-- fictionalRiderGenerator.js, riderProgressionEngine.js, frontend/riderAge.js
-- kalder nu alle den nye SSOT), men allerede LAGREDE raekker beholder den GAMLE
-- beregning indtil de naeste gang rammes af en skrivende sti (naeste sæson-slut
-- eller naeste løb en rytter staar i felten til). Denne migration re-deriverer
-- STRAKS, saa fallback-flaget og ungdomsklassementet ikke er stale i mellemtiden
-- (samme rodaarsag-klasse som #2073/#109 - "lagret flag re-deriveres aldrig af
-- sig selv").
--
-- FORVENTET ANTAL RAEKKER DER SKIFTER (maalt IKKE af denne session - se PR-body
-- for den praecise SELECT-tekst orkestratoren koerer FØR/EFTER apply).
--
-- IDEMPOTENT: UPDATE'en saetter is_u25 til den (nye) korrekte vaerdi hver gang -
-- kør den gerne igen, 0 raekker aendres ved 2. koersel (WHERE ... IS DISTINCT
-- FROM ... matcher intet efter foerste koersel).
--
-- INGEN SPILLER MISTER DATA: kun boolean-flaget is_u25 rykker; birthdate og alt
-- andet paa rytteren er uroert. Kun raekker hvor vaerdien RENT FAKTISK aendrer
-- sig rammes af UPDATE'en.
--
-- AFLEDTE FLADER (populations-mutation, jf. PR-templatens afledningstjekliste):
--   - Ungdomsklassementet i race-motoren (race_results.result_type
--     young/young_day) laeser is_u25 IKKE direkte fra kolonnen ved afvikling af
--     KOMMENDE løb (raceRunner.js's loadEntrantsForRace deriverer live fra
--     birthdate + sæsonens referenceaar, kolonnen er kun fallback) - saa denne
--     migration paavirker IKKE allerede-afviklede løbs resultater, kun
--     fallback-flaget og alt der LAESER kolonnen direkte (UI-badges/filtre der
--     endnu ikke er hentet via birthdate, bestyrelsens U25-maal der tæller
--     r.is_u25 i boardUtils.js/boardGoals.js).
--   - Bestyrelsens U25-relaterede maal (min_u25_riders, u25_development_delta)
--     laeser riders.is_u25 direkte og paavirkes af denne migration.
--
-- ⚠️ Denne fil APPLIES IKKE automatisk her - den koeres af ejer/orkestrator
-- POST-MERGE under #2642-rammerne (idempotent + post-verify, IKKE en
-- destruktiv klasse: ingen sletning, kun flip af ét eksisterende boolean-flag).
--
-- ROLLBACK: backup-tabellen nedenfor baerer hver berørt rytters is_u25 FØR
-- aendringen.

BEGIN;

-- ── 1) BACKUP FØR SKRIVNING ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.riders_4587_is_u25_backup_20260902 (
  rider_id      uuid PRIMARY KEY REFERENCES public.riders(id) ON DELETE CASCADE,
  is_u25_before boolean NOT NULL,
  captured_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.riders_4587_is_u25_backup_20260902 (rider_id, is_u25_before)
SELECT r.id, r.is_u25
FROM public.riders r
JOIN (
  SELECT 2026 + (s.number - 1) AS reference_year
  FROM public.seasons s
  WHERE s.status = 'active'
  LIMIT 1
) active_season ON true
WHERE r.birthdate IS NOT NULL
  AND r.is_u25 IS DISTINCT FROM (
    EXTRACT(YEAR FROM r.birthdate)::int >= active_season.reference_year - 25
  )
ON CONFLICT (rider_id) DO NOTHING;

-- ── 2) SKRIVNINGEN ──────────────────────────────────────────────────────────
UPDATE public.riders r
SET is_u25 = (
  EXTRACT(YEAR FROM r.birthdate)::int >= active_season.reference_year - 25
)
FROM (
  SELECT 2026 + (s.number - 1) AS reference_year
  FROM public.seasons s
  WHERE s.status = 'active'
  LIMIT 1
) active_season
WHERE r.birthdate IS NOT NULL
  AND r.is_u25 IS DISTINCT FROM (
    EXTRACT(YEAR FROM r.birthdate)::int >= active_season.reference_year - 25
  );

COMMIT;

-- ── 3) POST-VERIFY (kør efter COMMIT) ───────────────────────────────────────
-- 3a. Ingen rytter MED birthdate har længere en is_u25-værdi der afviger fra
--     den nye UCI-regel for den aktive sæson (forventet 0):
--     WITH active_season AS (
--       SELECT 2026 + (s.number - 1) AS reference_year
--       FROM public.seasons s WHERE s.status = 'active' LIMIT 1
--     )
--     SELECT count(*) FROM public.riders r, active_season
--      WHERE r.birthdate IS NOT NULL
--        AND r.is_u25 IS DISTINCT FROM (
--          EXTRACT(YEAR FROM r.birthdate)::int >= active_season.reference_year - 25
--        );
--
-- 3b. Backuppen dækker præcis de skrevne rækker:
--     SELECT count(*) FROM public.riders_4587_is_u25_backup_20260902;
--
-- 3c. Alle 25-årige (i den aktive sæsons referenceår) er nu is_u25=true, dvs.
--     ingen 25-årig mangler i ungdomsklassementet (forventet 0):
--     WITH active_season AS (
--       SELECT 2026 + (s.number - 1) AS reference_year
--       FROM public.seasons s WHERE s.status = 'active' LIMIT 1
--     )
--     SELECT count(*) FROM public.riders r, active_season
--      WHERE r.birthdate IS NOT NULL
--        AND EXTRACT(YEAR FROM r.birthdate)::int = active_season.reference_year - 25
--        AND r.is_u25 = false;
--
-- ── ROLLBACK (kun hvis nødvendigt) ──────────────────────────────────────────
-- UPDATE public.riders r
-- SET is_u25 = bak.is_u25_before
-- FROM public.riders_4587_is_u25_backup_20260902 bak
-- WHERE bak.rider_id = r.id;

-- Refs #4587 #2642
