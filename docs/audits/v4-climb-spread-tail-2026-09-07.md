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

<!-- målinger tilføjes løbende nedenfor -->
