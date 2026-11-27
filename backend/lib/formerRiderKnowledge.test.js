import test from "node:test";
import assert from "node:assert/strict";

import {
  applyFormerRiderStepsToEstimates, applyFormerRiderStepsToReport, formerRiderStepsFrom, formerRidersByTeam,
  latestDepartures, loadFormerRiderSteps,
} from "./formerRiderKnowledge.js";

const TEAM = "team-a";
const OTHER = "team-b";
const SEASONS = [
  { number: 3, start_date: "2026-08-28", end_date: "2026-09-27" },
  { number: 4, start_date: "2026-09-28", end_date: "2026-10-25" },
  { number: 5, start_date: "2026-10-28", end_date: null },
];
const ev = (rider_id, from_team_id, to_team_id, occurred_at) => ({ rider_id, from_team_id, to_team_id, occurred_at });

test("#7455 latestDepartures: seneste hændelse med holdet afgør, om rytteren er tidligere", () => {
  const events = [
    ev("r1", TEAM, OTHER, "2026-10-01T10:00:00Z"), // solgt
    ev("r2", TEAM, OTHER, "2026-09-01T10:00:00Z"),
    ev("r2", OTHER, TEAM, "2026-10-10T10:00:00Z"), // kom tilbage
    ev("r3", OTHER, TEAM, "2026-10-01T10:00:00Z"), // kun ankomst
    ev("r4", null, TEAM, "2026-08-30T10:00:00Z"),
    ev("r4", TEAM, null, "2026-11-01T10:00:00Z"), // fritstillet
    ev("r5", OTHER, null, "2026-11-01T10:00:00Z"), // andet holds hændelse
  ];
  const out = latestDepartures(events, TEAM);
  assert.deepEqual([...out.keys()].sort(), ["r1", "r4"]);
  assert.equal(out.get("r4"), "2026-11-01T10:00:00Z");
});

test("#7455 formerRiderStepsFrom: kun ryttere med tabte trin; afgang i denne sæson taber intet", () => {
  const departures = new Map([
    ["now", "2026-11-20T12:00:00Z"],
    ["s4", "2026-10-02T12:00:00Z"],
    ["s3", "2026-09-02T12:00:00Z"],
    ["gap", "2026-10-26T12:00:00Z"], // pausen før sæson 5 → sæson 5
  ]);
  const steps = formerRiderStepsFrom(departures, SEASONS, "2026-11-27");
  assert.deepEqual(Object.fromEntries(steps), { s4: 1, s3: 2 });
});

test("#7455 applyFormerRiderStepsToEstimates: kun tidligere ryttere med tabte trin ændres", () => {
  const estimates = {
    r1: { potentialView: { hidden: false, value: 70, certainty: "sure" } },
    r2: { potentialView: { hidden: false, value: 60, certainty: "sure" }, prognosisView: { hidden: false, value: 65 } },
    r3: { potentialView: { hidden: true, reason: "unscouted" } },
  };
  const out = applyFormerRiderStepsToEstimates(estimates, new Map([["r1", 2], ["r3", 1]]));
  assert.equal(out.r1.potentialView.certainty, "unsure");
  assert.equal(out.r1.potentialView.value, 70);
  assert.equal(out.r2, estimates.r2);
  assert.equal(out.r3.potentialView, estimates.r3.potentialView);
  assert.equal(estimates.r1.potentialView.certainty, "sure", "input må ikke ændres");
  assert.equal(applyFormerRiderStepsToEstimates(estimates, new Map()), estimates);
});

test("#7455 applyFormerRiderStepsToReport: rapportens tillid følger ordet", () => {
  const report = { potentialView: { hidden: false, value: 70, certainty: "sure" }, verdict: { key: "x", confidence: "high" }, level: 3 };
  const out = applyFormerRiderStepsToReport(report, 1);
  assert.equal(out.potentialView.certainty, "fair");
  assert.equal(out.verdict.confidence, "medium");
  assert.equal(out.verdict.key, "x");
  assert.equal(applyFormerRiderStepsToReport(report, 0), report);
  const projection = { potentialView: { hidden: false, value: 70, certainty: "fair" }, now: 50 };
  assert.deepEqual(applyFormerRiderStepsToReport(projection, 1), { ...projection, potentialView: { ...projection.potentialView, certainty: "unsure" } });
});

test("#7455 formerRidersByTeam: kun menneskehold, og en rytter på holdet nu er ikke tidligere", () => {
  const events = [
    ev("r1", TEAM, OTHER, "2026-10-01T10:00:00Z"),
    ev("r2", TEAM, "ai", "2026-10-01T10:00:00Z"),
    ev("r3", "ai", TEAM, "2026-10-01T10:00:00Z"),
    ev("r4", TEAM, OTHER, "2026-10-01T10:00:00Z"),
  ];
  const current = new Map([["r1", OTHER], ["r2", "ai"], ["r3", TEAM], ["r4", TEAM]]);
  const out = formerRidersByTeam(events, [TEAM, OTHER], current);
  assert.deepEqual(Object.fromEntries([...out].map(([k, v]) => [k, v.sort()])), { [TEAM]: ["r1", "r2"] });
});

// Lille falsk Supabase: kun de kæder loadFormerRiderSteps bruger.
function fakeSupabase(tables) {
  return {
    from(table) {
      const rows = tables[table] ?? [];
      let filtered = rows;
      const q = {
        select() { return q; },
        or(expr) {
          const ids = [...expr.matchAll(/(from_team_id|to_team_id)\.eq\.([^,]+)/g)].map((m) => [m[1], m[2]]);
          filtered = filtered.filter((row) => ids.some(([col, id]) => row[col] === id));
          return q;
        },
        in(col, values) { filtered = filtered.filter((row) => values.includes(row[col])); return q; },
        order() { return q; },
        range() { return Promise.resolve({ data: filtered, error: null }); },
        then(resolve) { return Promise.resolve({ data: filtered, error: null }).then(resolve); },
      };
      return q;
    },
  };
}

test("#7455 loadFormerRiderSteps: læser hændelser + sæsoner og springer ryttere på holdet over", async () => {
  const supabase = fakeSupabase({
    rider_ownership_events: [
      { id: 1, ...ev("r1", TEAM, OTHER, "2026-10-02T10:00:00Z") },
      { id: 2, ...ev("r2", TEAM, OTHER, "2026-09-02T10:00:00Z") }, // står på holdet igen uden hændelse
      { id: 3, ...ev("r9", TEAM, OTHER, "2026-09-02T10:00:00Z") }, // ikke spurgt om
    ],
    seasons: SEASONS,
    riders: [{ id: "r1", team_id: OTHER }, { id: "r2", team_id: TEAM }],
  });
  const steps = await loadFormerRiderSteps(supabase, { teamId: TEAM, riderIds: ["r1", "r2"], clock: new Date("2026-11-27T12:00:00Z") });
  assert.deepEqual(Object.fromEntries(steps), { r1: 1 });
  assert.equal((await loadFormerRiderSteps(supabase, { teamId: TEAM, riderIds: [] })).size, 0);
});
