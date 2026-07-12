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

---

## Eksplorative prober — beslutningsgrundlag til ejer (12/7, orkestrator-bestilt)

**EKSPLORATIVT — ingen defaults ændret** (start-kandidaterne står; probe B's τ-krog er committet med default τ=1.0 = ingen effekt). Værktøj: `backend/scripts/probeS2Options.mjs --probe=A|B`. Alle celler: p=3 % · fw=0.035, seed 2026; sprinter-flat måles i den KALIBREREDE genererede linse.

### Probe A — udvidet varians-sweep (option 1's sande pris: sd 1,7-3× spec-interval)

| sd | favWin (25-40) | maxSeason (≤45) | podium (55-75) | ITT (45-65) | sprinter-flat | oracle | share4+ |
|---|---|---|---|---|---|---|---|
| 0.025 | 52,9 % ✗ | 90,0 % ✗ | 73,3 % ✓ | 61,0 % ✓ | 99 % ✓ | +11,3 %/17v7 ✓ | 3,0 % ✓ |
| 0.035 | 49,0 % ✗ | 90,0 % ✗ | 68,9 % ✓ | 53,0 % ✓ | 99 % ✓ | +11,1 %/13v6 ✓ | 2,9 % ✓ |
| 0.045 | 45,0 % ✗ | 87,3 % ✗ | 64,8 % ✓ | **43,7 % ✗** | 100 % ✓ | +10,9 %/9v4 ✓ | 2,9 % ✓ |

**Fund:** selv ved sd=0.045 (3× spec-max) når favWin kun 45 % — båndet 25-40 nås ALDRIG ad denne vej, og ITT falder UNDER sit bånd før favWin når sit (variansen rammer ITT hårdest, præcis spec §3's advarsel om "ITT bliver et lotteri"). maxSeason er nærmest immun (87-90 %). Type-integritet (sprinter-GRUPPEN) holder overraskende godt (99-100 % — gruppen er bred nok til at intern omfordeling ikke koster).

### Probe B — gab-kompression-prototype (option 2: τ-top-kompression, `compressTopTerrain`)

Deterministisk, ordens-bevarende: pr. etape komprimeres pre-noise terrain-scores over felt-p90 mod p90 (s' = p90 + τ·(s−p90)); udbrud/team kører på råt terrain. Målt felt-gab #1→#5 (mål ~0.03):

| τ | sd | gab p50 | favWin | maxSeason | podium | ITT | sprinter-flat | oracle | share4+ | dist | K3 cfTab |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **0.5** | **0.015** | **0.030 ✓** | **38,7 % ✓** | 72,0 % ✗ | **65,4 % ✓** | **47,0 % ✓** | 99 % ✓ | **+17,6 %/19v8 ✓** | 2,4 % ✓ | 8,6 ✓ | 4 |
| 0.5 | 0.018 | 0.030 | 37,5 % ✓ | 69,3 % ✗ | 63,2 % ✓ | 44,7 % ✗ (marginal) | 99 % ✓ | +19,9 % ✓ | 2,7 % ✓ | 8,5 ✓ | 4 |
| 0.65 | 0.015 | 0.039 | 44,6 % ✗ | 81,3 % ✗ | 70,1 % ✓ | 53,7 % ✓ | 99 % ✓ | +14,2 % ✓ | 2,6 % ✓ | 8,5 ✓ | 4 |
| 0.65 | 0.018 | 0.039 | 43,8 % ✗ | 80,1 % ✗ | 69,0 % ✓ | 52,7 % ✓ | 99 % ✓ | +16,0 % ✓ | 2,5 % ✓ | 8,5 ✓ | 4 |
| 0.8 | 0.015 | 0.048 | 50,1 % ✗ | 86,3 % ✗ | 73,8 % ✓ | 61,3 % ✓ | 99 % ✓ | +12,8 % ✓ | 2,6 % ✓ | 8,5 ✓ | 3 |
| 0.8 | 0.018 | 0.048 | 49,0 % ✗ | 85,6 % ✗ | 72,8 % ✓ | 60,0 % ✓ | 99 % ✓ | +14,2 % ✓ | 2,5 % ✓ | 8,5 ✓ | 3 |

**Bedste celle τ=0.5 · sd=0.015 valideret på 3 seeds (2026/7/42):** favWin **38,7/38,8/37,5 % — I BÅND på alle 3** · podium 65,4/65,1/66,0 % ✓ · ITT 47,0/47,7/46,7 % ✓ · share4+ 2,4-3,1 % ✓ · distinkte 8,6 ✓ · sprinter-flat 98-100 % ✓ · js-rate 3,99-4,04 % ✓ · oracle +17,6 % (868 vs. 738 point, 19v8 — stærkeste margin målt). **Udestående:** maxSeason 69,7-77,8 % (bånd ≤45 — massivt forbedret fra 92-95,7 %, men outlier-ryttere i svage puljer dominerer stadig deres 8-11 starter); itt-tt-born-linsen dypper til 55-59 % (interim-bånd 60, −1..−5 pp); K3 cfTab 4 (tætheds-hypotesen bekræftet i RETNING (3→4) men ikke i størrelse — 10-30 nås heller ikke her).

### Neutral sammenligning af de tre veje

| | Option 1: sd ~0.035-0.045 (probe A) | Option 2: τ-kompression 0.5 + spec-sd (probe B) | Option 3: blødere interim-bånd (nul arbejde) |
|---|---|---|---|
| favWin-bånd 25-40 % | **Nås aldrig** (45 % ved 3× spec-sd) | **Nås** (37,5-38,8 %, 3 seeds) | Definitorisk (fx bånd ≤50 % → S1+S2-defaults består) |
| Forklarbarhed/why-lag | Dagsform-udsving > noise; "tung dag" bliver hyppig og STOR (±0.045 ≈ ±9 ability-point) — terning-tyranni-risiko (spec §14) | Kompression er usynlig i why-rapporten (gab-struktur, ikke komponent); dagsform forbliver ±3 ability-point | Ingen ændring — dominansen består (ejer-klagen #2224 uløst) |
| Kollateral | ITT under bånd FØR favWin i bånd; podium mod bund af bånd | itt-tt-born 55-59 % (−1..−5 pp under interim-60); maxSeason stadig 70-78 % | Ingen |
| Strukturel ærlighed | Symptombehandling (mere støj oven på for store gaps) | Adresserer rod-årsagen DIREKTE (gab 0.060→0.030 = spec-antagelsen); alternativ ægte løsning er population-berigelse (flere jævnbyrdige toppe pr. pulje) som τ approksimerer motor-side | Udskyder problemet til S4/population-arbejde |
| Implementering | 1 konstant | Krog ER committet (dormant, τ=1.0); beslutning = flip én konstant | 1 bånd-tabel-ændring |
| Risiko | Spillere oplever stjerner som devaluerede via støj (spec §15.1's "min stjerne vinder aldrig mere") | Stjerner devalueres STRUKTURELT i toppen (en 88-klatrer scorer som ~83 i et 82-felt) — skal kommunikeres/aldrig vises som rå tal; peak/form (S5) genskaber differentiering som SPILLER-styret | Discord-klagerne fortsætter |

**Observation (neutral):** maxSeason ≤45 % nås af INGEN af vejene alene — den kræver formentlig S4-incidents + kalender-/population-arbejde (outlieren skal møde reel modstand, ikke kun varians). Hvis båndet fastholdes som S2-gate, blokerer det alle tre veje; som S4+-mål blokerer det ingen.

---

## Beslutning (ejer 12/7): OPTION 2 VALGT — τ-gab-kompression aktiveret

**Ejer-go 12/7 (via orkestrator) på option 2** efter probe-appendix'et ovenfor. `TOP_COMPRESSION_TAU` flippet 1.0 → **0.5** i RACE_V3_TUNING (commit på S2-branchen); status-linjen i toppen af dette dokument ("konstanterne står på start-kandidaterne") er hermed superseded for τ's vedkommende — S2-variansen selv står UÆNDRET på spec-start-kandidaterne.

**Endelige S2-konstanter:** `DAYFORM_SD = 0.015` · `JOUR_SANS_P_BASE = 0.03` (form-koblet 5/3 ↔ 2/3) · `JOUR_SANS_MAGNITUDE = 0.05-0.10` · `FORM_RACE_WEIGHT_V3 = 0.035` · `TOP_COMPRESSION_TAU = 0.5` (+ S1: work-cost −0.03/−0.0267/−0.01 · TEAM_RACE_WEIGHT_V3 = 0.10).

**Endeligt 3-seeds-scorecard (committed konstanter, ingen env; population-snapshot, roles+v3+condition=snapshot):**

| Metrik | seed 2026 | seed 7 | seed 42 | Bånd | Status |
|---|---|---|---|---|---|
| Favorit-win-rate | 38,7 % | 38,8 % | 37,5 % | 25-40 % | ✅ alle 3 |
| Favorit-podium | 65,4 % | 65,1 % | 66,0 % | 55-75 % | ✅ |
| ITT favorit-win | 47,0 % | 47,7 % | 46,7 % | 45-65 % | ✅ |
| Sprinter-flat-gruppe (genereret linse) | 99 % | 100 % | 98 % | ≥90 % | ✅ |
| share4PlusSameTeamTop10 | 2,4 % | 2,7 % | 3,1 % | ≤5 % | ✅ |
| Distinkte hold top-10 | 8,6 | 8,6 | 8,6 | ≥7,5 | ✅ |
| Jour-sans-rate | 3,99 % | 4,04 % | 4,00 % | 2-5 % | ✅ |
| Anti-exploit-oracle | +17,6 % point (868 vs. 738), 19v8 sejre | (seed-uafhængigt scenario) | | grøn m. margin | ✅ |
| Max sæson-win-rate | 72,0 % | 69,7 % | 77,8 % | ≤45 % | **flyttet til S4+** (se nedenfor) |
| Hjælper-tab top-15 (K3) | 4 | 4 | 4 | 10-30 | udestår (egen beslutning, jf. §6) |

**maxSeason ≤45 % flyttes til S4+ (ejer-accepteret ifm. option 2-go):** båndet nås af ingen af de tre veje alene (probe-appendix'ets observation — outlier-ryttere i svage puljer kræver incidents/population-arbejde, ikke mere varians). Forbliver RAPPORT-ONLY i S2-gaten; genevalueres efter S4-styrt/DNF.

**Kollateral accepteret:** itt-tt-born 55-59 % (interim-bånd 60, −1..−5 pp, rapport-only) · strukturel top-devaluering kommunikeres aldrig som rå tal (S6-bånd).
