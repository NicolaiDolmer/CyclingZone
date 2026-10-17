// #5904 · Tests for løbsdags-dry-run-gaten (backend/scripts/loadtestRaceDay.mjs).
// Bevis for at gaten fanger de to kendte fejlklasser fra S4 løbsdag 1 (#5893):
//   - #5890: ungdomspuljer ukendte for scheduleren -> ungdomsløb springes tavst over
//   - #5892/#3624: tung afslutning (bestyrelse på ungdomsløb, Discord i ticket) -> tick
//     når ikke at blive færdigt
// og at den nuværende profil består en normal S5-løbsdag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  trainingCloseStart,
  TRAINING_DAY_CLOSE_CRON_PERIOD_MS,
  youthSlotsFor,
} from "./loadtestRaceDay.mjs";
import { squadSlotsForDate } from "../lib/squadCalendarPacker.js";
import { SQUAD_CALENDAR } from "../lib/calendarTierCaps.js";
import { STAGE_TICK_PERIOD_MS, STAGE_TICK_OFFSET_MS } from "../lib/schedulerTick.js";
import { startTrainingDayCloseAfterStages, SWEEP_FROM_HOUR } from "../lib/trainingDayCloseTrigger.js";

const SCRIPT = fileURLToPath(new URL("./loadtestRaceDay.mjs", import.meta.url));
const CRON_SRC = readFileSync(fileURLToPath(new URL("../cron.js", import.meta.url)), "utf8");
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

test("fixture: sæsonens sidste løbsdag slutter kl. 15 for senior; U23 flyttes væk fra seniorens 15:00 (#6772)", () => {
  const { expected } = buildRaceDayFixture({ date: DATE, scenario: "season-last-day", youthGroups: 2 });
  const hhmm = (squad) => [...new Set(expected.filter((e) => e.squad === squad).map((e) => copenhagenHHMM(e.scheduledMs)))];
  const seniorLatest = Math.max(...expected.filter((e) => e.squad === "senior").map((e) => e.scheduledMs));
  assert.equal(copenhagenHHMM(seniorLatest), "15:00");
  // Samme tider som materializeren skriver (squadSlotsForDate): U23's 16:30 presses til 15:00
  // af sidste-dags-reglen og rykkes derefter et skridt, fordi seniorens 15:00 er optaget.
  assert.deepEqual(hhmm("u23"), ["15:05"]);
  assert.deepEqual(hhmm("junior"), ["14:30"]);
  const seniorSlots = new Set(hhmm("senior"));
  assert.ok(![...hhmm("u23"), ...hhmm("junior")].some((t) => seniorSlots.has(t)), "ingen ungdomsetape deler tid med senior");
});

test("paritet: ungdomstiderne kommer fra materializerens kilde (squadSlotsForDate)", () => {
  const src = readFileSync(fileURLToPath(new URL("../lib/tierCalendarMaterializer.js", import.meta.url)), "utf8");
  assert.match(src, /squadSlotsForDate\(\{ squad, tier, localDate, squadSlots: squadSlots\[tier\], otherSquadSlots, notBefore: planningNotBefore, seasonLastRaceDay: lastRaceDay \}\)/);
  for (const date of [DATE, "2026-10-25"]) {
    for (const last of [null, date]) {
      const other = (squad) => Object.entries(SQUAD_CALENDAR).filter(([s]) => s !== squad).map(([, c]) => c.stageSlot);
      for (const squad of Object.keys(SQUAD_CALENDAR)) {
        const direct = squadSlotsForDate({ squad, tier: 1, localDate: date, squadSlots: [SQUAD_CALENDAR[squad].stageSlot], otherSquadSlots: other(squad), seasonLastRaceDay: last });
        assert.deepEqual(youthSlotsFor(squad, date, last), direct, `${squad} ${date} last=${last}`);
      }
    }
  }
});

test("#6772: sæsonens sidste løbsdag består med nuværende profil (også S4's skiftedag 25/10)", async () => {
  for (const date of [DATE, "2026-10-25"]) {
    const run = await simulateRaceDay({ date, scenario: "season-last-day", profile: COST_PROFILES.current });
    const failed = run.checks.filter((c) => !c.ok).map((c) => c.id);
    assert.deepEqual(failed, [], date);
    assert.equal(run.metrics.ticksSkippedOverlap, 0, date);
    assert.ok(run.metrics.maxTickDurationMs <= DEFAULT_LIMITS.maxTickDurationMs, date);
  }
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
  // Aftentræningen startes én gang. Dagens sidste etape slutter før kl. 20, så kl. 20-
  // gaten afviser den tidlige start, og cron'en starter den ved vinduets åbning.
  const training = run.metrics.concurrentJobs.filter((j) => j.kind === "training_close");
  assert.equal(training.length, 1);
  assert.deepEqual({ at: training[0].at, trigger: training[0].trigger }, { at: "20:00", trigger: "cron" });
  assert.equal(run.metrics.trainingClose.at, "20:00");
  assert.match(renderMarkdown({ ...run, passed: run.passed, profile: "p", date: DATE, latencyMs: 10, finalShare: 1, scenarios: [run] }), /## normal: PASS/);
});

test("aftentræning: sæsonens sidste løbsdag (sidste etape ca. 15) starter også først kl. 20 via cron", async () => {
  const run = await simulateRaceDay({ date: DATE, scenario: "season-last-day", youthGroups: 2 });
  const training = run.metrics.concurrentJobs.filter((j) => j.kind === "training_close");
  assert.equal(training.length, 1);
  assert.equal(training[0].at, "20:00");
  assert.equal(training[0].trigger, "cron");
  // Ingen træningskald før kl. 20: peak-minuttet ligger ved eftermiddagens etaper.
  assert.ok(run.metrics.peakMinute < "20:00", run.metrics.peakMinute);
  assert.match(renderMarkdown({ ...run, profile: "p", date: DATE, latencyMs: 10, finalShare: 1, scenarios: [run] }), /Aftentræning: kl\. 20:00 \(startet af cron\)/);
});

test("trainingCloseStart: før kl. 20 venter den på cron, efter kl. 20 starter scheduleren straks", () => {
  // Normal dag: sidste etape ca. 19:00 -> cron kl. 20:00 (ikke 19:00).
  const at1900 = copenhagenSlotMs(DATE, "19:00") + 17_000;
  assert.deepEqual(trainingCloseStart(at1900), { startMs: copenhagenSlotMs(DATE, "20:00"), trigger: "cron" });
  // Sæsonens sidste løbsdag: sidste etape ca. 15:00 -> stadig kl. 20:00.
  assert.deepEqual(trainingCloseStart(copenhagenSlotMs(DATE, "15:03")), { startMs: copenhagenSlotMs(DATE, "20:00"), trigger: "cron" });
  // Lige før vinduet: første cron-tick ER vinduets åbning.
  assert.equal(trainingCloseStart(copenhagenSlotMs(DATE, "19:59")).startMs, copenhagenSlotMs(DATE, "20:00"));
  // Sidste etape efter kl. 20 -> stage-scheduleren starter den med det samme.
  const at2007 = copenhagenSlotMs(DATE, "20:07") + 3_000;
  assert.deepEqual(trainingCloseStart(at2007), { startMs: at2007, trigger: "stage-scheduler" });
  // Sommertid: gaten er dansk tid, ikke UTC.
  const summer = "2026-06-20";
  assert.deepEqual(trainingCloseStart(copenhagenSlotMs(summer, "18:10")), { startMs: copenhagenSlotMs(summer, "20:00"), trigger: "cron" });
});

test("paritet: trainingCloseStart følger prod-gaten i startTrainingDayCloseAfterStages", () => {
  assert.equal(SWEEP_FROM_HOUR, 20);
  const quiet = { log() {}, error() {} };
  const runSweep = async () => ({ ran: false });
  for (const hhmm of ["14:59", "15:04", "19:00", "19:59", "20:00", "20:01", "21:30", "23:55"]) {
    const t = copenhagenSlotMs(DATE, hhmm);
    const prod = startTrainingDayCloseAfterStages({ supabase: { from() {} }, stagesRan: 1, clock: () => new Date(t), runSweep, logger: quiet });
    const modelImmediate = trainingCloseStart(t).trigger === "stage-scheduler";
    assert.equal(prod !== null, modelImmediate, `kl. ${hhmm}`);
  }
});

test("paritet: cron-kadencen for training day-close er 5 min som i cron.js", () => {
  assert.equal(TRAINING_DAY_CLOSE_CRON_PERIOD_MS, 5 * 60 * 1000);
  assert.match(CRON_SRC, /trackedTick\("training day-close",[^\n]*\),\s*5 \* 60 \* 1000\s*\)/);
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
