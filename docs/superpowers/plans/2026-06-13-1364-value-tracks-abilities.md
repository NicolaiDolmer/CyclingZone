# Værdi følger udviklede evner (#1364) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Få `base_value` til at følge en rytters aktuelle evner (genberegnet når evnerne udvikles), så akademiets "udvikl-og-sælg"-forretningsmodel virker — uden runaway-inflation.

**Architecture:** `base_value = round(predictBaseValue(rider, aktuelle evner, model))` (Model 1, objektiv rating). Én funktion `refreshChangedRiderValues` genberegner type+værdi for hele populationen (billig ren funktion) men **skriver kun de ryttere hvor værdien faktisk ændrede sig** (ingen churn) — kaldt efter den daglige trænings-sweep (fuld) og efter manuel run-today (scoped). Den daglige fulde refresh ER samtidig sikkerhedsnettet (fanger enhver evne-ændring uanset kilde). En sim-scorecard-script beviser balancen før ship.

**Tech Stack:** Node.js + Express (ESM, `node --test`), Supabase Postgres. Genbruger `predictBaseValue` (riderValuation.js), `computeRiderTypes` (riderTypes.js), `developRiderSeason`/`buildCaps` (riderProgression.js), `generateLaunchPopulation` + `deriveAbilities` (fiktiv population).

**Spec:** `docs/superpowers/specs/2026-06-13-value-tracks-abilities-design.md`

**Ingen migration.** `base_value`/`market_value`-kolonnerne findes; `market_value` er GENERATED `COALESCE(base_value,1000)+prize_earnings_bonus`.

---

## File Structure

| Fil | Ansvar | Create/Modify |
|-----|--------|---------------|
| `backend/lib/riderValueRefresh.js` | `recomputeRiderValue` (ren) + `selectChangedValueUpdates` (ren diff) + `refreshChangedRiderValues` (DB-wrapper) | Create |
| `backend/lib/riderValueRefresh.test.js` | Unit-tests for de rene dele | Create |
| `backend/lib/trainingSweep.js` | Kald fuld refresh efter sweep-loop (DI-hook) | Modify |
| `backend/lib/trainingSweep.test.js` | Assertér refresh kaldes efter sweep | Modify |
| `backend/routes/api.js` | Kald scoped refresh efter `run-today` | Modify |
| `backend/scripts/valueDevelopSellScorecard.js` | Sim-scorecard (udvikl-og-sælg-P&L + inflations-check), ingen DB | Create |

---

## Task 1: `riderValueRefresh.js` — recompute + diff (TDD)

**Files:**
- Create: `backend/lib/riderValueRefresh.js`
- Test: `backend/lib/riderValueRefresh.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recomputeRiderValue, selectChangedValueUpdates } from "./riderValueRefresh.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(readFileSync(join(__dirname, "riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "riderValuationModel.json"), "utf8"));

// Minimal realistisk ability-vektor (alle 16 synlige evner sat).
const ABIL = { climbing: 60, time_trial: 55, prolog: 50, flat: 58, tempo: 57, sprint: 40, acceleration: 45, punch: 48, endurance: 62, recovery: 58, durability: 55, descending: 52, cobblestone: 41, positioning: 50, aggression: 50, tactics: 50 };

test("recomputeRiderValue: returnerer type + afrundet base_value, deterministisk", () => {
  const a = recomputeRiderValue({ id: "r1" }, ABIL, baseline, model);
  assert.ok(typeof a.primary_type === "string" && a.primary_type.length > 0);
  assert.ok(typeof a.secondary_type === "string");
  assert.equal(a.base_value, Math.round(a.base_value), "base_value er afrundet (INTEGER-kolonne)");
  assert.ok(a.base_value > 0);
  const b = recomputeRiderValue({ id: "r1" }, ABIL, baseline, model);
  assert.deepEqual(a, b);
});

test("selectChangedValueUpdates: skriver KUN ryttere hvor værdi/type ændrede sig", () => {
  const fresh = recomputeRiderValue({ id: "r1" }, ABIL, baseline, model);
  const riders = [
    // r1: stored matcher recompute → IKKE i updates
    { id: "r1", primary_type: fresh.primary_type, secondary_type: fresh.secondary_type, base_value: fresh.base_value },
    // r2: stored base_value forskellig → i updates
    { id: "r2", primary_type: fresh.primary_type, secondary_type: fresh.secondary_type, base_value: fresh.base_value + 50_000 },
    // r3: ingen abilities → springes over
    { id: "r3", primary_type: "gc", secondary_type: "rouleur", base_value: 100 },
  ];
  const abilityByRider = new Map([["r1", ABIL], ["r2", ABIL]]);
  const updates = selectChangedValueUpdates(riders, abilityByRider, baseline, model);
  const ids = updates.map((u) => u.id);
  assert.ok(!ids.includes("r1"), "uændret rytter skrives ikke");
  assert.ok(ids.includes("r2"), "ændret rytter skrives");
  assert.ok(!ids.includes("r3"), "rytter uden abilities springes over");
  const u2 = updates.find((u) => u.id === "r2");
  assert.deepEqual(Object.keys(u2).sort(), ["base_value", "id", "primary_type", "secondary_type"]);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test backend/lib/riderValueRefresh.test.js`
Expected: FAIL (`Cannot find module './riderValueRefresh.js'`)

- [ ] **Step 3: Implement**

```js
// #1364 — base_value følger udviklede evner (Model 1, objektiv rating).
// recomputeRiderValue: ren kæde (typer → base_value), samme som relaunch-backfill
// + fictionalPopulationPreview. refreshChangedRiderValues: genberegn alle, skriv
// kun de ændrede (ingen daglig churn). base_value afrundes (INTEGER-kolonne).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "./supabasePagination.js";
import { computeRiderTypes, ABILITY_KEYS } from "./riderTypes.js";
import { predictBaseValue } from "./riderValuation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TYPES_BASELINE_PATH = join(__dirname, "./riderTypesBaseline.json");
const VALUATION_MODEL_PATH = join(__dirname, "./riderValuationModel.json");
const noop = () => {};
const WRITE_CONCURRENCY = 25;

export function recomputeRiderValue(riderRow, abilities, baseline, model) {
  const { primary, secondary } = computeRiderTypes(abilities, baseline);
  const withType = { ...riderRow, primary_type: primary.key, secondary_type: secondary.key };
  const raw = predictBaseValue(withType, abilities, model);
  return {
    primary_type: primary.key,
    secondary_type: secondary.key,
    base_value: raw == null ? null : Math.round(raw),
  };
}

// Ren diff: returnér KUN ryttere hvor base_value eller type ændrede sig.
export function selectChangedValueUpdates(riders, abilityByRider, baseline, model) {
  const updates = [];
  for (const r of riders) {
    const ab = abilityByRider.get(r.id);
    if (!ab) continue; // ingen abilities → spring over (kan ikke værdisættes)
    const next = recomputeRiderValue(r, ab, baseline, model);
    if (next.base_value == null) continue;
    const changed =
      next.base_value !== r.base_value ||
      next.primary_type !== r.primary_type ||
      next.secondary_type !== r.secondary_type;
    if (changed) {
      updates.push({ id: r.id, primary_type: next.primary_type, secondary_type: next.secondary_type, base_value: next.base_value });
    }
  }
  return updates;
}

async function writeUpdates(supabase, updates) {
  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_CONCURRENCY) {
    const batch = updates.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(
      batch.map(({ id, ...patch }) =>
        supabase.from("riders").update(patch).eq("id", id).then(({ error }) => {
          if (error) throw new Error(`riders update ${id}: ${error.message}`);
        })
      )
    );
    written += batch.length;
  }
  return written;
}

// Genberegn type+base_value for (evt. ét holds) ryttere; skriv kun de ændrede.
// baseline/model defaulter fra de committede JSON-filer (som runBaseValueBackfill).
export async function refreshChangedRiderValues(supabase, { baseline, model, log = noop, teamId } = {}) {
  const bl = baseline || JSON.parse(readFileSync(TYPES_BASELINE_PATH, "utf8"));
  const m = model || JSON.parse(readFileSync(VALUATION_MODEL_PATH, "utf8"));

  let riderQuery = () => {
    let q = supabase.from("riders").select("id, primary_type, secondary_type, base_value").order("id");
    if (teamId) q = q.eq("team_id", teamId);
    return q;
  };
  const riders = await fetchAllRows(riderQuery);
  const riderIds = new Set(riders.map((r) => r.id));
  const abilities = await fetchAllRows(() =>
    supabase.from("rider_derived_abilities").select(`rider_id, ${ABILITY_KEYS.join(", ")}`).order("rider_id"));
  const abilityByRider = new Map(abilities.filter((a) => riderIds.has(a.rider_id)).map((a) => [a.rider_id, a]));

  const updates = selectChangedValueUpdates(riders, abilityByRider, bl, m);
  log(`value-refresh${teamId ? ` (team ${teamId})` : ""}: ${riders.length} scannet · ${updates.length} ændret`);
  const written = await writeUpdates(supabase, updates);
  return { scanned: riders.length, changed: updates.length, written };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `node --test backend/lib/riderValueRefresh.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/riderValueRefresh.js backend/lib/riderValueRefresh.test.js
git commit -m "feat(value): riderValueRefresh — recompute base_value, skriv kun aendrede (#1364)"
```

---

## Task 2: Wire refresh into training sweep + run-today

**Files:**
- Modify: `backend/lib/trainingSweep.js`, `backend/lib/trainingSweep.test.js`
- Modify: `backend/routes/api.js`

- [ ] **Step 1: Add failing test to `trainingSweep.test.js`**

Add a test asserting the sweep calls the value-refresh hook after processing. Use the existing test patterns in the file (read it first for the fake-supabase + `runDay` DI style). The sweep gains a `refreshValues` DI param:

```js
test("runTrainingSweep: kalder value-refresh efter sweep (enabled + teams)", async () => {
  let refreshCalled = 0;
  const supabase = makeSweepSupabase({ enabled: true }); // mirror existing helper: 1 team, active season, no runs today
  const now = new Date("2026-06-13T20:00:00Z"); // efter kl. 22 dansk (CEST) — brug en tid der passerer shouldSweepNow i din helper
  await runTrainingSweep({
    supabase,
    now,
    runDay: async () => ({ alreadyRan: false }),
    refreshValues: async () => { refreshCalled++; return { scanned: 1, changed: 0, written: 0 }; },
  });
  assert.equal(refreshCalled, 1);
});
```
(Adapt `makeSweepSupabase`/time to whatever the existing tests use; the point is: enabled sweep → `refreshValues` invoked once.)

- [ ] **Step 2: Run, expect FAIL** — `node --test backend/lib/trainingSweep.test.js` (refreshValues not yet wired / not a param).

- [ ] **Step 3: Wire the sweep**

In `backend/lib/trainingSweep.js`: import the refresh and add it as a DI param; call it once after the team loop (only when the sweep actually ran — i.e. not in the early-return skip branches):

```js
import { refreshChangedRiderValues } from "./riderValueRefresh.js";
// ...
export async function runTrainingSweep({
  supabase,
  now = new Date(),
  runDay = runTeamTrainingDay,
  refreshValues = refreshChangedRiderValues,
} = {}) {
  // ... unchanged through the team loop ...

  // #1364: efter sweep — base_value følger nu udviklede evner. Fuld refresh
  // (skriver kun ændrede) fungerer samtidig som sikkerhedsnet/reconcile.
  let valueRefresh = null;
  try {
    valueRefresh = await refreshValues(supabase, { log: (m) => console.log(`  ${m}`) });
  } catch (err) {
    console.error("  ❌ value-refresh efter sweep fejlede:", err.message);
  }

  const base = failed > 0 ? { swept, failed } : { swept };
  return valueRefresh ? { ...base, valueRefresh } : base;
}
```
(Place the refresh AFTER the `for (const team of pending)` loop and BEFORE the final return. Keep the existing early returns — `before_window`, `flag_off`, `no_active_season` — unchanged so refresh does NOT run when training is off.)

- [ ] **Step 4: Run sweep tests, expect PASS** — `node --test backend/lib/trainingSweep.test.js` (new + existing tests pass).

- [ ] **Step 5: Wire run-today (scoped, responsive feedback)**

In `backend/routes/api.js`, `POST /api/training/run-today`: after the successful `runTeamTrainingDay` (where it returns `res.json({ ok: true, ... })`), refresh that team's values so the manager sees value changes immediately. Import at top: `import { refreshChangedRiderValues } from "../lib/riderValueRefresh.js";`. Then, just before the success `res.json`:

```js
// #1364: opdatér base_value for holdets ryttere hvis træningen hævede en evne.
try { await refreshChangedRiderValues(supabase, { teamId: req.team.id }); }
catch (err) { captureException(err); } // feedback-only — må ikke vælte træningen
```
(Do NOT block/fail the training response on a refresh error.)

- [ ] **Step 6: Verify backend** — `node --test backend/` and `node --check backend/routes/api.js`. Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/lib/trainingSweep.js backend/lib/trainingSweep.test.js backend/routes/api.js
git commit -m "feat(value): refresh base_value efter traening (sweep fuld + run-today scoped) (#1364)"
```

---

## Task 3: Develop-and-sell sim scorecard (balance-gate, ingen DB)

**Files:**
- Create: `backend/scripts/valueDevelopSellScorecard.js`

This is the **simulér-før-ship** deliverable. It must run with no DB (in-memory 800-population), be deterministic, and print a scorecard the owner approves before ship.

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
// #1364 balance-gate: beviser at "udvikl-og-sælg" betaler sig + ingen runaway-inflation.
// Genererer launch-populationen (ingen DB), simulerer N sæsoner med progressions-
// motoren, og rapporterer: (1) udvikl-og-sælg-P&L for unge prospects, (2) populations-
// aggregat base_value pr. sæson (inflations-check), (3) aldrende falder (symmetri).
// Deterministisk. Ejer godkender scorecardet FØR ship.
//
//   node scripts/valueDevelopSellScorecard.js [--seasons=4]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateLaunchPopulation } from "../lib/fictionalLaunchPopulation.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { predictBaseValue } from "../lib/riderValuation.js";
import { buildCaps, developRiderSeason } from "../lib/riderProgression.js";
import { ACADEMY } from "../lib/academyFlag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCE_YEAR = 2026;
const SEASONS = (() => {
  const hit = process.argv.find((a) => a.startsWith("--seasons="));
  return hit ? Math.max(1, parseInt(hit.split("=")[1], 10) || 4) : 4;
})();

const baseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "../lib/riderValuationModel.json"), "utf8"));

const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
const pct = (s, p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null);
const bv = (type, abilities) => Math.round(predictBaseValue({ primary_type: type }, abilities, model) ?? 0);

function main() {
  const { riders } = generateLaunchPopulation();
  // Byg simulerbar population.
  const pop = [];
  for (let i = 0; i < riders.length; i++) {
    const r = riders[i];
    const abilities = deriveAbilities({}, { ...r, id: `fic-${i}` }, { asOfYear: REFERENCE_YEAR });
    const { primary } = computeRiderTypes(abilities, baseline);
    const age = r._meta?.age ?? (REFERENCE_YEAR - new Date(r.birthdate).getFullYear());
    pop.push({
      id: i, type: primary.key, potentiale: Number(r.potentiale), startAge: age, retired: false,
      abilities, caps: buildCaps(abilities, primary.key, r.potentiale),
      bvStart: bv(primary.key, abilities),
    });
  }

  // Populations-aggregat sæson 0.
  const seasonTotals = [];
  const livingBv = (s) => pop.filter((p) => !p.retired).map((p) => bv(p.type, p.abilities));
  seasonTotals.push(livingBv(0));

  // Simulér.
  for (let s = 1; s <= SEASONS; s++) {
    for (const p of pop) {
      if (p.retired) continue;
      const age = p.startAge + s;
      const res = developRiderSeason({ id: p.id, primary_type: p.type, potentiale: p.potentiale, age }, p.abilities, p.caps, s);
      p.abilities = { ...p.abilities, ...res.next };
      if (res.retirement.retire) p.retired = true;
    }
    seasonTotals.push(livingBv(s));
  }

  // (1) Udvikl-og-sælg-P&L for unge prospects (akademi-alder ved start: 16-21).
  // Akademi-omkostning pr. sæson i slot = drift + ungdoms-løn (SALARY_RATE × market_value≈base_value).
  // Engangs signing-fee = SIGNING_FEE_RATE × base_value(start). Net = bv(slut) − bv(start) − Σomkostning.
  const pnl = [];
  for (const p of pop) {
    if (!(p.startAge >= ACADEMY.MIN_AGE && p.startAge <= ACADEMY.MAX_AGE)) continue;
    const bvEnd = p.retired ? 0 : bv(p.type, p.abilities);
    const yearsInAcademy = SEASONS; // forenkling: holdt i akademiet hele sim-vinduet
    const salaryPerSeason = ACADEMY.SALARY_RATE * p.bvStart;
    const cost = ACADEMY.SIGNING_FEE_RATE * p.bvStart + yearsInAcademy * (ACADEMY.DRIFT_PER_SEASON + salaryPerSeason);
    pnl.push(bvEnd - p.bvStart - cost);
  }
  pnl.sort((a, b) => a - b);

  // (3) Aldrende (startAge ≥ 32) værdi-ændring.
  const agingDelta = pop.filter((p) => p.startAge >= 32)
    .map((p) => (p.retired ? 0 : bv(p.type, p.abilities)) - p.bvStart).sort((a, b) => a - b);

  // ── RAPPORT ──────────────────────────────────────────────────────────────
  console.log(`=== #1364 udvikl-og-sælg-scorecard (${SEASONS} sæsoner, ${pop.length} ryttere, seed 2026) ===\n`);

  console.log("── (1) Udvikl-og-sælg-P&L — akademi-alder prospects ──");
  console.log(`  Omkostnings-model: signing ${ACADEMY.SIGNING_FEE_RATE}×bv + ${SEASONS}×(drift ${fmt(ACADEMY.DRIFT_PER_SEASON)} + løn ${ACADEMY.SALARY_RATE}×bv)`);
  console.log(`  Net P&L (CZ$):  p10 ${fmt(pct(pnl, 0.1))} · median ${fmt(pct(pnl, 0.5))} · p90 ${fmt(pct(pnl, 0.9))}  (n=${pnl.length})`);
  const profitable = pnl.filter((x) => x > 0).length;
  console.log(`  Andel profitabel: ${(100 * profitable / (pnl.length || 1)).toFixed(0)}%  → ${pct(pnl, 0.5) > 0 ? "✅ median positiv" : "❌ median negativ (akademi = fælde)"}`);

  console.log("\n── (2) Populations-aggregat base_value pr. sæson (inflations-check) ──");
  for (let s = 0; s <= SEASONS; s++) {
    const arr = [...seasonTotals[s]].sort((a, b) => a - b);
    const sum = arr.reduce((a, b) => a + b, 0);
    console.log(`  sæson ${s}: levende ${arr.length} · total ${fmt(sum)} · median ${fmt(pct(arr, 0.5))} · p90 ${fmt(pct(arr, 0.9))}`);
  }
  const t0 = seasonTotals[0].reduce((a, b) => a + b, 0);
  const tN = seasonTotals[SEASONS].reduce((a, b) => a + b, 0);
  console.log(`  total-ratio sæson ${SEASONS}/0 = ×${(tN / t0).toFixed(2)}  (≫ befolknings-vækst = inflations-flag)`);

  console.log("\n── (3) Symmetri — aldrende (start ≥32å) værdi-ændring ──");
  console.log(`  Δbase_value: p10 ${fmt(pct(agingDelta, 0.1))} · median ${fmt(pct(agingDelta, 0.5))} · p90 ${fmt(pct(agingDelta, 0.9))}  → ${pct(agingDelta, 0.5) < 0 ? "✅ daler" : "⚠️ stiger"}`);

  console.log("\nNote: P&L-vinduet forenkler (holdt hele sim-vinduet). Ejer vurderer om median-P&L + inflations-ratio er acceptable før flag-flip.");
}

main();
```

- [ ] **Step 2: Run the scorecard**

Run: `node backend/scripts/valueDevelopSellScorecard.js --seasons=4`
Expected: prints the three sections, exit 0. Capture the output for owner review. (If `developRiderSeason`/`buildCaps` signatures differ from the usage above, read `backend/lib/riderProgression.js` and adapt the calls — they are also used in `backend/scripts/previewRiderProgression.js`, which is the reference.)

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/valueDevelopSellScorecard.js
git commit -m "feat(value): #1364 udvikl-og-saelg sim-scorecard (balance-gate, ingen DB)"
```

---

## Task 4: Full gate + PR (owner approves scorecard before ship)

- [ ] **Step 1: Full local CI gate**

Run:
```
pwsh -File scripts/verify-local.ps1
cd frontend; npm run lint; cd ..
node scripts/i18n-check-leaks.mjs
node scripts/tone-check-em-dash.mjs
node scripts/check-eslint-warning-budget.mjs
```
Expected: all green. (No new player-facing strings; no i18n keys; no migration.)

- [ ] **Step 2: Patch notes / FEATURE_STATUS**

- Patch notes: NOT required — no player-visible change pre-relaunch (mechanic is dormant until `daily_training_enabled` is on at relaunch). State the rationale in the PR body.
- FEATURE_STATUS.md: add one line under "Beta or feature-flagged" noting `base_value` now tracks developed abilities (rides on daily-training/relaunch gating).

- [ ] **Step 3: Open PR**

```bash
git push -u origin feat/1364-value-tracks-abilities
gh pr create --base main --title "feat: rytterværdi følger udviklede evner (#1364)" --body "<Summary + Brugerverifikation + scorecard-output pasted + 'no migration; ship gated on owner-approved scorecard' note>"
```
PR body MUST include a **Brugerverifikation** section. Paste the Task 3 scorecard output into the PR so the owner can approve the balance. Note: **no migration**, so this is mergeable once the owner approves the scorecard; ship/flag-flip is the relaunch.

---

## Self-Review

**Spec coverage:** §2 Model 1 + recompute → Task 1 (`recomputeRiderValue` rounds; `predictBaseValue` of current abilities). §2 A+B blend → Task 1 (`selectChangedValueUpdates` writes only changed = the "A" effect; full scan = the "B" sweep) + Task 2 (post-sweep full + run-today scoped). §3.3 safety-net reconcile → covered by the daily full refresh (noted: the daily post-sweep full refresh IS the reconcile; no separate season-tick job — simpler, equivalent). §4 #1281 separation → Task 1/2 touch only base_value+type, no market-premium component. §5 sim scorecard → Task 3 (P&L + inflation + symmetry). §6 no flag/migration → confirmed; dormant pre-relaunch. §8 testing → Task 1 unit + Task 2 sweep test + Task 3 runnable sim.

**Placeholder scan:** No TBD/TODO. Task 2 Step 1 + Task 3 Step 2 note "adapt to existing helper/signatures" — these are concrete verification instructions against named reference files (`trainingSweep.test.js`, `riderProgression.js`/`previewRiderProgression.js`), not logic gaps.

**Type consistency:** `recomputeRiderValue(riderRow, abilities, baseline, model) → {primary_type, secondary_type, base_value}` used identically in `selectChangedValueUpdates` and tests. `refreshChangedRiderValues(supabase, {baseline, model, log, teamId}) → {scanned, changed, written}` — same signature at both call sites (Task 2). `bv(type, abilities)` helper consistent in Task 3. `developRiderSeason`/`buildCaps` usage mirrors `previewRiderProgression.js`.
