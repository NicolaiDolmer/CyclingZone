# Hul 7: staff-stien verificeret mod ægte profiler

**#3709 · 2026-08-15 · lukket**

Specens §4 hul 7: *"Staff-stien uverificeret. `facilityTrainingMultiplier` målt til
maks +8,3 % ved tier 5; `staffTrainingBonus` gav 1,0 mod en syntetisk profil,
hvilket lige så godt kan være forkert input. Verificér mod en ægte profil."*

**Begge tal var forkerte, og i hver sin retning.** Effekten er større end antaget.

## Hvorfor den 1,0 ikke måtte stå uimodsagt

`staffTrainingBonus` returnerer 1,0 ad **fire** forskellige veje: ingen chef ·
ingen trænings-facilitet · ukendt dimension · ingen specialiserings-fordel. Tre af
dem betyder *"du gav mig noget jeg ikke kunne læse"*, og de siger det ikke. En
syntetisk profil med forkerte nøgler rammer dem alle og ser ud som et resultat.

Det er præcis mistanken specen selv rejste, og den var berettiget.

## Metode

61 aktive trænings-chefer hentet **read-only fra prod** 15/8, sammen med deres
holds trænings-facilitets-tier. Anonymiseret fixture (kun tiers og afledte evner,
ingen navne eller hold-id'er): `backend/scripts/fixtures/staff-training-profiles-2026-08-15.json`.
Kørt med `backend/scripts/verificerStaffStien3709.mjs`.

## 0. Læser koden overhovedet profilens akser?

Kontrollen specen manglede, og den der afgør alt andet.

| | i profilerne | koden slår op i |
|---|---|---|
| dimensioner | mental, physical, technical | mental, physical, technical ✅ |
| niveauer | u23, senior | u23, senior ✅ |

Akserne matcher. Den 1,0 var altså ikke en egenskab ved modellen.

## 1. `staffTrainingBonus` (specialisering, pr. rytter-evne)

1.830 opslag: 61 chefer × 2 niveauer × 15 evner.

| | effekt |
|---|---|
| median | **+4,73 %** |
| max | **+20,00 %** |
| præcis 1,0 (ingen effekt) | 535 af 1.830 (29,2 %) |
| u23 median / max | +5,31 % / +20,00 % |
| senior median / max | +3,47 % / +20,00 % |

De 29,2 % nul-effekt er **ved design**, ikke en fejl: modellen straffer aldrig
(`max(0, match − 1)`), så en chef der ikke passer til evnen eller niveauet giver
præcis 1,0 i stedet for at trække ned.

Bemærk at u23 ligger over senior. De ægte profiler har systematisk højere
`u23`-niveau end `senior` — chefer i spillet er i praksis ungdomstrænere.

## 2. `facilityTrainingMultiplier` (magnitude, hele truppen)

| | effekt |
|---|---|
| median | **+7,61 %** |
| max | **+15,75 %** |

**Specen sagde maks +8,3 % ved tier 5. Det målte maksimum er +15,75 %, altså
næsten dobbelt.** Forklaringen ligger i `effectiveBonus`:

```
FACILITY_BASE_EFFECT.training[tier] × staffEffectFactor(staff)
```

De +8,3 % er *basis-leddet alene* ved tier 5. Med en stærk chef er
`staffEffectFactor` større end 1, og produktet går derover. Specen målte den ene
faktor og læste den som produktet.

## 3. Den samlede effekt motoren faktisk ganger ind

`dailyAbilityDelta` ganger **begge** led ind, så det er dette tal der betyder noget:

| | effekt |
|---|---|
| min | +2,06 % |
| median | **+12,92 %** |
| max | **+38,90 %** |

Bedste enkelt-tilfælde: facilitet tier 5, chef tier 5, overall 90, `descending`,
u23-rytter.

**Staff-stien er ikke en afrundingsfejl.** Et fuldt udbygget hold træner op mod
39 % hurtigere på den rigtige evne end et hold uden noget.

## Hvem det rammer

| | antal |
|---|---:|
| hold med facilitet eller træner | **79** af 372 |
| ryttere på de hold | **1.932** af 6.878 |

Altså 21 % af hold-ejede ryttere. Resten kører på præcis 1,0 (nul regression).

## Betydning for #3709

**Ikke blokerende for trin 3, 4 eller 5.** Leddet er en multiplikator på den
daglige delta og er upåvirket af rolleklasserne; det ganger sig oven på raten uden
at ændre den. Cap-loopet klipper stadig ved `ability_caps`, så bonussen kan aldrig
udvide et loft.

Men den ændrer to ting vi bør skrive ned:

1. **Trin 4's rater kan ikke læses isoleret for de 21 %.** En signatur-evne med
   rate 0,45 hos et tier-5-hold vokser reelt som ~0,63 mod et hold uden noget.
   Flow-scorecardet kører bevidst uden staff (`staff: null, facilityTier: null`),
   så dets tal er **gulvet**, ikke gennemsnittet.

2. **#3743 har nu et kalibrerings-anker.** Ejer-kravet er at assistentens
   *valg* skal afhænge af trænerens evner. Vi ved nu at træneren allerede påvirker
   *farten* med median +12,9 % og op til +38,9 %. Den nye effekt skal kalibreres i
   forhold til det tal, ikke i et tomrum.
