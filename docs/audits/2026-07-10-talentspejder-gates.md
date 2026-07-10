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

> **Rekalibreret 10/7 (arkitekt-sessionen):** første kørsel med plan-defaults 15.000/step + 60.000/mission FAILEDE hårdt (85-177% af sæsonindkomst — dokumenteret i §3b nedenfor, bevaret som beslutningsgrundlag). `SCOUT_JOB_CONFIG` er derefter rekalibreret til **1.000/step + 6.000/mission**, som passerer gaten på alle divisioner. Ejer sanity-tjekker de absolutte tal ved scorecard-review før Slice C-merge.

**Aktiv-manager-profil (plan-brief):**
- 2 målrettede opgaver/uge, alternerende niveau-step [1, 2] à 1.000/step (gennemsnit 1.500/job)
- 1 mission/måned à 6.000 (flat)
- Sæson-længde: 10-12 uger (`docs/i18n/GLOSSARY.md`), 11 uger som centralt scenarie

**Typisk sæson-indkomst** (samme kilde/proxy som `moneySupplyScorecard.js`/`inflationScorecard.js`/`facilityInvestmentScorecard.js`): `SPONSOR_INCOME_BY_DIVISION` (economyConstants.js) + `PRIZE_ESTIMATE_BY_DIVISION` (facilityInvestmentModel.js, repræsentativ kompetent-hold-præmie), GROSS (ikke net efter løn/upkeep):

| Division | Sponsor | Præmie (estimat) | Indkomst/sæson |
|---|---|---|---|
| D1 | 600.000 | 160.000 | 760.000 |
| D2 | 400.000 | 70.000 | 470.000 |
| D3 | 340.000 | 25.000 | 365.000 |

**Sæson-spend (11 uger, centralt scenarie):**
- Målrettede opgaver: 1.500 × 2/uge × 11 uger = **33.000**
- Missioner: 2,53 missioner × 6.000 = **15.190**
- **Total: 48.190/sæson**

**Gate-resultat: [2%, 15%] af typisk sæson-indkomst — pr. division:**

| Division | Spend | Indkomst | Andel | Gate |
|---|---|---|---|---|
| D1 | 48.190 | 760.000 | 6,3% | ✅ PASS |
| D2 | 48.190 | 470.000 | 10,3% | ✅ PASS |
| D3 | 48.190 | 365.000 | 13,2% | ✅ PASS |

**Sensitivitet (sæson-længde 10/11/12 uger):** D1 5,8–6,9%, D2 9,3–11,2%, D3 12,0–14,4% — inden for båndet i hele spændet.

### Verdict: ✅ PASS (efter rekalibrering)

## 3b. Historik: første kørsel med oprindelige defaults — ❌ FAIL (bevaret som beslutningsgrundlag)

Oprindelige plan-defaults 15.000/step + 60.000/mission gav total 646.899/sæson = 85,1% (D1) / 137,6% (D2) / 177,2% (D3), robust 77-193% over 10-12 uger.

Slice-D-agenten fulgte instruksen "ændr ikke defaults" og dokumenterede fejlen; arkitekt-sessionen traf derefter rekalibreringsbeslutningen (kandidat 1 nedenfor, afrundet til 1.000/6.000).

**Rod-årsag:** ved den antagne kadence (2 målrettede opgaver/uge + 1 mission/måned) æder standard-omkostningerne 77–193% af sæson-indkomsten afhængigt af division — 5-13× over gate-loftet (15%). Dette er en meget aggressiv "aktiv manager"-profil: med kapacitet=1 (kun 2 ved spejder-overall≥80) og en varighed på 3-6 dage/målrettet opgave er 2 NYE opgaver/uge teknisk muligt (opgaverne løber sekventielt, hver er kortere end en uge), men det betyder reelt at spejderen kører for FULD kapacitet uafbrudt hele sæsonen — det er den mest ekstreme, ikke den typiske, brug.

**Kandidat-justeringer (kandidat 1 valgt af arkitekten, afrundet til 1.000/6.000):**
1. **Skalér costs ned ×0,06** (target ≈ 926/step, mission ≈ 3.705) → centrerer D2-spend midt i båndet (~8,5%). Virker urealistisk lavt i absolutte tal — signalerer at enten profilen eller loftet (15%) bør revurderes, ikke nødvendigvis costs.
2. **Reducér frekvens-antagelsen** i modellen — "2 opgaver/uge + 1 mission/måned" er en model-profil for Slice-D-gaten, ikke en hård cap på hvad spillere rent faktisk kan/vil bruge. En mere realistisk "typisk aktiv" (fx 1 opgave/uge + 1 mission hver 2. måned) ville halvere-tredoble spend og lande tættere på båndet — men er en ANDEN antagelse end den brief eksplicit angav, så den er ikke substitueret her uden ejer-go.
3. **Accepter som top-of-range**: båndet [2%, 15%] er formuleret for en "typisk" aktiv manager; hvis den givne profil reelt beskriver en MEGET aktiv/hardcore spiller (konstant fuld kapacitet), kan et bredere loft for den øvre grænse være mere retvisende end at ændre `SCOUT_JOB_CONFIG`.

**Arkitekt-begrundelse for kandidat 1:** profilen (fuld spejder-kapacitet hele sæsonen) er den ØVRE grænse for spend — costs skal sættes så selv dén ligger i båndet, ellers straffes aktiv brug af en kernemekanik. Absolutte tal (1.000/step) er lave, men konsistente med at scouting-viden er en prioriterings-mekanik, ikke en pengesink (fair-premium-princippet, spec beslutning 2). **Ejer sanity-tjekker tallene ved review før Slice C-merge** — de er trivielt justerbare i `SCOUT_JOB_CONFIG` uden migration.

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
| Travel-cost-scorecard | ✅ PASS efter rekalibrering 1.000/6.000 (se §3 + §3b) |
| Full backend-suite (`npm test` i backend/) | ✅ PASS (2962/2962) |

**Ejer-review FØR Slice C merges** (jf. plan): alle gates er nu grønne; ejeren sanity-tjekker de rekalibrerede absolutte tal (1.000/step, 6.000/mission) og bånd-tabellerne ovenfor.
