// #6490 B: the evening run (runNormalizedTrainingDateSweep) with and without the train-now press
// memory. Scenarios run the REAL sweep and the REAL engine (runTeamTrainingDay) against the database
// stand-in from the #7982 judge's harness (trainNowSameResult7982.harness.js, untouched): it answers
// from in-memory tables, records every call in order and applies the writes, so the next read sees them.
//
// The same file produced the frozen golden (trainingSweepMemory6490.golden.json) on the merge base,
// before the switch existed: there the sweep ignores `loadSweepMemory` and runs its only path. The
// test then runs this branch with the switch off (must match the golden bit for bit, reads included)
// and on (writes, final tables and sweep summaries must match; reads may only get fewer).
//
// Only digests and call counts leave this file: no engine numbers (rule 17).
import {
  seedState, createFake, finishRace, press, canon, digest, stateDigest, writesDigest, countCalls,
  SEASON, DIVISION, DATE1, DAYS1, EVENING_AT, rider,
} from "./trainNowSameResult7982.harness.js";
import { runNormalizedTrainingDateSweep, ridersJoinedOnDate, __resetNormalizedTrainingDateCacheForTests } from "./trainingDateClose.js";
import { runTeamTrainingDay } from "./dailyTrainingEngine.js";

const BIG = { count: 48, entered: [3, 7, 11, 19, 23, 31, 40], injured: [5, 23], tired: [2, 14, 29, 44], noPlan: [4, 16, 33], boughtLate: [47], academy: [46], weekPlan: true, fatigueRules: true, staff: true };
const QUIET = { info() {}, warn() {}, error() {}, log() {} };
// The date's deadline (02:00 Copenhagen the next morning) has passed.
const AFTER_DEADLINE = new Date("2026-11-10T01:30:00Z");
const copenhagenDate = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** The per-date context loadTrainingDateContext reads, built from the stand-in's tables. */
function contextFrom(state, tickDate) {
  const stages = state.race_stage_schedule.filter((row) => row.scheduled_at.startsWith(tickDate))
    .map(({ race_id, stage_number, game_day, scheduled_at }) => ({ race_id, stage_number, game_day, scheduled_at }));
  return {
    tickDate,
    races: structuredClone(state.races),
    teams: structuredClone(state.teams),
    riders: structuredClone(state.riders.filter((row) => !row.is_retired && row.team_id != null)),
    stages,
    runs: structuredClone(state.race_simulation_runs),
    entries: structuredClone(state.race_entries),
    results: structuredClone(state.race_results.filter((row) => ["stage", "gc"].includes(row.result_type))),
    incidents: structuredClone(state.race_incidents),
    loads: structuredClone(state.training_race_loads.filter((row) => row.tick_date === tickDate)),
    candidateRiderIdsByRace: new Map(),
    frozenEntries: state.training_train_now_locks.filter((row) => row.tick_date === tickDate && row.instant_entry_snapshot?.slots)
      .map((row) => ({ rider_id: row.rider_id, slots: structuredClone(row.instant_entry_snapshot.slots) })),
    gameDaysByDivision: new Map([[DIVISION, [...DAYS1]]]),
  };
}

/** One evening sweep for DATE1, as cron calls it, with the stand-in in place of the cron's loaders. */
async function eveningSweep(state, fake, { now = EVENING_AT, memory }) {
  const summary = await runNormalizedTrainingDateSweep({
    supabase: fake.supabase, now, runDay: runTeamTrainingDay, onAlarm: null, logger: QUIET,
    loadDaySpans: async () => new Map(),
    loadIndex: async () => ({ jobs: [{ season: { ...SEASON }, tickDate: DATE1 }], today: copenhagenDate(now), activeSeasonId: SEASON.id }),
    loadContext: async ({ tickDate }) => contextFrom(state, tickDate),
    loadWorkRows: async ({ tickDate }) => structuredClone(state.training_date_work.filter((row) => row.tick_date === tickDate)),
    loadLegacyRuns: async () => new Set(),
    loadTeams: async () => structuredClone(state.teams),
    dispatchAlarms: async () => ({ dates: 0, failed: 0 }),
    refreshRankings: async () => {},
    elapsedClock: () => 0,
    teamConcurrency: 1,
    // Ignored on the merge base (no switch there).
    loadSweepMemory: async () => memory,
    // #8606: the open-date check for riders who joined later, answered from the stand-in's
    // tables like loadTeams above (ignored on the merge base, so the golden is unchanged).
    loadJoinedRiders: async ({ tickDate }) => ridersJoinedOnDate(structuredClone(state.riders), tickDate),
  });
  return canon(summary);
}

const failCommit = (nth) => ({ base, state }) => base === "commit_training_date_tick" && !state.__failed
  && (state.__commits = (state.__commits ?? 0) + 1) === nth && (state.__failed = true);

// The stand-in's call hook (never fails a call): the first call after the first save releases the rider.
const releaseAfterFirstSave = (riderId) => ({ entry, state }) => {
  if (state.__released) return null;
  if (state.__saved) { state.riders.find((row) => row.id === riderId).team_id = null; state.__released = true; return null; }
  if (entry.kind === "rpc" && String(entry.target).endsWith("commit_training_date_tick")) state.__saved = true;
  return null;
};

/**
 * The scenarios. Each `run(state, fake, sweep, step)` drives the stand-in; `sweep(opts)` is one
 * evening sweep, `step(label, fn)` records an answer. Every scenario starts from a fresh state.
 */
export const SWEEP_SCENARIOS = {
  // The evening on its own, the stage already run: the whole roster settles five race days.
  aften_etape_koert: { seed: { ...BIG, stageRun: true }, async run(s, f, sweep) {
    await sweep({});
    await sweep({ now: new Date("2026-11-09T19:40:00Z") });
  } },
  // Before the stage the race riders wait; after it they settle (the date stays open between).
  aften_foer_og_efter_etape: { seed: { count: 20, entered: [1, 4, 6, 9, 12, 15, 18], injured: [3], tired: [7] }, async run(s, f, sweep) {
    await sweep({});
    finishRace(s);
    await sweep({ now: new Date("2026-11-09T21:00:00Z") });
  } },
  // The race riders wait in the evening; their stage never settles and the deadline passes:
  // the deadline sweep settles them anyway (deadlineReached).
  aften_efter_fristen: { seed: { count: 20, entered: [1, 4, 6, 9], tired: [2] }, async run(s, f, sweep) {
    await sweep({});
    await sweep({ now: AFTER_DEADLINE });
  } },
  // A beta press in the morning (stamped riders, receipts on some race days), stage, evening.
  tryk_saa_aften: { seed: BIG, async run(s, f, sweep, step) {
    await step("tryk", () => press(s, f));
    finishRace(s);
    await sweep({});
  } },
  // An ordinary press (race riders wait), stage, evening.
  almindeligt_tryk_saa_aften: { seed: BIG, async run(s, f, sweep, step) {
    await step("tryk", () => press(s, f, { isBetaTester: false }));
    finishRace(s);
    await sweep({});
  } },
  // The date opens while the race riders wait. Then a waiting race rider is released (departed),
  // one sold (training follows the rider) and an already settled rider released; stage; evening.
  rytter_frigivet_og_solgt: { seed: { count: 14, entered: [2, 9, 11] }, async run(s, f, sweep) {
    await sweep({});
    s.riders.find((row) => row.id === rider(9)).team_id = null;
    s.riders.find((row) => row.id === rider(11)).team_id = "00000000-0000-4000-8000-000000000099";
    s.riders.find((row) => row.id === rider(6)).team_id = null;
    finishRace(s);
    await sweep({ now: new Date("2026-11-09T21:00:00Z") });
  } },
  // A waiting race rider loses his opening condition evidence: quarantined, the rest settle.
  karantaene: { seed: { count: 12, entered: [3, 8] }, async run(s, f, sweep) {
    await sweep({});
    const work = s.training_date_work.find((row) => row.tick_date === DATE1);
    if (work?.opening_conditions) delete work.opening_conditions[rider(3)];
    finishRace(s);
    await sweep({ now: new Date("2026-11-09T21:00:00Z") });
  } },
  // A rider is released in the seconds between the team's first and second race-day save. The
  // second race day must depart him (roster read again), with and without the memory: without the
  // memory's roster question the save guard would quarantine him instead (an ops alarm).
  frigivet_midt_i_holdet: { seed: { count: 10, stageRun: true, entered: [2] }, hook: releaseAfterFirstSave(rider(4)), async run(s, f, sweep) {
    await sweep({});
  } },
  // The third save fails: the team is retained; the next sweep finishes the date.
  gemmekald_fejler: { seed: { count: 14, entered: [2, 5], stageRun: true }, failRpc: failCommit(3), async run(s, f, sweep) {
    await sweep({});
    await sweep({ now: new Date("2026-11-09T19:45:00Z") });
  } },
};

/** Run one scenario in one mode. `memory`: the switch value handed to the sweep. */
export async function runSweepScenario(name, { memory = false } = {}) {
  const scenario = SWEEP_SCENARIOS[name];
  __resetNormalizedTrainingDateCacheForTests();
  const state = seedState(scenario.seed);
  const fake = createFake(state, { failRpc: scenario.failRpc ? (ctx) => scenario.failRpc(ctx) === true : null, fail: scenario.hook ?? null });
  const answers = [];
  const sweepMarks = [];
  const sweep = async (opts) => {
    const before = fake.log.length;
    answers.push({ label: `sweep ${sweepMarks.length + 1}`, response: await eveningSweep(state, fake, { ...opts, memory }) });
    sweepMarks.push(fake.log.slice(before));
  };
  const step = async (label, fn) => {
    try { answers.push({ label, response: canon(await fn()) }); } catch (err) {
      // swallow-ok: a thrown step IS that step's answer in the recording (compared, never lost).
      answers.push({ label, response: { thrown: String(err.message) } });
    }
  };
  const saved = { warn: console.warn, error: console.error, info: console.info, log: console.log };
  for (const key of Object.keys(saved)) console[key] = () => {};
  try { await scenario.run(state, fake, sweep, step); } finally { Object.assign(console, saved); }
  const reads = fake.log.filter((entry) => entry.kind === "read").map(({ target, filters }) => ({ target, filters }));
  const work = state.training_date_work.find((row) => row.tick_date === DATE1) ?? null;
  const short = (value) => String(value).slice(-3);
  return {
    // Who settled which race days, and who left the date how (ids and race days only).
    outcome: {
      receiptDays: Object.fromEntries(Object.entries(Object.groupBy(state.training_rider_ticks.filter((row) => row.tick_date === DATE1), (row) => short(row.rider_id)))
        .sort(([a], [b]) => a.localeCompare(b)).map(([rid, rows]) => [rid, rows.map((row) => row.game_day).sort((a, b) => a - b)])),
      quarantined: (work?.quarantined_rider_ids ?? []).map(short).sort(),
      departed: (work?.departure_evidence ?? []).map((row) => short(row.rider_id)).sort(),
      status: work?.status ?? null,
    },
    answers: digest(answers),
    writes: writesDigest(fake.log),
    state: stateDigest(state),
    reads: digest(reads),
    unsupported: [...new Set(fake.unsupported)].sort(),
    // Per evening sweep: calls and sequential waits on the database (the measurement for the PR).
    sweeps: sweepMarks.map((entries) => {
      const calls = countCalls(entries);
      return { total: calls.total, reads: calls.reads, writes: calls.writes, rpc: calls.rpc, gen: calls.gen, rounds: calls.rounds, byTarget: calls.byTarget };
    }),
  };
}

/** Every scenario in one mode, in a fixed order. */
export async function runAllSweepScenarios(mode = {}) {
  const out = {};
  for (const name of Object.keys(SWEEP_SCENARIOS)) out[name] = await runSweepScenario(name, mode);
  return out;
}
