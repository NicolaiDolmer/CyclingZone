# Feature-aware breakaway (Fase 1) Implementation Plan — #1021

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat per-profile breakaway bonus with a finale-gradient-aware model so breakaways win realistically per stage type (hilly + mountain-descent high, summit finishes ~0), grounded in verified real-world data.

**Architecture:** Drive `maxBonus` off `(profile_type, finale_type)` instead of `profile_type` alone. `finale_type` (already emitted by the stage generator + present on every `stageProfile`) is the proxy for the dominant real-world feature — finish gradient. No DB migration, no route data. Expand finale variety in the generator (hilly/cobbles get breakaway-friendly finales; high_mountain occasionally finishes on a descent = the "long mountain day, not a summit finish" case). Re-tune the bonus table + escapee-win-share bands empirically in `race:gate` across seeds (simulate-before-ship).

**Tech Stack:** Node.js (ESM), `node --test`, deterministic seeded RNG (mulberry32). Pure functions, no DB/fs in the engine.

**Locked decisions (owner, 2026-06-16):**
- **Definition:** a breakaway win = a rider who was in the *early* break and stayed away (`components.breakaway > 0`). An attack from the favourites group is **offensive riding, not a breakaway** → must NOT count. This is already exactly what the engine measures — preserve it as an invariant.
- **Scope (Fase 1 = "A"):** terrain/finale-features only, keep the 1–3-escapee model.
- **Cut to Fase 2 (honest):** (1) `km_from_last_climb` — not derivable from generated races (no route geometry); finale_type captures the #1 feature (gradient), km-from-last-climb is #2 and is deferred. (2) **variable break size + collective pace/rotation** (real-world #2 factor overall; 16+ riders → 77%). Both tracked as **#1021 Fase 2** below.

---

## Real-world target bands (verified, corrected to the owner's definition)

Escapee-win-share = share of stages of that type won by an early-break rider. Frontier Economics = high confidence (TdF 27% overall / 2.5% per rider / 16+ riders 77%); per-terrain absolutes lean on a single blog (medium); rolling + cobbles unsourced (low).

| Terrain | Real band | Engine now | Verdict |
|---|---|---|---|
| flat | 2–5% | ~2–6% | keep |
| rolling | 6–12% | ~6–9% | keep, raise floor |
| hilly | 25–40% | **0** | must become non-zero (biggest fix) |
| mountain, descent/flat finale | 35–50% | ~10% | far too low |
| mountain/high_mountain, summit finale | 0–5% | 0 | correct (favourites decide) |
| high_mountain, non-summit day | 30–40% | 0 | missing case |
| cobbles | 5–12% (unsourced) | 0 | small non-zero |

Numbers are **calibration candidates**, finalised in Task 5's gate loop.

---

## File structure

- `backend/lib/raceSimulator.js` — replace `BREAKAWAY_PROFILES` map with `BREAKAWAY_BONUS` 2D table + `breakawayMaxBonus(profileType, finaleType)`; thread `finaleType` into `selectBreakawayBonuses`; pass `stageProfile.finale_type` at the call site. One responsibility: the breakaway bonus model.
- `backend/lib/raceBreakaway.test.js` — extend with the finale-gradient cases.
- `backend/lib/raceStageProfileGenerator.js` — expand `FINALE_BY_PROFILE` (hilly/cobbles already breakaway-capable; add `descent` to `high_mountain`; add `breakaway` finale option to `mountain`); export `finaleFor` for the dry-run.
- `backend/lib/raceStageProfileGenerator.test.js` — assert the new finale options can occur.
- `backend/scripts/simulateSeasonDryRun.js` — sample a `finale_type` per race so the model fires; add a finale-split measurement (mountain/high_mountain: summit vs descent); recalibrated `BREAKAWAY_TARGETS` bands.
- `docs/decisions/race-engine-v2-plan2-calibration-log.md` (branch) / a new `docs/decisions/2026-06-16-breakaway-feature-aware-log.md` — record the gate-green constants + bands.

**No DB migration expected.** Task 0 verifies whether `race_stage_profiles` persists `finale_type` and whether a re-backfill is needed for already-seeded races (relaunch generates fresh profiles regardless).

---

### Task 0: Setup + invariant baseline

**Files:** none modified (investigation + baseline).

- [ ] **Step 1: Create the worktree** (via superpowers:using-git-worktrees) off `origin/main` for branch `feat/1021-breakaway-feature-aware`. Run `npm ci` in `backend/`.

- [ ] **Step 2: Confirm finale_type persistence + migration question**

Run: `git grep -n "finale_type" backend/ database/`
Expected: confirm whether `race_stage_profiles` has a `finale_type` column and whether `backfillRaceStageProfiles.js` writes it. Record the answer in the plan. If a column is missing AND persisted profiles are read at sim time → migration needed (owner merges); if profiles are generated fresh at relaunch → no migration.

- [ ] **Step 3: Capture the current gate baseline**

Run: `cd backend && npm run race:gate`
Then the cross-seed checks the calibration log documents: `node scripts/simulateSeasonDryRun.js --enforce-targets --enforce-liveness --no-html --seed=7` and `--seed=42`, plus `npm run race:gate:condition` and `npm run race:gate:roles`.
Expected: record the current born-as scorecard + breakaway bands per seed. This is the regression baseline — born-as targets, sprinter-90%-flat, roles deltas, and liveness must still hold after the change.

---

### Task 1: `breakawayMaxBonus(profileType, finaleType)` model

**Files:**
- Modify: `backend/lib/raceSimulator.js:193` (replace `BREAKAWAY_PROFILES`)
- Test: `backend/lib/raceBreakaway.test.js`

- [ ] **Step 1: Write the failing tests** (gradient behaviour — the load-bearing cases)

```js
import { breakawayMaxBonus } from "./raceSimulator.js";

test("summit finale suppresses the break (favourites decide)", () => {
  assert.ok(breakawayMaxBonus("mountain", "long_climb") <= 0.08);
  assert.ok(breakawayMaxBonus("high_mountain", "long_climb") <= 0.08);
});
test("descent finale protects the break", () => {
  assert.ok(breakawayMaxBonus("mountain", "descent") >= 0.40);
  assert.ok(breakawayMaxBonus("high_mountain", "descent") >= 0.30);
});
test("hilly is breakaway-friendly (was hard 0)", () => {
  assert.ok(breakawayMaxBonus("hilly", "punch") >= 0.30);
});
test("flat stays low; itt/ttt have no break", () => {
  assert.ok(breakawayMaxBonus("flat", "bunch_sprint") <= 0.32);
  assert.equal(breakawayMaxBonus("itt", "solo_tt"), 0);
  assert.equal(breakawayMaxBonus("ttt", "solo_tt"), 0);
});
test("unknown profile/finale degrades to the profile default, then 0", () => {
  assert.equal(breakawayMaxBonus("nonsense", "whatever"), 0);
  assert.ok(breakawayMaxBonus("mountain", undefined) > 0); // _default path
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && node --test lib/raceBreakaway.test.js`
Expected: FAIL — `breakawayMaxBonus is not a function`.

- [ ] **Step 3: Implement the model** (replace the `BREAKAWAY_PROFILES` const at `raceSimulator.js:193`)

```js
// Udbruds-bonus pr. (profil, finale). finale_type = proxy for finale-gradient
// (#1021 Fase 1, grundet i virkelige data 2026-06-16). summit/long_climb →
// favoritterne afgør (~0); descent/flad efter sidste stigning → udbruddet holder.
// KANDIDAT-værdier — tunes i race:gate (Task 5). itt/ttt/classic: intet udbrud.
export const BREAKAWAY_BONUS = Object.freeze({
  flat:          Object.freeze({ bunch_sprint: 0.30, reduced_sprint: 0.34, breakaway: 0.40, _default: 0.30 }),
  rolling:       Object.freeze({ breakaway: 0.30, reduced_sprint: 0.24, bunch_sprint: 0.18, _default: 0.22 }),
  hilly:         Object.freeze({ punch: 0.42, reduced_sprint: 0.40, breakaway: 0.46, _default: 0.42 }),
  mountain:      Object.freeze({ descent: 0.50, breakaway: 0.50, long_climb: 0.06, _default: 0.45 }),
  high_mountain: Object.freeze({ descent: 0.42, long_climb: 0.05, _default: 0.08 }),
  cobbles:       Object.freeze({ reduced_sprint: 0.22, breakaway: 0.28, _default: 0.20 }),
});

// → maxBonus for en (profil, finale). Manglende finale → profilens _default.
// Manglende profil → 0 (itt/ttt/classic + ukendte). Holder den frosne
// selectBreakawayBonuses-kontrakt: returnerer en skalar, ikke en ny mekanik.
export function breakawayMaxBonus(profileType, finaleType) {
  const p = BREAKAWAY_BONUS[profileType];
  if (!p) return 0;
  const v = (finaleType != null && finaleType in p) ? p[finaleType] : p._default;
  return Number.isFinite(v) ? v : 0;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && node --test lib/raceBreakaway.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceSimulator.js backend/lib/raceBreakaway.test.js
git commit -F - <<'MSG'
feat(race): finale-gradient-aware breakaway bonus model (#1021 Fase 1)

Replace flat BREAKAWAY_PROFILES with breakawayMaxBonus(profile, finale).
summit finales suppress the break (~0); descent/hilly protect it.
Candidate values; tuned in race:gate (Task 5).
MSG
```

(Use `git commit -F` with a file per the project's no-heredoc rule when running through the Bash tool — write the message to a temp file first.)

---

### Task 2: Thread `finale_type` into the breakaway selection

**Files:**
- Modify: `backend/lib/raceSimulator.js` — `selectBreakawayBonuses` signature + call site (`:210`, `:305`)
- Test: `backend/lib/raceBreakaway.test.js`

- [ ] **Step 1: Write the failing test** (same terrain, opposite finale → opposite break outcome)

```js
import { simulateStage } from "./raceSimulator.js";

function fieldOf(n) {
  return Array.from({ length: n }, (_, i) => ({
    rider_id: `r${String(i).padStart(3, "0")}`,
    abilities: { climbing: 50 + (i % 40), endurance: 50, tempo: 50, randomness: 0 },
  }));
}
const demand = { climbing: 0.5, tempo: 0.12, endurance: 0.14, randomness: 0.1 };

test("mountain descent finale yields more escapee wins than a summit finale", () => {
  let descentBreak = 0, summitBreak = 0;
  for (let s = 0; s < 200; s++) {
    const entrants = fieldOf(60);
    const d = simulateStage({ entrants, stageProfile: { profile_type: "mountain", finale_type: "descent", demand_vector: demand }, seed: s + 1 });
    const m = simulateStage({ entrants, stageProfile: { profile_type: "mountain", finale_type: "long_climb", demand_vector: demand }, seed: s + 1 });
    if ((d.ranked[0].components.breakaway || 0) > 0) descentBreak++;
    if ((m.ranked[0].components.breakaway || 0) > 0) summitBreak++;
  }
  assert.ok(descentBreak > summitBreak, `descent ${descentBreak} should beat summit ${summitBreak}`);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && node --test lib/raceBreakaway.test.js`
Expected: FAIL — selection still ignores finale (both equal).

- [ ] **Step 3: Implement — accept + use `finaleType`**

In `selectBreakawayBonuses` (`raceSimulator.js:210`), change the signature and the `maxBonus` lookup:

```js
function selectBreakawayBonuses({ ordered, terrainById, profileType, finaleType, seed }) {
  const bonuses = new Map();
  const maxBonus = breakawayMaxBonus(profileType, finaleType);
  if (!maxBonus || ordered.length < 4) return bonuses;
  // ... rest unchanged ...
```

At the call site in `simulateStage` (`raceSimulator.js:305`):

```js
  const breakawayById = selectBreakawayBonuses({
    ordered, terrainById, profileType, finaleType: stageProfile.finale_type, seed,
  });
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && node --test lib/raceBreakaway.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full simulator suite (no regressions in the frozen contract)**

Run: `cd backend && node --test lib/raceSimulator.test.js lib/raceRunner.test.js lib/raceBreakaway.test.js`
Expected: PASS. Determinism + score-assembly unchanged for non-breakaway terrains (itt/ttt return empty bonus map → bit-identical).

- [ ] **Step 6: Commit**

```bash
git add backend/lib/raceSimulator.js backend/lib/raceBreakaway.test.js
git commit -F .git/COMMIT_MSG_TMP   # message: "feat(race): selectBreakawayBonuses reads stage finale_type (#1021)"
```

---

### Task 3: Generator finale variety

**Files:**
- Modify: `backend/lib/raceStageProfileGenerator.js` — `FINALE_BY_PROFILE` (`:59`) + export `finaleFor`
- Test: `backend/lib/raceStageProfileGenerator.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { generateRaceStageProfiles, finaleFor } from "./raceStageProfileGenerator.js";
import { makeRng } from "./fictionalRiderGenerator.js";

test("high_mountain can finish on a descent (non-summit day), not only long_climb", () => {
  const seen = new Set();
  for (let s = 0; s < 300; s++) seen.add(finaleFor(makeRng(s + 1), "high_mountain"));
  assert.ok(seen.has("long_climb"));
  assert.ok(seen.has("descent"), "high_mountain must sometimes finish on a descent");
});
test("finaleFor is exported and deterministic", () => {
  assert.equal(finaleFor(makeRng(42), "flat"), finaleFor(makeRng(42), "flat"));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && node --test lib/raceStageProfileGenerator.test.js`
Expected: FAIL — `finaleFor` not exported / high_mountain never descent.

- [ ] **Step 3: Implement**

Add `export` to `finaleFor` (`raceStageProfileGenerator.js:122`). Extend `FINALE_BY_PROFILE` (`:59`):

```js
const FINALE_BY_PROFILE = Object.freeze({
  flat:          ["bunch_sprint", "reduced_sprint"],
  rolling:       ["breakaway", "reduced_sprint", "bunch_sprint"],
  hilly:         ["punch", "reduced_sprint", "breakaway"],
  mountain:      ["long_climb", "descent", "breakaway"],
  high_mountain: ["long_climb", "long_climb", "descent"], // weighted toward summit; sometimes a non-summit day
  itt:           ["solo_tt"],
  ttt:           ["solo_tt"],
  cobbles:       ["reduced_sprint", "breakaway"],
  classic:       ["punch", "reduced_sprint", "long_climb"],
});
```

Note: `finaleFor` already weights the first option ~60%, so high_mountain stays summit-dominant. The duplicated `long_climb` keeps summit the default while letting `descent` occur in the ~40% "other" branch occasionally.

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && node --test lib/raceStageProfileGenerator.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceStageProfileGenerator.js backend/lib/raceStageProfileGenerator.test.js
git commit -F .git/COMMIT_MSG_TMP   # "feat(race): finale variety — hilly/cobbles/high_mountain breakaway + non-summit days (#1021)"
```

---

### Task 4: Dry-run fires the model + recalibrated bands + finale split

**Files:**
- Modify: `backend/scripts/simulateSeasonDryRun.js` — `BREAKAWAY_TARGETS` (`:131`), the per-terrain race loop (`:317-329`), add finale-split measurement.

- [ ] **Step 1: Sample a finale per race so the model fires**

In the per-terrain loop (`:317`), import `finaleFor` and set the finale per race so `simulateStage` receives it:

```js
import { DEMAND_VECTORS, finaleFor } from "../lib/raceStageProfileGenerator.js";
// ...
const finaleType = finaleFor(rng, terrain);
const { ranked } = simulateStage({
  entrants,
  stageProfile: { profile_type: terrain, finale_type: finaleType, demand_vector: demand },
  seed: raceSeed,
});
```

Apply the same `finale_type` to the neutral-twin `simulateStage` call (`:350`) so the roles comparison stays apples-to-apples.

- [ ] **Step 2: Recalibrate `BREAKAWAY_TARGETS` (`:131`) to the verified bands**

```js
const BREAKAWAY_TARGETS = {
  flat:          { min: 0.01, max: 0.07 },
  rolling:       { min: 0.04, max: 0.15 },
  hilly:         { min: 0.18, max: 0.45 },   // was 0 — verified break-friendly
  mountain:      { min: 0.15, max: 0.50 },   // wide: mixes summit (~0) + descent (~40%)
  high_mountain: { min: 0.00, max: 0.15 },   // summit-dominant; small non-zero from descent days
  cobbles:       { min: 0.02, max: 0.15 },   // unsourced — wide, low-confidence band
};
```

- [ ] **Step 3: Add a finale-split read for the bimodal terrains**

After the per-terrain loop, log mountain/high_mountain escapee-share split by finale (summit `long_climb` vs `descent`) so the bimodality is visible and verifiable. Accumulate `breakawayWinCount` keyed by `finaleType` inside the loop; print `mountain summit X% / descent Y%`. This is a **report-only diagnostic** (not a hard band) — it tells the calibrator whether the gradient split is working before trusting the aggregate band.

- [ ] **Step 4: Run the gate (report-only first)**

Run: `cd backend && node scripts/simulateSeasonDryRun.js --no-html --seed=2026`
Expected: breakaway bands print per terrain; hilly + mountain-descent now non-zero; the finale split shows summit ≪ descent. Born-as scorecard still printed.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/simulateSeasonDryRun.js
git commit -F .git/COMMIT_MSG_TMP   # "feat(race): dry-run fires finale-aware breakaway + recalibrated bands + finale split (#1021)"
```

---

### Task 5: Calibration loop (simulate-before-ship) — the empirical core

**Files:** `backend/lib/raceSimulator.js` (`BREAKAWAY_BONUS`), `backend/scripts/simulateSeasonDryRun.js` (`BREAKAWAY_TARGETS`) — tune constants only.

This task is empirical, not fixed-code. Acceptance = **all bands green across all seeds, AND no regression** in the born-as scorecard / sprinter-90%-flat / roles deltas / liveness.

- [ ] **Step 1: Enforce + run the full seed matrix**

```bash
cd backend
npm run race:gate                                                            # seed 2026, enforce
node scripts/simulateSeasonDryRun.js --enforce-targets --enforce-liveness --no-html --seed=7
node scripts/simulateSeasonDryRun.js --enforce-targets --enforce-liveness --no-html --seed=42
npm run race:gate:condition
npm run race:gate:roles
```

- [ ] **Step 2: Tune toward the bands**

If a breakaway band fails: adjust the relevant `BREAKAWAY_BONUS[profile][finale]` value (bonus must be comparable to the field SPREAD ~0.33–0.55, not the noise scale — see the 2026-06-12 calibration log). Re-run. **Loop-guard: 2 failed tuning rounds on the same symptom → STOP, write the finding, ask the owner** (per the project's symptom-patching-loop rule).

- [ ] **Step 3: Verify no born-as regression**

The breakaway winners must not break the mountain born-as target (`gc+climber+baroudeur ≥85%`) or the flat `sprinter ≥90%`. If raising hilly/mountain breaks pushes an off-type into the winners, the terrain-rank filter + aggression weighting should bias the break toward terrain-suitable riders — confirm in the scorecard. If it doesn't, that is a real finding for the owner (it may mean the born-as target itself needs a breakaway-aware reframing).

- [ ] **Step 4: Record the green constants**

Write the final `BREAKAWAY_BONUS` + `BREAKAWAY_TARGETS` + per-seed measured shares into `docs/decisions/2026-06-16-breakaway-feature-aware-log.md` (mirroring the existing calibration-log format).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceSimulator.js backend/scripts/simulateSeasonDryRun.js docs/decisions/2026-06-16-breakaway-feature-aware-log.md
git commit -F .git/COMMIT_MSG_TMP   # "feat(race): breakaway calibration green across seeds (#1021 Fase 1)"
```

---

### Task 6: Full CI gate + docs + close-out

- [ ] **Step 1: Run the project's full pre-PR gate**

Run: `pwsh -File scripts/verify-local.ps1` (backend + frontend tests + build), then `cd backend && node --test` (all backend tests). Frontend is untouched → backend-only label applies.

- [ ] **Step 2: Patch notes decision**

Breakaway realism is engine-internal but changes observable race outcomes. Add a short `PatchNotesPage.jsx` entry (EN+DA) — "more realistic breakaways: escapes now win on hilly + mountain-descent stages, summit finishes go to the favourites" — OR write in the PR why not (e.g. gated behind relaunch). Same for `help.json` if breakaway behaviour is documented for players.

- [ ] **Step 3: PR with Brugerverifikation section**

Open a PR `Refs #1021`, body includes a **Brugerverifikation** section (or `backend-only` label) per the PR-check rule. **No DB migration → standard auto-merge eligible** (confirm Task 0 Step 2 found no migration; if one exists, owner merges).

- [ ] **Step 4: Update `docs/NOW.md`** — close-out: reset Working agent, set Next action; note Fase 2 sequenced on #1021.

---

## Fase 2 (B) — sequenced, not deferred-vaguely

**Committed scope on #1021. Trigger: Fase 1 verified-stable AND the ability/specialisation rework (#1122) landed** (because break composition only matters once abilities are meaningful).

1. **Variable break size + collective pace.** Real-world #2 factor: 16+ riders → 77%, +~3.1pp per added rider, ceiling ~9–10. Requires a field-wide break-formation model (size sampled from terrain + a synthetic "how many want to go"), and a collective-pace term feeding the chase math. Replaces the fixed 1–3-escapee cap.
2. **`km_from_last_climb` + chase-incentive as first-class features** once stages carry richer route structure (selection point → finish distance). This sharpens the descent-finish protection beyond the binary finale proxy.
3. **Re-ground bands** against a summit-finish-vs-descent split sourced specifically (the current data lumps medium/high mountain).

**Standard:** the engine target is "believable to a knowledgeable cycling fan." Fase 2 is where break-vs-bunch tension becomes emergent rather than a per-stage scalar — the differentiator this pillar is meant to be known for.

---

## Self-review

- **Spec coverage:** finale-gradient model (Task 1), finale threading (Task 2), generator variety incl. non-summit high-mountain (Task 3), dry-run firing + bands + split (Task 4), empirical calibration (Task 5), gate + docs (Task 6), Fase 2 sequenced. ✓
- **Definition invariant** (`components.breakaway > 0`; favourite attacks excluded) preserved — the model only changes the *magnitude*, never reclassifies favourite wins as breaks. ✓
- **No-migration claim** is gated behind Task 0 Step 2 verification, not assumed. ✓
- **Calibration values** are labelled candidates tuned in the gate, not presented as final — honest about the empirical step. ✓
- **Type consistency:** `breakawayMaxBonus(profileType, finaleType)` used identically in Task 1 (def), Task 2 (call), Task 5 (tune). `finaleFor` exported in Task 3, consumed in Task 4. ✓
