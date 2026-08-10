-- ═══════════════════════════════════════════════════════════════════════════════
-- #3570 — BACKUP + ROLLBACK af ryttertype-reparationen
--
-- GENERERET FIL — ret den IKKE i hånden.
--   Kilde: backend/scripts/dev/repair3570Apply.mjs → BACKUP_SKEMA / rollbackSQL()
--   Gendan:  node scripts/dev/repair3570Apply.mjs --print-rollback-sql [--backup-suffix=YYYYMMDD]
--   En test i repair3570Apply.test.js fejler hvis filen og generatoren driver fra hinanden.
--
-- STATUS: **IKKE KØRT.** Dette er dokumentation, ikke en udført handling.
--         Hele reparationen er ejer-gated.
--
-- SKEMAET (blokker B1′, verifikationen 10/8). Tidligere bar denne fil nøglekolonnen
-- `rider_id` på riders-kopien mens apply-værktøjet brugte `id`; der fandtes ingen
-- kombination hvor begge kunne køre. Nøglenavnet arves nu fra KILDE-tabellen:
--     public.riders                  → primærnøgle `id`
--     public.rider_derived_abilities → primærnøgle `rider_id` (FK → riders.id, CASCADE)
-- Derfor: to backup-tabeller med FORSKELLIGE nøglenavne, to UPDATEs, én post-verify
-- der joiner begge. Samme kolonner som prod-præcedensen
-- `public.riders_type_backfill_snapshot_20260805`, plus `base_value`/`market_value`
-- og den primærnøgle præcedensen mangler.
--
-- Permanent kopi af før-tilstanden: docs/snapshots/3570/ (gzippet).
--
-- DATO-SUFFIKS: `20260816` skal matche den faktiske skrive-dag. Generér filen med
-- `--backup-suffix=<dagen>` i stedet for at søge-erstatte i hånden.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ███████████████████████████████████████████████████████████████████████████████
-- PART A — SIKKERHEDSKOPI.  Køres som sit eget, committede skridt FØR reparationen.
--          Den eneste virkelig farlige tilstand er "identitet skrevet, ingen kopi".
--          Committes kopien først, kan den tilstand ikke opstå.
--
--          Uden PART A findes der ingen rollback: `riders.updated_at` vedligeholdes
--          IKKE ved UPDATE, og `rider_derived_ability_history` gemmer kun
--          evne-vektoren, ikke lofterne.
--
--          Blokken er idempotent: to kørsler giver samme tilstand og overskriver
--          ikke en eksisterende kopi.
-- ███████████████████████████████████████████████████████████████████████████████

BEGIN;

-- A0. HÅRD SPÆRRE — en kopi må kun tages af en FØR-tilstand. Er reparationen
--     allerede (delvis) kørt, er enhver kopi herfra en efter-tilstand, og den ville
--     være ubrugelig som rollback-kilde. Samme datagrænse som apply-værktøjets
--     `DRAW_BASELINE_SPAERRE`.
DO $$
DECLARE n_draw bigint;
BEGIN
  IF to_regclass('public.riders_3570_backup_20260816') IS NOT NULL
     AND (SELECT count(*) FROM public.riders_3570_backup_20260816) > 0 THEN
    RAISE NOTICE 'public.riders_3570_backup_20260816 findes allerede — PART A rører den ikke.';
    RETURN;
  END IF;
  SELECT count(*) INTO n_draw FROM public.riders WHERE archetype_draw IS NOT NULL;
  IF n_draw > 50 THEN
    RAISE EXCEPTION 'STOP: % ryttere har allerede et archetype_draw. Reparationen er (delvis) kørt — en kopi taget nu er IKKE en rollback-kilde.', n_draw;
  END IF;
END
$$;

-- A1. Identitets-kolonnerne fra public.riders. ALLE rækker kopieres (også de
--     pensionerede) — det er gratis og fjerner enhver kant omkring is_retired.
CREATE TABLE IF NOT EXISTS public.riders_3570_backup_20260816 AS
SELECT
  id,
  archetype_draw,
  primary_type,
  secondary_type,
  valuation_type,
  base_value,
  market_value,
  is_retired,
  now() AS captured_at
FROM public.riders;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'riders_3570_backup_20260816_pkey') THEN
    ALTER TABLE public.riders_3570_backup_20260816
      ADD CONSTRAINT riders_3570_backup_20260816_pkey PRIMARY KEY (id);
  END IF;
END
$$;

-- A2. Loft-kolonnerne fra public.rider_derived_abilities.
--     `ability_progress` skrives IKKE af reparationen, men kopieres med: et ændret
--     loft flytter den brøkdel feltet udtrykker.
CREATE TABLE IF NOT EXISTS public.rider_derived_abilities_3570_backup_20260816 AS
SELECT
  rider_id,
  ability_caps,
  ability_progress,
  now() AS captured_at
FROM public.rider_derived_abilities;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rider_derived_abilities_3570_backup_20260816_pkey') THEN
    ALTER TABLE public.rider_derived_abilities_3570_backup_20260816
      ADD CONSTRAINT rider_derived_abilities_3570_backup_20260816_pkey PRIMARY KEY (rider_id);
  END IF;
END
$$;

-- A3. POST-VERIFY af kopien — en ÆGTE port. Fejler én kontrol, afbrydes hele
--     transaktionen, og PART A's CREATE TABLE ruller med tilbage.
DO $$
DECLARE k1 bigint; k2 bigint; k3 bigint; k4 bigint; n_b bigint; n_r bigint; n_ba bigint; n_a bigint;
BEGIN
  SELECT count(*) INTO n_b  FROM public.riders_3570_backup_20260816;
  SELECT count(*) INTO n_r  FROM public.riders;
  SELECT count(*) INTO n_ba FROM public.rider_derived_abilities_3570_backup_20260816;
  SELECT count(*) INTO n_a  FROM public.rider_derived_abilities;
  SELECT count(*) INTO k1 FROM public.riders r
    LEFT JOIN public.riders_3570_backup_20260816 b ON b.id = r.id
   WHERE b.id IS NULL;
  SELECT count(*) INTO k2 FROM public.rider_derived_abilities a
    LEFT JOIN public.rider_derived_abilities_3570_backup_20260816 b ON b.rider_id = a.rider_id
   WHERE b.rider_id IS NULL;
  SELECT count(*) INTO k3 FROM public.riders r
    JOIN public.riders_3570_backup_20260816 b ON b.id = r.id
   WHERE r.archetype_draw IS DISTINCT FROM b.archetype_draw
      OR r.primary_type   IS DISTINCT FROM b.primary_type
      OR r.secondary_type IS DISTINCT FROM b.secondary_type;
  SELECT count(*) INTO k4 FROM public.rider_derived_abilities a
    JOIN public.rider_derived_abilities_3570_backup_20260816 b ON b.rider_id = a.rider_id
   WHERE a.ability_caps     IS DISTINCT FROM b.ability_caps
      OR a.ability_progress IS DISTINCT FROM b.ability_progress;
  RAISE NOTICE 'Kopi: % / % riders, % / % abilities. Kontrol 1-4: %, %, %, %.', n_b, n_r, n_ba, n_a, k1, k2, k3, k4;
  IF n_b <> n_r OR n_ba <> n_a OR k1 <> 0 OR k2 <> 0 OR k3 <> 0 OR k4 <> 0 THEN
    RAISE EXCEPTION 'STOP: kopien er ikke komplet (riders %/%, abilities %/%, ktr1-4 %,%,%,%). Reparationen må ikke starte.', n_b, n_r, n_ba, n_a, k1, k2, k3, k4;
  END IF;
END
$$;

COMMIT;


-- ███████████████████████████████████████████████████████████████████████████████
-- PART B — ROLLBACK.  Køres KUN hvis reparationen skal fortrydes.
-- ███████████████████████████████████████████████████████████████████████████████

-- B0. HÅRD SPÆRRE — PART B må ikke kunne køre uden en gyldig kopi fra FØR
--     reparationen.
DO $$
DECLARE
  n_riders    bigint;
  n_abilities bigint;
  n_draw      bigint;
  taget       timestamptz;
BEGIN
  IF to_regclass('public.riders_3570_backup_20260816') IS NULL
     OR to_regclass('public.rider_derived_abilities_3570_backup_20260816') IS NULL THEN
    RAISE EXCEPTION 'STOP: en eller begge #3570-backup-tabeller mangler. Der findes ingen rollback-kilde.';
  END IF;

  SELECT count(*) INTO n_riders    FROM public.riders_3570_backup_20260816;
  SELECT count(*) INTO n_abilities FROM public.rider_derived_abilities_3570_backup_20260816;
  SELECT min(captured_at) INTO taget FROM public.riders_3570_backup_20260816;

  IF n_riders = 0 OR n_abilities = 0 THEN
    RAISE EXCEPTION 'STOP: backup-tabellerne er tomme (riders=%, abilities=%).', n_riders, n_abilities;
  END IF;

  -- Er kopien fra FØR eller EFTER reparationen? Et tidsstempel kan ikke afgøre det
  -- (rollbacken køres på samme dag), men DATA kan: før reparationen har en håndfuld
  -- levende ryttere et archetype_draw; efter har hele peletonen.
  SELECT count(*) INTO n_draw FROM public.riders_3570_backup_20260816 WHERE archetype_draw IS NOT NULL;
  IF n_draw > 50 THEN
    RAISE EXCEPTION 'STOP: kopien indeholder % ryttere med archetype_draw. Kopien er taget EFTER skrivningen og er IKKE en rollback-kilde.', n_draw;
  END IF;

  RAISE NOTICE 'Backup OK: % riders-rækker, % abilities-rækker, % med draw, taget %.', n_riders, n_abilities, n_draw, taget;
END
$$;

-- B1. FORHÅNDS-KONTROL — kør og LÆS, før du starter transaktionen i B2.
SELECT
  (SELECT count(*) FROM public.riders_3570_backup_20260816)                                    AS backup_riders,
  (SELECT count(*) FROM public.rider_derived_abilities_3570_backup_20260816)                                 AS backup_abilities,
  (SELECT count(*) FROM public.riders)                                     AS riders_nu,
  (SELECT count(*) FROM public.rider_derived_abilities)                                     AS abilities_nu,
  (SELECT count(*) FROM public.riders r
     JOIN public.riders_3570_backup_20260816 b ON b.id = r.id)                        AS faelles_riders,
  (SELECT count(*) FROM public.rider_derived_abilities a
     JOIN public.rider_derived_abilities_3570_backup_20260816 b ON b.rider_id = a.rider_id)               AS faelles_abilities,
  (SELECT count(*) FROM public.riders r
     LEFT JOIN public.riders_3570_backup_20260816 b ON b.id = r.id
    WHERE b.id IS NULL)                                               AS nye_ryttere_siden_kopien,
  -- Slettede ryttere: findes i kopien, men ikke længere i public.riders.
  -- aiTeamTrimHealSweep fjerner overskydende AI-hold løbende (by design, #2187/#2389),
  -- så dette tal er normalt > 0 og er IKKE en fejl. UPDATE'en rammer dem ikke.
  (SELECT count(*) FROM public.riders_3570_backup_20260816 b
     LEFT JOIN public.riders r ON b.id = r.id
    WHERE r.id IS NULL)                                                        AS slettede_siden_kopien,
  (SELECT count(*) FROM public.riders r
     JOIN public.riders_3570_backup_20260816 b ON b.id = r.id
    WHERE r.archetype_draw IS DISTINCT FROM b.archetype_draw
       OR r.primary_type   IS DISTINCT FROM b.primary_type
       OR r.secondary_type IS DISTINCT FROM b.secondary_type)                  AS identitet_ramt,
  (SELECT count(*) FROM public.rider_derived_abilities a
     JOIN public.rider_derived_abilities_3570_backup_20260816 b ON b.rider_id = a.rider_id
    WHERE a.ability_caps IS DISTINCT FROM b.ability_caps)                      AS lofter_ramt,
  (SELECT min(captured_at) FROM public.riders_3570_backup_20260816)                            AS kopi_taget;


-- B2. SELVE ROLLBACKEN — to UPDATEs i ÉN transaktion.
--     Idempotent: anden kørsel rammer 0 rækker, fordi IS DISTINCT FROM-filteret
--     så er tomt.
BEGIN;

-- B2a. Identiteten tilbage på public.riders.
--      `valuation_type`, `base_value` og `market_value` gendannes IKKE her: de
--      skrives ikke af reparationen (#3345-frysningen), men de ligger i kopien.
UPDATE public.riders r
SET archetype_draw = b.archetype_draw,
    primary_type   = b.primary_type,
    secondary_type = b.secondary_type
FROM public.riders_3570_backup_20260816 b
WHERE b.id = r.id
  AND (   r.archetype_draw IS DISTINCT FROM b.archetype_draw
       OR r.primary_type   IS DISTINCT FROM b.primary_type
       OR r.secondary_type IS DISTINCT FROM b.secondary_type);

-- B2b. Lofterne tilbage på public.rider_derived_abilities.
UPDATE public.rider_derived_abilities a
SET ability_caps     = b.ability_caps,
    ability_progress = b.ability_progress
FROM public.rider_derived_abilities_3570_backup_20260816 b
WHERE b.rider_id = a.rider_id
  AND (   a.ability_caps     IS DISTINCT FROM b.ability_caps
       OR a.ability_progress IS DISTINCT FROM b.ability_progress);

-- B2c. POST-VERIFY inde i transaktionen — en ÆGTE port. Fejler én af de fem,
--      afbrydes transaktionen og begge UPDATEs rulles tilbage.
--      Ryttere der er SLETTET siden kopien indgår ikke i joinet; de kan ikke
--      gendannes af en UPDATE og er ikke en fejl (se B4 e).
DO $$
DECLARE d bigint; p bigint; s bigint; c bigint; pr bigint; n bigint;
BEGIN
  SELECT count(*) FILTER (WHERE r.archetype_draw   IS DISTINCT FROM br.archetype_draw),
         count(*) FILTER (WHERE r.primary_type     IS DISTINCT FROM br.primary_type),
         count(*) FILTER (WHERE r.secondary_type   IS DISTINCT FROM br.secondary_type),
         count(*) FILTER (WHERE a.ability_caps     IS DISTINCT FROM ba.ability_caps),
         count(*) FILTER (WHERE a.ability_progress IS DISTINCT FROM ba.ability_progress),
         count(*)
    INTO d, p, s, c, pr, n
    FROM public.riders r
    JOIN public.riders_3570_backup_20260816    br ON br.id = r.id
    JOIN public.rider_derived_abilities     a  ON a.rider_id     = r.id
    JOIN public.rider_derived_abilities_3570_backup_20260816 ba ON ba.rider_id = r.id;
  RAISE NOTICE 'Rollback kontrolleret på % rækker: draw %, primary %, secondary %, caps %, progress %.', n, d, p, s, c, pr;
  IF d <> 0 OR p <> 0 OR s <> 0 OR c <> 0 OR pr <> 0 THEN
    RAISE EXCEPTION 'STOP: rollbacken er ikke komplet (draw %, primary %, secondary %, caps %, progress % af % rækker).', d, p, s, c, pr, n;
  END IF;
END
$$;

COMMIT;


-- B3. EFTER-KONTROL — er før-tilstanden genskabt?
SELECT count(*) FILTER (WHERE archetype_draw IS NOT NULL) AS ryttere_med_draw,
       count(*)                                           AS levende
FROM public.riders WHERE is_retired = false;

SELECT r.primary_type, count(*),
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM public.riders r
JOIN public.teams t ON t.id = r.team_id
WHERE r.is_retired = false AND t.user_id IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC;


-- B4. HVAD DER **IKKE** KAN RULLES TILBAGE
--
-- a) ALT DER ER SKET SIDEN SKRIVNINGEN. Nattens sweep (22:00 dansk) genopbygger
--    `ability_caps` fra den PERSISTEREDE type (dailyTrainingEngine.js) og skriver
--    `ability_progress`. Køres rollbacken efter en sweep, ruller den også den nats
--    ægte træning tilbage for de ramte ryttere. `riderValueRefresh.js` skriver
--    `base_value`/`market_value`; de ER i kopien, men gendannes ikke af B2a.
--
-- b) HANDLINGER SPILLERNE HAR FORETAGET PÅ GRUNDLAG AF DEN NYE IDENTITET.
--    Auktionsbud, køb, salg, lån, kontrakter, taktik- og træningsvalg,
--    holdopstillinger. De står ved magt; kun etiketten skifter tilbage.
--
-- c) LØBSRESULTATER kørt med de nye lofter. Resultat-tabellerne røres ikke.
--
-- d) RYTTERE OPRETTET EFTER KOPIEN (akademi-intake, nye managere, AI-fill).
--    De findes ikke i kopien og beholder deres egen identitet — hvilket er korrekt
--    for akademi-ryttere: de har et ÆGTE `archetype_draw` fra #3588-stien.
--
-- e) RYTTERE DER ER SLETTET mellem kopi og rollback. UPDATE'en rammer dem ikke.
--    Det sker LØBENDE og by design: `aiTeamTrimHealSweep` (cron) fjerner
--    overskydende AI-hold efterhånden som nye spillere kommer til
--    (#2187/#2389/#2074) — målt 180 ryttere / 8 AI-hold på 12,5 timer 10/8.
--    Pensionerede ryttere ER derimod dækket: kopien tager alle rækker uanset
--    `is_retired`.
--
-- f) DET SPILLERNE HAR SET. Managerne ville se truppen omdøbt og derefter døbt
--    tilbage. Det kan ingen SQL fortryde, og det er den reelle grund til at
--    beslutningen skal træffes én gang.
--
-- g) EN ROLLBACK GENÅBNER FEJLEN. Sættes `archetype_draw` tilbage til NULL,
--    genoptager den lukkede løkke type → ability_caps → type.


-- B5. OPRYDNING (kør IKKE sammen med rollbacken — vent til beslutningen er endelig)
--   DROP TABLE IF EXISTS public.riders_3570_backup_20260816;
--   DROP TABLE IF EXISTS public.rider_derived_abilities_3570_backup_20260816;
