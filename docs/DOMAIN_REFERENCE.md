# DOMAIN REFERENCE — Spilleregler & Domæneviden

---

## Grundregler

| Emne | Regel |
|------|-------|
| Valuta | CZ$ (Cycling Zone points) — BIGINT i DB |
| Divisioner | 3 niveauer: 1 (Elite), 2 (Professional), 3 (Amateur) |
| Oprykning | Top 2 per division rykker op |
| Nedrykning | Bund 2 per division rykker ned |
| Hold-min | Div 1: 20, Div 2: 14, Div 3: 8 ryttere |
| Hold-max | Div 1: 30, Div 2: 20, Div 3: 10 ryttere |
| Race-minimum | 8 ryttere på hold for at deltage |

---

## Rytter-stats Forkortelser

| Felt | Dansk | Beskrivelse |
|------|-------|-------------|
| stat_fl | Flad | Flat terrain |
| stat_bj | Bjerg | Mountain |
| stat_kb | Mellembjerg | Medium mountain |
| stat_bk | Bakke | Hill |
| stat_tt | Enkeltstart | Time trial |
| stat_prl | Prolog | Prologue |
| stat_bro | Brosten | Cobblestones |
| stat_sp | Sprint | Sprint |
| stat_acc | Acceleration | Acceleration |
| stat_ned | Nedkørsel | Downhill |
| stat_udh | Udholdenhed | Endurance |
| stat_mod | Modstandsdygtighed | Resistance |
| stat_res | Restituering | Recovery |
| stat_ftr | Fighter | Attacking ability |

**Farvekodning (statBg.js):** Stats farves fra rød (lav) til grøn (høj) baseret på percentil i feltet.

---

## Auktionsregler

### Vinduer (lokal tid)
| Dag | Åbner | Lukker |
|-----|-------|--------|
| Man–Tor | 17:00 | 21:00 |
| Fredag | 17:00 | 22:00 |
| Lørdag | 09:00 | 22:00 |
| Søndag | 09:00 | 21:00 |

- Auktionsvarighed: **4 timer** (eller vinduesluk — hvad der sker først)
- Bud inden for de sidste **10 minutter** → forlænger med 10 min fra budtidspunkt
- Forlænget slut kan **ikke** overskride vinduesluk samme dag
- **Guaranteed sale**: Startpris = 50% af rytterens UCI-pris. Banksalg ved ingen bud gælder kun, hvis rytteren faktisk var på sælgerens hold.

### Minimumsforøgelse
- `min_increment` felt på auktionen (hardcoded i API ved oprettelse)

### Roller, ejerskab og provenu
- `seller_team_id` er auktions-initiatoren ved oprettelse, ikke nødvendigvis den endelige økonomiske sælger
- En **ægte sælger** er kun et hold, der faktisk ejer rytteren ved auktionsafslutning
- Hvis en manager starter auktion på en fri eller AI-ejet rytter, får initiatoren **ikke** salgsprovenu og optjener ikke `auction_sold` XP
- Ved afslutning ryddes `seller_team_id` på ikke-ejede auktionsflows, så historik og summer ikke viser et falskt salg

### Afslutningsregler
- Vinderens saldo trækkes altid ved gyldig afslutning
- Sælger krediteres kun, hvis rytteren faktisk var på sælgerens hold
- Guaranteed sale til banken sker kun for en ejet rytter med `is_guaranteed_sale = true` og ingen menneskelige bud
- Hvis transfervinduet er lukket ved auktionsafslutning, sættes rytteren på `pending_team_id` i stedet for at skifte hold med det samme
- Squad limit kontrolleres ved auktionsafslutning, ikke kun ved budgivning
- Squad-limit vurderes ud fra current riders + `pending_team_id` + aktive indlån (`loan_agreements` hvor holdet er låner)
- Hvis vinderen ikke længere har råd eller ikke har plads på holdet, gennemføres ingen overdragelse og ingen forkert payout må ske

---

## Transfervindue

- Status styres af admin-endpoints: `POST /api/admin/transfer-window/open` og `POST /api/admin/transfer-window/close`
- Når ÅBENT: handlers aktiveres øjeblikkeligt. Når LUKKET: 403 returneres på alle opret/acceptér-endpoints.
- Auktioner: Når LUKKET → rider sættes som `pending_team_id`, aktiveres ved næste åbning af vinduet.
- Transfers/swaps/lån: Helt blokeret (403) når vinduet er lukket.
- Aktive lejeaftaler tæller mod lånerens holdgrænse, så squad-limit checks på markedet inkluderer både ventende handler og lånte ryttere
- Reject, withdraw og cancel-handlinger er tilladt uanset vinduesstatus.
- Swaps og lån følger samme vindueslogik

---

## Økonomimodel

### Sponsorindtægt
```
Udbetales: Sæsonstart
Beregning: round(sponsor_income × budget_modifier)
budget_modifier: se Bestyrelse nedenfor
```

### Løn
```
Beregning: 10% af rytterens UCI-pris (sættes ved køb)
Genberegnes: Til 10% af aktuelle UCI-points ved hver sæsonstart
Minimum: 1 CZ$
Trækkes: Sæsonslut (alle ryttere på holdet)
Shortfall: Auto-nødlån oprettes
```

### Lån
| Type | Beskrivelse |
|------|-------------|
| `short` | Manager-anmodet kortfristet lån |
| `long` | Manager-anmodet langsigtet lån |
| `emergency` | Auto-skabt hvis hold ikke kan betale løn |

- Nødlån: 15% oprettelsesgebyr, 15% rente per sæson, 1 sæsons varighed
- Rente beregnes på `amount_remaining` ved sæsonslut

### Præmiepenge (default ved løbsimport)

| Placering | Stage | GC | Points/Bjerg | Team | Young |
|-----------|-------|----|--------------|------|-------|
| 1 | 50 | 200 | 30 | 100 | 50 |
| 2 | 30 | 150 | 20 | 70 | 30 |
| 3 | 20 | 100 | 15 | 50 | 20 |
| 4 | 15 | 75 | — | 30 | — |
| 5 | 12 | 50 | — | 20 | — |

### Renter på negativ saldo
- 10% af negativ saldo pr. sæson (legacy-mekanisme udover lån)

---

## Bestyrelse (Board)

### Plantyper
| Type | Varighed | Mål-evalueringsperiode |
|------|----------|----------------------|
| `1yr` | 1 sæson | Slut af sæson |
| `3yr` | 3 sæsoner | Kumulativt over 3 sæsoner |
| `5yr` | 5 sæsoner | Kumulativt over 5 sæsoner |

Mid-plan besked sendes ved 50% af planvarighed (kun multi-year).

### Focus-typer og mål

**`youth_development`**
| Mål | Opfyldt | Ikke opfyldt |
|-----|---------|--------------|
| Min. 5 U25 ryttere | +15 | -10 |
| Top 5 slutplacering | +10 | -5 |
| Stage wins (kumulativ) | +20 | 0 |
| Ingen udestående gæld | +12 | -8 |

**`star_signing`**
| Mål | Opfyldt | Ikke opfyldt |
|-----|---------|--------------|
| Top 3 slutplacering | +20 | -15 |
| GC wins (kumulativ) | +25 | -10 |
| Min. 20 ryttere | +5 | -10 |
| Sponsorvækst (10% for 1yr, 5%×planår for multi) | +15 | -10 |

**`balanced`**
| Mål | Opfyldt | Ikke opfyldt |
|-----|---------|--------------|
| Top 4 slutplacering | +15 | -8 |
| Min. 15 ryttere | +5 | -10 |
| Stage wins (2 for 1yr, 2×planår×0.7 for multi) | +10 | -5 |
| Ingen udestående gæld | +12 | -8 |

### Division performance-bonus (tillæg til satisfaction)
| Placering | Ændring |
|-----------|---------|
| ≤ 2 | +15 |
| 3–4 | +5 |
| ≥ 7 | -10 |

### Satisfaction → Budget Modifier
| Satisfaction | Modifier | Effekt på sponsorindtægt |
|-------------|----------|--------------------------|
| ≥ 80 | × 1.20 | +20% |
| 60–79 | × 1.10 | +10% |
| 40–59 | × 1.00 | Normal |
| 20–39 | × 0.90 | -10% |
| < 20 | × 0.80 | -20% |

---

## Manager XP & Niveauer

```
XP-belønninger:
  bid_placed: 2       auction_won: 15     auction_sold: 10
  transfer_offer_sent: 3   transfer_accepted: 10

Level = min(50, floor(xp / 100) + 1)
Level 50 kræver 4.900 XP
```

---

## Board-mål per Division (objectives)

Board-mål (stage wins, GC wins, sponsorvækst) er **faste per focus-type** — de skaleres ikke automatisk per division i den nuværende kode. Divisionsplacering påvirker kun satisfaction via performance-bonussen (+15/+5/-10).

**Design-intention (ikke implementeret):**
- WT (div 1): Top 5/10/20 monumenter/Grand Tours, etapesejre, trøjekonkurrencer
- PRO (div 2): WT race-invitation, top 5 i .1/WT-løb, top 3 NC, visibility 9
- CT (div 3): Top 10/20 i .Pro, visibility 1–2, etape top 3, U23-løb

Divisionsspecifikke måltal er planlagt men kræver refaktorering af `generateBoardGoals()` i `economyEngine.js`.
