# Balance-baseline — deterministisk snapshot (#1197)

> Genereret af `node backend/scripts/balanceBaseline.js --write` · seed 2026 · 800 ryttere · 300 løb/terræn · 6 progression-sæsoner · noise 0.16 · værdimodel v3 (2026-06-09)
>
> Ændrer en PR balance-følsomme filer, regenereres snapshottet og diffes mod denne baseline — diffen er reviewet. Bump: `npm run balance:baseline` (i `backend/`) + commit.

## Population

800 ryttere · overall p50 19 (p90 49, max 71) · base_value p50 25024 (p99 13116779, max 24124549)

| Type | Antal | base_value p50 | p90 | max |
|---|--:|--:|--:|--:|
| baroudeur | 80 | 24737 | 734441 | 7806827 |
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
| classic | endurance | 69 vs 29 | 41/300 | 32.3% | gc 39%, puncheur 38%, baroudeur 10% |
| cobbles | cobblestone | 86 vs 21 | 27/300 | 2% | brostensrytter 98%, gc 2%, baroudeur 0% |
| flat | sprint | 85 vs 18 | 24/300 | 1.3% | sprinter 93%, leadout 7% |
| high_mountain | climbing | 90 vs 23 | 26/300 | 36.3% | gc 69%, climber 22%, puncheur 9% |
| hilly | punch | 83 vs 26 | 38/300 | 4.7% | puncheur 82%, climber 5%, baroudeur 4% |
| itt | time_trial | 90 vs 18 | 25/300 | 39.3% | tt 66%, gc 34% |
| mountain | climbing | 91 vs 23 | 25/300 | 33.3% | gc 73%, climber 20%, puncheur 7% |
| rolling | endurance | 70 vs 29 | 51/300 | 31% | gc 40%, baroudeur 27%, puncheur 25% |

Udbruds-andel af bjergsejre: 0%

### Grand Tour (21 etaper)

| # | Rytter | Født-som | Afledt | Tid |
|--:|---|---|---|---|
| 1 | Manuel Ferrara | gc | gc | +0:00 |
| 2 | Matej Hribar | climber | climber | +6:34 |
| 3 | Loïc Pichon | puncheur | puncheur | +9:57 |
| 4 | Lachlan Foster | gc | gc | +10:32 |
| 5 | Javier Aguilar | climber | gc | +13:31 |
| 6 | Sebastian Bergström | gc | gc | +14:16 |
| 7 | Adam Sokol | climber | climber | +17:11 |
| 8 | Cody Ward | tt | tt | +17:42 |
| 9 | Maarten Peeters | climber | climber | +18:21 |
| 10 | Maxime Girard | climber | climber | +18:40 |

Trøjer: 🟢 Loïc Pichon (puncheur) · ⛰️ Loïc Pichon (puncheur) · ⚪ Manuel Ferrara

## Progression

800 simulerede ryttere over 6 sæsoner · pension/sæson: 16, 6, 9, 19, 31, 28

| Metrik | p10 | p50 | p90 |
|---|--:|--:|--:|
| U25 ability-sum-delta/sæson | 3 | 17 | 35 |
| Ungt talent base_value ×mult (n=46) | 2.46 | 5.1 | 11.3 |
| Signatur-snit efter sim | — | 35 | 69 (p99 88, max 97) |

