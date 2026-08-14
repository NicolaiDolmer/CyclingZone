# #3741 trin 4+5: gates og loft-dry-run målt om på den base PR'en faktisk merges ind i

**Dato:** 2026-08-14 (målt af merge-vurderingssessionen) · **PR:** [#3741](https://github.com/NicolaiDolmer/CyclingZone/pull/3741) · **Issue:** #3709

Alt herunder er kørt på PR'en **rebaset på `origin/main`**, ikke på den base den blev bygget på.

## 1. Ankeret: rettelsen i spec §8.1 var målt mod en base der ikke findes længere

`rytterudviklingScorecard.js` kræver en `--baseline` der peger på "i dag"-modellen. Rettelsen i
§8.1 (27 → 30, 595 af 600 stiger) brugte worktreen `ref-3709-baseline`, som står på `d5477c67`.
**Trin 3 (håndværkstaget, `c2f5f26e`) er ikke i den commit.** Trin 3 er merget siden, så "i dag"
er blevet bedre, mens kandidaten står stille.

Samme script, samme seed (2026), samme n (1.200), to baselines:

| baseline | G2 ankeret | øvrige gates | exit |
|---|---|---|---|
| `d5477c67` (uden trin 3) | ✅ i dag 29 → kandidat 30 | alle grønne | 0 |
| `origin/main` (med trin 3) | ❌ **i dag 31 → kandidat 30** | alle grønne | **1** |

Rating ved 30 år mod nuværende main, median:

| model | spids | rotation | standard | forkert | spænd | bedste opnåelige |
|---|---:|---:|---:|---:|---:|---:|
| i dag | 30 | 30 | 30 | 29 | **1** | **31** |
| kandidat | 27 | 28 | 28 | 20 | **7** | **30** |
| negativ-test (`offFocusMult` 0,97) | 35 | 35 | 35 | 33 | 2 | 35 |

Fordelingen bag medianen (bedste opnåelige pr. rytter, 1.200 ryttere): **500 stiger, 153 uændret,
547 falder.** Median 0, p10 −5, p90 +3, min −13, maks +8. De ti højest ratede under dagens model
går 83, 83, 79, 74, 73 → 78, 70, 69, 66, 77.

**Forbehold:** "bedste opnåelige" er maks af fire faste strategier. Den nye model belønner netop
at vælge noget andet end de fire, så tallet kan undervurdere kandidaten i toppen. Det er ikke målt.

**Ejer-beslutning 14/8:** merge alligevel. Prisen (1 ratingpoint i median) er accepteret mod at
manager-spændet går fra 1 til 7. Beslutning 14 og 17 genåbnes ikke.

## 2. Lofterne: ingen mister noget

`buildCapsForRider` på hele `docs/snapshots/3591/riders_full.json` (8.717 ryttere), gamle mod nye
konstanter, uden at skrive:

- **8.649 får højere lofter, 68 uændret, 0 falder.**
- Loft-delta pr. evne: median +12, p90 +19, maks +25. `tactics` rører sig ikke (ingen type ejer
  den, så håndværkstaget fra trin 3 er allerede dens maksimum).
- Potentiel rating (opskriften anvendt på lofterne): median **46 → 60**. Pr. bånd: pot 1-2
  35 → 45 · pot 2,5-3 50 → 65 · pot 3,5-4,5 61 → 80 · pot 5-6 76 → 94.

## 3. Nyt fund: 99-klippet rammer toppen

Loftet clampes til [0, 99]. Med signatur-faktor 1,30 × `loftByPotential` overstiger potentiale
5 (80) og 6 (88) klippet. Målt på de 503 ryttere med potentiale ≥ 5:

| | i dag | efter |
|---|---:|---:|
| evne-pladser på 99 | 0 | **1.840** |
| ryttere med mindst én evne på 99 | 0 | **437** |

Taget holder altså op med at skelne spillets bedste talenter fra hinanden. Det gør ingen skade så
længe ingen når 42 % af sit tag, men det er samme rod som specens åbne **hul 5**, og det er trin 7
(potentiale = fart) der skal lukke det. Det er også en del af forklaringen på at pot 5-6 er det
eneste bånd der ikke vinder på ændringen.

## 4. To risici der blev afvist, ikke antaget

- **Omklassificering af ryttertyper.** `primary_type` udledes af `ability_caps`, så højere lofter
  kunne i princippet flytte typen. Målt over de samme 8.717: **0 primær-skift, 12 sekundær-skift
  (0,14 %)**, alle blandt de 606 der ikke har en brugbar `archetype_draw.secondary`. Forankringen
  fra #3570 holder.
- **Loft-båndets inverterbarhed (#1162).** `ceilingBandInversion.test.js` giver bit-identiske tal
  mod PR'en og mod main (median-fejl 0,417 ved spejder-overall 40, 92,6 % pinnes til ±1). Trin 4
  hverken forbedrer eller forværrer #3679.

## 5. Rollback findes, i modsætning til hvad NOW.md sagde

`ability_caps` er en ren funktion af potentiale, anlæg og nuværende evne, genberegnet hver tick og
kun skrevet når den flytter sig. En revert sætter derfor lofterne tilbage ved næste tick. De
evne-point rytterne nåede at vinde undervejs bliver stående, fordi gulvet er `max(tag, nuværende)`,
og ingen mister dermed noget ved hverken merge eller revert.

## 6. Fingeraftryk af lofterne FØR merge (live prod, 14/8, read-only)

Målt på `rider_derived_abilities.ability_caps` umiddelbart før merge, så effekten kan efterprøves
efter første tick i stedet for at bero på et scorecard:

| | før merge |
|---|---:|
| ryttere med lofter | 8.669 |
| evne-pladser i alt | 130.035 |
| gennemsnitligt loft | 32,32 |
| median-loft | 29,0 |
| pladser på 99 | **1** |
| sum af alle lofter | 4.203.154 |

Der er bevidst ikke taget et række-for-række-dump: `ability_caps` er en ren funktion af potentiale,
anlæg, alder og nuværende evne, så tilstanden kan genskabes fra koden alene, og
`docs/snapshots/3591/riders_full.json` (13/8) har i forvejen både evner og lofter pr. rytter.

## 7. Suite

`npm test --prefix backend`: **5.985 pass, 0 fail**, 1 `todo` (#3679, fejler identisk mod main).
