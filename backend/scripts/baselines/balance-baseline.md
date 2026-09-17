# Balance-baseline — deterministisk snapshot (#1197)

> Genereret af `node backend/scripts/balanceBaseline.js --write` · seed 2026 · 800 ryttere · 300 løb/terræn · 6 progression-sæsoner · noise 0.16 · værdimodel v3 (2026-06-16)
>
> Ændrer en PR balance-følsomme filer, regenereres snapshottet og diffes mod denne baseline — diffen er reviewet. Bump: `npm run balance:baseline` (i `backend/`) + commit.

## Population

800 ryttere · overall p50 19 (p90 48, max 70) · base_value p50 18592 (p99 12294863, max 39721749)

| Type | Antal | base_value p50 | p90 | max |
|---|--:|--:|--:|--:|
| baroudeur | 129 | 6113 | 208271 | 1444617 |
| brostensrytter | 38 | 564389 | 2199805 | 4469119 |
| climber | 225 | 12107 | 557377 | 2486680 |
| gc | 35 | 1509366 | 21612470 | 38195217 |
| puncheur | 39 | 11802 | 1088570 | 2227900 |
| rouleur | 4 | 36701 | 664726 | 664726 |
| sprinter | 137 | 32614 | 1773894 | 12378738 |
| tt | 193 | 18205 | 1344418 | 39721749 |

## Race-motor (vinder-fordeling pr. terræn)

| Terræn | Nøgle-evne | Vinder ⌀ vs median | Distinkte | Stærkeste vandt | Top-vindertyper (født-som) |
|---|---|---|--:|--:|---|
| classic | endurance | 68 vs 31 | 42/300 | 50.3% | gc 58%, puncheur 22%, climber 8% |
| cobbles | cobblestone | 79 vs 21 | 39/300 | 1% | brostensrytter 94%, baroudeur 2%, gc 1% |
| flat | sprint | 87 vs 19 | 29/300 | 5% | sprinter 98%, baroudeur 1%, gc 1% |
| gravel | cobblestone | 73 vs 21 | 65/300 | 6.3% | brostensrytter 78%, gc 8%, baroudeur 4% |
| high_mountain | climbing | 90 vs 24 | 26/300 | 62% | gc 78%, climber 21%, puncheur 1% |
| hilly | punch | 74 vs 27 | 98/300 | 8.3% | puncheur 61%, gc 11%, baroudeur 9% |
| itt | time_trial | 90 vs 18 | 27/300 | 23% | tt 68%, gc 32% |
| mountain | climbing | 85 vs 24 | 74/300 | 47.7% | gc 64%, climber 25%, puncheur 6% |
| rolling | endurance | 67 vs 31 | 71/300 | 45.3% | gc 53%, baroudeur 17%, puncheur 11% |

Udbruds-andel af bjergsejre: 1.3%

### Evne-liveness (⌀rank-gevinst pr. probe)

| Probe | ⌀rank-gevinst |
|---|--:|
| aggression@mountain-bwgap | 0.024 |
| climbing@mountain | 8.78 |
| descending@mountain | 0.73 |
| flat@rolling | 3.38 |
| sprint@flat | 12.9 |
| tempo@mountain | 2.45 |

### Grand Tour (21 etaper)

| # | Rytter | Født-som | Afledt | Tid |
|--:|---|---|---|---|
| 1 | Julián Escobar | climber | climber | +0:00 |
| 2 | Diego Silvestri | gc | gc | +0:08 |
| 3 | Stanisław Wróbel | climber | climber | +1:54 |
| 4 | Keegan Fortin | gc | gc | +1:54 |
| 5 | Sem De Boer | climber | climber | +2:19 |
| 6 | Martin Marek | climber | climber | +5:49 |
| 7 | Landon Boyd | climber | climber | +6:56 |
| 8 | Callum Green | tt | tt | +7:00 |
| 9 | Sander Holmberg | climber | climber | +7:21 |
| 10 | Stijn Mertens | climber | climber | +7:23 |

Trøjer: 🟢 Julián Escobar (climber) · ⛰️ Julián Escobar (climber) · ⚪ Stanisław Wróbel

## Progression

800 simulerede ryttere over 6 sæsoner · pension/sæson: 5, 6, 12, 12, 24, 22

| Metrik | p10 | p50 | p90 |
|---|--:|--:|--:|
| U25 ability-sum-delta/sæson | 0 | 6 | 24 |
| Ungt talent base_value ×mult (n=49) | 1.84 | 3.12 | 6.57 |
| Signatur-snit efter sim | — | 31 | 68 (p99 92, max 96) |

