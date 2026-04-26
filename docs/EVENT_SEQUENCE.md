# EVENT_SEQUENCE.md — Cycling Zone

Autoritativ beskrivelse af alle sæson- og markedshændelsers rækkefølge. Kilde: runtime (`api.js`, `cron.js`, `economyEngine.js`, `auctionFinalization.js`, `boardEngine.js`).

---

## 1. Sæsonstart

**Trigger:** `POST /api/admin/seasons/:id/start`  
**Krav:** Sæsonens status = `upcoming`; ingen anden aktiv sæson.

```
1. ensureSeasonStandings(seasonId)
   └─ Opretter season_standings-rækker for alle hold

2. UPDATE seasons SET status='active', start_date=now

3. processSeasonStart(seasonId)  [economyEngine.js]
   For hvert menneskehold:
   ├─ Beregn sponsor-modifier fra bestyrelsestilfredshed
   │  (0.80 lav · 1.00 normal · 1.20 høj)
   ├─ Kredit sponsorindkomst × modifier → holdbalance
   ├─ Log finance transaction (type: 'sponsor')
   ├─ processLoanAgreementSeasonFees() — løbende långebyrer
   └─ Sikr at alle 3 bestyrelsesplantyper eksisterer (1yr/3yr/5yr)

4. logActivity("season_started", { season_id, sponsor_payouts })
5. notifySeasonEvent({ type: "season_started" })  → Discord
```

---

## 2. Resultatimport og -godkendelse

**Trigger:** `POST /api/admin/import-results` (XLSX) ELLER `POST /api/admin/approve-results`

```
1. Parsér XLSX-ark:
   "stage results" → type='stage'
   "general results" → type='gc'
   "points" / "mountain" / "young" / "team" → tilsvarende typer

2. buildRacePrizeLookup()
   └─ Henter prize_tables pr. race_type; falder tilbage på DEFAULT_PRIZES

3. Fuzzy-match rytter og hold per resultat-række

4. applyRaceResults()
   ├─ INSERT INTO race_results
   ├─ Kredit holdbalancer med præmiepenge
   ├─ Log finance transactions (type: 'prize')
   └─ updateStandings(seasonId, raceId)

5. UPDATE pending_race_results SET status='approved'

6. logActivity("race_results_approved", { race_id, rows_imported })
```

**Præmiestandard (ingen tilpasset prize_table):**

| Type       | #1  | #2  | #3  | #10 |
|------------|-----|-----|-----|-----|
| stage      | 50  | 30  | 20  | 2   |
| gc         | 200 | 150 | 100 | 10  |
| points/mtn/young | 30 | 20 | 15 | — |
| team       | 100 | 70  | 50  | —  |

---

## 3. Sæsonafslutning

**Trigger:** `POST /api/admin/seasons/:id/end`  
**Krav:** Ingen `pending_race_results` for sæsonens løb; status = `active`.

```
1. Valider: ingen ventende resultater

2. updateStandings() — endelig genberegning

3. processSeasonEnd(seasonId)  [economyEngine.js]

   A) Oprykning/nedrykning pr. division (div 1-3):
      Top 2 i div 2 & 3 → rykker op (division - 1)
      Bund 2 i div 1 & 2 → rykker ned (division + 1)
      Notify hold

   B) For hvert menneskehold:
      ├─ processLoanInterest()
      │  └─ Debiter 10 % rente på negativ saldo
      ├─ Beregn samlet løn (rider.price × 0.10 pr. rytter)
      ├─ Hvis saldo utilstrækkelig: createEmergencyLoan(shortfall)
      ├─ Debiter løn; log finance transaction (type: 'salary')
      ├─ Resterende negativ saldo: debiter 10 % rente (type: 'interest')
      └─ Evaluer bestyrelses-planer (evaluateBoardSeason)
         ├─ Plan udløbet (seasons_completed >= planDuration):
         │  ├─ board negotiation_status = 'pending'
         │  ├─ Nulstil kumulative mål-tællere
         │  └─ Notify manager: "Bestyrelsesplan udløbet"
         ├─ Midtvejsreview (season = ⌊duration/2⌋):
         │  └─ Notify med fremskridts-feedback
         └─ INSERT board_plan_snapshot
            UPDATE board satisfaction + budget_modifier

4. UPDATE seasons SET status='completed'

5. logActivity("season_ended", { season_id })
6. notifySeasonEvent({ type: "season_ended" })  → Discord
```

---

## 4. Auktioner

### Start
**Trigger:** `POST /api/auctions`

```
1. Valider: ingen aktiv auktion for rytter; pris ≥ rider.price (eller guaranteed_sale=true)
2. calculateAuctionEnd() → default 7 dage
3. INSERT auctions (status='active')
4. notifyNewAuction() → alle hold der følger rytteren
5. logActivity("auction_started")
```

### Bud
**Trigger:** `POST /api/auctions/:id/bid`

```
1. Valider: bud ≥ current_price + min_increment; auktion ikke udløbet
2. Automatisk forlængelse: bud inden for 6 timer af udløb → +6 timer
3. UPDATE auctions: current_price, current_bidder_id
4. Notify forrige byder (outbid) + sælger (nyt bud)
5. logActivity("auction_bid_placed")
```

### Finalisering (automatisk via cron)
**Interval:** Hvert 60. sekund → `finalizeExpiredAuctions()`  
**Funktion:** `finalizeAuctionRecord()` [auctionFinalization.js]

```
For each auction WHERE status IN ('active','extended') AND calculated_end < now:
  1. Løs sælger-kontekst (rider.team_id → sælger)
  2. Fejlhåndtering:
     - Stale owner → annullér, notify byder
     - Utilstrækkelig køber-saldo → annullér, notify begge
     - Squad fuld → annullér
  3. calculateAuctionSalary(price) = price × 0.10
  4. Udfør transfer:
     ├─ Transfervindue åbent: rider.team_id = vinder
     └─ Vindue lukket: rider.pending_team_id = vinder
  5. Debiter køber; kredit sælger (hvis menneske)
  6. Log finance transactions (type: 'transfer_out', 'transfer_in')
  7. XP: køber +15 (auction_won), sælger +10 (auction_sold)
  8. Notify begge parter + Discord
  9. UPDATE auctions SET status='completed', actual_end=now
```

---

## 5. Transfervindue

### Grundregler

**Altid muligt** (uanset vinduets tilstand):
- Oprette og byde på auktioner
- Oprette transferlister (sætte ryttere til salg)
- Sende, modtage og forhandle transfertilbud og swaptilbud
- Oprette og aftale låneaftaler

**Kræver åbent vindue:**
- Bekræfte/acceptere et transfertilbud (ejerskiftet sker her)
- Bekræfte/acceptere en byttehandel
- Flytte en rytter der var "parkeret" fra auktion der sluttede under lukket vindue

### Vinduets livscyklus

```
Åbn:  POST /api/admin/transfer-window/open  (med season_id)
  ├─ INSERT transfer_windows (status='open')
  └─ Batch-processer alle pending_team_id → team_id  ← simultant ved åbning

Tjek: GET /api/transfer-window
  └─ { open: boolean, status: 'open'|'closed' }

Luk:  POST /api/admin/transfer-window/close
  └─ UPDATE transfer_windows SET status='closed'
```

### Parkerings-mekanik (pending_team_id)

Auktioner der slutter mens vinduet er lukket, "parkerer" vinderen:
rytter → `pending_team_id = vinder` (ejer ændres IKKE endnu)

Ved næste vinduets åbning → alle parkerede ryttere flyttes simultant til `team_id`.

| Hændelse | Vindue lukket | Vindue åbent |
|---|---|---|
| Auktion slutter med vinder | `pending_team_id = vinder` | `team_id = vinder` direkte |
| Transfer begge sider bekræfter | `status = window_pending` (parkeret) | `team_id` skifter øjeblikkeligt |
| Swap begge sider bekræfter | `status = window_pending` (parkeret) | Begge `team_id` skifter øjeblikkeligt |

**Parkeret = låst:** Når en transfer eller swap parkeres, trækkes alle andre aktive tilbud på de involverede ryttere øjeblikkeligt tilbage. Handlen venter til vinduet åbner og kan stadig annulleres af begge parter.

### Anbefalet admin-sekvens

```
1. POST /api/admin/seasons/:id/end        ← sæson afsluttes
2. POST /api/admin/transfer-window/open   ← vindue åbnes + parkerede ryttere skifter hold
   [fri handel — managers handler og bekræfter direkte]
3. POST /api/admin/transfer-window/close  ← vindue lukkes
4. POST /api/admin/seasons/:id/start      ← ny sæson starter
```

NB: Koblingen er manuel — systemet åbner/lukker ikke vinduet automatisk ved sæsonhændelser.

---

## 6. Cron-jobs

| Job | Interval | Funktion |
|-----|----------|----------|
| Auktionsfinalisering | 60 sek | `finalizeExpiredAuctions()` |
| Gældsadvarsler | 6 timer | `checkDebtWarnings()` |

**Gældsadvarsel:** Notify alle hold med negativ saldo: `"⚠️ Negativ saldo — renter ved sæsonafslutning: {10% af saldo} pts"`

---

## 7. Standings

**Rebuild:** `POST /api/admin/seasons/:id/rebuild-standings`

```
1. Hent alle løb i sæsonen
2. For hvert race_result:
   ├─ total_points += points_earned
   ├─ stage_wins (result_type='stage' AND rank=1)
   └─ gc_wins (result_type='gc' AND rank=1)
3. Sortér pr. division efter total_points → rank_in_division
4. UPSERT season_standings (conflict: season_id,team_id)
```

---

## 8. Statesmaskiner

```
Sæson:      upcoming → active → completed

Auktion:    active → completed
            active → extended → completed

Transfervindue: closed → open → closed

Transfertilbud: pending → awaiting_confirmation → completed
                       → countered → awaiting_confirmation → completed
                       → rejected
                       → withdrawn

Bestyrelsesstatus: pending → (forhandling accepteret) → active
                   active  → (plan udløbet)           → pending
```

---

## 9. Nøgletabeller (kontrakt-reference)

| Tabel | Primære statusfelter |
|-------|----------------------|
| `seasons` | `status` (upcoming/active/completed) |
| `auctions` | `status` (active/extended/completed) |
| `transfer_windows` | `status` (open/closed) |
| `transfer_offers` | `status` (pending/countered/awaiting_confirmation/completed/rejected/withdrawn) |
| `pending_race_results` | `status` (pending/approved) |
| `board_profiles` | `negotiation_status` (pending/completed) |
| `loans` | `status` (active/paid_off) |
| `loan_agreements` | `status` (active/completed) |

**Finance transaction types (DB constraints):**  
`sponsor` · `salary` · `prize` · `interest` · `transfer_in` · `transfer_out` · `loan` · `loan_repayment`
