# Resultater V2 slice 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the full running standings (GC/points/mountain/youth/teams) visible after every stage of an in-progress stage race, with a team filter, top-10/show-all, and per-stage points display — plus fix the alphabetical race-results list so players can find "what I raced today."

**Architecture:** Backend adds one new persisted `result_type` (`team_day`) so the Teams classification has real per-stage data, matching the existing `leader`/`points_day`/`mountain_day`/`young_day` pattern (two call sites in `backend/lib/raceRunner.js` share one row-builder). Frontend adds a pure, unit-tested selector (`classificationRowsForStage`) that picks the right rows for "etape N × classification key" (day-type row if the race hasn't finished that far, final-type row if it has), then wires it into `RaceDetailPage.jsx`'s per-stage tab as a small classification sub-tab strip, plus a team filter and top-10/show-all built into the shared `ResultTable`. Section C (findability) reuses two already-tested helpers (`sortRacesByDateDesc`, `racesForPool`) that are already proven on the calendar tab, applying them to the library tab.

**Tech Stack:** Node.js/Express backend (`backend/lib/raceRunner.js`, `raceClassifications.js`), Postgres migration, React frontend (`frontend/src/pages/RaceDetailPage.jsx`, `RacesPage.jsx`), `node --test` for both backend and frontend unit tests, i18n via `react-i18next` (`frontend/public/locales/{en,da}/races.json`).

**Reference spec:** `docs/superpowers/specs/2026-07-05-resultater-v2-slice1-design.md`
**Issue:** [#2081](https://github.com/NicolaiDolmer/CyclingZone/issues/2081)

---

## Phase 1 — Backend: persist `team_day` (running team classification per mid-stage)

### Task 1: Migration — allow `team_day` in the `result_type` CHECK constraint

**Files:**
- Create: `database/2026-07-05-team-day-result-type.sql`

- [ ] **Step 1: Write the migration**

```sql
-- #2081: løbende hold-klassement pr. mellem-etape (team_day), parallelt med
-- leader/points_day/mountain_day/young_day. Uden denne værdi har Teams-fanen
-- ingen persisterede data for etaper FØR sidste (frontend deriverer i dag fra
-- GC-gaps som fallback for legacy-løb uden team_day-rækker, raceLiveStandings.js).
DO $$ BEGIN
  ALTER TABLE public.race_results DROP CONSTRAINT IF EXISTS race_results_result_type_check;
  ALTER TABLE public.race_results
    ADD CONSTRAINT race_results_result_type_check
    CHECK (result_type IN (
      'stage', 'gc', 'points', 'mountain', 'young', 'team', 'leader',
      'mountain_day', 'points_day', 'young_day', 'team_day'
    ));
END $$;
```

- [ ] **Step 2: Apply the migration to the Supabase project**

Use the Supabase MCP `apply_migration` tool (name: `team_day_result_type`) with the SQL above, or run it via the project's normal migration-apply path. Verify with `list_migrations` that it's applied.

- [ ] **Step 3: Commit**

```bash
git add database/2026-07-05-team-day-result-type.sql
git commit -m "feat(db): allow team_day result_type for running team classification (#2081)"
```

---

### Task 2: Parametrize `pushTeam` to accept `result_type`

**Files:**
- Modify: `backend/lib/raceRunner.js:109-126`
- Test: `backend/lib/raceRunner.test.js`

- [ ] **Step 1: Write the failing test**

Add to `backend/lib/raceRunner.test.js`, after the `ALLOWED_RESULT_TYPES` set (line 15-18), add `"team_day"` to the set:

```js
const ALLOWED_RESULT_TYPES = new Set([
  "stage", "gc", "points", "mountain", "young", "team",
  "leader", "mountain_day", "points_day", "young_day", "team_day",
]);
```

Then add a new test after the existing `"etapeløb: emission — stage hver etape, FULDE dag-klassementer mellem (#2081), fulde trøjer til sidst"` test (which ends at line 96):

```js
test("etapeløb: team_day emitteres på mellem-etaper (#2081), ikke på slut-etapen", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const teamDay = rowsBy(resultRows, "team_day");
  assert.equal(teamDay.length, 2 * 2, "2 hold × 2 mellem-etaper");
  for (const stage of [1, 2]) {
    const ranks = teamDay.filter((r) => r.stage_number === stage).map((r) => r.rank).sort();
    assert.deepEqual(ranks, [1, 2]);
  }
  // Payout-neutral: POINTS-lookup har intet team_day__N-opslag → altid 0.
  for (const r of teamDay) {
    assert.equal(r.points_earned, 0);
    assert.equal(r.prize_money, 0);
  }
  assert.ok(rowsBy(resultRows, "team_day").every((r) => r.stage_number !== 3), "ingen team_day på slut-etapen");
  // Slut-etapens 'team'-rækker er uændrede (2 hold).
  assert.equal(rowsBy(resultRows, "team").length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test lib/raceRunner.test.js`
Expected: FAIL — `teamDay.length` is 0 (no `team_day` rows exist yet).

- [ ] **Step 3: Parametrize `pushTeam`**

In `backend/lib/raceRunner.js`, replace lines 109-126:

```js
  const pushTeam = ({ rank, team_id, stage_number }) => {
    const pts = pointsLookup[`team__${rank}`] || 0;
    resultRows.push({
      race_id: race.id,
      stage_number,
      result_type: "team",
      rank,
      rider_id: null,
      rider_name: null,
      team_id,
      team_name: teamNameByTeam.get(team_id) ?? null,
      finish_time: null,
      points_earned: pts,
      prize_money: pts * PRIZE_PER_POINT,
      in_breakaway: false,
      breakaway_caught: false,
    });
  };
```

with:

```js
  const pushTeam = ({ rank, team_id, stage_number, result_type = "team" }) => {
    const pts = pointsLookup[`${result_type}__${rank}`] || 0;
    resultRows.push({
      race_id: race.id,
      stage_number,
      result_type,
      rank,
      rider_id: null,
      rider_name: null,
      team_id,
      team_name: teamNameByTeam.get(team_id) ?? null,
      finish_time: null,
      points_earned: pts,
      prize_money: pts * PRIZE_PER_POINT,
      in_breakaway: false,
      breakaway_caught: false,
    });
  };
```

(The two existing call sites — `buildRaceResults`'s one-day branch at line 235 and final-stage branch at line 265 — don't pass `result_type`, so they keep emitting `"team"` unchanged.)

- [ ] **Step 4: Emit `team_day` on mid-stage in `buildRaceResults`**

In `backend/lib/raceRunner.js`, inside the `if (!isFinal) { ... }` block (lines 244-255), add one line after the `young_day` loop:

```js
    if (!isFinal) {
      // Mellem-etape (#2081): FULDE løbende klassementer under dag-typerne — rank 1
      // beholder "holder trøjen"-pointet (race_points har KUN rank 1 for dag-typerne);
      // rank 2+ har intet opslag → points_earned 0, også under rederiveSeasonRacePoints.
      // leader-rækker bærer GC-gap (display af løbende samlet stilling).
      const young = rankByCumTimeAsc(entrants.filter((e) => e.is_u25), cumTime, posSum);
      const pointsCls = rankByCompDesc(entrants, pointsComp);
      const komCls = rankByCompDesc(entrants, komComp);
      for (const g of gc) pushIndiv({ result_type: "leader", rank: g.rank, rider_id: g.rider_id, stage_number: stageNumber, finish_time: gcFinish(g) });
      for (const p of pointsCls) pushIndiv({ result_type: "points_day", rank: p.rank, rider_id: p.rider_id, stage_number: stageNumber });
      for (const k of komCls) pushIndiv({ result_type: "mountain_day", rank: k.rank, rider_id: k.rider_id, stage_number: stageNumber });
      for (const y of young) pushIndiv({ result_type: "young_day", rank: y.rank, rider_id: y.rider_id, stage_number: stageNumber });
      for (const t of teamClassification(entrants, cumTime)) pushTeam({ rank: t.rank, team_id: t.team_id, stage_number: stageNumber, result_type: "team_day" });
    } else {
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && node --test lib/raceRunner.test.js`
Expected: PASS (all tests, including the new one).

- [ ] **Step 6: Commit**

```bash
git add backend/lib/raceRunner.js backend/lib/raceRunner.test.js
git commit -m "feat(race-engine): persist team_day per mid-stage (whole-race path, #2081)"
```

---

### Task 3: Emit `team_day` in the live stage-by-stage path (`buildStageRowsAccumulated`)

This is the path actually used in production (`simulateStageByIndex`, called by the scheduler). Task 2 only covered `buildRaceResults` (the legacy whole-race-in-one-call path, still used for admin full-sim/dry-run and one-day races).

**Files:**
- Modify: `backend/lib/raceRunner.js:1007-1013`
- Test: `backend/lib/raceRunnerStage.test.js`

- [ ] **Step 1: Write the failing test**

Add to `backend/lib/raceRunnerStage.test.js`, immediately after the existing test `"#2072: klassementer på mellem-etape = akkumulering af persisterede gaps + dagens etape"` (which ends at line 214 with `});`):

```js
test("#2081: team_day emitteres på mellem-etape (stage-by-stage-stien), ikke 'team'", async () => {
  const prior = [
    stageRow(1, "b4", 1, "+0:00"),
    stageRow(1, "climber", 2, "+0:10"),
    stageRow(1, "sprinter", 3, "+5:00"),
    stageRow(1, "a3", 4, "+5:00"),
    stageRow(1, "a4", 5, "+5:00"),
    stageRow(1, "b1", 6, "+5:00"),
    stageRow(1, "b2", 7, "+5:00"),
    stageRow(1, "b3", 8, "+5:00"),
  ];
  const race = { ...STAGE_RACE, stages_completed: 1 };
  const supabase = cannedFor(race, STAGES_3, { race_results: prior });
  const cap = captureStageResult();
  await simulateStageByIndex({
    supabase, race, stageIndex: 1, // etape 2 (mellem-etape)
    ...NOOP_DEPS,
    applyStageResult: cap.applyStageResult,
  });
  const rows = cap.rows();
  const teamDay = rows.filter((r) => r.result_type === "team_day");
  assert.equal(teamDay.length, 2, "2 hold (A, B)");
  assert.deepEqual(teamDay.map((r) => r.rank).sort(), [1, 2]);
  assert.ok(teamDay.every((r) => r.stage_number === 2), "team_day bærer dagens stage_number");
  assert.ok(!rows.some((r) => r.result_type === "team"), "mellem-etape må stadig ikke skrive 'team'-rækker");
  for (const r of teamDay) {
    assert.equal(r.points_earned, 0, "cannedFor har tom race_points → 0 point");
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test lib/raceRunnerStage.test.js`
Expected: FAIL — `teamDay.length` is 0.

- [ ] **Step 3: Emit `team_day` in `buildStageRowsAccumulated`**

In `backend/lib/raceRunner.js`, inside `buildStageRowsAccumulated`'s `if (!isFinal) { ... }` block (lines 1007-1013), add one line:

```js
  if (!isFinal) {
    // Mellem-etape (#2081): fulde løbende klassementer under dag-typerne (se
    // buildRaceResults for payout-noten: kun rank 1 har race_points-opslag).
    for (const g of gc) pushIndiv({ result_type: "leader", rank: g.rank, rider_id: g.rider_id, stage_number: stageNumber, finish_time: gcFinish(g) });
    for (const p of pointsCls) pushIndiv({ result_type: "points_day", rank: p.rank, rider_id: p.rider_id, stage_number: stageNumber });
    for (const k of komCls) pushIndiv({ result_type: "mountain_day", rank: k.rank, rider_id: k.rider_id, stage_number: stageNumber });
    for (const y of young) pushIndiv({ result_type: "young_day", rank: y.rank, rider_id: y.rider_id, stage_number: stageNumber });
    for (const t of teamClassification(classified, acc.cumTime)) pushTeam({ rank: t.rank, team_id: t.team_id, stage_number: stageNumber, result_type: "team_day" });
  } else {
```

Note: `classified` and `acc.cumTime` are already computed above this block (same values the final-stage branch uses at line 1020) — no new computation needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test lib/raceRunnerStage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceRunner.js backend/lib/raceRunnerStage.test.js
git commit -m "feat(race-engine): persist team_day per mid-stage (live stage-by-stage path, #2081)"
```

---

### Task 4: Run the full backend test suite

- [ ] **Step 1: Run all backend tests**

Run: `cd backend && node --test`
Expected: all tests PASS (no regressions in `raceResultsEngine`, `raceClassifications`, or any other consumer of `result_type`).

- [ ] **Step 2: Grep for any other hardcoded result_type allow-lists that need `team_day`**

Run: `cd backend && grep -rn "mountain_day" --include=*.js -l lib/ | grep -v test`

Check each file returned — if any other allow-list/enum mirrors `ALLOWED_RESULT_TYPES` (e.g. a Discord embed formatter, a standings re-derivation query), add `"team_day"` there too, and add a one-line assertion to its existing test file if one exists. (If none found beyond `raceRunner.js`/its own tests, no action needed — note this in the task's completion.)

---

## Phase 2 — Frontend: pure per-stage classification selector

### Task 5: `classificationRowsForStage` — pure, unit-tested selector

**Files:**
- Create: `frontend/src/lib/raceStageClassifications.js`
- Test: `frontend/src/lib/raceStageClassifications.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { classificationRowsForStage } from "./raceStageClassifications.js";

function row(result_type, stage_number, rank, rider_id = null, team_id = null) {
  return { id: `${result_type}-${stage_number}-${rank}`, result_type, stage_number, rank, rider_id, team_id, finish_time: null };
}

test("key='stage' returns 'stage' rows for the given stage_number, sorted by rank", () => {
  const results = [row("stage", 2, 2, "b"), row("stage", 1, 1, "z"), row("stage", 2, 1, "a")];
  const out = classificationRowsForStage(results, 2, "stage");
  assert.deepEqual(out.map((r) => r.rider_id), ["a", "b"]);
});

test("key='gc' on a mid-race stage falls back to 'leader' day-type rows", () => {
  const results = [
    row("leader", 2, 1, "a"), row("leader", 2, 2, "b"),
    row("gc", 3, 1, "a"), // final stage 3 — must NOT leak into stage 2's query
  ];
  const out = classificationRowsForStage(results, 2, "gc");
  assert.deepEqual(out.map((r) => r.rider_id), ["a", "b"]);
});

test("key='gc' on the final stage returns the persisted final 'gc' rows, not 'leader'", () => {
  const results = [
    row("leader", 3, 1, "wrong-if-returned"),
    row("gc", 3, 1, "a"), row("gc", 3, 2, "b"),
  ];
  const out = classificationRowsForStage(results, 3, "gc");
  assert.deepEqual(out.map((r) => r.rider_id), ["a", "b"]);
});

test("key='team' on a mid-race stage uses persisted 'team_day' rows when present", () => {
  const results = [row("team_day", 2, 1, null, "A"), row("team_day", 2, 2, null, "B")];
  const out = classificationRowsForStage(results, 2, "team");
  assert.deepEqual(out.map((r) => r.team_id), ["A", "B"]);
});

test("key='team' on a legacy mid-race stage (no team_day rows) derives from 'leader' gaps", () => {
  const results = [
    { ...row("leader", 2, 1, "a", "A"), finish_time: "+0:00" },
    { ...row("leader", 2, 2, "b", "B"), finish_time: "+0:10" },
  ];
  const out = classificationRowsForStage(results, 2, "team");
  assert.deepEqual(out.map((r) => r.team_id), ["A", "B"]);
});

test("no matching rows for the requested stage/key returns an empty array", () => {
  assert.deepEqual(classificationRowsForStage([], 1, "points"), []);
  assert.deepEqual(classificationRowsForStage(undefined, 1, "young"), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/lib/raceStageClassifications.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```js
// #2081 — vælg de rigtige race_results-rækker for "etape N × klassement K" på
// RaceDetailPage's etape-fane. En etape kan have to slags rækker for samme
// klassement: dag-typen (leader/points_day/mountain_day/young_day/team_day,
// skrevet for HVER etape) og fina-typen (gc/points/mountain/young/team, skrevet
// KUN på løbets sidste etape). Reglen: fina-rækker vinder hvis de findes for
// netop denne stage_number (kan kun være sandt for løbets faktiske sidste
// etape); ellers dag-rækkerne. Sådan virker "Overall efter etape 3" ens for et
// igangværende OG et afsluttet løb, uden caller skal vide hvilket.
//
// Hold-fallback: løb kørt FØR #2081 (team_day findes ikke) deriverer holdstil-
// lingen af den etapes 'leader'-rækkers gap, samme regel som raceLiveStandings.js.

import { deriveTeamStandings } from "./raceLiveStandings.js";

const FINAL_TYPE = { gc: "gc", points: "points", mountain: "mountain", young: "young", team: "team" };
const DAY_TYPE = { gc: "leader", points: "points_day", mountain: "mountain_day", young: "young_day", team: "team_day" };

function byRank(a, b) {
  return (a.rank ?? 9999) - (b.rank ?? 9999);
}

function atStage(results, resultType, stageNumber) {
  return (results || []).filter((r) => r.result_type === resultType && (r.stage_number ?? 1) === stageNumber);
}

export function classificationRowsForStage(results, stageNumber, key) {
  if (key === "stage") {
    return atStage(results, "stage", stageNumber).sort(byRank);
  }
  const finalRows = atStage(results, FINAL_TYPE[key], stageNumber);
  if (finalRows.length) return finalRows.sort(byRank);

  if (key === "team") {
    const dayRows = atStage(results, "team_day", stageNumber);
    if (dayRows.length) return dayRows.sort(byRank);
    const leaderRows = atStage(results, "leader", stageNumber).sort(byRank);
    return leaderRows.length ? deriveTeamStandings(leaderRows) : [];
  }

  return atStage(results, DAY_TYPE[key], stageNumber).sort(byRank);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/lib/raceStageClassifications.test.js`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/raceStageClassifications.js frontend/src/lib/raceStageClassifications.test.js
git commit -m "feat(frontend): pure selector for per-stage classification rows (#2081)"
```

---

## Phase 3 — Frontend UI: classification sub-tabs, team filter, top-10/show-all

### Task 6: i18n additions (en + da)

**Files:**
- Modify: `frontend/public/locales/en/races.json`
- Modify: `frontend/public/locales/da/races.json`

- [ ] **Step 1: Add new keys to `frontend/public/locales/en/races.json`**

Inside the `"detail"` object, after the existing `"classification"` block (line 386-392), add a new `"classTab"` block and a `"teamFilter"` block, and inside `"points"` (top-level, line 197-230) — no, `showAll`/`showLess` already exist at `points.showAll`/`points.showLess`; reuse those exact strings for the new collapsible `ResultTable`, but they're namespaced under `points.*`. Add generic top-level copies under `detail` instead so `ResultTable` (used from multiple contexts) doesn't reach into an unrelated namespace:

```json
    "classTab": {
      "stage": "Stage",
      "gc": "Overall",
      "points": "Points",
      "mountain": "Mountain",
      "young": "Youth",
      "team": "Teams"
    },
    "teamFilter": {
      "label": "Team",
      "all": "All teams",
      "mine": "My team"
    },
    "showAll": "Show all {{count}} ↓",
    "showLess": "Hide ↑",
```

Add these as new keys inside the existing `"detail": { ... }` object (anywhere inside its braces, e.g. right after the `"classification"` block that ends at line 392).

- [ ] **Step 2: Add the same keys (Danish) to `frontend/public/locales/da/races.json`**

Open the file, find the `"detail"` object's `"classification"` block (same structure as the English file), and add:

```json
    "classTab": {
      "stage": "Etape",
      "gc": "Samlet",
      "points": "Point",
      "mountain": "Bjerg",
      "young": "Ungdom",
      "team": "Hold"
    },
    "teamFilter": {
      "label": "Hold",
      "all": "Alle hold",
      "mine": "Mit hold"
    },
    "showAll": "Vis alle {{count}} ↓",
    "showLess": "Skjul ↑",
```

- [ ] **Step 3: Verify both JSON files are still valid**

Run: `cd frontend && node -e "JSON.parse(require('fs').readFileSync('public/locales/en/races.json'))" && node -e "JSON.parse(require('fs').readFileSync('public/locales/da/races.json'))"`
Expected: no output (no parse errors).

- [ ] **Step 4: Commit**

```bash
git add frontend/public/locales/en/races.json frontend/public/locales/da/races.json
git commit -m "i18n(races): add classification-tab/team-filter/show-all labels (#2081)"
```

---

### Task 7: `ResultTable` — team filter support + top-10/show-all

**Files:**
- Modify: `frontend/src/pages/RaceDetailPage.jsx:616-669` (the `ResultTable` function)

- [ ] **Step 1: Add a `defaultLimit` prop with show-all toggle**

Replace the `ResultTable` function (lines 616-669) with:

```js
function ResultTable({ title, rows, highlightWinner = false, highlightTeamId = null, defaultLimit = 10 }) {
  const { t } = useTranslation("races");
  const [expanded, setExpanded] = useState(false);
  const showPoints = rows.some(r => (r.points_earned ?? 0) > 0);
  // Gap-kolonne kun når motoren har skrevet tider (stage/gc fra Race Engine v2);
  // gamle PCM-løb og point/bjerg/ungdom/hold-klassementer har tom finish_time.
  const showTime = rows.some(r => r.finish_time);
  // Holdklassement (rider_id=null) har ingen rytter-team-kolonne at vise.
  const showTeamCol = rows.some(r => resultEntity(r).kind === "rider");
  // #2081 (Discord-ønske): top-10 default + "Show all N"-knap, når feltet er stort.
  const collapsible = rows.length > defaultLimit;
  const visibleRows = collapsible && !expanded ? rows.slice(0, defaultLimit) : rows;
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
      <div className="px-4 py-3 border-b border-cz-border flex items-center justify-between gap-3">
        <h2 className="font-semibold text-cz-1 text-sm">{title}</h2>
        {collapsible && (
          <button type="button" onClick={() => setExpanded(e => !e)}
            className="text-xs text-cz-accent-t hover:underline shrink-0">
            {expanded ? t("detail.showLess") : t("detail.showAll", { count: rows.length })}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-cz-3 text-sm">{t("detail.noResults")}</div>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-cz-border">
            {visibleRows.map(r => {
              const isWinner = highlightWinner && r.rank === 1;
              const isMyTeam = highlightTeamId != null && String(r.team_id) === String(highlightTeamId);
              return (
              <tr key={r.id} className={`transition-colors ${isWinner ? "bg-cz-accent/10" : isMyTeam ? "bg-cz-accent/5" : "hover:bg-cz-subtle"}`}>
                <td className={`px-4 py-2 w-10 font-mono text-xs ${isWinner ? "text-cz-accent-t" : "text-cz-3"}`}>{r.rank ?? "—"}</td>
                <td className="px-2 py-2">
                  <ResultEntityCell row={r} highlightWinner={highlightWinner} t={t} />
                </td>
                {showTeamCol && (
                  <td className="px-2 py-2 text-cz-3 text-xs">
                    {resultEntity(r).kind === "rider" && (
                      <TeamLink id={r.rider?.team?.id} className="hover:text-cz-accent-t transition-colors">
                        {r.rider?.team?.name || r.team_name || t("common.free")}
                      </TeamLink>
                    )}
                  </td>
                )}
                {showTime && (
                  <td className="px-3 py-2 text-right text-cz-2 font-mono text-xs whitespace-nowrap tabular-nums">
                    {r.finish_time || ""}
                  </td>
                )}
                {showPoints && (
                  <td className="px-4 py-2 text-right text-cz-accent-t font-mono text-xs whitespace-nowrap">
                    {(r.points_earned ?? 0) > 0 ? `${formatNumber(r.points_earned)} pt` : ""}
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

(Only additions vs. the original: `defaultLimit`/`highlightTeamId` params, the `expanded` state + collapsible slicing, the header's show-all button, and `isMyTeam` row styling. Column logic unchanged.)

- [ ] **Step 2: Manual sanity check — no test file exists for this component yet, so verify via the dev server in Task 9.**

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/RaceDetailPage.jsx
git commit -m "feat(races): ResultTable gains top-10/show-all + my-team highlight (#2081)"
```

---

### Task 8: `StageTab` — classification sub-tabs + team filter, wired to the new selector

**Files:**
- Modify: `frontend/src/pages/RaceDetailPage.jsx`

- [ ] **Step 1: Import the new selector and add a stage-classification tab list**

Add the import near the other lib imports (after line 19, `buildLiveStandings`):

```js
import { classificationRowsForStage } from "../lib/raceStageClassifications.js";
```

Add a new constant near `CLASSIFICATIONS` (after line 45):

```js
// #2081: klassement-sub-faner INDE i en etape-fane (Stage · Overall · Points ·
// Mountain · Youth · Teams) — samme 5 nøgler som CLASSIFICATIONS + 'stage'.
const STAGE_CLASS_TABS = ["stage", "gc", "points", "mountain", "young", "team"];
```

- [ ] **Step 2: Add team-filter state + "my team" fetch to the top-level component**

In `RaceDetailPage`'s state block (after line 111, `notFound`), add:

```js
  const [teamFilter, setTeamFilter] = useState("all"); // "all" | "mine" | teamId
  const [myTeamId, setMyTeamId] = useState(null);
```

In `loadAll` (inside the `useCallback`, after the `races` query at line 138-144, before the `fetchAllRows` call at line 146), add:

```js
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).maybeSingle();
      setMyTeamId(myTeam?.id ?? null);
    }
```

- [ ] **Step 3: Add a `resolvedTeamFilter` + team options + filter helper**

After the `finalByType`/`liveStandings` memos (after line 262), add:

```js
  // #2081: "mit hold" løses til den faktiske team_id (kan være ukendt hvis ikke logget
  // ind endnu ved første render) — "all" og en eksplicit team_id går uændret igennem.
  const resolvedTeamFilter = teamFilter === "mine" ? myTeamId : (teamFilter === "all" ? null : teamFilter);

  // Holdfilter-valgmuligheder: unikke {id, name} par fundet i de indlæste resultater.
  const teamOptions = useMemo(() => {
    const byId = new Map();
    for (const r of results) {
      const id = r.rider?.team?.id ?? r.team_id;
      const name = r.rider?.team?.name ?? r.team_name;
      if (id != null && name && !byId.has(String(id))) byId.set(String(id), { id, name });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [results]);

  function filterRowsByTeam(rows) {
    if (resolvedTeamFilter == null) return rows;
    return (rows || []).filter(r => String(r.team_id ?? r.rider?.team?.id) === String(resolvedTeamFilter));
  }
```

- [ ] **Step 4: Add a `<TeamFilterSelect>` component**

After the `byRank` function (after line 82), add:

```js
// #2081 Discord-ønske: holdfilter (alle / mit hold / vælg hold) — delt af Samlet-
// og etape-fanerne, så filteret følger med når man skifter etape.
function TeamFilterSelect({ value, onChange, teamOptions, hasMyTeam, t }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label={t("detail.teamFilter.label")}
      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all border max-w-[14rem] cursor-pointer
        focus:outline-none focus:ring-1 focus:ring-cz-accent
        ${value !== "all" ? "bg-cz-accent/10 border-cz-accent/30 text-cz-accent-t" : "bg-cz-card border-cz-border text-cz-2"}`}>
      <option value="all">{t("detail.teamFilter.all")}</option>
      {hasMyTeam && <option value="mine">{t("detail.teamFilter.mine")}</option>}
      {teamOptions.map(team => (
        <option key={team.id} value={team.id}>{team.name}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 5: Render the team filter above the results section, apply it to Samlet tab**

Replace the block that starts `{hasAnyResults && isStageRace && (` (line 378) through its closing `</>` (line 400) with:

```js
      {hasAnyResults && isStageRace && (
        <>
          {/* S4: visuel etape-stribe erstatter tekst-fanerne — ét navigations-mønster
              på kommende OG kørte løb (terræn synligt pr. etape før klik). */}
          <StageStripe
            stages={stageNumbers.map((n) => profileByStage[n] || { stage_number: n, profile_type: "flat" })}
            activeStage={activeTab === "samlet" ? "overall" : Number(activeTab.slice("stage-".length))}
            showOverall
            onSelect={(v) => changeTab(v === "overall" ? "samlet" : `stage-${v}`)}
          />

          <div className="flex justify-end">
            <TeamFilterSelect value={teamFilter} onChange={setTeamFilter} teamOptions={teamOptions} hasMyTeam={myTeamId != null} t={t} />
          </div>

          {activeTab === "samlet" && (
            <div className="space-y-5">
              <RaceRecap results={results} scopeType="overall" />
              {liveStandings
                ? <LiveOverallTab byType={liveStandings.byType} stage={liveStandings.stage} filterRows={filterRowsByTeam} myTeamId={resolvedTeamFilter} />
                : <OverallTab finalByType={finalByType} filterRows={filterRowsByTeam} myTeamId={resolvedTeamFilter} />}
            </div>
          )}
          {stageNumbers.map(n => activeTab === `stage-${n}` && (
            <StageTab key={n} stage={n} results={results} profile={profileByStage[n]}
              filterRows={filterRowsByTeam} myTeamId={resolvedTeamFilter} t={t} />
          ))}
        </>
      )}
```

- [ ] **Step 6: Thread the filter through `OverallTab` and `LiveOverallTab`**

Replace `OverallTab` (lines 447-464) with:

```js
function OverallTab({ finalByType, filterRows, myTeamId }) {
  const { t } = useTranslation("races");
  const any = CLASSIFICATIONS.some(c => finalByType[c.key]?.length > 0);
  if (!any) return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-8 text-center text-cz-3 text-sm">
      {t("detail.noOverall")}
    </div>
  );
  return (
    <div className="space-y-5">
      {CLASSIFICATIONS.map(c => {
        const rows = filterRows(finalByType[c.key]);
        if (!rows?.length) return null;
        return <ResultTable key={c.key} title={t(`detail.classification.${c.key}`)} rows={rows} highlightWinner={c.key === "team"} highlightTeamId={myTeamId} />;
      })}
    </div>
  );
}
```

Replace `LiveOverallTab` (lines 469-484) with:

```js
function LiveOverallTab({ byType, stage, filterRows, myTeamId }) {
  const { t } = useTranslation("races");
  return (
    <div className="space-y-5">
      <div className="bg-cz-card border border-cz-border rounded-cz px-4 py-3">
        <p className="text-sm font-semibold text-cz-1">{t("detail.liveStandings.title", { number: stage })}</p>
        <p className="text-xs text-cz-3 mt-0.5">{t("detail.liveStandings.note")}</p>
      </div>
      {CLASSIFICATIONS.map(c => {
        const rows = filterRows(byType[c.key]);
        if (!rows?.length) return null;
        return <ResultTable key={c.key} title={t(`detail.classification.${c.key}`)} rows={rows} highlightWinner={c.key === "team"} highlightTeamId={myTeamId} />;
      })}
    </div>
  );
}
```

- [ ] **Step 7: Rewrite `StageTab` with classification sub-tabs**

Replace the entire `StageTab` function (lines 486-529) with:

```js
function StageTab({ stage, results, profile, filterRows, myTeamId, t }) {
  const [classTab, setClassTab] = useState("stage");

  const rows = filterRows(classificationRowsForStage(results, stage, classTab));

  // #2081: dag-rækkerne er nu FULDE klassementer (rank 1..N pr. etape) — trøje-
  // bæreren er eksplicit rank 1 (legacy-etaper har kun rank-1-rækker; samme filter).
  const jerseys = JERSEYS
    .map(j => ({ ...j, holder: results.find(r => r.result_type === j.dayType && (r.stage_number ?? 1) === stage && (r.rank ?? 1) === 1) }))
    .filter(j => j.holder);

  const title = classTab === "stage"
    ? t("detail.stageFinishOrder", { number: stage })
    : `${t(`detail.classTab.${classTab}`)} — ${t("detail.liveStandings.title", { number: stage })}`;

  return (
    <div className="space-y-5">
      <StageProfileCard profile={profile} />
      <RaceRecap results={results} scopeType="stage" stageNumber={stage} />
      {jerseys.length > 0 && (
        <div className="bg-cz-card border border-cz-border rounded-cz p-4">
          <p className="text-cz-2 text-xs uppercase tracking-wider mb-3 font-semibold">{t("detail.jerseysAfterStage")}</p>
          <div className="flex flex-wrap gap-2">
            {jerseys.map(j => (
              <div key={j.dayType}
                className="flex items-center gap-2 rounded-full border border-cz-border bg-cz-subtle ps-2 pe-3 py-1">
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: j.bg, color: j.fg }}>
                  {t(`detail.jersey.${j.dayType}`)}
                </span>
                <RiderLink id={j.holder.rider?.id}
                  className="text-cz-1 text-xs font-medium hover:text-cz-accent-t transition-colors">
                  {j.holder.rider?.nationality_code && (
                    <Flag code={j.holder.rider.nationality_code} className="me-1" />
                  )}
                  {riderName(j.holder)}
                </RiderLink>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* #2081: klassement-sub-faner — samme etape, forskellig klassement-linse. */}
      <div className="flex gap-1.5 flex-wrap">
        {STAGE_CLASS_TABS.map(key => (
          <button key={key} type="button" onClick={() => setClassTab(key)}
            aria-pressed={classTab === key}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border
              ${classTab === key ? "bg-cz-accent/10 border-cz-accent/30 text-cz-accent-t" : "bg-cz-card border-cz-border text-cz-2 hover:text-cz-1"}`}>
            {t(`detail.classTab.${key}`)}
          </button>
        ))}
      </div>

      <ResultTable title={title} rows={rows} highlightWinner={classTab === "team"} highlightTeamId={myTeamId} />
    </div>
  );
}
```

Note: `StageTab` no longer takes `results` for its own filtering of `"stage"` rows directly — it now always goes through `classificationRowsForStage(results, stage, classTab)`, which handles the `"stage"` key identically to the old inline filter (see Task 5's tests).

- [ ] **Step 8: Update the one-day-race branch to use the team filter too (small consistency fix)**

Replace lines 403-416 (`{/* Enkeltdagsløb ... */}`) with:

```js
      {/* Enkeltdagsløb — ingen faner, bare måltavlen (+ holdklassement hvis det findes) */}
      {hasAnyResults && !isStageRace && (
        <div className="space-y-5">
          <StageProfileCard profile={profileByStage[1]} />
          <RaceRecap results={results} scopeType="overall" />
          <div className="flex justify-end">
            <TeamFilterSelect value={teamFilter} onChange={setTeamFilter} teamOptions={teamOptions} hasMyTeam={myTeamId != null} t={t} />
          </div>
          <ResultTable
            title={t("detail.tableResult")}
            rows={filterRowsByTeam(finalByType.gc?.length ? finalByType.gc : results.filter(r => r.result_type === "stage").sort(byRank))}
            highlightTeamId={resolvedTeamFilter}
          />
          {finalByType.team?.length > 0 && (
            <ResultTable title={t("detail.classification.team")} rows={filterRowsByTeam(finalByType.team)} highlightWinner highlightTeamId={resolvedTeamFilter} />
          )}
        </div>
      )}
```

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/RaceDetailPage.jsx
git commit -m "feat(races): etape × klassement tabs + team filter on race detail page (#2081)"
```

---

### Task 9: Verify in the browser

- [ ] **Step 1: Start the dev server** (via `preview_start`, using the project's existing launch config)

- [ ] **Step 2: Navigate to an in-progress or completed stage race's detail page** (`/races/<raceId>`)

- [ ] **Step 3: Click through an intermediate stage's tab, then its classification sub-tabs** (Stage → Overall → Points → Mountain → Youth → Teams). Confirm:
  - "Overall" on a mid-race stage shows the `leader` rows (full field, with gaps) — not empty.
  - "Teams" on a mid-race stage shows team rows.
  - The final stage's "Overall" shows the persisted `gc` rows (identical to what "Samlet" showed before this change).

- [ ] **Step 4: Toggle the team filter to "My team" and to a specific team.** Confirm the tables filter correctly and the highlighted row shows for the selected team.

- [ ] **Step 5: Find (or seed) a stage/classification with >10 rows.** Confirm the table shows the top 10 + "Show all N ↓" button, and clicking it expands, then "Hide ↑" collapses again.

- [ ] **Step 6: Check the browser console for errors** via `preview_console_logs` (level: "error").

- [ ] **Step 7: If anything is broken, fix it and re-verify from Step 3.**

---

## Phase 4 — Findability: sort library results by recency, filter to my division

### Task 10: `RacesPage.jsx` library tab — sort newest-first, add "my division" filter

**Files:**
- Modify: `frontend/src/pages/RacesPage.jsx`

- [ ] **Step 1: Import the existing sort helper (already imported) — no new import needed**

`sortRacesByDateDesc` and `racesForPool` are already imported at the top of the file (lines 9-10) for the calendar tab.

- [ ] **Step 2: Add `league_division_id` to the library query's select**

Replace line 151:

```js
        .select("id, name, race_type, race_class, stages, stages_completed, status, edition_year, pool_race:pool_race_id(date_text), season:season_id(id, number, status)")
```

with:

```js
        .select("id, name, race_type, race_class, stages, stages_completed, status, edition_year, league_division_id, pool_race:pool_race_id(date_text), season:season_id(id, number, status)")
```

- [ ] **Step 3: Add a "my division only" toggle state**

Add near the other library state (after line 89, `libSearch`):

```js
  // #2081 (zootne, Discord 2/7): "hvad kørte jeg i dag" er lettere at finde når
  // listen er begrænset til egen pulje. Genbruger myPoolId (allerede hentet i
  // loadAll for kalender-fanen — samme state, ikke division-specifik data).
  const [libMyDivisionOnly, setLibMyDivisionOnly] = useState(false);
```

- [ ] **Step 4: Sort newest-first and apply the division filter in `filteredLibRaces`**

Replace `filteredLibRaces` (lines 175-183):

```js
  const filteredLibRaces = useMemo(() => {
    const base = libMyDivisionOnly ? racesForPool(libRaces, myPoolId) : libRaces;
    const filtered = base.filter(r => {
      if (libFilterSeason && r.season?.id !== libFilterSeason) return false;
      if (libFilterClass && r.race_class !== libFilterClass) return false;
      if (libFilterStatus && r.status !== libFilterStatus) return false;
      if (libSearch && !r.name.toLowerCase().includes(libSearch.toLowerCase())) return false;
      return true;
    });
    // #2081: nyeste (afsluttede) løb først i stedet for alfabetisk — "hvad kørte
    // jeg i dag" skal ligge øverst uden at spilleren skal gennemgå hele listen.
    return sortRacesByDateDesc(filtered);
  }, [libRaces, libFilterSeason, libFilterClass, libFilterStatus, libSearch, libMyDivisionOnly, myPoolId]);
```

- [ ] **Step 5: Render the "my division only" toggle in the filter bar**

In the library tab's filter `<Card>` (starts at line 380), add a fifth filter cell after the status `<Select>` block (after line 416, before the closing `</Card>` at line 417):

```jsx
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-cz-2 cursor-pointer select-none">
                <input type="checkbox" checked={libMyDivisionOnly}
                  onChange={e => setLibMyDivisionOnly(e.target.checked)}
                  className="rounded border-cz-border" />
                {t("library.myDivisionOnly")}
              </label>
            </div>
```

Note: the filter `<Card>` uses `grid sm:grid-cols-2 lg:grid-cols-4 gap-3` (line 380) — this adds a 5th cell, which is fine (it wraps to a new row on all breakpoints).

- [ ] **Step 6: Add the i18n key**

In `frontend/public/locales/en/races.json`, inside `"library": { ... }` (lines 159-178), add:

```json
    "myDivisionOnly": "My division only",
```

In `frontend/public/locales/da/races.json`, inside the matching `"library"` object, add:

```json
    "myDivisionOnly": "Kun min division",
```

- [ ] **Step 7: Verify with existing tests**

`sortRacesByDateDesc` and `racesForPool` already have their own unit tests (`frontend/src/lib/raceCalendarSort.test.js`, `frontend/src/lib/racesByPool.test.js`) — no new pure-logic tests needed since this task only wires already-tested helpers into a new call site. Run:

Run: `cd frontend && node --test src/lib/raceCalendarSort.test.js src/lib/racesByPool.test.js`
Expected: PASS (unchanged — confirms the helpers still behave as documented).

- [ ] **Step 8: Verify in the browser**

Navigate to `/races?tab=library`. Confirm:
- The list is sorted newest-first (not alphabetical) by default.
- Checking "My division only" narrows the list to races in your division + shared races.
- Existing search/season/class/status filters still work alongside the new sort/toggle.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/RacesPage.jsx frontend/public/locales/en/races.json frontend/public/locales/da/races.json
git commit -m "fix(races): library tab sorts newest-first + my-division filter (#2081)"
```

---

## Phase 5 — Close-out

### Task 11: Full local verification pass

- [ ] **Step 1: Run the project's full local verify script**

Run: `pwsh -File scripts/verify-local.ps1`
Expected: backend tests, frontend `node --test`, and frontend build all pass.

- [ ] **Step 2: Run Playwright core-smoke across all 3 projects** (per CLAUDE.md pre-flight rule — this PR touches shared UI (`RaceDetailPage.jsx`, `RacesPage.jsx`))

Run: `cd frontend && npx playwright test core-smoke.spec.js`
Expected: PASS on desktop-chromium, mobile-chromium, and mobile-webkit.

- [ ] **Step 3: If anything fails, fix and re-run from Step 1. Do not proceed past 2 fix rounds on the same symptom — stop and ask.**

---

### Task 12: Patch notes + help update

**Files:**
- Modify: `frontend/src/data/patchNotes.js` (or wherever the next version entry belongs — check the file's existing format)
- Modify: `frontend/public/locales/en/help.json` and `frontend/public/locales/da/help.json` (if a running-standings FAQ entry doesn't already exist)

- [ ] **Step 1: Read the current top entry of `frontend/src/data/patchNotes.js` to match its exact format (version bump convention, key names).**

- [ ] **Step 2: Add a new patch note entry (EN first, DA second) describing:**
  - Running standings now show every classification (GC/points/mountain/youth/teams) after every stage, not just the leader's jersey.
  - Team filter + top-10/show-all on results tables.
  - Race results library now sorts newest-first with a "my division" filter.

- [ ] **Step 3: Check `docs/PATCH_NOTES_VERSION` or equivalent version-check file (per CI gate) and bump it to match.**

- [ ] **Step 4: Commit**

```bash
git add frontend/src/data/patchNotes.js frontend/public/locales/en/help.json frontend/public/locales/da/help.json
git commit -m "docs: patch notes + help for resultater V2 slice 1 (#2081)"
```

(If a version-check file was bumped, include it in the same commit.)

---

### Task 13: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin <branch-name>
```

- [ ] **Step 2: Open a PR using the repo's PR template**, referencing `Refs #2081`. Note in the description that this PR contains a `database/*.sql` migration — per project convention, **the owner merges this PR, not an automated/AI merge.**

- [ ] **Step 3: In the PR description's "Brugerverifikation" section, list the exact steps from Task 9 and Task 10 Step 8** so the owner can click through on the preview/prod build.

---

## Self-review notes (spec coverage check)

- Spec section A (etape-selector × klassement-tabs, jersey colors, "Overall efter etape N" reading from `leader` vs `gc`, default context label) → Tasks 5, 8.
- Spec section A Discord-asks (holdfilter, top-10/vis-alle, point/bjerg pr. etape) → Tasks 7, 8 (points column already existed in `ResultTable` via `showPoints`/`points_earned` — no new work needed there, confirmed by reading the component).
- Spec section B (backend `team_day`) → Tasks 1-4 (both code paths — the spec only called out one, but the codebase has two, and only one is actually used in production).
- Spec section C (findability) → Task 10.
- Spec "Data/kontrakt" (CHECK constraint, `fetchAllRows` for broad reads) → Task 1 (constraint); `RaceDetailPage.jsx` already uses `fetchAllRows` (verified in research, line 146) — no change needed.
- Spec "Scope-afgrænsning (YAGNI)" exclusions (per-rider relative gap-click, bonus seconds, sprint/KOM per checkpoint, live-ticker, staged-reveal animation) — none of these are implemented by this plan, consistent with the spec.

## Patch-notes CI note (Task 12 close-out)

Bumping to v6.64 triggers `scripts/check-patch-notes-version.js`'s new-top-version
snapshot-refresh requirement. That requirement predates #2211 (same day, earlier),
which dropped the fragile `/patch-notes` pixel-snapshot entirely (`skipSnapshot: true`
in `core-smoke.spec.js`, kept only the blank-screen heading check) — so no snapshot
files exist to refresh anymore. Verified: `2510dce1` (#2211) is already an ancestor of
`origin/main`, and no `patch-notes-*.png` files exist in this branch's tree. The
check script itself is stale relative to #2211 and will keep demanding an
impossible snapshot refresh on every future top-version bump until it's updated —
worth a follow-up issue. For THIS PR, using the script's own documented escape
hatch (a commit message containing `[patch-notes-snapshot-ok]`) is the correct,
intended way to pass this gate.
