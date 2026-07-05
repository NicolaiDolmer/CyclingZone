# Faciliteter + Staff (Slice A, bølge A1: datamodel + backend-motor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend-fundamentet for facilitets-/staff-gold-sinket (spec: `docs/superpowers/specs/2026-07-05-economy-fase3-empire-design.md` §2): datamodel, køb/ansæt/fyr-motor, payroll-sinks og API — alt gated bag `FACILITIES_ENABLED=false` indtil bølge A2 (harness-kalibrering) er grøn.

**Architecture:** Rene funktioner i `facilityEngine.js` (priser/effekter, ingen I/O) + `staffCandidates.js` (deterministisk kandidat-generering) + `facilityService.js` (DB-mutationer via `debitTeam`-ledger-mønsteret) + to nye idempotente debit-steps i `processTeamSeasonPayroll`. Alle konstanter er START-KANDIDATER der kalibreres i bølge A2 — de eksporteres så harness kan sweepe dem.

**Tech Stack:** Node.js/Express, Supabase (Postgres, RLS), `node --test` med mock-supabase (mønster: `economyEngine.test.js`), migration i `database/*.sql` (ejer-merge-only).

**Mekaniske rammer (ikke-omsættelige):**
- PR indeholder `database/*.sql` → **ejer merger** (auto-applies i prod).
- Ingen patch note i A1 (intet player-facing før A3) — skriv "hvorfor ikke" i PR-body.
- `pwsh -File scripts/verify-local.ps1` + `npm run lint` før push.

---

### Task 1: Migration — `team_facilities` + `team_staff` + finance-typer + RLS

**Files:**
- Create: `database/2026-07-05-facilities-staff-foundation.sql`

- [ ] **Step 1: Skriv migrationen**

```sql
-- Slice A bølge A1 (#1441 Fase 3, spec 2026-07-05-economy-fase3-empire-design.md §2.6).
-- Faciliteter (5 spor × tier 0-5) + navngivet staff (1 pr. spor) + finance-typer.
-- Gated bag FACILITIES_ENABLED=false i backend — tabellerne er inerte indtil A2/A3.
-- Idempotent. Rollback: DROP TABLE team_staff, team_facilities; re-declare CHECK uden de 4 nye typer.

BEGIN;

CREATE TABLE IF NOT EXISTS team_facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  track TEXT NOT NULL CHECK (track IN ('training','scouting','medical','academy','commercial')),
  tier INTEGER NOT NULL DEFAULT 0 CHECK (tier BETWEEN 0 AND 5),
  purchased_season INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, track)
);
COMMENT ON TABLE team_facilities IS 'Facilitets-tier pr. spor pr. hold (Slice A gold-sink). tier 0 = ikke bygget.';
COMMENT ON COLUMN team_facilities.purchased_season IS 'season_number for seneste tier-køb (audit/UI).';

CREATE TABLE IF NOT EXISTS team_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('training','scouting','medical','academy','commercial')),
  name TEXT NOT NULL,
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 5),
  salary BIGINT NOT NULL CHECK (salary >= 0),
  hired_season INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','fired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE team_staff IS 'Navngivet staff (1 aktiv pr. rolle pr. hold). Sæsonløn = løbende sink. salary frosset ved ansættelse.';
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_staff_active_role
  ON team_staff(team_id, role) WHERE status = 'active';

-- Finance-typer (twin-guard mod #1463/#1465-fælden: type SKAL i CHECK'et i SAMME PR som koden).
ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_type_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (
  'sponsor','prize','salary','transfer_in','transfer_out','interest','bonus','starting_budget',
  'loan_received','loan_repayment','loan_interest','emergency_loan','admin_adjustment',
  'auto_squad_purchase','auto_squad_sale','squad_violation_fine',
  'academy_signing','academy_drift','upkeep','forced_debt_sale',
  'facility_purchase','facility_upkeep','staff_salary','staff_severance'
));

-- RLS: authenticated må SELECT'e egne rækker (mønster: database/player-events.sql).
ALTER TABLE team_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_facilities_owner_select ON team_facilities FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));
CREATE POLICY team_staff_owner_select ON team_staff FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));
GRANT SELECT ON team_facilities TO authenticated;
GRANT SELECT ON team_staff TO authenticated;
-- Skrivning: KUN service_role (backend). Ingen INSERT/UPDATE-policies til authenticated.

COMMIT;
```

- [ ] **Step 2: Verificér mod prod-klon (IKKE frisk DB)** — kør migrationen mod en Supabase-branch/klon; bekræft `SELECT * FROM team_facilities LIMIT 1` som authenticated fejler ikke og som anon giver 0 rækker.

- [ ] **Step 3: Commit**

```bash
git add database/2026-07-05-facilities-staff-foundation.sql
git commit -m "feat(economy): team_facilities/team_staff-datamodel + finance-typer (#1441 Fase 3 A1)"
```

---

### Task 2: `facilityConstants.js` — START-KANDIDAT-konstanter + flag

**Files:**
- Create: `backend/lib/facilityConstants.js`

- [ ] **Step 1: Skriv konstant-filen** (ingen test — ren data; formler testes i Task 3)

```js
// Slice A (#1441 Fase 3) — facilitets-/staff-konstanter.
// ALLE tal er START-KANDIDATER (spec §2.4 tid-som-valuta): kalibreres i bølge A2
// (facilityInvestmentScorecard) FØR FACILITIES_ENABLED sættes true. Eksporteres
// enkeltvis så economyCalibrationOverrides kan sweepe dem.

// Hård gate: køb/ansæt/payroll-debits er no-ops mens false. Tændes KUN efter
// A2-harness-grøn + ejer-go (samme mønster som academyFlag.isAcademyEnabled).
export const FACILITIES_ENABLED = false;

export const FACILITY_TRACKS = Object.freeze(["training", "scouting", "medical", "academy", "commercial"]);
export const MAX_FACILITY_TIER = 5;

// Engangs-pris pr. tier (kumulativ opgradering: man betaler ét trin ad gangen).
// Tid-som-valuta-anker (spec §2.4): prissat mod repræsentativ PRÆMIE-indkomst
// (ambitions-laget: D1 ~160k / D2 ~70k / D3 ~25k pr. sæson, jf. economyConstants
// A6-kalibreringsnoten) — IKKE mod fresh-net-overskuddet (som er ~break-even by design).
export const FACILITY_TIER_PRICE = Object.freeze({ 1: 25_000, 2: 60_000, 3: 140_000, 4: 300_000, 5: 600_000 });

// Løbende tier-upkeep pr. sæson (lille, løbende sink oveni engangs-prisen).
export const FACILITY_TIER_UPKEEP = Object.freeze({ 0: 0, 1: 2_000, 2: 5_000, 3: 10_000, 4: 20_000, 5: 35_000 });

// Staff-sæsonløn pr. kvalitets-tier (løbende sink).
export const STAFF_SALARY_BY_TIER = Object.freeze({ 1: 10_000, 2: 22_000, 3: 40_000, 4: 70_000, 5: 120_000 });

// Fyring: betal resterende sæsonløn × faktor (spec §2.2, sink + friktion).
export const STAFF_SEVERANCE_FACTOR = 0.5;

// Effekt-model (spec §2.2: facilitet = kapacitet, staff = udnyttelsesgrad).
// effectiveBonus = FACILITY_BASE_EFFECT[track][facilityTier] × staffUtilization(staffTier)
// staffUtilization: 0.5 uden staff; 0.6..1.0 ved staff-tier 1..5.
// Effekt-tallene er per-track multiplikator-bonusser (0 = ingen effekt).
// KUN 'training' og 'commercial' har live effekt-hooks i A1-scope; scouting/medical/academy
// får deres hooks i egne opfølgnings-slices (spec §2.1) — deres base-effekt er defineret
// her så priser/harness kan kalibreres samlet.
export const FACILITY_BASE_EFFECT = Object.freeze({
  training:   Object.freeze({ 0: 0, 1: 0.02, 2: 0.04, 3: 0.06, 4: 0.08, 5: 0.10 }),
  scouting:   Object.freeze({ 0: 0, 1: 0.20, 2: 0.40, 3: 0.60, 4: 0.80, 5: 1.00 }), // info-synlighedsgrad
  medical:    Object.freeze({ 0: 0, 1: 0.03, 2: 0.06, 3: 0.09, 4: 0.12, 5: 0.15 }), // form-genopretning
  academy:    Object.freeze({ 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }),                // ekstra akademi-slots
  commercial: Object.freeze({ 0: 0, 1: 0.01, 2: 0.02, 3: 0.03, 4: 0.04, 5: 0.05 }), // sponsor-multiplikator-bonus
});

// Anti-runaway-invariant (spec §2.1): kommerciel må ALDRIG tjene sig hjem på < ~4 sæsoner.
// Håndhæves som harness-gate i A2 (facilityInvestmentScorecard), dokumenteret her.
export const COMMERCIAL_MIN_PAYBACK_SEASONS = 4;
```

- [ ] **Step 2: Commit**

```bash
git add backend/lib/facilityConstants.js
git commit -m "feat(economy): facilitets-konstanter (start-kandidater, FACILITIES_ENABLED=false)"
```

---

### Task 3: `facilityEngine.js` — rene funktioner (TDD)

**Files:**
- Create: `backend/lib/facilityEngine.js`
- Test: `backend/lib/facilityEngine.test.js`

- [ ] **Step 1: Skriv de fejlende tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  getUpgradePrice, getFacilityUpkeepTotal, getStaffSalary,
  effectiveBonus, validateUpgrade, validateHire, severanceCost,
} from "./facilityEngine.js";

test("getUpgradePrice: næste tier-pris; null ved max", () => {
  assert.equal(getUpgradePrice(0), 25_000);
  assert.equal(getUpgradePrice(4), 600_000);
  assert.equal(getUpgradePrice(5), null);
});

test("getFacilityUpkeepTotal: summerer tier-upkeep over spor", () => {
  assert.equal(getFacilityUpkeepTotal([]), 0);
  assert.equal(getFacilityUpkeepTotal([{ track: "training", tier: 2 }, { track: "medical", tier: 1 }]), 5_000 + 2_000);
});

test("getStaffSalary + severanceCost", () => {
  assert.equal(getStaffSalary(3), 40_000);
  assert.equal(severanceCost({ salary: 40_000 }), 20_000); // 0.5 × sæsonløn
});

test("effectiveBonus: facilitet = kapacitet, staff = udnyttelse", () => {
  assert.equal(effectiveBonus("training", 0, null), 0);                 // intet bygget
  assert.equal(effectiveBonus("training", 5, null), 0.10 * 0.5);        // uden staff: 50%
  assert.equal(effectiveBonus("training", 5, 5), 0.10 * 1.0);           // fuld staff: 100%
  assert.equal(effectiveBonus("training", 3, 1), 0.06 * 0.6);
});

test("validateUpgrade: track, tier-loft, balance", () => {
  assert.equal(validateUpgrade({ track: "training", currentTier: 0, balance: 30_000 }), null);
  assert.equal(validateUpgrade({ track: "bogus", currentTier: 0, balance: 1e9 }), "invalid_track");
  assert.equal(validateUpgrade({ track: "training", currentTier: 5, balance: 1e9 }), "max_tier");
  assert.equal(validateUpgrade({ track: "training", currentTier: 0, balance: 10_000 }), "insufficient_funds");
});

test("validateHire: staff-tier gated af facilitets-tier (spec §2.2)", () => {
  assert.equal(validateHire({ role: "training", staffTier: 2, facilityTier: 3, balance: 1e9 }), null);
  assert.equal(validateHire({ role: "training", staffTier: 4, facilityTier: 3, balance: 1e9 }), "staff_tier_exceeds_facility");
  assert.equal(validateHire({ role: "training", staffTier: 1, facilityTier: 1, balance: 5_000 }), "insufficient_funds");
  assert.equal(validateHire({ role: "bogus", staffTier: 1, facilityTier: 1, balance: 1e9 }), "invalid_role");
});
```

- [ ] **Step 2: Kør — verificér FAIL** — `cd backend && node --test lib/facilityEngine.test.js` → FAIL (`Cannot find module './facilityEngine.js'`).

- [ ] **Step 3: Minimal implementering**

```js
// Rene facilitets-funktioner — ingen I/O. Konstanter i facilityConstants.js (A2-kalibreres).
import {
  FACILITY_TRACKS, MAX_FACILITY_TIER, FACILITY_TIER_PRICE, FACILITY_TIER_UPKEEP,
  STAFF_SALARY_BY_TIER, STAFF_SEVERANCE_FACTOR, FACILITY_BASE_EFFECT,
} from "./facilityConstants.js";

export function getUpgradePrice(currentTier) {
  const next = currentTier + 1;
  return next > MAX_FACILITY_TIER ? null : FACILITY_TIER_PRICE[next];
}

export function getFacilityUpkeepTotal(facilities) {
  return (facilities || []).reduce((sum, f) => sum + (FACILITY_TIER_UPKEEP[f.tier] || 0), 0);
}

export function getStaffSalary(tier) {
  return STAFF_SALARY_BY_TIER[tier];
}

export function severanceCost(staff) {
  return Math.round(staff.salary * STAFF_SEVERANCE_FACTOR);
}

// staffTier null = ingen ansat → 50% udnyttelse. Tier 1..5 → 0.6..1.0.
function staffUtilization(staffTier) {
  return staffTier == null ? 0.5 : 0.5 + 0.1 * staffTier;
}

export function effectiveBonus(track, facilityTier, staffTier) {
  const base = FACILITY_BASE_EFFECT[track]?.[facilityTier] ?? 0;
  return base * staffUtilization(staffTier);
}

export function validateUpgrade({ track, currentTier, balance }) {
  if (!FACILITY_TRACKS.includes(track)) return "invalid_track";
  const price = getUpgradePrice(currentTier);
  if (price == null) return "max_tier";
  if (balance < price) return "insufficient_funds";
  return null;
}

export function validateHire({ role, staffTier, facilityTier, balance }) {
  if (!FACILITY_TRACKS.includes(role)) return "invalid_role";
  if (staffTier > facilityTier) return "staff_tier_exceeds_facility";
  if (balance < STAFF_SALARY_BY_TIER[staffTier]) return "insufficient_funds";
  return null;
}
```

- [ ] **Step 4: Kør — verificér PASS** — `cd backend && node --test lib/facilityEngine.test.js` → alle PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/facilityEngine.js backend/lib/facilityEngine.test.js
git commit -m "feat(economy): facilityEngine — priser, effekt-model, validering (TDD)"
```

---

### Task 4: `staffCandidates.js` — deterministisk kandidat-generering (TDD)

**Files:**
- Create: `backend/lib/staffCandidates.js`
- Test: `backend/lib/staffCandidates.test.js`

Determinisme-kravet er samme anti-reroll-regel som sponsor-tilbuddene (#1663-designet §4.2): seed = `team_id + season + role`, så refresh ikke giver nye kandidater.

- [ ] **Step 1: Skriv de fejlende tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { generateStaffCandidates, STAFF_NAME_POOL } from "./staffCandidates.js";

const ARGS = { teamId: "11111111-1111-1111-1111-111111111111", seasonNumber: 3, role: "training", facilityTier: 3 };

test("genererer 3 kandidater, deterministisk på samme seed", () => {
  const a = generateStaffCandidates(ARGS);
  const b = generateStaffCandidates(ARGS);
  assert.equal(a.length, 3);
  assert.deepEqual(a, b); // ingen reroll ved refresh
});

test("kandidat-tiers overstiger aldrig facilitets-tier og salary matcher tier", () => {
  for (const c of generateStaffCandidates(ARGS)) {
    assert.ok(c.tier >= 1 && c.tier <= 3);
    assert.equal(typeof c.name, "string");
    assert.ok(STAFF_NAME_POOL.includes(c.name));
    assert.ok(c.salary > 0);
  }
});

test("forskellige seeds giver (som regel) forskellige kandidater", () => {
  const other = generateStaffCandidates({ ...ARGS, seasonNumber: 4 });
  assert.notDeepEqual(generateStaffCandidates(ARGS), other);
});
```

- [ ] **Step 2: Kør — verificér FAIL** — `cd backend && node --test lib/staffCandidates.test.js` → FAIL (modul findes ikke).

- [ ] **Step 3: Minimal implementering**

```js
// Deterministisk staff-kandidat-generering. Seed = teamId+season+role → stabil på refresh.
// Navne: fiktive, kuraterede (anti-AI-slop, ingen ægte personer) — samme disciplin som
// SPONSOR_NAME_POOL. Udvid gerne puljen, men kuratér manuelt.
import { getStaffSalary } from "./facilityEngine.js";

export const STAFF_NAME_POOL = Object.freeze([
  "Marc Vandenbroucke", "Sofie Lindqvist", "Aldo Terranova", "Pieter Claes", "Jonas Weinberger",
  "Camille Roussel", "Iker Zabaleta", "Tomasz Wielgosz", "Bram Van Dijck", "Elena Sarti",
  "Rune Kristoffersen", "Mathieu Perrin", "Karel Novotny", "Ane Iturriaga", "Stefan Gruber",
  "Lucie Blanchard", "Marco Bellandi", "Jens Ostergaard", "Patrick O'Meara", "Ingrid Solheim",
  "Diego Salazar", "Milan Kovac", "Astrid Nyberg", "Thibaut Lemaire", "Paolo Ferretti",
  "Wout Segers", "Katarzyna Mazur", "Henrik Dahlgren", "Aurelien Costa", "Nils Brandt",
  "Rosa Delgado", "Viktor Hlinka", "Maren Vollan", "Julien Charrier", "Enzo Marini",
  "Sanne De Witte", "Ondrej Blaha", "Freja Holmgren", "Bastien Moreau", "Luca Antonelli",
]);

// mulberry32 — lille deterministisk PRNG (ingen Math.random: reproducérbarhed er kontrakten).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function generateStaffCandidates({ teamId, seasonNumber, role, facilityTier }) {
  const rand = mulberry32(hashString(`${teamId}:${seasonNumber}:${role}`));
  const maxTier = Math.max(1, Math.min(5, facilityTier));
  const candidates = [];
  const usedNames = new Set();
  while (candidates.length < 3) {
    const name = STAFF_NAME_POOL[Math.floor(rand() * STAFF_NAME_POOL.length)];
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    const tier = 1 + Math.floor(rand() * maxTier);
    candidates.push({ name, role, tier, salary: getStaffSalary(tier) });
  }
  return candidates;
}
```

- [ ] **Step 4: Kør — verificér PASS** — `cd backend && node --test lib/staffCandidates.test.js` → alle PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/staffCandidates.js backend/lib/staffCandidates.test.js
git commit -m "feat(economy): deterministiske staff-kandidater (seedet, anti-reroll)"
```

---

### Task 5: `facilityService.js` — køb/ansæt/fyr med ledger-debits (TDD)

**Files:**
- Create: `backend/lib/facilityService.js`
- Test: `backend/lib/facilityService.test.js`

Genbrug mock-supabase-mønsteret fra `backend/lib/economyEngine.test.js` (in-memory tabeller + registreret `debitTeam`-spy). `debitTeam` importeres fra samme modul economyEngine bruger (find den eksisterende export — `backend/lib/financeLedger.js` eller tilsvarende; brug den SAMME import som `economyEngine.js`-toppen, kopiér ikke).

- [ ] **Step 1: Skriv de fejlende tests** (uddrag — dæk disse cases)

```js
import test from "node:test";
import assert from "node:assert/strict";
import { purchaseFacilityUpgrade, hireStaff, fireStaff } from "./facilityService.js";
// Byg makeMockSupabase() efter economyEngine.test.js-mønsteret: in-memory
// team_facilities/team_staff/teams + finance_transactions-log.

test("purchaseFacilityUpgrade: debiterer pris, opgraderer tier, skriver facility_purchase-row", async () => { /* ... */ });
test("purchaseFacilityUpgrade: afviser ved insufficient_funds/max_tier — INGEN debit", async () => { /* ... */ });
test("purchaseFacilityUpgrade: no-op med fejl 'facilities_disabled' når FACILITIES_ENABLED=false", async () => { /* ... */ });
test("hireStaff: afviser hvis aktiv staff findes på rollen (unik-constraint-spejl)", async () => { /* ... */ });
test("hireStaff: kandidaten SKAL matche en genereret kandidat (server-autoritativ — klient kan ikke opfinde tier/løn)", async () => { /* ... */ });
test("fireStaff: debiterer severance (0.5 × løn), sætter status='fired'", async () => { /* ... */ });
```

- [ ] **Step 2: Kør — verificér FAIL.**

- [ ] **Step 3: Implementér** — kerne-signaturer og regler:

```js
import { FACILITIES_ENABLED } from "./facilityConstants.js";
import { validateUpgrade, getUpgradePrice, validateHire, severanceCost } from "./facilityEngine.js";
import { generateStaffCandidates } from "./staffCandidates.js";

// Alle tre funktioner: (args, supabaseClient) → { ok, error?, ... }.
// Flag-gate FØRST: if (!FACILITIES_ENABLED) return { ok: false, error: "facilities_disabled" };
// Rækkefølge i purchase: læs team.balance + nuværende tier → validateUpgrade →
//   debitTeam(teamId, price, "facility_purchase", null, seasonId, supabaseClient, {
//     idempotent: true,
//     metadata: { code: "tx.facilityPurchase", params: { track, tier: nextTier } },
//     audit: { sourcePath: "facilityService.purchaseFacilityUpgrade",
//              idempotencyKey: `facility_purchase:${teamId}:${track}:${nextTier}` },
//   })
//   → upsert team_facilities (team_id, track) tier=nextTier, purchased_season.
// Idempotency-nøglen indeholder tier → dobbelt-klik på samme opgradering debiterer én gang.
// hireStaff: regenerér kandidaterne server-side (generateStaffCandidates) og match på
//   (name, tier) — klienten sender kun et kandidat-index/navn, ALDRIG løn.
//   validateHire (inkl. staff_tier_exceeds_facility) → insert team_staff → debit FØRSTE
//   sæsonløn sker IKKE her (den kører i payroll, Task 6) — ansættelse koster 0 upfront.
// fireStaff: severanceCost → debitTeam(..., "staff_severance", ...) → status='fired'.
export async function purchaseFacilityUpgrade({ teamId, track, seasonId, seasonNumber }, supabaseClient) { /* ... */ }
export async function hireStaff({ teamId, role, candidateName, seasonId, seasonNumber }, supabaseClient) { /* ... */ }
export async function fireStaff({ teamId, role, seasonId }, supabaseClient) { /* ... */ }
```

- [ ] **Step 4: Kør — verificér PASS** — `cd backend && node --test lib/facilityService.test.js`.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/facilityService.js backend/lib/facilityService.test.js
git commit -m "feat(economy): facilityService — køb/ansæt/fyr via ledger (flag-gated)"
```

---

### Task 6: Payroll-integration — facility-upkeep + staff-løn i `processTeamSeasonPayroll`

**Files:**
- Modify: `backend/lib/economyEngine.js` (efter upkeep-steppet, ~linje 745; følg akademi-drift-mønsteret linje 682-715)
- Test: `backend/lib/economyEngine.test.js` (tilføj cases)

- [ ] **Step 1: Skriv fejlende tests i `economyEngine.test.js`**: (a) hold med `team_facilities` (training tier 2 + medical tier 1) debiteres 7.000 som `facility_upkeep` (idempotency-key `facility_upkeep:{teamId}:{seasonId}`); (b) hold med aktiv staff (tier 3) debiteres 40.000 som `staff_salary` (key `staff_salary:{teamId}:{seasonId}`); (c) `FACILITIES_ENABLED=false` → begge steps springes over (test via konstant-mock eller eksportér step-funktionen med flag-parameter, samme teknik som eksisterende flag-tests i filen); (d) payroll-summary-objektet får felterne `facility_upkeep` og `staff_salary` (0 når intet).

- [ ] **Step 2: Kør — verificér FAIL.**

- [ ] **Step 3: Implementér** — nyt step 6+7 efter upkeep-steppet:

```js
// 6. Facilitets-upkeep (#1441 Fase 3 A1) — sum af tier-upkeep. Flag-gated, idempotent.
let facilityUpkeepCharged = 0;
let staffSalaryCharged = 0;
if (FACILITIES_ENABLED) {
  const { data: facilities, error: facError } = await supabaseClient
    .from("team_facilities").select("track, tier").eq("team_id", team.id);
  throwIfSupabaseError(facError, `Could not load facilities for ${team.name}`);
  facilityUpkeepCharged = getFacilityUpkeepTotal(facilities || []);
  if (facilityUpkeepCharged > 0) {
    await debitTeam(team.id, facilityUpkeepCharged, "facility_upkeep", null, seasonId, supabaseClient, {
      idempotent: true,
      metadata: { code: "tx.facilityUpkeep", params: { tracks: (facilities || []).length } },
      audit: {
        sourcePath: "economyEngine.processSeasonStart.facilityUpkeep",
        idempotencyKey: `facility_upkeep:${team.id}:${seasonId}`,
      },
    });
  }
  // 7. Staff-sæsonløn — sum af aktive staff-lønninger. Idempotent.
  const { data: staff, error: staffError } = await supabaseClient
    .from("team_staff").select("salary").eq("team_id", team.id).eq("status", "active");
  throwIfSupabaseError(staffError, `Could not load staff for ${team.name}`);
  staffSalaryCharged = (staff || []).reduce((s, r) => s + r.salary, 0);
  if (staffSalaryCharged > 0) {
    await debitTeam(team.id, staffSalaryCharged, "staff_salary", null, seasonId, supabaseClient, {
      idempotent: true,
      metadata: { code: "tx.staffSalary", params: { count: (staff || []).length } },
      audit: {
        sourcePath: "economyEngine.processSeasonStart.staffSalary",
        idempotencyKey: `staff_salary:${team.id}:${seasonId}`,
      },
    });
  }
}
```

Tilføj `facility_upkeep: facilityUpkeepCharged, staff_salary: staffSalaryCharged` til return-objektet (~linje 747). Import øverst: `FACILITIES_ENABLED` fra `./facilityConstants.js`, `getFacilityUpkeepTotal` fra `./facilityEngine.js`.

- [ ] **Step 4: Kør — verificér PASS** — `cd backend && node --test lib/economyEngine.test.js`.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/economyEngine.js backend/lib/economyEngine.test.js
git commit -m "feat(economy): facility-upkeep + staff-løn som payroll-sinks (flag-gated)"
```

---

### Task 7: API-routes

**Files:**
- Modify: `backend/routes/api.js` (følg eksisterende auth/ejer-match-mønster for team-scoped POST-routes — se fx sponsor-routes)
- Test: `backend/lib/facilityRoutes.test.js` (eller inline i eksisterende route-test-fil hvis mønsteret er dét)

- [ ] **Step 1: Skriv fejlende route-tests** for: `GET /api/club/facilities` (returnerer 5 spor m. tier + upgrade-pris + upkeep + aktiv staff + effektiv bonus pr. spor), `POST /api/club/facilities/upgrade` (body `{track}`), `GET /api/club/staff/candidates?role=training`, `POST /api/club/staff/hire` (body `{role, candidateName}`), `POST /api/club/staff/fire` (body `{role}`). Alle: 401 uden auth, 403 ved fremmed hold, `facilities_disabled` når flag off, delegér til facilityService (ingen forretningslogik i routen).

- [ ] **Step 2: Kør — verificér FAIL.**

- [ ] **Step 3: Implementér routes** — tynde wrappers: resolve team fra auth-user → kald service → map `{ok:false,error}` til 400/409. `{data,error}`-tjek på alle Supabase-kald (throw, ikke tavst `||[]` — memory: test_real_endpoint).

- [ ] **Step 4: Kør — verificér PASS** + kør queries mod ægte DB-klon (execute_sql) for at bekræfte kolonnenavne matcher migrationen (memory: test_real_endpoint_not_just_mocked).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/api.js backend/lib/facilityRoutes.test.js
git commit -m "feat(economy): club facilities/staff API (flag-gated)"
```

---

### Task 8: Docs + close-out

**Files:**
- Modify: `docs/GAME_INVARIANTS.md` (nye invarianter under Economy-konstanter)
- Modify: `docs/NOW.md` (aktiv slice)

- [ ] **Step 1: GAME_INVARIANTS.md** — tilføj: (1) tid-som-valuta-reglen (spec §2.4: alle fremtidige økonomi-priser prissættes i "sæsoner af repræsentativ indkomst" og kalibreres i harness); (2) facilitets-invarianter: `FACILITIES_ENABLED=false` indtil A2-harness + ejer-go; staff-tier ≤ facilitets-tier; kommerciel payback ≥ 4 sæsoner (harness-gate); alle facility/staff-pengebevægelser via ledger med idempotency-keys.
- [ ] **Step 2: Fuld verifikation** — `pwsh -File scripts/verify-local.ps1` (backend-tests + frontend-tests + build) + `npm run lint`. Forventet: alt grønt (ingen frontend-ændringer i A1, men kør alligevel — regression-guard).
- [ ] **Step 3: PR** — branch `feat/1441-facilities-staff-a1`, PR-body efter PULL_REQUEST_TEMPLATE (inkl. Brugerverifikation-sektion + "ingen patch note: intet player-facing i A1, UI kommer i A3"). **Indeholder migration → ejer merger, ALDRIG auto-merge.**
- [ ] **Step 4: Issue-kommentar** på #1441 med A1-status + link til spec/plan.

---

## Efter A1 (egne planer — IKKE i denne)

- **Bølge A2:** `facilityInvestmentScorecard.js` (anti-optimal-path-sweep ≥3 strategier ±10%, kommerciel-payback-gate, tid-som-valuta-kalibrering af alle START-KANDIDATER) + inflations-scorecard + `economyCalibrationOverrides`-udvidelse. Merge-gate for at sætte `FACILITIES_ENABLED=true` (+ejer-go).
- **Bølge A3:** "Klub"-UI (editorial design-linje, EN/DA, preview-seed-data til ejer-gennemklik) + patch note + help/FAQ.

## Self-review-noter

- Spec-dækning A1: datamodel §2.6 ✅ (Task 1), effekt-model §2.2 ✅ (Task 3), staff §2.2 ✅ (Task 4-5), sinks §2.1 ✅ (Task 5-6), flag-gating ✅, tid-som-valuta §2.4 → konstant-kommentarer + GAME_INVARIANTS (Task 8); anti-optimal-path §2.3 og kalibrering §2.4 er BEVIDST A2 (harness), ikke et A1-hul.
- Effekt-hooks (træningsbonus ind i trænings-motoren, kommerciel ind i sponsorEngine, scouting-info, medical, akademi-slots) aktiveres i A2/A3 sammen med flaget — A1 definerer og tester kun `effectiveBonus`-kontrakten. Det er med vilje: ingen gameplay-effekt før kalibrering.
- Task 5/7 har skelet-tests ("dæk disse cases") frem for fuld testkode — implementøren SKAL skrive alle listede cases ud; mock-mønsteret står i `economyEngine.test.js`.
