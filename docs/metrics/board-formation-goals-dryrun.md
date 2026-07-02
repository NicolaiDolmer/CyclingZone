# Board-mål-kalibrering ved dannelse — dry-run (#2022 fase 2)

> Genereret 2026-06-30 af `node backend/scripts/boardFormationGoalsDryRun.js` · READ-ONLY · simulér-før-ship (ejer-accepteret 7/6)
> Population: 15 ægte formations-boards (negotiation_status='pending') + 1 syntetisk entry-hold · aktiv sæson 1
> BEFORE = statiske fallback-mål (`generateBoardGoals({focus,planType})` — præcis hvad `createInitialBoardProfile` giver i dag). AFTER = kalibreret (`generateBoardGoals({focus,planType,team,riders})`).

## 1. Sammendrag

- **Strukturelt uopnåelige identitets-mål** (target > faktisk trup): **12 før → 0 efter** (på tværs af 16 hold).
- Drivende mål: `min_riders` (statisk 15 for balanced) rammer enhver trup < 15. Kalibreret følger divisionens squad-limits (div 3/4: 8–10) → typisk target 8–9, som ægte trupper opfylder.

## 2. Satisfaction-projektion (sæson-slut, samme løbsforløb før/efter)

Newsatisfaction fra `evaluateBoardSeason` (start 50, 1yr final). Tre repræsentative placeringer pr. hold. Δ = efter − før (positivt = kalibrering hæver bestyrelsens vurdering ved samme præstation).

| Hold | Div | Trup | midt: før→efter (Δ) | stærk: før→efter (Δ) | svag: før→efter (Δ) |
|---|--:|--:|---|---|---|
| Sigaard Cycling | 3 | 12 | 51→54 (+3) | 69→71 (+2) | 34→36 (+2) |
| Pro Cycling Team | 3 | 12 | 51→54 (+3) | 69→71 (+2) | 34→36 (+2) |
| Universal Cycling | 3 | 12 | 51→54 (+3) | 69→71 (+2) | 34→36 (+2) |
| Red Bull - Robley - Rockets | 3 | 12 | 51→54 (+3) | 69→71 (+2) | 34→36 (+2) |
| Viimsi Racing | 3 | 12 | 51→54 (+3) | 69→71 (+2) | 34→36 (+2) |
| Pfeiffer Dev | 3 | 12 | 51→54 (+3) | 69→71 (+2) | 34→36 (+2) |
| TUN Racing | 3 | 12 | 51→54 (+3) | 69→71 (+2) | 34→36 (+2) |
| Air France-KLM Team | 3 | 16 | 53→54 (+1) | 70→71 (+1) | 36→37 (+1) |
| Slock Lyset | 3 | 12 | 51→54 (+3) | 69→71 (+2) | 34→36 (+2) |
| Squid Sycling | 3 | 12 | 51→54 (+3) | 69→71 (+2) | 34→36 (+2) |
| Chilihvidløg | 3 | 13 | 52→54 (+2) | 69→71 (+2) | 35→37 (+2) |
| EvoPro | 3 | 18 | 53→54 (+1) | 71→71 (+0) | 36→37 (+1) |
| Team Lea | 3 | 12 | 51→54 (+3) | 69→71 (+2) | 34→36 (+2) |
| Wander Riders | 3 | 15 | 53→54 (+1) | 70→71 (+1) | 36→37 (+1) |
| Team Salty | 3 | 16 | 53→54 (+1) | 70→71 (+1) | 36→37 (+1) |
| (syntetisk entry-hold) | 4 | 8 | 47→51 (+4) | 65→68 (+3) | 35→39 (+4) |

## 3. Mål-diff pr. hold (BEFORE → AFTER)

### Sigaard Cycling — div 3, 12 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| top_n_finish | Top 4 i divisionen _(pen −8)_ | Top 5 i divisionen _(pen −8)_ | (løbs-afhængigt) |
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 9 ryttere _(pen −10)_ | ✅ 12/9 ryttere |
| stage_wins | Mindst 2 etapesejrer _(pen −5)_ | Mindst 3 etapesejrer _(pen −5)_ | (løbs-afhængigt) |

### Pro Cycling Team — div 3, 12 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| top_n_finish | Top 4 i divisionen _(pen −8)_ | Top 5 i divisionen _(pen −8)_ | (løbs-afhængigt) |
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 9 ryttere _(pen −10)_ | ✅ 12/9 ryttere |

### Universal Cycling — div 3, 12 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| top_n_finish | Top 4 i divisionen _(pen −8)_ | Top 5 i divisionen _(pen −8)_ | (løbs-afhængigt) |
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 9 ryttere _(pen −10)_ | ✅ 12/9 ryttere |
| stage_wins | Mindst 2 etapesejrer _(pen −5)_ | Mindst 3 etapesejrer _(pen −5)_ | (løbs-afhængigt) |

### Red Bull - Robley - Rockets — div 3, 12 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| top_n_finish | Top 4 i divisionen _(pen −8)_ | Top 5 i divisionen _(pen −8)_ | (løbs-afhængigt) |
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 9 ryttere _(pen −10)_ | ✅ 12/9 ryttere |

### Viimsi Racing — div 3, 12 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| top_n_finish | Top 4 i divisionen _(pen −8)_ | Top 5 i divisionen _(pen −8)_ | (løbs-afhængigt) |
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 9 ryttere _(pen −10)_ | ✅ 12/9 ryttere |
| stage_wins | Mindst 2 etapesejrer _(pen −5)_ | Mindst 3 etapesejrer _(pen −5)_ | (løbs-afhængigt) |

### Pfeiffer Dev — div 3, 12 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| top_n_finish | Top 4 i divisionen _(pen −8)_ | Top 5 i divisionen _(pen −8)_ | (løbs-afhængigt) |
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 9 ryttere _(pen −10)_ | ✅ 12/9 ryttere |
| stage_wins | Mindst 2 etapesejrer _(pen −5)_ | Mindst 3 etapesejrer _(pen −5)_ | (løbs-afhængigt) |

### TUN Racing — div 3, 12 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| top_n_finish | Top 4 i divisionen _(pen −8)_ | Top 5 i divisionen _(pen −8)_ | (løbs-afhængigt) |
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 9 ryttere _(pen −10)_ | ✅ 12/9 ryttere |
| stage_wins | Mindst 2 etapesejrer _(pen −5)_ | Mindst 3 etapesejrer _(pen −5)_ | (løbs-afhængigt) |

### Air France-KLM Team — div 3, 16 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| top_n_finish | Top 4 i divisionen _(pen −8)_ | Top 5 i divisionen _(pen −8)_ | (løbs-afhængigt) |
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 9 ryttere _(pen −10)_ | ✅ 16/9 ryttere |
| stage_wins | Mindst 2 etapesejrer _(pen −5)_ | Mindst 3 etapesejrer _(pen −5)_ | (løbs-afhængigt) |

### Slock Lyset — div 3, 12 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| top_n_finish | Top 4 i divisionen _(pen −8)_ | Top 5 i divisionen _(pen −8)_ | (løbs-afhængigt) |
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 9 ryttere _(pen −10)_ | ✅ 12/9 ryttere |
| stage_wins | Mindst 2 etapesejrer _(pen −5)_ | Mindst 3 etapesejrer _(pen −5)_ | (løbs-afhængigt) |

### Squid Sycling — div 3, 12 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| top_n_finish | Top 4 i divisionen _(pen −8)_ | Top 5 i divisionen _(pen −8)_ | (løbs-afhængigt) |
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 9 ryttere _(pen −10)_ | ✅ 12/9 ryttere |
| stage_wins | Mindst 2 etapesejrer _(pen −5)_ | Mindst 3 etapesejrer _(pen −5)_ | (løbs-afhængigt) |

### Chilihvidløg — div 3, 13 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| top_n_finish | Top 4 i divisionen _(pen −8)_ | Top 5 i divisionen _(pen −8)_ | (løbs-afhængigt) |
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 9 ryttere _(pen −10)_ | ✅ 13/9 ryttere |
| stage_wins | Mindst 2 etapesejrer _(pen −5)_ | Mindst 3 etapesejrer _(pen −5)_ | (løbs-afhængigt) |

### EvoPro — div 3, 18 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| top_n_finish | Top 4 i divisionen _(pen −8)_ | Top 5 i divisionen _(pen −8)_ | (løbs-afhængigt) |
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 9 ryttere _(pen −10)_ | ✅ 18/9 ryttere |
| stage_wins | Mindst 2 etapesejrer _(pen −5)_ | Mindst 3 etapesejrer _(pen −5)_ | (løbs-afhængigt) |

### Team Lea — div 3, 12 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| top_n_finish | Top 4 i divisionen _(pen −8)_ | Top 5 i divisionen _(pen −8)_ | (løbs-afhængigt) |
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 9 ryttere _(pen −10)_ | ✅ 12/9 ryttere |
| stage_wins | Mindst 2 etapesejrer _(pen −5)_ | Mindst 3 etapesejrer _(pen −5)_ | (løbs-afhængigt) |

### Wander Riders — div 3, 15 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| top_n_finish | Top 4 i divisionen _(pen −8)_ | Top 5 i divisionen _(pen −8)_ | (løbs-afhængigt) |
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 9 ryttere _(pen −10)_ | ✅ 15/9 ryttere |
| stage_wins | Mindst 2 etapesejrer _(pen −5)_ | Mindst 3 etapesejrer _(pen −5)_ | (løbs-afhængigt) |

### Team Salty — div 3, 16 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| top_n_finish | Top 4 i divisionen _(pen −8)_ | Top 5 i divisionen _(pen −8)_ | (løbs-afhængigt) |
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 9 ryttere _(pen −10)_ | ✅ 16/9 ryttere |
| stage_wins | Mindst 2 etapesejrer _(pen −5)_ | Mindst 3 etapesejrer _(pen −5)_ | (løbs-afhængigt) |

### (syntetisk entry-hold) — div 4, 8 ryttere (balanced/1yr)
| Mål | Før | Efter | Trup-status |
|---|---|---|---|
| min_riders | Hold pa min. 15 ryttere _(pen −10)_ | Hold pa min. 8 ryttere _(pen −10)_ | ✅ 8/8 ryttere |

