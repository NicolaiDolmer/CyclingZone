# Værdimodel v4 — shadow-scorecard + fund (slice 1, #2428)

- **Dato:** 2026-07-13
- **Status:** SHADOW leveret, **7/7 gates grønne**. Ejer-review + tuning FØR cutover (slice 2). Ingen økonomi-ændring, ingen migration.
- **Spec:** [superpowers/specs/2026-07-13-rider-valuation-v4-production-value-design.md](../superpowers/specs/2026-07-13-rider-valuation-v4-production-value-design.md)
- **Regenerér:** `cd backend && node scripts/simulateSeasonProduction.js --k=30 --free-agents && node scripts/fitRiderValuationV4.js && node scripts/valuationV4Scorecard.js --out=<sti>` (READ-ONLY mod prod).
- **Model:** `backend/lib/riderValuationModelV4.json` · sim_run_id `75507b50` · K=30 · discount=0,80 · alpha=1,0 · soft-cap gamma=0,65.

## Gates (7/7 grønne)

| # | Gate | Type | Status | Detalje |
|--:|---|:--:|:--:|---|
| 1 | Type-økonomi-tabel | rapport | ✅ | 8 typer med sim-data (§2) |
| 2 | Skala-kontinuitet (median-drift ≤±15%) | hård | ✅ | median v3=6.658 → v4=6.334 · drift −4,9% |
| 3 | Udvikl-og-sælg P&L (net-positiv, ROI-begrænset) | hård | ✅ | prospect 857k→1.551k, cost 464k, profit +230k · ROI 17% ≤ 50% |
| 4 | Symmetri (trajectories) | rapport | ✅ | 3 arketyper (ung/peak/veteran) |
| 5 | Ingen runaway (total ≤×2 v3) | hård | ✅ | total v3=79,1M → v4=117,2M = **×1,48** |
| 6 | Anker-sanity (top ≥15M) | rapport | ✅ | ingen afvigelse fra ejer-anchor-rækkefølge |
| 7 | Determinisme (sim_run_id) | hård | ✅ | `75507b50` — reproducerbart |

## 1. Rejsen — to fund + to fixes gav en cutover-klar model

**Fund A — division-confounden + den svage beta-population.** De 15 liga-grupper (1/2/4/8-pyramide) er IKKE stratificeret efter styrke endnu (op/nedrykning #1152 afventer): hver division har median overall ~9-14, p90 ~22. Alle felter er lige svage. + De stærke ryttere (overall 40-72, alle 8 ryttere ≥15M-værdi) var **free agents** (usignerede) → ikke i den oprindelige teamed-only sim → v4 **ekstrapolerede** for dem.

**Fund B — runaway er en form-egenskab, ikke discount-tunbar.** Verificeret via sweep: skala-kalibreringen holder medianen fast, så lavere discount annulleres (runaway plateauede ~×2,6). Den tunge hale (få dominerende ryttere i den svage population) er det reelle problem.

**Fix 1 — free-agent-måling.** `--free-agents` inkluderer usignerede ryttere som virtuelle hold fordelt over divisionerne → produktionen MÅLES i stedet for at ekstrapoleres. Alene bragte det runaway ×3,21→×1,85 (måling < vild ekstrapolation) og grundede type-økonomien (gc n=2→35).

**Fix 2 — blødt top-loft.** `applySoftCap`: potens-kompression over p95-tærskel (gamma), bevarer rangorden, rører ikke medianen. Finjusterer halen.

## 2. Type-økonomi — målt E[produktion] (sim, m. free agents) vs v3-perception

| Type | n | Median E[prize] | p90 E[prize] | v3 troede (×mult) |
|---|--:|--:|--:|--:|
| gc | 35 | 74.093 | 456.905 | ×1,68 |
| puncheur | 19 | 57.660 | 264.548 | ×0,37 (v3: billigst!) |
| brostensrytter | 59 | 21.675 | 64.040 | ×1,22 |
| baroudeur | 34 | 6.903 | 48.855 | — |
| rouleur | 123 | 6.575 | 49.998 | ×0,58 |
| sprinter | 1.189 | 1.538 | 15.705 | ×2,34 (v3: dyrest!) |
| tt | 2.610 | 523 | 4.128 | ×0,95 |
| climber | 1.930 | 470 | 18.853 | ×0,66 |

**Inversion:** v3 (transfermarkeds-perception) tror sprintere er dyrest, puncheurs billigst. Spillets kalender siger det omvendte — kuperede/klassiker-etaper giver flere point end de få flade sprint-etaper. Nu grundet på ægte data (gc/puncheur vel-samplet via free agents). β_pt er degenereret: `prize = 75×point` eksakt, så point bærer intet selvstændigt signal.

## 3. Gamma-frontier — ejerens tuning-knap (målt 13/7)

Soft-cap-styrken afvejer runaway mod ungdoms-incitament. Fri til at tune ved cutover:

| gamma | runaway | dyreste rytter | ung-prospect ROI (4 sæs) |
|--:|--:|--:|--:|
| 0,40 | ×1,25 | 0,92M | −8% (tab) |
| 0,50 | ×1,31 | 1,34M | +2% |
| **0,65 (valgt)** | **×1,48** | **~2,0M** | **~17%** |
| 0,70 | ×1,46 | 2,88M | +23% |
| 0,85 | ×1,63 | 5,11M | +42% |
| 1,00 (fra) | ×1,85 | 9,05M | +63% (udvikl-og-sælg dominerer) |

0,65 valgt som balanceret default: sund ungdoms-ROI, kontrolleret runaway, fornuftig top-rytter. Ejeren tuner det endelige punkt.

## 4. Åbne ejer-valg før cutover (slice 2)

Alle gates er grønne, så modellen ER cutover-klar mekanisk. Tilbage er ren tuning/politik:
1. **Soft-cap gamma** (frontier §3) — hvor tung må halen være? Default 0,65.
2. **maxRoi** for udvikl-og-sælg (default 50%) — hvor profitabel må ungdomsudvikling være?
3. **Q1-Q3** (spec §8): β_pt (anbef. 0 — degenereret) · discount (styrer alders-symmetri, IKKE total — behold 0,80) · prize_earnings_bonus (anbef. drop).
4. Når tunet: re-fit + scorecard grønt → slice 2 (migration + `predictBaseValue`-swap, ejer merger).

Interaktiv v3-vs-v4-udforskning: **Admin → Økonomi → "Rytter-værdi v4"** (kræver admin-login).
