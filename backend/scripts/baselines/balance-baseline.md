# Balance-baseline — deterministisk snapshot (#1197)

> Genereret af `node backend/scripts/balanceBaseline.js --write` · seed 2026 · 800 ryttere · 300 løb/terræn · 6 progression-sæsoner · noise 0.16 · værdimodel v3 (2026-06-16)
>
> Ændrer en PR balance-følsomme filer, regenereres snapshottet og diffes mod denne baseline — diffen er reviewet. Bump: `npm run balance:baseline` (i `backend/`) + commit.

## Population

800 ryttere · overall p50 20 (p90 49, max 71) · base_value p50 19304 (p99 16174663, max 64655557)

| Type | Antal | base_value p50 | p90 | max |
|---|--:|--:|--:|--:|
| baroudeur | 97 | 7283 | 296552 | 777097 |
| brostensrytter | 33 | 729158 | 2718910 | 5807542 |
| climber | 242 | 13521 | 653160 | 6325096 |
| gc | 30 | 1270229 | 34720356 | 52856429 |
| puncheur | 13 | 10505 | 515537 | 1297729 |
| rouleur | 2 | 808010 | 808010 | 808010 |
| sprinter | 127 | 34220 | 2108538 | 13429799 |
| tt | 256 | 14489 | 1001964 | 64655557 |

## Race-motor (vinder-fordeling pr. terræn)

| Terræn | Nøgle-evne | Vinder ⌀ vs median | Distinkte | Stærkeste vandt | Top-vindertyper (født-som) |
|---|---|---|--:|--:|---|
| classic | endurance | 74 vs 29 | 35/300 | 50.3% | gc 51%, puncheur 24%, climber 11% |
| cobbles | cobblestone | 82 vs 18 | 38/300 | 2.3% | brostensrytter 93%, gc 3%, puncheur 1% |
| flat | sprint | 86 vs 18 | 30/300 | 2.7% | sprinter 99%, tt 1%, baroudeur 0% |
| high_mountain | climbing | 92 vs 23 | 22/300 | 61.3% | gc 80%, climber 15%, puncheur 6% |
| hilly | punch | 75 vs 26 | 90/300 | 14.7% | puncheur 62%, climber 12%, gc 10% |
| itt | time_trial | 91 vs 23 | 27/300 | 24% | tt 73%, gc 27% |
| mountain | climbing | 87 vs 23 | 66/300 | 54.3% | gc 68%, climber 21%, puncheur 7% |
| rolling | endurance | 73 vs 29 | 64/300 | 43.7% | gc 53%, puncheur 17%, baroudeur 15% |

Udbruds-andel af bjergsejre: 1.3%

### Evne-liveness (⌀rank-gevinst pr. probe)

| Probe | ⌀rank-gevinst |
|---|--:|
| aggression@mountain-bwgap | 0.017 |
| climbing@mountain | 10.86 |
| descending@mountain | 0.74 |
| flat@rolling | 3.48 |
| sprint@flat | 12.61 |
| tempo@mountain | 2.39 |

### Grand Tour (21 etaper)

| # | Rytter | Født-som | Afledt | Tid |
|--:|---|---|---|---|
| 1 | Keegan Fortin | gc | gc | +0:00 |
| 2 | Stanisław Wróbel | climber | climber | +6:56 |
| 3 | Diego Silvestri | gc | gc | +11:03 |
| 4 | Magnus Mortensen | gc | climber | +11:48 |
| 5 | Martin Marek | climber | climber | +12:47 |
| 6 | Julián Escobar | climber | climber | +13:14 |
| 7 | Giulio De Luca | puncheur | climber | +13:48 |
| 8 | Callum Green | tt | tt | +13:56 |
| 9 | Iván Gómez | climber | climber | +15:00 |
| 10 | Fabien Berger | climber | climber | +16:42 |

Trøjer: 🟢 Keegan Fortin (gc) · ⛰️ Stanisław Wróbel (climber) · ⚪ Callum Green

## Progression

800 simulerede ryttere over 6 sæsoner · pension/sæson: 7, 9, 6, 14, 19, 23

| Metrik | p10 | p50 | p90 |
|---|--:|--:|--:|
| U25 ability-sum-delta/sæson | 0 | 5 | 22 |
| Ungt talent base_value ×mult (n=48) | 1.55 | 2.51 | 4.85 |
| Signatur-snit efter sim | — | 32 | 68 (p99 90, max 94) |

