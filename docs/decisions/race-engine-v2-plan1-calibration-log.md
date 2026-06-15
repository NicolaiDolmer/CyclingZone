# Race-engine v2 — Plan 1 kalibrerings-log (#1122)

> **2026-06-15.** Plan: [`docs/superpowers/plans/2026-06-15-race-engine-v2-plan1-harness-and-engine-correctness.md`](../superpowers/plans/2026-06-15-race-engine-v2-plan1-harness-and-engine-correctness.md). Scope: måleinstrument (per-evne-liveness) + aktivering af 5 dødvægts-evner (aggression/flat/tempo/durability/descending). Backend-only, ingen migration.

## Hvad blev målt FØR (RØD baseline)

Det nye liveness-scorecard (dry-run sektion E + committet i `balance-baseline`) viste empirisk at 5 evner var **dødvægt** i motoren (⌀rank-gevinst = 0.00 ved +12 perturbation): `flat`, `tempo`, `aggression`, `durability`, `descending`. (`prolog` = 6. dødvægts-evne; udeladt — fjernes i Plan 2.)

## Endelige motor-konstanter (efter aktivering + re-fit)

- `NOISE_SD_SCALE = 0.16` (uændret — #1102-kalibrering bevaret).
- `DURABILITY_FATIGUE_DAMPING = 0.5` (durability 99 → halv trætheds-straf; 0 → fuld). Subtil seam; fuld styrke via cross-stage-fatigue #1021.
- `DESCENDING_FINALE_WEIGHT = 0.04` (descent-finale: descending centreret om 50; >50 vinder, <50 taber).
- `aggressionScore` læser nu `aggression`-evnen (fallback til proxy ved manglende data).

### `DEMAND_VECTORS` (raceStageProfileGenerator.js) — kandidat re-fittet til grøn gate

| Terræn | Vægte (sum 1.0) |
|---|---|
| flat | sprint 0.61 · acceleration 0.15 · **flat 0.06** · positioning 0.08 · endurance 0.02 · randomness 0.08 |
| rolling | endurance 0.18 · **flat 0.12** · punch 0.12 · **tempo 0.08** · positioning 0.08 · sprint 0.08 · tactics 0.06 · climbing 0.04 · recovery 0.04 · randomness 0.20 |
| hilly | punch 0.44 · **tempo 0.10** · acceleration 0.08 · climbing 0.06 · endurance 0.06 · positioning 0.04 · sprint 0.02 · randomness 0.20 |
| mountain | climbing 0.50 · **tempo 0.12** · endurance 0.14 · recovery 0.06 · punch 0.04 · tactics 0.02 · positioning 0.02 · randomness 0.10 |
| high_mountain | climbing 0.52 · endurance 0.18 · **tempo 0.08** · recovery 0.06 · punch 0.04 · tactics 0.02 · randomness 0.10 |
| itt | time_trial 0.58 · positioning 0.24 · **flat 0.06** · randomness 0.12 |
| ttt | time_trial 0.50 · tactics 0.18 · positioning 0.14 · endurance 0.12 · randomness 0.06 (uændret) |
| cobbles | cobblestone 0.66 · **flat 0.08** · punch 0.06 · positioning 0.06 · endurance 0.06 · randomness 0.08 |
| classic | endurance 0.18 · punch 0.16 · climbing 0.12 · cobblestone 0.10 · **tempo 0.06** · **flat 0.06** · positioning 0.06 · tactics 0.04 · sprint 0.04 · randomness 0.18 |

**FUND under re-fit:** at tilføje flat-vægt 0.12 på flad-terræn lod rouleurs stjæle ~4% af flade sejre (sprinter 90→86%). Løst ved at holde flat-vægten lav PÅ flad-terræn (0.06) og bevare flat-evnens liveness via rolling (0.12). Et forsøg på ekstra margin (flat 0.04 / sprint 0.63) gjorde seed 42 VÆRRE (89%) pga. ikke-monoton breakaway-interaktion på flad — 0.61/0.06 er optimum.

## Liveness-gulv (mode-bevidst, ejer-valgt C1)

- Terræn-kraft (neutral mode): **0.05** ⌀rank-gevinst.
- Seam (durability/descending, condition/finale mode): **0.02** ⌀rank-gevinst (subtile seams; durabilitys fulde styrke = #1021).
- aggression (breakaway): måles IKKE via rank (chance-driver, for støjende: 0.00-0.26 på tværs af seeds). I stedet **deltagelses-gap** = top-aggression-tercilens udbruds-deltagelsesrate − bund-tercilens. Gulv **0.01**. Beviser at aggression-EVNEN (ikke den gamle proxy) styrer udvælgelsen.

## GRØN gate — resultater pr. seed (`npm run race:gate`, seeds 2026/7/42)

Alle ejer-bånd + strukturelle oracles + udbruds-bånd + liveness grønne, exit 0 på alle 3 seeds + condition + roles.

**Mål-scorecard (født-som vinder-andel):**

| Terræn (mål) | seed 2026 | seed 7 | seed 42 |
|---|--:|--:|--:|
| flat (sprinter ≥90%) | 90% | 93% | 90% |
| itt (tt ≥60%) | 67% | — | — |
| itt+gc (≥95%) | 100% | — | — |
| cobbles (brostensrytter ≥80%) | 97% | — | — |
| hilly (puncheur ≥35%) | 83% | 80% | 50% |
| mountain (gc+climber+baroudeur ≥85%) | 90% | 89% | 96% |
| high_mountain (≥85%) | 93% | 90% | 99% |

Bindende margin: **flat sprinter 90%** (seed 2026 + 42) — uændret fra #1102's accepterede margin.

**Liveness (seed 2026, alle ✓):** sprint 11.15 · climbing 9.22 · time_trial 13.54 · cobblestone 11.91 · punch 9.86 · endurance 2.93 · flat 3.51 · tempo 2.42 · descending 1.43 · durability 0.04 (seam) · aggression-gap 0.02.

## Tilbage til senere planer (Non-goals her)

- Fysiologi→evne-derivation + migration + `prolog`-fjernelse → Plan 2 (#1021/#1101-kæden).
- Nye terræn-typer (medium_mountain, itt_short/itt_long) → Plan 2.
- Fuld fatigue-model (durability fulde styrke over 21 etaper) → #1021.
- Recovery-seam-purificering, 8-type z-score → Plan 2/3.
