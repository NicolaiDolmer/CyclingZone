# Balance-baseline — deterministisk snapshot (#1197)

> Genereret af `node backend/scripts/balanceBaseline.js --write` · seed 2026 · 800 ryttere · 300 løb/terræn · 6 progression-sæsoner · noise 0.16 · værdimodel v3 (2026-06-09)
>
> Ændrer en PR balance-følsomme filer, regenereres snapshottet og diffes mod denne baseline — diffen er reviewet. Bump: `npm run balance:baseline` (i `backend/`) + commit.

## Population

800 ryttere · overall p50 19 (p90 50, max 74) · base_value p50 24558 (p99 22495638, max 35821010)

| Type | Antal | base_value p50 | p90 | max |
|---|--:|--:|--:|--:|
| baroudeur | 27 | 221514 | 547208 | 779308 |
| brostensrytter | 43 | 36634 | 1823205 | 5395930 |
| climber | 266 | 25131 | 1322380 | 5072720 |
| gc | 34 | 1185548 | 16902056 | 35821010 |
| leadout | 71 | 22600 | 768024 | 1742683 |
| puncheur | 13 | 12134 | 492537 | 1119188 |
| rouleur | 93 | 12218 | 422820 | 817062 |
| sprinter | 51 | 55817 | 3212036 | 33883343 |
| tt | 202 | 15157 | 843115 | 29204713 |

## Race-motor (vinder-fordeling pr. terræn)

| Terræn | Nøgle-evne | Vinder ⌀ vs median | Distinkte | Stærkeste vandt | Top-vindertyper (født-som) |
|---|---|---|--:|--:|---|
| classic | endurance | 71 vs 29 | 44/300 | 54% | gc 64%, puncheur 23%, baroudeur 7% |
| cobbles | cobblestone | 79 vs 19 | 46/300 | 2.3% | brostensrytter 90%, gc 3%, rouleur 2% |
| flat | sprint | 87 vs 18 | 31/300 | 6% | sprinter 91%, leadout 7%, baroudeur 1% |
| high_mountain | climbing | 90 vs 23 | 27/300 | 64.7% | gc 81%, climber 19% |
| hilly | punch | 73 vs 26 | 102/300 | 9% | puncheur 63%, gc 13%, climber 8% |
| itt | time_trial | 93 vs 26 | 29/300 | 11.3% | tt 83%, gc 17% |
| mountain | climbing | 86 vs 23 | 71/300 | 53% | gc 66%, climber 23%, puncheur 4% |
| rolling | endurance | 68 vs 29 | 77/300 | 45.3% | gc 58%, puncheur 15%, baroudeur 14% |

Udbruds-andel af bjergsejre: 1.8%

### Evne-liveness (⌀rank-gevinst pr. probe)

| Probe | ⌀rank-gevinst |
|---|--:|
| aggression@mountain-bwgap | 0.02 |
| climbing@mountain | 9.34 |
| descending@mountain | 1.47 |
| flat@rolling | 3.09 |
| sprint@flat | 11.25 |
| tempo@mountain | 2.2 |

### Grand Tour (21 etaper)

| # | Rytter | Født-som | Afledt | Tid |
|--:|---|---|---|---|
| 1 | Mason Ramsay | gc | gc | +0:00 |
| 2 | Tommaso Pellegrini | gc | gc | +1:54 |
| 3 | Diego Campos | climber | climber | +6:50 |
| 4 | Bartosz Nowak | climber | climber | +7:13 |
| 5 | Luka Dvořák | climber | climber | +7:18 |
| 6 | Wout Van Dijk | climber | climber | +8:30 |
| 7 | Alejandro Vega | climber | climber | +9:13 |
| 8 | Emil Strand | gc | gc | +9:40 |
| 9 | Lucas Rousseau | puncheur | climber | +11:54 |
| 10 | Jan Neumann | climber | climber | +12:30 |

Trøjer: 🟢 Mason Ramsay (gc) · ⛰️ Diego Campos (climber) · ⚪ Diego Campos

## Progression

800 simulerede ryttere over 6 sæsoner · pension/sæson: 13, 12, 12, 23, 22, 34

| Metrik | p10 | p50 | p90 |
|---|--:|--:|--:|
| U25 ability-sum-delta/sæson | 1 | 14 | 32 |
| Ungt talent base_value ×mult (n=56) | 1.85 | 4.32 | 10.77 |
| Signatur-snit efter sim | — | 36 | 72 (p99 93, max 99) |

