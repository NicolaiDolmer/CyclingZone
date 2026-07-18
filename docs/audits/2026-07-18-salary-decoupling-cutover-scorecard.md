# Løn-decoupling slice A — shadow-scorecard (#2428)

- Population: 1608 owned-ryttere med løn (4322 sprunget over)
- Global reference-sats = 0.1606 (gammel market_value-rate: 0.067)
- **Kalibreret SALARY_RATE_PROD pr. division:** D1 0.3029 · D2 0.3238 · D3 0.1481 · D4 0.2087

## G1 · Lønbyrde-kontinuitet pr. division (±15%) — ✅
| Div | Sats | Nuværende | Projiceret | Drift | Ryttere |
|--:|--:|--:|--:|--:|--:|
| 1 | 0.3029 | 0.08M | 0.08M | 0.0% | 185 |
| 2 | 0.3238 | 0.18M | 0.18M | -0.0% | 364 |
| 3 | 0.1481 | 2.34M | 2.34M | -0.0% | 929 |
| 4 | 0.2087 | 0.30M | 0.30M | -0.0% | 130 |

## G2 · Talent-fix (løn < sponsor 0.24M + lavere end market_value-kobling) — ✅
| Rytter | Alder | Overall | v4-værdi | Ny løn | Gl. løn (v4·0,067) |
|--|--:|--:|--:|--:|--:|
| 009c564b | 17 | 17 | 0.12M | 347 | 8.104 |
| 04c7b356 | 17 | 13 | 0.03M | 178 | 2.218 |
| 0c040323 | 20 | 21 | 0.05M | 386 | 3.556 |
| 10162bb2 | 18 | 23 | 0.14M | 615 | 9.676 |
| 10bb30ea | 18 | 16 | 0.04M | 154 | 2.578 |
| 11edeeb7 | 17 | 20 | 0.16M | 643 | 10.445 |
| 125eec71 | 17 | 17 | 0.14M | 590 | 9.618 |
| 137e5d24 | 19 | 22 | 0.14M | 634 | 9.464 |
| 13da4ffb | 18 | 26 | 0.51M | 1.690 | 34.107 |
| 179ac5d7 | 18 | 15 | 0.10M | 425 | 6.723 |
| 1aa5df10 | 20 | 24 | 0.11M | 590 | 7.477 |
| 1c254ba2 | 20 | 21 | 0.06M | 301 | 3.893 |
| 1c878240 | 16 | 15 | 0.11M | 415 | 7.456 |
| 1d84717b | 19 | 22 | 0.25M | 849 | 17.077 |
| 20ce83b2 | 18 | 22 | 0.25M | 1.121 | 16.679 |
(talenter i alt: 148)

## G4 · Ingen runaway (maks løn ≤ 0.24M) — ✅
- Højeste projicerede løn: 191.858 CZ$

## Resultat: ✅ alle hårde gates grønne
