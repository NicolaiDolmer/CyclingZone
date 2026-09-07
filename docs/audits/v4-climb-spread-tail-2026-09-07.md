# v4-kalibrering: bjerg-spredning + højbjerg-hale (#4914, punkt 1)

**Målt 7/9 2026** mod den pinnede population (`backend/scripts/baselines/population-snapshot-2026-09-07.json`, 5.955 ryttere) og de pinnede proxy-etaper (`backend/scripts/baselines/v4-proxy-stages-2026-09-06.json`, 141 etaper), feltstørrelse 180, **5 seeds** (s1-s5). Ankertabellen i `docs/RACE_ENGINE_RULES.md` §7b er 3 seeds (s1-s3); denne fil kører 5, jf. §7 række 8 (gaten er seed-middel med spænd) og ejerbeslutningen 7/9 om at kalibrere punkt 1 på 5 seeds.

Kommandoer:

```
node backend/scripts/headToHeadV4.js --population=backend/scripts/baselines/population-snapshot-2026-09-07.json --stages=backend/scripts/baselines/v4-proxy-stages-2026-09-06.json --seeds=s1,s2,s3,s4,s5 --field-size=180
node backend/scripts/v4TailSpread.js --population=backend/scripts/baselines/population-snapshot-2026-09-07.json --stages=backend/scripts/baselines/v4-proxy-stages-2026-09-06.json --seeds=s1,s2,s3,s4,s5 --field-size=180 --gate
```

## Udgangspunkt (main, 5 seeds)

| Anker | Bånd | Middel (spænd) | Dom |
|---|---|---|---|
| Bjergetape top-10-spredning (topankomster) | 180-240 s | 125,7 s (102,2-147,5) | FAIL |
| Hale-p90, høj­bjerg | 6-12 % | 4,90 % (4,23-5,43) | FAIL |
| Hale-p90, bjerg | 6-12 % | 6,54 % (6,41-6,67) | PASS |
| Hale-p90, fladt | 0-2 % | 0,20 % (0,19-0,20) | PASS |
| Sprinter-vinderrate flat | ≥ 90 % | 96,0 % (91,4-100,0) | PASS |
| Nedkørsels-/summit-ratio | ≤ 0,5 | 0,417 (0,257-0,667) | PASS |
| Brostensevnens løft | ≥ 0,03 | 0,045 (0,008-0,112) | PASS |
| Felt-sammenhæng flade | 80-95 % | 30,8 % (29,3-32,0) | FAIL (punkt 2, ikke denne lane) |
| Felt-favoritters win-rate | 25-40 % | 56,0 % (53,2-60,3) | FAIL (punkt 3, ikke denne lane) |
| Punch-korrelation | > 0,2 | 0,823 (0,817-0,831) | PASS |
| ITT-korrelation | > 0,3 | 0,829 (0,812-0,841) | PASS |
| Descent attack-gevinst | 10-20 s | 20,0 (20,0-20,0) | PASS |
| Samme-hold-top-10 | < 3 % | 0,0 % | PASS |
| Bonussekunder bounded | ≤ 10 s | 10,0 | PASS |

**Læsning:** begge røde ankre i denne lane peger nu SAMME vej (mere spredning), i modsætning til billedet mod juli-populationen hvor de trak mod hinanden. Det rigtige felt er stærkere og tættere, så både fronten (top-10) og halen komprimeres.

## Knap-sweep (én knap ad gangen, 5 seeds, alt andet på main-værdier)

Begge knapper bor i `STRENGTH_SPEED_EXTRA_TUNING` (`backend/lib/engine/v4/tuning.ts`) og virker på hver sin gren af `groupStrengthSpeedFactor` (`segmentLoop.ts`).

| Indstilling | Bjerg top-10 (180-240 s) | Højbjerg-hale (6-12 %) | Bjerg-hale (6-12 %) | Nedkørsels-ratio (≤ 0,5) | Brosten-løft (≥ 0,03) |
|---|---|---|---|---|---|
| main (surplus 0,35 / deficit 1,8) | 125,7 FAIL | 4,90 FAIL | 6,54 PASS | 0,417 PASS | 0,045 PASS |
| surplus **0,60** | 197,5 PASS | 5,98 FAIL | 7,48 PASS | 0,455 PASS | 0,040 PASS |
| surplus **0,70** | 224,4 PASS | 6,41 PASS | 7,88 PASS | 0,495 PASS | 0,035 PASS |
| deficit **2,4** | 130,0 FAIL | 6,19 PASS | 8,82 PASS | 0,339 PASS | 0,055 PASS |
| surplus 0,60 + deficit 2,4 | 198,0 PASS | 7,33 PASS | 9,71 PASS | 0,467 PASS | 0,042 PASS |
| **surplus 0,55 + deficit 2,6 (valgt)** | **195,5 PASS** | **7,65 PASS** | **10,19 PASS** | **0,402 PASS** | **0,044 PASS** |

**Aflæsning:** de to grene er reelt uafhængige håndtag. Overskuds-grenen (`surplusWeight`) flytter kun FRONTEN (top-10 126 → 224 s uden nævneværdig hale-effekt), underskuds-grenen (`deficitWeight`) flytter kun HALEN (4,90 → 6,19 % uden top-10-effekt). At nå begge bånd med surplus alene (0,70) virker, men brænder marginen på både nedkørsels-ankeret (0,495 mod loft 0,50) og brostens-ankeret (0,035 mod gulv 0,03). Den valgte kombination rammer begge bånd OG forbedrer nedkørsels-ratioen i forhold til main.

## Efter (valgt indstilling: surplusWeight 0,55 · deficitWeight 2,6)

**5 seeds (s1-s5):**

| Anker | Bånd | Før | Efter | Dom |
|---|---|---|---|---|
| Bjergetape top-10-spredning | 180-240 s | 125,7 (102,2-147,5) FAIL | **195,5 (152,0-227,7)** | PASS |
| Hale-p90, højbjerg | 6-12 % | 4,90 (4,23-5,43) FAIL | **7,65 (6,67-8,25)** | PASS |
| Hale-p90, bjerg | 6-12 % | 6,54 (6,41-6,67) | 10,19 (9,88-10,60) | PASS |
| Hale-p90, fladt | 0-2 % | 0,20 | 0,20 | PASS |
| Sprinter-vinderrate flat | ≥ 90 % | 96,0 (91,4-100) | 95,4 (91,4-100) | PASS |
| Nedkørsels-/summit-ratio | ≤ 0,5 | 0,417 (0,257-0,667) | 0,402 (0,269-0,577) | PASS |
| Brostensevnens løft | ≥ 0,03 | 0,045 (0,008-0,112) | 0,044 (-0,032-0,119) | PASS |
| Felt-sammenhæng flade | 80-95 % | 30,8 | 28,9 | FAIL (uændret dom) |
| Felt-favoritters win-rate | 25-40 % | 56,0 | 52,3 | FAIL (uændret dom, tættere på båndet) |
| Punch-korrelation | > 0,2 | 0,823 | 0,831 | PASS |
| ITT-korrelation | > 0,3 | 0,829 | 0,835 | PASS |
| Descent attack-gevinst | 10-20 s | 20,0 | 20,0 | PASS |
| Samme-hold-top-10 | < 3 % | 0,0 | 0,0 | PASS |
| Bonussekunder bounded | ≤ 10 s | 10,0 | 10,0 | PASS |

**3 seeds (s1-s3 — §7b's egne gate-seeds):** bjerg-top-10 **208,9 s (198,8-227,7)** PASS — alle tre seeds inde i båndet, mod 132 s (121-148) FAIL i §7b. Hale-gaten: højbjerg 7,99 % (7,73-8,25) PASS, bjerg 10,15 % (9,88-10,60) PASS, fladt 0,20 % PASS → `v4TailSpread.js --gate` exit 0.

Ingen anker gik PASS → FAIL på middelværdien. De to røde ankre der forbliver røde (felt-sammenhæng på fladt, felt-favoritters win-rate) hørte til punkt 2 og 3 i kalibreringspakken og havde egne rod-årsager. **Rettet (CodeRabbit-fund, #4975):** felt-sammenhæng-fejlen skyldtes ikke `finale.ts`' placerings-tiers, men at jagt-modellen ikke talte feltets antal med; #4975 rettede den. Punkt 3 var M16-holdspils-gabet, jf. #4988.

## Bivirkninger værd at kende

- **M15 (tidsgrænsen) bider mere.** OTL-andelen pr. etapetype går fra 0-0,8 % til 0-1,9 %, og grupetto-redningen fyrer nu på 19 kuperede og 19 rullende etaper (0 før). Det er den forventede konsekvens af en længere hale og ligger inden for ejer-rammen "mærkbart, aldrig en massakre" (§9 række 5).
- **`rolling` har den højeste OTL-andel (1,9 %) — højere end bjerg (0,3 %).** Det er en skævhed i `timeLimitExtra.factorByProfileType` (rullende 0,06 mod bjerg 0,15), ikke i fart-modellen; faktorerne er stadig markeret STARTGAET. Rapporteres, ikke rettet her.
- **Brostens-ankerets spænd rører nul på et enkelt seed** (min -0,032 mod middel 0,044). Middelværdien er gaten (§7 række 8), men marginen på enkelt-seeds er tynd — samme billede som på main (min 0,008).
