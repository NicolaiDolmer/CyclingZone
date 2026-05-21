# Economy Flow Audit — Sæson 0 → 1 → 2

> **Skrevet:** 2026-05-21 (før sæson 1 launch kl 23:00 Europe/Copenhagen)
> **Scope:** Fase 1 (in-flight events), Fase 2 (⏹ Afslut sæson 0), Fase 3 (▶ Start sæson 1), Fase 4 (sæson 1 kørsel), Fase 5 (sæson 1→2 via engine), Fase 6 (gap-analyse mod plan).
> **Kilde-snapshot:** Supabase prod (project `ghwvkxzhsbbltzfnuhhz`) på skrivetidspunktet. Verificér igen før knaptryk.

---

## 🔴 TL;DR — Hvad du SKAL vide før kl 23:00

`NOW.md`'s formulering "formentlig harmløs men IKKE verificeret" var for blød. **Det er nu verificeret: ⏹-knappen er IKKE harmløs på sæson 0.** Tre uafhængige steder vil DB-state ændre sig på måder vi ikke har planlagt:

| # | Effekt af ⏹ Afslut sæson 0 (vanilla legacy endpoint) | Estimeret beløb / antal |
|---|---|---|
| 1 | **Salary-debit fra 17 hold** med ryttere | **~1.500.000 pts samlet** |
| 2 | **Loan-interest-debit fra 7 hold** med aktive lån | **~278.000 pts samlet** |
| 3 | **Emergency-lån oprettes for 9 hold** der ikke kan betale løn | **~437.000 pts samlet** |
| 4 | **2 vilkårlige hold rykker op til Division 2** (alle har 0 points → DB-rækkefølge afgør) | 2 hold |
| 5 | **Board snapshots oprettes for 4 non-baseline hold** (test-a, test-b, test-seller, Chris Machines × 3 plans) | 6 snapshots |

Disse hold vil **starte sæson 1 med gæld, emergency-rente og forkerte divisioner**. Det er ikke planen.

`▶ Start sæson 1` er stort set OK men har 2 lille-til-medium-bugs:
- Sponsor-payout sker for test-a/test-b/test-seller med deres `sponsor_income=100` (kun 100 pts, ikke 240K) — kosmetisk, ikke kritisk.
- `transfer_windows`-row for sæson 1 oprettes IKKE. Sæson 0's window forbliver `status='open'` med `closes_at=2026-05-21 21:00 UTC` (≈ 23:00 CEST). **Cron `seasonAutoTransition` vil ikke trigge senere** fordi den kræver `final_whistle_sent_at` og `squad_enforcement_completed_at` på window'et.

---

## 🟢 Anbefaling — vælg én af 3 paths

### Option A — Brug `🔄 Udfør sæsonskifte` (engine'n) i stedet for ⏹+▶ **(anbefalet)**

Slice 08-engine'en (`transitionToNextSeason` i `backend/lib/seasonTransition.js`) er bygget med eksplicit special-case for sæson 0:

> *"Sæson 0 er open-beta-fase uden løb/standings/lønninger. Klassisk processSeasonEnd er irrelevant. Engine antager at processSeasonEnd ER kørt FØR (for sæson ≥ 1) — for sæson 0 springes det helt over."*

Den lukker sæson 0 (`status='completed'`, ingen processSeasonEnd), lukker open-vinduet, åbner sæson 1's vindue som `closed`, og udbetaler sponsor 240K til 23 hold via `processSeasonStart(1)`.

**Men 1 kendt issue:** `insertSeasonIfMissing` skipper UPDATE hvis sæson 1-rowen allerede eksisterer (den blev oprettet med `status='upcoming'` fra legacy endpoint). Resultat: sæson 1 forbliver `status='upcoming'` selv om confirm-dialogen lover `'active'`. Den ene line skal patches FØR vi trykker, eller du skal følge op med en SQL `UPDATE seasons SET status='active' WHERE number=1`.

**Pris:** ~15 min kode-patch + tests + push, eller manuel SQL bagefter.

### Option B — Patch begge legacy endpoints (per #532 Option 1)

Backend-patch:
- `POST /admin/seasons/:id/end`: hvis `season.number === 0`, spring `ensureSeasonStandings`+`updateStandings`+`processSeasonEnd` over. Sæt direkte `status='completed'` + `end_date`.
- `POST /admin/seasons/:id/start`: efter `status='active'`-update, kald `closePrevTransferWindow` for forrige sæson + `insertTransferWindowIfMissing` for ny sæson (closed status).

**Pris:** ~30-45 min kode + tests + push. Større blast radius (rører 2 endpoints).

### Option C — Manuel SQL-fix på prod (kun hvis tidsnød)

```sql
-- 1. Luk sæson 0 uden processSeasonEnd-side effects
UPDATE seasons SET status='completed', end_date=NOW() WHERE number=0;

-- 2. Luk sæson 0's transfer-window
UPDATE transfer_windows SET status='closed', closed_at=NOW()
  WHERE season_id='00000000-0000-0000-0000-000000000000' AND status='open';

-- 3. Åbn sæson 1 (status=active + transfer_window closed)
UPDATE seasons SET status='active', start_date=NOW() WHERE number=1;
INSERT INTO transfer_windows (id, season_id, status, created_at)
  VALUES ('00000000-0000-0000-0000-00000001aaaa',
          '00000000-0000-0000-0000-000000000001',
          'closed', NOW())
  ON CONFLICT (id) DO NOTHING;

-- 4. Udbetal sponsor (240K × baseline=1.0) — KAN IKKE LAVES SOM SIMPEL UPDATE
-- Skal kalde processSeasonStart eller manuelt loope alle 23 hold med
-- balance += 240000 + INSERT finance_transactions ... type='sponsor'
-- Anbefal: skip dette her og brug Option A/B's processSeasonStart-call.
```

**Pris:** 5 min SQL + en eller anden måde at trigge sponsor-payout på.

**👍 Anbefaling: Option A.** Mindst kode, idempotent engine, fanger transfer_window-bug'en gratis. Eneste tilføjelse er 1-line patch i `insertSeasonIfMissing` eller en manuel SQL-UPDATE bagefter.

---

## Fase 1 — In-flight events (nu → 23:00)

DB-snapshot 2026-05-21 (lokal morgen):

| Tabel/query | Tal | Risiko |
|---|---|---|
| `seasons` | sæson 0 active (UUID `...000`), sæson 1 upcoming (UUID `...001`) | OK |
| `transfer_windows` open | 1 row (sæson 0), `closes_at=2026-05-21 21:00 UTC` ≈ 23:00 CEST | Lukkes ikke automatisk af ⏹ |
| `auctions` aktive | 2 stk. (ingen bidders, slut 14:38 + 17:03 UTC i dag) | Annulleres ved cron, ingen pengebevægelse |
| `auction_proxy_bids` på active auctions | 0 | OK |
| `transfer_offers` pending/awaiting/window_pending | 0 | OK |
| `swap_offers` pending/awaiting/window_pending | 0 | OK |
| `pending_race_results` | 0 | OK — `/end`-endpoint vil ikke fejle på dette |
| `teams` med balance < 0 (humans) | 0 | OK |
| `loans` aktive | 8 (Team Give Steel 600K, Soudal 600K, Swatt 599K, Camp Cycling 566K, Visma 412K, Modern Adventure 185K, Hopplà 180K+31K) | Rente debiteres af `processLoanInterest` ved ⏹ |
| `loan_agreements` aktive | 0 | OK |
| `seasons.standings` for sæson 0 | 0 rows | `ensureSeasonStandings(0)` vil oprette 23 rows ved ⏹ |
| `finance_transactions` for sæson 0 | 240 rows (15 loan_received, 10 loan_repayment, 22 transfer_in, 193 transfer_out) | INGEN salary/sponsor/bonus/prize for sæson 0 endnu |

**In-flight aktivitet før 23:00:** kun de 2 bidder-løse auktioner. De annulleres af `finalizeExpiredAuctions`-cron uden pengebevægelse. Ingen risiko fra mellemrum.

**Mellemrum-cron-jobs:**
- `finalizeExpiredAuctions` (60s) — ingen aktive bud, så ingen transfers
- `checkDebtWarnings` (6h) — sender notifikationer hvis humans har negativ balance. Ingen humans har negativ balance lige nu, så stille
- `seasonAutoTransition` (loop): kun aktiv hvis transfer_window har `final_whistle_sent_at` + `squad_enforcement_completed_at`. Begge er NULL → cron'en sover

---

## Fase 2 — ⏹ Afslut sæson 0 (`POST /admin/seasons/:id/end`)

### Endpoint-trace ([api.js:3319-3383](backend/routes/api.js:3319))

```
1. Validér: season.status === 'active'                      ✅ OK
2. Validér: 0 pending_race_results for season-races         ✅ OK (0 races på sæson 0)
3. await ensureSeasonStandings(seasonId)                    🟡 Opretter 23 standings-rows
4. await updateStandings(seasonId)                          🟡 Genberegner 23 rows til 0 points
5. await processSeasonEnd(seasonId)                         🔴 Hovedproblemet
6. UPDATE seasons SET end_date = today                      ✅ OK
7. logActivity('season_ended', ...)                         ✅ OK
8. notifySeasonEvent → Discord                              ✅ OK
```

### `processSeasonEnd(seasonId)` line-for-line ([economyEngine.js:373-445](backend/lib/economyEngine.js:373))

#### Step A — Load + standings-guard

```js
if (!standings?.length) return;  // ← line 392
```

Ville have sparet os hvis ikke for step 3 ovenfor. `ensureSeasonStandings(0)` opretter 23 rows FØR `processSeasonEnd` kaldes → `standings.length === 23 > 0` → ingen early-return.

#### Step B — `loadHumanSeasonEndTeams` → for hvert hold: `processTeamSeasonEnd`

```
B1. processLoanInterest(team.id, seasonId, supabase)
    └─ INSERT finance_transactions type='loan_interest' for hver active loan
    └─ UPDATE loans.amount_remaining += interest
    Estimeret debit (7 hold med lån):
      Team Give Steel 600K × 8% = 48.000 pts
      Soudal Quick-Step 600K × 8% = 48.000 pts
      Swatt Team 599K × 12% = 71.820 pts
      Camp Cycling Team 566K × 8% = 45.256 pts
      Team Visma 412K × 8% = 32.960 pts
      Modern Adventure 185K × 8% = 14.800 pts
      Hopplà Team 180K+31K = 211K × 8% = 16.880 pts
      ─────────────────────────────────────────
      SUM                                 ~277.716 pts (debit)

B2. Salary deduction: totalSalary = SUM(riders.salary) per hold
    └─ Hvis balance < totalSalary → createEmergencyLoan(shortfall)
    └─ debitTeam(team.id, totalSalary, 'salary', ...)

    9 hold vil få emergency_loan oprettet (per shortfall-query):
      Modern Adventure  → 95.622 pts emergency-lån
      Camp Cycling Team → 82.800 pts (balance er 0)
      Team Visma        → 72.540 pts
      Groupama          → 60.406 pts
      Equipo Kern       → 54.002 pts
      Solution Tech     → 31.200 pts
      Hopplà Team       → 18.636 pts
      Red Bull-Bora     → 16.404 pts
      Vestas            →  6.805 pts
      ─────────────────────────────────
      SUM emergency-lån                  ~438.415 pts
      SUM salary-debit (17 hold)        ~1.524.700 pts

B3. Negativ-balance interest (10% af negativ balance efter salary)
    └─ Få hold vil have negativ balance efter salary trækkes
       FØR emergency-lån registreres på balance (rækkefølge i koden:
       emergency_loan KREDITERER først, så salary DEBITERER).
       Min læsning af [economyEngine.js:624-650](backend/lib/economyEngine.js:624):
       createEmergencyLoan(shortfall) kører FØR debitTeam(salary),
       så efter salary er balance ≈ 0 (eller lige over).
       Negativ-balance-interest skipper for de 9 emergency-lån-hold.

B4. Board evaluation for non-baseline boards:
    if (board.is_baseline || board.plan_type === "baseline") continue;
    └─ 19 hold har baseline-flag korrekt → skippes
    └─ Chris Machines (3 plans: 1yr+3yr+5yr, ALLE non-baseline completed)
       → ALLE 3 evalueres som "plan udløbet" (seasons_completed=0+1=1,
         planDuration=1/3/5)
       → 1yr-plan: planIsComplete=true (1>=1) → notify "Bestyrelsesplan udløbet"
       → 3yr-plan: planIsComplete=false (1<3), seasonsCompleted=1 → midReview
       → 5yr-plan: planIsComplete=false (1<5), seasonsCompleted=1 → midReview
       → 3× board_plan_snapshots INSERT (1× completed, 2× ongoing)
    └─ test-a, test-b, test-seller (1yr:pending, non-baseline)
       → negotiation_status='pending' MEN board-loop processer alle boards
         uanset negotiation_status. is_baseline=false så ikke skippet.
       → 3× board_plan_snapshots INSERT
       → 3× notify_manager (men test-hold har sjældent owner-relations)

B5. (uden for processTeamSeasonEnd-loop)
    payDivisionBonuses(standings, seasonId)
    └─ Alle 23 hold har total_points=0 → DIVISION_BONUSES[D3] = [75K, 50K, 25K]
       men `if (!amount) continue` — vent, amount er bonuses[rank-1].
       rank_in_division for 23 hold med 0 points → DB-bestemt rækkefølge.
       Hvis rank 1, 2, 3 bliver tildelt → de hold får 75K + 50K + 25K bonus!
    └─ TJEK: idempotency-index uniq_bonus_per_team_season vil tillade
       at writes går igennem (første gang for sæson 0).
    └─ **POTENTIEL EFFEKT: 75K+50K+25K = 150K bonus til 3 vilkårlige hold**

B6. processDivisionEnd for D1, D2, D3:
    └─ standings.length < 4 → return (PROMOTION+RELEGATION=4)
       D1: 0 standings → return
       D2: 0 standings → return
       D3: 23 standings → fortsætter
    └─ D3 > MIN_DIVISION → promotion top 2 to D2
       Top 2 af 23 (sortér total_points DESC) — alle har 0 points,
       så DB sortér-stabilitet bestemmer. **2 vilkårlige hold rykker op til D2.**
    └─ D3 < MAX_DIVISION (3=3) → ingen relegation fra D3

B7. UPDATE seasons SET status='completed' WHERE id=seasonId      ✅

B8. updateRiderValues(supabaseClient)
    └─ Henter alle completed seasons (de 1-3 sidste) — efter step B7 er
       sæson 0 nu completed. Men sæson 0 har 0 race_results → 0 prize_earnings.
    └─ recalc prize_earnings_bonus = avg af sidste 3 → 0 for alle ryttere.
    └─ riders.prize_earnings_bonus = 0 (uændret hvis allerede 0).
    └─ salary (GENERATED) genberegnes automatisk = uci_points × MARKET_MUL × 0.10.
       Ingen ændring.

B9. if (currentSeasonNumber === 1) startSequentialNegotiation(...)
    └─ sæson 0 ≠ 1 → SKIPPES                                      ✅
```

### Forventet DB-diff efter ⏹ (uden patch)

| Tabel | Δ rows | Δ værdi |
|---|---|---|
| `seasons` | UPDATE 1 (status + end_date) | sæson 0 → completed |
| `season_standings` | INSERT 23 | 0 points per række |
| `finance_transactions` (type=loan_interest) | INSERT 8 | -277.716 pts |
| `finance_transactions` (type=salary) | INSERT 17 | -1.524.700 pts |
| `finance_transactions` (type=emergency_loan) | INSERT 9 | +438.415 pts |
| `finance_transactions` (type=bonus) | INSERT 3 | +150.000 pts |
| `loans` | INSERT 9 (emergency) + UPDATE 8 (interest) | +438K nye lån, +278K interest |
| `teams.balance` | UPDATE 17 | Netto ~-1.2M pts på humans |
| `teams.division` | UPDATE 2 | 2 → D2 |
| `board_plan_snapshots` | INSERT 6 | 3 for Chris Machines + 3 for test-hold |
| `board_profiles` | UPDATE 1-3 (Chris Machines plans completed) | satisfaction + modifier |
| `riders` | UPDATE alle ~250 ryttere | prize_earnings_bonus=0 (no-op) |

---

## Fase 3 — ▶ Start sæson 1 (`POST /admin/seasons/:id/start`)

### Endpoint-trace ([api.js:3255-3317](backend/routes/api.js:3255))

```
1. Validér: season.status === 'upcoming'                    ✅ OK
2. Validér: ingen anden aktiv sæson                         ⚠️ KRÆVER at sæson 0 er 'completed' først
3. ensureSeasonStandings(seasonId)                          ✅ Opretter 23 rows for sæson 1
4. UPDATE seasons SET status='active', start_date=today     ✅
5. processSeasonStart(seasonId)                             🟡 Se nedenfor
6. logActivity('season_started') + notifySeasonEvent        ✅
```

### `processSeasonStart(seasonId)` line-for-line ([economyEngine.js:156-289](backend/lib/economyEngine.js:156))

#### Step A — Hent sæson-nummer + sponsor-standings-kontekst

```js
const seasonNumber = season?.number ?? null;  // = 1
const sponsorStandingsContext = await loadSponsorStandingsContextForSeason(client, 1);
// → returnerer empty context (FIRST_VARIABLE_SPONSOR_SEASON=2)
```

→ Sponsor-formel for sæson 1: `mode='intro'`, `gross_sponsor = team.sponsor_income`.

#### Step B — Load aktive sponsor-pullouts (lag 5)

```js
const { data: activePullouts } = await supabase
  .from("board_consequences")
  .select("team_id, severity, id")
  .eq("layer", 5)
  .eq("status", "active");
```

**Tjek DB:** verificér 0 active layer-5 board_consequences (forventet for open beta).

#### Step C — For hver af 23 hold:

```
C1. baseModifier = avg af completed boards (budget_modifier)
    19 hold: kun baseline (1.0) → baseModifier=1.0
    Chris Machines: 3 plans × budget_modifier (alle 1.0 i øjeblikket) → 1.0
    test-a/b/seller: 0 completed boards (pending) → fallback 1.0
    ✅ Alle hold får modifier=1.0

C2. sponsorBreakdown.mode = 'intro' (sæson 1)
    gross_sponsor = team.sponsor_income
    sponsorPayout = round(gross_sponsor × 1.0) = team.sponsor_income

    Konkret:
    - 19 normale hold: 240.000 pts hver = 4.560.000 pts total
    - 4 hold (Inuit Cycling + test-a, b, seller):
      Inuit: 240.000
      test-a/b/seller: 100 hver = 300 pts (lol)
    - Chris Machines: 240.000

    SUM sponsor-payout sæson 1 = ~5.040.300 pts

C3. creditTeam(team.id, sponsorPayout, 'sponsor', ..., season_id=1)
    └─ Idempotent via uniq_sponsor_per_team_season

C4. processLoanAgreementSeasonFees(team.id, 1, seasonId, ...)
    └─ 0 active loan_agreements → 0 fees

C5. Sikr 3 board-plans (1yr/3yr/5yr) eksisterer
    Eksisterende boards:
    - 19 hold med 1× baseline → mangler 1yr/3yr/5yr → 3 INSERTS per hold = 57 nye rows
    - Chris Machines har 1yr/3yr/5yr completed → ingen INSERTS
    - test-a/b/seller har 1yr pending → mangler 3yr/5yr → 2 INSERTS per hold = 6 nye rows
    Total nye board_profile rows: ~63

    NB: Plans er pending pr. default — sequential negotiation åbner først ved
    sæson 1 → 2 (sequential `startSequentialNegotiation` kører kun
    hvis currentSeasonNumber === 1, dvs. ved sæson 1 SLUT).
```

#### Step D — Expire sponsor-pullouts (lag 5)

`if ((activePullouts || []).length > 0)` — forventet 0 → skip.

### Bugs / mangler

**Bug 3-1 — `transfer_windows`-row for sæson 1 oprettes ikke.**
Den manuelle `/start`-endpoint har ingen INSERT/UPDATE på `transfer_windows`. Sæson 0's window forbliver `status='open'`.

**Konsekvens:** `closePrevTransferWindow`-cron-trigger ved season-transition vil senere finde sæson 1 med ingen window. Hvis bruger åbner/lukker transfer-window via `/admin/transfer-window/open` + `/close` skal et nyt window oprettes manuelt — eller `/start` skal patches.

**Bug 3-2 — Sæson 0's window har stadig `closes_at=2026-05-21 21:00 UTC` (23:00 CEST).**
Cron `seasonAutoTransition` kræver `final_whistle_sent_at` + `squad_enforcement_completed_at` på det window for at trigge auto-transition. Begge er NULL → cron'en er stille for sæson 0. Det er fint — vi vil ikke have auto-transition for 0→1.

**Bug 3-3 — Confirm-dialog i SeasonCycleSection lyver om `status='active'`.**
[SeasonCycleSection.jsx:53](frontend/src/components/admin/SeasonCycleSection.jsx:53) viser "Oprette sæson X+1 (status='active')". Men `insertSeasonIfMissing` opdaterer ikke status fra `upcoming` til `active` hvis row eksisterer ([seasonTransition.js:166-186](backend/lib/seasonTransition.js:166)). For 0→1 har vi præcis det scenario (sæson 1 oprettet med upcoming fra legacy endpoint). Dette skal patches inden engine'n bruges, eller manuelt fixes med SQL.

---

## Fase 4 — Sæson 1 kørsel (recurring økonomi-events)

Cheat-sheet over hvad der trigger pengebevægelser mens sæson 1 kører:

| Event | Trigger | Penge-flow | Tabel-write |
|---|---|---|---|
| **Race-import** | `POST /admin/import-results` (XLSX) → `applyRaceResults` | Præmiepenge per resultat-række × `points_earned × PRIZE_PER_POINT(1500)` | `finance_transactions` type='prize', `teams.balance` +, `race_results` |
| **Auction-finalisering** | `finalizeExpiredAuctions`-cron (60s) | Køber debit, sælger kredit (hvis menneske) | type='transfer_in'/'transfer_out', `auctions.status=completed` |
| **Lukket vindue auction-vinder parkering** | Som auction-finalisering, men `pending_team_id` i stedet for `team_id` | Penge flyttes alligevel | Som ovenfor |
| **Manual transfer-window åbn** | `POST /admin/transfer-window/open` | Batch `pending_team_id → team_id` for alle parkerede | `riders.team_id`, `transfer_windows` |
| **Manual transfer-window luk** | `POST /admin/transfer-window/close` | Trigger `squadEnforcement` (tvangssalg/-køb hvis under/over squad-size) | type='squad_auto_*', `finance_transactions`, `riders.team_id` |
| **Transfer accept** | `POST /api/transfer-offers/:id/accept` (åbent vindue) | Køber debit + sælger kredit | type='transfer_in'/'transfer_out' |
| **Swap accept** | `POST /api/swap-offers/:id/accept` | Cash-delta begge veje | type='swap_cash_delta' |
| **Loan accept** | `POST /api/loans/...` | Principal modtaget; renter ved sæson-end | type='loan_principal_received', 'loan_origination_fee' |
| **Loan agreement renew** | `processSeasonStart` kalder `processLoanAgreementSeasonFees` | Lejegebyrer | type='loan_fee_paid'/'loan_fee_received' |
| **Gældsadvarsel** | `checkDebtWarnings`-cron (6h) | Kun notifikation, ingen penge | `notifications` |
| **Board bonus accept** | Manager initierer | Penge mod manager | type='board_bonus_accepted' |
| **Sequential negotiation åbn (ved sæson 1 SLUT)** | `processSeasonEnd(1)` → `startSequentialNegotiation` | Ingen penge, kun board-flow | `board_profiles.negotiation_status` |

Salaries og sponsor afregnes IKKE midt-sæson — kun ved sæson-start (sponsor) og sæson-end (salary + interest + bonus).

---

## Fase 5 — Sæson 1 → 2 (via Slice 08 season-transition-engine)

Når sæson 1 er kørt færdig + transfer-window er lukket + squad-enforcement done, kan transition trigges:

### Option 5.1 — Manuel via `🔄 Sæson-cyklus`-knappen på `/admin → Sæson`

```
1. GET /api/admin/season-transition/preview (dry-run)
   → fetchPreview viser plan: hvilken sæson lukkes/åbnes, sponsor-total
2. Bruger trykker "Udfør sæsonskifte" → confirm-dialog
3. POST /api/admin/season-transition
   → transitionToNextSeason({ fromSeasonId: aktiv-sæson, transitionAt: now })
```

### Option 5.2 — Auto via `seasonAutoTransition`-cron

Triggers når `transfer_windows.status='closed'` AND `final_whistle_sent_at IS NOT NULL` AND `squad_enforcement_completed_at IS NOT NULL` for sæson 1's window. ~5-15 min efter window-close.

### Hvad gør `transitionToNextSeason` 1 → 2 (forenklet)

```
Phase 1: buildTransitionPlan → preview med sponsor-breakdown for sæson 2
         Sponsor for sæson 2: mode='variable', base=200K + variabel 0-150K
         (FIRST_VARIABLE_SPONSOR_SEASON = 2)

Phase 2: insertSeasonIfMissing(toSeasonId=00...002)
         Hvis sæson 2 ikke eksisterer → INSERT status='active', start_date=now
         (For 1→2 vil sæson 2-row IKKE eksistere, så denne fungerer korrekt
          modsat 0→1-tilfældet)

Phase 3: markSeasonCompleted(fromSeasonId=00...001)
         UPDATE status='completed', end_date=transitionAt

Phase 4: closePrevTransferWindow(fromSeasonId=00...001)
         UPDATE transfer_windows SET status='closed' for forrige sæson

Phase 5: insertTransferWindowIfMissing(toWindowId, toSeasonId, 'closed')
         Nyt window for sæson 2 med status='closed' (åbnes når bruger ønsker)

Phase 6: processSeasonStart(toSeasonId)
         Sponsor-payout (200K + variabel × board-modifier × sponsor-pullout)
         Initialize board plans
         Charge recurring loan_agreement fees

Phase 7: admin_log INSERT action_type='season_transition'
```

**KRITISK FORUDSÆTNING:** `processSeasonEnd(1)` skal være KØRT FØR engine'n bruges for 1→2. Engine'n hopper det over by design (sæson 0 special-case kommenteret, men for sæson ≥ 1 antages det er kørt).

For sæson 1 betyder det:
- Bruger skal selv trigge `POST /admin/seasons/1/end` FØR `POST /admin/season-transition`
- ELLER lade `seasonAutoTransition`-cron'en køre den i rækkefølge (efter window-close → enforcement → transition). Tjek om cron'en kalder `processSeasonEnd` separat.

**Læs:** [seasonAutoTransition.js:18-63](backend/lib/seasonAutoTransition.js:18) kalder KUN `transitionToNextSeason`. Den kalder IKKE `processSeasonEnd`. **Det er et ANDET hul.** For 1 → 2 vil cron'en lave sponsor-payout for sæson 2 uden at have kørt salary/interest/bonus for sæson 1.

→ **Følg-op til parkering:** når sæson 1 nærmer sig slut, beslut hvordan `processSeasonEnd(1)` trigges. Se [#532](https://github.com/NicolaiDolmer/CyclingZone/issues/532) for nuværende plan.

---

## Fase 6 — Plan-verifikation (gap-analyse mod 4 kilder)

### Kilde A — `docs/NOW.md` (bullets øverst)

| Krav i NOW.md | Faktisk i kode | Gap |
|---|---|---|
| "Brug IKKE Udfør sæson-skifte i SeasonCycleSection — manual ⏹/▶ knapper er det rigtige flow for 0→1" | ❌ Vanilla ⏹ kører `processSeasonEnd` ubetinget → 1.5M+ pts side-effects | **🔴 Råd er forkert**. Engine er FAKTISK sikrere (special-case for sæson 0) — den manuelle flow er den farlige. NOW.md bør opdateres. |
| "⏹ Afslut-endpoint kalder processSeasonEnd som via ensureSeasonStandings opretter standings-rows for alle 24 hold + kører salary/division-logik. For sæson 0 (open-beta, 0 races, 0 points) er det formentlig harmløst" | ❌ IKKE harmløst | **🔴 Verificeret farligt.** Se Fase 2 ovenfor. |
| "▶ Start-endpoint opretter IKKE transfer_windows-row for sæson 1" | ✅ Bekræftet | **🟡 Stadig hul** |
| "Lav Supabase MCP create_branch → test manual flow på branchen → verificér end-state matcher forventning → derefter samme handling på prod" | ✅ Råd er korrekt | Følges? Ja, den her audit er denne backwards-check. |
| "Sæson 1 starter i aften kl 23:00" | Sæson 1 row klar med deterministisk UUID + 26 races m. edition_year | ✅ |

### Kilde B — `docs/MASTER_PLAN.md`

Master-planen er strategisk og dækker ikke economy-flow detaljer. Ingen specifik kontrakt for sæson 0→1 er nævnt. **Ingen gaps.**

### Kilde C — Slice 08 / `docs/slices/07-economy-overhaul-MASTER.md` / `docs/slices/02-board-redesign-MASTER.md`

| Slice-doc krav | Faktisk i kode | Gap |
|---|---|---|
| Slice 08 ([#239](https://github.com/NicolaiDolmer/CyclingZone/issues/239)): "Hvis X ≥ 1: kør processSeasonEnd(X) for salary/divisionsbonus/lånerenter (skip for X=0)" | ✅ `transitionToNextSeason` skipper processSeasonEnd. Antager den ER kørt FØR for X≥1 | **🟡 Engine antager processSeasonEnd er kørt manuelt — `seasonAutoTransition`-cron kalder ikke processSeasonEnd, så for 1→2 har vi et fremtidigt hul** |
| Slice 08 AC: "Sæson X+1 oprettet med status='active'" | ❌ `insertSeasonIfMissing` skipper UPDATE hvis row eksisterer (med status='upcoming') | **🔴 Bug 3-3** — i 0→1 tilfældet vil sæson 1 forblive 'upcoming' når engine'n bruges, fordi rowen blev oprettet af legacy endpoint før engine'n. |
| Slice 02 (S-02a): "Når sæson 1 (baseline) slutter, åbn sekventiel onboarding for sæson 2" | ✅ `processSeasonEnd(1)` → `startSequentialNegotiation` (kun hvis number===1) | **🟡 Bekræftet — men kun hvis processSeasonEnd FAKTISK kører for sæson 1. Hvis bruger skipper det → ingen sequential** |
| Slice 07f: "Sæson 1 forbliver flat 240K under introsæson-flag. Formlen aktiverer naturligt ved første sæson-2-start." | ✅ `FIRST_VARIABLE_SPONSOR_SEASON=2`, sæson 1 sponsor='intro' mode | ✅ OK |
| Slice 02 baseline-skip: "if (board.is_baseline OR plan_type === baseline) continue" | ✅ 19 hold med korrekt flag, 4 hold (test-a/b/seller + Chris Machines) UDEN baseline-flag → IKKE skippet | **🟡 4 hold får board snapshots ved ⏹ — overraskelse, men ikke critical** |

### Kilde D — `.claude/learnings/`

`.claude/learnings/2026-05-21-season-1-uuid-drift.md`:

| Læring | Status |
|---|---|
| Open follow-up: "transfer_window for sæson 1 mangler" | 🟡 Ikke fixed. Bekræftet stadig hul ved manuel flow |
| Open follow-up: "Sammenligning af `start`-endpoint vs `season-transition`-endpoint" | 🟢 Lavet i denne audit (se Fase 3 + Fase 5) |
| Open follow-up: "Audit-mekanisme: tilføj startup-check der sammenligner seasons.id mod computeSeasonUuid(number)" | 🔴 Ikke implementeret. Anbefalet at oprette issue. |

`docs/archive/SEASON_END_REPAIR_HANDOFF_2026-04-29.md` (pre-launch sæson 6 repair):

| Læring | Status |
|---|---|
| "processSeasonEnd does division updates before finance/board" — gammel race condition fixed i [economyEngine.js:402-419](backend/lib/economyEngine.js:402) (nu finance/board FØR division) | ✅ Verificeret |
| "Live DB har mere end én teams→riders relationship, embedded riders kan fejle med PGRST201" | ✅ Fixed med eksplicit `loadHumanSeasonEndTeams` der laver separate queries |

### Sammendrag — gap-rapport

| ID | Gap | Prioritet | Action |
|---|---|---|---|
| G1 | NOW.md anbefaler manual ⏹/▶ flow, men det er IKKE sikkert for sæson 0 | 🔴 Kritisk | Opdatér NOW.md til at anbefale engine + 1-line patch ELLER patch legacy endpoints (Option B) |
| G2 | `insertSeasonIfMissing` opdaterer ikke status=`upcoming`→`active` | 🔴 Kritisk for 0→1 | 1-line patch i seasonTransition.js eller manuel SQL bagefter |
| G3 | `▶ Start`-endpoint opretter ikke `transfer_windows`-row | 🟡 Medium — Option A undgår dette ved at bruge engine | Patch eller skift til engine |
| G4 | `seasonAutoTransition`-cron kalder ikke `processSeasonEnd` | 🟡 Medium — fremtidigt problem for 1→2 og senere | Issue til at klargøre rækkefølge for sæson 1 → 2 |
| G5 | 4 hold uden baseline-flag får board-snapshots ved sæson 0 end | 🟢 Lavt — kosmetisk, ingen pengeeffekt | Dokumentér, ignorér eller patch baseline-flag |
| G6 | Audit-mekanisme for UUID-drift mangler | 🟢 Lavt — postmortem follow-up | Opret issue |

---

## Konkret next-step-liste før 23:00

- [ ] **Beslut Option A/B/C** for sæson 0 → 1
- [ ] Hvis Option A: 1-line patch i `seasonTransition.js#insertSeasonIfMissing` så UPDATE køres når `existing.status='upcoming'`
- [ ] Test patch på Supabase MCP `create_branch` → kør transition → verificér end-state (sæson 1 active, sponsor udbetalt, vindue closed)
- [ ] Push patch + verify-deploy
- [ ] Opdatér `docs/NOW.md` — anbefal engine + Option A, fjern "formentlig harmløs"-formuleringen
- [ ] Kl 23:00: tryk `🔄 Udfør sæsonskifte` i admin → bekræft per-fase-log
- [ ] Bagefter: query `SELECT id, number, status FROM seasons` + `SELECT * FROM transfer_windows` + `SELECT COUNT(*), type FROM finance_transactions WHERE season_id='00...001' GROUP BY type` for verifikation
- [ ] Bekræft 23 sponsor-rows á 240K (eller 100 for test-hold) for sæson 1

---

## Referencer

- Issue [#532 Validér + reparér manual ⏹/▶ flow](https://github.com/NicolaiDolmer/CyclingZone/issues/532)
- Issue [#239 Slice 08 Sæson-transition engine](https://github.com/NicolaiDolmer/CyclingZone/issues/239)
- Issue [#242 Slice 09 Race-import](https://github.com/NicolaiDolmer/CyclingZone/issues/242)
- Issue [#452 Tilmeld-knap til kommende sæson](https://github.com/NicolaiDolmer/CyclingZone/issues/452)
- Postmortem: [`.claude/learnings/2026-05-21-season-1-uuid-drift.md`](.claude/learnings/2026-05-21-season-1-uuid-drift.md)
- Engine: [`backend/lib/seasonTransition.js`](backend/lib/seasonTransition.js)
- Legacy endpoints: [`backend/routes/api.js:3255`](backend/routes/api.js:3255) (start), [`:3319`](backend/routes/api.js:3319) (end)
- UI: [`frontend/src/components/admin/SeasonCycleSection.jsx`](frontend/src/components/admin/SeasonCycleSection.jsx)
- Event-sequence doc: [`docs/EVENT_SEQUENCE.md`](docs/EVENT_SEQUENCE.md)
- Economy invariants: [`docs/GAME_INVARIANTS.md`](docs/GAME_INVARIANTS.md)
- Slice 08 master: [`docs/slices/07-economy-overhaul-MASTER.md`](docs/slices/07-economy-overhaul-MASTER.md)
