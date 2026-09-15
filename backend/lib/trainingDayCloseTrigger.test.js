// Tests for trainingDayCloseTrigger.js (#4847, fase B4).
//
// Daekker: tidsvindue (kl. 20), lukke-betingelsen (finalization), maks-ventetid +
// alarm, overlap-guarden (G6's "bevist i test"), dags-claimen, arbejdsplanen pr.
// division og det DEFINEREDE svar for AI-hold uden league_division_id.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  SWEEP_FROM_HOUR, MAX_WAIT_HOUR, DEFAULT_SQUAD,
  shouldSweepNow, waitedLongEnough, pendingStagesFor, gameDaysByDivision, buildSweepPlan,
  runTrainingDayCloseSweep, resolveDayCloseStatus, isTrainingDayCloseSweepRunning,
  __resetTrainingDayCloseStateForTests,
} from "./trainingDayCloseTrigger.js";

// ── Rene funktioner ──────────────────────────────────────────────────────────

describe("shouldSweepNow (#4847 — ejer 15/9: tidligst kl. 20 dansk tid)", () => {
  it("kl. 19:59 dansk tid er FOR tidligt", () => {
    // 2026-09-15T17:59:00Z = 19:59 CEST (UTC+2)
    assert.equal(shouldSweepNow(new Date("2026-09-15T17:59:00Z")), false);
  });
  it("praecis kl. 20:00 dansk tid er inden for vinduet", () => {
    assert.equal(shouldSweepNow(new Date("2026-09-15T18:00:00Z")), true);
  });
  it("vinduet er kl. 20, ikke kl. 22 som den gamle sweep", () => {
    assert.equal(SWEEP_FROM_HOUR, 20);
    // 20:30 CEST — for tidligt for trainingSweep.js, i vindue for denne.
    assert.equal(shouldSweepNow(new Date("2026-09-15T18:30:00Z")), true);
  });
  it("om morgenen er uden for vinduet", () => {
    assert.equal(shouldSweepNow(new Date("2026-09-15T06:00:00Z")), false);
  });
});

describe("waitedLongEnough (maks-ventetid paa haengende finalization)", () => {
  it("kl. 21 dansk tid venter vi stadig", () => {
    assert.equal(waitedLongEnough(new Date("2026-09-15T19:00:00Z")), false);
  });
  it(`kl. ${MAX_WAIT_HOUR} dansk tid venter vi ikke laengere`, () => {
    assert.equal(waitedLongEnough(new Date("2026-09-15T21:00:00Z")), true);
  });
});

describe("pendingStagesFor", () => {
  const race = (over) => ({ stages_completed: 3, finalize_state: null, ...over });

  it("en faerdigkoert etape uden trin-markering er lukket", () => {
    const rows = [{ race_id: "r1", stage_number: 3, game_day: 10 }];
    const byId = new Map([["r1", race()]]);
    assert.deepEqual(pendingStagesFor(rows, byId), []);
  });

  it("en etape der endnu ikke er koert er AABEN", () => {
    const rows = [{ race_id: "r1", stage_number: 4, game_day: 11 }];
    const byId = new Map([["r1", race({ stages_completed: 3 })]]);
    const pending = pendingStagesFor(rows, byId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].reason, "stage_not_run");
  });

  it("en halv finalization (#4147's trin-markering) holder dagen AABEN", () => {
    const rows = [{ race_id: "r1", stage_number: 3, game_day: 10 }];
    const byId = new Map([["r1", race({ finalize_state: { stage_index: 2, done: ["write"] } })]]);
    const pending = pendingStagesFor(rows, byId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].reason, "finalizing");
  });

  it("et ukendt loeb regnes som AABENT (fail-safe: udskyd frem for at gaette)", () => {
    const rows = [{ race_id: "ghost", stage_number: 1, game_day: 4 }];
    assert.equal(pendingStagesFor(rows, new Map())[0].reason, "race_missing");
  });
});

describe("gameDaysByDivision (akse-faelden: game_day LAESES, udledes aldrig)", () => {
  it("samler dagens loebsdage pr. division, stigende og deduperet", () => {
    const rows = [
      { race_id: "r1", game_day: 12 },
      { race_id: "r1", game_day: 11 },
      { race_id: "r2", game_day: 11 },
      { race_id: "r3", game_day: 40 },
    ];
    const div = new Map([["r1", "d1"], ["r2", "d1"], ["r3", "d2"]]);
    const out = gameDaysByDivision(rows, div);
    assert.deepEqual(out.get("d1"), [11, 12]);
    assert.deepEqual(out.get("d2"), [40]);
  });

  it("raekker uden division springes over", () => {
    const rows = [{ race_id: "r1", game_day: 3 }];
    assert.equal(gameDaysByDivision(rows, new Map([["r1", null]])).size, 0);
  });
});

describe("buildSweepPlan", () => {
  const byDivision = new Map([["d1", [10, 11, 12]], ["d2", [7]]]);

  it("EEN post pr. (hold, loebsdag) for holdets EGEN division", () => {
    const plan = buildSweepPlan({
      teams: [{ id: "t1", league_division_id: "d1" }],
      gameDaysByDivisionMap: byDivision,
      alreadyRanRaceDayKeys: new Set(),
      alreadyRanLegacyTeamIds: new Set(),
    });
    assert.deepEqual(plan.map((p) => p.gameDay), [10, 11, 12]);
    assert.ok(plan.every((p) => p.squad === DEFAULT_SQUAD));
  });

  it("allerede koerte loebsdage springes over (idempotens)", () => {
    const plan = buildSweepPlan({
      teams: [{ id: "t1", league_division_id: "d1" }],
      gameDaysByDivisionMap: byDivision,
      alreadyRanRaceDayKeys: new Set([`t1#${DEFAULT_SQUAD}#11`]),
      alreadyRanLegacyTeamIds: new Set(),
    });
    assert.deepEqual(plan.map((p) => p.gameDay), [10, 12]);
  });

  it("AI-hold UDEN league_division_id faar ÉT tick paa den gamle kalenderdags-noegle", () => {
    // Spec §3.2: 4 AI-hold maalt 6/9 har ingen division. Det DEFINEREDE svar er
    // gameDay: null — motorens fail-safe-kaskade falder saa tilbage til
    // (team_id, tick_date). De stopper altsaa ikke stille med at udvikle sig.
    const plan = buildSweepPlan({
      teams: [{ id: "ai1", league_division_id: null }],
      gameDaysByDivisionMap: byDivision,
      alreadyRanRaceDayKeys: new Set(),
      alreadyRanLegacyTeamIds: new Set(),
    });
    assert.deepEqual(plan, [{ teamId: "ai1", gameDay: null, squad: DEFAULT_SQUAD }]);
  });

  it("et division-loest hold der allerede har koert i dag springes over", () => {
    const plan = buildSweepPlan({
      teams: [{ id: "ai1", league_division_id: null }],
      gameDaysByDivisionMap: byDivision,
      alreadyRanRaceDayKeys: new Set(),
      alreadyRanLegacyTeamIds: new Set(["ai1"]),
    });
    assert.deepEqual(plan, []);
  });
});

// ── Supabase-mock ────────────────────────────────────────────────────────────
// Kaeden fanger .eq("key", ...) saa de tre flag-opslag (training_tick_per_race_day,
// daily_training_enabled, race_day_engine_enabled) kan svare hver for sig.

function makeSupabase({
  flags = {},
  season = { id: "s1", number: 4 },
  races = [],
  stages = [],
  teams = [],
  raceDayRuns = [],
  legacyRuns = [],
} = {}) {
  return {
    from(table) {
      const ctx = { table, key: null };
      const chain = {
        select() { return this; },
        in() { return this; },
        gte() { return this; },
        lt() { return this; },
        is() { return this; },
        order() { return this; },
        limit() { return this; },
        eq(col, val) { if (col === "key") ctx.key = val; return this; },
        maybeSingle() { return Promise.resolve(this.__resolve()); },
        __resolve() {
          if (table === "app_config") return { data: { value: flags[ctx.key] ?? false }, error: null };
          if (table === "seasons") return { data: season, error: null };
          if (table === "races") return { data: races, error: null };
          if (table === "race_stage_schedule") return { data: stages, error: null };
          if (table === "teams") return { data: teams, error: null };
          if (table === "training_day_runs") {
            // Sweepen laver to opslag: loebsdags-noeglen (.in("game_day", ...)) og den
            // gamle kalenderdags-noegle (.is("game_day", null)). Vi skelner paa om
            // .is() blev kaldt.
            return { data: ctx.legacy ? legacyRuns : raceDayRuns, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve, reject) { return Promise.resolve(this.__resolve()).then(resolve, reject); },
      };
      const originalIs = chain.is.bind(chain);
      chain.is = (...args) => { ctx.legacy = true; return originalIs(...args); };
      return chain;
    },
  };
}

const ALL_ON = { training_tick_per_race_day: true, daily_training_enabled: true, race_day_engine_enabled: false };

describe("runTrainingDayCloseSweep", () => {
  // 2026-09-15T18:30:00Z = 20:30 CEST (i vindue), 2026-09-15T21:30:00Z = 23:30 CEST.
  const inWindow = new Date("2026-09-15T18:30:00Z");
  const beforeWindow = new Date("2026-09-15T15:00:00Z"); // 17:00 CEST
  const afterMaxWait = new Date("2026-09-15T21:30:00Z");

  beforeEach(() => __resetTrainingDayCloseStateForTests());

  it("flag off = rent no-op (intet arbejde, ingen writes)", async () => {
    const supabase = makeSupabase({ flags: { training_tick_per_race_day: false } });
    let calls = 0;
    const result = await runTrainingDayCloseSweep({
      supabase, now: inWindow, runDay: async () => { calls++; return {}; },
    });
    assert.deepEqual(result, { ran: false, skipped: "flag_off" });
    assert.equal(calls, 0);
  });

  it("foer kl. 20 dansk tid koeres der ikke", async () => {
    const supabase = makeSupabase({ flags: ALL_ON });
    const result = await runTrainingDayCloseSweep({ supabase, now: beforeWindow });
    assert.equal(result.ran, false);
    assert.equal(result.skipped, "before_window");
  });

  it("udskyder saa laenge dagens sidste finalization ikke er faerdig", async () => {
    const supabase = makeSupabase({
      flags: ALL_ON,
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 2, finalize_state: null }],
      stages: [{ race_id: "r1", stage_number: 3, game_day: 40, scheduled_at: "2026-09-15T17:00:00Z" }],
      teams: [{ id: "t1", league_division_id: "d1" }],
    });
    let calls = 0;
    const result = await runTrainingDayCloseSweep({
      supabase, now: inWindow, runDay: async () => { calls++; return { alreadyRan: false }; },
    });
    assert.equal(result.skipped, "awaiting_finalization");
    assert.equal(result.pending, 1);
    assert.equal(calls, 0, "ingen ryttere maa traenes mens en etape stadig koerer");
  });

  it("efter maks-ventetiden koeres der ALLIGEVEL, og alarmen fyrer", async () => {
    const supabase = makeSupabase({
      flags: ALL_ON,
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 2, finalize_state: null }],
      stages: [{ race_id: "r1", stage_number: 3, game_day: 40, scheduled_at: "2026-09-15T17:00:00Z" }],
      teams: [{ id: "t1", league_division_id: "d1" }],
    });
    const alarms = [];
    const result = await runTrainingDayCloseSweep({
      supabase, now: afterMaxWait,
      runDay: async () => ({ alreadyRan: false }),
      onAlarm: (err, ctx) => alarms.push({ message: err.message, pending: ctx.pending.length }),
      logger: { error() {} },
    });
    assert.equal(result.ran, true);
    assert.equal(result.ranDespitePending, true);
    assert.equal(alarms.length, 1);
    assert.equal(alarms[0].pending, 1);
  });

  it("koerer ALLE dagens loebsdage for hvert hold i EEN koersel", async () => {
    const supabase = makeSupabase({
      flags: ALL_ON,
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 5, finalize_state: null }],
      stages: [
        { race_id: "r1", stage_number: 3, game_day: 40, scheduled_at: "2026-09-15T09:00:00Z" },
        { race_id: "r1", stage_number: 4, game_day: 41, scheduled_at: "2026-09-15T11:00:00Z" },
        { race_id: "r1", stage_number: 5, game_day: 42, scheduled_at: "2026-09-15T13:00:00Z" },
      ],
      teams: [{ id: "t1", league_division_id: "d1" }, { id: "t2", league_division_id: "d1" }],
    });
    const seen = [];
    const result = await runTrainingDayCloseSweep({
      supabase, now: inWindow,
      runDay: async ({ teamId, gameDay, squad, executedBy }) => {
        seen.push(`${teamId}:${gameDay}:${squad}:${executedBy}`);
        return { alreadyRan: false };
      },
    });
    assert.equal(result.ran, true);
    assert.equal(result.swept, 6, "2 hold x 3 loebsdage");
    assert.deepEqual(seen, [
      "t1:40:senior:assistant", "t1:41:senior:assistant", "t1:42:senior:assistant",
      "t2:40:senior:assistant", "t2:41:senior:assistant", "t2:42:senior:assistant",
    ]);
  });

  it("OVERLAP-GUARD (G6): en sweep mens en anden koerer springes over", async () => {
    const supabase = makeSupabase({
      flags: ALL_ON,
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 3, finalize_state: null }],
      stages: [{ race_id: "r1", stage_number: 3, game_day: 40, scheduled_at: "2026-09-15T09:00:00Z" }],
      teams: [{ id: "t1", league_division_id: "d1" }],
    });
    let second = null;
    const first = runTrainingDayCloseSweep({
      supabase, now: inWindow,
      runDay: async () => {
        // Midt i foerste sweep: forsoeg nummer to, som cron'ens 5-min-tick ville.
        assert.equal(isTrainingDayCloseSweepRunning(), true);
        second = await runTrainingDayCloseSweep({ supabase, now: inWindow, runDay: async () => ({}) });
        return { alreadyRan: false };
      },
    });
    const result = await first;
    assert.equal(result.ran, true);
    assert.deepEqual(second, { ran: false, skipped: "overlap" });
    assert.equal(isTrainingDayCloseSweepRunning(), false, "guarden frigives i finally");
  });

  it("DAGS-CLAIM: anden koersel samme kalenderdag er et no-op", async () => {
    const supabase = makeSupabase({
      flags: ALL_ON,
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 3, finalize_state: null }],
      stages: [{ race_id: "r1", stage_number: 3, game_day: 40, scheduled_at: "2026-09-15T09:00:00Z" }],
      teams: [{ id: "t1", league_division_id: "d1" }],
    });
    const runDay = async () => ({ alreadyRan: false });
    const first = await runTrainingDayCloseSweep({ supabase, now: inWindow, runDay });
    assert.equal(first.ran, true);
    const second = await runTrainingDayCloseSweep({ supabase, now: inWindow, runDay });
    assert.equal(second.skipped, "already_done_today");
  });

  it("en fejlende hold-koersel stopper ikke resten", async () => {
    const supabase = makeSupabase({
      flags: ALL_ON,
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 3, finalize_state: null }],
      stages: [{ race_id: "r1", stage_number: 3, game_day: 40, scheduled_at: "2026-09-15T09:00:00Z" }],
      teams: [{ id: "t1", league_division_id: "d1" }, { id: "t2", league_division_id: "d1" }],
    });
    const result = await runTrainingDayCloseSweep({
      supabase, now: inWindow, logger: { error() {} },
      runDay: async ({ teamId }) => {
        if (teamId === "t1") throw new Error("boom");
        return { alreadyRan: false };
      },
    });
    assert.equal(result.failed, 1);
    assert.equal(result.swept, 1);
    assert.equal(result.failures[0].teamId, "t1");
  });
});

describe("resolveDayCloseStatus (samme betingelse som knappen bruger)", () => {
  const inWindow = new Date("2026-09-15T18:30:00Z");

  it("closed=true naar dagens etaper er koert og intet finaliserer", async () => {
    const supabase = makeSupabase({
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 3, finalize_state: null }],
      stages: [{ race_id: "r1", stage_number: 3, game_day: 40, scheduled_at: "2026-09-15T09:00:00Z" }],
    });
    const out = await resolveDayCloseStatus({ supabase, seasonId: "s1", now: inWindow, divisionId: "d1" });
    assert.equal(out.closed, true);
    assert.deepEqual(out.gameDays, [40]);
  });

  it("closed=false mens en etape stadig finaliserer", async () => {
    const supabase = makeSupabase({
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 3, finalize_state: { done: ["write"] } }],
      stages: [{ race_id: "r1", stage_number: 3, game_day: 40, scheduled_at: "2026-09-15T09:00:00Z" }],
    });
    const out = await resolveDayCloseStatus({ supabase, seasonId: "s1", now: inWindow, divisionId: "d1" });
    assert.equal(out.closed, false);
    assert.equal(out.reason, "awaiting_finalization");
  });

  it("kaster aldrig — en daarlig client giver closed:false", async () => {
    const out = await resolveDayCloseStatus({ supabase: null, seasonId: "s1" });
    assert.equal(out.closed, false);
    assert.equal(out.reason, "bad_args");
  });
});
