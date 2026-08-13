-- #3593 — FORANKR SEKUNDÆREN I ANLÆGGET.
--
-- HVAD DEN GØR
-- Skriver `riders.archetype_draw.secondary` for de levende ryttere hvor nøglen står
-- som JSON-null, med den værdi rytteren i forvejen har i `riders.secondary_type`.
-- Rører ÉN nøgle i ét jsonb-felt. Ingen DDL på riders, ingen andre kolonner.
--
-- HVORFOR (rodårsagen, ikke symptomet)
-- `resolveRiderTypes(archetype_draw, caps, baseline)` tager primæren fra det
-- persisterede anlæg, men falder tilbage til KLASSIFIKATOREN for sekundæren når
-- anlægget ikke bærer en. Sekundæren former loftet direkte via `youthRoleFactor`
-- (naturalSecondaryFactor 0,82 mod neutralFactor 0,45), så et sekundær-valg der kan
-- skifte natten over er et loft der kan skifte natten over.
--
-- Værre: de to skrivestier bruger IKKE samme kilde til den sekundær der former loftet.
--   backfillCores.js trin 3   →  draw.secondary || null      (ingen sekundær ⇒ faktor 0,45)
--   dailyTrainingEngine.js:314 →  riders.secondary_type      (klassifikatorens sidste output)
-- Samme rytter, samme evner, to forskellige lofter afhængigt af hvilken sti der sidst
-- skrev. Målt på snapshot 2026-08-11T16:36Z: præcis 573 af 8.677 levende ryttere.
-- Efter denne migration er de to kilder identiske for hele den levende bestand, og
-- divergensen kan ikke opstå for en rytter der HAR et to-delt anlæg.
--
-- MÅLT KONSEKVENS (docs/snapshots/3591/dry-run-lofter-resume.json, read-only harness
-- `backend/scripts/dev/lofterDryRun3591.mjs`):
--   ryttere hvor det forankrede loft afviger fra motor-stiens loft ....... 0
--   primær-type-skift som følge af forankringen ......................... 0
--   sekundær-type-skift som følge af forankringen ....................... 0
-- Intet synligt skifter. Det er MÅLT på den fulde levende bestand, ikke antaget.
--
-- Til gengæld FJERNER forankringen 39 sekundær-type-skift som ellers ville ramme når
-- lofterne næste gang genopbygges (39 frie agenter, alle i denne kohorte) — det er
-- selve driften issuet handler om.
--
-- HVILKEN SEKUNDÆR DER SKRIVES — ejer-beslutning 11/8 (#3593)
-- Forelagt valget mellem "specen har ret (HYBRID_PROBABILITY = 15 %)" og "bestanden
-- har ret (alle ryttere har en sekundær)" valgte ejeren bestanden: sekundær type er en
-- normal egenskab alle ryttere har. Ingen spillers rytter får fjernet sin sekundære
-- type. Værdien tages derfor fra `secondary_type`-kolonnen, som spilleren allerede ser.
--
-- ÆRLIG INDVENDING, ejer-afgjort: `fictionalRiderGenerator.js` argumenterer for at
-- skrive klassifikatorens gæt ville "fryse netop gættet — rodårsagen — ind som
-- identitet". Det gælder også her. Ejeren har vejet det og valgt konsistens med det
-- spilleren allerede kan se, frem for at lade halvdelen af loft-formningen drifte.
-- Alternativet — at fjerne sekundæren fra 573 ryttere — er det synlige indgreb.
--
-- AFGRÆNSNING (ikke lukket her)
--   • Voksen-generatoren skriver fortsat `secondary: null` (#3634). Nye AI-hold- og
--     startholds-ryttere vil derfor igen kunne fødes uden sekundært anlæg. DENNE
--     migration renser bestanden; #3634 lukker kilden.
--   • 35 PENSIONEREDE ryttere har slet intet `archetype_draw` (de gik på pension før
--     #3570-reparationen). De rører ingen motor og har ingen værdi, men en fremtidig
--     `runRiderTypesBackfill` ville klassificere dem forfra. Bevidst uden for scope:
--     at skrive et anlæg for dem er en påstand om en fødsels-identitet de aldrig fik.
--
-- IDEMPOTENT: prædikatet matcher ingen rækker efter første kørsel. Kør den gerne igen.
--
-- ROLLBACK: backup-tabellen nedenfor bærer hver berørt rytters `archetype_draw` FØR
-- ændringen. Se `database/2026-08-11-3593-anchor-secondary-archetype-draw-ROLLBACK.sql`.

BEGIN;

-- ── 1) BACKUP FØR SKRIVNING ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.riders_3593_backup_20260811 (
  rider_id               uuid PRIMARY KEY REFERENCES public.riders(id) ON DELETE CASCADE,
  archetype_draw_before  jsonb NOT NULL,
  secondary_type_before  text,
  captured_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.riders_3593_backup_20260811 (rider_id, archetype_draw_before, secondary_type_before)
SELECT r.id, r.archetype_draw, r.secondary_type
FROM public.riders r
WHERE r.is_retired = false
  AND r.archetype_draw ->> 'primary' IS NOT NULL
  AND r.archetype_draw ->> 'secondary' IS NULL
  AND r.secondary_type IS NOT NULL
  AND r.secondary_type <> r.archetype_draw ->> 'primary'
ON CONFLICT (rider_id) DO NOTHING;

-- ── 2) SKRIVNINGEN ──────────────────────────────────────────────────────────
-- Præcis samme prædikat som backuppen, så ingen række kan skrives uden at være sikret.
-- `secondary_type <> primary` er en sikkerhedssele: resolveRiderTypes ignorerer et
-- anlæg hvor sekundær = primær, og en sådan række ville derfor være en tavs no-op.
-- Målt 11/8: 0 rækker rammer den betingelse — selen er tom, ikke bærende.
UPDATE public.riders r
SET archetype_draw = jsonb_set(r.archetype_draw, '{secondary}', to_jsonb(r.secondary_type), true)
WHERE r.is_retired = false
  AND r.archetype_draw ->> 'primary' IS NOT NULL
  AND r.archetype_draw ->> 'secondary' IS NULL
  AND r.secondary_type IS NOT NULL
  AND r.secondary_type <> r.archetype_draw ->> 'primary';

COMMIT;

-- ── 3) POST-VERIFY (kør efter COMMIT — alle fire skal give 0) ───────────────
-- 3a. Ingen levende rytter mangler et sekundært anlæg:
--     SELECT count(*) FROM public.riders
--      WHERE is_retired = false AND archetype_draw ->> 'secondary' IS NULL;
--
-- 3b. Anlæg og synlig kolonne er enige for hele den levende bestand:
--     SELECT count(*) FROM public.riders
--      WHERE is_retired = false
--        AND archetype_draw ->> 'secondary' IS DISTINCT FROM secondary_type;
--
-- 3c. Primæren er urørt (skal fortsat matche den synlige type for alle):
--     SELECT count(*) FROM public.riders
--      WHERE is_retired = false
--        AND archetype_draw ->> 'primary' IS DISTINCT FROM primary_type;
--
-- 3d. Ingen rytter fik sekundær = primær:
--     SELECT count(*) FROM public.riders
--      WHERE is_retired = false
--        AND archetype_draw ->> 'secondary' = archetype_draw ->> 'primary';
--
-- 3e. Backuppen dækker præcis de skrevne rækker (forventet 573 pr. 11/8 16:36Z):
--     SELECT count(*) FROM public.riders_3593_backup_20260811;
