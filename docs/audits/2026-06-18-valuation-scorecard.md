# Værdimodel-scorecard — ejer-verify af `base_value` (v3)

> Genereret 2026-06-18 af `node backend/scripts/valuationScorecard.js` (READ-ONLY mod prod) · Refs #1196, #1101, #1144, #1194
> Model: v3 (fittet 2026-06-16, 26 anchors, R²(log) 0.9589) · Population: 9000 ryttere, 8970 aktive, 8964 værdisat
>
> **Status-kontekst:** cutoveren (#1101 slice 2) blev udført 10/6 med ejer-go i session (PR #1201) — `base_value` driver nu økonomien. Dette scorecard gør den fulde 8.994-værdi-verifikation billig: det ratificerer gaten endeligt og er skabelonen for ejer-verify ved alle fremtidige re-fits (fase 2/3).

## 0. Sanity-gates (hårde — scriptet fejler hvis en er rød)

| Gate | Status | Detalje |
|---|:--:|---|
| Ingen aktive med base_value NULL/0 | ❌ | 6 fundet (fx WF01Reserved Lead1781770699063914551, WF01SoonTarget FirstBid1781775762650495324, WF01OldReserved Lead1781774535415503253) |
| Ingen negative værdier | ✅ | 0 fundet |
| Determinisme: gemt base_value = model-output (aktive) | ✅ | 0 afvigelser på 8964 ryttere |
| Monotoni-guard på [0, 91] | ✅ | min. hældning 0.0694 |
| Ordens-guard: anchors ≥15M i ejer-rækkefølge | ✅ | 0 hårde brud · 10 bløde (midterfelt, rapporteres kun) |

## 1. Top-20 — ser toppen rigtig ud?

| # | Rytter | Type | Alder | Felt | base_value (CZ$) |
|--:|---|---|--:|---|--:|
| 1 | Tadej Pogacar | climber | 27 | virkelig | 189.085.427 |
| 2 | Mathieu van der Poel | brostensrytter | 31 | virkelig | 99.023.191 |
| 3 | Remco Evenepoel | gc | 26 | virkelig | 53.885.835 |
| 4 | Mads Pedersen | brostensrytter | 30 | virkelig | 53.770.857 |
| 5 | Wout van Aert | brostensrytter | 31 | virkelig | 51.987.489 |
| 6 | Jasper Philipsen | sprinter | 28 | virkelig | 46.692.684 |
| 7 | Jonas Vingegaard | climber | 29 | virkelig | 39.927.089 |
| 8 | Filippo Ganna | tt | 29 | virkelig | 39.178.360 |
| 9 | Jonathan Milan | sprinter | 25 | virkelig | 28.849.250 |
| 10 | Paul Seixas | climber | 19 | virkelig | 23.366.883 |
| 11 | Matthew Brennan | sprinter | 20 | virkelig | 22.652.934 |
| 12 | Juan Ayuso | gc | 23 | virkelig | 22.233.650 |
| 13 | Paul Magnier | sprinter | 22 | virkelig | 20.381.750 |
| 14 | Tim Merlier | sprinter | 33 | virkelig | 18.805.739 |
| 15 | Joshua Tarling | tt | 22 | virkelig | 17.867.678 |
| 16 | Tom Pidcock | climber | 26 | virkelig | 17.630.474 |
| 17 | Derek Gee-West | gc | 28 | virkelig | 17.618.719 |
| 18 | Arnaud De Lie | sprinter | 24 | virkelig | 17.168.843 |
| 19 | Primož Roglic | gc | 36 | virkelig | 15.889.756 |
| 20 | Olav Kooij | sprinter | 24 | virkelig | 15.680.868 |

## 2. Bund-20 — ser bunden rigtig ud?

Ingen-bund-direktivet (ejer 7/6): dårligste ryttere må gerne ligge spredt under/over ~1.000 CZ$.

| # | Rytter | Type | Alder | Felt | base_value (CZ$) |
|--:|---|---|--:|---|--:|
| 8964 | Jacob Torres | climber | 33 | virkelig | 1.318 |
| 8963 | Marat Derevyankin | climber | 39 | virkelig | 1.318 |
| 8962 | Jonathan Martin | climber | 40 | virkelig | 1.318 |
| 8961 | Derek Horton | climber | 53 | virkelig | 1.318 |
| 8960 | Sinjae Won | climber | 38 | virkelig | 1.329 |
| 8959 | Jacob Jones | climber | 29 | virkelig | 1.329 |
| 8958 | Kurstan Omurzakov | climber | 35 | virkelig | 1.336 |
| 8957 | Jiachen Xue | climber | 34 | virkelig | 1.339 |
| 8956 | Dan Aponik | climber | 54 | virkelig | 1.339 |
| 8955 | Mohamed Tabt | climber | 30 | virkelig | 1.354 |
| 8954 | Ruslan Amankulov | climber | 20 | virkelig | 1.373 |
| 8953 | Nikolai Krivtsov | climber | 19 | virkelig | 1.373 |
| 8952 | Aleksei Mikhailov | climber | 29 | virkelig | 1.386 |
| 8951 | Xinhao Qu | climber | 22 | virkelig | 1.396 |
| 8950 | Jelle Roelandt | climber | 25 | virkelig | 1.400 |
| 8949 | Ramin Akbari | climber | 21 | virkelig | 1.400 |
| 8948 | Peter Lombard | climber | 50 | virkelig | 1.414 |
| 8947 | Wendi Jiang | climber | 18 | virkelig | 1.418 |
| 8946 | Hwiseo Moonshin | climber | 21 | virkelig | 1.419 |
| 8945 | Babacar Atta Fall | climber | 17 | virkelig | 1.419 |

## 3. Fordeling — percentil-kurve mod pyramide-båndene (#1194)

| Percentil | base_value (CZ$) | Bånd |
|---|--:|---|
| p1 | 1.988 | Domestik (<200k) |
| p5 | 3.226 | Domestik (<200k) |
| p10 | 4.956 | Domestik (<200k) |
| p25 | 13.292 | Domestik (<200k) |
| p50 | 38.905 | Domestik (<200k) |
| p75 | 115.717 | Domestik (<200k) |
| p90 | 491.126 | Solid (200k–1M) |
| p95 | 1.350.695 | Stjerne (1–8M) |
| p99 | 5.869.789 | Stjerne (1–8M) |
| p99,9 | 28.849.250 | Superstjerne (≥8M) |
| max | 189.085.427 | Superstjerne (≥8M) |

| Bånd | Antal | Andel | |
|---|--:|--:|---|
| Superstjerne (≥8M) | 50 | 0.6% | `█` |
| Stjerne (1–8M) | 524 | 5.8% | `██` |
| Solid (200k–1M) | 983 | 11.0% | `████` |
| Domestik (<200k) | 7.407 | 82.6% | `██████████████████████████████` |

Design-pyramiden 12/60/230/500 (#1194) gælder det FIKTIVE launch-felt på 800 (genereres ved relaunch-swap 20/6; verificeret i `fictionalLaunchPopulation.test.js`: 12/68/203/517). Tabellen her er hele prod-feltet (8964 virkelige + 0 fiktive aktive) — forventningen er en bund-tung peloton-pyramide, ikke 12/60/230/500.

## 4. Outliers — de 10 ryttere hvor modellen gætter mest

Modellen er anchor-kalibreret på output-intervallet [30.1, 91.0]. Udenfor er værdien ekstrapoleret (under bund-anchoren) eller klampet (over `output_max`, Ward-guarden fra 10/6). 3.203 aktive (35.7% af feltet) ligger under intervallet, 0 over — men de 3.203 under udgør kun 1.50% af feltets samlede værdi: ekstrapolationen gætter altså udelukkende i den billige ende. Overlap med bund-20 er forventet — bunden ER der hvor modellen har mindst anchor-støtte.

| Rytter | Type | Alder | Output O | Speciale | Snit | Type-offset | base_value (CZ$) | Hvorfor |
|---|---|--:|--:|--:|--:|--:|--:|---|
| Derek Horton | climber | 53 | 1.0 | 1.0 | 1.0 | ×0.66 | 1.318 | O 29.1 under bund-anchor (30.1) — ekstrapoleret |
| Jonathan Martin | climber | 40 | 1.0 | 1.0 | 1.0 | ×0.66 | 1.318 | O 29.1 under bund-anchor (30.1) — ekstrapoleret |
| Marat Derevyankin | climber | 39 | 1.0 | 1.0 | 1.0 | ×0.66 | 1.318 | O 29.1 under bund-anchor (30.1) — ekstrapoleret |
| Jacob Torres | climber | 33 | 1.0 | 1.0 | 1.0 | ×0.66 | 1.318 | O 29.1 under bund-anchor (30.1) — ekstrapoleret |
| Jacob Jones | climber | 29 | 1.1 | 1.0 | 1.2 | ×0.66 | 1.329 | O 29.0 under bund-anchor (30.1) — ekstrapoleret |
| Sinjae Won | climber | 38 | 1.1 | 1.0 | 1.2 | ×0.66 | 1.329 | O 29.0 under bund-anchor (30.1) — ekstrapoleret |
| Kurstan Omurzakov | climber | 35 | 1.2 | 1.0 | 1.4 | ×0.66 | 1.336 | O 28.9 under bund-anchor (30.1) — ekstrapoleret |
| Dan Aponik | climber | 54 | 1.2 | 1.0 | 1.5 | ×0.66 | 1.339 | O 28.9 under bund-anchor (30.1) — ekstrapoleret |
| Jiachen Xue | climber | 34 | 1.2 | 1.0 | 1.5 | ×0.66 | 1.339 | O 28.9 under bund-anchor (30.1) — ekstrapoleret |
| Mohamed Tabt | climber | 30 | 1.4 | 1.0 | 1.8 | ×0.66 | 1.354 | O 28.7 under bund-anchor (30.1) — ekstrapoleret |

Værdi-drivere pr. række: `ln(v) = a + b·O + c·O² + offset[type]`, hvor O = 0,5·speciale + 0,5·snit. Kolonnerne viser præcis de inputs der sætter værdien.

## 5. Anchor-afvigelser — de 26 fit-anchors (predicted vs dit mål)

| Anchor | Type | Output | Mål (CZ$) | Predicted (CZ$) | × af mål | Prod nu (CZ$) |
|---|---|--:|--:|--:|--:|--:|
| Tadej Pogacar | climber | 91.0 | 125.000.000 | 189.086.195 | ×1.51 | 189.085.427 |
| Mathieu van der Poel | brostensrytter | 84.3 | 95.000.000 | 99.023.636 | ×1.04 | 99.023.191 |
| Jasper Philipsen | sprinter | 76.4 | 65.000.000 | 46.692.856 | ×0.72 | 46.692.684 |
| Filippo Ganna | tt | 80.5 | 50.000.000 | 39.178.511 | ×0.78 | 39.178.360 |
| Jonathan Milan | sprinter | 73.6 | 45.000.000 | 28.849.353 | ×0.64 | 28.849.250 |
| Tim Merlier | sprinter | 71.1 | 30.000.000 | 18.805.803 | ×0.63 | 18.805.739 |
| Paul Magnier | sprinter | 71.5 | 25.000.000 | 20.381.820 | ×0.82 | 20.381.750 |
| Michael Matthews | brostensrytter | 70.9 | 13.000.000 | 9.575.251 | ×0.74 | 9.575.215 |
| Toms Skujins | rouleur | 72.1 | 8.000.000 | 5.520.377 | ×0.69 | 5.520.358 |
| Quinn Simmons | rouleur | 73.4 | 8.000.000 | 6.939.849 | ×0.87 | 6.939.825 |
| Florian Vermeersch | brostensrytter | 71.4 | 8.000.000 | 10.420.005 | ×1.30 | 10.419.965 |
| Kévin Vauquelin | climber | 71.8 | 7.000.000 | 6.013.161 | ×0.86 | 6.013.143 |
| Magnus Sheffield | gc | 65.6 | 6.000.000 | 5.575.502 | ×0.93 | 5.575.486 |
| Mathys Rondel | climber | 67.9 | 6.000.000 | 3.151.098 | ×0.53 | 3.151.089 |
| Jonas Abrahamsen | rouleur | 74.5 | 5.000.000 | 8.352.784 | ×1.67 | 8.352.754 |
| Antonio Tiberi | climber | 71.1 | 5.000.000 | 5.313.933 | ×1.06 | 5.313.917 |
| Andreas Leknessund | gc | 65.4 | 5.000.000 | 5.380.682 | ×1.08 | 5.380.667 |
| Marc Soler | climber | 68.5 | 3.500.000 | 3.454.040 | ×0.99 | 3.454.030 |
| Clément Champoussin | puncheur | 68.7 | 3.000.000 | 1.996.563 | ×0.67 | 1.996.555 |
| Ethan Hayter | tt | 66.5 | 2.500.000 | 3.629.759 | ×1.45 | 3.629.747 |
| Diego Uriarte | climber | 55.7 | 900.000 | 483.665 | ×0.54 | 483.664 |
| Luca Vergallito | climber | 62.3 | 500.000 | 1.299.862 | ×2.60 ⚠ | 1.299.858 |
| Krists Neilands | puncheur | 62.5 | 500.000 | 751.291 | ×1.50 | 751.289 |
| Guillaume Seye | tt | 45.7 | 200.000 | 175.798 | ×0.88 | 175.798 |
| Ian Kimpe | sprinter | 35.3 | 60.000 | 117.489 | ×1.96 | 117.488 |
| D'Arcy Sanders | sprinter | 30.1 | 30.000 | 65.094 | ×2.17 ⚠ | 65.094 |

2 anchors afviger mere end ×2/÷2 fra dit mål (Luca Vergallito, D'Arcy Sanders). R²(log) 0.9589 betyder at kurven samlet følger dine anchors tæt; enkelt-afvigelser er anchor/ability-uenigheder, ikke fit-fejl.

## 6. Ejer-beslutning

**Godkend cutover? (ja/nej)**

- **Ja** → #1101 slice 2-gaten er endeligt kvitteret (cutoveren kørte 10/6, PR #1201, og står). #1196 kan lukkes.
- **Nej** → tabel 4+5 ER fejl-rapporten: justér/tilføj anchors i `backend/lib/riderValuationAnchors.json` → `node scripts/fitRiderValuationModel.js` → `node scripts/backfillRiderBaseValue.js` → kør dette scorecard igen.

