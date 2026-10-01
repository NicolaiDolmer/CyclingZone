import test from "node:test";
import assert from "node:assert/strict";
import {
  planRepair,
  repairBoard,
  loadRepairInput,
  buildApplySql,
  modifierCaseSql,
  verifyAgainstPlan,
  parseArgs,
  renderPublicReport,
  describeDistribution,
} from "./repair5897BoardYouthRaces.mjs";
import { satisfactionToModifier } from "../../lib/boardEvaluation.js";
import { createFakeSupabase } from "../../lib/testUtils/fakeSupabase.js";

const T0 = "2026-09-28T17:50:00.000Z";
const T1 = "2026-09-28T18:00:00.000Z";
const T2 = "2026-09-28T18:20:00.000Z";
const LATER = "2026-09-29T18:00:00.000Z";

function ev(id, board, race, delta, at, before = 50) {
  return { id, board_id: board, team_id: `t-${board}`, season_id: "s4", race_id: race,
    satisfaction_before: before, satisfaction_after: before + delta, satisfaction_delta: delta, created_at: at };
}

test("repairBoard: invers-delta, clamp og modifier fra repareret satisfaction", () => {
  const r = repairBoard({ satisfaction: 70, budget_modifier: satisfactionToModifier(70) }, 15);
  assert.equal(r.repaired, 55);
  assert.equal(r.newModifier, satisfactionToModifier(55));
  assert.equal(r.modifierChanged, satisfactionToModifier(55) !== satisfactionToModifier(70));
  assert.equal(r.clamped, false);

  const low = repairBoard({ satisfaction: 5, budget_modifier: 0.8 }, 20);
  assert.equal(low.repaired, 0);
  assert.equal(low.clamped, true);

  const neg = repairBoard({ satisfaction: 40, budget_modifier: 1 }, -10);
  assert.equal(neg.repaired, 50);
});

test("repairBoard: baseline-board bruger baseline-båndet og rører ikke budget_modifier", () => {
  const r = repairBoard({ satisfaction: 35, budget_modifier: 1.0, is_baseline: true }, 20);
  assert.equal(r.baseline, true);
  assert.equal(r.repaired, 30);
  assert.equal(r.clamped, true);
  assert.equal(r.newModifier, 1.0);
  assert.equal(r.modifierChanged, false);
  assert.equal(repairBoard({ satisfaction: 60, budget_modifier: 1.0, plan_type: "baseline" }, 5).baseline, true);
});

test("planRepair: summerer events pr. board, tæller ændret-siden, økonomi og gap-boards", () => {
  const youthEvents = [
    ev("e1", "b1", "y1", 6, T0), ev("e2", "b1", "y2", 6, T1, 56),
    ev("e3", "b2", "y1", -4, T0),
    ev("e4", "b3", "y1", 0, T0),
    ev("e5", "ghost", "y1", 3, T0),
  ];
  const boards = [
    { id: "b1", team_id: "tA", satisfaction: 62, budget_modifier: satisfactionToModifier(62), negotiation_status: "completed", updated_at: T1 },
    { id: "b2", team_id: "tB", satisfaction: 46, budget_modifier: 1.0, negotiation_status: "completed", updated_at: LATER },
    { id: "b3", team_id: "tC", satisfaction: 50, budget_modifier: 1.0, negotiation_status: "completed", is_baseline: true, updated_at: T0 },
  ];
  const teamBoards = [...boards, { id: "b1x", team_id: "tA", satisfaction: 50, budget_modifier: 1.0, negotiation_status: "completed" }];
  const teams = [{ id: "tA", sponsor_income: 1000 }, { id: "tB", sponsor_income: 500 }, { id: "tC", sponsor_income: 100 }];
  const laterEvents = [...youthEvents, { id: "s1", board_id: "b2", created_at: LATER }];
  const windowEvents = [
    { id: "w1", board_id: "q1", satisfaction_before: 50, satisfaction_after: 52, created_at: "2026-09-28T17:30:00.000Z" },
    { id: "w2", board_id: "q1", satisfaction_before: 49, satisfaction_after: 50, created_at: "2026-09-28T18:10:00.000Z" },
    { id: "w3", board_id: "q2", satisfaction_before: 50, satisfaction_after: 52, created_at: "2026-09-28T17:30:00.000Z" },
    { id: "w4", board_id: "q2", satisfaction_before: 52, satisfaction_after: 55, created_at: "2026-09-28T18:10:00.000Z" },
    { id: "w5", board_id: "b1", satisfaction_before: 0, satisfaction_after: 0, created_at: T1 },
  ];
  const { summary, plans, economy, silentGaps } = planRepair({ youthEvents, boards, teamBoards, teams, laterEvents, windowEvents });

  assert.equal(summary.youthEvents, 5);
  assert.equal(summary.boards, 3);
  assert.equal(summary.missingBoards, 1);
  const b1 = plans.find((p) => p.board_id === "b1");
  assert.equal(b1.youthDelta, 12);
  assert.equal(b1.repaired, 50);
  assert.equal(b1.changedAfterWindow, false);
  const b2 = plans.find((p) => p.board_id === "b2");
  assert.equal(b2.repaired, 50);
  assert.equal(b2.changedAfterWindow, true);
  assert.equal(summary.changedAfterYouthWindow, 1);
  assert.equal(summary.baselineBoards, 1);
  assert.equal(summary.nonZeroDeltaBoards, 2);
  assert.equal(summary.absDeltaAtLeast10, 1);
  assert.equal(summary.delta.max, 12);
  assert.equal(summary.delta.median, 0);

  // Hold A: b1 går fra modifier(62) til modifier(50); snit over 2 completed boards.
  const tA = economy.find((e) => e.team_id === "tA");
  const expected = Math.round(1000 * ((satisfactionToModifier(50) + 1) / 2 - (satisfactionToModifier(62) + 1) / 2));
  if (satisfactionToModifier(50) !== satisfactionToModifier(62)) assert.equal(tA.sponsorDelta, expected);
  assert.equal(economy.some((e) => e.team_id === "tC"), false, "baseline uden modifier-ændring");

  // Gap: q1 faldt 52 -> 49 uden event i vinduet; q2 har ingen gap; b1 ignoreres (har youth-events).
  assert.deepEqual(silentGaps, [{ board_id: "q1", gap: -3 }]);
  assert.equal(summary.silentGapBoards, 1);
});

test("planRepair: tomt input giver tom plan uden fejl", () => {
  const { summary, plans } = planRepair({});
  assert.equal(plans.length, 0);
  assert.equal(summary.boards, 0);
  assert.equal(summary.window, null);
  assert.deepEqual(describeDistribution([]), { count: 0, mean: null, median: null, min: null, max: null });
});

test("loadRepairInput er READ-ONLY og filtrerer ungdomsløb via squad", async () => {
  const state = {
    races: [{ id: "y1", squad: "u23" }, { id: "j1", squad: "junior" }, { id: "s1", squad: "senior" }],
    board_satisfaction_events: [
      ev("e1", "b1", "y1", 5, T0), ev("e2", "b1", "s1", 2, T2), ev("e3", "b2", "j1", -1, T1),
    ],
    board_profiles: [
      { id: "b1", team_id: "tA", plan_type: "1yr", is_baseline: false, negotiation_status: "completed", satisfaction: 60, budget_modifier: 1.1, updated_at: T2 },
      { id: "b2", team_id: "tB", plan_type: "1yr", is_baseline: false, negotiation_status: "completed", satisfaction: 40, budget_modifier: 1.0, updated_at: T1 },
    ],
    teams: [{ id: "tA", sponsor_income: 10 }, { id: "tB", sponsor_income: 20 }],
  };
  const before = structuredClone(state);
  const input = await loadRepairInput(createFakeSupabase(state));
  assert.deepEqual(state, before);
  assert.deepEqual(input.youthEvents.map((e) => e.id).sort(), ["e1", "e3"]);
  assert.equal(input.boards.length, 2);
  assert.ok(input.laterEvents.some((e) => e.id === "e2"));
  const plan = planRepair(input);
  assert.equal(plan.plans.find((p) => p.board_id === "b1").repaired, 55);
  assert.equal(plan.plans.find((p) => p.board_id === "b2").repaired, 41);
});

test("loader-fejl afbryder i stedet for at rapportere en tom plan", async () => {
  const db = createFakeSupabase({}, { errors: { races: { select: "permission denied" } } });
  await assert.rejects(loadRepairInput(db), /permission denied/);
});

test("modifierCaseSql spejler satisfactionToModifier for hele skalaen", () => {
  const sql = modifierCaseSql("x");
  for (let s = 0; s <= 100; s += 1) {
    const match = [...sql.matchAll(/WHEN x >= (\d+) THEN ([\d.]+)/g)].find(([, from]) => s >= Number(from));
    const value = match ? Number(match[2]) : Number(sql.match(/ELSE ([\d.]+) END/)[1]);
    assert.equal(value, satisfactionToModifier(s), `satisfaction ${s}`);
  }
});

test("apply-SQL er én atomisk, idempotent blok uden ids og med backup + verify", () => {
  const sql = buildApplySql();
  assert.match(sql, /^-- #5897/);
  assert.equal((sql.match(/DO \$repair\$/g) || []).length, 1);
  assert.match(sql, /IF n_events = 0 THEN[\s\S]*RETURN;/);
  assert.match(sql, /to_regclass\('public\.backup_board_profiles_5897'\)/);
  assert.ok(sql.indexOf("CREATE TABLE public.backup_board_satisfaction_events_5897") < sql.indexOf("UPDATE public.board_profiles"));
  assert.ok(sql.indexOf("UPDATE public.board_profiles") < sql.indexOf("DELETE FROM public.board_satisfaction_events"));
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /r\.squad <> 'senior'/);
  assert.match(sql, /RAISE EXCEPTION 'STOP #5897: % boards matcher ikke/);
  assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-/i, "ingen uuid'er i SQL'en");
  assert.doesNotMatch(sql, /^\s*(COMMIT|ROLLBACK)\s*;/m,"DO-blokken styrer selv transaktionen");
});

test("verifyAgainstPlan: ok når events er væk og boards matcher", () => {
  const plan = { plans: [
    { board_id: "b1", repaired: 50, baseline: false, newModifier: 1.0 },
    { board_id: "b2", repaired: 40, baseline: true, newModifier: 1.0 },
  ] };
  const ok = verifyAgainstPlan({ plan, youthEventsRemaining: 0, boards: [
    { id: "b1", satisfaction: 50, budget_modifier: 1.0 }, { id: "b2", satisfaction: 40, budget_modifier: 1.0 },
  ] });
  assert.equal(ok.ok, true);
  const bad = verifyAgainstPlan({ plan, youthEventsRemaining: 2, boards: [{ id: "b1", satisfaction: 51, budget_modifier: 1.0 }] });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.mismatches.map((m) => m.reason).sort(), ["missing", "satisfaction"]);
});

test("CLI: dry-run er default, apply kræver owner-go", () => {
  assert.deepEqual(parseArgs([]), { apply: false, ownerGo: false, verify: null, dryRun: true });
  assert.equal(parseArgs(["--dry-run"]).dryRun, true);
  assert.throws(() => parseArgs(["--apply"]), /owner-go/);
  assert.throws(() => parseArgs(["--owner-go"]), /--apply/);
  assert.throws(() => parseArgs(["--typo"]), /Ukendt/);
  assert.throws(() => parseArgs(["--apply", "--owner-go", "--verify=x.json"]), /kombineres/);
  const go = parseArgs(["--apply", "--owner-go"]);
  assert.equal(go.apply && go.ownerGo && !go.dryRun, true);
  assert.equal(parseArgs(["--verify=5897/x.json"]).verify, "5897/x.json");
});

test("offentlig rapport indeholder kun antal, ingen ids eller beløb", () => {
  const { summary } = planRepair({
    youthEvents: [ev("e1", "board-secret-id", "y1", 12, T0)],
    boards: [{ id: "board-secret-id", team_id: "team-secret-id", satisfaction: 70, budget_modifier: satisfactionToModifier(70), negotiation_status: "completed" }],
    teamBoards: [{ id: "board-secret-id", team_id: "team-secret-id", satisfaction: 70, budget_modifier: satisfactionToModifier(70), negotiation_status: "completed" }],
    teams: [{ id: "team-secret-id", sponsor_income: 987654 }],
  });
  const md = renderPublicReport(summary, { generatedAt: "2026-10-01T00:00:00Z", privateFile: "5897/dry-run-x.json" });
  assert.doesNotMatch(md, /secret/);
  assert.doesNotMatch(md, /987654/);
  assert.match(md, /Boards med invers-delta \| 1 \|/);
});
