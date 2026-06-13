# Akademi-økonomi Scorecard — 2026-06-13

Sim for **akademi-MVP** (#1308): solvens, youth-multiplikator-uplift og
progression-peak for et fuldt akademi (8 slots) over 10 simulerede sæsoner.

> **SYNTHETIC** — akademi-flaget er OFF. Ingen DB-adgang krævet.
> Alle beløb er sim-startpunkter — ejer godkender før flag-flip.

## Input-konstanter (fra `backend/lib/academyFlag.js` + `economyConstants.js`)

| Konstant | Værdi | Kilde |
|----------|-------|-------|
| `ACADEMY.SLOTS` | 8 | academyFlag.js |
| `ACADEMY.DRIFT_PER_SEASON` | 15.000 CZ$ | academyFlag.js (SIM-STARTPUNKT) |
| `ACADEMY.SIGNING_FEE_RATE` | 25% af market_value | academyFlag.js (SIM-STARTPUNKT) |
| `ACADEMY.SALARY_RATE` | 10% af market_value | academyFlag.js |
| `ACADEMY.YOUTH_MULT` | 1.5 (aftagende mod 1.0 ved 22) | academyFlag.js |
| `ACADEMY.CONTRACT_LENGTH` | 3 sæsoner | academyFlag.js |
| Repr. ungdomsrytter market_value | 11.312 CZ$ | Antaget midterste bånd (16-21) |
| `SPONSOR_INCOME_BASE` | 240.000 CZ$ | economyConstants.js |
| `INITIAL_BALANCE` | 800.000 CZ$ | economyConstants.js |
| Debt-ceiling D1/D2/D3 | 1.200.000 / 900.000 / 600.000 CZ$ | economyConstants.js |
| Nye signeringer/sæson (repr.) | 2 | CONTRACT_LENGTH=3 → ~2 fornys/sæson |
| Sim-sæsoner (solvens) | 10 | — |
| Ungdomskohort-størrelse (peak) | 300 | seed=1308 |

## Metrik 1: Akademi-solvens pr. division

**Akademi-omkostninger pr. sæson** (alle divisioner ens — akademiet er delt konstant):

| Post | Beløb |
|------|-------|
| Drift (8 × 15.000) | 120.000 CZ$ |
| Signing-fee (2 × 25% × 11.312) | 5.656 CZ$ |
| Akademi-lønninger (8 × 10% × 11.312) | 9.049,6 CZ$ |
| **Total akademi-cost/sæson** | **134.705,6 CZ$** |
| Over 10 sæsoner (kumulativt) | 1.347.056 CZ$ |

**Gate A:** Akademiets omkostninger alene forårsager IKKE debt-ceiling-overskridelse
(base-hold OK ≥ -ceiling, med-akademi-hold krydser ceiling = FAIL).
**Gate B:** Akademi-cost pr. sæson < samlet indkomst (sponsor + præmier).
  → Afgørende affordability-gate: akademiet må ikke koste mere end holdet tjener.
**Gate C:** S1 balance med akademi > 0 (holdet er ikke straks insolvent).

> **Vigtig kontekst:** D1/D2-holdene har ALLEREDE et designet underskud i base-økonomi
> (sponsor 240k < senior-løn). Akademiet er et tillæg ovenpå. Gate A + B + C måler
> om akademiet er BÆREDYGTIGT som et separat lag, ikke om holdet samlet set er
> likvid i alle 10 sæsoner (det er et bredere økonomi-design-spørgsmål).

| Division | Total indkomst/sæs. | Akad. cost/sæs. | Afford. (<100% indkomst) | S1 base-bal. | S1 m. akademi | Gate A | Gate C | **RESULTAT** |
|----------|--------------------|-----------------|--------------------------|--------------|--------------:|:------:|:------:|:------------:|
| D1 | 400.000 | 134.705,6 | ✅ 34% af indkomst | 50.000 | -84.705,6 | ✅ | ❌ | **❌ FAIL** |
| D2 | 310.000 | 134.705,6 | ✅ 43% af indkomst | 460.000 | 325.294,4 | ❌ | ✅ | **❌ FAIL** |
| D3 | 265.000 | 134.705,6 | ✅ 51% af indkomst | 755.000 | 620.294,4 | ❌ | ✅ | **❌ FAIL** |

### D3 sæsonvis saldo — med vs. uden akademi

| Sæson | Base net | Med-akad. net | Balance (base) | Balance (m. akad.) | Akad. forårs. ceiling-kryds? |
|------:|---------:|--------------:|---------------:|-------------------:|:----------------------------:|
| 1 | -45.000 | -179.705,6 | 755.000 | 620.294,4 | — |
| 2 | -45.000 | -179.705,6 | 710.000 | 440.588,8 | — |
| 3 | -45.000 | -179.705,6 | 665.000 | 260.883,2 | — |
| 4 | -45.000 | -179.705,6 | 620.000 | 81.177,6 | — |
| 5 | -45.000 | -179.705,6 | 575.000 | -98.528 | — |
| 6 | -45.000 | -179.705,6 | 530.000 | -278.233,6 | — |
| 7 | -45.000 | -179.705,6 | 485.000 | -457.939,2 | — |
| 8 | -45.000 | -179.705,6 | 440.000 | -637.644,8 | JA ❌ |
| 9 | -45.000 | -179.705,6 | 395.000 | -817.350,4 | JA ❌ |
| 10 | -45.000 | -179.705,6 | 350.000 | -997.056 | JA ❌ |

> **D3 kontekst:** Sponsor (240.000) + præmier (25.000) − senior-løn (310.000) = base-net -45.000/sæs.
> Akademi tilføjer −134.705,6 CZ$/sæs. mere. Debt-ceiling for D3: 600.000 CZ$.

## Metrik 2: Youth-multiplikator uplift

**Benchmark:** alder 17, evne 'endurance', current=50, cap=80, 28 dage, normal intensitet, ingen bonus, noise=1.0.

**youthMultiplier(17)** = **1.4167** (fra academyFlag.js: lineær aftagning fra 1.5 ved 16 mod 1.0 ved 22)

| | Sæson-gain (ability-point, kumulativ) |
|--|---|
| Med youthMultiplier (age 17) | 14.7635 |
| Uden youthMultiplier (baseline mult=1.0) | 10.4213 |
| **Uplift** | **41.7%** |

**Target:** 20% ≤ uplift < 100%

**Resultat:** 41.7% → **PASS** ✅

## Metrik 3: Progression peak-alder

**Kohort:** 33 ungdomsryttere (startAlder 16-21), seed=1308, 12 sæsoner.
**Metode:** Samme som `previewDailyTraining.js` — ÆGTE `dailyAbilityDelta` + `youthMultiplier` fra de shippede libs.

| Statistik | Alder |
|-----------|-------|
| Median peak-alder | **27** |
| P25 | 26 |
| P75 | 28 |
| Min | 24 |
| Max | 28 |

**Target:** median peak-alder ∈ {27, 28} (spec 5.2)

**Resultat:** median 27 → **PASS** ✅

## Scoreboard

| ID | Metrik | Mål | Faktisk | Resultat |
|----|--------|-----|---------|:--------:|
| SOL-D1 | Solvens D1: akad. cost < indkomst + S1 > 0 + ingen ceiling-kryds | <100% indkomst + S1 > 0 | afford. 34% af indkomst; S1 bal. -84.705,6 (neg.!); ceiling-kryds: nej | **FAIL** ❌ |
| SOL-D2 | Solvens D2: akad. cost < indkomst + S1 > 0 + ingen ceiling-kryds | <100% indkomst + S1 > 0 | afford. 43% af indkomst; S1 bal. 325.294,4; ceiling-kryds: JA | **FAIL** ❌ |
| SOL-D3 | Solvens D3: akad. cost < indkomst + S1 > 0 + ingen ceiling-kryds | <100% indkomst + S1 > 0 | afford. 51% af indkomst; S1 bal. 620.294,4; ceiling-kryds: JA | **FAIL** ❌ |
| UPLIFT | Youth-multiplikator uplift alder 17 | 20%–99% | 41.7% | **PASS** ✅ |
| PEAK | Progression median peak-alder | 27–28 | 27 | **PASS** ✅ |

**Samlet: ❌ MINDST ÉT FAIL**

## RECOMMENDATION

Ejer beslutter — sim leverer tal, ikke beslutninger. Nedenfor er ærlige fund:

### DRIFT_PER_SEASON = 15.000 CZ$

Akademi-cost: **134.705,6 CZ$/sæs.** (drift 120.000 + signing 5.656 + lønner 9.049,6).

**✅** Akademi-cost er under total indkomst for alle divisioner.

**D3-specifikt:** D3 har S1-balance 620.294,4 (positiv) og affordability 51%. Se D3-tabellen ovenfor.

### SIGNING_FEE_RATE = 25%

Signing-fee bidrager 5.656 CZ$/sæson (2 nye ryttere × 25% × 11.312 CZ$).
Dette er 4.2% af de samlede akademi-omkostninger.
**Vurdering:** Rimeligt — signing-fee er en engangsbetaling pr. ny rytter; 25% af en ungdomsværdi er acceptabelt.
Hvis ungdomsryttere bevisst sættes lavere (fx market_value ~80.000 CZ$), er signing-fee kun 40.000 CZ$/sæson.

### YOUTH_MULT = 1.5

**✅** Youth-multiplikatoren giver 41.7% uplift for en 17-årig — inden for målet (20%–99%).
YOUTH_MULT=1.5 er et fornuftigt startpunkt. Peaker stadig ved 27 → ungdomstræning accelererer tidlig vækst UDEN at skubbe peak senere.

### Samlet vurdering

**Mindst ét mål er FAIL.** Ejer bør gennemgå de røde rækker ovenfor
og beslutte om konstanterne justeres, eller om acceptkriterierne revurderes.

---

*Genereret af `backend/scripts/academyEconomySimulation.js` — #1308 akademi-MVP balance-sim.*
