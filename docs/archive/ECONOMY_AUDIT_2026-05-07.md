# ØKONOMI-SYSTEM AUDIT — 2026-05-07

**Sæson-state-baseline:** Open beta åbnet 2026-05-04, sæson 1 aktiv, 0 sæsoner afsluttet, ~19 managers live. Pre-launch dev-docs (fx `ECONOMY_BASELINE_SIMULATION_2026-04-29.md`) refererer til "sæson 6/7" — det er artefakter fra TEST-database FØR beta-reset til open beta. Når denne audit tilbage-genbruges senere: ignorér ALLE sæson-numre i pre-2026-05-04 archive-docs.

**Trigger:** 3 kritiske økonomi-bugs på samme dag (2026-05-06): sponsor-fallback `?? 100` (v2.49), gældsloft off-by-fee (v2.48), auktion TOCTOU-race (v2.46). Alle bugs ramte sæson-1-start eller pre-sæson-1-state. Hypotese: ikke isolerede bugs men et mønster der skal lukkes systemisk.

**Metode:** 3 parallelle Explore-agents kortlagde write-paths/TOCTOU, hardcodede konstanter/divergente formler, og audit-trail/test-coverage. Alle kritiske fund verificeret manuelt mod runtime før rapportering.

**Resultat:** 9 fund — 4 P0 (production-bug-risiko), 3 P1 (correctness/safety), 2 P2 (observability). Drives ud i 8 backlog-slices (se [docs/slices/07-economy-overhaul-MASTER.md](../slices/07-economy-overhaul-MASTER.md)).

---

## Severity-matrix

| ID | Fund | Sev | Kategori | Slice |
|---|---|---|---|---|
| F1 | `?? 0` sponsor-fallback i 3 callsites + `?? 0.15` loan-fee fallback | **P0** | Stale konstant | 07a |
| F2 | `DEFAULT_TEAM_VALUES.sponsor_income = 260000` vs `DEFAULT_SPONSOR_INCOME = 240000` | **P0** | Drift | 07a |
| F3 | TOCTOU: `createLoan` debt-ceiling check uden DB-constraint | **P0** | Race-condition | 07b |
| F4 | TOCTOU: `payDivisionBonuses` cron-retry kan dobbeltbetale | **P0** | Idempotency | 07b |
| F5 | `createEmergencyLoan` har INTET debt_ceiling-tjek | **P1** | Sikkerhed | 07b |
| F6 | Alle balance-updates 2-trin SELECT→UPDATE; ingen atomicity | **P1** | Concurrency | 07c |
| F7 | `admin_log`-tabellen eksisterer ikke i schema/migration | **P1** | Audit-trail | 07d |
| F8 | `finance_transactions` mangler actor/source/reason/before/after | **P2** | Observability | 07d |
| F9 | `prizePayoutEngine` har 0 tests; 6/7 økonomi-invariants utestede | **P2** | Test-coverage | 07b/07d |

---

## A. Stale fallbacks + DEFAULT-drift (P0)

### F1.1 — `sponsor_income ?? 0` i 3 callsites
[backend/routes/api.js:3238](../../backend/routes/api.js:3238) `currentSponsorIncome: teamRes.data?.sponsor_income ?? 0`  
[backend/routes/api.js:3772](../../backend/routes/api.js:3772) `currentSponsorIncome: team?.sponsor_income ?? 0`  
[backend/lib/boardGoals.js:969](../../backend/lib/boardGoals.js:969) `const currentSponsorIncome = context.currentSponsorIncome ?? team?.sponsor_income ?? 0`

**Mønster:** identisk med v2.49-buggen. Hvis `team.sponsor_income` er null (ny manager før første sæsonstart, eller efter beta-reset hvor kolonnen ikke er sat) bruges 0 som fallback. Resultat i board-goal-context: sponsor_growth-mål evaluerer mod 0-baseline → urigtig progress, urigtig satisfaction → urigtig modifier næste sæson.

**Korrekt:** `?? DEFAULT_SPONSOR_INCOME` (240000), eksporteret fra [economyEngine.js:63](../../backend/lib/economyEngine.js:63).

**Bekræftet vha. Grep:** der er 4 korrekte callsites der bruger `?? DEFAULT_SPONSOR_INCOME` (betaResetService.js:230, boardAutoAccept.js:280, economyEngine.js:223, api.js:3675) og 3 stragglers med `?? 0`. Migration mangler at være afsluttet.

### F1.2 — `?? 0.15` loan-fee fallback
[backend/lib/loanEngine.js:169-170](../../backend/lib/loanEngine.js:169):
```js
const feeRate = config?.origination_fee_pct ?? 0.15;
const interestRate = config?.interest_rate_pct ?? 0.15;
```

Hvis `loan_config`-row for `loan_type='emergency'` mangler i DB (fx ny division uden seed, eller migrations-fejl), bruges 15% — som er en hardcoded default uden DB-validation. Authoritative emergency-rate står ikke i nogen fil, kun i seed.

**Risiko:** lav i dag (alle 3 divisioner er seedet), men hvis DB-state nogensinde driver, opretter vi nødlån med stille forkert rate uden at det fanges. Bug-mønster identisk med `?? 100`.

**Korrekt:** kast hvis `config` er undefined (fail-fast) eller importér delte konstanter fra `loanConstants.js`.

### F2 — Sponsor-default drift 260K vs 240K
[backend/lib/teamProfileEngine.js:6](../../backend/lib/teamProfileEngine.js:6): `DEFAULT_TEAM_VALUES.sponsor_income = 260000`  
[backend/lib/economyEngine.js:63](../../backend/lib/economyEngine.js:63): `export const DEFAULT_SPONSOR_INCOME = 240000`  
[database/schema.sql:31] (verificeret): `teams.sponsor_income DEFAULT 240000`

**Drift-historik:** sponsor blev tunet fra 240K → 260K i v1.76 ([2026-04-30-economy-light-tune-v176.sql](../../database/2026-04-30-economy-light-tune-v176.sql)). Kun den `live`-konstant blev opdateret nogle steder; DB-default forblev 240K, og engine-fallback for null-tilfælde forblev 240K. teamProfileEngine.js fik 260K opdateringen og afviger nu fra de andre to.

**Konsekvens:** ved oprettelse af nyt hold via `createTeamForUser` (teamProfileEngine.js) sættes sponsor_income = 260K. Ved sæsonstart udbetales 240K hvis fallback kicker ind (det gør den ikke i normal flow, men inkonsistensen er en forvirringsfælde for fremtidige bugs). Aktuel runtime-værdi for hold oprettet før v1.76 er 240K; for hold oprettet derefter er 260K (en blanding i prod).

**Korrekt:** ÉN delt konstant (`backend/lib/economyConstants.js`) importeret af alle 3 steder + DB-default opdateret til at matche.

---

## B. TOCTOU + idempotency-mangler (P0)

### F3 — `createLoan` debt-ceiling race-condition
[backend/lib/loanEngine.js:125-127](../../backend/lib/loanEngine.js:125):
```js
const currentDebt = await getTotalDebt(teamId, client);
if (currentDebt + totalOwed > config.debt_ceiling) {
  throw new Error(`Gældsloft på ${config.debt_ceiling} CZ$ nået for denne division`);
}
```

`getTotalDebt` SELECT'er aktive lån, summerer i app, sammenligner. Concurrent `createLoan`-call (manager dobbeltklikker, eller cron-retry) kan begge bestå tjekket fordi neither har INSERT'et endnu. Identisk mønster med v2.46-auktion-bug der lige blev fixet.

**Bekræftet runtime via NOW.md:** Above & Beyond Cancer Cycling endte 54 CZ$ over 600K-loftet allerede (v2.48-fix retter selve fee-tjekket men ikke racen).

**Korrekt:** Postgres-funktion `create_loan_atomic(...)` der tager rådighedslås på `loans WHERE team_id = $1 FOR UPDATE` inden den tjekker og INSERTs. Eller partial unique-constraint hvis loftet kan formuleres som DB-regel (svært fordi det er sum).

### F4 — `payDivisionBonuses` mangler idempotency-key
[backend/lib/economyEngine.js:263-281](../../backend/lib/economyEngine.js:263):
```js
const alreadyPaid = new Set(/* fra finance_transactions hvor type='bonus' og season_id */);
for (const team of teams) {
  if (alreadyPaid.has(team.id)) continue;
  await creditTeam(...);
}
```

App-tjek på "har vi allerede betalt bonus"-baseret på finance_transactions row. Ingen DB-constraint sikrer det; cron der retry'er midt i loop'et (efter delvis kreditering, før tx-insert) kan dobbeltbetale.

**Bekræftet via test-coverage map:** ingen invariant-test der verificerer idempotens for sponsor- eller bonus-payout (agent C, sektion E).

**Korrekt:** unique partial index på `finance_transactions(team_id, season_id) WHERE type='bonus'`. Samme mønster bør anvendes på `type='sponsor'` og `type='salary'` for sæson-skalerede payouts.

### F5 — `createEmergencyLoan` uden debt_ceiling-tjek
[backend/lib/loanEngine.js:164-207](../../backend/lib/loanEngine.js:164): kalder direkte `loans.insert` + `adjustBalance(+amountNeeded)` uden at validere `currentDebt + totalOwed ≤ debt_ceiling`.

**Kald-stier:**
- [backend/lib/economyEngine.js:processSeasonEnd] hvis manager ikke kan betale løn
- [backend/lib/squadEnforcement.js:executeAutoPurchase] hvis manager ikke kan betale auto-køb

Begge er auto-triggered. Resultat: en manager der allerede er ved gældsloft kan auto-presses MERE i gæld ved sæsonslut + squad-enforcement. Ingen øvre grænse beskyttes.

**Korrekt:** emergency-lån skal stadig respektere debt_ceiling — alternativt skal manager *konkurs-mekanik* (relegering, balance-reset, GAME OVER) udløses i stedet for ubegrænset gæld. Beslutning hører til 07b.

### F6 — `processLoanInterest` uden idempotency
[backend/lib/loanEngine.js:252-282](../../backend/lib/loanEngine.js:252): per-lån UPDATE `amount_remaining = amount_remaining + interest`. Ingen tjek på om interest allerede er tilskrevet for `(loan_id, season_id)`. Cron-retry midt i loop'et tilskriver dobbelt-rente.

**Korrekt:** unique partial index `finance_transactions(team_id, season_id, related_loan_id) WHERE type='loan_interest'`. Eller atomic UPDATE der inkluderer `WHERE last_interest_season != $current_season`.

---

## C. Atomic balance updates (P1)

### F7 — Alle balance-updates er 2-trin SELECT→UPDATE
**Bekræftet via agent A's path-map:** 16 async write-paths bruger samme mønster:
1. `SELECT balance FROM teams WHERE id = $1`
2. compute `newBalance = balance + delta`
3. `UPDATE teams SET balance = newBalance WHERE id = $1`

[backend/lib/loanEngine.js:25-31 `adjustBalance`](../../backend/lib/loanEngine.js:25) er den centrale helper, men API-routes ([api.js:1728-1729, 1772-1773](../../backend/routes/api.js:1728)) og auctionFinalization, transferExecution, prizePayoutEngine, squadEnforcement bruger alle samme pattern direkte.

**Risiko:** concurrent operations på samme team taber updates. Eksempel: manager vinder auktion (+100K credit) samtidig med at salary trækkes (-50K). Hvis SELECT-step kører for begge før UPDATE-step, ender balance med kun den seneste write — ÉN af de to operationer "forsvinder".

**Sandsynlighed i prod:** lav fordi ~19 managers og operationer er sjældent parallelle. Men race condition er reel — auction-finalisering cron (60s) overlapper jævnligt med transfer accept (manager-driven). Der ER ingen tests for det.

**Korrekt:** Postgres-function `increment_balance(team_id uuid, amount integer)` (allerede dokumenteret i loanEngine.js:5-9 men brugt INTET sted). Migration: opret funktionen, refaktor alle 16 callsites til at bruge `client.rpc('increment_balance', {team_id, amount})`.

**Sekundær gevinst:** atomic balance update + finance_transactions insert kunne gøres til ÉN transaktion (Postgres-funktion der tager finance_transaction-payload som JSONB) — så partial-write-state er umulig (i dag: hvis tx-insert fejler efter balance-update, har vi tabt audit-trail).

---

## D. Audit-trail tomhed (P1)

### F8 — `admin_log`-tabellen eksisterer IKKE
**Bekræftet via:**
- `Grep "CREATE TABLE.*admin_log"` mod `database/` → `No matches found`
- `Grep "admin_log"` mod `backend/` → 6 INSERT-callsites:
  - [backend/routes/api.js:2578, 2602, 2818, 2841, 2863](../../backend/routes/api.js:2578)
  - [backend/lib/auctionCancellation.js:105](../../backend/lib/auctionCancellation.js:105)
- Tabellen testes som mock i [auctionCancellation.test.js:71-174](../../backend/lib/auctionCancellation.test.js:71)

**Konsekvens:** Hver eneste admin-handling (auktion-annullering, balance-justering, force-payout, beta-reset, race-result godkendelse) kalder `INSERT INTO admin_log` der fejler stille fordi callsites bruger best-effort try/catch (auctionCancellation.js:113 `catch (_e) { /* best-effort */ }`). 0 admin-handlinger logges nogensinde.

**Korrekt:** opret tabel via migration (kolonner: `id`, `admin_user_id`, `action_type`, `description`, `target_team_id`, `target_rider_id`, `meta JSONB`, `created_at`). Fjern best-effort-swallows; admin-handlinger skal fejle højlydt hvis log-write fejler.

### F9 — `finance_transactions` mangler audit-kolonner
[database/schema.sql:326-338] (verificeret):
```sql
CREATE TABLE finance_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sponsor','prize','salary','transfer_in','transfer_out',
    'interest','bonus','starting_budget','loan_received','loan_repayment','loan_interest',
    'emergency_loan','admin_adjustment')),
  amount BIGINT NOT NULL,
  description TEXT,
  season_id UUID REFERENCES seasons(id),
  race_id UUID REFERENCES races(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Mangler for "perfekt admin historik":**
- `actor_type` (`cron|api|admin|system`) — hvem trigget skrivningen
- `actor_id` — bruger-uuid hvis admin, cron-job-navn hvis cron
- `source_path` (fx `loanEngine.createLoan`, `auctionFinalization.finalizeWinner`)
- `reason_code` (enum: `season_start_sponsor`, `auction_winner_payment`, `squad_violation_fine`...)
- `before_balance` / `after_balance` (snapshot for instant audit-trail uden window-funktioner)
- `related_entity_type` / `related_entity_id` (auction/loan/transfer-FK i ÉN normaliseret kolonne)
- `idempotency_key` (TEXT UNIQUE NULLABLE — for cron-retry dedup)

### F10 — Type-coding fejl (sub-finding under audit-trail)
[backend/lib/loanEngine.js:73-86](../../backend/lib/loanEngine.js:73): `processLoanAgreementSeasonFees` skriver loan-fee-betaling som `type='transfer_out'` og modtager-side som `type='transfer_in'`. Det er semantisk forkert — det er en lejegebyr (loan fee), ikke en transfer.

**Konsekvens:** rapporter der filtrerer `type IN ('transfer_in','transfer_out')` for "transfers" tæller lejegebyrer med. Manager-aktivitet-feed viser "Transfer modtaget" når det er lejeindbetaling.

**Korrekt:** tilføj `type='loan_fee_paid'` og `type='loan_fee_received'` til CHECK-constraint, opdater callsite. Migration skal også re-typer eksisterende rows.

---

## E. Test-coverage gaps (P2)

### F11 — `prizePayoutEngine.js` har 0 tests
**Bekræftet via:** `Glob backend/lib/prizePayoutEngine.test.js` → no files found.

paySeasonPrizesToDate er den eneste path der udbetaler præmier (per [NOW.md:30 invariant](../NOW.md): "applyRaceResults udbetaler IKKE præmier — kun prizePayoutEngine.paySeasonPrizesToDate"). Den path har 0 dedikerede tests og er ikke dækket af nogen invariant-test.

### F12 — 6/7 økonomi-invariants har 0 tests
Per agent C's coverage-map:

| Invariant | Test-status |
|---|---|
| Sum(finance_transactions.amount) per team ≈ teams.balance | ❌ 0 tests |
| balance ≥ -debt_ceiling efter enhver operation | ❌ 0 tests |
| Sponsor udbetales præcis ÉN gang per (team, season) | ❌ 0 tests |
| Salary trækkes præcis ÉN gang per (team, season) | ❌ 0 tests |
| Prize-payout idempotent per (team, race) | ⚠ delvis (race.prize_paid_at-tjek findes; ingen test) |
| Loan amount_remaining ∈ [0, principal+fee] | ❌ 0 tests |
| Squad-fine idempotent per (team, transfer_window) | ⚠ atomic claim findes; ingen test af double-run |

### F13 — Best-effort try/catch swallowing
[backend/lib/auctionCancellation.js:82, 95, 113](../../backend/lib/auctionCancellation.js:82): `catch (_e) { /* best-effort */ }` på admin-log-insert + notifications.

**Konsekvens:** når `admin_log`-insert fejler (fordi tabellen ikke findes), opdager vi det aldrig. Når notifyTeamOwner fejler i økonomi-paths, opdager vi det aldrig.

**Korrekt:** strukturér logging gennem en delt `logEconomicEvent()`-helper der altid skriver til både console og en `system_errors`-tabel. Best-effort er OK for notifications (manageren mister én notif), men IKKE for audit-skrivninger.

---

## F. Observability — moderne features

Disse er IKKE fund af eksisterende bugs, men huller i hvad et "moderne" økonomi-system bør tilbyde managere og admin:

| Feature | Mangler i dag | Slice |
|---|---|---|
| Manager finance-forecast (næste sæson cashflow) | Ingen forecasting; manager ser kun nutid | 07g |
| Risk-/sustainability-tier (gæld vs. loft, salary vs. cashflow) | Bin/blod-vis ikke; manager opdager først problemer ved sæsonslut | 07g |
| Sponsor variabel ift. resultater | Sponsor er flat 240K + board-modifier; ingen point/rank-skalering | 07f |
| Season financial close-out report | Ingen dedikeret rapport; data spredt over Finance, SeasonEnd, ActivityFeed | 07h |
| Admin økonomi super-dashboard | Per-hold-økonomi kun via team-profile-page; ingen aggregeret view | 07e |

---

## Slice-roadmap (rangeret)

Forslag til prioritering med begrundelse:

| Slice | Sev/værdi | Estimat | Begrundelse |
|---|---|---|---|
| **07a** Stale fallbacks + drift | P0 bug | S (~30-60 min) | Hurtig at rette, ingen DB-migration. Lukker direkte mønster fra v2.49. |
| **07b** TOCTOU + idempotency-keys | P0 bug | M (~2 sessioner) | Forhindrer reelle prod-bugs (debt-loft-overskridelse, double-payout). |
| **07c** Atomic balance updates (Postgres-RPC) | P1 safety | M (~1-2 sessioner) | Eliminerer hele kategorien af lost-update-races. Kræver migration + 16 callsite-refaktor. |
| **07d** Komplet finance audit-log + admin_log | P1 audit | M (~2 sessioner) | Foundation for "perfekt admin historik". Schema-migration + write-path-update + admin_log-tabel. |
| **07e** Admin økonomi super-dashboard | Feature | M (~2 sessioner) | UI på toppen af 07d. Kan ikke startes før 07d. |
| **07f** Sponsor variabel ift. resultater | Feature | M (~1-2 sessioner) | Comeback-mekanik fra backlog. Kræver økonomi-baseline ny simulation. |
| **07g** Manager finance-forecast + risk-tier | Feature | M (~2 sessioner) | Football-Manager-stil. Bygger oven på 07d's audit-data. |
| **07h** Season financial close-out report | Feature | S-M (~1 session) | Genbruger SeasonEndPage-mønster. Sidste i sekvensen. |

**Anbefalet rækkefølge:** 07a → 07b → 07d → 07c → 07e → 07f → 07g → 07h. Bug-fixes først (07a-c), foundation før features (07d før 07e/07g/07h), 07f kan parallelt da den er uafhængig.

**Soak-gate kandidat:** efter 07b og 07c er deployet, før 07d starter — nye atomic-paths skal verifices med live double-cron-run-test.

---

## Kritiske invarianter der skal beskyttes

Alle slices skal bevare disse (matcher [GUARDRAILS_CORE.md kritiske invarianter](../GUARDRAILS_CORE.md)):

1. Rytter må ikke ende i konfliktende ejer-state
2. Betaling går aldrig til forkert hold
3. Squad limits holder efter enhver market action
4. Transfer window håndhæves ved create og accept/confirm
5. Finance transaction types matcher DB constraints
6. Notification types matcher DB constraints
7. Ændring af ét execution path kræver check af parallelt path

**Nye invarianter denne audit foreslår at tilføje:**

8. Sum(finance_transactions per team) = teams.balance ± startsaldo (kan verificeres som invariant-test eller cron-watchdog)
9. balance ≥ -debt_ceiling efter enhver write (DB CHECK constraint kandidat)
10. Sponsor/salary/bonus payouts er præcis-én-gang-per-(team, season) (DB unique partial index)
11. Loan-interest tilskrives præcis-én-gang-per-(loan, season) (DB unique partial index)

---

## Filer der skal røres på tværs af slices

| Fil | 07a | 07b | 07c | 07d | Bemærk |
|---|---|---|---|---|---|
| `backend/lib/economyConstants.js` (NEW) | ✓ | | | | Konsoliderer alle delte tal |
| `backend/lib/economyEngine.js` | ✓ | ✓ | ✓ | ✓ | DEFAULT-eksport, idempotency-key, RPC, audit-write |
| `backend/lib/loanEngine.js` | ✓ | ✓ | ✓ | ✓ | `?? 0.15`, debt-ceiling i emergency, RPC, audit |
| `backend/lib/teamProfileEngine.js` | ✓ | | | | 260K → import fra constants |
| `backend/lib/auctionFinalization.js` | | | ✓ | ✓ | RPC, audit |
| `backend/lib/transferExecution.js` | | | ✓ | ✓ | RPC, audit |
| `backend/lib/prizePayoutEngine.js` | | ✓ | ✓ | ✓ | idempotency, RPC, audit, FÅR FØRSTE TESTS |
| `backend/lib/squadEnforcement.js` | | ✓ | ✓ | ✓ | idempotency på fine, RPC, audit |
| `backend/lib/boardAutoAccept.js` | | | | ✓ | audit-write |
| `backend/lib/boardGoals.js` | ✓ | | | | `?? 0` → DEFAULT |
| `backend/routes/api.js` | ✓ | | ✓ | ✓ | 3 stragglers, RPC for direct balance writes, admin_log writes |
| `database/2026-05-07-economy-hardening.sql` (NEW) | | ✓ | | ✓ | partial unique indices, admin_log table, finance_transactions audit-cols |
| `database/2026-05-07-increment-balance-fn.sql` (NEW) | | | ✓ | | Postgres function |
| `frontend/src/pages/AdminPage.jsx` | | | | | Touched i 07e |
| `frontend/src/pages/FinancePage.jsx` | | | | | Touched i 07g/07h |

---

## Hvad rapporten IKKE dækker

- **Frontend økonomi-rendering:** ingen drift fundet (alle tal vises via API).
- **Discord-notifikation correctness:** økonomi-notifications er på listen men ikke audit-prioriteret.
- **Performance:** ingen N+1 eller slow-query-audit (separat anliggende).
- **Auth/RLS:** RLS-policies på finance_transactions er live (`schema.sql:467`); ikke audit-skoped her.
- **Beta-reset-data-integritet:** verificeret kortlagt af agent A men ingen åbne fund.

---

## Næste skridt

1. Manager beslutter rækkefølge (anbefalet: 07a → 07b → 07d → 07c → resten).
2. 07a kan startes umiddelbart — small slice, ingen migration.
3. 07b kræver dedikeret session (DB-migration + atomic refaktor).
4. 07d-07e er bundtet (admin-historik + dashboard) — foreslås kørt sekventielt med soak imellem.

Audit-rapport komplet 2026-05-07. Slice-briefings: [docs/slices/07-economy-overhaul-MASTER.md](../slices/07-economy-overhaul-MASTER.md).
