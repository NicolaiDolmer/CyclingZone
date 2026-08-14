-- ═══════════════════════════════════════════════════════════════════════════════
-- #3709 trin 3 (#3682) — BACKUP + ROLLBACK af håndværks-taget
--
-- STATUS: **IKKE KØRT.** Dette er dokumentation, ikke en udført handling.
--         Mutationen er EJER-GATED (#3682 "Rækkefølge og gating", spec §5 stopsignal).
--         Rækkefølgen er ufravigelig: PART A committes FØR PART B overhovedet åbnes.
--
-- HVAD DER ÆNDRER SIG. Kun `rider_derived_abilities.ability_caps`. Ingen evner,
-- ingen typer, ingen priser, intet potentiale. Målt mod docs/snapshots/3591/
-- riders_full.json (13/8) i docs/audits/2026-08-15-3709-trin3-dry-run.md:
--
--     B1  0 af 130.755 evne-pladser fik et LAVERE loft
--     B2  0 af 8.717 ryttere skiftede primary_type eller secondary_type
--     B3  0 af 8.717 ryttere skiftede markedsværdi
--     B4  `potentiale` skrives ikke — den er et LÆST input til formlen
--
-- HVOR STOR ER MUTATIONEN EGENTLIG. Mindre end "alle 8.717". `buildCapsForRider`
-- kaldes af `dailyTrainingEngine.js` for HVER rytter på et hold ved HVERT dagligt
-- tick, og `ability_caps` skrives når `sameCaps` er falsk. Lofterne for
-- hold-ejede ryttere retter altså sig selv ved næste tick efter deploy —
-- spørgsmålet for dem er HVORNÅR, ikke OM.
--
-- Målt på snapshottet (ryttere hvis loft flytter sig):
--     free   1.840   ← INGEN hold ⇒ dailyTrainingEngine ser dem aldrig ⇒
--                       de retter sig ALDRIG selv. Det er dem denne fil findes for.
--     human  3.449   ┐ på hold — retter sig selv ved næste daglige tick
--     ai     3.233   ┘
--
-- Det giver ejeren et ægte valg der ikke fandtes før målingen:
--   (a) kør PART B for ALLE  → alle ser det nye loft samtidig, én kendt tilstand
--   (b) kør PART B kun for frie agenter → mindste indgreb; hold-ryttere glider
--       ind over det næste døgns tick. Prisen er en kortvarig blandet tilstand.
-- Anbefaling: (a). En blandet tilstand er præcis den slags "hvilken kodesti ramte
-- ham først"-tilfældighed #2001/#3591 kostede os to reparationer at komme af med.
--
-- DATO-SUFFIKS: `20260815` skal matche den faktiske skrive-dag.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ███████████████████████████████████████████████████████████████████████████████
-- PART A — SIKKERHEDSKOPI. Eget, committet skridt FØR mutationen.
--
--          Uden PART A findes der ingen rollback. `rider_derived_ability_history`
--          gemmer KUN evne-vektoren, ikke lofterne, og der er ingen updated_at at
--          rulle tilbage til. Den eneste virkelig farlige tilstand er "lofter
--          skrevet, ingen kopi" — committes kopien først, kan den ikke opstå.
--
--          Idempotent: to kørsler giver samme tilstand og overskriver ikke en
--          eksisterende kopi.
-- ███████████████████████████████████████████████████████████████████████████████

CREATE TABLE IF NOT EXISTS public.rider_caps_backup_3709_trin3_20260815 (
  rider_id      uuid PRIMARY KEY,
  ability_caps  jsonb,
  taget_kl      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.rider_caps_backup_3709_trin3_20260815 (rider_id, ability_caps)
SELECT rda.rider_id, rda.ability_caps
FROM public.rider_derived_abilities rda
ON CONFLICT (rider_id) DO NOTHING;

-- ── A-VERIFIKATION. Skal give præcis ÉN række med alle tre kolonner = true.
--    Fejler én af dem: STOP. Kør ikke PART B.
SELECT
  (SELECT count(*) FROM public.rider_caps_backup_3709_trin3_20260815)
    = (SELECT count(*) FROM public.rider_derived_abilities)          AS alle_raekker_kopieret,
  NOT EXISTS (
    SELECT 1 FROM public.rider_derived_abilities rda
    JOIN public.rider_caps_backup_3709_trin3_20260815 b USING (rider_id)
    WHERE b.ability_caps IS DISTINCT FROM rda.ability_caps
  )                                                                   AS kopien_er_identisk,
  -- Data-spærre: en kopi taget EFTER en påbegyndt skrivning er værdiløs som
  -- rollback. Kopien skal tages mens lofterne stadig er de GAMLE, og det kan
  -- kun afgøres af den der kører den — derfor er dette et bevidst manuelt tjek,
  -- ikke en automatisk grøn kolonne der lyver.
  (SELECT max(taget_kl) FROM public.rider_caps_backup_3709_trin3_20260815)
    < now()                                                           AS kopi_er_committet;


-- ███████████████████████████████████████████████████████████████████████████████
-- PART B — MUTATIONEN.  KØRES IKKE SOM SQL.
--
--   Lofterne beregnes af `buildCapsForRider` i JavaScript (potentiale × rolle-
--   faktor × alders-taper, med gulvet max(tapered, current)). Den formel må IKKE
--   duplikeres i SQL — to kopier af caps-formlen der driver fra hinanden er
--   nøjagtig rod-årsagen bag #3591 og #2001.
--
--   Skrivningen sker derfor gennem produktionens egen sti: deploy koden, og lad
--   `dailyTrainingEngine` skrive lofterne for hold-ryttere ved næste daglige tick.
--
--   ⚠ RETTET 15/8: FOR DE FRIE AGENTER FINDES DER INTET VÆRKTØJ ENDNU.
--   En tidligere udgave af denne fil henviste til
--   `scripts/backfillAbilityProgressCaps.js`. Det er forkert. Det script filtrerer
--   på `.or("ability_caps.is.null,ability_progress.is.null")` og springer altså
--   enhver rytter over der ALLEREDE har et loft — hvilket alle 1.840 frie agenter
--   har. Det healer NULL-rækker, ikke forældede rækker.
--
--   Der skal derfor skrives et nyt, idempotent script der:
--     • læser alle ryttere uden team_id (eller alle, hvis ejeren vælger (a) nedenfor)
--     • genberegner `buildCapsForRider(abilities, {potentiale, age}, primary, secondary)`
--       med SAMME kaldform som dailyTrainingEngine.js (alder eksplicit, jf. #3591)
--     • skriver kun når `sameCaps` er falsk
--     • kører dry-run som default og kræver `--live` + ejer-godkendelse
--   Det er en forudsætning for PART B, ikke en detalje.
--
--   Denne fil er SIKKERHEDSNETTET omkring skrivningen, ikke skrivningen.
-- ███████████████████████████████████████████████████████████████████████████████


-- ███████████████████████████████████████████████████████████████████████████████
-- PART C — ROLLBACK. Gendanner nøjagtig den tilstand PART A kopierede.
--
--   ⚠ Rul KUN tilbage sammen med en revert af koden. Rulles lofterne tilbage mens
--     den nye kode stadig kører, skriver næste daglige tick dem frem igen — og så
--     har man en rollback der ser ud til at virke i fem minutter.
-- ███████████████████████████████████████████████████████████████████████████████

UPDATE public.rider_derived_abilities rda
SET ability_caps = b.ability_caps
FROM public.rider_caps_backup_3709_trin3_20260815 b
WHERE rda.rider_id = b.rider_id
  AND rda.ability_caps IS DISTINCT FROM b.ability_caps;

-- ── C-VERIFIKATION. Skal give 0. Er den ikke 0, er rollbacken ikke fuldført.
SELECT count(*) AS raekker_der_stadig_afviger
FROM public.rider_derived_abilities rda
JOIN public.rider_caps_backup_3709_trin3_20260815 b USING (rider_id)
WHERE rda.ability_caps IS DISTINCT FROM b.ability_caps;

-- ── OPRYDNING. Først når ejeren har set den nye tilstand og accepteret den.
--    Backup-tabellen er billig; at slette den for tidligt er ikke.
-- DROP TABLE public.rider_caps_backup_3709_trin3_20260815;
