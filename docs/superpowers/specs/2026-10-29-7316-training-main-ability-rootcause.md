# #7316 Rodårsag: programmets hovedevne står stille efter S5-skiftet

Undersøgelsesspor (kind: investigate, #5220), 29/10. Ingen kode, ingen migration, ingen flag-flip.
Alle prod-tal er læst read-only via Supabase `execute_sql` 29/10.

## Dom

**Bekræftet.** Rodårsagen er kurve B's bløde loft (`development_curve_b`, tændt i prod
25/10 21:02 UTC). En evne på eller over sit bløde loft får præcis 0 fremgang. Det bløde loft
er `ability_caps[evne] × potentialCeiling[potentiale]`. Rytterens hovedevne er næsten altid den
evne der ligger tættest på (eller over) loftet, så den fryser. De lavere evner ligger under
loftet og får stadig off-fokus-fremgang. Ingen fejl i evne-mapping, programnøgler eller
fordeling. Modellen gør, hvad den er kodet til. Kalibreringen rammer bare den eksisterende
rytterbestand forkert.

## Evidens

### 1. Flag-tidslinje (app_config, prod)

| flag | værdi | sat |
|---|---|---|
| `ability_cap_per_date_enabled` | on | 25/10 11:34 UTC |
| `development_v2_aging_enabled` | on | 25/10 11:33 UTC |
| `condition_model_v2` | on | 25/10 21:01 UTC |
| **`development_curve_b`** | **on** | **25/10 21:02 UTC** |
| `development_score_v2` | off | 25/10 22:11 UTC |
| `race_day_catchup_enabled` | off | 25/10 22:11 UTC |

### 2. Målt brud (manager-hold, ikke-løbsdage, intensitet ≠ rest, `training_rider_ticks.report`)

"Hovedevne" = programmets navngivne evne: vo2max/vo2max_climb→climbing, vo2max_punch→punch,
threshold/aero→time_trial, sprint→sprint, attack_repeats→aggression, endurance→endurance,
echelon_drills→flat, cobbled_sectors→cobblestone, tempo→tempo, technique→descending,
loebslaere→positioning. "Bevæget" = `progress_after > progress_before` eller en gain på evnen.

| dato | ticks | ryttere | hovedevne bevæget | kun andre evner bevæget | intet bevæget |
|---|---|---|---|---|---|
| 25/10 (sidste dag før kurve B) | 11.842 | 2.806 | **98,6 %** | 0,4 % | 1,5 % |
| 26/10 | 11.443 | 2.306 | **81,4 %** | 16,0 % | 2,7 % |
| 27/10 | 11.729 | 2.346 | 81,7 % | 15,1 % | 3,1 % |
| 28/10 | 9.129 | 2.231 | 82,6 % | 13,9 % | 3,5 % |
| 29/10 (delvis) | 495 | 99 | 86,7 % | 13,3 % | 0,0 % |

S4-baseline 21-24/10 pr. program: hovedevnen bevæget 93,5-99,9 %, "kun andre" 0,0-0,7 %.
S5 26-28/10 pr. program (hovedevne bevæget / kun andre evner):
vo2max_punch 64,5 / 34,0 · vo2max_climb 67,5 / 31,9 · cobbled_sectors 77,6 / 15,1 ·
vo2max 82,8 / 13,9 · attack_repeats 83,2 / 15,6 · sprint 84,0 / 14,3 · aero 84,1 / 11,7 ·
threshold 86,4 / 11,4 · endurance 90,3 / 4,9 · echelon_drills 91,9 / 4,6.

Bruddet ligger præcist mellem 25/10 og 26/10 og er ikke rettet 29/10.

### 3. Mur ved `nuværende / ability_caps` pr. potentiale (28/10)

Andel ticks hvor hovedevnen bevægede sig, efter evnens nuværende værdi som andel af `ability_caps`
(5 %-spande). Fremgangen falder fra ~100 % til 0 inden for én spand. Det er en mur, ikke en glidende
opbremsning:

| potentiale | sidste spand ~100 % | overgang | 0 % fra |
|---|---|---|---|
| 1,0 | 20 % | 25 % (22 %) | 30 % |
| 1,5 | 25 % | 30 % (55 %) | 35 % |
| 2,0 | 30 % | 35 % (31 %) | 40 % |
| 2,5 | 35 % | 40 % (37 %) | 45 % |
| 3,0 | 40 % | 45 % (58 %) | 50 % |
| 3,5 | 45 % | 50 % (69 %) | 55 % |
| 4,0 | 55 % | — | 60 % |
| 4,5 | 60 % | 65 % (70 %) | 70 % |
| 5,0 | 70 % | 75 % (38 %) | 80 % |
| 5,5 | 85 % | — | 90 % |
| 6,0 | ≥ 90 % (ingen mur målt) | | |

Tærsklen stiger med potentialet, sådan som `potentialCeiling[1..6]` er bygget. Det er det bløde
loft og kan ikke være den gamle model: den er gap-proportional mod `ability_caps` og har ingen
tærskel under loftet (S4: 98-99 % bevæget).

### 4. Rytter-trace (spillernes egne eksempler)

`rider_derived_abilities` (hovedevne nu / `ability_caps`) mod tærsklen ovenfor:

| rytter | program | pot | hovedevne | andel | tærskel | resultat |
|---|---|---|---|---|---|---|
| Bart Lenaerts | vo2max_punch | 4,5 | punch 80/93 | 86 % | ~65-70 % | over → 0 |
| Wout Maes | climbing | 4,5 | climbing 78/93 | 84 % | ~65-70 % | over → 0 |
| Jasper Coppens | sprint | 3,5 | sprint 58/93 | 62 % | ~50-55 % | over → 0 |
| Sergio Lozano | vo2max_punch | 5,0 | punch 72/93 | 77 % | ~75 % | over → 0 |
| Aitor Ó. Campos | vo2max (Mixed) | 4,0 | climbing 61/93 | 66 % | ~60 % | over → 0 |
| Sven W. Bakker | attack_repeats | 3,0 | aggression 44/93 | 47 % | ~45 % | over → 0 |
| Sander D. Roelofs | attack_repeats | 3,0 | aggression 42/93 | 45 % | ~45 % | på grænsen → 0 |

Bart Lenaerts' tick 28/10 gd3+gd4 (`training_rider_ticks`): `punch` progress 0,19369494936
før og efter på begge løbsdage, `gains {}`. Climbing, tempo, flat, sprint osv. steg. Climbing
51/80 = 64 % ligger under hans loft og stiger derfor.

### 5. Kodestien

- `backend/lib/dailyTrainingEngine.js:738-742`: `loadDevelopmentCurveB` → `curveB` (flag on + params i
  `DEVELOPMENT_CURVE_B_PARAMS`).
- `backend/lib/dailyTraining.js:167-169`: med `curveB` erstattes `base` af `curveBBase(...)`.
- `backend/lib/developmentCurveB.ts:123-133` `curveBSoftCeiling = cap × potentialCeiling[pot]`;
  `:136-141` `curveBCapSoftness` returnerer **0 når `current >= ceiling`**; `:157-162` giver
  dermed `base = 0` → `dailyAbilityDelta` = 0 → `applyDailyTick` springer evnen over
  (`dailyTraining.js:327`). Ingen progress, ingen gain.
- Løbsdage: `dailyTraining.js:455-456` bruger samme bløde loft, så løbsdagens point til evnen
  forsvinder også.
- `cap` = `ability_caps` fra `buildCapsForRider` (`riderProgression.js:881`), dvs. rolleklassens
  tag (93 for signatur-evner). Spilleren ser 93 som rytterens loft. Det bløde loft er privat og
  bliver ikke vist.
- `docs/TRAINING_RULES.md` §2.1b siger "Tæt på det bløde loft aftager fremdriften glidende
  (ingen mur)". Målingen viser en mur. Bestanden er bygget under den gamle model, og dens
  signatur-evner står allerede over det bløde loft, så for dem er der intet glidende stykke
  tilbage.

### Udelukket

- `ability_cap_per_date_enabled` (+1 pr. dato): den klipper hele point, men nulstiller ikke
  progress-baren. Her står baren helt stille.
- Forkert evne-mapping/omdøbning: `TRAINING_FOCUSES` (`training.js:88-115`) er uændret, og
  focus-nøglerne i rapporterne matcher.
- #7282/#7288 (træning mellem sæsoner, træthed 20): de påvirker ikke `base`.
- `development_score_v2` og catch-up er slukket.

## Hvorfor nogle ryttere får 0 i alt

Det gælder 2,7-3,5 % af ticks mod 1,5 % før. Det er ryttere, hvor alle programmets fokus-evner
står over det bløde loft (typisk lavt potentiale og et højt niveau fra S4), og hvor
off-fokus-bidraget er for lille til at give en synlig procent.

## Løsningsforslag

### A: Stop nu: sluk `development_curve_b` (ejer-only flag-flip)
- **Gevinst:** reversibelt med det samme. Motoren falder tilbage til S4-modellen, der målt gav
  98,6 % bevæget hovedevne. Kurve B er fail-safe bygget, så off = bit-identisk med før.
- **Pris:** alderens turbo vender tilbage (kurve B's formål, D-058). Help-teksten for kurve B
  (#7192, off/on-tvillinger) skifter automatisk tilbage. Spillervendt: udviklingstempoet bliver
  igen alders-styret.
- **Risiko:** lav. Flaget er læst pr. tick.

### B: Permanent rettelse: det bløde loft må aldrig fryse en trænet evne (kode + rekalibrering)
1. `developmentCurveB.ts` `curveBCapSoftness`: over det bløde loft giver den en lille fast
   restfart (fx et privat `aboveCeilingFloor`-param) i stedet for 0, op til det hårde
   `ability_caps`. Det svarer til "ingen mur" (S8) og "står stille aldrig for en fokus-evne".
   Alternativt måles det bløde loft fra rytterens niveau ved aktivering og ikke kun fra
   `cap × pc`.
2. Rekalibrér `potentialCeiling` med 10-sæsoners-simuleringen (`scripts/dev/tenSeasonSim6110.mjs`)
   mod den nuværende bestand. Gate: ≥ 95 % af fokus-ticks bevæger hovedevnen for alle
   potentialer.
3. Samme regel i løbsdagsstien (`dailyTraining.js:455-470`).
- **Filer:** `backend/lib/developmentCurveB.ts`, `backend/lib/dailyTraining.js`,
  `backend/lib/developmentCurveB.test.ts`, `docs/TRAINING_RULES.md` §2.1b, privat params-JSON
  (Railway env `DEVELOPMENT_CURVE_B_PARAMS`, ejer).
- **Risiko:** mellem. Det er en balance-ændring for hele ligaen og kræver ejer-godkendte tal
  (spillervendt: hvor hurtigt evner over det bløde loft vokser).

**Anbefaling: A nu, B bagefter.** A stopper skaden i aften og kræver kun ejerens go til ét
flag. B er den varige model og kræver ejer-godkendte tal fra simuleringen. Kurve B tændes igen
først når B's gate er grøn.

## Spillervendte tal der ændres

- A: dagens fremgang pr. evne (tilbage til S4-niveau, alders-styret). Ingen nye tal.
- B: fremgangen for evner over det bløde loft (fra 0 til en lille restfart), og det bløde loft
  pr. potentiale. Begge private params, ejer-godkendes.

## Testplan

1. Enhedstest (`developmentCurveB.test.ts`): `curveBBase` > 0 for `current` over det bløde loft
   og under `cap`. `= 0` kun ved `current >= cap`.
2. Regressionstest med Bart Lenaerts' fixture (punch 80/93, pot 4,5, vo2max_punch hard): punch
   får delta > 0. Sammen med Coppens (sprint 58/93, pot 3,5) og Roelofs (aggression 42/93, pot 3).
3. Off-tvilling: flag off = bit-identisk (eksisterende tests).
4. Efter deploy måles prod med SQL'en i §2 for den første dato: hovedevne bevæget ≥ 95 %, "kun
   andre evner" ≤ 1 %.

## Bagudrettet datareparation (kun forslag, ingen prod-skrivning)

Tabt fremgang: hovedevnen på ~14-16 % af managerholdenes træningsticks 26/10 → rettelsesdatoen
(~4.800 ticks 26-28/10 alene: 32.301 ticks × ~15 %). Mulighed: genberegn hovedevnens delta for de ramte ticks med S4-modellen
(rapportens `progress_before` + rytterens tilstand) og kreditér den som progress-bar
(ikke direkte point, så +1-loftet pr. dato respekteres). Det er en masse-skrivning til prod og
derfor ejer-gated ("atombombe"-reglen): dry-run-tal først, ejeren ser dem live, eksplicit go.
Alternativ: ingen reparation, kun en patch note der forklarer fejlen.
