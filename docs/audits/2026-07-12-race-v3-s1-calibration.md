# Race v3 S1 — work-cost + kaptajn-beskyttelse: kalibrerings-audit (#2352)

**Dato:** 2026-07-12 · **Slice:** S1 (roller med pris) · **Spec:** [2026-07-11-race-engine-depth-credibility-design.md](../superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md) §6
**Baseline:** [2026-07-11-race-v3-s0-baseline.md](2026-07-11-race-v3-s0-baseline.md) · **Sweep-værktøj:** `backend/scripts/sweepS1WorkCost.mjs` (committet, genkørbar)
**Vinder-konstanter (i `backend/lib/raceRoles.js` RACE_V3_TUNING):** `WORK_COST_HELPER_GC = −0.03` · `WORK_COST_HELPER_FLAT = −0.0267` (GC×8/9) · `TEAM_RACE_WEIGHT_V3 = 0.10`

## 1. Metode

Joint grid-sweep (spec §6: work-cost og boost kalibreres SAMMEN), seed 2026, population-snapshot 2026-07-11 (368 hold/5.650 ryttere), `--roles --v3`. Pr. celle måles:

- **Anti-exploit-oracle** (delt lib `raceRoleExploitHarness.js`, også håndhævet i `node --test`): tophold (kaptajn + 7 hjælpere) over 48 løb — sæsonpoint + sejre under kaptajn-setup vs. all-free_role. Krav: point-margin ≥ +1 % OG sejre ≥.
- **Hold-koncentration:** share4PlusSameTeamTop10 ≤ 5 % · distinkte hold ≥ 7,5.
- **Counterfactual hjælper-tab (NY linse, S1-bindende):** parret same-seed-kørsel (roller som tildelt vs. rolle-frit — bit-identisk med all-free_role, da ingen af dem betaler work-cost/bygger helperSupport, og work_cost/team konsumerer ingen rng). Kun hjælpere med terrain-score i feltets **top-15** medregnes; delta = rankRoles − rankCounterfactual (positiv = tabte pladser). Rationale: fuld-felt-medianen er ~0 pr. konstruktion (næsten alle ryttere i prod-felter ER hjælpere → samme straf → uændret indbyrdes orden); ejerens "A — MARKANT"-bånd (10-30) handler om hjælpere der ellers kørte med i toppen. Mål: median 10-30.
- **Favorit-win/max-sæson-win** (S2-linser, bruges som tiebreak: lavest forværring vinder).

## 2. Fuld grid-tabel (seed 2026; oracle: roles-point/sejre vs. free_role 769p/14w)

| gc | w | Oracle (point-margin) | Sejre | share4+ | distinkte | cfHelperTab p25/med/p75 | favWin | maxSeason | Kriterie 1/2/3 |
|---|---|---|---|---|---|---|---|---|---|
| −0.030 | 0.06 | 733p (−4,7 %) | 17 vs 14 | 3,0 % | 8,6 | 1/3/8 | 58,3 % | 90,7 % | ✗/✓/✗ |
| −0.030 | 0.08 | 766p (−0,4 %) | 20 vs 14 | 2,8 % | 8,6 | 1/3/8 | 58,6 % | 90,7 % | ✗/✓/✗ |
| **−0.030** | **0.10** | **787p (+2,3 %)** | **20 vs 14** | **2,6 %** | **8,7** | **1/3/9** | **59,0 %** | **90,7 %** | **✓/✓/✗ ← VINDER** |
| −0.030 | 0.12 | 824p (+7,2 %) | 22 vs 14 | 2,4 % | 8,8 | 1/4/9 | 59,1 % | 91,3 % | ✓/✓/✗ |
| −0.0375 | 0.06 | 720p (−6,4 %) | 17 vs 14 | 2,8 % | 8,7 | 1/4/9 | 58,6 % | 90,7 % | ✗/✓/✗ |
| −0.0375 | 0.08 | 753p (−2,1 %) | 20 vs 14 | 2,5 % | 8,7 | 1/4/10 | 58,8 % | 91,3 % | ✗/✓/✗ |
| −0.0375 | 0.10 | 774p (+0,7 %) | 20 vs 14 | 2,3 % | 8,8 | 1/4/10 | 59,1 % | 91,3 % | ✗/✓/✗ |
| −0.0375 | 0.12 | 811p (+5,5 %) | 22 vs 14 | 2,1 % | 8,8 | 1/4/10 | 59,3 % | 91,3 % | ✓/✓/✗ |
| −0.045 | 0.06 | 715p (−7,0 %) | 17 vs 14 | 2,5 % | 8,7 | 1/4/10 | 58,7 % | 91,3 % | ✗/✓/✗ |
| −0.045 | 0.08 | 748p (−2,7 %) | 20 vs 14 | 2,3 % | 8,8 | 1/4/11 | 59,0 % | 91,3 % | ✗/✓/✗ |
| −0.045 | 0.10 | 769p (+0,0 %) | 20 vs 14 | 2,0 % | 8,8 | 2/4/11 | 59,3 % | 92,0 % | ✗/✓/✗ |
| −0.045 | 0.12 | 806p (+4,8 %) | 22 vs 14 | 1,8 % | 8,9 | 2/4/11 | 59,5 % | 92,0 % | ✓/✓/✗ |

**Kant-udvidelse (spec-intervallets yderpunkt, dokumenterer kriterie-3-unåelighed):**

| gc | w | Oracle | cfHelperTab p25/med/p75 | favWin |
|---|---|---|---|---|
| −0.0525 | 0.10 | 767p (−0,3 %) ✗ | 2/5/12 | 59,7 % |
| −0.0525 | 0.12 | 804p (+4,6 %) ✓ | 2/5/12 | 59,8 % |
| −0.060 | 0.10 | 767p (−0,3 %) ✗ | 2/5/12 | 59,9 % |
| −0.060 | 0.12 | 804p (+4,6 %) ✓ | 2/5/13 | 60,0 % |

## 3. Vinder-begrundelse (kriterie-kaskaden)

1. **Oracle (≥ +1 % point, sejre ≥):** kun 4 celler består — (−0.03, 0.10), (−0.03, 0.12), (−0.0375, 0.12), (−0.045, 0.12). Mønster: hver 0.015 ekstra work-cost koster ~2 pp oracle-margin (hjælpernes egne point falder), så højere cost KRÆVER højere boost — præcis spec §6's "kalibreres sammen".
2. **Hold-koncentration:** alle celler grønne (allerede kriterie-opfyldt ved mindste cost).
3. **Counterfactual hjælper-tab-median 10-30: UNÅELIGT i hele spec-intervallet.** Medianen er næsten uelastisk i work-cost: 3 ved −0.03 → 5 ved −0.06 (p75: 8 → 13). Strukturel årsag: i toppen af pulje-felterne er score-gabene ~0.01/plads (favorit-gab #1→#5 median 0,060 i felterne), så en score-delta på 0.03-0.06 flytter en TOP-hjælper 3-13 pladser — 10-30 pladser som *median* ville kræve work-cost ≥ ~0.10 (uden for spec-intervallet og med voldsom kollateral på oracle + favorit-win). Kriteriet degraderer derfor til "så tæt på som muligt uden at bryde 1-2" — og da medianen reelt er flad (3 vs. 4-5) på tværs af cellerne, er kriterium 3 IKKE diskriminerende i dette grid.
4. **Lavest favorit-win-forværring:** blandt de 4 oracle-bestående celler har (−0.03, 0.10) lavest favWin (59,0 %) OG lavest boost-vægt (0.10 < 0.12) → mest varians-budget tilbage til S2. **Vinder: gc=−0.03, w=0.10.**

Note om "A — MARKANT": det målte system kan ikke levere −10..−30 pladser som median for top-hjælpere via en konstant score-straf. Det markante aftryk er i stedet: (a) p75 = 9 tabte pladser for top-hjælpere (hver fjerde arbejdsdag koster ≥9 pladser), (b) share4Plus halveret vs. S0 roles-linsen (4,5-4,8 % → 2,3-2,7 %), (c) oracle-beviset for at roller > free_role for tophold. Hvis ejeren vil have hårdere median-tab, er håndtaget IKKE work-cost-konstanten men gap-strukturen (S2's dagsform komprimerer toppen → samme cost flytter flere pladser) — genmål efter S2.

## 4. Baseline vs. S1 flag-on (vinder-konstanter, alle 3 seeds)

| Metrik | S0-baseline (spænd, 9 kørsler) | S1 flag-on 2026 | S1 flag-on 7 | S1 flag-on 42 | Målbånd |
|---|---|---|---|---|---|
| Favorit-win-rate | 53,0-54,9 % | 59,0 % | 59,3 % | 58,0 % | 25-40 % (S2-mål) |
| Max sæson-win-rate | 87,2-89,5 % | 90,7 % | 92,7 % | 89,7 % | ≤45 % (S2-mål) |
| p95 sæson-win-rate | 1,7-1,8 % | 1,6 % | 1,5 % | 1,6 % | ≤35 % ✓ |
| Favorit-podium-rate | 76,3-78,1 % | 81,1 % | 81,4 % | 81,0 % | 55-75 % (S2-mål) |
| **Løb m. ≥4 samme hold i top-10** | 4,5-5,9 % | **2,6 %** | **2,3 %** | **2,7 %** | ≤5 % ✓ (S1-mål RAMT) |
| **Gns. distinkte hold i top-10** | 7,9-8,0 | **8,7** | **8,7** | **8,7** | ≥7,5 ✓ (S1-mål RAMT) |
| ITT favorit-win | 71,0-76,7 % | 74,3 % | 78,0 % | 73,3 % | 45-65 % (S2-mål) |
| Hjælper-tab (fuld-felt-median, S0-linse) | 0,0 | 1,0 | 1,0 | 1,0 | 10-30 (se §3.3) |
| **Counterfactual hjælper-tab top-15 (p25/med/p75)** | n/a (ny linse) | 1/3/9 | 1/3/9 | 1/3/9 | median 10-30 ✗ (unåeligt, §3.3) |
| Anti-exploit-oracle | n/a | ✓ (+2,3 % point, 20 vs. 14 sejre; seed-uafhængig deterministisk scenario) | ✓ | ✓ | grøn ✓ (S1-mål RAMT) |
| Flag-off (alle modes/seeds) | — | bit-identisk S0-reproduktion | ✓ | ✓ | ✓ |

Favorit-win/podium stiger 4-5 pp — bevidst accepteret kollateral fra kaptajn-boostet (oraklets pris); det er S2's opgave at trække favorit-raterne ned i bånd via dagsform + jour sans, og S1-vinderen er netop valgt for at maksimere S2's råderum (se §5).

## 5. Komponent-størrelser + S2-risiko-note (varians-budgettet)

Målt i pulje-felterne (GC-relevante profiler, 300 løb, vinder-konstanter):

- **Realiseret kaptajn-boost** (weight × helperSupport): median **0.0099**, p90 **0.019**, max **0.046**.
- **Favorit-gab i felterne** (terrain #1 → #5): median **0.060** (bredere end spec §2's population-globale 0.032 — puljerne har tyndere top).
- **Boost-differential top- vs. midterhold** (p90-boost minus median-boost ≈ stacket kaptajn vs. gennemsnits-kaptajn): **~0.009** ≈ 28 % af spec-referencens 0.032-gab, ~15 % af det målte felt-gab. Max-casen (0.046) overstiger 0.032 — en fuldt stacket kaptajn kan købe mere end hele referencegabet, men det er fordelingens yderste hale (1/7.365 observationer).

**Risiko-note til S2:** S2's §7-regnestykke (P(#5 slår #1) via dagsform-sd 0.012-0.018 + jour sans) skal nu slå IGENNEM kaptajn-boostet oveni terrain-gabet. Med w=0.10 er den typiske ekstra-mur 0.010 (median) og 0.019 (p90) — dvs. S2's kombinerede per-rytter-varians (~0.022 jf. spec §7) er stadig ~2× den typiske boost, men mod en p90-boostet kaptajn æder boostet ~her halvdelen af varians-fordelen. Havde vi valgt w=0.12, var median-boostet 0.012 og p90 0.023 — dvs. p90-casen ville sluge næsten HELE S2's varians-budget. **Konklusion: der er råderum til S2 ved w=0.10, men S2-kalibreringen skal måle favorit-win-raterne med roles+v3 aktiv (ikke mod neutral-baseline), og w=0.10 bør betragtes som et LOFT indtil S2's bånd er ramt.** Hvis S2 ikke kan nå 25-40 % favorit-win med w=0.10, er første håndtag at sænke w mod oracle-gulvet (~0.095 ved gc=−0.03; margin-kravet +1 % brydes ved ~0.09).

## 6. Reproduktion

```
cd backend
node scripts/sweepS1WorkCost.mjs --seed=2026                    # fuldt grid (12 celler, ~1 min)
node scripts/simulateSeasonDryRun.js --population=scripts/baselines/population-snapshot-2026-07-11.json --no-html --seed=<2026|7|42> --roles --v3
node --test lib/raceRoleExploitOracle.test.js                   # oracle-gaten
```
Env-overrides til punkt-målinger: `RACE_V3_WORK_COST_HELPER_GC`, `RACE_V3_WORK_COST_HELPER_FLAT`, `RACE_V3_TEAM_RACE_WEIGHT` (kalibrerings-only; prod sætter dem aldrig).
