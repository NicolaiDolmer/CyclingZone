// #7982 bevis 1 (facit): tidlig loebssession + resten kl. 20 skal give bit for bit samme tal som
// alt kl. 20. Begge veje koeres gennem de rigtige indgange (runRaceSessionSettlement og
// aftenkoerslen runTeamTrainingDay) mod dommerens database-stedfortraeder fra
// trainNowSameResult7982.harness.js (fast ur, ingen motortal i filen, regel 17).
//
// Stedfortraederens commit_training_date_tick kender kun Traen nu-stemplet. Indpakningen nedenfor
// giver den migrationens #7982-regel (database/2026-11-15-7982-settle-race-session.sql): en rytter
// med loebssessions-maerket (i rapporten med kontakten taendt og etapens belastning i bogen, eller
// allerede paa en kvittering paa datoen) regnes som stemplet i netop det kald. Selve SQL-reglen er
// proevet mod PostgreSQL i trainingSettleRaceSession7982.test.js.
//
// Tallene sammenlignes, ikke metadata: evner, kondition, afregninger, scorer, historik og hver
// kvitterings tal. Kun felter, der beskriver HVORNAAR eller HVORDAN sessionen blev gemt
// (loebssessions-maerket, kvitterings-snapshottet, den observerede kondition, tidsstempler), er
// taget ud; de skal vaere forskellige.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  seedState, createFake, finishRace, sweep, press, canon, digest,
  TEAM, SEASON, DIVISION, RACE, DATE1, DAYS1, EVENING_AT, rider,
} from "./trainNowSameResult7982.harness.js";
import { runRaceSessionSettlement } from "./trainingSettleRaceSession7982.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const STAGE_DONE_AT = new Date("2026-11-09T16:30:00Z");
export const STAGE2_DONE_AT = new Date("2026-11-09T18:10:00Z");

/** Stedfortraederen med migrationens #7982-regel (se filhovedet). */
export function fakeWithRaceSessionRule(state, options) {
  const fake = createFake(state, options);
  const rpc = fake.supabase.rpc;
  fake.supabase.rpc = (name, args) => {
    if (name.replace(/^try_/, "") !== "commit_training_date_tick") return rpc(name, args);
    const switchOn = state.app_config.find((row) => row.key === "training_settle_race_session")?.value === "on";
    const marked = new Set();
    for (const r of args.p_report?.riders ?? []) {
      if (r.race_session_7982 !== true) continue;
      const load = state.training_race_loads.some((l) => l.rider_id === r.rider_id && l.season_id === args.p_season_id && l.tick_date === args.p_tick_date && l.game_day === args.p_game_day);
      if (!switchOn || !load) return Promise.resolve({ data: null, error: { code: "P0001", message: "Race session settlement requires the switch and the stage load" } });
      marked.add(r.rider_id);
    }
    for (const t of state.training_rider_ticks) if (t.tick_date === args.p_tick_date && t.report?.race_session_7982 === true) marked.add(t.rider_id);
    const synthetic = [...marked].filter((rid) => !state.training_train_now_locks.some((l) => l.rider_id === rid && l.tick_date === args.p_tick_date && l.instant_at != null))
      .map((rid) => ({ rider_id: rid, tick_date: args.p_tick_date, season_id: args.p_season_id, team_id: args.p_team_id, instant_at: "synthetic", __race_session: true }));
    state.training_train_now_locks.push(...synthetic);
    // Stedfortraederen udfoerer funktionen synkront i kaldet; bagefter er laasene vaek igen.
    const out = rpc(name, args);
    state.training_train_now_locks = state.training_train_now_locks.filter((l) => !l.__race_session);
    return out;
  };
  return fake;
}

/** Datoens kontekst som loadTrainingDateContext ville give den, laest af tilstanden. */
export const contextOf = (state) => async () => ({
  tickDate: DATE1, teams: structuredClone(state.teams),
  riders: state.riders.filter((r) => !r.is_retired && r.team_id != null).map((r) => structuredClone(r)),
  races: structuredClone(state.races),
  stages: state.race_stage_schedule.filter((s) => s.scheduled_at.startsWith(DATE1)).map((s) => structuredClone(s)),
  runs: structuredClone(state.race_simulation_runs), entries: structuredClone(state.race_entries),
  results: structuredClone(state.race_results), incidents: structuredClone(state.race_incidents),
  loads: state.training_race_loads.filter((l) => l.tick_date === DATE1).map((l) => structuredClone(l)),
  candidateRiderIdsByRace: new Map(), frozenEntries: [], gameDaysByDivision: new Map([[DIVISION, DAYS1]]),
});

const QUIET = { log() {}, warn() {}, error() {}, info() {} };
/** Delkoerslen, som scheduleren starter den efter etapen. */
export const settle = (state, fake, now = STAGE_DONE_AT) => runRaceSessionSettlement({
  supabase: fake.supabase, now, logger: QUIET, loadDaySpans: async () => new Map(),
  loadContext: contextOf(state), loadFinalDate: async () => "2026-12-20",
});

/** Flyt holdets etape til en anden af datoens loebsdage (foerste, midterste eller sidste). */
export function placeRace(state, gameDay) {
  const row = state.race_stage_schedule.find((s) => s.race_id === RACE && s.stage_number === 1);
  row.game_day = gameDay;
  // FILLER giver datoens oevrige loebsdage; ingen anden etape maa staa paa samme loebsdag.
  for (const s of state.race_stage_schedule) if (s.race_id !== RACE && s.game_day === gameDay && s.scheduled_at.startsWith(DATE1)) s.game_day = 43;
}

/** Etape 1 af loebet er koert (som finishRace), men med belastning paa den rigtige loebsdag. */
export function finishStage1(state) {
  finishRace(state);
  const day = state.race_stage_schedule.find((s) => s.race_id === RACE && s.stage_number === 1).game_day;
  for (const l of state.training_race_loads) if (l.race_id === RACE && l.stage_number === 1) l.game_day = day;
  for (const d of state.race_entry_days) if (d.race_id === RACE) d.game_day = day;
}

/** To etaper samme dato: loebet bliver et etapeloeb med etape 2 paa loebsdag 44. */
export function makeTwoStages(state) {
  const race = state.races.find((r) => r.id === RACE);
  race.race_type = "stage_race"; race.stages = 2;
  state.race_stage_schedule.push({ race_id: RACE, stage_number: 2, game_day: 44, scheduled_at: "2026-11-09T17:30:00Z" });
}
export function finishStage1Of2(state) {
  finishStage1(state);
  const race = state.races.find((r) => r.id === RACE);
  race.status = "running"; race.stages_completed = 1;
}
export function finishStage2(state) {
  const race = state.races.find((r) => r.id === RACE);
  race.stages_completed = 2; race.status = "completed";
  const ids = state.race_entries.filter((row) => row.race_id === RACE).map((row) => row.rider_id);
  state.race_simulation_runs.push({ id: id(7001), race_id: RACE, stage_number: 2, entrant_snapshot: [...ids] });
  ids.forEach((rider_id, i) => {
    state.race_results.push({ id: id(7200 + i), race_id: RACE, stage_number: 2, rider_id, result_type: "stage", rank: ids.length - i, imported_at: "2026-11-09T18:00:00Z" });
    state.training_race_loads.push({ rider_id, race_id: RACE, stage_number: 2, season_id: SEASON.id, game_day: 44, tick_date: DATE1, load: 7, consumed_at: null, duplicate_of_race_id: null, duplicate_of_stage_number: null });
    state.race_entry_days.push({ race_id: RACE, rider_id, team_id: TEAM, season_id: SEASON.id, game_day: 44 });
  });
}

// ── Tallene ───────────────────────────────────────────────────────────────────────────────────
const META = new Set(["race_session_7982", "expected_date_receipt_days", "condition_observed", "created_at", "settled_at", "updated_at", "registered_at", "deadline_at"]);
const strip = (value) => {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => !META.has(k)).map(([k, v]) => [k, strip(v)]));
  return value;
};
const byKey = (rows, keys) => [...rows].sort((a, b) => keys.map((k) => String(a[k])).join("|").localeCompare(keys.map((k) => String(b[k])).join("|")));
export function numbersOf(state) {
  return canon(strip({
    abilities: byKey(state.rider_derived_abilities, ["rider_id"]),
    condition: byKey(state.rider_condition, ["rider_id"]),
    settlements: byKey(state.training_condition_settlements, ["rider_id", "tick_date"]),
    scores: byKey(state.rider_training_scores, ["rider_id", "game_day"]),
    history: byKey(state.rider_derived_ability_history, ["rider_id", "snapshot_date", "source"]),
    raceDayHistory: byKey(state.rider_ability_race_day_history, ["rider_id", "game_day", "source"]),
    receipts: byKey(state.training_rider_ticks, ["rider_id", "game_day"]).map((t) => ({ rider_id: t.rider_id, game_day: t.game_day, tick_date: t.tick_date, team_id: t.team_id, report: t.report })),
    loads: byKey(state.training_race_loads, ["rider_id", "game_day"]).map(({ consumed_at: _c, ...l }) => l),
    work: state.training_date_work.map(({ updated_at: _u, ...w }) => w),
  }));
}

/** Foerste sted, hvor to vaerdier er forskellige (sti), eller null. */
export function firstDiff(a, b, path = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) { const d = firstDiff(a[k], b[k], `${path}.${k}`); if (d) return d; }
  }
  return path || "(rod)";
}

const BASE = { count: 14, entered: [1, 4, 6, 9, 12], tired: [4, 9], noPlan: [6], weekPlan: true, fatigueRules: true, staff: true, flags: { training_settle_race_session: "on" } };

/**
 * Ét scenarie, koert to gange fra samme udgangstilstand:
 *  - "alt kl. 20": ingen delkoersel; etapen afgoeres; aftenkoerslen.
 *  - "tidligt": delkoerslen efter hver etape; resten kl. 20.
 * `before` og `after` er valgfrie skridt (fx et Traen nu-tryk) foer og efter etapen.
 */
export async function runBoth({ seed = BASE, setup = () => {}, stages = "one", before = null, after = null } = {}) {
  const run = async (early) => {
    const state = seedState(seed); setup(state);
    if (stages === "two") makeTwoStages(state);
    const fake = fakeWithRaceSessionRule(state);
    const settled = [];
    if (before) await before(state, fake);
    if (stages === "two") {
      finishStage1Of2(state); if (early) settled.push(await settle(state, fake, STAGE_DONE_AT));
      finishStage2(state); if (early) settled.push(await settle(state, fake, STAGE2_DONE_AT));
    } else {
      finishStage1(state); if (early) settled.push(await settle(state, fake, STAGE_DONE_AT));
    }
    if (after) await after(state, fake);
    const evening = await sweep(state, fake, { now: EVENING_AT });
    return { state, settled, evening, unsupported: fake.unsupported };
  };
  const late = await run(false);
  const early = await run(true);
  return { late, early, lateNumbers: numbersOf(late.state), earlyNumbers: numbersOf(early.state) };
}

const pressBefore = (beta) => (state, fake) => press(state, fake, { isBetaTester: beta });
const pressAfter = (state, fake) => press(state, fake, { now: new Date("2026-11-09T17:00:00Z") });

export const FACIT_CASES = [
  ["en etape, loebssessionen som foerste session", { setup: (s) => placeRace(s, 41) }],
  ["en etape, loebssessionen som midterste session", { setup: (s) => placeRace(s, 43) }],
  ["en etape, loebssessionen som sidste session", { setup: (s) => placeRace(s, 45) }],
  ["to etaper samme dato", { stages: "two", setup: (s) => placeRace(s, 43) }],
  ["Traen nu (beta) foer etapen", { setup: (s) => placeRace(s, 43), before: pressBefore(true) }],
  ["Traen nu (almindeligt) foer etapen", { setup: (s) => placeRace(s, 43), before: pressBefore(false) }],
  ["Traen nu efter etapen", { setup: (s) => placeRace(s, 43), after: pressAfter }],
  ["Traen nu foer og efter etapen, to etaper", { stages: "two", setup: (s) => placeRace(s, 43), before: pressBefore(true), after: pressAfter }],
];

// Facit-reglen (brief, ejer 15/11): er tallene IKKE ens, rettes facit ikke; forskellen beskrives
// som ejerspoergsmaal i PR-teksten. Udfaldet er derfor laast her, praecis som det blev maalt:
//  - Spillets tal er ens i ALLE tilfaelde: evner (ogsaa fremgangen), form, traethed, skade,
//    afregningerne, traeningsscorer, historik, belastningerne og datoregnskabet, og pr. kvittering
//    gevinster, score, intensitet og status.
//  - Kun kvitteringens oejebliksbilleder afviger, i de tilfaelde der staar nedenfor:
//    progress_before/progress_after (fremgangen foer og efter netop den session, som afhaenger af
//    raekkefoelgen sessionerne blev gemt i) og, naar loebssessionen er datoens sidste,
//    form/fatigue/fatigue_delta paa de to kvitteringer, der bytter rolle som den lukkende.
// Proeven fejler, hvis et udfald skifter i nogen retning, saa en senere aendring ikke glider forbi.
const SNAPSHOT = ["progress_after", "progress_before"];
export const FACIT_RECEIPT_FIELDS_THAT_DIFFER = {
  "en etape, loebssessionen som foerste session": [],
  "en etape, loebssessionen som midterste session": SNAPSHOT,
  "en etape, loebssessionen som sidste session": ["fatigue", "fatigue_delta", "form", ...SNAPSHOT],
  "to etaper samme dato": SNAPSHOT,
  "Traen nu (beta) foer etapen": [],
  "Traen nu (almindeligt) foer etapen": SNAPSHOT,
  "Traen nu efter etapen": SNAPSHOT,
  "Traen nu foer og efter etapen, to etaper": [],
};

export function receiptFieldsThatDiffer(lateNumbers, earlyNumbers) {
  const keys = new Set();
  assert.equal(lateNumbers.receipts.length, earlyNumbers.receipts.length, "samme kvitteringer");
  lateNumbers.receipts.forEach((x, i) => {
    const y = earlyNumbers.receipts[i];
    assert.equal(`${x.rider_id}#${x.game_day}`, `${y.rider_id}#${y.game_day}`);
    for (const k of new Set([...Object.keys(x.report), ...Object.keys(y.report)])) {
      if (JSON.stringify(x.report[k]) !== JSON.stringify(y.report[k])) keys.add(k);
    }
  });
  return [...keys].sort();
}

const IS_MAIN = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_MAIN) {
  for (const [name, spec] of FACIT_CASES) {
    test(`facit: ${name}`, async () => {
      const { late, early, lateNumbers, earlyNumbers } = await runBoth(spec);
      assert.deepEqual(early.unsupported, [], "stedfortraederen kender alle kald");
      assert.ok(early.evening.every((r) => !r.error), `aftenkoerslen fejler ikke: ${JSON.stringify(early.evening)}`);
      assert.ok(late.evening.every((r) => !r.error), `aftenkoerslen fejler ikke (alt kl. 20): ${JSON.stringify(late.evening)}`);
      // Delkoerslen afregnede faktisk noget (ellers beviser sammenligningen intet).
      assert.ok(early.settled.length && early.settled.every((s) => s.settled > 0 && s.failed === 0), `delkoerslen afregnede: ${JSON.stringify(early.settled)}`);
      assert.ok(early.state.training_rider_ticks.some((t) => t.report?.race_session_7982 === true), "mindst én loebssession er gemt ved etapen");
      assert.ok(!late.state.training_rider_ticks.some((t) => t.report?.race_session_7982 === true), "alt kl. 20 har ingen loebssession");
      // Spillets tal: bit for bit ens.
      const { receipts: lateReceipts, ...lateState } = lateNumbers;
      const { receipts: earlyReceipts, ...earlyState } = earlyNumbers;
      assert.equal(digest(earlyState), digest(lateState), `spillets tal er ens (foerste forskel: ${firstDiff(lateState, earlyState)})`);
      const plain = (rows) => rows.map((r) => ({ id: `${r.rider_id}#${r.game_day}`, gains: r.report.gains, gains_detail: r.report.gains_detail, score: r.report.score, intensity: r.report.intensity, status: r.report.status, injured: r.report.injured }));
      assert.deepEqual(plain(earlyReceipts), plain(lateReceipts), "pr. kvittering: gevinster, score, intensitet, status");
      // Kvitteringens oejebliksbilleder: praecis de maalte forskelle.
      assert.deepEqual(receiptFieldsThatDiffer(lateNumbers, earlyNumbers), FACIT_RECEIPT_FIELDS_THAT_DIFFER[name]);
    });
  }

  test("facit: ryttere uden loeb faar praecis samme tal og kvitteringer (ogsaa med to etaper og tryk)", async () => {
    const { lateNumbers, earlyNumbers } = await runBoth({ stages: "two", setup: (s) => placeRace(s, 43), before: pressBefore(true) });
    const racers = new Set(BASE.entered.map(rider));
    const others = (n) => JSON.stringify(Object.fromEntries(Object.entries(n).map(([k, rows]) => [k, Array.isArray(rows) ? rows.filter((r) => !racers.has(r.rider_id)) : rows])));
    assert.equal(others(earlyNumbers), others(lateNumbers));
  });
}
