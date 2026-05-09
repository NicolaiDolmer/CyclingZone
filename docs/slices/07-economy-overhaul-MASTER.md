# Slice 07 · Economy Overhaul — MASTER

**Status:** Backlog. Drevet ud af [ECONOMY_AUDIT_2026-05-07.md](../archive/ECONOMY_AUDIT_2026-05-07.md). 8 sub-slices: 07a-07h. Anbefalet rækkefølge: 07a → 07b → 07d → 07c → 07e → 07f → 07g → 07h.

**Mål overordnet:** Lukke det bug-mønster der gav 3 økonomi-bugs på én dag (2026-05-06), bygge "perfekt admin historik" (komplet finance audit-log + admin_log + super-dashboard), og levere 4 moderne manager-features (sponsor-variabel, finance-forecast, risk-tier, season close-out report).

**Kanonisk autoritet:** Audit-rapporten er sandhedskilden for *hvad der er galt*. Master-fil her er sandhedskilden for *hvordan vi fixer det*. Detalje-briefs nedenfor er per-slice udførelsesplaner.

---

## Slice-status overblik

| ID | Titel | Sev/værdi | Estimat | Blokerer | Status |
|---|---|---|---|---|---|
| 07a | Stale fallbacks + sponsor-default drift | P0 bug | S (~30-60 min) | — | ✅ Leveret v2.50 (2026-05-07) |
| 07b | TOCTOU-fixes + idempotency-keys | P0 bug | M (~2 sessioner) | — | ✅ Leveret 2026-05-07 (a90128e, [#80](https://github.com/NicolaiDolmer/CyclingZone/issues/80)) |
| 07c | Atomic balance updates (Postgres-RPC) | P1 safety | M (~1-2 sessioner) | — | ✅ Leveret v2.91 (2026-05-09) |
| 07d | Komplet finance audit-log + admin_log | P1 audit | M (~2 sessioner) | — | ✅ Fase A + B leveret 2026-05-09 (v2.90 + v2.92, [#82](https://github.com/NicolaiDolmer/CyclingZone/issues/82) + [#235](https://github.com/NicolaiDolmer/CyclingZone/issues/235)) |
| 07e | Admin økonomi super-dashboard | Feature | M (~2 sessioner) | 07d | 🟡 Fase A leveret 2026-05-09 (v2.93 — Sundhed + Overblik + Transaktioner + drill-down). Fase B (admin_log-feed + korrelering + CSV-export) afventer ([#83](https://github.com/NicolaiDolmer/CyclingZone/issues/83)) |
| 07f | Sponsor variabel ift. resultater | Feature | M (~1-2 sessioner) | — | 🆕 Ready ([#84](https://github.com/NicolaiDolmer/CyclingZone/issues/84)) |
| 07g | Manager finance-forecast + risk-tier | Feature | M (~2 sessioner) | 07d (delvist) | ✅ Leveret v2.96 (2026-05-09, [#85](https://github.com/NicolaiDolmer/CyclingZone/issues/85)) |
| 07h | Season financial close-out report | Feature | S-M (~1 session) | 07d (delvist) | ✅ LIVE v2.97 ([#86](https://github.com/NicolaiDolmer/CyclingZone/issues/86)) |

---

# 07a · Stale fallbacks + sponsor-default drift

**1. Mål.** Lukke samme bug-mønster som v2.49 (`?? 100`-stale-fallback) på alle resterende callsites og eliminere 260K/240K-driften mellem `teamProfileEngine.js` og `economyEngine.js`.

**2. Runtime-evidens.**
- [backend/routes/api.js:3238, 3772](../../backend/routes/api.js:3238) — `sponsor_income ?? 0`
- [backend/lib/boardGoals.js:969](../../backend/lib/boardGoals.js:969) — `?? team?.sponsor_income ?? 0`
- [backend/lib/teamProfileEngine.js:6](../../backend/lib/teamProfileEngine.js:6) — hardcoder `260000`
- [backend/lib/economyEngine.js:63](../../backend/lib/economyEngine.js:63) — eksporterer `DEFAULT_SPONSOR_INCOME = 240000`
- [backend/lib/loanEngine.js:169-170](../../backend/lib/loanEngine.js:169) — `?? 0.15`
- [database/schema.sql:31] — DB-default `teams.sponsor_income = 240000`

**3. Invariant beskyttet.** Én autoritativ økonomi-konstant per begreb (sponsor base, salary rate, market mul, prize per point, debt ceiling per division, loan fee/interest per type). Ingen `??`-fallbacks der maskerer null-state — null'er skal kaste eller bruge delt konstant.

**4. Minimal change.**
1. Opret `backend/lib/economyConstants.js`:
   ```js
   export const SPONSOR_INCOME_BASE = 240000; // matcher DB-default; v1.76 ramp er board-modifier-driven
   export const INITIAL_BALANCE = 800000;
   export const MARKET_VALUE_MULTIPLIER = 4000;
   export const MIN_UCI_POINTS_FOR_VALUE = 5;
   export const PRIZE_PER_POINT = 1500;
   export const SALARY_RATE = 0.10; // info-only; DB-GENERATED, kan ikke skrives fra app
   export const NEGATIVE_BALANCE_INTEREST_RATE = 0.10;
   export const DEBT_CEILING_BY_DIVISION = { 1: 1200000, 2: 900000, 3: 600000 };
   ```
2. Erstat `DEFAULT_TEAM_VALUES.sponsor_income = 260000` i [teamProfileEngine.js:6](../../backend/lib/teamProfileEngine.js:6) med import af `SPONSOR_INCOME_BASE`.
3. Erstat 3 stragglers i `routes/api.js` + 1 i `boardGoals.js` (`?? 0` → `?? SPONSOR_INCOME_BASE`).
4. Erstat `?? 0.15` i [loanEngine.js:169-170](../../backend/lib/loanEngine.js:169) med fail-fast: `if (!config) throw new Error("Emergency loan_config row missing — DB seed-fejl")`.
5. Re-eksportér `DEFAULT_SPONSOR_INCOME` fra `economyEngine.js` som alias til `SPONSOR_INCOME_BASE` for bagudkompabilitet i ÉT release; deprecate i 07b.
6. **Beslutning bekræftet 2026-05-07:** Sponsor-base = **240K** (DB-default er kanonisk). teamProfileEngine.js:6's 260K skal ændres til 240K. v1.76-feature-status-doc om "260K"-ramp er en doc-drift der stammer fra economy-tune-iteration; den faktisk landed migration ([2026-04-30-economy-light-tune-v176.sql](../../database/2026-04-30-economy-light-tune-v176.sql)) ændrede ikke sponsor_income default. 07a inkluderer doc-drift-fix i FEATURE_STATUS.md.

**5. Verification path.**
- `grep -rn "?? 0" backend/lib backend/routes` filtreret til økonomi-felter — 0 matches efter fix.
- `grep -rn "260000\|240000" backend/lib backend/routes` — kun forekomster i `economyConstants.js` og `economyEngine.js:DEFAULT_SPONSOR_INCOME`.
- `node --test backend/lib/economyEngine.test.js` — alle 22 grønne.
- `node --test backend/lib/loanEngine.test.js` — alle 7 grønne efter ny test for "createEmergencyLoan kaster hvis loan_config mangler".
- Live spot-check: `SELECT id, sponsor_income FROM teams WHERE is_ai = false` — alle rows har enten 240K eller 260K (intet 0/null/100).

---

# 07b · TOCTOU-fixes + idempotency-keys ✅ Leveret 2026-05-07

**Status:** Leveret commit [a90128e](https://github.com/NicolaiDolmer/CyclingZone/commit/a90128e), parent-issue [#80](https://github.com/NicolaiDolmer/CyclingZone/issues/80) closed. Migration `database/2026-05-07-economy-idempotency.sql` anvendt på prod (4 unique-indices + `related_loan_id`-kolonne + `create_loan_atomic()` RPC verificeret 2026-05-09 via `pg_indexes`-query). 7 nye `economyInvariants.test.js`-cases grønne. Resterende beskrivelse nedenfor er bevaret som historisk reference.

**1. Mål.** Lukke 3 race-conditions (createLoan debt-ceiling, payDivisionBonuses double-pay, processLoanInterest double-charge) og tilføje DB-håndhævede idempotency-keys for sponsor/salary/bonus/loan-interest cron-payouts. Tilføje debt_ceiling-tjek til createEmergencyLoan.

**2. Runtime-evidens.**
- [backend/lib/loanEngine.js:125-127](../../backend/lib/loanEngine.js:125) — `currentDebt + totalOwed > ceiling` race
- [backend/lib/loanEngine.js:164-207](../../backend/lib/loanEngine.js:164) — `createEmergencyLoan` ingen ceiling-tjek
- [backend/lib/economyEngine.js:263-281](../../backend/lib/economyEngine.js:263) — `payDivisionBonuses` app-niveau idempotency
- [backend/lib/loanEngine.js:252-282](../../backend/lib/loanEngine.js:252) — `processLoanInterest` ingen per-(loan, season) key
- [backend/lib/economyEngine.js:processSeasonStart] — sponsor-payout uden DB-key
- v2.46 partial unique index på `auctions(rider_id) WHERE status IN ('active','extended')` — referencemodel for fix-mønster.

**3. Invariant beskyttet.**
- Sponsor/salary/bonus udbetales præcis én gang per `(team_id, season_id)`.
- Loan-interest tilskrives præcis én gang per `(loan_id, season_id)`.
- `currentDebt + nye_lån ≤ debt_ceiling` for *alle* lån-creation-paths inklusive emergency.

**4. Minimal change.** Light konkurs-mekanik (besluttet 2026-05-07 — kun forvarsel-lag, ingen auto-actions):
- **Lag 1 forvarsel ved 70% af loft:** Dashboard risk-tier `gul`, in-app-notif `board_warning` (ikke critical) "Sæson N: din gæld er Y% af loftet. Sælg en rytter eller reducér aktivitet."
- **Lag 2 hard-warning ved 90%:** in-app-notif `board_critical` + popup ved næste login "ADVARSEL: ved sæsonslut kan emergency-lån presse dig over loftet."
- **Ved faktisk breach:** status quo (emergency-lån oprettes uden hård grænse). 07b's createEmergencyLoan-tjek bevares som SOFT (logger advarsel, blokerer ikke). Hvis live-data viser at dette utilstrækkeligt → senere slice 07i for hard-enforcement (auto-salg eller account-freeze).

Migration `database/2026-05-07-economy-idempotency.sql`:
```sql
-- Sponsor payout: én per (team, season)
CREATE UNIQUE INDEX uniq_sponsor_per_team_season
  ON finance_transactions(team_id, season_id) WHERE type = 'sponsor';

-- Salary: én per (team, season)  
CREATE UNIQUE INDEX uniq_salary_per_team_season
  ON finance_transactions(team_id, season_id) WHERE type = 'salary';

-- Division-bonus: én per (team, season)
CREATE UNIQUE INDEX uniq_bonus_per_team_season
  ON finance_transactions(team_id, season_id) WHERE type = 'bonus';

-- Loan-interest: kræver ny related_loan_id-kolonne (eller bruge description-parse, mindre robust)
ALTER TABLE finance_transactions ADD COLUMN related_loan_id UUID REFERENCES loans(id);
CREATE UNIQUE INDEX uniq_loan_interest_per_loan_season
  ON finance_transactions(related_loan_id, season_id) WHERE type = 'loan_interest';
```

Backend-ændringer:
1. `createLoan` — wrap i Postgres-funktion `create_loan_atomic(team_id, type, principal)` der gør `SELECT … FOR UPDATE` på `loans WHERE team_id = $1` inden ceiling-tjek og INSERT i samme transaktion.
2. `createEmergencyLoan` — tilføj SOFT debt_ceiling-tjek (per beslutning ovenfor): hvis `currentDebt + totalOwed > config.debt_ceiling`, fortsæt MEN log advarsel + send `board_critical`-notif til manager + skriv `admin_log` "team breached debt_ceiling via emergency_loan". Ingen blokering. Live-data fra ~19 managers skal vise om hard-enforcement er nødvendig som follow-up.
3. `processLoanInterest` — fang `unique_violation` fra DB-constraint og log "interest already charged for season N" (cron retry sikkert).
4. `payDivisionBonuses` + sponsor + salary — fang `unique_violation` og skip per (team, season).

**5. Verification path.**
- Ny test `backend/lib/economyInvariants.test.js`:
  - "createLoan races: 2 parallelle calls kan ikke begge bestå ceiling" (mock 2x INSERT med samme team_id, expect 1 succeeds)
  - "createEmergencyLoan kaster hvis nær debt_ceiling"
  - "processSeasonStart er idempotent: 2 calls = 1 sponsor row"
  - "processLoanInterest er idempotent: 2 calls = 1 interest row per loan"
  - "payDivisionBonuses er idempotent"
- Live verification: kør cron 2x manuelt på beta-reset-data, verificér ingen dubletter.
- Migration-rollback-plan: alle indices kan dropes; backend-koden kan rulles tilbage til v2.49.

---

# 07c · Atomic balance updates (Postgres-RPC) ✅ Leveret v2.91 (2026-05-09)

**Status:** Migration `database/2026-05-09-balance-rpc.sql` anvendt på prod 2026-05-09. RPC `increment_balance_with_audit(team_id, delta, payload jsonb)` LIVE. Alle ~22 backend-callsites refaktoreret til at bruge RPC via `backend/lib/balanceRpc.js`-helperen. Ny `balanceAtomicity.test.js` med 8 tests (helper-kontrakt + race-property: 10 parallelle deltas → final balance = baseline + Σ deltas, idempotency_key dedup). 410/410 backend-tests grønne. Live race-test mod test-seller verificerede `audit_invariant_holds = true` for alle 10 finance-rows. **Faktisk callsite-tal: 22** (ikke 16 som master sagde) — 5 i loanEngine, 4 logiske via creditTeam/debitTeam i economyEngine, 3 i auctionFinalization, 6 i transferExecution, 1 i prizePayoutEngine, 3 i squadEnforcement, 5 i api.js. Master-spec'en er bevaret som historisk reference nedenfor.

**1. Mål.** Eliminere lost-update-races på `teams.balance` ved at samle alle balance-mutationer i én Postgres-funktion `increment_balance_with_audit(team_id, delta, finance_payload jsonb)` der atomic UPDATE'er + INSERT'er finance_transactions i én DB-transaktion.

**2. Runtime-evidens.**
- [backend/lib/loanEngine.js:5-9 dokumenterer `increment_balance(team_id, amount)`-funktion](../../backend/lib/loanEngine.js:5) — men *ingen callsites bruger den*. Alle bruger 2-trin SELECT→UPDATE.
- 16 write-paths kortlagt i [audit-rapport sektion C](../archive/ECONOMY_AUDIT_2026-05-07.md#c-atomic-balance-updates-p1).
- [backend/lib/loanEngine.js:25-31 `adjustBalance`](../../backend/lib/loanEngine.js:25) er central helper men 2-trin.

**3. Invariant beskyttet.** Concurrent mutations på samme team-balance kan ikke tabe hinanden. Balance-update + finance_transactions-insert kan ikke ende i partial-write-state (begge succeed eller begge rolled back).

**4. Minimal change.** Migration `database/2026-05-07-balance-rpc.sql`:
```sql
CREATE OR REPLACE FUNCTION increment_balance_with_audit(
  p_team_id UUID,
  p_delta BIGINT,
  p_finance_payload JSONB
) RETURNS BIGINT AS $$
DECLARE
  v_new_balance BIGINT;
BEGIN
  UPDATE teams 
    SET balance = balance + p_delta 
    WHERE id = p_team_id 
    RETURNING balance INTO v_new_balance;
  
  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'Team % not found', p_team_id;
  END IF;
  
  INSERT INTO finance_transactions(
    team_id, type, amount, description, season_id, race_id
    -- audit-kolonner tilføjes i 07d
  ) VALUES (
    p_team_id,
    p_finance_payload->>'type',
    (p_finance_payload->>'amount')::BIGINT,
    p_finance_payload->>'description',
    NULLIF(p_finance_payload->>'season_id', '')::UUID,
    NULLIF(p_finance_payload->>'race_id', '')::UUID
  );
  
  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;
```

Backend: refaktor 16 callsites til:
```js
const { data: newBalance, error } = await client.rpc('increment_balance_with_audit', {
  p_team_id: teamId,
  p_delta: amount,
  p_finance_payload: { type, amount, description, season_id, race_id },
});
if (error) throw error;
```

`adjustBalance` i loanEngine bliver tynd wrapper. Specifikke callsites (auctionFinalization, transferExecution, prizePayoutEngine, squadEnforcement, economyEngine, api.js loan-routes) bruger RPC direkte.

**5. Verification path.**
- Refaktor sker per-fil; per fil køres dens eksisterende test-suite først.
- Ny test `backend/lib/balanceAtomicity.test.js`: race-test der spawner 10 parallelle increment-RPC-calls og verificerer at sum af deltas == final balance ændring (ingen tabt update).
- Live spot-check efter deploy: `SELECT SUM(amount), team_id FROM finance_transactions GROUP BY team_id` vs. `SELECT id, balance FROM teams` skal stemme overens (efter justering for starting_budget). Hvis ikke, har vi en pre-eksisterende inkonsistens som dette slice ikke løser men eksponerer.

---

# 07d · Komplet finance audit-log + admin_log

**Status 2026-05-09:** Fase A leveret v2.90 (migration `database/2026-05-09-audit-log-foundation.sql`, enum-konstanter, 11 callsite-refaktor, 7 nye tests). Fase B udskudt til 07c er færdig (atomic balance RPC) — finance_transactions audit-kolonner er klar i schema men endnu ikke populeret af engines.

**Faktisk fund 2026-05-09 (modsiger master):** `admin_log`-tabellen eksisterede ALLEREDE på prod (oprettet ad-hoc 2026-04-29) med 18 rows og 4 distinct action_types. CREATE TABLE blev sprunget over; migration tilføjede i stedet 4 indices + CHECK constraint. Faktisk antal callsites: 11 (ikke 6 som master skrev), inkl. nyere features `loan_agreement_admin_cancel`, `market_pause`, `market_resume`, `auction_config_update`.

**1. Mål.** Bygge fundament for "perfekt admin historik": (1) faktisk opret `admin_log`-tabellen som 6 callsites allerede prøver at skrive til, og (2) udvid `finance_transactions` med audit-kolonner (actor, source_path, reason_code, before/after balance, related_entity, idempotency_key) så hver pengebevægelse er sporbar til hvem/hvad/hvorfor.

**2. Runtime-evidens.**
- 6 INSERT-callsites til `admin_log` der fejler stille: [api.js:2578, 2602, 2818, 2841, 2863](../../backend/routes/api.js:2578) + [auctionCancellation.js:105](../../backend/lib/auctionCancellation.js:105). Tabel findes ikke.
- `finance_transactions` schema [database/schema.sql:326-338] minimalistisk; mangler 7 audit-kolonner per [audit F8](../archive/ECONOMY_AUDIT_2026-05-07.md#f9--finance_transactions-mangler-audit-kolonner).
- `auctionCancellation.test.js:71-174` mock'er allerede `admin_log` — testen passerer på mock men live INSERT fejler.

**3. Invariant beskyttet.** Hver finance-write logges med actor + source + reason. Hver admin-handling logges som separat audit-row. Cron-retries kan ikke skabe dubletter (idempotency_key UNIQUE NULLABLE).

**4. Minimal change.** Migration `database/2026-05-07-audit-log-foundation.sql`:
```sql
-- admin_log
CREATE TABLE admin_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_user_id UUID REFERENCES users(id),
  action_type TEXT NOT NULL CHECK (action_type IN (
    'auction_cancelled','balance_adjusted','race_results_imported',
    'race_results_approved','beta_reset','prize_force_paid',
    'season_repaired','season_started','season_ended',
    'discord_webhook_added','discord_webhook_removed','manual_override'
  )),
  description TEXT,
  target_team_id UUID REFERENCES teams(id),
  target_rider_id UUID REFERENCES riders(id),
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_admin_log_user ON admin_log(admin_user_id, created_at DESC);
CREATE INDEX idx_admin_log_action ON admin_log(action_type, created_at DESC);

-- finance_transactions audit-kolonner
ALTER TABLE finance_transactions
  ADD COLUMN actor_type TEXT CHECK (actor_type IN ('cron','api','admin','system','migration')),
  ADD COLUMN actor_id UUID,                 -- user_id hvis admin/api, NULL ellers
  ADD COLUMN source_path TEXT,              -- fx 'loanEngine.createLoan'
  ADD COLUMN reason_code TEXT,              -- enum-string fx 'season_start_sponsor'
  ADD COLUMN before_balance BIGINT,
  ADD COLUMN after_balance BIGINT,
  ADD COLUMN related_entity_type TEXT CHECK (related_entity_type IN
    ('auction','loan','transfer','swap','race','season','manual')),
  ADD COLUMN related_entity_id UUID,
  ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX uniq_finance_idempotency_key
  ON finance_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_finance_actor ON finance_transactions(actor_type, actor_id, created_at DESC);
CREATE INDEX idx_finance_reason ON finance_transactions(reason_code, created_at DESC);
CREATE INDEX idx_finance_related ON finance_transactions(related_entity_type, related_entity_id);
```

Backend: udvid `increment_balance_with_audit`-RPC fra 07c til at acceptere de nye kolonner i `p_finance_payload`. Hver callsite skal nu også sende `actor_type`, `source_path`, `reason_code`, `related_entity_type/id`. Definer enum-konstanter i `backend/lib/economyConstants.js`:
```js
export const FINANCE_REASON = {
  SEASON_START_SPONSOR: 'season_start_sponsor',
  SEASON_END_SALARY: 'season_end_salary',
  AUCTION_WINNER_PAYMENT: 'auction_winner_payment',
  // ... ~30 reason codes der dækker alle write-paths
};
```

Refaktor `auctionCancellation.js` + 5 admin-routes til at skrive til admin_log uden best-effort try/catch (skal nu fejle højlydt). Best-effort bevares kun for notifications, IKKE for audit.

**5. Verification path.**
- Ny test `backend/lib/auditTrail.test.js`: hver økonomi-engine's primary path verificerer at finance_transactions row har korrekt actor_type + source_path + reason_code.
- Live: efter deploy, query `SELECT actor_type, source_path, COUNT(*) FROM finance_transactions GROUP BY 1,2` — 0 rows med NULL actor_type efter 24t (nye writes); legacy-rows kan have NULL.
- admin_log: efter en admin-handling (test: annullér en auktion), verificér at `admin_log` får 1 row med `action_type='auction_cancelled'`.

---

# 07e · Admin økonomi super-dashboard

**1. Mål.** Bygge admin-UI ovenpå 07d's audit-data: per-hold økonomi-overblik, søgbar/filtrerbar finance_transactions historie med drill-down per row, admin_log-feed, bulk-CSV-export, korrelerings-views (cron-runs, sæson-events).

**2. Runtime-evidens.**
- `AdminPage.jsx` har i dag ingen økonomi-tab. Backlog [PRODUCT_BACKLOG.md "S10 — Admin økonomi-panel"](../archive/PRODUCT_BACKLOG-2026-05-06.md) skitserer simpel version; dette slice bygger den fulde version.
- `frontend/src/pages/FinancePage.jsx` er manager-rettet, ikke admin.
- 07d leverer datakolonnerne; uden 07d kan dashboardet kun vise legacy-felter.

**3. Invariant beskyttet.** Admin har ÉT view hvor de kan svare: "Hvor blev pengene af? Hvem trigget hvad? Er der drift mellem balance og sum-af-transactions?". Manager-data forbliver uden for admin-UI'et.

**4. Minimal change.**
1. Ny tab `Økonomi` i `AdminPage.jsx` med 4 sub-views:
   - **Overblik:** per-hold tabel (balance, sponsor_income, budget_modifier, total_debt, debt_ceiling, sustainability-flag). Sortérbar.
   - **Transaktioner:** filtrerbar finance_transactions liste (type, hold, sæson, actor_type, reason_code, dato-range, beløbs-range). Klik-row → modal med fulde audit-detaljer (before/after balance, source_path, related_entity).
   - **Admin-handlinger:** admin_log-feed sortéret kronologisk. Filtrér på action_type, admin_user, target_team.
   - **Korrelering:** "vis alle transactions fra cron-run der startede 2026-05-07T00:00:00Z" (gruppér på actor + tidsvindue ±5s). "Vis pengeflow for sæson N" (transfers + auctions + sponsor + salary i én tidslinje per hold).
2. Backend-endpoints:
   - `GET /api/admin/economy-overview?division=&q=` — per-hold aggregeret
   - `GET /api/admin/finance-transactions?…filters` — paginated filter-query
   - `GET /api/admin/admin-log?…filters` — paginated admin-log
   - `GET /api/admin/economy-export?format=csv&filters` — bulk-export
3. Audit-protection: alle 4 endpoints kræver `requireAdmin`-middleware. Bulk-export logger en `admin_log` row selv (`action_type='economy_export'`).

**5. Verification path.**
- Manuel admin-flow: filter på `actor_type=cron` + `reason_code=season_start_sponsor` + sæson 7 → forventet 19 rows (1 per human team).
- Cross-check: sum af amounts på filtreret view = total_payout fra cron-log.
- Performance: query med ~100 transactions per team × ~30 teams × 7 sæsoner ≈ 21K rows skal returnere på <500ms (kræver indices fra 07d).
- E2E: opret manuel `admin_adjustment` via UI → verificér både `finance_transactions` og `admin_log` får rows.

---

# 07f · Sponsor variabel ift. resultater

**1. Mål.** Fra sæson 2+: skift sponsor fra flat 240K + board-modifier til base 200K + variabel 0–150K skaleret efter forrige sæsons points/division-rank. Implementér comeback-mekanik (lille hold der overpresterer får boost) og sportsligt-fokus-incentive. Sæson 1 er i open beta (live nu) er allerede flat 240K; den behandles uændret.

**2. Runtime-evidens.**
- [backend/lib/economyEngine.js processSeasonStart] kalder `applySponsorPayout(team, sponsor_income, budget_modifier)`.
- Aktuel state (2026-05-07): sæson 1 aktiv, 0 sæsoner afsluttet, ingen `season_standings`-data fra forrige sæson endnu.
- Når sæson 1 lukker: `season_standings.total_points` + `rank_in_division` populeres → 07f's input-data findes.
- Backlog [PRODUCT_BACKLOG.md "Sponsor-tied-to-results"](../archive/PRODUCT_BACKLOG-2026-05-06.md) — vision-doc.
- v1.76 economy tune-iteration dokumenteret i [archive/ECONOMY_BASELINE_SIMULATION_2026-04-29.md](../archive/ECONOMY_BASELINE_SIMULATION_2026-04-29.md) (NB: archive-doc refererer til pre-launch dev-state med "sæson 6 completed, sæson 7 active" — det var pre-beta-reset; ignorér sæson-numre når simulationen genbruges).

**3. Invariant beskyttet.** Sponsor stiger ikke ubegrænset (max 350K = 200K + 150K). Sponsor falder ikke under 200K (manager kan ikke ende uden sponsor selv ved bundsplacering). Comeback-mekanik aktiveres for hold der overperformer mod division-baseline.

**4. Minimal change.**
1. Ny pure-function `computeVariableSponsor({ lastSeasonPoints, lastSeasonRank, divisionPoints, divisionSize })` i `backend/lib/economyEngine.js`:
   - `base = 200000`
   - `variable_pool = 150000`
   - Performance-score = `(lastSeasonPoints / median(divisionPoints)) × (1 - rank_normalized)`
   - Variable = `min(variable_pool, max(0, performance_score × variable_pool))`
   - Total = `base + variable`
2. processSeasonStart kalder den nye funktion i stedet for at læse `team.sponsor_income` direkte.
3. `team.sponsor_income` bliver legacy-felt (bevares for board-modifier-formel-stabilitet); ny `team.computed_sponsor_for_season_N` kolonne der snapshottes per sæson-start.
4. UI på FinancePage: "Sæsonens sponsor: 285K (base 200K + 85K variabel for top-3 placering sidste sæson)". For sæson 1 vises "Sæsonens sponsor: 240K (introsæson — variabel formel starter sæson 2)".
5. **Aktiverings-strategi:** kode-deploy nu, formel kicker automatisk ind når sæson 2 starter. Ingen retroaktiv migration. Sæson 1's allerede udbetalte 240K-sponsor er pristine.

**Beslutning bekræftet 2026-05-07:** Aktivering fra sæson 2 (sæson 1 forbliver flat 240K under introsæson-flag). Ingen baseline-fix-up nødvendig — formlen aktiverer naturligt ved første sæson-2-start.

**5. Verification path.**
- Test-fixtures: 4 scenarier (top-1 D1, midt-D1, bund-D1, top-1-D3 promoveret) → forvent 4 forskellige sponsor-tal.
- Economy-baseline-simulation kør med ny sponsor-formel → sammenlign mod faktisk live-data efter sæson 8.
- Live: ny tab på FinancePage viser breakdown.

---

# 07g · Manager finance-forecast + risk-tier

**1. Mål.** Football-Manager-stil forecast: "næste sæson forventer du 285K sponsor + 60K præmie − 95K løn − 24K rente = +226K cashflow". Risk-tier widget: grøn/gul/rød badge på Dashboard og FinancePage med advarsler hvis prognose < 0, debt_ceiling kommer inden for 1 sæson, eller sustainability-score < 50%.

**2. Runtime-evidens.**
- FinancePage er i dag retrospektiv (transaktionshistorik); ingen forward-looking-data.
- 07d leverer audit-data der kan drive bedre forecast-input.
- Eksisterende `season-end preview` ([api.js season-end-preview](../../backend/routes/api.js)) bruger economy-engine til at simulere; mønster kan generaliseres.
- Onboarding v2 Slice 3 ([FEATURE_STATUS.md "Økonomi-explainer"]) leverer hint på FinancePage; risk-tier kan integreres i samme UI-region.

**3. Invariant beskyttet.** Forecast er en *prognose*, ikke en kontrakt — UI'et kommunikerer usikkerhed eksplicit ("forventet ±15%"). Ingen automatiseret handling baseret på forecast.

**4. Minimal change.**
1. Ny pure-function `computeFinanceForecast({ team, lastSeasonStandings, activeLoans, currentRoster })` returnerer:
   ```js
   {
     projected_sponsor: 285000,
     projected_prize: 60000,           // estimat fra rytter UCI-points × 1500 × race-coverage
     projected_salary: -95000,         // sum af riders.salary
     projected_loan_interest: -24000,  // active loans × interest_rate
     projected_loan_fees: -8000,       // loan_agreements der renews
     projected_net: 226000,
     confidence_low: 180000,           // -20% scenario
     confidence_high: 280000,          // +20% scenario
     risk_tier: 'green',               // 'green'|'yellow'|'red'
     warnings: [],
   }
   ```
2. Risk-tier-regler:
   - **Grøn:** projected_net ≥ 50K, debt < 50% af ceiling
   - **Gul:** projected_net ∈ [-50K, 50K], ELLER debt ∈ [50%, 80%] af ceiling
   - **Rød:** projected_net < -50K, ELLER debt > 80% af ceiling, ELLER cumulative-debt-trend pejler mod ceiling inden for 2 sæsoner
3. Endpoint: `GET /api/me/finance-forecast` (auth, team-scope).
4. UI:
   - Dashboard: lille widget under squad-warning ("📊 Næste sæson: +226K (grøn)")
   - FinancePage: dedikeret sektion med fuld breakdown + warnings-list
   - HelpPage: ny FAQ "Hvordan beregnes forecast?"

**5. Verification path.**
- Test-fixtures: 4 manager-arketyper (sund, marginal, gæld-stor, konkurs-tæt) → forventede risk-tiers.
- E2E: efter beta-reset, alle hold viser 'green' (frisk start). Efter ar-skabt-gæld → 'yellow'/'red'.
- Manager-feedback: efter 1 sæson live, indsamlet feedback på prognose-præcision (forecast vs. faktisk delta i sæson-end).

---

# 07h · Season financial close-out report

**1. Mål.** Når en sæson lukker, får hver manager en dedikeret finansrapport per sæson med: største indtægt/udgift, transfer-PnL, salary-trend, sponsor-modifier-kurve, præmie-tjent vs. tabt på løb, total cashflow. Genbruger SeasonEndPage/Sæson-snapshot-mønsteret fra v2.23.

**2. Runtime-evidens.**
- [frontend/src/pages/SeasonEndPage.jsx] — eksisterende sæson-snapshot. Mønster: `useParams.seasonId`, dropdown for skift, vinder-aggregering.
- 07d's audit-data muliggør per-reason_code-aggregering (vis "income by reason" som donut).
- v2.23-snapshot har allerede økonomi-relateret aggregering (præmie-leader, største transfer); dette slice udvider det per-manager.

**3. Invariant beskyttet.** Rapporten er læs-kun reproduktion af lukket sæson — ingen genberegning. Hvis sæsonen er repaired (admin force-payout, rollback) skal rapporten reflektere den seneste autoritative tilstand.

**4. Minimal change.**
1. Ny route `/seasons/:seasonId/finance/:teamId` i App.jsx (manager kan kun se sit eget hold; admin kan se alle).
2. Ny komponent `SeasonFinanceReport.jsx`:
   - Hero: sæsonens net cashflow + sammenligning mod forrige sæson
   - Donut: indtægt fordelt på reason_code (sponsor/præmie/transfer-in/lån-ind)
   - Donut: udgift fordelt på reason_code (salary/transfer-out/rente/fees/bøde)
   - Top 3 største transactions (in + out)
   - Sponsor-modifier-kurve over sæsonen (fra board_plan_snapshots)
   - Loan-portfolio: aktive lån med remaining + renteudgift sæson
3. Endpoint: `GET /api/teams/:teamId/finance-report?seasonId=` (auth, team-owner ELLER admin).
4. Sidebar-link på SeasonEndPage: "Se din finansrapport for denne sæson".

**5. Verification path.**
- E2E: efter sæson-end-cron har kørt, manager åbner rapport → alle tal stemmer overens med finance_transactions sum.
- Cross-check: rapport-net = (next_season_balance − last_season_balance + initial_diff)?
- Manager-spotcheck: 3 reelle managers reviewer rapport for sidste sæson; identificér misforståelser i layoutet.

---

# Cross-cutting bekymringer

## Performance
07d's nye indekser dækker forventet query-mønster. 07e's bulk-export kan ramme rate-limits på Supabase-pooler ved store eksports — implementér streaming hvis >10K rows.

## Migration-rollback
Hver migration har idempotent UP og dokumenteret DOWN. 07b og 07d's UNIQUE-indices skal validate'es mod eksisterende prod-data først (ingen dubletter må findes — hvis ja, ryd manuelt før migration kører).

## Test-baseline før start
- 07a: kør 295/295 backend grønne efter ændringer.
- 07b/07c: tilføj race-tests; eksisterende suite skal fortsat være grøn.
- 07d: nye audit-tests; legacy-rows i finance_transactions har NULL i nye kolonner — skal ikke fejle UI'et i 07e.

## Doc-drift sweep efter hver slice
Per [GUARDRAILS_CORE.md release hygiene](../GUARDRAILS_CORE.md#release-hygiene-obligatorisk-ved-enhver-brugerrettet-ændring): `PatchNotesPage.jsx`, `HelpPage.jsx`, `FEATURE_STATUS.md` opdateres + relevante GitHub-issues lukkes/kommenteres i samme commit. `economyConstants.js` referenceres i `ARCHITECTURE.md`.

## Soak-gates
- Efter 07a: ingen — patch-niveau, men spot-check at ingen team har sponsor_income=0 efter deploy.
- Efter 07b: 1 sæson-cyklus uden ny finance-bug = pass.
- Efter 07c: 24t med live trafik + watchdog-query (sum-of-transactions vs. balance) = pass.
- Efter 07d: 1 uge med admin-aktivitet skal give ≥10 admin_log rows; finance_transactions med NULL actor_type aftager til 0.

---

# Næste skridt

**Alle pre-kode-beslutninger låst (2026-05-07):**
1. Sponsor-default = 240K (DB-default kanonisk).
2. Konkurs-mekanik = light (lag 1 forvarsel ved 70%, lag 2 hard-warning ved 90%, ingen auto-actions). Ved breach: status quo + log + notif.
3. 07f-aktivering = automatisk fra sæson 2 (sæson 1 = introsæson uændret).

**Aktuel sæson-state (2026-05-09):** sæson 1 aktiv i open beta, 0 sæsoner afsluttet. Pre-launch dev-docs (archive/ECONOMY_BASELINE_SIMULATION_2026-04-29.md o.l.) der refererer til "sæson 6/7" er fra TEST-database FØR beta-reset; ignorér deres sæson-numre.

**Klar til kode:** næste er **07d** ([#82](https://github.com/NicolaiDolmer/CyclingZone/issues/82)) — audit-log foundation. Skala-uafhængig migration (kun nye tabeller + nullable-kolonner, ingen UPDATE/DELETE på eksisterende rows). 07a leveret v2.50; 07b leveret commit a90128e ([#80](https://github.com/NicolaiDolmer/CyclingZone/issues/80) closed 2026-05-07).

Audit + slice-briefings komplet 2026-05-07. Audit-rapport: [docs/archive/ECONOMY_AUDIT_2026-05-07.md](../archive/ECONOMY_AUDIT_2026-05-07.md).
