// #5904 · Tests for løbsdags-dry-run-gaten (backend/scripts/loadtestRaceDay.mjs).
// Bevis for at gaten fanger de to kendte fejlklasser fra S4 løbsdag 1 (#5893):
//   - #5890: ungdomspuljer ukendte for scheduleren -> ungdomsløb springes tavst over
//   - #5892/#3624: tung afslutning (bestyrelse på ungdomsløb, Discord i ticket) -> tick
//     når ikke at blive færdigt
// og at den nuværende profil består en normal S5-løbsdag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  COST_PROFILES,
  DEFAULT_LIMITS,
  COLLAPSE_CALLS_PER_MIN,
  BROWSER_PEAK_CALLS_PER_MIN,
  buildRaceDayFixture,
  copenhagenHHMM,
  copenhagenSlotMs,
  createCountingSupabase,
  firstTickAtOrAfter,
  parseArgs,
  renderMarkdown,
  simulateRaceDay,
} from "./loadtestRaceDay.mjs";
import { STAGE_TICK_PERIOD_MS, STAGE_TICK_OFFSET_MS } from "../lib/schedulerTick.js";

const SCRIPT = fileURLToPath(new URL("./loadtestRaceDay.mjs", import.meta.url));
const DATE = "2026-10-29";

test("grænsen er kollaps-niveauet fra S4 løbsdag 1 minus browsernes peak", () => {
  assert.equal(DEFAULT_LIMITS.maxBackendCallsPerMinute, COLLAPSE_CALLS_PER_MIN - BROWSER_PEAK_CALLS_PER_MIN);
  assert.equal(DEFAULT_LIMITS.maxBackendCallsPerMinute, 5376);
  assert.equal(DEFAULT_LIMITS.maxTickDurationMs, STAGE_TICK_PERIOD_MS);
  assert.equal(DEFAULT_LIMITS.maxRowsPerResponse, 999);
});

test("parseArgs: defaults, gyldige flag og fejl", () => {
  const ok = parseArgs([]);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.options.scenarios, ["normal", "season-last-day"]);
  assert.equal(ok.options.profile, "current");

  const custom = parseArgs(["--date", "2026-11-04", "--scenarios", "normal", "--profile", "legacy-s4-day1", "--youth-groups", "4", "--final-share", "0.5", "--latency-ms", "0", "--json"]);
  assert.deepEqual(custom.errors, []);
  assert.equal(custom.options.date, "2026-11-04");
  assert.deepEqual(custom.options.scenarios, ["normal"]);
  assert.equal(custom.options.youthGroups, 4);
  assert.equal(custom.options.finalShare, 0.5);
  assert.equal(custom.options.latencyMs, 0);
  assert.equal(custom.options.json, true);

  const bad = parseArgs(["--nope", "x", "--profile", "prod", "--date", "29/10", "--final-share", "2", "--youth-groups"]);
  assert.ok(bad.errors.includes("USAGE_UNKNOWN_FLAG:nope"));
  assert.ok(bad.errors.includes("USAGE_INVALID_PROFILE"));
  assert.ok(bad.errors.includes("USAGE_INVALID_DATE"));
  assert.ok(bad.errors.includes("USAGE_INVALID_FINAL_SHARE"));
  assert.ok(bad.errors.includes("USAGE_MISSING_VALUE:youth-groups"));
});

test("tid: slots er dansk tid (vintertid) og tick-gitteret ligger på hh:m5:05", () => {
  const noon = copenhagenSlotMs(DATE, "12:00");
  assert.equal(new Date(noon).toISOString(), "2026-10-29T11:00:00.000Z");
  assert.equal(copenhagenHHMM(noon), "12:00");
  const tick = firstTickAtOrAfter(noon);
  assert.equal(tick, noon + STAGE_TICK_OFFSET_MS);
  assert.equal(firstTickAtOrAfter(tick), tick);
});

test("fixture: S5-strukturen (senior 1/2/4/4 + ungdomsgrupper) og dagens etaper pr. trup", () => {
  const { pools, expected, state } = buildRaceDayFixture({ date: DATE, youthGroups: 3 });
  assert.equal(pools.filter((p) => p.squad === "senior").length, 11);
  assert.equal(pools.filter((p) => p.squad === "u23").length, 3);
  assert.equal(pools.filter((p) => p.squad === "junior").length, 3);
  // Senior: D1 5 slots, D2 4 x 2, D3 3 x 4, D4 3 x 4 = 37. Ungdom: én etape pr. gruppe.
  const bySquad = (squad) => expected.filter((e) => e.squad === squad).length;
  assert.equal(bySquad("senior"), 37);
  assert.equal(bySquad("u23"), 3);
  assert.equal(bySquad("junior"), 3);
  // Ungdommens etape-tider fra SQUAD_CALENDAR.
  assert.ok(expected.filter((e) => e.squad === "u23").every((e) => copenhagenHHMM(e.scheduledMs) === "16:30"));
  assert.ok(expected.filter((e) => e.squad === "junior").every((e) => copenhagenHHMM(e.scheduledMs) === "14:30"));
  // Hver ungdomsgruppe er fuld, og ingen rækker bærer navne fra prod.
  const u23Members = state.teams.filter((t) => t.u23_league_division_id === "pool-u23-0").length;
  assert.equal(u23Members, 24);
  assert.ok(state.teams.every((t) => !("name" in t)));
});

test("fixture: sæsonens sidste løbsdag slutter kl. 15 i alle trupper", () => {
  const { expected } = buildRaceDayFixture({ date: DATE, scenario: "season-last-day", youthGroups: 2 });
  const latest = Math.max(...expected.map((e) => e.scheduledMs));
  assert.equal(copenhagenHHMM(latest), "15:00");
  assert.ok(expected.filter((e) => e.squad === "u23").every((e) => copenhagenHHMM(e.scheduledMs) === "15:00"));
});

test("tællende fake: hvert kald tælles, !inner-filter og HEAD-count virker", async () => {
  const state = {
    races: [{ id: "r1", status: "active" }, { id: "r2", status: "completed" }],
    race_stage_schedule: [
      { race_id: "r1", stage_number: 1, scheduled_at: "2026-10-29T10:00:00.000Z" },
      { race_id: "r2", stage_number: 1, scheduled_at: "2026-10-29T10:00:00.000Z" },
    ],
    race_entries: [{ race_id: "r1" }, { race_id: "r1" }],
  };
  const clock = { now: 1000 };
  const calls = [];
  const sb = createCountingSupabase(state, { clock, latencyMs: 10, onCall: (c) => calls.push(c) });

  // pagination-safe: in-memory fake med to rækker, ingen PostgREST involveret
  const { data } = await sb.from("race_stage_schedule")
    .select("race_id, stage_number, races!inner(status)")
    .lte("scheduled_at", "2026-10-29T11:00:00.000Z")
    .neq("races.status", "completed")
    .order("scheduled_at", { ascending: true });
  assert.deepEqual(data, [{ race_id: "r1", stage_number: 1, races: { status: "active" } }]);

  const { count, data: headData } = await sb.from("race_entries").select("race_id", { count: "exact", head: true }).eq("race_id", "r1");
  assert.equal(count, 2);
  assert.equal(headData, null);

  const { data: one } = await sb.from("races").select("id").eq("id", "r2").maybeSingle();
  assert.deepEqual(one, { id: "r2" });

  assert.equal(calls.length, 3);
  assert.equal(clock.now, 1030);
  assert.deepEqual(calls.map((c) => c.rows), [1, 0, 1]);
});

test("tællende fake: ukendt filter kaster (fail-closed) i stedet for at gætte", () => {
  const sb = createCountingSupabase({ races: [] }, { clock: { now: 0 } });
  assert.throws(() => sb.from("races").select("id").or("a.eq.1,b.eq.2"), TypeError);
  assert.throws(() => sb.from("races").select("id, ukendt(x)"), /ukendt indlejret ressource/);
});

test("nuværende profil: en normal S5-løbsdag består alle grænser", async () => {
  const run = await simulateRaceDay({ date: DATE, scenario: "normal", profile: COST_PROFILES.current });
  const failed = run.checks.filter((c) => !c.ok).map((c) => c.id);
  assert.deepEqual(failed, []);
  assert.equal(run.passed, true);
  assert.equal(run.metrics.missing, 0);
  assert.equal(run.metrics.stagesRan, run.metrics.stagesExpected);
  assert.deepEqual(run.metrics.stagesExpectedBySquad, { senior: 37, u23: 10, junior: 10 });
  assert.ok(run.metrics.peakCallsPerMinute > 0 && run.metrics.peakCallsPerMinute <= DEFAULT_LIMITS.maxBackendCallsPerMinute);
  // Sweepen kører hele døgnet, også når intet er forfaldent.
  assert.ok(run.metrics.ticksRun >= 288);
  assert.ok(run.metrics.sweepCallsPerTickMedian > 0);
  // Aftentræningen startes én gang efter dagens sidste etape.
  assert.equal(run.metrics.concurrentJobs.filter((j) => j.kind === "training_close").length, 1);
  assert.match(renderMarkdown({ ...run, passed: run.passed, profile: "p", date: DATE, latencyMs: 10, finalShare: 1, scenarios: [run] }), /## normal: PASS/);
});

test("#5890-klassen: ungdomspuljer ukendt for scheduleren -> coverage fejler", async () => {
  const run = await simulateRaceDay({ date: DATE, scenario: "normal", youthGroups: 2, dropYouthPoolColumns: true });
  assert.equal(run.passed, false);
  const coverage = run.checks.find((c) => c.id === "coverage");
  assert.equal(coverage.ok, false);
  assert.deepEqual(run.metrics.missingBySquad, { u23: 2, junior: 2 });
  assert.ok(run.metrics.emptyPoolSkipLines > 0);
});

test("28/9-klassen: S4 løbsdag 1-profilen (tung afslutning, bestyrelse på ungdom) fejler", async () => {
  const run = await simulateRaceDay({ date: DATE, scenario: "normal", youthGroups: 2, profile: COST_PROFILES["legacy-s4-day1"] });
  assert.equal(run.passed, false);
  const tick = run.checks.find((c) => c.id === "tick_duration");
  assert.equal(tick.ok, false);
  assert.ok(tick.value > DEFAULT_LIMITS.maxTickDurationMs);
});

test("grænserne er konfigurerbare: et for stort svar fanges af rows_per_response", async () => {
  const run = await simulateRaceDay({
    date: DATE, scenario: "normal", youthGroups: 1, finalShare: 0,
    limits: { ...DEFAULT_LIMITS, maxRowsPerResponse: 5 },
  });
  const rows = run.checks.find((c) => c.id === "rows_per_response");
  assert.equal(rows.ok, false);
  assert.ok(rows.value > 5);
});

test("CLI: forkert brug giver exit 2, et bestået scenarie exit 0 med JSON", () => {
  const bad = spawnSync(process.execPath, [SCRIPT, "--profile", "prod"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /USAGE_INVALID_PROFILE/);

  const ok = spawnSync(process.execPath, [SCRIPT, "--scenarios", "normal", "--youth-groups", "2", "--json"], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const report = JSON.parse(ok.stdout);
  assert.equal(report.passed, true);
  assert.equal(report.scenarios.length, 1);
  assert.equal(report.scenarios[0].scenario, "normal");
});
