# Værdimodel v4 — shadow-scorecard (slice 1, #2428)

> Genereret 2026-07-18 af `node backend/scripts/valuationV4Scorecard.js` (READ-ONLY mod prod) · simulér-før-ship, ejer-gate FØR cutover (slice 2)
> v4-model: fittet 2026-07-18T19:04:14.692Z · sim_run_id 75507b50 · K=30 · discount=0.8
> Population: 6395 ægte ryttere (ekskl. akademi/pensioneret/uden hold/test-/frost-/bank-hold) · 6395 med v3+v4-værdi

## Gates

| # | Gate | Type | Status | Detalje |
|--:|---|:--:|:--:|---|
| 1 | Type-økonomi-tabel | blød/rapport | ✅ | 8 type(r) med sim-data |
| 2 | Skala-kontinuitet: median-drift v3→v4 | hård | ✅ | p10/median/p90 v3=2.500/6.937/26.115 · v4=1.603/7.251/56.879 · drift=4.5% (grænse ±15%) |
| 3 | Udvikl-og-sælg P&L: ung prospect net-positiv, ikke dominant (ROI-begrænset) | hård | ✅ | pnl=13.532.523 CZ$ (bvStart=4.500.638→bvHorisont=19.376.992, cost=1.343.832, 4 sæsoner) · net-positiv=true · ikke-dominant=true (ROI 232% vs loft 250%) |
| 4 | Symmetri: career-trajectories genereret | blød/rapport | ✅ | 3 arketyper |
| 5 | Elite ukøbelig: alle overall≥58 > råd-loft | hård | ✅ | 21 elite-ryttere · billigste=8.315.500 vs råd-loft=4.157.750 · dyreste=87.702.925 |
| 6 | Anker-sanity: top-anchor-rangorden (≥15M) — blød, rapporteres kun | blød/rapport | ✅ | ingen afvigelser fra ejer-anchor-rækkefølgen |
| 7 | Determinisme: model.sim_run_id sat | hård | ✅ | sim_run_id=75507b50 |

## 1. Type-økonomi — målt E[produktion] (sim) vs v3-offset

| Type | n | Median E[prize] | p90 E[prize] | v3 offset (log) | v3 offset ×mult |
|---|--:|--:|--:|--:|--:|
| puncheur | 19 | 67.870 | 334.313 | -1.003 | ×0.37 |
| gc | 34 | 48.065 | 563.245 | 0.520 | ×1.68 |
| brostensrytter | 59 | 23.960 | 70.475 | 0.199 | ×1.22 |
| rouleur | 122 | 5.343 | 36.203 | -0.542 | ×0.58 |
| baroudeur | 34 | 4.378 | 48.638 | — | — |
| sprinter | 1190 | 1.588 | 15.473 | 0.849 | ×2.34 |
| tt | 2622 | 465 | 4.370 | -0.053 | ×0.95 |
| climber | 1947 | 455 | 19.148 | -0.420 | ×0.66 |

## 4. Symmetri — career-trajectories (alder → E[produktion]/survival)

**Ung talent (≤21å, potentiale ≥5)**

| Alder | Output O | E[produktion] sæson (CZ$) | Survival | Diskonteret bidrag (CZ$) |
|--:|--:|--:|--:|--:|
| 17 | 21.1 | 788 | 100% | 788 |
| 18 | 36.1 | 3.231 | 100% | 2.585 |
| 19 | 44.1 | 6.710 | 100% | 4.294 |
| 20 | 49.1 | 10.512 | 100% | 5.382 |
| 21 | 51.1 | 12.559 | 100% | 5.144 |
| 22 | 52.1 | 13.722 | 100% | 4.497 |
| 23 | 53.1 | 14.990 | 100% | 3.930 |
| 24 | 53.1 | 14.990 | 100% | 3.144 |
| 25 | 53.1 | 14.990 | 100% | 2.515 |
| 26 | 53.1 | 14.990 | 100% | 2.012 |
| 27 | 53.1 | 14.990 | 100% | 1.610 |
| 28 | 53.1 | 14.990 | 100% | 1.288 |
| 29 | 53.1 | 14.990 | 100% | 1.030 |
| 30 | 52.1 | 13.722 | 100% | 754 |
| 31 | 51.1 | 12.559 | 100% | 552 |
| 32 | 50.1 | 11.491 | 100% | 404 |
| 33 | 48.1 | 9.614 | 100% | 271 |
| 34 | 46.1 | 8.035 | 100% | 181 |
| 35 | 44.1 | 6.710 | 100% | 121 |
| 36 | 41.1 | 5.110 | 100% | 74 |
| 37 | 38.1 | 3.884 | 75% | 34 |
| 38 | 35.1 | 2.946 | 38% | 10 |
| 39 | 32.1 | 2.229 | 9% | 2 |

**Peak-stjerne (25-29å, top v4-værdi)**

| Alder | Output O | E[produktion] sæson (CZ$) | Survival | Diskonteret bidrag (CZ$) |
|--:|--:|--:|--:|--:|
| 28 | 80.8 | 208.968 | 100% | 208.968 |
| 29 | 82.8 | 245.895 | 100% | 196.716 |
| 30 | 81.8 | 226.708 | 100% | 145.093 |
| 31 | 80.8 | 208.968 | 100% | 106.992 |
| 32 | 79.8 | 192.570 | 100% | 78.877 |
| 33 | 77.8 | 163.416 | 100% | 53.548 |
| 34 | 75.8 | 138.542 | 100% | 36.318 |
| 35 | 73.8 | 117.343 | 100% | 24.609 |
| 36 | 70.8 | 91.303 | 100% | 15.318 |
| 37 | 67.8 | 70.889 | 75% | 7.136 |
| 38 | 64.8 | 54.920 | 38% | 2.211 |
| 39 | 61.8 | 42.457 | 9% | 342 |

**Veteran (≥33å)**

| Alder | Output O | E[produktion] sæson (CZ$) | Survival | Diskonteret bidrag (CZ$) |
|--:|--:|--:|--:|--:|
| 35 | 7.0 | 144 | 100% | 144 |
| 36 | 4.0 | 107 | 100% | 85 |
| 37 | 1.0 | 79 | 75% | 38 |
| 38 | 0.0 | 71 | 38% | 14 |
| 39 | 0.0 | 71 | 9% | 3 |

## Ejer-beslutning

**Godkend v4 shadow → planlæg cutover (slice 2)? (ja/nej)**

- **Ja** → v4 er verificeret mod den ægte population; slice 2 (migration + `predictBaseValue`-swap) kan planlægges. Migrationen anvendes ALDRIG automatisk — ejer merger.
- **Nej** → gates ovenfor ER fejl-rapporten: justér `discount`/`beta_pt`/horisont i fit-scriptet (`scripts/fitRiderValuationV4.js`) eller sim-parametrene (`scripts/simulateSeasonProduction.js`) og kør dette scorecard igen.

