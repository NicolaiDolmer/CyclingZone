# 2026-07-15 — Akademi-træning kvalt af sæson-loft sendt som `caps` (#2437)

## Symptom
Spillerklager: akademi-ryttere (16-21 år) udviklede sig næsten ikke midt i sæsonen, selv med masser af træningsdage tilbage. Issue-teksten diagnosticerede det som pulje-udtømning (sæson-budgettet opbrugt for tidligt).

## Rod-årsag
Diagnosen i issue-teksten var forkert. Den faktiske rod-årsag: #2202 lod `dailyTrainingEngine.js` sende sæson-loftet (`computeAcademySeasonCeiling`, indført #2082/#1938 som en nødbremse mod variabel sæsonlængde) som `caps` til `applyDailyTick` i stedet for rytterens livstidsloft (`ability_caps`). `dailyAbilityDelta`s dagsrate er proportional med `gap = cap − current` — når `cap` blev sæson-loftet i stedet for livstidsloftet, faldt gappet fra ~17,9 til ~2,0, og dagsraten kollapsede ~9x og aftog derefter eksponentielt resten af sæsonen. Sæson-budgettet var IKKE opbrugt (83% ubrugt i prod, verificeret via `careerCurveSimulation.js`) — det var uopnåeligt, fordi raten mod budgettet selv aftog for hurtigt til nogensinde at nå det.

## Fix (interim, MIDLERTIDIG jf. #2437)
Ejeren afviste retningen om at generalisere sæson-loftet (§3.2 i `docs/superpowers/specs/2026-07-11-training-youth-depth-design.md`, markeret forældet) og bad i stedet om: intet loft, bare en lav nok rate. Implementeret som `ACADEMY.INTERIM_RATE_MULT = 1/3`:
- `dailyTrainingEngine.js`: `tickCaps = caps` (livstidsloftet) for ALLE ryttere, intet sæson-loft.
- `academyRateMult: inAcademy ? ACADEMY.INTERIM_RATE_MULT : 1.0` sendes til `applyDailyTick`.
- `hardDailyCap` (#2082/#1938-sikkerhedsnettet) uændret.
- `season_budget_baseline`/`season_budget_season` skrives ikke længere (kolonnerne er ubrugte, kan droppes i en opfølgende migration — rørt ikke i denne PR).

Kalibreret mod ægte prod-population i `backend/scripts/careerCurveSimulation.js`, ejer-godkendt 15/7 mod den simulerede karrierekurve: akademi-rate 0,58 → 1,18 pt/dag/rytter, 22-års-spring 102 → 51 point.

## Læring
1. **Issue-tekstens diagnose var en hypotese, ikke en fakta** — "puljen er opbrugt" og "raten mod puljen aftager for hurtigt til at nå puljen" ser ens ud for spilleren (begge = "ingen fremgang"), men kræver modsatte fixes. Verificér mod koden + data (her: `gap`-beregningen i `dailyAbilityDelta` + faktisk sæson-budget-forbrug i prod) før du antager hvilken det er.
2. **En nødbremse (sæson-loft) der sendes som selve loftet, ikke som et loft-PÅ-loftet, ophæver ikke raten — den ERSTATTER den.** `computeAcademySeasonCeiling` var designet til at begrænse et resultat, men blev kaldt ind i det sted (`caps`-parameteren) der definerer selve vækstraten via gap-beregningen. Et sikkerhedsnet skal aldrig deles en variabel med den mekanisme det er ment at begrænse.
3. **Simulér mod ægte prod-population FØR en model vælges** (allerede en etableret regel, [[feedback_simulate_before_ship_balance]]) — `careerCurveSimulation.js` gav ejeren en faktisk karrierekurve at godkende i stedet for en beskrivelse, og afslørede samtidig at #2202-fixet var et rate-kollaps, ikke det issue-teksten påstod.
4. **To specs (`2026-06-11-kernesystemer-design.md` §5.1 og `2026-07-11-training-youth-depth-design.md` §3.2) modsagde hinanden** om retningen (daglig strøm vs. sæson-budget-generalisering) — forliget først efter denne hændelse. Læs eksisterende planer, men verificér de ikke modsiger hinanden, før du slicer efter dem.
