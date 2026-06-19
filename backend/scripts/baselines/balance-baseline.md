# Balance-baseline — deterministisk snapshot (#1197)

> Genereret af `node backend/scripts/balanceBaseline.js --write` · seed 2026 · 800 ryttere · 300 løb/terræn · 6 progression-sæsoner · noise 0.16 · værdimodel v3 (2026-06-16)
>
> Ændrer en PR balance-følsomme filer, regenereres snapshottet og diffes mod denne baseline — diffen er reviewet. Bump: `npm run balance:baseline` (i `backend/`) + commit.

## Population

800 ryttere · overall p50 20 (p90 50, max 70) · base_value p50 20163 (p99 17357114, max 32068504)

| Type | Antal | base_value p50 | p90 | max |
|---|--:|--:|--:|--:|
| baroudeur | 23 | 6996 | 378563 | 711924 |
| brostensrytter | 38 | 463803 | 1835154 | 2581484 |
| climber | 275 | 12051 | 515607 | 4803037 |
| gc | 34 | 2452883 | 20390757 | 32068504 |
| puncheur | 12 | 7736 | 249343 | 716457 |
| rouleur | 102 | 14452 | 466227 | 3149852 |
| sprinter | 121 | 40403 | 1991155 | 17357114 |
| tt | 195 | 19753 | 1574170 | 27649298 |

## Race-motor (vinder-fordeling pr. terræn)

| Terræn | Nøgle-evne | Vinder ⌀ vs median | Distinkte | Stærkeste vandt | Top-vindertyper (født-som) |
|---|---|---|--:|--:|---|
| classic | endurance | 71 vs 32 | 41/300 | 41.3% | gc 45%, puncheur 35%, climber 9% |
| cobbles | cobblestone | 75 vs 19 | 42/300 | 2% | brostensrytter 91%, gc 3%, baroudeur 2% |
| flat | sprint | 87 vs 18 | 27/300 | 8.7% | sprinter 97%, gc 2%, baroudeur 0% |
| high_mountain | climbing | 89 vs 23 | 25/300 | 42.3% | gc 63%, climber 30%, puncheur 8% |
| hilly | punch | 77 vs 26 | 89/300 | 3% | puncheur 71%, climber 9%, baroudeur 6% |
| itt | time_trial | 91 vs 23 | 26/300 | 12% | tt 78%, gc 22%, brostensrytter 0% |
| mountain | climbing | 84 vs 23 | 73/300 | 40.3% | gc 56%, climber 32%, puncheur 8% |
| rolling | endurance | 70 vs 32 | 63/300 | 40% | gc 45%, puncheur 23%, baroudeur 18% |

Udbruds-andel af bjergsejre: 1.2%

### Evne-liveness (⌀rank-gevinst pr. probe)

| Probe | ⌀rank-gevinst |
|---|--:|
| aggression@mountain-bwgap | 0.015 |
| climbing@mountain | 10.19 |
| descending@mountain | 1.46 |
| flat@rolling | 3.28 |
| sprint@flat | 12.21 |
| tempo@mountain | 1.26 |

### Grand Tour (21 etaper)

| # | Rytter | Født-som | Afledt | Tid |
|--:|---|---|---|---|
| 1 | Manuel Fontana | gc | gc | +0:00 |
| 2 | Pieter Dekker | climber | climber | +0:10 |
| 3 | Andrea Sorrentino | puncheur | climber | +6:12 |
| 4 | Ethan Whitfield | gc | gc | +6:56 |
| 5 | Óscar López | climber | climber | +7:12 |
| 6 | Kamil Zupan | climber | climber | +7:22 |
| 7 | Patryk Kovač | climber | climber | +7:36 |
| 8 | Sebastian Holmberg | climber | climber | +11:39 |
| 9 | Pieter Claes | gc | gc | +11:49 |
| 10 | George Carter | tt | tt | +11:54 |

Trøjer: 🟢 Manuel Fontana (gc) · ⛰️ Pieter Dekker (climber) · ⚪ George Carter

## Progression

800 simulerede ryttere over 6 sæsoner · pension/sæson: 7, 10, 8, 21, 23, 28

| Metrik | p10 | p50 | p90 |
|---|--:|--:|--:|
| U25 ability-sum-delta/sæson | 1 | 13 | 29 |
| Ungt talent base_value ×mult (n=33) | 2.31 | 4.53 | 8.31 |
| Signatur-snit efter sim | — | 35 | 72 (p99 92, max 97) |

