# Breakaway feature-aware (Fase 1) — kalibrerings-log (#1021)

**Dato:** 2026-06-16. **Status: GRØN** på hele gate-matricen (seed 2026 + 7 + 42 + condition + roles, alle `--enforce-targets --enforce-liveness` exit 0). 1680/1680 backend-tests grønne.

Grundet i verificeret virkeligheds-data (research 2026-06-16): power-/udbruds-strande med adversarial fakta-tjek. Plan: [`docs/superpowers/plans/2026-06-16-breakaway-feature-aware-phase1.md`](../superpowers/plans/2026-06-16-breakaway-feature-aware-phase1.md).

## Kerne-beslutning

Den flade per-profil-skalar (`BREAKAWAY_PROFILES`) er afløst af **finale-gradient-bevidst bonus**: `maxBonus = breakawayMaxBonus(profile_type, finale_type)`. `finale_type` (allerede på hver etape) er proxy for finale-gradienten — den vigtigste virkelige faktor: `long_climb` (summit) → favoritterne afgør (~0); `descent`/flad efter sidste stigning → udbruddet holder hjem.

**Definition (ejer, 2026-06-16):** udbruds-sejr = rytter fra det *tidlige* udbrud der holdt hjem (`components.breakaway > 0`). Favorit-angreb fra feltet = offensiv kørsel, IKKE udbrud. Motoren målte allerede dette — invariant bevaret.

## Design-valg truffet i kalibreringen (ejer-godkendt)

1. **mellembjerg (`mountain`) = descent-domineret finale.** `FINALE_BY_PROFILE.mountain = ["descent","breakaway","long_climb"]` — mellembjerg/transition slutter oftest på nedkørsel/rullende (udbruds-venligt); de store summit-finaler hører til `high_mountain`.
2. **Global terræn-vægtning af escapee-*selektionen*: TESTET + FORKASTET.** Den skadede flad (flad-udbrud vundet af flad-stærke rouleurer → flad-born-as < 90%) og flyttede knap bjerg-born-as (83→84%). Selve win-scoren (terræn + bonus) gør allerede vinderen af et bjergudbrud til den mest klatre-egnede af de undslupne → selektionen forbliver aggression-drevet. (Per-terræn break-composition hører til Fase 2.)
3. **mellembjerg born-as-mål: 85% → 82% (udbruds-bevidst).** Realistiske mellembjerg-udbrud (~17%) giver et bredere vinderfelt; det strenge 85% antog at udbrud ikke vandt. `high_mountain` (summit, favoritterne afgør) forbliver strengt ≥85%.
4. **flad-bonus cappet ≤0.30.** #1307-fund: flad-bonus >0.30 vælter `sprinter ≥90%` i roles-mode. Flad-udbrud vinder sjældent uanset finale → flad er finale-flad på 0.30.

## Endelige konstanter

**`BREAKAWAY_BONUS`** (`backend/lib/raceSimulator.js`):

| profil | bonus pr. finale |
|---|---|
| flat | bunch_sprint 0.30 · reduced_sprint 0.30 · _default 0.30 |
| rolling | breakaway 0.20 · reduced_sprint 0.17 · bunch_sprint 0.15 · _default 0.17 |
| hilly | punch 0.42 · reduced_sprint 0.40 · breakaway 0.46 · _default 0.42 |
| mountain | descent 0.50 · breakaway 0.50 · long_climb 0.06 · _default 0.45 |
| high_mountain | descent 0.42 · long_climb 0.05 · _default 0.08 |
| cobbles | reduced_sprint 0.30 · breakaway 0.36 · _default 0.28 |

itt/ttt/classic: intet udbrud (ikke i tabellen → 0).

**`FINALE_BY_PROFILE`** (`raceStageProfileGenerator.js`): `mountain ["descent","breakaway","long_climb"]` · `high_mountain ["long_climb","long_climb","descent"]` · `hilly ["punch","reduced_sprint","breakaway"]` (cobbles uændret).

**`BREAKAWAY_TARGETS`** (`simulateSeasonDryRun.js`): flat [1,7] · rolling [4,15] · hilly [18,45] · mountain [15,50] · high_mountain [0,15] · cobbles [2,15] %.

## Målte udbruds-andele (GRØN på alle seeds)

| terræn | seed 2026 | seed 7 | seed 42 | bånd |
|---|---|---|---|---|
| flad | 2.7% | 5.7% | 5.0% | 1–7 |
| bølget | 9.3% | 8.0% | 10.0% | 4–15 |
| kuperet | 27.3% | 22.3% | 26.3% | 18–45 |
| mellembjerg | 17.3% | 17.3% | 16.7% | 15–50 |
| bjerg (summit) | 2.7% | 3.7% | 4.3% | 0–15 |
| brosten | 7.0% | 2.7% | 4.7% | 2–15 |

## Born-as (bevaret efter udbruds-ændringen)

| terræn | mål | seed 2026 | seed 7 | seed 42 |
|---|---|---|---|---|
| flad (sprinter) | ≥90% | 90% | 93% | 90% |
| mellembjerg | ≥82% | 87% | 83% | 93% |
| bjerg (summit) | ≥85% | 91% | 89% | 98% |

Baseline (main, før ændring) mellembjerg-born-as: 90/89/96% → realistiske udbrud kostede 3–6 point (forventet; vinderfeltet er bredere). Alle øvrige born-as-mål uændret-grønne.

## Fase 2 (#1021) — sekvenseret

Trigger: Fase 1 stabil + evne-rework (#1122) landet. (1) variabel udbruds-størrelse + kollektiv fart (16+ ryttere → 77% irl). (2) `km_fra_sidste_stigning` + chase-incitament som førsteklasses features. (3) per-terræn break-composition (det Option 1 forsøgte globalt). (4) re-grund bånd mod en summit-vs-descent-split sourcet specifikt.
