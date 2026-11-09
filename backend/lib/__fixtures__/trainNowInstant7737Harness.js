// #7737: a deterministic harness around the training engine and the Train now press. It logs
// every write and RPC the engine sends to the database. With the switch off, the digests of
// those logs must equal the digests taken from the frozen merge-base code (#7587): this file
// runs unchanged in both checkouts, and the fixture holds hashes only (hard rule 17).
import { createHash } from "node:crypto";
import { runTeamTrainingDay } from "../dailyTrainingEngine.js";
import { runTrainNow } from "../trainNow.js";
import { resolveTrainingDateReadiness, trainingDateDeadline } from "../trainingDateReadiness.js";

export const TEAM = "team-a";
export const SEASON = { id: "season-1", number: 5 };
export const DATE = "2026-11-09";
export const DAYS = [41, 42, 43, 44, 45];
export const DIVISION = "div-1";
export const RACE = "race-1";
export const PRESS_AT = new Date("2026-11-09T06:00:00Z");
export const EVENING_AT = new Date("2026-11-09T19:30:00Z");

const ABILITIES = { climbing: 50, sprint: 50, flat: 50, recovery: 40, time_trial: 50, stamina: 50, punch: 50 };

export const makeRider = (id, extra = {}) => ({
  id, team_id: TEAM, primary_type: "climber", secondary_type: null, potentiale: 4, birthdate: "2003-01-01",
  firstname: "Test", lastname: id, is_retired: false, is_academy: false, ...extra,
});

/** A state with the given riders; `open` riders are entered in a race with one stage on `raceDay`. */
export function seedState({ riderIds = ["r1", "r2"], fatigue = 30, intensity = "normal", flags = {}, raceDay = 43, raced = [] } = {}) {
  return {
    app_config: Object.entries({
      training_condition_per_date: "on", training_tick_per_race_day: "on", training_train_now: "on",
      race_day_engine_enabled: "on", race_day_development_enabled: "on", ...flags,
    }).map(([key, value]) => ({ key, value })),
    teams: [{ id: TEAM, league_division_id: DIVISION, user_id: "manager-1", is_ai: false, is_bank: false, is_test_account: false }],
    riders: riderIds.map((id) => makeRider(id)),
    rider_derived_abilities: riderIds.map((rider_id) => ({ rider_id, ...ABILITIES, ability_caps: null, ability_progress: {} })),
    rider_condition: riderIds.map((rider_id) => ({ rider_id, form: 50, fatigue, injured_until: null, injury_cause: null, updated_at: "2026-11-08T20:00:00Z", injury_end_game_day: null, injury_season_id: null, injury_race_days_left: null })),
    training_plans: riderIds.map((rider_id) => ({ rider_id, team_id: TEAM, season_id: SEASON.id, focus: "vo2max", intensity })),
    training_week_plans: [], training_day_runs: [], training_date_work: [], training_rider_ticks: [], training_condition_settlements: [],
    training_race_loads: [], training_train_now_locks: [], race_entry_days: [], race_entries: [], race_results: [], race_incidents: [],
    races: [{ id: RACE, season_id: SEASON.id, league_division_id: DIVISION, race_type: "single", stages_completed: 0, finalize_state: null, squad: "senior", name: "Race" }],
    race_stage_schedule: [{ race_id: RACE, stage_number: 1, game_day: raceDay, scheduled_at: "2026-11-09T15:00:00Z" }],
    raced,
  };
}

const canon = (value) => {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])]));
  return value;
};
export const digest = (value) => createHash("sha256").update(JSON.stringify(canon(value))).digest("hex");

/** Supabase stand-in: table rows from `state`, every write and RPC appended to `log`. */
export function createFake(state, { failRead = null } = {}) {
  const log = [];
  function builder(table) {
    const filters = [];
    let write = null;
    let limit = null;
    const rows = () => {
      if (failRead?.(table)) return { data: null, error: { code: "XX000", message: `${table} read failed` } };
      let out = (state[table] ?? []).filter((row) => filters.every((f) => f(row)));
      if (limit != null) out = out.slice(0, limit);
      return { data: out, error: null };
    };
    const run = () => {
      if (!write) return rows();
      log.push({ write: write.kind, table, payload: write.payload });
      const { data: hit } = rows();
      if (write.kind === "update") for (const row of hit ?? []) Object.assign(row, write.payload);
      if (write.kind === "upsert") {
        state[table] ??= [];
        for (const row of [write.payload].flat()) if (!state[table].some((x) => x.rider_id === row.rider_id && x.tick_date === row.tick_date)) state[table].push({ ...row });
      }
      return { data: hit ?? [], error: null };
    };
    const q = {
      select() { return q; }, order() { return q; }, or() { return q; },
      eq(col, val) { filters.push((row) => row[col] === val); return q; },
      neq(col, val) { filters.push((row) => row[col] !== val); return q; },
      is(col, val) { filters.push((row) => (row[col] ?? null) === val); return q; },
      not(col, _op, val) { filters.push((row) => (row[col] ?? null) !== val); return q; },
      gte(col, val) { filters.push((row) => row[col] >= val); return q; },
      lt(col, val) { filters.push((row) => row[col] < val); return q; },
      lte(col, val) { filters.push((row) => row[col] <= val); return q; },
      in(col, vals) { filters.push((row) => vals.includes(row[col])); return q; },
      limit(n) { limit = n; return q; },
      range(from, to) { const r = run(); return Promise.resolve({ data: (r.data ?? []).slice(from, to + 1), error: r.error }); },
      async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      async single() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      insert(payload) { write = { kind: "insert", payload }; return q; },
      update(payload) { write = { kind: "update", payload }; return q; },
      upsert(payload) { write = { kind: "upsert", payload }; return q; },
      delete() { write = { kind: "delete", payload: null }; return q; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return q;
  }

  async function rpc(name, args) {
    log.push({ rpc: name, args });
    const rpcName = name.replace(/^try_/, "");
    if (rpcName === "register_training_date_work") {
      let work = state.training_date_work.find((row) => row.team_id === args.p_team_id && row.tick_date === args.p_tick_date);
      if (!work) {
        work = {
          team_id: args.p_team_id, season_id: args.p_season_id, tick_date: args.p_tick_date, game_days: args.p_game_days,
          expected_rider_ids: args.p_expected_rider_ids, deadline_at: args.p_deadline_at, status: "pending", quarantined_rider_ids: [],
          opening_conditions: Object.fromEntries(state.rider_condition.filter((row) => args.p_expected_rider_ids.includes(row.rider_id)).map((row) => [row.rider_id, structuredClone(row)])),
        };
        state.training_date_work.push(work);
      }
      return { data: work, error: null };
    }
    if (rpcName !== "commit_training_date_tick") return { data: null, error: null };
    const fresh = args.p_report.riders.filter((report) => !state.training_rider_ticks.some((row) => row.rider_id === report.rider_id && row.game_day === args.p_game_day));
    for (const item of args.p_abilities) Object.assign(state.rider_derived_abilities.find((row) => row.rider_id === item.riderId), item.patch);
    for (const item of args.p_conditions) {
      const row = state.rider_condition.find((c) => c.rider_id === item.rider_id);
      if (item.provisional) Object.assign(row, { form: item.form, fatigue: item.fatigue });
      else { Object.assign(row, item); state.training_condition_settlements.push({ rider_id: item.rider_id, tick_date: args.p_tick_date }); }
    }
    for (const report of fresh) state.training_rider_ticks.push({ rider_id: report.rider_id, season_id: args.p_season_id, game_day: args.p_game_day, tick_date: args.p_tick_date, team_id: args.p_team_id, report });
    const existing = state.training_day_runs.find((row) => row.game_day === args.p_game_day);
    if (existing) existing.report = args.p_report;
    else state.training_day_runs.push({ team_id: args.p_team_id, season_id: args.p_season_id, squad: args.p_squad, game_day: args.p_game_day, tick_date: args.p_tick_date, report: args.p_report });
    return { data: { already_ran: fresh.length === 0, report: args.p_report, work_status: "partial" }, error: null };
  }
  return { supabase: { from: builder, rpc }, log };
}

/** What the sweep and the press read for readiness, built from the state. */
export function contextOf(state, { snapshot = false } = {}) {
  const stages = state.race_stage_schedule;
  return {
    tickDate: DATE, teams: state.teams, riders: state.riders, races: state.races, stages,
    runs: snapshot ? stages.map((s) => ({ race_id: s.race_id, stage_number: s.stage_number, entrant_snapshot: state.race_entries.filter((e) => e.race_id === s.race_id).map((e) => e.rider_id) })) : [],
    entries: state.race_entries, results: state.race_results.map((row) => ({ ...row, result_type: "stage" })), incidents: [],
    loads: state.training_race_loads, candidateRiderIdsByRace: new Map(), gameDaysByDivision: new Map([[DIVISION, DAYS]]),
  };
}

export function press(state, fake, { now = PRESS_AT } = {}) {
  return runTrainNow({
    supabase: fake.supabase, team: { id: TEAM, league_division_id: DIVISION }, season: SEASON, now,
    loadDaySpans: async () => new Map(), loadContext: async () => contextOf(state), loadShortRaces: async () => [],
  });
}

/** One sweep pass over the date, the same call the evening run makes per race day. */
export async function sweep(state, fake, { now = EVENING_AT } = {}) {
  const work = state.training_date_work[0];
  const readiness = resolveTrainingDateReadiness({ ...contextOf(state), tickDate: DATE, now, riderIds: work.expected_rider_ids });
  if (!readiness.eligibleRiderIds.length) return [];
  const out = [];
  for (const gameDay of work.game_days) {
    out.push(await runTeamTrainingDay({
      supabase: fake.supabase, teamId: TEAM, seasonId: SEASON.id, seasonNumber: SEASON.number, now, tickDateOverride: DATE, gameDay,
      dateGameDays: work.game_days, executedBy: "assistant", eligibleRiderIds: readiness.eligibleRiderIds,
      unresolvedSlotsByRider: readiness.unresolvedSlotsByRider, deadlineAt: readiness.deadlineAt.toISOString(), deadlineReached: readiness.deadlineReached,
    }));
  }
  return out;
}

/** The stage has run: its entrants have a ledger row and a result. */
export function finishRace(state, riderIds, { load = 9, gameDay = 43 } = {}) {
  state.races[0].stages_completed = 1;
  for (const rider_id of riderIds) {
    state.training_race_loads.push({ rider_id, race_id: RACE, stage_number: 1, season_id: SEASON.id, game_day: gameDay, tick_date: DATE, load, consumed_at: null, duplicate_of_race_id: null, duplicate_of_stage_number: null });
    state.race_results.push({ rider_id, race_id: RACE, stage_number: 1, result_type: "stage" });
  }
}

export const enter = (state, riderIds) => { for (const rider_id of riderIds) state.race_entries.push({ race_id: RACE, rider_id, team_id: TEAM }); };

const V2 = { condition_model_v2: "on" };
const V2_RACE_DATE = { condition_model_v2: "on", condition_v2_race_date_training_day: "on" };

/** Every scenario runs with the switch off (no row at all) and logs what reaches the database. */
export const SCENARIOS = {
  press_no_race: { seed: {}, steps: async (s, f) => { await press(s, f); } },
  press_no_race_v2: { seed: { flags: V2 }, steps: async (s, f) => { await press(s, f); } },
  press_tired_hard_v2: { seed: { fatigue: 88, intensity: "hard", flags: V2_RACE_DATE }, steps: async (s, f) => { await press(s, f); } },
  press_twice: { seed: {}, steps: async (s, f) => { await press(s, f); await press(s, f); } },
  race_rider_waits: {
    seed: { flags: V2 },
    steps: async (s, f) => { enter(s, ["r2"]); await press(s, f); },
  },
  race_rider_full_day: {
    seed: { flags: V2_RACE_DATE },
    steps: async (s, f) => { enter(s, ["r2"]); await press(s, f); finishRace(s, ["r2"]); await sweep(s, f); await sweep(s, f); },
  },
  race_on_last_slot_old_model: {
    seed: { raceDay: 45 },
    steps: async (s, f) => { enter(s, ["r1", "r2"]); await press(s, f); finishRace(s, ["r1", "r2"], { gameDay: 45 }); await sweep(s, f); },
  },
  sweep_only: {
    seed: { flags: V2 },
    steps: async (s, f) => {
      enter(s, ["r1"]); finishRace(s, ["r1"]);
      const days = DAYS; const riderIds = ["r1", "r2"];
      for (const gameDay of days) {
        await runTeamTrainingDay({
          supabase: f.supabase, teamId: TEAM, seasonId: SEASON.id, seasonNumber: SEASON.number, now: EVENING_AT, tickDateOverride: DATE, gameDay,
          dateGameDays: days, executedBy: "assistant", eligibleRiderIds: riderIds, unresolvedSlotsByRider: {},
          deadlineAt: trainingDateDeadline(DATE).toISOString(), deadlineReached: false,
        });
      }
    },
  },
  deadline_unknown_slot: {
    seed: { flags: V2 },
    steps: async (s, f) => {
      enter(s, ["r2"]);
      const riderIds = ["r1", "r2"];
      const unresolved = { r2: [{ raceId: RACE, stageNumber: 1, gameDay: 43 }] };
      const late = new Date("2026-11-10T02:00:00Z");
      for (const gameDay of DAYS) {
        await runTeamTrainingDay({
          supabase: f.supabase, teamId: TEAM, seasonId: SEASON.id, seasonNumber: SEASON.number, now: late, tickDateOverride: DATE, gameDay,
          dateGameDays: DAYS, executedBy: "assistant", eligibleRiderIds: riderIds, unresolvedSlotsByRider: unresolved,
          deadlineAt: trainingDateDeadline(DATE).toISOString(), deadlineReached: true,
        });
      }
    },
  },
};

export async function runScenario(name) {
  const scenario = SCENARIOS[name];
  const state = seedState(scenario.seed);
  const fake = createFake(state);
  await scenario.steps(state, fake);
  return { digest: digest(fake.log), writes: fake.log.length };
}

export async function runAllScenarios() {
  const out = {};
  for (const name of Object.keys(SCENARIOS)) out[name] = await runScenario(name);
  return out;
}
