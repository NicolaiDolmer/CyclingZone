# Løn-decoupling slice A — shadow-scorecard (#2428)

- Population: 1589 owned-ryttere med løn (4313 sprunget over)
- Global reference-sats = 0.1785 (gammel market_value-rate: 0.067)
- **Kalibreret SALARY_RATE_PROD pr. division:** D1 0.2980 · D2 0.3218 · D3 0.1644 · D4 0.2397

## G1 · Lønbyrde-kontinuitet pr. division (±15%) — ✅
| Div | Sats | Nuværende | Projiceret | Drift | Ryttere |
|--:|--:|--:|--:|--:|--:|
| 1 | 0.2980 | 0.08M | 0.08M | 0.0% | 185 |
| 2 | 0.3218 | 0.18M | 0.18M | 0.0% | 364 |
| 3 | 0.1644 | 2.20M | 2.20M | 0.0% | 917 |
| 4 | 0.2397 | 0.30M | 0.30M | 0.0% | 123 |

## G2 · Talent-fix (løn < sponsor 0.24M + lavere end market_value-kobling) — ✅
| Rytter | Alder | Overall | v4-værdi | Ny løn | Gl. løn (v4·0,067) |
|--|--:|--:|--:|--:|--:|
| 009c564b | 17 | 17 | 0.10M | 354 | 6.679 |
| 04c7b356 | 17 | 13 | 0.03M | 176 | 1.732 |
| 0c040323 | 20 | 21 | 0.04M | 404 | 2.976 |
| 10162bb2 | 18 | 22 | 0.11M | 580 | 7.555 |
| 10bb30ea | 18 | 15 | 0.03M | 160 | 2.185 |
| 11edeeb7 | 17 | 19 | 0.13M | 670 | 8.530 |
| 125eec71 | 17 | 16 | 0.11M | 537 | 7.240 |
| 137e5d24 | 19 | 21 | 0.10M | 566 | 6.696 |
| 13da4ffb | 18 | 25 | 0.40M | 1.608 | 26.791 |
| 179ac5d7 | 18 | 15 | 0.08M | 404 | 5.036 |
| 1aa5df10 | 20 | 24 | 0.09M | 588 | 6.189 |
| 1c254ba2 | 20 | 21 | 0.05M | 304 | 3.246 |
| 1c878240 | 16 | 13 | 0.07M | 344 | 4.875 |
| 1d84717b | 19 | 22 | 0.20M | 832 | 13.712 |
| 20ce83b2 | 18 | 22 | 0.18M | 975 | 12.151 |
(talenter i alt: 148)

## G4 · Ingen runaway (maks løn ≤ 0.24M) — ✅
- Højeste projicerede løn: 157.973 CZ$

## Resultat: ✅ alle hårde gates grønne
