# Race v3 S2 — dagsform + jour sans: kalibrerings-audit (#2353) — PARETO-FRONT, INGEN VINDER

**Dato:** 2026-07-12 · **Slice:** S2 (varians med navn) · **Spec:** [2026-07-11-race-engine-depth-credibility-design.md](../superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md) §7
**Forgænger:** [S1-kalibrering](2026-07-12-race-v3-s1-calibration.md) · **Sweep:** `backend/scripts/sweepS2DayForm.mjs`
**Status: 0/27 grid-celler når bånd 1-3 samtidig → Pareto-front rapporteret, kalibrering STOPPET pr. instruks (ingen hacks på andre konstanter). Konstanterne står på spec-start-kandidaterne (sd 0.015 · p 0.03 · fw 0.035 — midt i Pareto-regionen, jour-sans-rate i bånd) afventende orkestrator/ejer-beslutning.**

## 1. Metode

Grid: `DAYFORM_SD ∈ {0.012, 0.015, 0.018}` × `JOUR_SANS_P_BASE ∈ {2%, 3%, 5%}` × `FORM_RACE_WEIGHT_V3 ∈ {0.025, 0.035, 0.045}`, seed 2026, population-snapshot, `--roles --v3 --condition=snapshot` (form live så form-vægt + jour-sans-form-koblingen faktisk måles). Pr. celle også anti-exploit-oraklet (S1-gaten under S2-varians).

**Type-integritet måles SEPARAT i genereret mode:** flat-sprinter er strukturelt ~57-61 % i population-mode uanset v1/v3/condition (S0-fund: udbruds-eksplosion på flat i pulje-felter; ≥90 %-båndet er kalibreret mod den genererede population) — population-tallet er reference-only.

## 2. Grid-resultat (27 celler, seed 2026) — komprimeret

fw-dimensionen er død i felterne (±0,1 pp på alt — prod-condition-formene ligger tæt på 50, så selv 0.045-vægten flytter <0,01 score). Tabellen viser fw=0.035-skiven; fuld JSON i sweep-output.

| sd | p | favWin (25-40) | maxSeason (≤45) | podium (55-75) | itt (45-65) | js-rate (2-5) | S1-gates | cfTab med |
|---|---|---|---|---|---|---|---|---|
| 0.012 | 0.02 | 56,1 % ✗ | 93,3 % ✗ | 78,2 % ✗ | 72,7 % ✗ | 2,65 % ✓ | ✓ (+5,2 %) | 3 |
| 0.012 | 0.03 | 56,0 % ✗ | 92,7 % ✗ | 78,0 % ✗ | 72,3 % ✗ | 3,99 % ✓ | ✓ (+4,6 %) | 3 |
| 0.012 | 0.05 | 55,6 % ✗ | 92,7 % ✗ | 77,6 % ✗ | 71,3 % ✗ | 6,63 % ✗ | ✓ (+2,2 %) | 3 |
| 0.015 | 0.02 | 55,8 % ✗ | 93,3 % ✗ | 77,0 % ✗ | 70,0 % ✗ | 2,65 % ✓ | ✓ (+6,0 %) | 3 |
| **0.015** | **0.03** | **55,5 % ✗** | **92,0 % ✗** | **76,8 % ✗** | **69,3 % ✗** | **3,99 % ✓** | **✓ (+5,3 %)** | **3** ← nuværende defaults |
| 0.015 | 0.05 | 55,2 % ✗ | 92,0 % ✗ | 76,4 % ✗ | 68,3 % ✗ | 6,63 % ✗ | ✓ (+3,1 %) | 3 |
| 0.018 | 0.02 | 55,1 % ✗ | 92,7 % ✗ | 76,2 % ✗ | 67,7 % ✗ | 2,65 % ✓ | ✓ (+10,0 %) | 3 |
| 0.018 | 0.03 | 54,8 % ✗ | 91,3 % ✗ | 76,0 % ✗ | 67,0 % ✗ | 3,99 % ✓ | ✓ (+9,2 %) | 3 |
| 0.018 | 0.05 | 54,5 % ✗ | 91,3 % ✗ | 75,6 % ✗ | 66,0 % ✗ | 6,63 % ✗ | ✓ (+6,6 %) | 3 |

**Pareto-front:** monotont — max varians (sd 0.018) dominerer på alle mål-bånd; p=0.05 giver marginalt bedre favWin men skubber realiseret jour-sans-rate (6,63 %) ud over spec-båndet 2-5 %. **Bedste lovlige celle: sd=0.018 · p=0.03 · fw=vilkårlig** (favWin 54,8 %, podium 76,0 % — podium er ~1 pp fra båndkanten 75). Yderhjørnet sd=0.018/p=0.05/fw=0.045 når podium 75,2 % (næsten i bånd) men js-rate ✗.

## 3. Rod-årsag: spec §7's regnestykke hviler på et 2× for lille favorit-gab

Spec §7 antog favorit-gab ~0.032 (population-globalt #1→#5 på climbing) → kombineret per-rytter-sd ~0.022 → P(#5 slår #1) ≈ 15 %/løb → favWin 25-40 %. **Målt i de FAKTISKE pulje-felter (S1-audit §5): gab-medianen er 0.060** (tyndere pulje-toppe). Med parvis σ ≈ √2×0.022 ≈ 0.031 er z ≈ 1,9 → P(#5 slår #1) ≈ 3 % — dagsformen prikker kun til favoritten. Derfor flytter hele grid'et favWin blot 59,0 → 54,4 % (S1-only → max-varians-hjørnet).

**Veje til båndet (beslutning, ikke kalibrering — derfor STOP her):**
1. **Dagsform-sd ~0.04-0.05** (≈2,5-3× spec-intervallet). Prisen: dagsform bliver større end noise og på størrelse med små terrain-gaps; type-integritet skal re-verificeres (itt-tt dypper allerede marginalt ved sd 0.015, se §5).
2. **Gab-kompression** (ability/demand-siden — flere jævnbyrdige udfordrere i pulje-toppen). Struktureltrigtigst men rører population/værdikæden, ude af S2-scope.
3. **Acceptér et blødere interim-bånd** (fx favWin ≤50 % efter S2, fuldt bånd efter S4-incidents + population-berigelse).

## 4. S1-gates under S2-varians (regressionstjek) — ALLE GRØNNE

- **Oracle STYRKES:** margin +2,2..+10,0 % over grid'et (S1-only: +2,3 %). Varians koster all-free_role-konfigurationen mere end kaptajn-setuppet (kaptajn-boostet er deterministisk, free_role-point er varians-eksponerede). **w=0.10-loftet HOLDT — ingen grund til at røre det.**
- share4Plus 2,8-3,9 % (≤5) · distinkte 8,4-8,5 (≥7,5) på alle celler.

## 5. Validering på 3 seeds (start-kandidat-konstanterne sd 0.015/p 0.03/fw 0.035)

| Metrik | S0-baseline | S1-only (3 seeds) | **S2-on (3 seeds, condition=snapshot)** | Bånd |
|---|---|---|---|---|
| Favorit-win-rate | 53,0-54,9 % | 58,0-59,3 % | **55,3-55,5 %** | 25-40 % ✗ |
| Max sæson-win-rate | 87,2-89,5 % | 89,7-92,7 % | **92,0-95,7 %** | ≤45 % ✗ |
| Favorit-podium | 76,3-78,1 % | 81,0-81,4 % | **76,4-76,8 %** | 55-75 % ✗ (tæt) |
| ITT favorit-win | 71,0-76,7 % | 73,3-78,0 % | **69,3-71,7 %** | 45-65 % ✗ (bedre) |
| share4Plus / distinkte | 4,5-5,9 % / 7,9-8,0 | 2,3-2,7 % / 8,7 | **3,3-4,2 % / 8,4-8,5** | ≤5 / ≥7,5 ✓ |
| Jour-sans-rate | 0 | 0 | **3,99-4,04 %** | 2-5 % ✓ |
| Type-integritet (genereret linse, born-as) | grøn (v1) | — | **sprinter-flat 99-100 % ✓ · mountain/high_mountain ✓ · itt-tt 58-60 % (interim-bånd 60: 2/3 seeds −1..−2 pp, rapport-only)** | sprinter ≥90 % ✓ |
| Oracle | n/a | +2,3 %/20v14 | **+5,3 %/19v10** ✓ | grøn ✓ |

NB: maxSeason STIGER under S2 (92-95,7 %) — jour sans på 4 % ripper enkelte løb ud af outliers, men de N-1 øvrige løb i en 10-starters sæson afgøres stadig af det store gab; små samples gør max-linsen støjfølsom. Metrikken kræver gab-kompression, ikke mere kollaps-rate.

## 6. K3-genmåling (counterfactual hjælper-tab) — tætheds-hypotesen AFKRÆFTET

S1-audit'ens hypotese var at S2's dagsform ville "komprimere toppen → samme work-cost flytter flere pladser". **Målt: median 3 / p75 7-8 med S2 aktiv (alle 27 celler + 3-seeds-validering) — IDENTISK med S1-only (3/9).** Dagsform tilføjer varians men komprimerer ikke terrain-gabene, og den parrede counterfactual (tvillingen kører nu samme v3-tilstand; dagsform/jour-sans er per-rytter-hashet og dermed identisk i begge kørsler) isolerer stadig kun rolle-effekten. Konklusion: hjælper-tab-medianen 10-30 nås KUN via gab-kompression (§3 vej 2) eller et markant større work-cost uden for spec-intervallet — S2 løser det ikke.

## 7. Reproduktion

```
cd backend
node scripts/sweepS2DayForm.mjs --seed=2026                     # 27-cellers grid (~2 min)
node scripts/simulateSeasonDryRun.js --population=scripts/baselines/population-snapshot-2026-07-11.json --no-html --seed=<2026|7|42> --roles --v3 [--condition=snapshot]
node scripts/simulateSeasonDryRun.js --no-html --seed=<seed> --roles --v3   # type-integritet (genereret linse)
node --test lib/raceDayForm.test.js lib/raceRoleExploitOracle.test.js
```
Env-overrides (sweep-only): `RACE_V3_DAYFORM_SD`, `RACE_V3_JOUR_SANS_P`, `RACE_V3_FORM_WEIGHT`.
