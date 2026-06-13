# Kontrakt-data-seed (#1309) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Føde kontrakt-data (frossen løn + længde + udløbssæson) ind i relaunch-populationen 20/6, ved at erstatte den GENERATED `salary`-kolonne med en frossen kolonne + to kontrakt-felter, så guldkontrakter/møllesten bliver et reelt økonomisk objekt fra dag 1.

**Architecture:** Kontrakt-felter bor på `riders`-rækken (intet join-table; "pr. rytter-hold-relation" = felter på rytteren med dens `team_id`). `salary` konverteres fra GENERATED → almindelig frossen INTEGER via `ALTER COLUMN ... DROP EXPRESSION` (bevarer nuværende værdier). Et seed-trin i relaunch-orchestratoren sætter kontrakt på alle ejede ryttere (founder-hold → 2 sæsoner; andre ejede → blandet 1-3). Free agents (team_id NULL) har INGEN kontrakt (`salary` NULL) — en `resolveRiderSalary`-fallback (10 % af market_value) viser estimeret løn i UI, og finalization auto-opretter en kontrakt når en kontraktløs rytter erhverves, så ejede ryttere ALTID har en løn.

**Tech Stack:** Node.js/Express (backend), Supabase/Postgres (DB, generated→plain via DROP EXPRESSION, PG 15), React+Vite (frontend), `node --test` (backend+frontend unit tests), i18n via namespace-JSON (en+da).

---

## Locked decisions (ejer, 13/6)

1. **Seed-scope = generisk regel:** enhver rytter med `team_id` får kontrakt. Founder-hold (= `getBetaManagerTeams`) → 2 sæsoner. Alle andre ejede → blandet længde 1-3 (~1/3 fordeling, seeded). **Free agents (team_id NULL) får INGEN kontrakt** — en kontrakt kræver et hold. Ved launch ejer kun de ~18 founder-hold ryttere → reelt får kun de ~144 founder-ryttere kontrakter (alle 2 sæsoner). Den blandede gren fanger automatisk AI-ejede ryttere hvis #1103/#1105 senere giver AI-hold ryttere (ikke #1309-scope).
2. **Kolonne-strategi = konvertér på stedet:** behold navnet `salary`, lav den om fra GENERATED → frossen plain INTEGER. Tilføj `contract_length` + `contract_end_season`. ~40 eksisterende læse-steder af `salary` virker uændret (læser nu den frosne værdi). Free agents = NULL → UI estimerer.

### Afledt design (følger af 1+2, ikke nye beslutninger)
- **`resolveRiderSalary(rider)`** (backend `marketUtils.js` + frontend `marketValues.js`): `salary != null ? salary : round(10% af market_value)`. Bruges til VISNING af free agents (estimeret løn). Mirrorer det eksisterende `RIDER_BASE_VALUE_FALLBACK`-mønster.
- **Kontrakt-on-acquire:** auktions-/transfer-/swap-/loan-buyout-finalization auto-opretter en standard-kontrakt (frossen løn ved erhvervelse + længde 2) HVIS den erhvervede rytter ingen kontrakt har (`salary` NULL). Hvis rytteren ALLEREDE har kontrakt → arves uændret (regenererer ALDRIG). Dette gør "ejede ryttere har altid en løn"-invarianten sand, så økonomi/board kan læse `rider.salary` direkte (ingen arithmetic-churn). Det fulde "manager vælger længde"-signerings-UI er markeds-pakke (fast-follow).
- **`contract_end_season`-semantik:** sidste sæson kontrakten er aktiv = `start_season + length - 1`. Forlængelses-vindue i denne sæson; udløb ved skiftet UD af den. Relaunch (sæson 1, founder length 2) → `contract_end_season = 2`.

### Noterede afhængigheder (ikke blokerende for #1309)
- Spec'ens "blandet restløbetid i populationen / free-agent-flow fra sæson 1-slut" materialiseres fuldt ud først når (a) managers signer free agents med valgte længder, og (b) #1103/#1105 evt. lader AI-hold eje ryttere. Den generiske seed-regel er forward-kompatibel.
- `#1103`-backfill-checklisten (GitHub-issue) skal have kontrakt-seed-trinnet tilføjet (Task 8).

---

## File Structure

**Created:**
- `database/2026-06-13-contract-data-fields.sql` — migration: DROP EXPRESSION på `salary` + ADD `contract_length`, `contract_end_season`.
- `backend/lib/contractSeed.js` — pure helpers (`computeFrozenSalary`, `pickContractLength`, `computeContractEndSeason`, `CONTRACT`) + DB-wrapper `runContractSeed`.
- `backend/lib/contractSeed.test.js` — unit tests for helpers + wrapper.
- `backend/scripts/economyContractSimulation.js` — økonomi-sim: frossen lønmasse vs. sponsor/balance + guldkontrakt-metrik; emitterer scorecard.
- `docs/metrics/contract-economy-scorecard-2026-06-13.md` — committet scorecard (acceptance-krav).

**Modified:**
- `database/schema.sql` — `riders.salary` → plain + nye kontrakt-felter (afspejl migration).
- `backend/lib/marketUtils.js` — tilføj `resolveRiderSalary(rider)`.
- `backend/lib/relaunchOrchestrator.js` — wire `runContractSeed` ind (step 6.5) + DEFAULT_DEPS + import.
- `backend/lib/relaunchOrchestrator.test.js` — opdatér DI-rækkefølge med `contracts`.
- `backend/lib/auctionFinalization.js` — kontrakt-on-acquire (create-if-missing).
- `backend/lib/auctionFinalization.test.js` — regression: arvet kontrakt uændret + kontraktløs får kontrakt.
- `backend/lib/transferExecution.js` — kontrakt-on-acquire i transfer + swap.
- `backend/lib/transferExecution.test.js` — regression.
- `frontend/src/lib/marketValues.js` — tilføj `getRiderSalary(rider)` (display-fallback).
- `frontend/src/pages/RiderStatsPage.jsx` — vis kontrakt (løn + længde/udløb) i header.
- `frontend/src/pages/AuctionsPage.jsx` — vis kontrakt-restløbetid ved siden af løn; brug `getRiderSalary` til free-agent-estimat.
- `frontend/src/pages/TransfersPage.jsx` — vis kontrakt på tilbuds-kort.
- `frontend/public/locales/en/rider.json` + `da/rider.json` — `contract.*` keys.
- `frontend/public/locales/en/auctions.json` + `da/auctions.json` — kontrakt-keys.
- `frontend/public/locales/en/transfers.json` + `da/transfers.json` — kontrakt-keys.
- `frontend/public/locales/en/help.json` + `da/help.json` — ny `contracts`-sektion.
- `frontend/src/pages/PatchNotesPage.jsx` — ny version-entry.
- `docs/FEATURE_STATUS.md` — kontrakt-data-status.
- `docs/GAME_INVARIANTS.md` — frossen-løn-invariant + kontrakt-felter.

---

## Task 1: DB-migration — konvertér `salary` + tilføj kontrakt-felter

**Files:**
- Create: `database/2026-06-13-contract-data-fields.sql`
- Modify: `database/schema.sql:62-68` (riders salary-blok)

> ⚠️ **`database/*.sql` → EJEREN merger PR'en** (migration auto-applies i prod ved merge). Ingen auto-merge.

- [ ] **Step 1: Skriv migrationen**

Create `database/2026-06-13-contract-data-fields.sql`:

```sql
-- #1309 kontrakt-data-seed: erstat den GENERATED salary-kolonne med en frossen
-- (plain) kolonne + tilføj contract_length + contract_end_season.
--
-- Beslutninger (ejer, 13/6):
--  • Konvertér salary PÅ STEDET (behold navnet → ~40 læse-steder uændret).
--  • Kontrakter kun på EJEDE ryttere; free agents = NULL (UI estimerer 10% af value).
--
-- DROP EXPRESSION (PG 13+; Supabase = PG 15) fjerner generation-udtrykket OG
-- bevarer de nuværende beregnede værdier som lagrede data. (Cutover 2026-06-10
-- brugte DROP+ADD fordi den ÆNDREDE formlen; vi vil BEHOLDE værdierne, så
-- DROP EXPRESSION er det rette værktøj.) market_value forbliver GENERATED.
--
-- Rollback: ALTER TABLE riders DROP COLUMN contract_length, DROP COLUMN
-- contract_end_season; og re-generér salary:
--   ALTER TABLE riders DROP COLUMN salary;
--   ALTER TABLE riders ADD COLUMN salary INTEGER GENERATED ALWAYS AS (
--     GREATEST(1, ROUND((COALESCE(base_value,1000)+prize_earnings_bonus)*0.10))::INTEGER
--   ) STORED;

BEGIN;

ALTER TABLE riders ALTER COLUMN salary DROP EXPRESSION;

COMMENT ON COLUMN riders.salary IS
  'Frossen kontrakt-løn (#1309, 13/6). Var GENERATED (10% af market_value); nu '
  'sat ved kontrakt-signering og fast til udløb. Kun ejede ryttere har en værdi; '
  'free agents = NULL (UI estimerer via resolveRiderSalary). Seedes i relaunch-'
  'orchestratoren (runContractSeed) og auto-oprettes ved erhvervelse hvis NULL.';

ALTER TABLE riders ADD COLUMN contract_length INTEGER
  CHECK (contract_length IS NULL OR contract_length BETWEEN 1 AND 3);
COMMENT ON COLUMN riders.contract_length IS
  'Kontraktlængde i sæsoner (1-3). NULL = free agent (ingen kontrakt). #1309.';

ALTER TABLE riders ADD COLUMN contract_end_season INTEGER;
COMMENT ON COLUMN riders.contract_end_season IS
  'Sidste sæson-number kontrakten er aktiv (= start_season + length - 1). '
  'Forlængelses-vindue i denne sæson; udløb ved skiftet ud af den. NULL = free agent. #1309.';

COMMIT;
```

- [ ] **Step 2: Afspejl i schema.sql**

I `database/schema.sql`, erstat salary-blokken (linje 63-68) med:

```sql
  -- salary: FROSSEN kontrakt-løn (#1309). Var GENERATED (10% af market_value);
  -- nu sat ved signering og fast til udløb. Skrives af runContractSeed +
  -- finalization (create-if-missing). NULL = free agent (UI estimerer).
  salary INTEGER,
  -- Kontrakt (#1309): længde 1-3 sæsoner + sidste aktive sæson-number.
  -- NULL for free agents (kontrakt kræver et hold).
  contract_length INTEGER CHECK (contract_length IS NULL OR contract_length BETWEEN 1 AND 3),
  contract_end_season INTEGER,
```

- [ ] **Step 3: Verificér migration mod en disposabel Supabase-branch (ikke prod)**

Opret en branch og kør migrationen via Supabase MCP `apply_migration` (eller CLI mod en dev-branch). Kør derefter denne verifikation via `execute_sql`:

```sql
-- 1) salary er IKKE længere generated:
SELECT column_name, is_generated, generation_expression
FROM information_schema.columns
WHERE table_name='riders' AND column_name IN ('salary','contract_length','contract_end_season')
ORDER BY column_name;
-- Forventet: salary.is_generated = 'NEVER'; de to nye kolonner findes.

-- 2) DROP EXPRESSION bevarede værdier (ingen owned rider mistede sin løn):
SELECT count(*) AS owned_with_null_salary
FROM riders WHERE team_id IS NOT NULL AND salary IS NULL;
-- Forventet: 0 (alle pre-eksisterende ejede ryttere beholdt deres løn).
```

Expected: salary `is_generated='NEVER'`, begge nye kolonner til stede, `owned_with_null_salary = 0`.

- [ ] **Step 4: Ryd branchen op + commit**

```bash
git add database/2026-06-13-contract-data-fields.sql database/schema.sql
git commit -F .git/COMMIT_EDITMSG_1309_1
```

Commit-besked (skriv til fil først, commit med `-F`):
```
feat(db): kontrakt-felter på riders + frossen salary (#1309)

Konvertér salary GENERATED→frossen plain (DROP EXPRESSION, bevarer værdier).
Tilføj contract_length + contract_end_season. Migration auto-applies i prod
ved merge — EJEREN merger.

Refs #1309
```

---

## Task 2: Kontrakt-domæne-helpers (pure) + tests

**Files:**
- Create: `backend/lib/contractSeed.js`
- Test: `backend/lib/contractSeed.test.js`

- [ ] **Step 1: Skriv de fejlende tests**

Create `backend/lib/contractSeed.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTRACT,
  computeFrozenSalary,
  pickContractLength,
  computeContractEndSeason,
} from "./contractSeed.js";
import { makeRng } from "./fictionalRiderGenerator.js";

test("computeFrozenSalary spejler den gamle generated formel", () => {
  // GREATEST(1, ROUND((COALESCE(base_value,1000)+prize)*0.10))
  assert.equal(computeFrozenSalary({ base_value: 1_000_000, prize_earnings_bonus: 0 }), 100_000);
  assert.equal(computeFrozenSalary({ base_value: 50_000, prize_earnings_bonus: 5_000 }), 5_500);
  // NULL/0 base_value → fallback 1000 → salary 100
  assert.equal(computeFrozenSalary({ base_value: null, prize_earnings_bonus: 0 }), 100);
  // bundgrænse 1
  assert.equal(computeFrozenSalary({ base_value: 1, prize_earnings_bonus: 0 }), 1);
});

test("pickContractLength giver 1-3, ~1/3 fordeling, deterministisk pr. seed", () => {
  const rng = makeRng(2026);
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 3000; i++) counts[pickContractLength(rng)]++;
  for (const len of [1, 2, 3]) {
    assert.ok(counts[len] >= 850 && counts[len] <= 1150, `len ${len}: ${counts[len]} udenfor ~1/3`);
  }
  // determinisme: samme seed → samme første træk
  assert.equal(pickContractLength(makeRng(7)), pickContractLength(makeRng(7)));
});

test("computeContractEndSeason = start + length - 1", () => {
  assert.equal(computeContractEndSeason(1, 2), 2); // relaunch founder: aktiv sæson 1+2
  assert.equal(computeContractEndSeason(1, 1), 1);
  assert.equal(computeContractEndSeason(3, 3), 5);
});

test("CONTRACT-konstanter", () => {
  assert.equal(CONTRACT.FOUNDER_LENGTH, 2);
  assert.equal(CONTRACT.DEFAULT_ACQUIRE_LENGTH, 2);
  assert.equal(CONTRACT.SALARY_RATE, 0.10);
});
```

- [ ] **Step 2: Kør testen og bekræft den fejler**

Run: `node --test backend/lib/contractSeed.test.js`
Expected: FAIL — "Cannot find module './contractSeed.js'".

- [ ] **Step 3: Implementér de pure helpers**

Create `backend/lib/contractSeed.js` (kun den øverste del — DB-wrapper kommer i Task 3):

```js
// Kontrakt-seed (#1309) — frossen løn + længde + udløbssæson på ejede ryttere.
// Pure helpers er deterministiske/seeded → dry-run == apply. DB-wrapper
// (runContractSeed, Task 3) læser ejede ryttere + founder-hold og skriver felterne.
//
// Beslutninger (ejer 13/6): kontrakter kun på ejede ryttere (free agents = NULL);
// founders 2 sæsoner; andre ejede blandet 1-3.

export const CONTRACT = Object.freeze({
  FOUNDER_LENGTH: 2,          // founder-hold: stabil trup i 2 sæsoner
  DEFAULT_ACQUIRE_LENGTH: 2,  // auto-kontrakt ved erhvervelse (create-if-missing)
  MIN_LENGTH: 1,
  MAX_LENGTH: 3,
  SALARY_RATE: 0.10,          // = den gamle generated-formel
  BASE_VALUE_FALLBACK: 1000,  // spejler RIDER_BASE_VALUE_FALLBACK
});

// Spejler den gamle generated kolonne EKSAKT:
// GREATEST(1, ROUND((COALESCE(base_value,1000)+prize_earnings_bonus)*0.10))
export function computeFrozenSalary({ base_value, prize_earnings_bonus } = {}) {
  const base = Number(base_value) > 0 ? Number(base_value) : CONTRACT.BASE_VALUE_FALLBACK;
  const mv = base + (Number(prize_earnings_bonus) || 0);
  return Math.max(1, Math.round(mv * CONTRACT.SALARY_RATE));
}

// ~1/3 hver af 1,2,3. rng = makeRng(seed) fra fictionalRiderGenerator.
export function pickContractLength(rng) {
  return CONTRACT.MIN_LENGTH + Math.floor(rng() * (CONTRACT.MAX_LENGTH - CONTRACT.MIN_LENGTH + 1));
}

// Sidste aktive sæson = startSeason + length - 1.
export function computeContractEndSeason(startSeasonNumber, length) {
  return startSeasonNumber + length - 1;
}
```

- [ ] **Step 4: Kør testen og bekræft den passerer**

Run: `node --test backend/lib/contractSeed.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/contractSeed.js backend/lib/contractSeed.test.js
git commit -F .git/COMMIT_EDITMSG_1309_2
```
Besked: `feat(contracts): pure helpers for frossen løn + kontraktlængde (#1309)`

---

## Task 3: Seed-wrapper `runContractSeed` + wire i orchestrator

**Files:**
- Modify: `backend/lib/contractSeed.js` (tilføj DB-wrapper)
- Modify: `backend/lib/relaunchOrchestrator.js:21-24,74-86,118-132`
- Test: `backend/lib/contractSeed.test.js` (tilføj wrapper-test)
- Test: `backend/lib/relaunchOrchestrator.test.js:14-58`

- [ ] **Step 1: Skriv den fejlende wrapper-test**

Tilføj til `backend/lib/contractSeed.test.js`:

```js
import { runContractSeed } from "./contractSeed.js";

function makeSupabase({ owned, founderTeamIds, activeSeasonNumber }) {
  const updates = [];
  return {
    updates,
    from(table) {
      if (table === "seasons") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() { return Promise.resolve({ data: { number: activeSeasonNumber }, error: null }); },
        };
      }
      if (table === "teams") {
        return { select() { return this; }, eq() { return this; },
          then: undefined,
          // getBetaManagerTeams bruger filter-kæde; vi injicerer i stedet via getManagerTeams-dep
        };
      }
      if (table === "riders") {
        return {
          select() { return this; },
          not() { return Promise.resolve({ data: owned, error: null }); }, // team_id NOT NULL
          update(patch) { return { eq(_c, id) { updates.push({ id, patch }); return Promise.resolve({ error: null }); } }; },
        };
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

test("runContractSeed: founders → 2 sæsoner, andre ejede → 1-3, free agents urørt", async () => {
  const owned = [
    { id: "r1", team_id: "founder1", base_value: 1_000_000, prize_earnings_bonus: 0 },
    { id: "r2", team_id: "founder1", base_value: 200_000, prize_earnings_bonus: 0 },
    { id: "r3", team_id: "ai1", base_value: 500_000, prize_earnings_bonus: 0 },
  ];
  const supabase = makeSupabase({ owned, founderTeamIds: ["founder1"], activeSeasonNumber: 1 });
  const res = await runContractSeed(supabase, {
    dryRun: false,
    seed: 2026,
    getManagerTeams: async () => [{ id: "founder1" }],
  });

  assert.equal(res.dryRun, false);
  assert.equal(res.seeded, 3);
  const byId = Object.fromEntries(supabase.updates.map((u) => [u.id, u.patch]));
  // Founder-ryttere: 2 sæsoner, end = 1+2-1 = 2
  assert.equal(byId.r1.contract_length, 2);
  assert.equal(byId.r1.contract_end_season, 2);
  assert.equal(byId.r1.salary, 100_000);
  assert.equal(byId.r2.contract_length, 2);
  // Ikke-founder ejet (ai1): blandet 1-3
  assert.ok(byId.r3.contract_length >= 1 && byId.r3.contract_length <= 3);
  assert.equal(byId.r3.contract_end_season, 1 + byId.r3.contract_length - 1);
  assert.equal(byId.r3.salary, 50_000);
});

test("runContractSeed (dryRun): ingen writes, kun preview-count", async () => {
  const owned = [{ id: "r1", team_id: "founder1", base_value: 1_000_000, prize_earnings_bonus: 0 }];
  const supabase = makeSupabase({ owned, founderTeamIds: ["founder1"], activeSeasonNumber: 1 });
  const res = await runContractSeed(supabase, { dryRun: true, getManagerTeams: async () => [{ id: "founder1" }] });
  assert.equal(res.dryRun, true);
  assert.equal(res.toSeed, 1);
  assert.equal(supabase.updates.length, 0);
});
```

- [ ] **Step 2: Kør og bekræft fejl**

Run: `node --test backend/lib/contractSeed.test.js`
Expected: FAIL — `runContractSeed` ikke eksporteret.

- [ ] **Step 3: Implementér DB-wrapperen**

Tilføj til bunden af `backend/lib/contractSeed.js`:

```js
import { makeRng } from "./fictionalRiderGenerator.js";
import { fetchAllRows } from "./supabasePagination.js";

const WRITE_CONCURRENCY = 25;

// DB-wrapper: sæt kontrakt på alle ejede ryttere. Founders → 2 sæsoner; andre
// ejede → blandet 1-3 (seeded). Free agents (team_id NULL) røres ALDRIG.
// Kører i orchestratoren EFTER allocation + sæson-transition (kender sæson-number).
export async function runContractSeed(supabase, {
  dryRun = true,
  seed = 2026,
  getManagerTeams,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  // Founder-hold (ved relaunch = alle beta-manager-hold).
  let founderTeams;
  if (getManagerTeams) {
    founderTeams = await getManagerTeams(supabase);
  } else {
    const { getBetaManagerTeams } = await import("./betaResetService.js");
    founderTeams = await getBetaManagerTeams(supabase);
  }
  const founderIds = new Set(founderTeams.map((t) => t.id).filter(Boolean));

  // Aktiv sæson-number → udløbsberegning.
  const seasonRes = await supabase.from("seasons").select("number").eq("status", "active").maybeSingle();
  if (seasonRes?.error) throw new Error(`runContractSeed sæson: ${seasonRes.error.message}`);
  const startSeason = seasonRes?.data?.number ?? 1;

  // Alle EJEDE ryttere (team_id NOT NULL).
  const owned = await fetchAllRows(() =>
    supabase.from("riders")
      .select("id, team_id, base_value, prize_earnings_bonus")
      .not("team_id", "is", null)
      .order("id"));

  const rng = makeRng(seed);
  const patches = owned.map((r) => {
    const length = founderIds.has(r.team_id) ? CONTRACT.FOUNDER_LENGTH : pickContractLength(rng);
    return {
      id: r.id,
      patch: {
        salary: computeFrozenSalary(r),
        contract_length: length,
        contract_end_season: computeContractEndSeason(startSeason, length),
      },
    };
  });

  if (dryRun) {
    return { dryRun: true, toSeed: patches.length, founders: founderIds.size, startSeason };
  }

  let seeded = 0;
  for (let i = 0; i < patches.length; i += WRITE_CONCURRENCY) {
    const batch = patches.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(batch.map(({ id, patch }) =>
      supabase.from("riders").update(patch).eq("id", id).then(({ error }) => {
        if (error) throw new Error(`contract seed ${id}: ${error.message}`);
      })));
    seeded += batch.length;
  }
  return { dryRun: false, seeded, founders: founderIds.size, startSeason };
}
```

> **Note for executor:** Flyt `import { makeRng } ...` op til toppen af filen sammen med Task 2-koden (ESM imports skal stå før brug). `fetchAllRows`-importen ligeså. Den ovenstående placering er kun for læsbarhed i planen.

- [ ] **Step 4: Kør og bekræft pass**

Run: `node --test backend/lib/contractSeed.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire ind i orchestratoren**

I `backend/lib/relaunchOrchestrator.js`:

(a) Import (efter linje 23):
```js
import { runContractSeed } from "./contractSeed.js";
```

(b) DEFAULT_DEPS (tilføj efter `grantFounderBadges,` i objektet linje 74-86):
```js
  runContractSeed,
```

(c) Kald — indsæt efter sæson-blokken (efter linje 127, FØR founder-badges step 7):
```js
  // 6.5 Kontrakt-seed: frossen løn + længde + udløb på ejede ryttere.
  // Kører efter sæson-transition så aktiv sæson-number (= 1) er kendt.
  // I dry-run previewer den mod nuværende DB (ingen writes).
  summary.contracts = await d.runContractSeed(supabase, { dryRun, seed });
```

- [ ] **Step 6: Opdatér orchestrator-testens DI-rækkefølge**

I `backend/lib/relaunchOrchestrator.test.js`:

(a) Tilføj til `makeDeps` returobjekt (efter `grantFounderBadges`-linjen, linje 29):
```js
    runContractSeed: rec("contracts", { seeded: 144 }),
```

(b) Opdatér dry-run forventet rækkefølge (linje 40):
```js
  assert.deepEqual(names, ["retire", "population", "physiology", "types", "baseValue", "allocation", "contracts", "founder"]);
```

(c) Opdatér apply forventet rækkefølge (linje 54-57):
```js
  assert.deepEqual(names, [
    "retire", "reset", "population", "physiology", "types", "baseValue", "allocation",
    "seedSeason0", "transition", "contracts", "founder",
  ]);
```

(d) Tilføj `"contracts"` til summary-nøgle-loopet (linje 44):
```js
  for (const k of ["retireLegacy", "reset", "population", "backfills", "allocation", "season", "contracts", "founderBadge"]) {
```

- [ ] **Step 7: Kør begge test-filer**

Run: `node --test backend/lib/contractSeed.test.js backend/lib/relaunchOrchestrator.test.js`
Expected: PASS (alle).

- [ ] **Step 8: Commit**

```bash
git add backend/lib/contractSeed.js backend/lib/contractSeed.test.js backend/lib/relaunchOrchestrator.js backend/lib/relaunchOrchestrator.test.js
git commit -F .git/COMMIT_EDITMSG_1309_3
```
Besked: `feat(contracts): seed-trin i relaunch-orchestrator (founders 2 sæsoner) (#1309)`

---

## Task 4: Salary-resolver (display-fallback) + kontrakt-on-acquire

**Files:**
- Modify: `backend/lib/marketUtils.js` (tilføj `resolveRiderSalary`)
- Modify: `frontend/src/lib/marketValues.js` (tilføj `getRiderSalary`)
- Modify: `backend/lib/auctionFinalization.js:298-313`
- Modify: `backend/lib/transferExecution.js:367-378,530-565`
- Test: `backend/lib/marketUtils.test.js` (resolver)
- Test: `backend/lib/auctionFinalization.test.js`, `backend/lib/transferExecution.test.js`

- [ ] **Step 1: Test for `resolveRiderSalary`**

Tilføj til `backend/lib/marketUtils.test.js` (opret hvis ikke findes; brug `node:test`):

```js
import test from "node:test";
import assert from "node:assert/strict";
import { resolveRiderSalary } from "./marketUtils.js";

test("resolveRiderSalary: frossen løn vinder; NULL → 10% af market_value", () => {
  assert.equal(resolveRiderSalary({ salary: 42_000, base_value: 1_000_000 }), 42_000);
  // free agent (NULL) → estimat
  assert.equal(resolveRiderSalary({ salary: null, base_value: 1_000_000, prize_earnings_bonus: 0 }), 100_000);
  // salary 0 er en gyldig frossen værdi? Nej — vi behandler kun NULL/undefined som "ingen kontrakt".
  assert.equal(resolveRiderSalary({ salary: 0, base_value: 1_000_000 }), 0);
  assert.equal(resolveRiderSalary({ base_value: null }), 100); // fallback 1000 → 100
});
```

- [ ] **Step 2: Kør → fejl**

Run: `node --test backend/lib/marketUtils.test.js`
Expected: FAIL — `resolveRiderSalary` ikke eksporteret.

- [ ] **Step 3: Implementér resolver (backend)**

Tilføj i `backend/lib/marketUtils.js` (efter `calculateRiderMarketValue`, omkring linje 90):

```js
// Frossen kontrakt-løn hvis sat; ellers estimat (10% af market_value) til VISNING
// af free agents. Ejede ryttere har altid salary != null (seed + on-acquire).
export function resolveRiderSalary(rider = {}) {
  if (rider && rider.salary != null) return Number(rider.salary);
  return Math.max(1, Math.round(calculateRiderMarketValue(rider) * 0.10));
}
```

- [ ] **Step 4: Kør → pass**

Run: `node --test backend/lib/marketUtils.test.js`
Expected: PASS.

- [ ] **Step 5: Frontend-resolver**

Tilføj i `frontend/src/lib/marketValues.js` (efter `getRiderMarketValue`, linje ~11):

```js
// Frossen kontrakt-løn hvis sat; ellers estimat (10% af market_value) for free agents.
export function getRiderSalary(rider = {}) {
  if (rider && rider.salary != null) return Number(rider.salary);
  return Math.max(1, Math.round(getRiderMarketValue(rider) * 0.10));
}
```

- [ ] **Step 6: Test for kontrakt-on-acquire (auction)**

Tilføj til `backend/lib/auctionFinalization.test.js` — to regression-tests. Mock-stilen findes allerede i filen (riderUpdates-array fanger updates). Tilføj:

```js
test("finalization: kontraktløs vinder (NULL salary) får auto-kontrakt", async () => {
  // ... arranger en auktion hvor rider.salary = null, base_value sat, window OPEN ...
  // Forventet: rider-update inkluderer salary = computeFrozenSalary + contract_length = 2
  //            + contract_end_season = activeSeason + 1, UD OVER team_id.
});

test("finalization: rytter MED kontrakt arver uændret (ingen regenerering)", async () => {
  // ... rider.salary = 30_000, contract_length = 3, contract_end_season = 5 ...
  // Forventet: rider-update sætter team_id, men RØRER IKKE salary/contract_length/contract_end_season.
});
```

> **Executor:** Udfyld arrange-blokkene ved at spejle den eksisterende finalization-mock i filen (se de eksisterende tests fra linje ~85). Assertions skal tjekke det faktiske `riders.update`-patch-objekt.

- [ ] **Step 7: Kør → fejl (on-acquire ikke implementeret)**

Run: `node --test backend/lib/auctionFinalization.test.js`
Expected: FAIL — auto-kontrakt mangler.

- [ ] **Step 8: Implementér kontrakt-on-acquire (auction)**

I `backend/lib/auctionFinalization.js`, ved ejerskabs-mutationen (linje 298-313): når rytteren erhverves OG `auction.rider.salary == null`, tilføj kontrakt-felterne til update-patchen. Importér helpers:

```js
import { CONTRACT, computeFrozenSalary, computeContractEndSeason } from "./contractSeed.js";
```

Beregn én gang (hent aktiv sæson-number i finalization-konteksten — der hvor `actualEnd` er kendt):

```js
// Kontrakt-on-acquire: kontraktløs (free agent) rytter får standard-kontrakt
// ved erhvervelse. Rytter MED kontrakt arver uændret.
const acquireContract = auction.rider.salary == null
  ? {
      salary: computeFrozenSalary(auction.rider),
      contract_length: CONTRACT.DEFAULT_ACQUIRE_LENGTH,
      contract_end_season: computeContractEndSeason(activeSeasonNumber, CONTRACT.DEFAULT_ACQUIRE_LENGTH),
    }
  : {};
```

Flet `...acquireContract` ind i `riders.update`-objektet i BÅDE window-open- og window-closed-grenen (kontrakten følger rytteren uanset pending-state). `auction.rider` skal SELECTE `salary, base_value, prize_earnings_bonus` (verificér select-listen; udvid hvis nødvendigt). `activeSeasonNumber` hentes via en `seasons`-query (status='active', number) i finalization-flowet hvis ikke allerede tilgængeligt.

- [ ] **Step 9: Implementér kontrakt-on-acquire (transfer + swap)**

Samme mønster i `backend/lib/transferExecution.js`:
- Transfer (linje 367-378): flet `...acquireContract` hvor `team_id` sættes (rider `salary == null` ⇒ ny kontrakt; ellers urørt). `rider` select'er allerede `salary` (linje 326) — udvid med `base_value, prize_earnings_bonus`.
- Swap (linje 530-565): begge ryttere — samme create-if-missing.

> **Vigtigt:** swap/transfer mellem to hold af en rytter DER ALLEREDE har kontrakt → patchen indeholder KUN `team_id` (+ pending), så `salary`/`contract_*` bevares uændret. Det er acceptance-kravet "Handel bevarer kontrakt uændret".

- [ ] **Step 10: Test transfer-regression**

Tilføj til `backend/lib/transferExecution.test.js` parallelt med auction-testene (arvet uændret + kontraktløs får kontrakt). Kør:

Run: `node --test backend/lib/auctionFinalization.test.js backend/lib/transferExecution.test.js backend/lib/marketUtils.test.js`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add backend/lib/marketUtils.js backend/lib/marketUtils.test.js frontend/src/lib/marketValues.js backend/lib/auctionFinalization.js backend/lib/auctionFinalization.test.js backend/lib/transferExecution.js backend/lib/transferExecution.test.js
git commit -F .git/COMMIT_EDITMSG_1309_4
```
Besked: `feat(contracts): salary-resolver + kontrakt-on-acquire i finalization (#1309)`

---

## Task 5: UI — vis kontrakt på profil + auktion + transfer

**Files:**
- Modify: `frontend/src/pages/RiderStatsPage.jsx:1503-1521`
- Modify: `frontend/src/pages/AuctionsPage.jsx:236-239,423-426`
- Modify: `frontend/src/pages/TransfersPage.jsx:137-141`
- Modify: locale-filer (`rider.json`, `auctions.json`, `transfers.json` × en+da)
- Test: `frontend/src/pages/AuctionsPage.fields.test.js` (sikr salary/contract i query)

- [ ] **Step 1: Tilføj i18n-keys**

`frontend/public/locales/en/rider.json` — tilføj i `header`-objektet (efter `valueLabel`, linje 50):
```json
    "contractLabel": "Contract",
    "contractSalary": "Salary CZ$",
    "contractRemaining": "{count, plural, one {1 season left} other {# seasons left}}",
    "contractExpired": "Expiring",
    "noContract": "Free agent — no contract",
    "estSalary": "Est. salary CZ$",
```
`da/rider.json` (samme keys):
```json
    "contractLabel": "Kontrakt",
    "contractSalary": "Løn CZ$",
    "contractRemaining": "{count, plural, one {1 sæson tilbage} other {# sæsoner tilbage}}",
    "contractExpired": "Udløber",
    "noContract": "Free agent — ingen kontrakt",
    "estSalary": "Anslået løn CZ$",
```
Tilsvarende `contract.remaining`/`contract.estSalary`-keys i `auctions.json` + `transfers.json` (en+da) — følg den eksisterende `card.salary`-konvention.

- [ ] **Step 2: Rider-profil — vis kontrakt**

I `frontend/src/pages/RiderStatsPage.jsx`, i højre info-blok (omkring linje 1503-1521, ved `valueLabel`): tilføj en kontrakt-linje. Brug `getRiderSalary` (importér fra `../lib/marketValues`). Logik:
- Hvis `rider.contract_length != null`: vis `t("header.contractSalary")` + `formatNumber(rider.salary)` og `t("header.contractRemaining", { count: Math.max(0, rider.contract_end_season - currentSeasonNumber + 1) })`.
- Ellers (free agent): vis `t("header.estSalary")` + `formatNumber(getRiderSalary(rider))` + `t("header.noContract")`.

`currentSeasonNumber` hentes fra eksisterende season-context/query på siden (verificér tilgængelig kilde; ellers tilføj en let `seasons`-query for aktiv number).

- [ ] **Step 3: Auktion — restløbetid ved siden af løn**

I `AuctionsPage.jsx` (linje 236-239 tabel + 423-426 kort): hvor `r.salary` vises, brug `getRiderSalary(r)` så free agents viser estimat i stedet for "—". Tilføj kontrakt-rest hvis `r.contract_length != null`: lille badge `t("contract.remaining", { count })`. Sørg for at auktions-queryen SELECT'er `salary, contract_length, contract_end_season` (udvid select-listen linje ~238/1329).

- [ ] **Step 4: Transfer — kontrakt på tilbuds-kort**

I `TransfersPage.jsx` (linje 137-141, value-sektion): tilføj løn + restløbetid under værdi, via `getRiderSalary(offer.rider)` + `offer.rider.contract_length`. Sørg for at offer-rider-objektet inkluderer felterne (verificér backend-response shaping i `api.js` transfer-ruter — tilføj felterne hvis de mangler).

- [ ] **Step 5: Opdatér felt-test**

I `frontend/src/pages/AuctionsPage.fields.test.js`: tilføj `salary`, `contract_length`, `contract_end_season` til de forventede select-felter.

- [ ] **Step 6: Kør frontend-tests + build**

Run: `cd frontend; node --test; npm run build`
Expected: tests PASS, build OK (ingen manglende `.js`-imports — jf. #803).

- [ ] **Step 7: Verificér logget-ind UI lokalt via Playwright-mocks**

Tilføj kontrakt-felter til `frontend/tests/fixtures.js` rider-mock (salary + contract_length + contract_end_season; plus én free-agent uden). Tag umasket screenshot af rider-profil + auktion. Bekræft kontrakt vises for ejede, estimat for free agents.

- [ ] **Step 8: Refresh core-smoke snapshots (visuel ændring)**

Run: `npx playwright test core-smoke --update-snapshots` (alle 3 projekter, win32). Commit PNG'erne.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/RiderStatsPage.jsx frontend/src/pages/AuctionsPage.jsx frontend/src/pages/TransfersPage.jsx frontend/public/locales frontend/src/pages/AuctionsPage.fields.test.js frontend/tests
git commit -F .git/COMMIT_EDITMSG_1309_5
```
Besked: `feat(contracts): vis kontrakt (løn + restløbetid) på profil/auktion/transfer (#1309)`

---

## Task 6: Økonomi-sim + committet scorecard

**Files:**
- Create: `backend/scripts/economyContractSimulation.js`
- Create: `docs/metrics/contract-economy-scorecard-2026-06-13.md`
- Modify: `package.json` / `backend/package.json` (npm-script `sim:contracts`)

- [ ] **Step 1: Skriv sim-scriptet**

Create `backend/scripts/economyContractSimulation.js` der (mønster fra `economyBaselineSimulation.js`):
1. Loader teams (manager/founder) + deres ejede ryttere med `salary, base_value, contract_length, contract_end_season`. (Readonly-env, som baseline-simmen.)
2. Pr. hold: `frozenWageBill = sum(rider.salary)` (= frossen lønmasse), `sponsorIncome`, `balance`.
3. `netSeason1 = sponsorIncome + estPrizes - frozenWageBill` (genbrug repræsentative prize-estimater fra baseline-simmen).
4. **Guldkontrakt-metrik:** pr. udviklingsbar ung (alder ≤ 23): `goldRatio = projectedDevelopedValue*0.10 / frozen_salary`. Aggregér median + p90.
5. Emit scorecard (markdown) med pr.-hold + aggregat.

Scorecard-targets (assertions; exit(1) ved brud, jf. balance-gate-mønster afsnit 13):
- **Solvens:** median `netSeason1` ≥ 0 OG ingen founder-hold under `-DEBT_CEILING[division]` alene fra løn.
- **Guldkontrakt mærkbar men ikke dominerende:** median `goldRatio` ∈ [1.1, 2.5] (fordel findes, men frossen løn er ikke < 40 % af fremtidig markedsløn for medianen).

- [ ] **Step 2: Tilføj npm-script**

I `backend/package.json` scripts: `"sim:contracts": "node scripts/economyContractSimulation.js --markdown"`.

- [ ] **Step 3: Kør simmen mod en seeded population (dry-run-relaunch-snapshot eller readonly-prod) + commit scorecard**

Run: `cd backend; npm run sim:contracts > ../docs/metrics/contract-economy-scorecard-2026-06-13.md`
Inspicér: alle targets grønne. Hvis ikke → STOP, rapportér til ejer (balance-beslutning, ikke autonomt tuning — jf. simulate-before-ship-reglen).

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/economyContractSimulation.js backend/package.json docs/metrics/contract-economy-scorecard-2026-06-13.md
git commit -F .git/COMMIT_EDITMSG_1309_6
```
Besked: `feat(contracts): økonomi-sim + scorecard for frossen lønmasse (#1309)`

---

## Task 7: Read-site sweep — bekræft NULL-salary er sikkert

**Files:** (verifikation; ret kun hvis brud)
- `backend/lib/economyEngine.js:470`, `financeForecast.js:74-75`, `boardConsequences.js:188-207,332`
- `frontend/src/pages/{RidersPage,TeamPage,WatchlistPage,DashboardPage,RiderComparePage}.jsx`

- [ ] **Step 1: Backend arithmetic — bekræft owned aldrig er NULL**

Verificér at de 3 arithmetic-summer kun rammer EJEDE ryttere (query'er pr. `team_id`), som efter seed + on-acquire altid har `salary != null`. `economyEngine.js:470` bruger allerede `(r.salary||0)`. Bekræft `financeForecast.js` + `boardConsequences.js` ikke fejler på NULL (de summer team-riders → non-null). Ingen ændring forventet; dokumentér konklusionen i PR.

- [ ] **Step 2: Frontend display — free-agent-visning**

Grep frontend for `\.salary` i display-kontekst (RidersPage, TeamPage, WatchlistPage, DashboardPage, RiderComparePage). For lister der inkluderer free agents (RidersPage, WatchlistPage): skift visning til `getRiderSalary(rider)` så NULL viser estimat, ikke "—". TeamPage (kun egne, altid ejede) kan beholde `rider.salary`.

- [ ] **Step 3: Sortering/filtrering på løn**

`RiderFilters.jsx` + `useRiderFilters.js`: salary-range-filteret kører serverside (gte/lte på `salary`). Free agents (NULL) ekskluderes af range-filtre i Postgres — acceptabelt (NULL matcher ikke range). Verificér at default-listen (uden filter) stadig viser free agents. Ingen ændring hvis OK; dokumentér.

- [ ] **Step 4: Kør fuld suite**

Run: `pwsh -File scripts/verify-local.ps1` (backend-tests + frontend-tests + build).
Expected: alt grønt.

- [ ] **Step 5: Commit (hvis ændringer)**

```bash
git add -A
git commit -F .git/COMMIT_EDITMSG_1309_7
```
Besked: `fix(contracts): free-agent salary-visning via resolver i ryttelister (#1309)`

---

## Task 8: Release-hygiejne + docs

**Files:**
- `frontend/public/locales/en/help.json` + `da/help.json`
- `frontend/src/pages/PatchNotesPage.jsx:1-19`
- `docs/FEATURE_STATUS.md`
- `docs/GAME_INVARIANTS.md`
- GitHub: #1103-kommentar (backfill-checkliste) + #1309-close

- [ ] **Step 1: help.json — ny `contracts`-sektion (en+da)**

Tilføj en `sections.contracts`-blok (label "Contracts & Salary" / "Kontrakter & løn") der forklarer: frossen løn ved signering, guldkontrakter vs. møllesten, kontrakt følger med ved handel, free agents har ingen kontrakt. Følg den eksisterende sektion-struktur (`label`, `whatX.title/text`).

- [ ] **Step 2: PatchNotesPage — ny entry**

Tilføj øverst i `PATCH_NOTES`-arrayet (linje ~3) en ny version (bump fra 5.30 → 5.31), kategori "New · Rider contracts", med EN· + DA·-linjer:
```
"EN · Riders now have contracts: a frozen salary, a length (1-3 seasons) and an expiry. Salary is locked in at signing, so a young rider who develops becomes a bargain (a 'gold contract'), while a fading star on a high salary becomes a burden. Contracts are shown on the rider profile, in auctions and in transfer offers, and follow the rider when traded. Free agents have no contract until signed. Refs #1309",
"DA · Ryttere har nu kontrakter: en frossen løn, en længde (1-3 sæsoner) og et udløb. Lønnen låses ved signering, så en ung rytter der udvikler sig bliver et røverkøb (en 'guldkontrakt'), mens en falmende stjerne på høj løn bliver en byrde. Kontrakter vises på rytterprofilen, på auktioner og i transfertilbud, og følger rytteren ved handel. Free agents har ingen kontrakt før de signes. Refs #1309",
```

- [ ] **Step 3: FEATURE_STATUS.md + GAME_INVARIANTS.md**

- `FEATURE_STATUS.md`: tilføj kontrakt-data (skema + seed) som leveret; flows (forlængelse/udløb→auktion/frigivelse) = markeds-pakke fast-follow.
- `GAME_INVARIANTS.md`: dokumentér ny invariant — "ejede ryttere har altid `salary != null` (seed + on-acquire); free agents = NULL; salary er frossen (ikke længere GENERATED)".

- [ ] **Step 4: Doc-drift sweep**

Grep efter beskrivelser af "salary er GENERATED / 10% af market_value" i docs (`ARCHITECTURE.md`, andre) → opdatér til "frossen ved signering".

- [ ] **Step 5: Commit**

```bash
git add frontend/public/locales frontend/src/pages/PatchNotesPage.jsx docs/FEATURE_STATUS.md docs/GAME_INVARIANTS.md
git commit -F .git/COMMIT_EDITMSG_1309_8
```
Besked: `docs(contracts): help + patch notes 5.31 + invariants + feature-status (#1309)`

- [ ] **Step 6: #1103-backfill-checkliste + PR**

- Kommentér på #1103: "Tilføjet kontrakt-seed-trin til relaunch-orchestratoren (runContractSeed, step 6.5) — kører efter sæson-transition; founders 2 sæsoner, andre ejede blandet 1-3."
- Opret PR med Brugerverifikation-sektion (kontrakt-visning + seed-dry-run). **PR'en indeholder `database/*.sql` → ejeren merger.**

---

## Self-Review

**1. Spec coverage** (#1309 acceptance):
- [x] DB-migration: kontrakt-felter + frossen salary → Task 1.
- [x] Seed i relaunch-orchestrator (blandet/founder 2 sæsoner) → Task 3.
- [x] Kontrakt følger med ved handel (ikke regenerere) → Task 4 (on-acquire create-if-missing; arver ellers uændret).
- [x] Visning på profil + auktion + transfer → Task 5.
- [x] Økonomi-sim + committet scorecard → Task 6.
- [x] Ingen brud på NULL-salary (read-sweep) → Task 7.
- [x] EN-først/DA + help.json + patch notes → Task 5 + 8.
- [x] #1103-backfill-checkliste opdateret → Task 8.

**2. Placeholder-scan:** Task 4 step 6 + Task 5/6/8 lader executor udfylde arrange-blokke/JSX/help-tekst mod eksisterende mønstre (filerne skal læses for eksakt omkringliggende kode). Disse er bevidst spec-præcise (file:line + eksakt logik) frem for at gætte ukendt eksisterende kode — executor matcher den faktiske kontekst.

**3. Type-konsistens:** `computeFrozenSalary(rider-objekt)`, `pickContractLength(rng)`, `computeContractEndSeason(start, length)`, `runContractSeed(supabase, opts)`, `resolveRiderSalary(rider)` / `getRiderSalary(rider)` — navne konsistente på tværs af Task 2/3/4/5. `contract_length` + `contract_end_season` + `salary` ens overalt.

**Afvigelse fra issue-ordlyd (bevidst, ejer-godkendt):** "Ingen læsning af den gamle generated `salary`-kolonne" → vi BEHOLDER navnet `salary` (nu frossen plain). Den generated kolonne er væk; reads læser nu den frosne værdi. Ejer valgte "konvertér på stedet" 13/6 for lavere risiko.

---

## Execution Handoff

Efter godkendelse: eksekvér via **subagent-driven-development** (frisk subagent pr. task, review imellem) i en isoleret **git worktree** (`scripts/new-worktree.ps1`) — feature-arbejde, branch fra origin/main. PR'en rører `database/*.sql` → **ejeren merger**.
