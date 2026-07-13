# Race v3 S5 — form-peaks + trænings-kobling: kalibrerings-audit

**Dato:** 2026-07-13 · **Issue:** [#2224](https://github.com/NicolaiDolmer/CyclingZone/issues/2224) (race-engine-dybde, slice S5)
**Spec:** [`race-engine-depth-credibility-design.md`](../superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md) §10/§12 + [`s5-peak-planner-cockpit-addendum.md`](../superpowers/specs/2026-07-13-s5-peak-planner-cockpit-addendum.md) §2/§6
**Harness:** `backend/scripts/simulatePeakCouplingDryRun.js` · **Oracles:** `backend/lib/raceDryRunOracles.js` (`evaluatePeakCouplingScorecard` + `evaluatePeakNeutralityOracle`)
**Population:** `scripts/baselines/population-snapshot-2026-07-11.json` (5.650 ægte prod-ryttere) · **Seeds:** 2026, 7, 42 · **Felt:** top-200-klatrere-elite, 60/løb

---

## 1. Hvad kalibreres

`peak_realiseret = PEAK_MAX × trainingQuality`, payback = `−PEAK_PAYBACK` i `PEAK_PAYBACK_DAYS` efter vinduet. `trainingQuality ∈ [PEAK_TQ_FLOOR, 1]` udledes af fire optakts-signaler over et `PEAK_LEADUP_DAYS`-vindue (`racePeaks.computeTrainingQuality`, vægte `PEAK_TQ_WEIGHTS`).

To klasser af parametre:

| Klasse | Parametre | Gates af |
|---|---|---|
| **Motor-magnitude** (balance-kritisk) | `PEAK_MAX`, `PEAK_PAYBACK` | koblings-scorecard + neutralitets-oracle mod ægte population (denne audit) |
| **Resolver-form** (signal→tq) | `PEAK_LEADUP_DAYS`, `PEAK_TQ_WEIGHTS`, `PEAK_TQ_FLOOR`, `PEAK_PAYBACK_DAYS` | resolver-enhedstests (`racePeaks.test.js` / `racePeakPlans.test.js`): monotoni pr. signal, perfekt→1, elendig→gulv, per-vindue-isolation |

Motor-magnituden er den ene der kan bryde spil-balancen (for stærk peak = dominans-læk; for svag = umærkbar), så den gates empirisk mod feltet. Resolver-formen er deterministisk matematik hvis monotoni + rand-opførsel er unit-bevist — så den er unit-gated (samme split som S4: incident-magnitude harness-gated, incident-matematik unit-gated).

## 2. Oracles (rene, i raceDryRunOracles.js)

**Koblings-scorecard** (addendum §6): i et kontesteret elite-bjergfelt varieres mål-rytterens tq:
1. `peak`-komponenten monotont ikke-aftagende i tq.
2. mål-løbs-placering ikke-stigende (bedre) når tq stiger.
3. payback tq-uafhængig (taper er et lån — betales fuldt uanset træning).
4. "on track" (tq=1) målbart bedre end "behind" (tq=gulv): top-margin ≥ **0.75** placeringer.

**Neutralitet** (§12.4): SAMME rytter under to modsatte planer (top for løb 1 vs top for løb 2) i de samme to bjergløb. Dagsform/jour-sans hashes på (rider_id, stage-seed) — ikke på planen — så counterfactualen ANNULLERER den støj; kun peaken varierer. Krav: hver plan dominerer kun sit EGET mål, og ingen plan dominerer begge løb (ellers lækker peaken uden for sit vindue).

## 3. PEAK_MAX-sweep (3 seeds × population, andre parametre = default)

| PEAK_MAX | top-margin (behind→on-track, placeringer) | koblings-brud | neutralitets-brud |
|---|---|---|---|
| 0.005 | 0.67 | **1** (margin < 0.75) | 0 |
| 0.010 | 1.33 | 0 | 0 |
| 0.015 | 3.00 | 0 | 0 |
| **0.020** ← valgt | **4.67** | **0** | **0** |
| 0.025 | 5.67 | 0 | 0 |
| 0.030 | 7.33 | 0 | 0 |

Oracle-passende bånd: **PEAK_MAX ≥ 0.010**. Neutraliteten holder på HELE intervallet (counterfactualen gør den strukturel — peaken flytter altid rytteren i den rigtige retning, uanset størrelse; kun magnituden afgør top-marginen).

**Valg: PEAK_MAX = 0.020** (spec §10's ejer-godkendte kandidat):
- Klar, mærkbar kobling: ~5 placeringers spænd (behind→on-track) for en midt-i-pakket elite-klatrer — koblingen er noget spilleren FØLER, ikke kun teknisk til stede (0.010/0.015 passerer men giver tynde 1-3 pladsers marginer).
- Proportional med dayform (sd 0.015, S2): peak (0.020) er en bevidst, en anelse stærkere løftestang end den anonyme dags-varians — spillerens VALG betyder mere end held, men ikke overvældende.
- Ikke højere (0.025/0.030): dér begynder peaken at overdøve dayform (nær-garanteret multi-plads-spring), hvilket udvander "din dag betyder stadig noget"-teksturen og skubber peaken mod at være den dominerende løftestang.

## 4. Øvrige parametre

- **PEAK_PAYBACK = 0.010** (spec §10-kandidat, halvdelen af peak): payback-komponenten er tq-uafhængig pr. konstruktion (`peakScoreComponent` bruger ingen tq i payback-grenen); harnessen bekræfter empirisk −0.01000 konstant på tværs af tq. Magnituden er ikke oracle-gated (payback er et bevidst "formhul"-lån, ikke en balance-knap); spec-kandidaten bevares.
- **PEAK_PAYBACK_DAYS = 7** (spec §10 "N dage efter", ~vindueslængde 5 + lidt): payback-vinduets længde. Ikke magnitude-gated; spec-kandidat.
- **PEAK_LEADUP_DAYS = 14** (NY konstant): optakts-vinduet FØR peak-vinduet hvorover trainingQuality måles — ~2 ugers build→taper-periodisering (standard i cykelsport). Resolver-form-parameter (unit-gated); den motor-koblende harness sætter tq direkte og eksercerer ikke leadup'en. Design-valg, ikke fittet.
- **PEAK_TQ_FLOOR = 0.20**: selv elendig optakt giver et lille løft (man MØDER stadig op udhvilet). Resolver-rand-opførsel unit-bevist (elendig optakt → præcis gulvet). Over 0 straffer dårlig træning mærkbart; ikke 0 fordi "sæt en peak" så bliver meningsløst ved lav tq.
- **PEAK_TQ_WEIGHTS = {consistency 0.35, focusMatch 0.25, health 0.25, fatigue 0.15}**: konsistens (at du mødte op og trænede) vægtes tungest, derefter fokus-match (trænede du det rigtige) + sundhed, så trætheds-styring ved taper. Strukturelle (ikke env). Monotoni pr. signal + assemblering unit-bevist.

## 5. Eksisterende bånd forbliver grønne

`npm run race:gate` (§12-scorecardet, 3 seeds) er **grøn** efter S5. Peaken er nul i sæson-sim'en (ingen rytter har en peak-plan der → `peakComponentForStage` returnerer 0 uden vinduer), så dominans/varians/type-integritets-båndene er upåvirkede. Flag-off (`race_engine_v3_scoring` off) bit-identisk: `raceEngineV3FlagOff.test.js` grøn; hele backend-suiten (3.372+) grøn.

## 6. Env-override-mønster (som S1/S2/S4)

Alle motor-magnitude- + resolver-form-konstanter kan overstyres uden kode-ændring:
`RACE_V3_PEAK_MAX` · `RACE_V3_PEAK_PAYBACK` · `RACE_V3_PEAK_PAYBACK_DAYS` · `RACE_V3_PEAK_TQ_FLOOR` · `RACE_V3_PEAK_LEADUP_DAYS`. Prod/CI sætter dem ALDRIG → tabellens defaults er de gældende.

## 7. Konklusion + næste skridt

Defaults (`PEAK_MAX=0.020`, `PEAK_PAYBACK=0.010`, `PEAK_PAYBACK_DAYS=7`, `PEAK_TQ_FLOOR=0.20`, `PEAK_LEADUP_DAYS=14`, `PEAK_TQ_WEIGHTS` som ovenfor) består alle S5-oracles mod den ægte population på 3 seeds, og bevarer §12-båndene + flag-off-determinismen. **Ship-gaten er harness-baseret — men afventer EJER-GO** (jf. memory: efter kalibrering, ejer-go før harness-baseret ship). Resterende S5-slices (byggerækkefølge §7): API (CRUD peak-plans) → Planner-side (React-cockpit). Motoren + koblingen er klar bag `race_engine_v3_scoring`.
