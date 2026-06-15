# Balance-baseline — deterministisk snapshot (#1197)

> Genereret af `node backend/scripts/balanceBaseline.js --write` · seed 2026 · 800 ryttere · 300 løb/terræn · 6 progression-sæsoner · noise 0.16 · værdimodel v3 (2026-06-09)
>
> Ændrer en PR balance-følsomme filer, regenereres snapshottet og diffes mod denne baseline — diffen er reviewet. Bump: `npm run balance:baseline` (i `backend/`) + commit.

## Population

800 ryttere · overall p50 19 (p90 49, max 71) · base_value p50 23961 (p99 13116779, max 24124549)

| Type | Antal | base_value p50 | p90 | max |
|---|--:|--:|--:|--:|
| baroudeur | 80 | 12747 | 378472 | 4023015 |
| brostensrytter | 54 | 38339 | 1995148 | 7264517 |
| climber | 220 | 25085 | 853508 | 8685025 |
| gc | 33 | 852518 | 7071022 | 18129767 |
| leadout | 79 | 16697 | 541893 | 3405072 |
| puncheur | 47 | 162922 | 954669 | 4250083 |
| rouleur | 66 | 11320 | 327709 | 1799620 |
| sprinter | 55 | 47499 | 3106602 | 23802591 |
| tt | 166 | 14756 | 820583 | 24124549 |

## Race-motor (vinder-fordeling pr. terræn)

| Terræn | Nøgle-evne | Vinder ⌀ vs median | Distinkte | Stærkeste vandt | Top-vindertyper (født-som) |
|---|---|---|--:|--:|---|
| classic | endurance | 68 vs 29 | 40/300 | 39.7% | gc 47%, puncheur 36%, baroudeur 8% |
| cobbles | cobblestone | 86 vs 21 | 25/300 | 2.7% | brostensrytter 97%, gc 2%, baroudeur 0% |
| flat | sprint | 84 vs 18 | 32/300 | 2% | sprinter 90%, leadout 8%, baroudeur 1% |
| high_mountain | climbing | 90 vs 23 | 27/300 | 41% | gc 72%, climber 21%, puncheur 7% |
| hilly | punch | 82 vs 26 | 42/300 | 6.3% | puncheur 83%, gc 7%, climber 6% |
| itt | time_trial | 90 vs 18 | 25/300 | 37.3% | tt 67%, gc 33% |
| mountain | climbing | 87 vs 23 | 53/300 | 35.7% | gc 69%, climber 20%, puncheur 9% |
| rolling | endurance | 69 vs 29 | 66/300 | 37% | gc 48%, baroudeur 22%, puncheur 21% |

Udbruds-andel af bjergsejre: 0.2%

### Evne-liveness (⌀rank-gevinst pr. probe)

| Probe | ⌀rank-gevinst |
|---|--:|
| aggression@mountain-bwgap | 0.018 |
| climbing@mountain | 9.48 |
| descending@mountain | 1.43 |
| flat@rolling | 3.49 |
| sprint@flat | 10.99 |
| tempo@mountain | 2.53 |

### Grand Tour (21 etaper)

| # | Rytter | Født-som | Afledt | Tid |
|--:|---|---|---|---|
| 1 | Manuel Ferrara | gc | gc | +0:00 |
| 2 | Matej Hribar | climber | climber | +6:25 |
| 3 | Loïc Pichon | puncheur | puncheur | +8:33 |
| 4 | Lachlan Foster | gc | gc | +10:08 |
| 5 | Javier Aguilar | climber | gc | +11:31 |
| 6 | Sebastian Bergström | gc | gc | +14:20 |
| 7 | Adam Sokol | climber | climber | +14:46 |
| 8 | Cody Ward | tt | tt | +16:55 |
| 9 | Maxime Girard | climber | climber | +17:24 |
| 10 | Maarten Peeters | climber | climber | +17:34 |

Trøjer: 🟢 Loïc Pichon (puncheur) · ⛰️ Loïc Pichon (puncheur) · ⚪ Manuel Ferrara

## Progression

800 simulerede ryttere over 6 sæsoner · pension/sæson: 16, 6, 9, 19, 31, 28

| Metrik | p10 | p50 | p90 |
|---|--:|--:|--:|
| U25 ability-sum-delta/sæson | 3 | 17 | 35 |
| Ungt talent base_value ×mult (n=46) | 2.46 | 5.1 | 11.3 |
| Signatur-snit efter sim | — | 35 | 69 (p99 88, max 97) |

