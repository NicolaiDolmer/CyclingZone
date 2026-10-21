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
  TEAM_CONCURRENCY_CONFIG_KEY, MAX_TEAM_CONCURRENCY, parseTeamConcurrency, resolveTeamConcurrency,
  startTrainingDayCloseAfterStages,
  formatTrainingDayCloseFailure, formatTrainingDayCloseFailures, createTrainingDayCloseFailureTracker,
  loadLegacyRunBlockingTeamIds,
} from "./trainingDayCloseTrigger.js";
import {
  runNormalizedTrainingDateSweep, forEachTeamBounded, __resetNormalizedTrainingDateCacheForTests,
} from "./trainingDateClose.js";
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
      teams: [{ id: "ai1", league_division_id: null, is_ai: true }],
      gameDaysByDivisionMap: byDivision,
      alreadyRanRaceDayKeys: new Set(),
      alreadyRanLegacyTeamIds: new Set(),
    });
    assert.deepEqual(plan, [{ teamId: "ai1", gameDay: null, squad: DEFAULT_SQUAD }]);
  });

  it("et division-loest hold der allerede har koert i dag springes over", () => {
    const plan = buildSweepPlan({
      teams: [{ id: "ai1", league_division_id: null, is_ai: true }],
      gameDaysByDivisionMap: byDivision,
      alreadyRanRaceDayKeys: new Set(),
      alreadyRanLegacyTeamIds: new Set(["ai1"]),
    });
    assert.deepEqual(plan, []);
  });

  // #6536: parkering nulstiller league_division_id. Et parkeret menneskehold lignede
  // derfor et division-loest AI-hold og fik et legacy-tick hver aften.
  it("parkeret hold uden division faar INTET tick", () => {
    const plan = buildSweepPlan({
      teams: [{ id: "p1", league_division_id: null, is_ai: false, parked_at: "2026-09-27T18:59:00Z" }],
      gameDaysByDivisionMap: byDivision,
      alreadyRanRaceDayKeys: new Set(),
      alreadyRanLegacyTeamIds: new Set(),
    });
    assert.deepEqual(plan, []);
  });

  it("parkeret hold springes over, ogsaa hvis det stadig baerer en division", () => {
    const plan = buildSweepPlan({
      teams: [{ id: "p1", league_division_id: "d1", is_ai: false, parked_at: "2026-09-27T18:59:00Z" }],
      gameDaysByDivisionMap: byDivision,
      alreadyRanRaceDayKeys: new Set(),
      alreadyRanLegacyTeamIds: new Set(),
    });
    assert.deepEqual(plan, []);
  });

  it("aktivt menneskehold uden division (fallback ved oprettelse) faar stadig legacy-tick", () => {
    const plan = buildSweepPlan({
      teams: [{ id: "h1", league_division_id: null, is_ai: false, parked_at: null }],
      gameDaysByDivisionMap: byDivision,
      alreadyRanRaceDayKeys: new Set(),
      alreadyRanLegacyTeamIds: new Set(),
    });
    assert.equal(plan.length, 1);
    assert.equal(plan[0].teamId, "h1");
    assert.equal(plan[0].gameDay, null);
  });

  it("blandet bestand: aktivt hold uaendret, AI-hold uden division stadig ét legacy-tick, parkeret intet", () => {
    const plan = buildSweepPlan({
      teams: [
        { id: "t1", league_division_id: "d2", is_ai: false, parked_at: null },
        { id: "ai1", league_division_id: null, is_ai: true, parked_at: null },
        { id: "p1", league_division_id: null, is_ai: false, parked_at: "2026-09-27T18:59:00Z" },
      ],
      gameDaysByDivisionMap: byDivision,
      alreadyRanRaceDayKeys: new Set(),
      alreadyRanLegacyTeamIds: new Set(),
    });
    assert.deepEqual(plan, [
      { teamId: "t1", gameDay: 7, squad: DEFAULT_SQUAD, dateGameDays: [7] },
      { teamId: "ai1", gameDay: null, squad: DEFAULT_SQUAD },
    ]);
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

  it("flag off: kun ejerskabsflagene læses, ingen af kanternes opslag", async () => {
    // De nye opslag (sidste-dato-query, saesonens maal) ligger EFTER flag-gaten.
    // Begge ejer-flags læses, men ingen kalender- eller træningsdata ved off.
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
    assert.deepEqual(tableLog, ["app_config", "app_config"]);
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

  it("#6798: en forældet 'loading'-reservation paa den gamle noegle taeller IKKE som koert", async () => {
    // inWindow = 18:30Z. stale er aeldre end taerskelen, fresh er ét minut gammel,
    // done er afregnet (report->>stage = null i det smalle format).
    const base = makeSupabase({
      flags: ALL_ON,
      races: [{ id: "r1", league_division_id: "d1", stages_completed: 3, finalize_state: null }],
      stages: [{ race_id: "r1", stage_number: 3, game_day: 40, scheduled_at: "2026-09-15T09:00:00Z" }],
      teams: ["stale", "fresh", "done", "new"].map((id) => ({ id, league_division_id: null, is_ai: false, parked_at: null })),
      legacyRuns: [
        { team_id: "stale", created_at: "2026-09-15T18:00:00Z", stage: "loading" },
        { team_id: "fresh", created_at: "2026-09-15T18:29:00Z", stage: "loading" },
        { team_id: "done", created_at: "2026-09-15T17:00:00Z", stage: null },
      ],
    });
    const selects = [];
    const supabase = { from(table) {
      const chain = base.from(table);
      if (table !== "training_day_runs") return chain;
      const select = chain.select;
      chain.select = function (columns) { selects.push(columns); return select.call(this, columns); };
      return chain;
    } };
    const called = [];
    const result = await runTrainingDayCloseSweep({
      supabase, now: inWindow, runDay: async ({ teamId }) => { called.push(teamId); return { alreadyRan: false }; },
    });
    assert.ok(selects.includes("team_id, created_at, stage:report->>stage"), `legacy-opslaget henter kun stadiet: ${selects}`);
    assert.deepEqual(called.sort(), ["new", "stale"], "forældet reservation sendes til motoren; frisk og afregnet springes over");
    assert.equal(result.swept, 2);
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

// S4 28/9 (CYCLINGZONE-79): ~500 løb i sæsonen gav en ~19 KB URL via
// .in("race_id", <alle sæsonens løb>) og "fetch failed". Ingen hel-sæsons id-liste
// må sendes i en URL igen.
describe("dagens etaper hentes uden hel-sæsons id-liste i URL'en", () => {
  it("kildekoden sender aldrig alle sæsonens race-id'er i et .in()", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(import.meta.dirname, "trainingDayCloseTrigger.js"), "utf8");
    assert.equal(/\.in\(\s*"race_id",\s*\[\.\.\.raceById\.keys\(\)\]\s*\)/.test(src), false);
    assert.match(src, /races!inner\(season_id/);
  });
});

// ── #5911: hold-parallelitet i datoafregningen + start straks efter etaperne ──────

describe("parseTeamConcurrency / resolveTeamConcurrency (#5911)", () => {
  it("tal og tal-strenge klemmes til 1..loftet; alt andet er den sekventielle 1", () => {
    assert.equal(parseTeamConcurrency(12), 12);
    assert.equal(parseTeamConcurrency("8"), 8);
    assert.equal(parseTeamConcurrency(" 4 "), 4);
    assert.equal(parseTeamConcurrency(7.9), 7);
    assert.equal(parseTeamConcurrency(999), MAX_TEAM_CONCURRENCY);
    for (const raw of [null, undefined, 0, -3, "on", "", "2.5", {}, [], NaN, true]) {
      assert.equal(parseTeamConcurrency(raw), 1, `raw=${JSON.stringify(raw)}`);
    }
  });

  function configClient(answer) {
    const seen = [];
    const query = {
      select() { return this; },
      eq(col, val) { seen.push([col, val]); return this; },
      async maybeSingle() { if (answer instanceof Error) throw answer; return answer; },
    };
    return { seen, supabase: { from: (table) => { seen.push(["table", table]); return query; } } };
  }

  it("laeser app_config-noeglen og fail-safer til 1 ved fejl, kast eller manglende raekke", async () => {
    const ok = configClient({ data: { value: 12 }, error: null });
    assert.equal(await resolveTeamConcurrency(ok.supabase), 12);
    assert.deepEqual(ok.seen, [["table", "app_config"], ["key", TEAM_CONCURRENCY_CONFIG_KEY]]);
    assert.equal(await resolveTeamConcurrency(configClient({ data: null, error: null }).supabase), 1);
    assert.equal(await resolveTeamConcurrency(configClient({ data: null, error: { message: "down" } }).supabase), 1);
    assert.equal(await resolveTeamConcurrency(configClient(new Error("network")).supabase), 1);
  });

  async function sweepConcurrency(knob) {
    __resetTrainingDayCloseStateForTests();
    // Flagene er "on"; kun knappens noegle svarer med `knob` (undefined = ingen raekke).
    const supabase = { from: () => {
      let key = null;
      const query = { select() { return this; }, eq(col, val) { if (col === "key") key = val; return this; },
        async maybeSingle() {
          if (key !== TEAM_CONCURRENCY_CONFIG_KEY) return { data: { value: "on" }, error: null };
          return { data: knob === undefined ? null : { value: knob }, error: null };
        } };
      return query;
    } };
    let received = null;
    await runTrainingDayCloseSweep({
      supabase, now: new Date("2026-10-11T18:05:00Z"),
      runNormalized: async (args) => { received = args.teamConcurrency; return { ran: false }; },
    });
    return received;
  }

  it("overlap-guarden tages foer flag-opslagene: en samtidig anden start er et skip", async () => {
    __resetTrainingDayCloseStateForTests();
    let release;
    const gate = new Promise((r) => { release = r; });
    const query = { select() { return this; }, eq() { return this; },
      async maybeSingle() { await gate; return { data: { value: "on" }, error: null }; } };
    let normalizedRuns = 0;
    const args = { supabase: { from: () => query }, now: new Date("2026-10-11T18:05:00Z"),
      runNormalized: async () => { normalizedRuns++; return { ran: true }; } };
    const first = runTrainingDayCloseSweep(args);
    assert.equal(isTrainingDayCloseSweepRunning(), true, "guard held while the flag lookup is still pending");
    assert.deepEqual(await runTrainingDayCloseSweep(args), { ran: false, skipped: "overlap" });
    release();
    assert.equal((await first).ran, true);
    assert.equal(normalizedRuns, 1);
    assert.equal(isTrainingDayCloseSweepRunning(), false, "guard released afterwards");
  });

  it("den normaliserede sweep faar knappens vaerdi med, og uden knap den sekventielle 1", async () => {
    assert.equal(await sweepConcurrency(12), 12);
    assert.equal(await sweepConcurrency(undefined), 1);
    assert.equal(await sweepConcurrency("on"), 1);
  });

  it("#6759: den normaliserede sweep faar legacy-loaderen der ignorerer uafregnede reservationer", async () => {
    __resetTrainingDayCloseStateForTests();
    const query = { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: { value: "on" }, error: null }; } };
    let received = null;
    await runTrainingDayCloseSweep({
      supabase: { from: () => query }, now: new Date("2026-10-11T18:05:00Z"),
      runNormalized: async (args) => { received = args.loadLegacyRuns; return { ran: false }; },
    });
    assert.equal(received, loadLegacyRunBlockingTeamIds);
  });
});

describe("loadLegacyRunBlockingTeamIds (#6759)", () => {
  function fakeSupabase(rows, calls) {
    const query = {
      select(cols) { calls.push(["select", cols]); return this; },
      eq(col, val) { calls.push(["eq", col, val]); return this; },
      is(col, val) { calls.push(["is", col, val]); return this; },
      order() { return this; },
      range() { return Promise.resolve({ data: rows, error: null }); },
    };
    return { from: (table) => { calls.push(["from", table]); return query; } };
  }

  it("afregnede og 'writing'-raekker blokerer; 'loading'-reservationer (frisk eller forældet) goer ikke", async () => {
    const calls = [];
    const rows = [
      { team_id: "settled", stage: null },
      { team_id: "writing", stage: "writing" },
      { team_id: "loading", stage: "loading" },
    ];
    const blocking = await loadLegacyRunBlockingTeamIds({ supabase: fakeSupabase(rows, calls), tickDate: "2026-10-11" });
    assert.deepEqual([...blocking].sort(), ["settled", "writing"]);
    assert.deepEqual(calls.filter((c) => c[0] !== "select"), [
      ["from", "training_day_runs"], ["eq", "tick_date", "2026-10-11"], ["is", "game_day", null],
    ]);
  });
});

describe("forEachTeamBounded (#5911)", () => {
  it("limit 1 er den gamle sekventielle loekke i samme raekkefoelge", async () => {
    const order = [];
    let inFlight = 0, maxInFlight = 0;
    await forEachTeamBounded([1, 2, 3, 4], 1, async (n) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setImmediate(r));
      order.push(n); inFlight--;
    });
    assert.deepEqual(order, [1, 2, 3, 4]);
    assert.equal(maxInFlight, 1);
  });

  it("holder sig under loftet, og et kast stopper nye hold men lader de startede blive faerdige", async () => {
    let inFlight = 0, maxInFlight = 0;
    const finished = [];
    await assert.rejects(forEachTeamBounded([...Array(20).keys()], 3, async (n) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight--;
      if (n === 4) throw new Error("boom");
      finished.push(n);
    }), /boom/);
    assert.equal(maxInFlight, 3);
    assert.equal(inFlight, 0, "ingen hold koerer videre efter kastet");
    assert.ok(finished.length < 19, "nye hold startes ikke efter kastet");
  });
});

// PARITET: samme fixture afregnet sekventielt (1) og parallelt (12) skal give
// praecis samme database-tilstand, samme kald pr. hold og samme opsummering. Den
// falske database er tilstandsfuld paa samme punkter som den rigtige: én kvittering
// pr. (rytter, loebsdag), evner der bygger videre paa forrige loebsdags vaerdi,
// registreringens #6439-regel og en atomisk commit (et kast skriver intet).
function hashOf(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function buildParityFixture() {
  const days = [10, 11, 12, 13, 14];
  const teams = [];
  const riders = [];
  for (let t = 0; t < 262; t++) {
    const id = `team-${String(t).padStart(3, "0")}`;
    teams.push({ id, league_division_id: t < 2 ? null : `div-${t % 11}`, is_ai: t < 2 });
    for (let r = 0; r < 3; r++) riders.push({ id: `${id}-r${r}`, team_id: id });
  }
  // #6439: en rytter solgt efter at datoen aabnede, settles af det gamle hold.
  riders.find((r) => r.id === "team-005-r2").team_id = "team-006";
  const opening = (ids) => Object.fromEntries(ids.map((id) => [id, { form: 50, fatigue: 20 }]));
  const preWork = [
    { team_id: "team-005", game_days: days, expected_rider_ids: ["team-005-r0", "team-005-r1", "team-005-r2"],
      status: "partial", opening_conditions: opening(["team-005-r0", "team-005-r1", "team-005-r2"]), quarantined_rider_ids: [] },
    { team_id: "team-007", game_days: days, expected_rider_ids: ["team-007-r0"], status: "complete",
      opening_conditions: opening(["team-007-r0"]), quarantined_rider_ids: [] },
  ];
  return { days, teams, riders, preWork, opening };
}

async function settleParity(concurrency) {
  __resetNormalizedTrainingDateCacheForTests();
  const { days, teams, riders, preWork, opening } = buildParityFixture();
  const work = preWork.map((row) => ({ ...row }));
  const abilities = new Map(riders.map((r) => [r.id, hashOf(r.id) % 100]));
  const receipts = new Map();
  const legacyRuns = new Set(["team-001"]);
  const callsByTeam = new Map();
  const failOnce = new Set(["team-020:12", "team-150:10", "team-261:14"]);
  const running = new Set();
  let inFlight = 0, maxInFlight = 0;

  const options = {
    supabase: {}, elapsedClock: () => 0, logger: { error() {} },
    loadIndex: async ({ now }) => ({ today: "2026-10-11", activeSeasonId: "season",
      jobs: [{ tickDate: "2026-10-11", season: { id: "season", number: 4 }, ...(now.getUTCMinutes() > 5 ? { forceRetry: true } : {}) }] }),
    loadWorkRows: async () => work.map((row) => ({ ...row })),
    loadContext: async () => ({
      teams: teams.map((t) => ({ ...t })), riders: riders.map((r) => ({ ...r })),
      races: [], stages: [], runs: [], entries: [], results: [], incidents: [], loads: [],
      gameDaysByDivision: new Map(teams.filter((t) => t.league_division_id).map((t) => [t.league_division_id, days])),
    }),
    registerWork: async ({ teamId, gameDays, riderIds }) => {
      const claimed = new Set(work.filter((row) => row.team_id !== teamId).flatMap((row) => row.expected_rider_ids));
      const ids = riderIds.filter((id) => !claimed.has(id));
      const row = { team_id: teamId, game_days: gameDays, expected_rider_ids: ids, status: "pending",
        opening_conditions: opening(ids), quarantined_rider_ids: [] };
      work.push(row);
      return { ...row };
    },
    loadLegacyRuns: async () => new Set(legacyRuns),
    quarantineRiders: async () => { throw new Error("parity fixture has no unavailable riders"); },
    refreshRankings: async () => {},
    dispatchAlarms: async () => ({ dates: 0, failed: 0 }),
    runDay: async ({ teamId, gameDay, eligibleRiderIds, dateGameDays }) => {
      assert.equal(running.has(teamId), false, `team ${teamId} must never settle two race days at once`);
      running.add(teamId);
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        // Forskellig "rundtur" pr. kald, saa holdene faktisk fletter ind i hinanden.
        for (let i = hashOf(`${teamId}:${gameDay}`) % 4; i >= 0; i--) await new Promise((r) => setImmediate(r));
        if (!callsByTeam.has(teamId)) callsByTeam.set(teamId, []);
        callsByTeam.get(teamId).push(`${gameDay}:${(eligibleRiderIds ?? []).join(",")}`);
        if (failOnce.delete(`${teamId}:${gameDay}`)) throw new Error("transient");
        if (gameDay === null) { legacyRuns.add(teamId); return { alreadyRan: false }; }
        for (const riderId of eligibleRiderIds) {
          const key = `${riderId}:${gameDay}`;
          if (receipts.has(key)) continue;
          const earlier = dateGameDays.filter((d) => d < gameDay);
          assert.ok(earlier.every((d) => receipts.has(`${riderId}:${d}`)), `${key} settled out of order`);
          abilities.set(riderId, (abilities.get(riderId) * 31 + gameDay + hashOf(teamId)) % 1000003);
          receipts.set(key, teamId);
        }
        const row = work.find((w) => w.team_id === teamId);
        row.status = row.expected_rider_ids.every((id) => days.every((d) => receipts.has(`${id}:${d}`))) ? "complete" : "partial";
        return { alreadyRan: false };
      } finally {
        running.delete(teamId);
        inFlight--;
      }
    },
  };
  const strip = (s) => ({ ...s, durationMs: 0, failures: [...s.failures].sort((a, b) => a.teamId.localeCompare(b.teamId)) });
  const first = strip(await runNormalizedTrainingDateSweep({ ...options, teamConcurrency: concurrency, now: new Date("2026-10-11T18:05:00Z") }));
  const retry = strip(await runNormalizedTrainingDateSweep({ ...options, teamConcurrency: concurrency, now: new Date("2026-10-11T18:10:00Z") }));
  return {
    first, retry, maxInFlight,
    abilities: [...abilities].sort(), receipts: [...receipts].sort(),
    work: work.map((row) => ({ ...row })).sort((a, b) => a.team_id.localeCompare(b.team_id)),
    legacyRuns: [...legacyRuns].sort(),
    callsByTeam: [...callsByTeam].sort(([a], [b]) => a.localeCompare(b)),
  };
}

describe("paritet: sekventiel og parallel datoafregning giver samme resultat (#5911)", () => {
  it("262 hold x 5 loebsdage: samme evner, kvitteringer, arbejdsrækker, kald pr. hold og opsummering", async () => {
    const sequential = await settleParity(1);
    const parallel = await settleParity(12);
    assert.equal(sequential.maxInFlight, 1);
    assert.ok(parallel.maxInFlight > 1 && parallel.maxInFlight <= 12, `max in flight ${parallel.maxInFlight}`);
    // Fixturen daekker de kanter paritet skal holde paa: fejl der proeves igen,
    // division-loese hold, et faerdigt hold og en solgt rytter.
    assert.equal(sequential.first.failed, 3);
    assert.equal(sequential.retry.failed, 0);
    // 260 hold med division x 3 ryttere x 5 loebsdage, minus det allerede faerdige hold.
    assert.equal(sequential.receipts.length, 260 * 3 * 5 - 3 * 5);
    assert.equal(sequential.receipts.find(([key]) => key === "team-005-r2:14")?.[1], "team-005");
    assert.deepEqual(parallel.first, sequential.first);
    assert.deepEqual(parallel.retry, sequential.retry);
    assert.deepEqual(parallel.abilities, sequential.abilities);
    assert.deepEqual(parallel.receipts, sequential.receipts);
    assert.deepEqual(parallel.work, sequential.work);
    assert.deepEqual(parallel.legacyRuns, sequential.legacyRuns);
    assert.deepEqual(parallel.callsByTeam, sequential.callsByTeam);
  });
});

describe("normaliseret datoafregning: failure-identitet har loebsdag (#6609)", () => {
  const days = [10, 11];
  const opening = { r1: { form: 50, fatigue: 20 } };
  const sweepOptions = (failDays) => ({
    supabase: {}, elapsedClock: () => 0, logger: { error() {} },
    now: new Date("2026-10-11T18:05:00Z"),
    loadIndex: async () => ({ today: "2026-10-11", activeSeasonId: "season",
      jobs: [{ tickDate: "2026-10-11", season: { id: "season", number: 4 }, forceRetry: true }] }),
    loadWorkRows: async () => [{ team_id: "t1", game_days: days, expected_rider_ids: ["r1"], status: "pending",
      opening_conditions: opening, quarantined_rider_ids: [] }],
    loadContext: async () => ({ teams: [{ id: "t1", league_division_id: "div" }], riders: [{ id: "r1", team_id: "t1" }],
      races: [], stages: [], runs: [], entries: [], results: [], incidents: [], loads: [],
      gameDaysByDivision: new Map([["div", days]]) }),
    quarantineRiders: async () => {},
    refreshRankings: async () => {},
    dispatchAlarms: async () => ({ dates: 0, failed: 0 }),
    runDay: async ({ gameDay }) => { if (failDays.has(gameDay)) throw new Error("boom"); return { alreadyRan: false }; },
  });

  it("failures carry the race day, so the string and the identity are per (team, race day)", async () => {
    __resetNormalizedTrainingDateCacheForTests();
    const first = await runNormalizedTrainingDateSweep(sweepOptions(new Set([10])));
    assert.deepEqual(first.failures.map((f) => f.gameDay), [10]);
    assert.deepEqual(formatTrainingDayCloseFailures(first), ["2026-10-11|t1|10|boom"]);

    // Same team, a different race day: not a repeat, stays a warning.
    __resetNormalizedTrainingDateCacheForTests();
    const tracker = createTrainingDayCloseFailureTracker();
    assert.equal(tracker.track(first).level, "warning");
    const other = await runNormalizedTrainingDateSweep(sweepOptions(new Set([11])));
    assert.deepEqual(formatTrainingDayCloseFailures(other), ["2026-10-11|t1|11|boom"]);
    assert.equal(tracker.track(other).level, "warning");

    // Same team and race day again: escalates to error.
    __resetNormalizedTrainingDateCacheForTests();
    const again = await runNormalizedTrainingDateSweep(sweepOptions(new Set([11])));
    assert.equal(tracker.track(again).level, "error");
  });
});

describe("startTrainingDayCloseAfterStages (#5911: start straks efter dagens sidste etape)", () => {
  beforeEach(() => __resetTrainingDayCloseStateForTests());
  const evening = () => new Date("2026-10-11T18:20:00Z"); // 20:20 CEST
  const quiet = { log() {}, error() {} };

  it("starter ikke uden afviklede etaper eller foer kl. 20", () => {
    let calls = 0;
    const runSweep = async () => { calls++; return {}; };
    assert.equal(startTrainingDayCloseAfterStages({ supabase: { from() {} }, stagesRan: 0, clock: evening, runSweep, logger: quiet }), null);
    assert.equal(startTrainingDayCloseAfterStages({ supabase: { from() {} }, stagesRan: 2, clock: () => new Date("2026-10-11T17:59:00Z"), runSweep, logger: quiet }), null);
    assert.equal(calls, 0);
  });

  it("starter sweepen med frisk tid og sender maks-ventetids-alarmen til Sentry", async () => {
    const captured = [];
    let args = null;
    const promise = startTrainingDayCloseAfterStages({
      supabase: { from() {} }, stagesRan: 1, clock: evening, logger: quiet,
      captureExceptionFn: (err, ctx) => captured.push([err.message, ctx]),
      runSweep: async (a) => { args = a; await a.onAlarm(new Error("late"), { tickDate: "2026-10-11", pending: [1, 2] }); return { ran: true, swept: 3, failed: 0, durationMs: 1200 }; },
    });
    assert.ok(promise, "a sweep was started");
    const result = await promise;
    assert.equal(result.swept, 3);
    assert.equal(args.now.toISOString(), evening().toISOString());
    assert.equal(captured.length, 1);
    assert.equal(captured[0][0], "late");
    assert.equal(captured[0][1].tags.cron, "training-day-close");
    assert.deepEqual(captured[0][1].pending, [1, 2]);
  });

  it("stage-scheduleren kalder den tidlige start efter tick'et med alle afviklede etaper", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(import.meta.dirname, "stageScheduler.js"), "utf8");
    assert.match(src, /startTrainingDayClose\s*=\s*startTrainingDayCloseAfterStages/);
    assert.match(src, /startTrainingDayClose\(\{ supabase, stagesRan: ran \+ recovered \+ resumed, captureExceptionFn \}\);\s*return \{ ran, errors/);
  });

  it("en fejlende sweep kaster aldrig ind i stage-scheduleren", async () => {
    const errors = [];
    const result = await startTrainingDayCloseAfterStages({
      supabase: { from() {} }, stagesRan: 1, clock: evening, logger: { log() {}, error: (...a) => errors.push(a) },
      runSweep: async () => { throw new Error("db down"); },
    });
    assert.equal(result, null);
    assert.equal(errors.length, 1);
  });
});

// ── #6609: laesbare Sentry-failures + error kun ved gentagelse ───────────────
describe("training day-close failure formatting + escalation (#6609)", () => {
  const fail = (teamId, gameDay, message = "boom") => ({ teamId, gameDay, message });
  const res = (failures, tickDate = "2026-10-13") => ({ ran: true, tickDate, failed: failures.length, failures });

  it("formats a failure as a plain string that survives Sentry normalization", () => {
    assert.equal(formatTrainingDayCloseFailure(fail("t1", 77, "net down"), "2026-10-13"), "2026-10-13|t1|77|net down");
    assert.equal(formatTrainingDayCloseFailure({ tickDate: "2026-10-12", teamId: "t2", gameDay: 3, message: "x" }, "2026-10-13"), "2026-10-12|t2|3|x");
    const out = formatTrainingDayCloseFailures(res([fail("t1", 1), fail("t2", 2)]));
    assert.deepEqual(out, ["2026-10-13|t1|1|boom", "2026-10-13|t2|2|boom"]);
    assert.ok(out.every((x) => typeof x === "string"));
  });

  it("first failure is a warning, never an error", () => {
    const t = createTrainingDayCloseFailureTracker();
    const r = t.track(res([fail("t1", 77)]));
    assert.equal(r.capture, true);
    assert.equal(r.level, "warning");
  });

  it("error only when the same (team, game day) fails again at the next tick", () => {
    const t = createTrainingDayCloseFailureTracker();
    assert.equal(t.track(res([fail("t1", 77)])).level, "warning");
    const again = t.track(res([fail("t1", 77)]));
    assert.equal(again.level, "error");
    assert.equal(again.capture, true);
  });

  it("a transient failure that heals never escalates", () => {
    const t = createTrainingDayCloseFailureTracker();
    assert.equal(t.track(res([fail("t1", 77)])).level, "warning");
    assert.equal(t.track({ ran: true, tickDate: "2026-10-13", failed: 0, failures: [] }).capture, false);
    assert.equal(t.track(res([fail("t1", 77)])).level, "warning");
  });

  it("a different team or game day is not a repeat", () => {
    const t = createTrainingDayCloseFailureTracker();
    t.track(res([fail("t1", 77)]));
    assert.equal(t.track(res([fail("t2", 77)])).level, "warning");
    assert.equal(t.track(res([fail("t2", 78)])).level, "warning");
  });

  it("keeps the #6004 dedupe: unchanged set captures one error, not one per tick", () => {
    const t = createTrainingDayCloseFailureTracker();
    t.track(res([fail("t1", 77)]));
    assert.equal(t.track(res([fail("t1", 77)])).capture, true);
    const third = t.track(res([fail("t1", 77)]));
    assert.equal(third.capture, false);
    assert.equal(third.repeated, true);
  });

  it("repeat with a changed message still escalates (identity ignores message)", () => {
    const t = createTrainingDayCloseFailureTracker();
    t.track(res([fail("t1", 77, "a")]));
    const r = t.track(res([fail("t1", 77, "b")]));
    assert.equal(r.level, "error");
    assert.equal(r.capture, true);
  });
});
