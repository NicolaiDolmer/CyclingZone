// Tests for trainingDayCloseTrigger.js (#4847, fase B4).
//
// Daekker: tidsvindue (kl. 20), lukke-betingelsen (finalization), maks-ventetid +
// alarm, overlap-guarden (G6's "bevist i test"), dags-claimen, arbejdsplanen pr.
// division og det DEFINEREDE svar for AI-hold uden league_division_id.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  SWEEP_FROM_HOUR, MAX_WAIT_HOUR, DEFAULT_SQUAD,
  MAX_GAME_DAY_CATCH_UP, NO_PRIOR_GAME_DAY,
  shouldSweepNow, waitedLongEnough, pendingStagesFor, gameDaysByDivision, buildSweepPlan,
  gameDaySpansByDivision, groupRaceIdsByDivision, axisEndByDivisionFor,
  loadPriorMaxGameDayByDivision, loadLastRaceDateByDivision,
  runTrainingDayCloseSweep, resolveDayCloseStatus, isTrainingDayCloseSweepRunning,
  __resetTrainingDayCloseStateForTests,
} from "./trainingDayCloseTrigger.js";
import { resolveCalendarRaceDayTarget } from "./trainingRaceDayTick.js";
import { SEASON_RACE_DAY_TARGET } from "./calendarRaceDayTargets.js";

// En saeson UDEN eget maal i kalenderens tabel (i dag alle andre end S4). Udledt, saa
// testene ikke raadner naar et nyt saesonmaal tilfoejes.
const NO_TARGET_SEASON = [3, 2, 1, 999].find((n) => SEASON_RACE_DAY_TARGET[n] === undefined);

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
    // #4629: programslottet er pladsen paa HELE datoens liste, ogsaa naar 11 er koert.
    assert.ok(plan.every((p) => p.dateGameDays.join() === "10,11,12"));
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
  // #4847 regel 4: etaper FOER dagens doegn. loadPriorMaxGameDayByDivision
  // spoerger med .lt("scheduled_at") UDEN .gte(), saa vi kan skelne de to
  // race_stage_schedule-opslag paa netop det.
  priorStages = null,
  // #4846: etaper EFTER dagens doegn. loadLastRaceDateByDivision spoerger med
  // .gte("scheduled_at") UDEN .lt(). null = dagens egne etaper (altsaa "der kommer
  // mere"), saa de oevrige tests ikke rammer saesonens sidste loebsdato ved et uheld.
  laterStages = null,
  priorError = false,
  laterError = false,
  seasonError = false,
  // Kun til bit-identitets-testen: hvilke tabeller blev der spurgt paa?
  tableLog = null,
  teams = [],
  raceDayRuns = [],
  legacyRuns = [],
} = {}) {
  return {
    from(table) {
      tableLog?.push(table);
      const ctx = { table, key: null, gte: false, lt: false, order: null, limit: null };
      const chain = {
        select() { return this; },
        in() { return this; },
        gte() { ctx.gte = true; return this; },
        lt() { ctx.lt = true; return this; },
        is() { return this; },
        order(col, o = {}) { ctx.order = { col, ascending: o.ascending !== false }; return this; },
        limit(n) { ctx.limit = n; return this; },
        // fetchAllRows paginerer det bestands-brede training_day_runs-opslag.
        // Fixturen er altid under én side, saa foerste .range() leverer alt og
        // loekken stopper; vi markerer blot at kaeden kender kaldet.
        range() { ctx.ranged = true; return this; },
        eq(col, val) { if (col === "key") ctx.key = val; return this; },
        maybeSingle() { return Promise.resolve(this.__resolve()); },
        __resolve() {
          if (table === "app_config") return { data: { value: flags[ctx.key] ?? false }, error: null };
          if (table === "seasons") {
            return seasonError ? { data: null, error: { message: "boom" } } : { data: season, error: null };
          }
          if (table === "races") return { data: races, error: null };
          if (table === "race_stage_schedule") {
            // Dagens etaper filtreres med .gte(dayStart).lt(dayEnd); "sidste
            // loebsdag foer i dag" med .lt(dayStart) + order desc + limit 1; "findes
            // der etaper efter i dag" (#4846) med .gte(dayEnd) + limit 1.
            if (ctx.gte && ctx.lt) return { data: stages, error: null };
            if (ctx.gte) {
              if (laterError) return { data: null, error: { message: "boom" } };
              const rows = laterStages ?? stages;
              return { data: Number.isFinite(ctx.limit) ? rows.slice(0, ctx.limit) : rows, error: null };
            }
            if (priorError) return { data: null, error: { message: "boom" } };
            let rows = priorStages ?? stages;
            if (ctx.order) {
              rows = [...rows].sort((a, b) => (ctx.order.ascending
                ? Number(a[ctx.order.col]) - Number(b[ctx.order.col])
                : Number(b[ctx.order.col]) - Number(a[ctx.order.col])));
            }
            if (Number.isFinite(ctx.limit)) rows = rows.slice(0, ctx.limit);
            return { data: rows, error: null };
          }
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

  it("#4846 flag off = bit-identisk: kun flag-opslaget, ingen af kanternes opslag", async () => {
    // De nye opslag (sidste-dato-query, saesonens maal) ligger EFTER flag-gaten.
    // Med flaget off maa sweepen ikke spoerge paa andet end sit eget flag.
    const tableLog = [];
    const supabase = makeSupabase({
      flags: { training_tick_per_race_day: false, daily_training_enabled: true },
      tableLog,
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 3, finalize_state: null }],
      stages: [{ race_id: "r1", stage_number: 3, game_day: 138, scheduled_at: "2026-09-15T09:00:00Z" }],
      laterStages: [],
      teams: [{ id: "t1", league_division_id: "d1" }],
    });
    const result = await runTrainingDayCloseSweep({ supabase, now: inWindow, runDay: async () => ({}) });
    assert.deepEqual(result, { ran: false, skipped: "flag_off" });
    assert.deepEqual(tableLog, ["app_config"]);
  });

  // #4848: off-season er en DEFINERET, LOGGET tilstand — ikke en stille no-op.
  it("off-season: intet tick, en defineret returvaerdi, og EN logget linje pr. dansk dato", async () => {
    const supabase = makeSupabase({ flags: ALL_ON, season: null, teams: [{ id: "t1", league_division_id: "d1" }] });
    const lines = [];
    const logger = { warn: (m) => lines.push(m), error() {} };
    let calls = 0;
    const runDay = async () => { calls++; return { alreadyRan: false }; };

    const first = await runTrainingDayCloseSweep({ supabase, now: inWindow, runDay, logger });
    assert.deepEqual(first, { ran: false, skipped: "no_active_season", offSeason: true, tickDate: "2026-09-15" });
    await runTrainingDayCloseSweep({ supabase, now: new Date("2026-09-15T19:00:00Z"), runDay, logger });
    assert.equal(lines.length, 1, "samme dato ⇒ én linje, ikke én pr. 5-min-tick");
    assert.match(lines[0], /off-season/);

    await runTrainingDayCloseSweep({ supabase, now: new Date("2026-09-16T18:30:00Z"), runDay, logger });
    assert.equal(lines.length, 2, "ny dato ⇒ ny linje");
    assert.equal(calls, 0, "ingen hold trænes i off-season");
  });

  it("off-season saetter IKKE dags-claimen: en saeson der aktiveres senere samme aften koerer stadig", async () => {
    const logger = { warn() {}, error() {} };
    const offSeason = makeSupabase({ flags: ALL_ON, season: null });
    await runTrainingDayCloseSweep({ supabase: offSeason, now: inWindow, logger });
    const active = makeSupabase({
      flags: ALL_ON,
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 1, finalize_state: null }],
      stages: [{ race_id: "r1", stage_number: 1, game_day: 0, scheduled_at: "2026-09-15T10:00:00Z" }],
      teams: [{ id: "t1", league_division_id: "d1" }],
    });
    let calls = 0;
    const result = await runTrainingDayCloseSweep({
      supabase: active, now: new Date("2026-09-15T19:00:00Z"), logger,
      runDay: async () => { calls++; return { alreadyRan: false }; },
    });
    assert.equal(result.ran, true);
    assert.equal(calls, 1);
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
    const slotLists = [];
    const result = await runTrainingDayCloseSweep({
      supabase, now: inWindow,
      runDay: async ({ teamId, gameDay, squad, executedBy, dateGameDays }) => {
        seen.push(`${teamId}:${gameDay}:${squad}:${executedBy}`);
        slotLists.push(dateGameDays.join());
        return { alreadyRan: false };
      },
    });
    assert.equal(result.ran, true);
    assert.equal(result.swept, 6, "2 hold x 3 loebsdage");
    // #4629: motoren faar datoens hele liste, saa programslottet = plads paa den.
    assert.ok(slotLists.every((l) => l === "40,41,42"), slotLists.join(" | "));
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

  it("en fejlet koersel LAASER IKKE dagen: naeste tick proever igen", async () => {
    // Dags-claimen er kapacitet, ikke korrekthed. Saettes den mens et hold fejlede,
    // kigger resten af aftenens ticks slet ikke paa det hold igen — og den gamle
    // trainingSweep.js er ingen bagstopper (den filtrerer paa (team_id, tick_date),
    // saa en ANDEN vellykket loebsdag samme dato faar den til at springe holdet over).
    const supabase = makeSupabase({
      flags: ALL_ON,
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 3, finalize_state: null }],
      stages: [{ race_id: "r1", stage_number: 3, game_day: 40, scheduled_at: "2026-09-15T09:00:00Z" }],
      teams: [{ id: "t1", league_division_id: "d1" }],
    });
    let attempts = 0;
    const runDay = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("forbigaaende netvaerksfejl");
      return { alreadyRan: false };
    };
    const first = await runTrainingDayCloseSweep({ supabase, now: inWindow, runDay, logger: { error() {} } });
    assert.equal(first.failed, 1);

    const second = await runTrainingDayCloseSweep({ supabase, now: inWindow, runDay, logger: { error() {} } });
    assert.notEqual(second.skipped, "already_done_today", "en fejlet dag maa ALDRIG claimes");
    assert.equal(second.swept, 1, "naeste tick koerer holdet igen");
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

// ── #4847: ejerens realisme-regel 4 (18/9) ───────────────────────────────────
//
// "Alle divisioner faar lige mange loebsdage; loebsdage uden loeb er rene
// traeningsdage." `gameDaysByDivision` ser kun de loebsdage der HAR en etape i dag,
// saa en ren traeningsdag fik intet tick. Det var ejerens tredje fund i denne PR.
//
// Loesningen er aksens monotoni: hele spaendet fra divisionens sidste loebsdag FOER
// i dag til dagens hoejeste er lukket i aften, og de af dem uden etape ER de rene
// traeningsdage. Ingen loebsdag udledes af scheduled_at (akse-faelden).

describe("gameDaySpansByDivision (#4847 regel 4: rene traeningsdage faar ogsaa et tick)", () => {
  const div = new Map([["r1", "d1"], ["r2", "d2"]]);

  it("hullet mellem gaarsdagens sidste loebsdag og dagens er RENE TRAENINGSDAGE", () => {
    // Divisionen koerte sidst loebsdag 40 i gaar; i dag har den loeb paa 43.
    // 41 og 42 har ingen etape — det er dem regel 4 handler om.
    const out = gameDaySpansByDivision(
      [{ race_id: "r1", game_day: 43 }], div, new Map([["d1", 40]]),
    );
    assert.deepEqual(out.get("d1").gameDays, [41, 42, 43]);
    assert.deepEqual(out.get("d1").skippedGameDays, []);
  });

  // #4846: den tidligere test her ("uden en tidligere loebsdag tickes KUN dagens
  // egne") laaste den FORKERTE adfaerd. Pakkeren (#5267) lae­gger tomme loebsdage
  // foran datoens foerste loeb — ogsaa paa loebsdag 0 — saa saesonens foerste
  // loebsdato skal starte paa loebsdag 0, ellers ender divisionen under 140.
  // "Ved det ikke" (null) og "der er ingen" (NO_PRIOR_GAME_DAY) er to svar.
  it("#4846 saesonens foerste loebsdato (NO_PRIOR_GAME_DAY): spaendet starter paa loebsdag 0", () => {
    const out = gameDaySpansByDivision(
      [{ race_id: "r1", game_day: 2 }, { race_id: "r1", game_day: 4 }], div,
      new Map([["d1", NO_PRIOR_GAME_DAY]]),
    );
    assert.deepEqual(out.get("d1").gameDays, [0, 1, 2, 3, 4],
      "loebsdag 0 og 1 er tomme traeningsdage paa saesonens foerste dato og SKAL tickes");
    assert.deepEqual(out.get("d1").skippedGameDays, []);
  });

  it("#4846 UKENDT tidligere loebsdag (opslaget fejlede): fail-safe, kun dagens egne", () => {
    for (const prior of [null, undefined]) {
      const out = gameDaySpansByDivision(
        [{ race_id: "r1", game_day: 3 }, { race_id: "r1", game_day: 4 }], div, new Map([["d1", prior]]),
      );
      assert.deepEqual(out.get("d1").gameDays, [3, 4], "vi opfinder aldrig en loebsdag paa et gaet");
    }
  });

  it("#4846 saesonens sidste loebsdato: spaendet forlaenges til aksens sidste loebsdag", () => {
    // Sidste dato baerer loeb paa 136 og 138; 137 og 139 er tomme. 139 ligger EFTER
    // aksens sidste loeb og har ingen senere dato der kan lukke den.
    const out = gameDaySpansByDivision(
      [{ race_id: "r1", game_day: 136 }, { race_id: "r1", game_day: 138 }], div,
      new Map([["d1", 134]]), { axisEndByDivision: new Map([["d1", 139]]) },
    );
    assert.deepEqual(out.get("d1").gameDays, [135, 136, 137, 138, 139]);
    assert.deepEqual(out.get("d1").droppedExtensionGameDays, []);
  });

  // Diff-tjekket af PR #5608 (24/9): med en akse KORTERE end maalet blev spaendet
  // prior+1..139, og loftet beholdt de NYESTE — loebsdage der ikke findes — og sprang
  // dagens egne over. Probe: prior 80, i dag 81-85, akse-ende 139.
  it("#4846 akse < maal: forlaengelsen fortraenger ALDRIG dagens egne loebsdage", () => {
    const today = [81, 82, 83, 84, 85].map((game_day) => ({ race_id: "r1", game_day }));
    const out = gameDaySpansByDivision(
      today, div, new Map([["d1", 80]]), { axisEndByDivision: new Map([["d1", 139]]) },
    ).get("d1");
    assert.deepEqual(out.gameDays, [81, 82, 83, 84, 85], "dagens egne loebsdage koeres");
    assert.deepEqual(out.skippedGameDays, [], "intet af dagens eget spaend springes over");
    assert.equal(out.droppedExtensionGameDays[0], 86);
    assert.equal(out.droppedExtensionGameDays.at(-1), 139);
    assert.equal(out.droppedExtensionGameDays.length, 54, "forlaengelsen droppes HELT og synligt");
  });

  it("#4846 forlaengelsen er alt-eller-intet: praecis paa loftet tages den med, een over droppes den", () => {
    const today = [132, 133, 134, 135, 136].map((game_day) => ({ race_id: "r1", game_day }));
    const prior = new Map([["d1", 131]]);
    const fits = gameDaySpansByDivision(today, div, prior, {
      axisEndByDivision: new Map([["d1", 139]]), maxCatchUp: 8,
    }).get("d1");
    assert.deepEqual(fits.gameDays, [132, 133, 134, 135, 136, 137, 138, 139]);
    assert.deepEqual(fits.droppedExtensionGameDays, []);

    const over = gameDaySpansByDivision(today, div, prior, {
      axisEndByDivision: new Map([["d1", 139]]), maxCatchUp: 7,
    }).get("d1");
    assert.deepEqual(over.gameDays, [132, 133, 134, 135, 136], "aldrig et delvist stykke af forlaengelsen");
    assert.deepEqual(over.droppedExtensionGameDays, [137, 138, 139]);
    assert.deepEqual(over.skippedGameDays, []);
  });

  it("#4846 et efterslaeb over loftet paa sidste loebsdato: loftet som hidtil, forlaengelsen droppes", () => {
    const out = gameDaySpansByDivision(
      [{ race_id: "r1", game_day: 136 }], div, new Map([["d1", 120]]),
      { axisEndByDivision: new Map([["d1", 139]]) },
    ).get("d1");
    assert.equal(out.gameDays.at(-1), 136, "dagens hoejeste loebsdag er altid med");
    assert.equal(out.gameDays.length, MAX_GAME_DAY_CATCH_UP);
    assert.deepEqual(out.droppedExtensionGameDays, [137, 138, 139]);
  });

  it("#4846 uden en akse-ende (null, eller ikke i mappen) forlaenges intet", () => {
    const rows = [{ race_id: "r1", game_day: 138 }, { race_id: "r2", game_day: 60 }];
    const prior = new Map([["d1", 137], ["d2", 59]]);
    const out = gameDaySpansByDivision(rows, div, prior, { axisEndByDivision: new Map([["d1", null]]) });
    assert.deepEqual(out.get("d1").gameDays, [138]);
    assert.deepEqual(out.get("d2").gameDays, [60], "en division uden akse-ende roeres ikke");
  });

  it("#4846 en akse-ende FOER dagens egne loebsdage afkorter aldrig dagen", () => {
    const out = gameDaySpansByDivision(
      [{ race_id: "r1", game_day: 150 }], div, new Map([["d1", 149]]),
      { axisEndByDivision: new Map([["d1", 139]]) },
    );
    assert.deepEqual(out.get("d1").gameDays, [150], "en kalender laengere end maalet mister intet");
  });

  it("er gaarsdagens sidste loebsdag naboen, er der intet hul", () => {
    const out = gameDaySpansByDivision(
      [{ race_id: "r1", game_day: 41 }], div, new Map([["d1", 40]]),
    );
    assert.deepEqual(out.get("d1").gameDays, [41]);
  });

  it("en division UDEN loeb i dag faar intet spaend (dagens hoejeste loebsdag kan ikke laeses)", () => {
    const out = gameDaySpansByDivision(
      [{ race_id: "r1", game_day: 43 }], div, new Map([["d1", 40], ["d2", 12]]),
    );
    assert.equal(out.has("d2"), false, "uden dagens hoejeste loebsdag kan spaendets ende ikke laeses");
  });

  it("ops-loftet koerer de NYESTE loebsdage og RAPPORTERER resten (aldrig tavst)", () => {
    const out = gameDaySpansByDivision(
      [{ race_id: "r1", game_day: 60 }], div, new Map([["d1", 40]]),
      { maxCatchUp: 3 },
    );
    assert.deepEqual(out.get("d1").gameDays, [58, 59, 60]);
    assert.equal(out.get("d1").skippedGameDays[0], 41);
    assert.equal(out.get("d1").skippedGameDays.at(-1), 57);
  });

  it("MAX_GAME_DAY_CATCH_UP er default-loftet", () => {
    const out = gameDaySpansByDivision(
      [{ race_id: "r1", game_day: 100 }], div, new Map([["d1", 1]]),
    );
    assert.equal(out.get("d1").gameDays.length, MAX_GAME_DAY_CATCH_UP);
    assert.equal(out.get("d1").gameDays.at(-1), 100);
  });

  it("et prior der ligger EFTER dagens egne loebsdage falder tilbage til dagens (omlagt schedule)", () => {
    const out = gameDaySpansByDivision(
      [{ race_id: "r1", game_day: 20 }], div, new Map([["d1", 99]]),
    );
    assert.deepEqual(out.get("d1").gameDays, [20], "aldrig et tomt eller bagvendt spaend");
  });
});

describe("groupRaceIdsByDivision", () => {
  it("grupperer loeb pr. division og springer de division-loese over", () => {
    const out = groupRaceIdsByDivision([
      { id: "r1", league_division_id: "d1" },
      { id: "r2", league_division_id: "d1" },
      { id: "r3", league_division_id: null },
    ]);
    assert.deepEqual(out.get("d1"), ["r1", "r2"]);
    assert.equal(out.size, 1);
  });
});

describe("runTrainingDayCloseSweep + regel 4 (rene traeningsdage i sweepen)", () => {
  beforeEach(() => __resetTrainingDayCloseStateForTests());
  const inWindow = new Date("2026-09-15T18:30:00Z"); // 20:30 CEST

  it("en loebsdag UDEN loeb faar sit eget tick", async () => {
    // Divisionen koerte sidst loebsdag 40 (i gaar). I dag koeres kun loebsdag 42.
    // Loebsdag 41 har ingen etape — den er en ren traeningsdag og SKAL tickes.
    const supabase = makeSupabase({
      flags: ALL_ON,
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 9, finalize_state: null }],
      stages: [{ race_id: "r1", stage_number: 9, game_day: 42, scheduled_at: "2026-09-15T17:00:00Z" }],
      priorStages: [{ race_id: "r1", game_day: 40 }],
      teams: [{ id: "t1", league_division_id: "d1" }],
    });
    const ran = [];
    const result = await runTrainingDayCloseSweep({
      supabase, now: inWindow,
      runDay: async ({ gameDay }) => { ran.push(gameDay); return { alreadyRan: false }; },
    });
    assert.equal(result.ran, true);
    assert.deepEqual(ran, [41, 42], "loebsdag 41 er en ren traeningsdag og maa ikke springes over");
    assert.deepEqual(result.gameDays, [41, 42]);
  });

  // #4846: her stod "uden en tidligere loebsdag koeres kun dagens egne (uaendret
  // adfaerd)". Den laaste netop den adfaerd der tabte loebsdag 0 og 1 paa saesonens
  // foerste dato. Et VELLYKKET, tomt prior-opslag betyder nu loebsdag 0.
  it("#4846 saesonens foerste loebsdato: sweepen starter paa loebsdag 0", async () => {
    const supabase = makeSupabase({
      flags: ALL_ON,
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 2, finalize_state: null }],
      stages: [
        { race_id: "r1", stage_number: 1, game_day: 2, scheduled_at: "2026-09-15T09:00:00Z" },
        { race_id: "r1", stage_number: 2, game_day: 4, scheduled_at: "2026-09-15T15:00:00Z" },
      ],
      priorStages: [],
      teams: [{ id: "t1", league_division_id: "d1" }],
    });
    const ran = [];
    const result = await runTrainingDayCloseSweep({
      supabase, now: inWindow,
      runDay: async ({ gameDay }) => { ran.push(gameDay); return { alreadyRan: false }; },
    });
    assert.deepEqual(ran, [0, 1, 2, 3, 4], "loebsdag 0 og 1 er tomme traeningsdage og maa ikke tabes");
    assert.deepEqual(result.skippedGameDays, []);
  });

  it("#4846 en FEJLET prior-query beholder fail-safen: kun dagens egne loebsdage", async () => {
    const supabase = makeSupabase({
      flags: ALL_ON,
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 2, finalize_state: null }],
      stages: [
        { race_id: "r1", stage_number: 1, game_day: 2, scheduled_at: "2026-09-15T09:00:00Z" },
        { race_id: "r1", stage_number: 2, game_day: 4, scheduled_at: "2026-09-15T15:00:00Z" },
      ],
      priorError: true,
      teams: [{ id: "t1", league_division_id: "d1" }],
    });
    const ran = [];
    await runTrainingDayCloseSweep({
      supabase, now: inWindow,
      runDay: async ({ gameDay }) => { ran.push(gameDay); return { alreadyRan: false }; },
    });
    assert.deepEqual(ran, [2, 3, 4], "ved det ikke ⇒ ingen loebsdag foran dagens foerste loeb");
  });

  it("#4846 saesonens sidste loebsdato: sweepen forlaenger til maalet - 1", async () => {
    const supabase = makeSupabase({
      flags: ALL_ON,
      season: { id: "s1", number: 4 },
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 9, finalize_state: null }],
      stages: [
        { race_id: "r1", stage_number: 8, game_day: 136, scheduled_at: "2026-09-15T09:00:00Z" },
        { race_id: "r1", stage_number: 9, game_day: 138, scheduled_at: "2026-09-15T15:00:00Z" },
      ],
      priorStages: [{ race_id: "r1", game_day: 134 }],
      laterStages: [],
      teams: [{ id: "t1", league_division_id: "d1" }],
    });
    const ran = [];
    const result = await runTrainingDayCloseSweep({
      supabase, now: inWindow,
      runDay: async ({ gameDay }) => { ran.push(gameDay); return { alreadyRan: false }; },
    });
    const lastGameDay = resolveCalendarRaceDayTarget({ seasonNumber: 4 }) - 1;
    assert.equal(lastGameDay, 139, "ejerens laaste maal: 140 loebsdage, altsaa sidste loebsdag 139");
    assert.deepEqual(ran, [135, 136, 137, 138, 139]);
    assert.deepEqual(result.gameDays, [135, 136, 137, 138, 139]);
  });

  // Diff-tjekket af PR #5608 (24/9), probe: S3-lignende D1, prior 80, i dag 81-85,
  // sidste loebsdato. Foer rettelsen: tikket [132..139], sprunget over 81..131.
  const probeStages = [81, 82, 83, 84, 85].map((game_day, i) => ({
    race_id: "r1", stage_number: i + 1, game_day, scheduled_at: `2026-09-15T${String(9 + i).padStart(2, "0")}:00:00Z`,
  }));

  it("#4846 probe: en saeson UDEN eget maal i kalenderen forlaenges ikke — i dag 81-85 tikker 81-85", async () => {
    assert.equal(SEASON_RACE_DAY_TARGET[NO_TARGET_SEASON], undefined, "fixturens praemis: saesonen har intet eget maal");
    const supabase = makeSupabase({
      flags: ALL_ON,
      season: { id: "s1", number: NO_TARGET_SEASON },
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 9, finalize_state: null }],
      stages: probeStages,
      priorStages: [{ race_id: "r1", game_day: 80 }],
      laterStages: [],
      teams: [{ id: "t1", league_division_id: "d1" }],
    });
    const ran = [];
    const warnings = [];
    const result = await runTrainingDayCloseSweep({
      supabase, now: inWindow,
      logger: { warn: (m) => warnings.push(m), error: (m) => warnings.push(m) },
      runDay: async ({ gameDay }) => { ran.push(gameDay); return { alreadyRan: false }; },
    });
    assert.deepEqual(ran, [81, 82, 83, 84, 85]);
    assert.deepEqual(result.skippedGameDays, []);
    assert.deepEqual(result.droppedExtensionGameDays, [], "intet maal ⇒ ingen forlaengelse at droppe");
    assert.deepEqual(warnings, []);
  });

  it("#4846 akse < eget maal: dagens egne tikkes, forlaengelsen droppes og logges", async () => {
    const supabase = makeSupabase({
      flags: ALL_ON,
      season: { id: "s1", number: 4 },
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 9, finalize_state: null }],
      stages: probeStages,
      priorStages: [{ race_id: "r1", game_day: 80 }],
      laterStages: [],
      teams: [{ id: "t1", league_division_id: "d1" }],
    });
    const ran = [];
    const warnings = [];
    const result = await runTrainingDayCloseSweep({
      supabase, now: inWindow,
      logger: { warn: (m) => warnings.push(m), error: (m) => warnings.push(m) },
      runDay: async ({ gameDay }) => { ran.push(gameDay); return { alreadyRan: false }; },
    });
    assert.deepEqual(ran, [81, 82, 83, 84, 85], "aldrig loebsdage der ikke findes, aldrig dagens egne sprunget over");
    assert.deepEqual(result.skippedGameDays, []);
    assert.equal(result.droppedExtensionGameDays.length, 1);
    assert.equal(result.droppedExtensionGameDays[0].divisionId, "d1");
    assert.equal(result.droppedExtensionGameDays[0].gameDays[0], 86);
    assert.equal(warnings.length, 1, "synligt, ikke tavst");
    assert.match(warnings[0], /forlaengelsen/);
  });

  it("#4846 en FEJLET sidste-dato-query forlaenger ikke (fail-safe)", async () => {
    const supabase = makeSupabase({
      flags: ALL_ON,
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 9, finalize_state: null }],
      stages: [{ race_id: "r1", stage_number: 9, game_day: 138, scheduled_at: "2026-09-15T15:00:00Z" }],
      priorStages: [{ race_id: "r1", game_day: 137 }],
      laterError: true,
      teams: [{ id: "t1", league_division_id: "d1" }],
    });
    const ran = [];
    await runTrainingDayCloseSweep({
      supabase, now: inWindow,
      runDay: async ({ gameDay }) => { ran.push(gameDay); return { alreadyRan: false }; },
    });
    assert.deepEqual(ran, [138]);
  });

  it("#4846 etaper efter i dag ⇒ ingen forlaengelse", async () => {
    const supabase = makeSupabase({
      flags: ALL_ON,
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 9, finalize_state: null }],
      stages: [{ race_id: "r1", stage_number: 9, game_day: 60, scheduled_at: "2026-09-15T15:00:00Z" }],
      priorStages: [{ race_id: "r1", game_day: 59 }],
      laterStages: [{ race_id: "r1", game_day: 61 }],
      teams: [{ id: "t1", league_division_id: "d1" }],
    });
    const ran = [];
    await runTrainingDayCloseSweep({
      supabase, now: inWindow,
      runDay: async ({ gameDay }) => { ran.push(gameDay); return { alreadyRan: false }; },
    });
    assert.deepEqual(ran, [60]);
  });
});

describe("axisEndByDivisionFor (#4846)", () => {
  it("kun divisioner der BEVISLIGT er paa sidste loebsdato faar en akse-ende (maalet - 1)", () => {
    const out = axisEndByDivisionFor({
      lastRaceDateByDivision: new Map([["d1", true], ["d2", false], ["d3", null]]),
      raceDaysPerSeason: 140,
    });
    assert.deepEqual([...out], [["d1", 139]]);
  });

  it("et ukendt eller ugyldigt maal giver ingen forlaengelse", () => {
    for (const raceDaysPerSeason of [null, undefined, 0, -5, Number.NaN, 140.5, Infinity]) {
      const out = axisEndByDivisionFor({
        lastRaceDateByDivision: new Map([["d1", true]]), raceDaysPerSeason,
      });
      assert.equal(out.size, 0, `maal ${String(raceDaysPerSeason)} maa ikke forlaenge`);
    }
  });
});

describe("loadPriorMaxGameDayByDivision / loadLastRaceDateByDivision (#4846: tre svar)", () => {
  const dayStart = new Date("2026-09-14T22:00:00Z");
  const dayEnd = new Date("2026-09-15T22:00:00Z");
  const racesByDiv = new Map([["d1", ["r1"]]]);
  const fake = (result) => ({
    from() {
      const chain = {
        select() { return chain; }, in() { return chain; }, lt() { return chain; }, gte() { return chain; },
        order() { return chain; }, limit() { return chain; },
        then(resolve, reject) {
          return (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)).then(resolve, reject);
        },
      };
      return chain;
    },
  });

  it("prior: raekke ⇒ tal · tomt ⇒ NO_PRIOR_GAME_DAY · fejl/kast/ulaeseligt ⇒ null", async () => {
    const run = (result) => loadPriorMaxGameDayByDivision({ supabase: fake(result), raceIdsByDivision: racesByDiv, dayStart });
    assert.equal((await run({ data: [{ game_day: 41 }], error: null })).get("d1"), 41);
    assert.equal((await run({ data: [], error: null })).get("d1"), NO_PRIOR_GAME_DAY);
    assert.equal((await run({ data: null, error: { message: "boom" } })).get("d1"), null);
    assert.equal((await run(new Error("netvaerk"))).get("d1"), null);
    assert.equal((await run({ data: null, error: null })).get("d1"), null, "intet svar er ikke 'ingen raekker'");
    assert.equal((await run({ data: [{ game_day: null }], error: null })).get("d1"), null);
  });

  it("sidste dato: tomt ⇒ true · raekke ⇒ false · fejl/kast ⇒ null", async () => {
    const run = (result) => loadLastRaceDateByDivision({ supabase: fake(result), raceIdsByDivision: racesByDiv, dayEnd });
    assert.equal((await run({ data: [], error: null })).get("d1"), true);
    assert.equal((await run({ data: [{ game_day: 61 }], error: null })).get("d1"), false);
    assert.equal((await run({ data: null, error: { message: "boom" } })).get("d1"), null);
    assert.equal((await run(new Error("netvaerk"))).get("d1"), null);
    assert.equal((await run({ data: null, error: null })).get("d1"), null);
  });
});

describe("resolveDayCloseStatus + #4846-kanterne (knappen = sweepen)", () => {
  const inWindow = new Date("2026-09-15T18:30:00Z");
  const lastDate = {
    races: [{ id: "r1", league_division_id: "d1", stages_completed: 9, finalize_state: null }],
    stages: [{ race_id: "r1", stage_number: 9, game_day: 138, scheduled_at: "2026-09-15T15:00:00Z" }],
    priorStages: [{ race_id: "r1", game_day: 137 }],
    laterStages: [],
  };

  it("paa sidste loebsdato slaas saesonens maal op, og knappen lover samme dage som sweepen", async () => {
    const out = await resolveDayCloseStatus({
      supabase: makeSupabase({ ...lastDate, season: { id: "s1", number: 4 } }),
      seasonId: "s1", now: inWindow, divisionId: "d1",
    });
    assert.equal(out.closed, true);
    assert.deepEqual(out.gameDays, [138, 139]);
  });

  it("et medsendt saesonnummer bruges direkte", async () => {
    const out = await resolveDayCloseStatus({
      supabase: makeSupabase({ ...lastDate, seasonError: true }),
      seasonId: "s1", now: inWindow, divisionId: "d1", seasonNumber: 4,
    });
    assert.deepEqual(out.gameDays, [138, 139]);
  });

  it("en saeson uden eget maal i kalenderen: knappen forlaenger ikke (samme regel som sweepen)", async () => {
    for (const seasonNumber of [undefined, NO_TARGET_SEASON]) {
      const out = await resolveDayCloseStatus({
        supabase: makeSupabase({ ...lastDate, season: { id: "s1", number: NO_TARGET_SEASON } }),
        seasonId: "s1", now: inWindow, divisionId: "d1", seasonNumber,
      });
      assert.deepEqual(out.gameDays, [138], `seasonNumber ${String(seasonNumber)}`);
    }
  });

  it("fejler saeson-opslaget, forlaenges intet — knappen lover hellere faerre dage end flere", async () => {
    const out = await resolveDayCloseStatus({
      supabase: makeSupabase({ ...lastDate, seasonError: true }),
      seasonId: "s1", now: inWindow, divisionId: "d1",
    });
    assert.equal(out.closed, true);
    assert.deepEqual(out.gameDays, [138]);
  });

  it("saesonens foerste loebsdato: knappen lover ogsaa loebsdag 0", async () => {
    const out = await resolveDayCloseStatus({
      supabase: makeSupabase({
        races: [{ id: "r1", league_division_id: "d1", stages_completed: 1, finalize_state: null }],
        stages: [{ race_id: "r1", stage_number: 1, game_day: 2, scheduled_at: "2026-09-15T09:00:00Z" }],
        priorStages: [],
      }),
      seasonId: "s1", now: inWindow, divisionId: "d1",
    });
    assert.deepEqual(out.gameDays, [0, 1, 2]);
  });
});
