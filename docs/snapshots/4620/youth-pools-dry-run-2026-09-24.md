# Ungdomsgrupper, dry-run (#5646, del af #4620)

Genereret 2026-09-24T11:12:46.948Z. Kun tal; den fulde plan med hold ligger i `balance-internals/4620/` (gitignoreret).

Input: 257 berettigede managers, 101 aktive AI-hold, 257 Global Rank-rækker.

## Prognose efter sæsonskiftets parkering

Parkerings-sweepen (managerParking.js, 30 dage uden login) ville parkere 144 managers og genindplacere 0. Grupperne seedes efter transitionen, så det er disse tal der gælder; kør dry-run igen der.

| Trup | Managers | AI-hold | Grupper | Største | Mindste |
|---|---:|---:|---:|---:|---:|
| U23 | 113 | 101 | 9 | 24 | 23 |
| Junior | 113 | 101 | 9 | 24 | 23 |

## Plan i dag (før parkering)

## U23 (fresh)

- Managers: 257 · AI-hold: 101 · grupper: 15 (à højst 24)
- Største gruppe: 24 · mindste: 23
- Managers uden Global Rank (lagt sidst): 0
- Grupper under 6 startklare hold i dag: 15 (AI-holdene har ingen ungdomsryttere før A6)
- AI-hold uden plads: 0 · grupper der oprettes: 15 · FK-opdateringer: 358

| Gruppe | Managers | AI | I alt | Startklare nu |
|---|---:|---:|---:|---:|
| U23 Group A | 17 | 7 | 24 | 0 |
| U23 Group B | 17 | 7 | 24 | 0 |
| U23 Group C | 17 | 7 | 24 | 0 |
| U23 Group D | 17 | 7 | 24 | 0 |
| U23 Group E | 17 | 7 | 24 | 1 |
| U23 Group F | 17 | 7 | 24 | 0 |
| U23 Group G | 17 | 7 | 24 | 2 |
| U23 Group H | 17 | 7 | 24 | 0 |
| U23 Group I | 17 | 7 | 24 | 0 |
| U23 Group J | 17 | 7 | 24 | 0 |
| U23 Group K | 17 | 7 | 24 | 1 |
| U23 Group L | 17 | 7 | 24 | 0 |
| U23 Group M | 17 | 7 | 24 | 1 |
| U23 Group N | 18 | 5 | 23 | 0 |
| U23 Group O | 18 | 5 | 23 | 1 |

## Junior (fresh)

- Managers: 257 · AI-hold: 101 · grupper: 15 (à højst 24)
- Største gruppe: 24 · mindste: 23
- Managers uden Global Rank (lagt sidst): 0
- Grupper under 6 startklare hold i dag: 15 (AI-holdene har ingen ungdomsryttere før A6)
- AI-hold uden plads: 0 · grupper der oprettes: 15 · FK-opdateringer: 358

| Gruppe | Managers | AI | I alt | Startklare nu |
|---|---:|---:|---:|---:|
| Junior Group A | 17 | 7 | 24 | 0 |
| Junior Group B | 17 | 7 | 24 | 0 |
| Junior Group C | 17 | 7 | 24 | 0 |
| Junior Group D | 17 | 7 | 24 | 1 |
| Junior Group E | 17 | 7 | 24 | 0 |
| Junior Group F | 17 | 7 | 24 | 4 |
| Junior Group G | 17 | 7 | 24 | 0 |
| Junior Group H | 17 | 7 | 24 | 1 |
| Junior Group I | 17 | 7 | 24 | 3 |
| Junior Group J | 17 | 7 | 24 | 2 |
| Junior Group K | 17 | 7 | 24 | 1 |
| Junior Group L | 17 | 7 | 24 | 1 |
| Junior Group M | 17 | 7 | 24 | 0 |
| Junior Group N | 18 | 5 | 23 | 0 |
| Junior Group O | 18 | 5 | 23 | 1 |

