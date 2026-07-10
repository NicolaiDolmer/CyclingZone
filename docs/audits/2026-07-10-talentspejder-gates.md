# Talentspejder Fase 3 (#2244) — Slice D gates

> Ejer-låst plan: `docs/superpowers/plans/2026-07-10-talentspejder-fase-3.md` (Slice D). Kørt 2026-07-10 på branch `feat/2244-scout-slice-d` (stacked på Slice B). Ingen DB-mutation, ingen lib-ændringer — kun scripts + denne audit.

## 1. Inversion-harness (rest-bånd, spejder-rating-dimension)

`node backend/scripts/scoutingInversionHarness.js` — gate: median rekonstruktionsfejl ≥ 0.25 stjerner for ALLE spejder-ratings {40, 60, 80, 99}.

```
PASS (scout overall=40) { medianError: 0.2768, p10Error: 0.0639, fracBelow025: 0.449, bestStrategy: 'avgAll' }
PASS (scout overall=60) { medianError: 0.2629, p10Error: 0.0583, fracBelow025: 0.48,  bestStrategy: 'restMid' }
PASS (scout overall=80) { medianError: 0.2599, p10Error: 0.0581, fracBelow025: 0.485, bestStrategy: 'restMid' }
PASS (scout overall=99) { medianError: 0.2641, p10Error: 0.0522, fracBelow025: 0.48,  bestStrategy: 'restMid' }
PASS — alle spejder-ratings
```

**Verdict: ✅ PASS.** Rest-båndet er ikke reelt inverterbart ved nogen spejder-rating — det bedre gulv for en top-spejder (overall 99, ±3.0pt / ±0.5★) gør IKKE inversionen lettere; median-fejlen holder sig faktisk stabil (0.26–0.28) på tværs af hele rating-spektret, fordi den persistente `anchorBias` (konstant på tværs af levels) er uafhængig af scout-rating og forbliver den ikke-fjernelige fejlkilde.

## 2. Shortlist-korrelationsgate (mission-bias, Task B3)

Test: `backend/lib/scoutMission.test.js`, to invarianter:
- `"INVARIANT: shortlist-position vs sand potentiale-rang korrelation < 0.3 over 200 seeds"` (linje ~160)
- `"INVARIANT holds across scout ratings (default + hired top scout)"` (linje ~178)

Tærskel: `|Spearman rho| < 0.3` mellem shortlist-position og sand potentiale-rang blandt de udvalgte kandidater, over 200 seeds, for både `DEFAULT_SCOUT` (overall 40) og en hyret top-spejder (overall 90).

```
$ node --test backend/lib/scoutMission.test.js
✔ INVARIANT: shortlist-position vs sand potentiale-rang korrelation < 0.3 over 200 seeds (10.39ms)
✔ INVARIANT holds across scout ratings (default + hired top scout) (10.96ms)
ℹ tests 15
ℹ pass 15
ℹ fail 0
```

**Verdict: ✅ PASS.** Shortlist-rækkefølgen (deterministisk shuffle, aldrig sorteret efter potentiale) afslører ikke rang-ordenen — hverken for den svage default-spejder eller en stærk hyret spejder.

## 3. Travel-cost-scorecard

Script: `backend/scripts/scoutTravelScorecard.js` (mønster: `facilityInvestmentScorecard.js`). 100% syntetisk, ingen DB-kald.

**Aktiv-manager-profil (plan-brief):**
- 2 målrettede opgaver/uge, alternerende niveau-step [1, 2] à 15.000/step (gennemsnit 22.500/job)
- 1 mission/måned à 60.000 (flat)
- Sæson-længde: 10-12 uger (`docs/i18n/GLOSSARY.md`), 11 uger som centralt scenarie

**Typisk sæson-indkomst** (samme kilde/proxy som `moneySupplyScorecard.js`/`inflationScorecard.js`/`facilityInvestmentScorecard.js`): `SPONSOR_INCOME_BY_DIVISION` (economyConstants.js) + `PRIZE_ESTIMATE_BY_DIVISION` (facilityInvestmentModel.js, repræsentativ kompetent-hold-præmie), GROSS (ikke net efter løn/upkeep):

| Division | Sponsor | Præmie (estimat) | Indkomst/sæson |
|---|---|---|---|
| D1 | 600.000 | 160.000 | 760.000 |
| D2 | 400.000 | 70.000 | 470.000 |
| D3 | 340.000 | 25.000 | 365.000 |

**Sæson-spend (11 uger, centralt scenarie):**
- Målrettede opgaver: 22.500 × 2/uge × 11 uger = **495.000**
- Missioner: 2,53 missioner (2,53 måneder × 1/måned) × 60.000 = **151.899**
- **Total: 646.899/sæson**

**Gate-resultat: [2%, 15%] af typisk sæson-indkomst — pr. division:**

| Division | Spend | Indkomst | Andel | Gate |
|---|---|---|---|---|
| D1 | 646.899 | 760.000 | 85,1% | ❌ FAIL |
| D2 | 646.899 | 470.000 | 137,6% | ❌ FAIL |
| D3 | 646.899 | 365.000 | 177,2% | ❌ FAIL |

**Sensitivitet (sæson-længde 10/11/12 uger):** 77,4–92,9% (D1), 125,1–150,2% (D2), 161,1–193,3% (D3). Konklusionen er robust over hele 10-12-ugers-båndet — det er ikke en grænsetilfælde-fejl.

### Verdict: ❌ FAIL — dokumenteret, defaults IKKE ændret

Plan-instruksen for Slice D er eksplicit: *"Hvis travel-cost-gaten FAILER med default-tallene, ÆNDR IKKE defaults — dokumentér fejlen og de foreslåede justerede tal til ejer-review."* Det er gjort her; `backend/lib/scoutEngine.js`'s `SCOUT_JOB_CONFIG` er **uændret**.

**Rod-årsag:** ved den antagne kadence (2 målrettede opgaver/uge + 1 mission/måned) æder standard-omkostningerne 77–193% af sæson-indkomsten afhængigt af division — 5-13× over gate-loftet (15%). Dette er en meget aggressiv "aktiv manager"-profil: med kapacitet=1 (kun 2 ved spejder-overall≥80) og en varighed på 3-6 dage/målrettet opgave er 2 NYE opgaver/uge teknisk muligt (opgaverne løber sekventielt, hver er kortere end en uge), men det betyder reelt at spejderen kører for FULD kapacitet uafbrudt hele sæsonen — det er den mest ekstreme, ikke den typiske, brug.

**Kandidat-justeringer til ejer-review (ingen landet her):**
1. **Skalér costs ned ×0,06** (target ≈ 926/step, mission ≈ 3.705) → centrerer D2-spend midt i båndet (~8,5%). Virker urealistisk lavt i absolutte tal — signalerer at enten profilen eller loftet (15%) bør revurderes, ikke nødvendigvis costs.
2. **Reducér frekvens-antagelsen** i modellen — "2 opgaver/uge + 1 mission/måned" er en model-profil for Slice-D-gaten, ikke en hård cap på hvad spillere rent faktisk kan/vil bruge. En mere realistisk "typisk aktiv" (fx 1 opgave/uge + 1 mission hver 2. måned) ville halvere-tredoble spend og lande tættere på båndet — men er en ANDEN antagelse end den brief eksplicit angav, så den er ikke substitueret her uden ejer-go.
3. **Accepter som top-of-range**: båndet [2%, 15%] er formuleret for en "typisk" aktiv manager; hvis den givne profil reelt beskriver en MEGET aktiv/hardcore spiller (konstant fuld kapacitet), kan et bredere loft for den øvre grænse være mere retvisende end at ændre `SCOUT_JOB_CONFIG`.

**Anbefaling til ejer:** afklar om "2 jobs/uge + 1 mission/måned" skal forstås som en gennemsnitlig/typisk manager (i så fald bør enten `costPerLevel`/`mission.cost` reduceres, eller kadence-antagelsen i denne scorecard justeres til noget mindre aggressivt) — eller om det er en bevidst high-engagement-profil og gate-båndet skal udvides for øvre grænse. Ingen kodeændring foretaget; dette er alene et bevis + beslutningsoplæg.

## 4. Præcisions-bånd-tabel (scout overall × alder × niveau)

Script: `backend/scripts/scoutBandTable.js`. Modellen har to UAFHÆNGIGE akser (verificeret mod kilden, ikke antaget):

**Tabel 1 — delvis scouting (stjerne-halvbredde), alder × niveau (spejder-rating-UAFHÆNGig):**

| Alder-bånd | Niveau 1 | Niveau 2 |
|---|---|---|
| ≤20 | ±1.00★ | ±0.50★ |
| 21-23 | ±0.80★ | ±0.40★ |
| 24-27 | ±0.53★ | ±0.27★ |
| 28+ | ±0.33★ | ±0.17★ |

**Tabel 2 — REST-bånd (niveau == maxLevel=3 / egen rytter), stjerne-halvbredde × spejder-overall (alder-UAFHÆNGig):**

| Spejder-overall | Fremmed rytter (×1.0) | Egen rytter (×0.8) |
|---|---|---|
| 40 | ±0.833★ | ±0.667★ |
| 60 | ±0.720★ | ±0.576★ |
| 80 | ±0.607★ | ±0.486★ |
| 99 | ±0.500★ | ±0.400★ |

**Tabel 3 — type-loft-bånd (`buildTypeCeilingBands`), rating-punkt-halvbredde × spejder-overall × niveau:**

| Spejder-overall | Niveau 0 | Niveau 1 | Niveau 2 | Niveau 3 |
|---|---|---|---|---|
| 40 | ±12.00pt | ±8.00pt | ±5.00pt | ±5.00pt |
| 60 | ±12.00pt | ±8.00pt | ±5.00pt | ±4.32pt |
| 80 | ±12.00pt | ±8.00pt | ±5.00pt | ±3.64pt |
| 99 | ±12.00pt | ±8.00pt | ±5.00pt | ±3.00pt |

Gulvet (`scoutEngine.minHalfWidthByScoutRating`) er monotonisk faldende 40→99 og rammer aldrig under middelmådig-loftet 4,5 rating-pt for overall<60 (spec beslutning 3) — kun niveau 3 (REST/loft) er synligt påvirket i tabellerne ovenfor; niveau 0-2 er base-formlen (`CEIL_HALF_WIDTH_BY_LEVEL`), upåvirket fordi basen der er ≥ gulvet for de rating-spænd der er testet.

## Samlet Slice D-status

| Gate | Verdict |
|---|---|
| Inversion-harness (spejder-rating-dimension) | ✅ PASS |
| Shortlist-korrelationsgate (mission-bias) | ✅ PASS |
| Travel-cost-scorecard | ❌ FAIL (dokumenteret, defaults uændret — se §3) |
| Full backend-suite (`npm test` i backend/) | ✅ PASS (2962/2962) |

**Ejer-review krævet FØR Slice C merges** (jf. plan: "skal være grøn FØR Slice C merges"): travel-cost-gaten er rød. Enten (a) justér `SCOUT_JOB_CONFIG`-defaults, (b) justér kadence-antagelsen i denne scorecard til en mere "typisk" (ikke max-kapacitet) profil, eller (c) udvid gate-båndets øvre grænse for en bevidst high-engagement-profil — beslutning er ejerens, ingen af delene er landet her.
