# Økonomi-redesign Fase 1 (anti-inflations-rygrad) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gør CyclingZone-økonomien strukturelt ikke-inflationær FØR `relaunchSeason1 --apply`: tilføj et løbende gold sink (upkeep), re-tune kilderne, clamp sponsor-loftet, og gør nødlåns-gældsbunden hård med eskalerende konsekvens — alt valideret af et nyt money-supply-scorecard.

**Architecture:** To uafhængigt testbare tracks. **Track A (balance):** scorecard → final-payout-clamp → løbende upkeep-debit → kilde-re-tune, kalibreret empirisk. **Track B (gældsbund #97):** hård clamp af nødlåns-udstedelse + eskalerende transfer-fryse→tvunget salg. Begge lander i `backend/lib/economyEngine.js`'s sæson-start-payroll og deler test-harness. Tal kalibreres af scorecardet (Task A6), ikke gættet.

**Tech Stack:** Node ≥24 ESM, `node:test` + `node:assert/strict` (ingen Jest/Vitest), Supabase (Postgres + RLS), hånd-rullede fake-supabase-objekter i tests, date-præfiks SQL-migrationer auto-applied på merge til main.

---

## Kalibrerings-disciplin (gælder Track A)

Alle balance-tal (upkeep-ladder, sponsor-base, prize-per-point) er **start-kandidater** der låses empirisk i Task A6 via `moneySupplyScorecard` (simulate-before-ship). Metode: kør scorecardet mod live-population + syntetisk S2-projektion, justér konstanter indtil gates holder:
- **D1 net = 0 (±5%)**, **D3 net ∈ [0, +30k]** i no-engangs-konfig (§2.2 i spec'en)
- **median balance ≤ 1,3× start ved sæson 5**
- **sinks ≥ 90% af tilbagevendende sources/sæson**

Start-kandidater: behold E2-sponsor (D1 600k/D2 400k/D3 260k); upkeep-ladder D1 250k / D2 110k / D3 30k pr. sæson; prize-per-point 1500 → justeres ned hvis præmie dominerer.

## File Structure

| Fil | Ansvar | Track |
|-----|--------|-------|
| `backend/lib/economyConstants.js` | Nye konstanter: `UPKEEP_BY_DIVISION`, `FINAL_SPONSOR_PAYOUT_CEILING`, `FINANCE_REASON.SEASON_START_UPKEEP` | A |
| `backend/lib/economyEngine.js` | Upkeep-debit-step + final-payout-clamp + escalation-hook i payroll | A+B |
| `backend/lib/economyEngine.test.js` | TDD for clamp, upkeep, escalation | A+B |
| `backend/scripts/moneySupplyScorecard.js` | NYT scorecard (report-pattern, live + syntetisk) | A |
| `backend/scripts/economyBaselineSimulation.js` | Fix stale "15.000"-strenge | A |
| `frontend/src/lib/expectedPrizeCalculator.js` | Prize-per-point co-SSOT (sync ved re-tune) | A |
| `backend/lib/loanEngine.js` | HARD nødlåns-clamp + effektivt division-loft | B |
| `backend/lib/loanEngine.test.js` / `economyInvariants.test.js` | TDD for hard clamp (rewrite SOFT-tests) | B |
| `backend/routes/api.js` | `assertTeamNotTransferFrozen`-guard på market-write-endpoints | B |
| `database/2026-06-17-e3-emergency-hard-floor.sql` | Align emergency-loft + `transfer_frozen`/`debt_breach_streak`-kolonner + `create_emergency_loan_atomic` RPC | B |
| `docs/GAME_INVARIANTS.md`, `PatchNotesPage.jsx`, `help.json` | Doc + brugerrettet changelog | C |

---

# TRACK A — Anti-inflations-balance

### Task A1: Nye konstanter + fix stale sim-kommentar

**Files:**
- Modify: `backend/lib/economyConstants.js` (efter SPONSOR_INCOME_BY_DIVISION ~:15; FINANCE_REASON ~:158-196)
- Modify: `backend/scripts/economyBaselineSimulation.js:14,197`

- [ ] **Step 1: Tilføj upkeep- + clamp-konstanter** (efter `SPONSOR_INCOME_BY_DIVISION`-blokken i `economyConstants.js`)

```javascript
// #1441 Fase 1 — løbende upkeep (gold sink). Division-tier-skaleret, IKKE live
// roster-værdi (undgår auto-eskalerende feedback-loop). START-KANDIDAT — låses af
// moneySupplyScorecard (D1 net=0±5%, D3 net∈[0,+30k] i no-engangs-konfig).
export const UPKEEP_BY_DIVISION = { 1: 250000, 2: 110000, 3: 30000 };

// #1441 Fase 1 — FINAL sponsor-payout-loft (post board_modifier × pullout).
// S2+ = D1 750k gross × 1.2 = 900k; S1/intro = D1 600k gross × 1.2 = 720k.
// Forward-guard mod board-modifier-bypass; ingen DB-default spejler dette.
export const FINAL_SPONSOR_PAYOUT_CEILING = Object.freeze({ S1: 720000, S2_PLUS: 900000 });
```

- [ ] **Step 2: Tilføj ny FINANCE_REASON-værdi** (i `FINANCE_REASON`-objektet, under `SEASON_START_SPONSOR`)

```javascript
  SEASON_START_UPKEEP: "season_start_upkeep",
```

Note: `reason_code` er fri TEXT (kun `actor_type`/`related_entity_type` er CHECK-constrained), så dette kræver INGEN migration.

- [ ] **Step 3: Fix de to stale "15.000"-strenge** i `economyBaselineSimulation.js` (`:14` description + `:197` markdown-note) — erstat `race_points × 15.000 CZ$` med `race_points × 1.500 CZ$` begge steder (SSOT er `PRIZE_PER_POINT = 1500`).

- [ ] **Step 4: Verificér konstant-import** — kør `node -e "import('./backend/lib/economyConstants.js').then(m=>console.log(m.UPKEEP_BY_DIVISION, m.FINAL_SPONSOR_PAYOUT_CEILING, m.FINANCE_REASON.SEASON_START_UPKEEP))"` fra repo-root.
Expected: `{ '1': 250000, '2': 110000, '3': 30000 } { S1: 720000, S2_PLUS: 900000 } season_start_upkeep`

- [ ] **Step 5: Commit**

```bash
git add backend/lib/economyConstants.js backend/scripts/economyBaselineSimulation.js
git commit -m "feat(economy): #1441 Fase-1 konstanter (upkeep, sponsor-loft, reason) + fix stale prize-kommentar"
```

---

### Task A2: FINAL sponsor-payout-clamp

**Files:**
- Modify: `backend/lib/economyEngine.js:230` (sponsorPayout-beregning i processSeasonStart)
- Test: `backend/lib/economyEngine.test.js`

- [ ] **Step 1: Skriv den fejlende test** (tilføj i `economyEngine.test.js`)

```javascript
test("processSeasonStart clamper sponsor-payout til S2+ loft 900k ved høj board-modifier", async () => {
  // D1 hold, S2+, gross 750k, board_modifier 1.5 → uclampet 1.125M, skal clampes til 900k
  const financeRows = [];
  const supabase = createSeasonStartSupabase({
    seasonNumber: 3,
    teams: [{ id: "t1", name: "Clamp FC", division: 1,
      board_profiles: [{ negotiation_status: "completed", budget_modifier: 1.5 }] }],
    financeRows,
  });
  const { processSeasonStart } = await import("./economyEngine.js");
  await processSeasonStart("s3", { supabase, runSeasonPayroll: async () => [],
    developRidersForSeason: async () => {}, updateRiderValues: async () => {} });
  const sponsor = financeRows.find((r) => r.type === "sponsor");
  assert.equal(sponsor.amount, 900000, "sponsor skal clampes til 900k, ikke 1.125M");
});
```

- [ ] **Step 2: Kør testen — verificér FAIL**

Run (fra `backend/`): `node --test --import ./test-setup.js lib/economyEngine.test.js`
Expected: FAIL — `sponsor.amount` er 1125000 (ingen clamp i dag).

- [ ] **Step 3: Implementér clampen** — i `economyEngine.js`, erstat linje 230:

```javascript
    const sponsorPayout = Math.round(sponsorBreakdown.gross_sponsor * modifier);
```

med:

```javascript
    const finalCeiling = (Number.isInteger(seasonNumber) && seasonNumber >= FIRST_VARIABLE_SPONSOR_SEASON)
      ? FINAL_SPONSOR_PAYOUT_CEILING.S2_PLUS
      : FINAL_SPONSOR_PAYOUT_CEILING.S1;
    const sponsorPayout = Math.min(finalCeiling, Math.round(sponsorBreakdown.gross_sponsor * modifier));
```

Tilføj `FINAL_SPONSOR_PAYOUT_CEILING` til import fra `./economyConstants.js` (toppen af filen). `FIRST_VARIABLE_SPONSOR_SEASON` er allerede importeret (~:52); `seasonNumber` er i scope (~:179).

- [ ] **Step 4: Kør testen — verificér PASS**

Run: `node --test --import ./test-setup.js lib/economyEngine.test.js`
Expected: PASS. (Hvis `createSeasonStartSupabase`-helper mangler i test-filen, byg den efter mønstret fra den eksisterende `createSeasonEndSupabase` — fake `.from()` chainable + `.rpc('increment_balance_with_audit')` der pusher `p_finance_payload` til `financeRows`.)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/economyEngine.js backend/lib/economyEngine.test.js
git commit -m "feat(economy): #1441 clamp sponsor FINAL payout (900k S2+/720k S1)"
```

---

### Task A3: Løbende upkeep-debit i sæson-start-payroll

**Files:**
- Modify: `backend/lib/economyEngine.js` (nyt step efter academy-drift ~:553, før `return {` ~:555; return-objekt :555-574; reducer :398-418)
- Test: `backend/lib/economyEngine.test.js`

- [ ] **Step 1: Skriv den fejlende test** (mirror academy-drift-testen)

```javascript
test("processTeamSeasonPayroll debiterer UPKEEP_BY_DIVISION[division] som upkeep", async () => {
  const financeRows = [];
  const supabase = createSeasonEndSupabase({ balance: 5_000_000, financeRows });
  const { processTeamSeasonPayroll } = await import("./economyEngine.js");
  const team = { id: "t1", name: "Upkeep FC", division: 2, riders: [] };
  await processTeamSeasonPayroll(team, "s5", { supabase,
    processLoanInterest: async () => ({ charged: [] }), createEmergencyLoan: async () => {} });
  const rows = financeRows.filter((r) => r.type === "upkeep");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, -110000); // D2 = 110k, debit er negativ
  assert.ok(rows[0].idempotency_key.includes("s5") && rows[0].idempotency_key.includes("t1"));
});
```

- [ ] **Step 2: Kør testen — verificér FAIL**

Run: `node --test --import ./test-setup.js lib/economyEngine.test.js`
Expected: FAIL — ingen `upkeep`-row.

- [ ] **Step 3: Implementér upkeep-step** — i `processTeamSeasonPayroll`, indsæt EFTER academy-drift-blokken (~:553), FØR `return {`:

```javascript
  // 5. Løbende upkeep (#1441) — division-tier-skaleret operating cost (gold sink).
  //    Flad pr. division (IKKE modifier-skaleret), idempotent pr. sæson+hold.
  const upkeepCharged = UPKEEP_BY_DIVISION[team.division] || 0;
  if (upkeepCharged > 0) {
    await debitTeam(
      team.id, upkeepCharged, "upkeep", null, seasonId, supabaseClient,
      {
        idempotent: true,
        metadata: { code: "tx.upkeep", params: { division: team.division } },
        audit: {
          sourcePath: "economyEngine.processSeasonStart.upkeep",
          reasonCode: FINANCE_REASON.SEASON_START_UPKEEP,
          idempotencyKey: `upkeep:${team.id}:${seasonId}`,
        },
      }
    );
    console.log(`  🏭 ${team.name}: -${upkeepCharged} pts upkeep (div ${team.division})`);
  }
```

Tilføj `UPKEEP_BY_DIVISION` til import fra `./economyConstants.js`.

- [ ] **Step 4: Tilføj upkeep til payroll-summary** (synlighed i admin-UI). I return-objektet (~:555-574) tilføj:

```javascript
    upkeep_total: upkeepCharged,
    upkeep_count: upkeepCharged > 0 ? 1 : 0,
```

og i reducer'en i `defaultRunSeasonPayroll` (~:398-418) tilføj matchende `acc.upkeep_total += (r.upkeep_total||0); acc.upkeep_count += (r.upkeep_count||0);` + defaults `upkeep_total: 0, upkeep_count: 0`.

- [ ] **Step 5: Kør testen — verificér PASS**

Run: `node --test --import ./test-setup.js lib/economyEngine.test.js`
Expected: PASS.

- [ ] **Step 6: Tilføj "skipper upkeep ved division uden rate"-test** (mirror academy "skips when 0"):

```javascript
test("processTeamSeasonPayroll skipper upkeep når division mangler i UPKEEP_BY_DIVISION", async () => {
  const financeRows = [];
  const supabase = createSeasonEndSupabase({ balance: 1_000_000, financeRows });
  const { processTeamSeasonPayroll } = await import("./economyEngine.js");
  await processTeamSeasonPayroll({ id: "t1", name: "No Div", division: 9, riders: [] }, "s5",
    { supabase, processLoanInterest: async () => ({ charged: [] }), createEmergencyLoan: async () => {} });
  assert.equal(financeRows.filter((r) => r.type === "upkeep").length, 0);
});
```
Run igen → begge PASS.

- [ ] **Step 7: Opdatér season-end-preview** — i `buildSeasonEndPreviewRows` (~:832-917) træk upkeep fra `balanceAfter` (~:895) så previewet matcher faktisk payroll. Tilføj `upkeep: UPKEEP_BY_DIVISION[team.division]||0` til preview-rækken.

- [ ] **Step 8: Commit**

```bash
git add backend/lib/economyEngine.js backend/lib/economyEngine.test.js
git commit -m "feat(economy): #1441 løbende upkeep-debit (gold sink) i sæson-start-payroll"
```

---

### Task A4: moneySupplyScorecard (report-pattern, live + syntetisk)

**Files:**
- Create: `backend/scripts/moneySupplyScorecard.js`
- Modify: `backend/package.json` (npm-script `economy:moneysupply`)

- [ ] **Step 1: Opret scorecardet** — modelleret på `valueDevelopSellScorecard.js` (report-pattern, ✅/❌/⚠️, ingen `exit(1)`) + den read-only live-read fra `economyBaselineSimulation.js` (createClient med `SUPABASE_READONLY_KEY` fra `.codex.local/supabase-readonly.env`, `fetchAll`-paginator). Genbrug drift-formlen fra `routes/api.js:6554-6558`.

```javascript
#!/usr/bin/env node
// #1441 money-supply-scorecard — beviser anti-inflation FØR ship.
// Læser live-population read-only + en syntetisk S2-projektion. Report-pattern
// (ingen exit(1)) — ejer reviewer FØR relaunch.  node scripts/moneySupplyScorecard.js [--markdown]
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { SPONSOR_INCOME_BY_DIVISION, UPKEEP_BY_DIVISION, SALARY_RATE, PRIZE_PER_POINT } from "../lib/economyConstants.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STARTING_BALANCE = 800000;
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));

async function fetchAll(supabase, table, select, build = (q) => q) {
  const pageSize = 1000; const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(supabase.from(table).select(select)).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  dotenv.config({ path: path.resolve(SCRIPT_DIR, "../../.codex.local/supabase-readonly.env"), quiet: true });
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_READONLY_KEY);

  // Match admin-economy-health-filteret EXAKT (service-role bypasser RLS → gentag diskriminatoren)
  const teams = (await fetchAll(supabase, "teams", "id, balance, division, is_ai, is_bank, is_test_account, is_frozen, user_id"))
    .filter((t) => t.user_id != null && !t.is_ai && !t.is_bank && !t.is_test_account && !t.is_frozen);
  const tx = await fetchAll(supabase, "finance_transactions", "team_id, amount",
    (q) => q.in("team_id", teams.map((t) => t.id)));

  // (6) Konserverings-invariant: per-team drift + aggregat human credits-vs-debits
  const sumByTeam = new Map();
  for (const r of tx) sumByTeam.set(r.team_id, (sumByTeam.get(r.team_id) || 0) + (r.amount || 0));
  let driftTeams = 0;
  for (const t of teams) if (Math.abs(t.balance - (STARTING_BALANCE + (sumByTeam.get(t.id) || 0))) > 0) driftTeams++;
  const aggregateSupply = teams.reduce((s, t) => s + t.balance, 0);

  // (1)+(2) median/total balance + per-division net (live snapshot)
  const byDiv = {};
  for (const t of teams) (byDiv[t.division] ||= []).push(t.balance);
  console.log(`=== #1441 money-supply-scorecard (live, ${teams.length} hold) ===\n`);
  console.log(`Total pengemængde: ${fmt(aggregateSupply)}  ·  drift-hold: ${driftTeams} ${driftTeams === 0 ? "✅" : "❌"}`);
  for (const d of [1, 2, 3]) {
    const arr = (byDiv[d] || []).sort((a, b) => a - b);
    const median = arr.length ? arr[Math.floor(arr.length / 2)] : 0;
    console.log(`  D${d}: n=${arr.length} median=${fmt(median)} (${(median / STARTING_BALANCE).toFixed(2)}× start)`);
  }

  // (2b) Syntetisk per-sæson-net pr. division (no-engangs-konfig) — GATE
  console.log("\n── Syntetisk net/sæson pr. division (no-engangs) ──");
  for (const d of [1, 2, 3]) {
    const sponsor = SPONSOR_INCOME_BY_DIVISION[d];
    const upkeep = UPKEEP_BY_DIVISION[d] || 0;
    // groft estimat: net ≈ sponsor − upkeep − typisk løn-byrde (kalibreres mod rigtige rosters)
    const net = sponsor - upkeep; // løn + præmie indsættes når roster-projektion bygges (Task A6)
    const pass = d === 1 ? Math.abs(net) <= sponsor * 0.05 : net >= 0 && net <= 30000;
    console.log(`  D${d}: sponsor ${fmt(sponsor)} − upkeep ${fmt(upkeep)} = net ${fmt(net)} ${pass ? "✅" : "❌ (juster konstanter)"}`);
  }
  console.log(`\nNote: præmie=${PRIZE_PER_POINT}/pt, løn-rate=${SALARY_RATE}. Ejer reviewer FØR relaunch.`);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
```

- [ ] **Step 2: Wire npm-script** — i `backend/package.json` scripts: `"economy:moneysupply": "node scripts/moneySupplyScorecard.js"`.

- [ ] **Step 3: Kør scorecardet (kræver `.codex.local/supabase-readonly.env`)**

Run (fra `backend/`): `npm run economy:moneysupply`
Expected: printer total pengemængde, drift-hold (skal være 0 ✅), per-division median + net-gates. Hvis read-only-env mangler: scriptet fejler tydeligt på "Missing SUPABASE_URL or SUPABASE_READONLY_KEY" — ejer leverer env.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/moneySupplyScorecard.js backend/package.json
git commit -m "feat(economy): #1441 moneySupplyScorecard (live + syntetisk net-gate)"
```

---

### Task A5: Tilføj net/sæson-gate til scorecardet med rigtig roster-projektion

**Files:**
- Modify: `backend/scripts/moneySupplyScorecard.js`

- [ ] **Step 1: Udvid synteten med rigtig løn + præmie pr. division** — erstat `const net = sponsor - upkeep;`-linjen med en projektion der trækker median-roster-løn (sum af `riders.salary` pr. hold, fra det live-read) + median-præmie pr. division. Hent `riders` via `fetchAll(supabase, "riders", "team_id, salary")`, byg `salaryByTeam`, og brug median løn-byrde pr. division: `net = sponsor + medianPrize[d] − medianSalary[d] − upkeep`.

- [ ] **Step 2: Kør → se faktiske net-tal pr. division**

Run: `npm run economy:moneysupply`
Expected: net-linjer afspejler nu rigtige rosters; gates ✅/❌ er meningsfulde.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/moneySupplyScorecard.js
git commit -m "feat(economy): #1441 moneySupply net-gate med rigtig roster-projektion"
```

---

### Task A6: Kalibrér konstanter mod scorecardet (simulate-before-ship)

**Files:**
- Modify: `backend/lib/economyConstants.js` (UPKEEP_BY_DIVISION, evt. SPONSOR_INCOME_BY_DIVISION, PRIZE_PER_POINT)
- Modify: `frontend/src/lib/expectedPrizeCalculator.js:12` (hvis PRIZE_PER_POINT ændres — co-SSOT)

- [ ] **Step 1: Iterér** — kør `npm run economy:moneysupply`, justér `UPKEEP_BY_DIVISION` (og om nødvendigt `SPONSOR_INCOME_BY_DIVISION` / `PRIZE_PER_POINT`) indtil alle gates er ✅: D1 net=0±5%, D3 net∈[0,+30k], median ≤1,3× start. Dokumentér de endelige tal + scorecardet-output i commit-beskeden.

- [ ] **Step 2: Synk frontend-prize-mirror** — HVIS `PRIZE_PER_POINT` ændres backend, opdatér `frontend/src/lib/expectedPrizeCalculator.js:12` til samme værdi (separate codebases, manuel sync, Ref #898).

- [ ] **Step 3: Verificér enheds-tests stadig grønne** (upkeep-test forventer nu de kalibrerede tal — opdatér testens forventede beløb til den nye `UPKEEP_BY_DIVISION`-værdi).

Run (fra `backend/`): `node --test --import ./test-setup.js lib/economyEngine.test.js`
Expected: PASS med kalibrerede tal.

- [ ] **Step 4: Commit**

```bash
git add backend/lib/economyConstants.js frontend/src/lib/expectedPrizeCalculator.js backend/lib/economyEngine.test.js
git commit -m "feat(economy): #1441 kalibrér upkeep/sponsor/prize til net-mål (scorecard-grøn)"
```

---

# TRACK B — Hård gældsbund (#97) + eskalerende konsekvens

### Task B1: Migration — align emergency-loft + nye teams-kolonner + atomisk emergency-RPC

**Files:**
- Create: `database/2026-06-17-e3-emergency-hard-floor.sql`

> ⚠️ Denne PR indeholder `database/*.sql` → **auto-applies i prod ved merge. EJEREN MERGER, aldrig auto-merge.**

- [ ] **Step 1: Skriv migrationen** (idempotent, header med #97-reference + rollback)

```sql
-- #1441/#97 Fase 1 — hård nødlåns-gældsbund + eskalerende transfer-fryse.
-- 1) Align emergency-loftet til division-loftet (var BEVIDST flad 1.5M, #97 reverserer det).
-- 2) Nye teams-kolonner: transfer_frozen (debt-fryse, smallere end is_frozen) + debt_breach_streak.
-- 3) create_emergency_loan_atomic: clamp-not-throw udstedelse under advisory-lock (TOCTOU-safe).
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE). Rollback: se bunden.
BEGIN;

UPDATE loan_config SET debt_ceiling = 1200000 WHERE division = 1 AND loan_type = 'emergency';
UPDATE loan_config SET debt_ceiling = 900000  WHERE division = 2 AND loan_type = 'emergency';
UPDATE loan_config SET debt_ceiling = 600000  WHERE division = 3 AND loan_type = 'emergency';

ALTER TABLE teams ADD COLUMN IF NOT EXISTS transfer_frozen BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS debt_breach_streak INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION create_emergency_loan_atomic(
  p_team_id UUID, p_amount_needed BIGINT, p_origination_fee_pct NUMERIC,
  p_interest_rate NUMERIC, p_debt_ceiling BIGINT
) RETURNS loans AS $$
DECLARE v_current_debt BIGINT; v_headroom BIGINT; v_principal BIGINT; v_fee BIGINT; v_loan loans;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));
  SELECT COALESCE(SUM(amount_remaining), 0) INTO v_current_debt FROM loans WHERE team_id = p_team_id AND status = 'active';
  -- maks principal hvor principal + fee(principal) holder gæld <= loft
  v_headroom := GREATEST(0, p_debt_ceiling - v_current_debt);
  v_principal := LEAST(p_amount_needed, FLOOR(v_headroom / (1 + p_origination_fee_pct)));
  IF v_principal <= 0 THEN RETURN NULL; END IF;
  v_fee := ROUND(v_principal * p_origination_fee_pct);
  INSERT INTO loans(team_id, loan_type, principal, origination_fee, interest_rate,
    seasons_total, seasons_remaining, amount_remaining, status)
  VALUES (p_team_id, 'emergency', v_principal, v_fee, p_interest_rate, 1, 1, v_principal + v_fee, 'active')
  RETURNING * INTO v_loan;
  RETURN v_loan;
END; $$ LANGUAGE plpgsql;

COMMIT;
-- Rollback: UPDATE loan_config SET debt_ceiling=1500000 WHERE loan_type='emergency';
--           ALTER TABLE teams DROP COLUMN transfer_frozen, DROP COLUMN debt_breach_streak;
--           DROP FUNCTION create_emergency_loan_atomic(UUID,BIGINT,NUMERIC,NUMERIC,BIGINT);
```

- [ ] **Step 2: Lokal syntaks-check** (hvis lokal psql findes) — ellers visuelt review mod `database/2026-06-17-e2-debt-ceiling-d1.sql`-mønstret. Bekræft idempotens (re-run = no-op).

- [ ] **Step 3: Opdatér dev-seed** — `backend/scripts/dev/seed-relaunch-rehearsal.sql:78-80`: ret emergency `debt_ceiling` til division-tallene (1200000/900000/600000) så dev matcher prod.

- [ ] **Step 4: Commit** (men IKKE merge — ejer merger pga. migration)

```bash
git add database/2026-06-17-e3-emergency-hard-floor.sql backend/scripts/dev/seed-relaunch-rehearsal.sql
git commit -m "feat(economy): #1441/#97 migration — emergency hard-floor + transfer_frozen/breach-streak + atomic RPC"
```

---

### Task B2: HARD nødlåns-clamp i createEmergencyLoan

**Files:**
- Modify: `backend/lib/loanEngine.js:323-425` (createEmergencyLoan)
- Test: `backend/lib/loanEngine.test.js` + rewrite `backend/lib/economyInvariants.test.js:353,388`

- [ ] **Step 1: Skriv den fejlende test** (clamp i stedet for SOFT-overskridelse)

```javascript
test("createEmergencyLoan clamper principal så gæld ikke overstiger division-loftet", async () => {
  // D3 loft 600k, eksisterende gæld 550k, behov 200k → kun ~50k/(1+fee) udstedes
  const state = { loans: [{ amount_remaining: 550000, status: "active" }], finance: [] };
  const supabase = createEmergencyLoanSupabase({ state, division: 3,
    config: { loan_type: "emergency", origination_fee_pct: 0.1, interest_rate_pct: 0.2, debt_ceiling: 600000 } });
  const { createEmergencyLoan } = await import("./loanEngine.js");
  const loan = await createEmergencyLoan("t1", 200000, supabase, "s5");
  const totalDebt = state.loans.reduce((s, l) => s + l.amount_remaining, 0);
  assert.ok(totalDebt <= 600000, `gæld ${totalDebt} må ikke overstige 600k`);
  assert.ok(loan === null || loan.principal < 200000, "principal skal være clampet under behovet");
});
```

- [ ] **Step 2: Kør → FAIL** (i dag udstedes fuldt beløb SOFT).

Run (fra `backend/`): `node --test --import ./test-setup.js lib/loanEngine.test.js`
Expected: FAIL — totalDebt > 600k.

- [ ] **Step 3: Implementér HARD clamp** — i `createEmergencyLoan`, erstat SOFT-blokken (~:340-353) + insert med: hent `effectiveCeiling` fra short/long-rækken (`configs.find(c => c.loan_type === 'short')?.debt_ceiling ?? config.debt_ceiling`), kald `create_emergency_loan_atomic` RPC (med JS-fallback via `computeMaxLoanPrincipal({currentDebt, debtCeiling: effectiveCeiling, originationFeePct: feeRate})` fra `loanEngine.js:197`), og returnér `null` hvis intet headroom. Behold `incrementBalanceWithAudit` på det FAKTISK udstedte beløb. Sæt `breachAmount = amountNeeded − issuedPrincipal` (residual = escalation-signal).

- [ ] **Step 4: Kør → PASS.** Run igen → PASS.

- [ ] **Step 5: Rewrite de gamle SOFT-tests** — `economyInvariants.test.js:353` ("logger advarsel ... SOFT") og `:388` forventer i dag fuldt lån over loft. Opdatér til at asserte clamp + residual-shortfall.

Run: `node --test --import ./test-setup.js lib/economyInvariants.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/lib/loanEngine.js backend/lib/loanEngine.test.js backend/lib/economyInvariants.test.js
git commit -m "feat(economy): #1441/#97 HARD nødlåns-clamp (gæld <= division-loft)"
```

---

### Task B3: Eskalerende transfer-fryse → tvunget salg + breach-streak

**Files:**
- Modify: `backend/lib/economyEngine.js` (i processTeamSeasonPayroll, efter emergency-lån ~:467)
- Test: `backend/lib/economyEngine.test.js`

- [ ] **Step 1: Skriv den fejlende test**

```javascript
test("processTeamSeasonPayroll fryser transfers ved 1. breach og tvinger salg ved 2.", async () => {
  const updates = [];
  const supabase = createSeasonEndSupabase({ balance: -100000, financeRows: [],
    onTeamUpdate: (patch) => updates.push(patch),
    totalDebt: 700000, debtCeiling: 600000, breachStreak: 1 }); // allerede 1 breach
  const { processTeamSeasonPayroll } = await import("./economyEngine.js");
  await processTeamSeasonPayroll({ id: "t1", name: "Debt FC", division: 3,
    riders: [{ id: "r1", salary: 0, market_value: 500000 }] }, "s5",
    { supabase, processLoanInterest: async () => ({ charged: [] }),
      createEmergencyLoan: async () => null });
  assert.ok(updates.some((u) => u.transfer_frozen === true), "skal sætte transfer_frozen");
  assert.ok(updates.some((u) => u.debt_breach_streak === 2), "streak skal blive 2 → tvunget salg");
});
```

- [ ] **Step 2: Kør → FAIL.**

Run: `node --test --import ./test-setup.js lib/economyEngine.test.js`
Expected: FAIL — ingen escalation-logik.

- [ ] **Step 3: Implementér escalation** — efter emergency-lån-blokken (~:467), tilføj: hent `getTotalDebt(team.id)` + division-loft; hvis gæld > loft, `newStreak = (team.debt_breach_streak||0)+1`, ellers `0`. `UPDATE teams SET transfer_frozen = (newStreak >= 1), debt_breach_streak = newStreak`. Hvis `newStreak >= 2`: kald en ny `forcedSaleOfHighestRider(team, seasonId, supabaseClient)` der sælger dyreste rytter (skriver `finance_transactions`-row med ny reason `FORCED_SALE` — bemærk: brug eksisterende squad-auto-sale-mønster `squadEnforcement.js:209-233`, IKKE en ny enum hvis `auto_squad_sale`-typen genbruges). Injicér `getTotalDebt` via deps for testbarhed.

- [ ] **Step 4: Kør → PASS.** Run igen → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/economyEngine.js backend/lib/economyEngine.test.js
git commit -m "feat(economy): #1441/#97 eskalerende transfer-fryse + tvunget salg (breach-streak)"
```

---

### Task B4: transfer-freeze-guard på market-write-endpoints

**Files:**
- Modify: `backend/routes/api.js` (ny helper + guards på bid :1555, proxy :1801, transfers :2065, offer :2194, swaps :2631, loans :2888/:5481)
- Test: `backend/routes/api.test.js` (eller nærmeste route-test; ellers unit på helper)

- [ ] **Step 1: Skriv den fejlende test** (unit på guard-helper)

```javascript
test("assertTeamNotTransferFrozen returnerer 403 når holdet er transfer-frozen", () => {
  const res = { code: null, body: null, status(c){this.code=c;return this;}, json(b){this.body=b;return this;} };
  const ok = assertTeamNotTransferFrozen({ team: { transfer_frozen: true } }, res);
  assert.equal(ok, false);
  assert.equal(res.code, 403);
  assert.equal(res.body.errorCode, "team_transfer_frozen");
});
```

- [ ] **Step 2: Kør → FAIL** (helper findes ikke).

- [ ] **Step 3: Implementér helper** (ved siden af `assertMarketOpen` ~:550)

```javascript
function assertTeamNotTransferFrozen(req, res) {
  if (req.team?.transfer_frozen) {
    res.status(403).json({ error: "Dit hold er fastfrosset pga. gæld over loftet. Reducér gæld før du handler.",
      errorCode: "team_transfer_frozen" });
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Tilføj guarden** i hver market-write-handler umiddelbart efter `assertMarketOpen`-linjen: `if (!assertTeamNotTransferFrozen(req, res)) return;` — bid (:1555), proxy (:1801), transfers POST (:2065), transfers/offer (:2194), swaps (:2631), loans (:2888, :5481). `req.team` bærer allerede flaget fra `requireAuth`.

- [ ] **Step 5: Kør → PASS.**

Run (fra `backend/`): `node --test --import ./test-setup.js routes/api.test.js` (eller den fil der dækker route-helpers)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/api.js backend/routes/api.test.js
git commit -m "feat(economy): #1441/#97 transfer-freeze-guard på market-write-endpoints"
```

---

# TRACK C — Docs, brugerrettet changelog & verifikation

### Task C1: GAME_INVARIANTS + patch notes + help/FAQ

**Files:**
- Modify: `docs/GAME_INVARIANTS.md`, `frontend/src/.../PatchNotesPage.jsx`, `frontend/.../help.json` (en+da), `docs/FEATURE_STATUS.md`

- [ ] **Step 1:** GAME_INVARIANTS.md — dokumentér: nyt upkeep-sink + tal, FINAL sponsor-clamp (900k S2+/720k S1, post-modifier), emergency-loft nu = division-loft (supersede den gamle "1,5M bevidst urørt"-note), eskalerende transfer-fryse.
- [ ] **Step 2:** PatchNotesPage.jsx — ny version-entry (brugerrettet: upkeep-omkostning, transfer-fryse ved gæld). EN først, DA under.
- [ ] **Step 3:** help.json (en+da) — ny FAQ om upkeep + hvad transfer-fryse betyder + nye i18n-keys `tx.upkeep`, `notif`-keys hvis tilføjet.
- [ ] **Step 4:** FEATURE_STATUS.md — opdatér økonomi-status.
- [ ] **Step 5: Commit**

```bash
git add docs/GAME_INVARIANTS.md frontend/ docs/FEATURE_STATUS.md
git commit -m "docs(economy): #1441 Fase-1 invariants + patch notes + help/FAQ (en+da)"
```

### Task C2: Fuld lokal verifikation + scorecard-bevis

- [ ] **Step 1:** Kør hele gaten: `pwsh -File scripts/verify-local.ps1` (backend-tests + frontend-tests + frontend-build). Expected: alt grønt.
- [ ] **Step 2:** Kør `npm run lint` + i18n-leak + tone-em-dash + warning-budget (fuld CI-gate-sæt).
- [ ] **Step 3:** Kør `npm run economy:moneysupply` → gem output som bevis; bekræft alle net-gates ✅ + drift-hold = 0.
- [ ] **Step 4:** Saml PR (Track A kan PR'es uden migration; Track B's migration-PR mergens AF EJEREN). PR-body med Brugerverifikation-sektion. Refs #1441.

---

## Self-review (udført)

- **Spec-dækning:** §2.6 filter (B3 arver via loadHumanSeasonEndTeams + scorecard-filter), §3.1 upkeep (A3, tier-baseret), §4.1 re-tune (A6 + frontend-mirror), §5.1 clamp (A2, final payout + S1/S2-split), §5.2 #97 (B1-B3, clamp-not-throw + align + escalation), §6 scorecard (A4-A5 + drift + aggregat), §7 migrationer (B1 enumererer: ceiling-align + 2 kolonner + RPC; reason_code/type kræver INGEN migration — verificeret).
- **Placeholder-scan:** balance-tal er START-KANDIDATER med eksplicit kalibrerings-metode (A6) — ikke uspecificerede placeholders.
- **Type-konsistens:** `debitTeam(teamId, amount, type, description, seasonId, client, {idempotent, metadata, audit})` brugt konsistent; `transfer_frozen`/`debt_breach_streak` matcher migration + payroll + endpoint-guard.
- **Kendt forenkling:** #45's fulde DB-niveau-belt lukkes af `create_emergency_loan_atomic` (sidste uguardede insert-path) + det allerede-shippede `create_loan_atomic`; en per-row CHECK kan ikke summere på tværs af rows, så cross-row-loftet håndhæves i RPC under advisory-lock (ikke CHECK).
