# Akademi-├©konomi Scorecard ÔÇö 2026-06-13

Sim for **akademi-MVP** (#1308): solvens, youth-multiplikator-uplift og
progression-peak for et fuldt akademi (8 slots) over 10 simulerede s├ªsoner.

> **SYNTHETIC** ÔÇö akademi-flaget er OFF. Ingen DB-adgang kr├ªvet.
> Alle bel├©b er sim-startpunkter ÔÇö ejer godkender f├©r flag-flip.

## Input-konstanter (fra `backend/lib/academyFlag.js` + `economyConstants.js`)

| Konstant | V├ªrdi | Kilde |
|----------|-------|-------|
| `ACADEMY.SLOTS` | 8 | academyFlag.js |
| `ACADEMY.DRIFT_PER_SEASON` | 15.000 CZ$ | academyFlag.js (SIM-STARTPUNKT) |
| `ACADEMY.SIGNING_FEE_RATE` | 25% af market_value | academyFlag.js (SIM-STARTPUNKT) |
| `ACADEMY.SALARY_RATE` | 10% af market_value | academyFlag.js |
| `ACADEMY.YOUTH_MULT` | 1.5 (aftagende mod 1.0 ved 22) | academyFlag.js |
| `ACADEMY.CONTRACT_LENGTH` | 3 s├ªsoner | academyFlag.js |
| Repr. ungdomsrytter market_value | 160.000 CZ$ | Antaget midterste b├Ñnd (16-21) |
| `SPONSOR_INCOME_BASE` | 240.000 CZ$ | economyConstants.js |
| `INITIAL_BALANCE` | 800.000 CZ$ | economyConstants.js |
| Debt-ceiling D1/D2/D3 | 1.200.000 / 900.000 / 600.000 CZ$ | economyConstants.js |
| Nye signeringer/s├ªson (repr.) | 2 | CONTRACT_LENGTH=3 ÔåÆ ~2 fornys/s├ªson |
| Sim-s├ªsoner (solvens) | 10 | ÔÇö |
| Ungdomskohort-st├©rrelse (peak) | 300 | seed=1308 |

## Metrik 1: Akademi-solvens pr. division

**Akademi-omkostninger pr. s├ªson** (alle divisioner ens ÔÇö akademiet er delt konstant):

| Post | Bel├©b |
|------|-------|
| Drift (8 ├ù 15.000) | 120.000 CZ$ |
| Signing-fee (2 ├ù 25% ├ù 160.000) | 80.000 CZ$ |
| Akademi-l├©nninger (8 ├ù 10% ├ù 160.000) | 128.000 CZ$ |
| **Total akademi-cost/s├ªson** | **328.000 CZ$** |
| Over 10 s├ªsoner (kumulativt) | 3.280.000 CZ$ |

**Gate A:** Akademiets omkostninger alene for├Ñrsager IKKE debt-ceiling-overskridelse
(base-hold OK ÔëÑ -ceiling, med-akademi-hold krydser ceiling = FAIL).
**Gate B:** Akademi-cost pr. s├ªson < samlet indkomst (sponsor + pr├ªmier).
  ÔåÆ Afg├©rende affordability-gate: akademiet m├Ñ ikke koste mere end holdet tjener.
**Gate C:** S1 balance med akademi > 0 (holdet er ikke straks insolvent).

> **Vigtig kontekst:** D1/D2-holdene har ALLEREDE et designet underskud i base-├©konomi
> (sponsor 240k < senior-l├©n). Akademiet er et till├ªg ovenp├Ñ. Gate A + B + C m├Ñler
> om akademiet er B├åREDYGTIGT som et separat lag, ikke om holdet samlet set er
> likvid i alle 10 s├ªsoner (det er et bredere ├©konomi-design-sp├©rgsm├Ñl).

| Division | Total indkomst/s├ªs. | Akad. cost/s├ªs. | Afford. (<100% indkomst) | S1 base-bal. | S1 m. akademi | Gate A | Gate C | **RESULTAT** |
|----------|--------------------|-----------------|--------------------------|--------------|--------------:|:------:|:------:|:------------:|
| D1 | 400.000 | 328.000 | Ô£à 82% af indkomst | 50.000 | -278.000 | ÔØî | ÔØî | **ÔØî FAIL** |
| D2 | 310.000 | 328.000 | ÔØî 106% af indkomst | 460.000 | 132.000 | ÔØî | Ô£à | **ÔØî FAIL** |
| D3 | 265.000 | 328.000 | ÔØî 124% af indkomst | 755.000 | 427.000 | ÔØî | Ô£à | **ÔØî FAIL** |

### D3 s├ªsonvis saldo ÔÇö med vs. uden akademi

| S├ªson | Base net | Med-akad. net | Balance (base) | Balance (m. akad.) | Akad. for├Ñrs. ceiling-kryds? |
|------:|---------:|--------------:|---------------:|-------------------:|:----------------------------:|
| 1 | -45.000 | -373.000 | 755.000 | 427.000 | ÔÇö |
| 2 | -45.000 | -373.000 | 710.000 | 54.000 | ÔÇö |
| 3 | -45.000 | -373.000 | 665.000 | -319.000 | ÔÇö |
| 4 | -45.000 | -373.000 | 620.000 | -692.000 | JA ÔØî |
| 5 | -45.000 | -373.000 | 575.000 | -1.065.000 | JA ÔØî |
| 6 | -45.000 | -373.000 | 530.000 | -1.438.000 | JA ÔØî |
| 7 | -45.000 | -373.000 | 485.000 | -1.811.000 | JA ÔØî |
| 8 | -45.000 | -373.000 | 440.000 | -2.184.000 | JA ÔØî |
| 9 | -45.000 | -373.000 | 395.000 | -2.557.000 | JA ÔØî |
| 10 | -45.000 | -373.000 | 350.000 | -2.930.000 | JA ÔØî |

> **D3 kontekst:** Sponsor (240.000) + pr├ªmier (25.000) ÔêÆ senior-l├©n (310.000) = base-net -45.000/s├ªs.
> Akademi tilf├©jer ÔêÆ328.000 CZ$/s├ªs. mere. Debt-ceiling for D3: 600.000 CZ$.

## Metrik 2: Youth-multiplikator uplift

**Benchmark:** alder 17, evne 'endurance', current=50, cap=80, 28 dage, normal intensitet, ingen bonus, noise=1.0.

**youthMultiplier(17)** = **1.4167** (fra academyFlag.js: line├ªr aftagning fra 1.5 ved 16 mod 1.0 ved 22)

| | S├ªson-gain (ability-point, kumulativ) |
|--|---|
| Med youthMultiplier (age 17) | 14.7635 |
| Uden youthMultiplier (baseline mult=1.0) | 10.4213 |
| **Uplift** | **41.7%** |

**Target:** 20% Ôëñ uplift < 100%

**Resultat:** 41.7% ÔåÆ **PASS** Ô£à

## Metrik 3: Progression peak-alder

**Kohort:** 33 ungdomsryttere (startAlder 16-21), seed=1308, 12 s├ªsoner.
**Metode:** Samme som `previewDailyTraining.js` ÔÇö ├åGTE `dailyAbilityDelta` + `youthMultiplier` fra de shippede libs.

| Statistik | Alder |
|-----------|-------|
| Median peak-alder | **27** |
| P25 | 26 |
| P75 | 28 |
| Min | 24 |
| Max | 28 |

**Target:** median peak-alder Ôêê {27, 28} (spec 5.2)

**Resultat:** median 27 ÔåÆ **PASS** Ô£à

## Scoreboard

| ID | Metrik | M├Ñl | Faktisk | Resultat |
|----|--------|-----|---------|:--------:|
| SOL-D1 | Solvens D1: akad. cost < indkomst + S1 > 0 + ingen ceiling-kryds | <100% indkomst + S1 > 0 | afford. 82% af indkomst; S1 bal. -278.000 (neg.!); ceiling-kryds: JA | **FAIL** ÔØî |
| SOL-D2 | Solvens D2: akad. cost < indkomst + S1 > 0 + ingen ceiling-kryds | <100% indkomst + S1 > 0 | afford. 106% af indkomst OVER 100%!; S1 bal. 132.000; ceiling-kryds: JA | **FAIL** ÔØî |
| SOL-D3 | Solvens D3: akad. cost < indkomst + S1 > 0 + ingen ceiling-kryds | <100% indkomst + S1 > 0 | afford. 124% af indkomst OVER 100%!; S1 bal. 427.000; ceiling-kryds: JA | **FAIL** ÔØî |
| UPLIFT | Youth-multiplikator uplift alder 17 | 20%ÔÇô99% | 41.7% | **PASS** Ô£à |
| PEAK | Progression median peak-alder | 27ÔÇô28 | 27 | **PASS** Ô£à |

**Samlet: ÔØî MINDST ├ëT FAIL**

## RECOMMENDATION

Ejer beslutter ÔÇö sim leverer tal, ikke beslutninger. Nedenfor er ├ªrlige fund:

### DRIFT_PER_SEASON = 15.000 CZ$

Akademi-cost: **328.000 CZ$/s├ªs.** (drift 120.000 + signing 80.000 + l├©nner 128.000).

**ÔØî PROBLEM:** Akademi-cost (328.000) overstiger D1's totale indkomst (400.000) ÔÇö akademiets l├©nsum og signing-fee er for h├©j relativt til indkomsten.

Kontekst: Senior-l├©n for D1 (1.150.000) er allerede et problem for basis-solvens.
Akademiet er et yderligere lag. Problemet er strukturelt: DRIFT_PER_SEASON=15k er OK i sig selv,
men SALARY_RATE ├ù YOUTH_MARKET_VALUE_REP ├ù SLOTS giver 128.000/s├ªs. i akademi-l├©nninger alene.

**Mulige justeringer (ejer v├ªlger ├®t eller flere):**
- Reducer YOUTH_MARKET_VALUE_REP-antagelsen (fx til 80.000 CZ$) ÔåÆ akademi-l├©n = 64.000 + signing = 40.000 ÔåÆ total 224.000 CZ$/s├ªs.
- Reducer SALARY_RATE (fx til 0.05 i stedet for 0.10) ÔåÆ akademi-l├©n = 64.000 CZ$/s├ªs.
- Reducer SLOTS (fx til 4) ÔåÆ drift = 60.000, l├©n = 64.000 CZ$/s├ªs.
- Reducer SIGNING_FEE_RATE (fx til 0.10) ÔåÆ signing = 32.000 CZ$/s├ªs.

**D3-specifikt:** D3 har S1-balance 427.000 (positiv) og affordability 124%. Se D3-tabellen ovenfor.

### SIGNING_FEE_RATE = 25%

Signing-fee bidrager 80.000 CZ$/s├ªson (2 nye ryttere ├ù 25% ├ù 160.000 CZ$).
Dette er 24.4% af de samlede akademi-omkostninger.
**Vurdering:** Rimeligt ÔÇö signing-fee er en engangsbetaling pr. ny rytter; 25% af en ungdomsv├ªrdi er acceptabelt.
Hvis ungdomsryttere bevisst s├ªttes lavere (fx market_value ~80.000 CZ$), er signing-fee kun 40.000 CZ$/s├ªson.

### YOUTH_MULT = 1.5

**Ô£à** Youth-multiplikatoren giver 41.7% uplift for en 17-├Ñrig ÔÇö inden for m├Ñlet (20%ÔÇô99%).
YOUTH_MULT=1.5 er et fornuftigt startpunkt. Peaker stadig ved 27 ÔåÆ ungdomstr├ªning accelererer tidlig v├ªkst UDEN at skubbe peak senere.

### Samlet vurdering

**Mindst ├®t m├Ñl er FAIL.** Ejer b├©r gennemg├Ñ de r├©de r├ªkker ovenfor
og beslutte om konstanterne justeres, eller om acceptkriterierne revurderes.

---

*Genereret af `backend/scripts/academyEconomySimulation.js` ÔÇö #1308 akademi-MVP balance-sim.*
