# Værdimodel-scorecard — ejer-verify af `base_value` (v3)

> Genereret 2026-06-10 af `node backend/scripts/valuationScorecard.js` (READ-ONLY mod prod) · Refs #1196, #1101, #1144, #1194
> Model: v3 (fittet 2026-06-09, 26 anchors, R²(log) 0.9716) · Population: 8994 ryttere, 8964 aktive, 8964 værdisat
>
> **Status-kontekst:** cutoveren (#1101 slice 2) blev udført 10/6 med ejer-go i session (PR #1201) — `base_value` driver nu økonomien. Dette scorecard gør den fulde 8.994-værdi-verifikation billig: det ratificerer gaten endeligt og er skabelonen for ejer-verify ved alle fremtidige re-fits (fase 2/3).

## 0. Sanity-gates (hårde — scriptet fejler hvis en er rød)

| Gate | Status | Detalje |
|---|:--:|---|
| Ingen aktive med base_value NULL/0 | ✅ | 0 fundet |
| Ingen negative værdier | ✅ | 0 fundet |
| Determinisme: gemt base_value = model-output (aktive) | ✅ | 0 afvigelser på 8964 ryttere |
| Monotoni-guard på [0, 86.8] | ✅ | min. hældning 0.0484 |
| Ordens-guard: anchors ≥15M i ejer-rækkefølge | ✅ | 0 hårde brud · 13 bløde (midterfelt, rapporteres kun) |

## 1. Top-20 — ser toppen rigtig ud?

| # | Rytter | Type | Alder | Felt | base_value (CZ$) |
|--:|---|---|--:|---|--:|
| 1 | Tadej Pogacar | gc | 27 | virkelig | 163.509.702 |
| 2 | Mathieu van der Poel | brostensrytter | 31 | virkelig | 110.298.285 |
| 3 | Jasper Philipsen | sprinter | 28 | virkelig | 66.577.565 |
| 4 | Mads Pedersen | brostensrytter | 30 | virkelig | 58.908.695 |
| 5 | Wout van Aert | brostensrytter | 31 | virkelig | 57.245.498 |
| 6 | Jonathan Milan | sprinter | 25 | virkelig | 46.337.831 |
| 7 | Jonas Vingegaard | gc | 29 | virkelig | 41.686.733 |
| 8 | Filippo Ganna | tt | 29 | virkelig | 38.741.317 |
| 9 | Remco Evenepoel | gc | 26 | virkelig | 37.553.248 |
| 10 | Paul Magnier | sprinter | 22 | virkelig | 27.872.671 |
| 11 | Tim Merlier | sprinter | 33 | virkelig | 25.510.022 |
| 12 | Olav Kooij | sprinter | 24 | virkelig | 22.922.637 |
| 13 | Arnaud De Lie | sprinter | 24 | virkelig | 22.077.052 |
| 14 | Kaden Groves | sprinter | 27 | virkelig | 20.104.371 |
| 15 | Søren Wærenskjold | sprinter | 26 | virkelig | 19.610.492 |
| 16 | Paul Seixas | gc | 19 | virkelig | 19.393.837 |
| 17 | Jordi Meeus | sprinter | 27 | virkelig | 17.541.969 |
| 18 | Biniam Girmay | sprinter | 26 | virkelig | 16.801.190 |
| 19 | Isaac del Toro | gc | 22 | virkelig | 16.170.595 |
| 20 | Tobias Lund Andresen | sprinter | 23 | virkelig | 16.093.516 |

## 2. Bund-20 — ser bunden rigtig ud?

Ingen-bund-direktivet (ejer 7/6): dårligste ryttere må gerne ligge spredt under/over ~1.000 CZ$.

| # | Rytter | Type | Alder | Felt | base_value (CZ$) |
|--:|---|---|--:|---|--:|
| 8964 | Jacob Torres | tt | 33 | virkelig | 2.295 |
| 8963 | Marat Derevyankin | tt | 39 | virkelig | 2.295 |
| 8962 | Jonathan Martin | tt | 40 | virkelig | 2.295 |
| 8961 | Derek Horton | tt | 53 | virkelig | 2.295 |
| 8960 | Sinjae Won | tt | 38 | virkelig | 2.307 |
| 8959 | Jacob Jones | tt | 29 | virkelig | 2.307 |
| 8958 | Kurstan Omurzakov | tt | 35 | virkelig | 2.316 |
| 8957 | Jiachen Xue | tt | 34 | virkelig | 2.320 |
| 8956 | Peter Lombard | tt | 50 | virkelig | 2.333 |
| 8955 | Mohamed Tabt | tt | 30 | virkelig | 2.337 |
| 8954 | Ruslan Amankulov | tt | 20 | virkelig | 2.358 |
| 8953 | Nikolai Krivtsov | tt | 19 | virkelig | 2.358 |
| 8952 | Ryosuke Hashimoto | tt | 34 | virkelig | 2.367 |
| 8951 | Xinhao Qu | tt | 22 | virkelig | 2.384 |
| 8950 | Wendi Jiang | tt | 18 | virkelig | 2.384 |
| 8949 | Jelle Roelandt | tt | 25 | virkelig | 2.389 |
| 8948 | Ramin Akbari | tt | 21 | virkelig | 2.389 |
| 8947 | Jiawei Cui | tt | 29 | virkelig | 2.411 |
| 8946 | Babacar Atta Fall | tt | 17 | virkelig | 2.411 |
| 8945 | Muhammet Kerem Bayram | tt | 20 | virkelig | 2.424 |

## 3. Fordeling — percentil-kurve mod pyramide-båndene (#1194)

| Percentil | base_value (CZ$) | Bånd |
|---|--:|---|
| p1 | 2.678 | Domestik (<200k) |
| p5 | 5.249 | Domestik (<200k) |
| p10 | 8.558 | Domestik (<200k) |
| p25 | 20.220 | Domestik (<200k) |
| p50 | 44.678 | Domestik (<200k) |
| p75 | 117.254 | Domestik (<200k) |
| p90 | 486.085 | Solid (200k–1M) |
| p95 | 1.218.106 | Stjerne (1–8M) |
| p99 | 4.586.318 | Stjerne (1–8M) |
| p99,9 | 37.553.248 | Superstjerne (≥8M) |
| max | 163.509.702 | Superstjerne (≥8M) |

| Bånd | Antal | Andel | |
|---|--:|--:|---|
| Superstjerne (≥8M) | 43 | 0.5% | `█` |
| Stjerne (1–8M) | 505 | 5.6% | `██` |
| Solid (200k–1M) | 998 | 11.1% | `████` |
| Domestik (<200k) | 7.418 | 82.8% | `██████████████████████████████` |

Design-pyramiden 12/60/230/500 (#1194) gælder det FIKTIVE launch-felt på 800 (genereres ved relaunch-swap 20/6; verificeret i `fictionalLaunchPopulation.test.js`: 12/68/203/517). Tabellen her er hele prod-feltet (8964 virkelige + 0 fiktive aktive) — forventningen er en bund-tung peloton-pyramide, ikke 12/60/230/500.

## 4. Outliers — de 10 ryttere hvor modellen gætter mest

Modellen er anchor-kalibreret på output-intervallet [30.1, 86.8]. Udenfor er værdien ekstrapoleret (under bund-anchoren) eller klampet (over `output_max`, Ward-guarden fra 10/6). 3.253 aktive (36.3% af feltet) ligger under intervallet, 0 over — men de 3.253 under udgør kun 1.84% af feltets samlede værdi: ekstrapolationen gætter altså udelukkende i den billige ende. Overlap med bund-20 er forventet — bunden ER der hvor modellen har mindst anchor-støtte.

| Rytter | Type | Alder | Output O | Speciale | Snit | Type-offset | base_value (CZ$) | Hvorfor |
|---|---|--:|--:|--:|--:|--:|--:|---|
| Derek Horton | tt | 53 | 1.0 | 1.0 | 1.0 | ×0.71 | 2.295 | O 29.1 under bund-anchor (30.1) — ekstrapoleret |
| Jonathan Martin | tt | 40 | 1.0 | 1.0 | 1.0 | ×0.71 | 2.295 | O 29.1 under bund-anchor (30.1) — ekstrapoleret |
| Marat Derevyankin | tt | 39 | 1.0 | 1.0 | 1.0 | ×0.71 | 2.295 | O 29.1 under bund-anchor (30.1) — ekstrapoleret |
| Jacob Torres | tt | 33 | 1.0 | 1.0 | 1.0 | ×0.71 | 2.295 | O 29.1 under bund-anchor (30.1) — ekstrapoleret |
| Jacob Jones | tt | 29 | 1.1 | 1.0 | 1.2 | ×0.71 | 2.307 | O 29.0 under bund-anchor (30.1) — ekstrapoleret |
| Sinjae Won | tt | 38 | 1.1 | 1.0 | 1.2 | ×0.71 | 2.307 | O 29.0 under bund-anchor (30.1) — ekstrapoleret |
| Kurstan Omurzakov | tt | 35 | 1.2 | 1.0 | 1.4 | ×0.71 | 2.316 | O 28.9 under bund-anchor (30.1) — ekstrapoleret |
| Jiachen Xue | tt | 34 | 1.2 | 1.0 | 1.4 | ×0.71 | 2.320 | O 28.9 under bund-anchor (30.1) — ekstrapoleret |
| Peter Lombard | tt | 50 | 1.3 | 1.0 | 1.6 | ×0.71 | 2.333 | O 28.8 under bund-anchor (30.1) — ekstrapoleret |
| Mohamed Tabt | tt | 30 | 1.4 | 1.0 | 1.7 | ×0.71 | 2.337 | O 28.7 under bund-anchor (30.1) — ekstrapoleret |

Værdi-drivere pr. række: `ln(v) = a + b·O + c·O² + offset[type]`, hvor O = 0,5·speciale + 0,5·snit. Kolonnerne viser præcis de inputs der sætter værdien.

## 5. Anchor-afvigelser — de 26 fit-anchors (predicted vs dit mål)

| Anchor | Type | Output | Mål (CZ$) | Predicted (CZ$) | × af mål | Prod nu (CZ$) |
|---|---|--:|--:|--:|--:|--:|
| Tadej Pogacar | gc | 86.8 | 125.000.000 | 163.513.422 | ×1.31 | 163.509.702 |
| Mathieu van der Poel | brostensrytter | 84.2 | 95.000.000 | 110.300.786 | ×1.16 | 110.298.285 |
| Jasper Philipsen | sprinter | 76.1 | 65.000.000 | 66.578.924 | ×1.02 | 66.577.565 |
| Filippo Ganna | tt | 80.6 | 50.000.000 | 38.742.146 | ×0.77 | 38.741.317 |
| Jonathan Milan | sprinter | 74.1 | 45.000.000 | 46.338.753 | ×1.03 | 46.337.831 |
| Tim Merlier | sprinter | 70.8 | 30.000.000 | 25.510.507 | ×0.85 | 25.510.022 |
| Paul Magnier | sprinter | 71.3 | 25.000.000 | 27.873.206 | ×1.11 | 27.872.671 |
| Michael Matthews | brostensrytter | 70.8 | 13.000.000 | 8.917.747 | ×0.69 | 8.917.576 |
| Toms Skujins | rouleur | 71.7 | 8.000.000 | 5.532.366 | ×0.69 | 5.532.261 |
| Quinn Simmons | rouleur | 73.2 | 8.000.000 | 7.181.968 | ×0.90 | 7.181.829 |
| Florian Vermeersch | brostensrytter | 71.5 | 8.000.000 | 10.044.381 | ×1.26 | 10.044.186 |
| Kévin Vauquelin | gc | 68.6 | 7.000.000 | 5.277.269 | ×0.75 | 5.277.173 |
| Magnus Sheffield | tt | 69.4 | 6.000.000 | 4.911.303 | ×0.82 | 4.911.212 |
| Mathys Rondel | gc | 63.4 | 6.000.000 | 2.175.575 | ×0.36 ⚠ | 2.175.539 |
| Jonas Abrahamsen | rouleur | 73.8 | 5.000.000 | 8.053.702 | ×1.61 | 8.053.545 |
| Antonio Tiberi | gc | 69.4 | 5.000.000 | 5.985.704 | ×1.20 | 5.985.595 |
| Andreas Leknessund | gc | 65.4 | 5.000.000 | 3.050.636 | ×0.61 | 3.050.584 |
| Marc Soler | gc | 66.7 | 3.500.000 | 3.763.911 | ×1.08 | 3.763.845 |
| Clément Champoussin | puncheur | 68.4 | 3.000.000 | 3.000.000 | ×1.00 | 2.999.944 |
| Ethan Hayter | tt | 68.1 | 2.500.000 | 3.941.675 | ×1.58 | 3.941.604 |
| Diego Uriarte | climber | 55.4 | 900.000 | 900.000 | ×1.00 | 899.986 |
| Luca Vergallito | gc | 57.6 | 500.000 | 881.687 | ×1.76 | 881.673 |
| Krists Neilands | gc | 58.5 | 500.000 | 1.009.512 | ×2.02 ⚠ | 1.009.496 |
| Guillaume Seye | leadout | 45.8 | 200.000 | 202.531 | ×1.01 | 202.529 |
| Ian Kimpe | leadout | 35.0 | 60.000 | 55.039 | ×0.92 | 55.038 |
| D'Arcy Sanders | leadout | 30.1 | 30.000 | 32.295 | ×1.08 | 32.295 |

2 anchors afviger mere end ×2/÷2 fra dit mål (Mathys Rondel, Krists Neilands). R²(log) 0.9716 betyder at kurven samlet følger dine anchors tæt; enkelt-afvigelser er anchor/ability-uenigheder, ikke fit-fejl.

## 6. Ejer-beslutning

**Godkend cutover? (ja/nej)**

- **Ja** → #1101 slice 2-gaten er endeligt kvitteret (cutoveren kørte 10/6, PR #1201, og står). #1196 kan lukkes.
- **Nej** → tabel 4+5 ER fejl-rapporten: justér/tilføj anchors i `backend/lib/riderValuationAnchors.json` → `node scripts/fitRiderValuationModel.js` → `node scripts/backfillRiderBaseValue.js` → kør dette scorecard igen.

