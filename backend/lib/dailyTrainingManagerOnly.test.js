// #6500 (Udvikling 2.0 del 1, D6): daglig udvikling kun paa managerhold, bag
// `development_v2_aging_enabled`. Accept-kriterierne fra issuet:
//   · AI-hold: ingen evneaendring, men uaendret form/traethed/skade/score
//   · managerhold: bit-identisk med flaget slukket
//   · holdskifte: udvikling fra dagen efter
//   · flaget slukket: bit-identisk (ogsaa for AI-hold, og uden teams-opslag)
import test from "node:test";
import assert from "node:assert/strict";

import {
  runTeamTrainingDay, DEVELOPMENT_V2_AGING_FLAG_KEY, isManagerTeamForDevelopment,
} from "./dailyTrainingEngine.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { TRAINING_TICK_PER_RACE_DAY_FLAG_KEY } from "./trainingTickRaceDayFlag.js";

// ── Lille in-memory Supabase-mock (samme semantik som dailyTrainingEngine.test.js) ──
function createMockSupabase(state, opts = {}) {
  const calls = opts.calls ?? [];
  function builder(table, op = "select", filters = [], patch = null) {
    const matchRow = (row) => !filters.some(([col, val, fop]) => {
      if (fop === "meta") return false;
      if (fop === "gte") return !(row[col] >= val);
      if (fop === "lt") return !(row[col] < val);
      if (fop === "lte") return !(row[col] <= val);
      if (fop === "in") return !val.includes(row[col]);
      return row[col] !== val;
    });
    const next = (f) => builder(table, op, [...filters, f], patch);
    const obj = {
      select() { return builder(table, op === "select" ? "select" : op, filters, patch); },
      eq(col, val) { return next([col, val, "eq"]); },
      is(col, val) { return next([col, val, "eq"]); },
      gte(col, val) { return next([col, val, "gte"]); },
      lt(col, val) { return next([col, val, "lt"]); },
      lte(col, val) { return next([col, val, "lte"]); },
      in(col, vals) { return next([col, vals, "in"]); },
      order(col, o = {}) { return next(["__order", { col, ascending: o.ascending !== false }, "meta"]); },
      limit(n) { return next(["__limit", n, "meta"]); },
      async maybeSingle() {
        const result = await new Promise((resolve) => obj.then(resolve));
        return { data: (result.data ?? [])[0] ?? null, error: result.error };
      },
      update(p) {
        opts.updates?.push({ table, patch: structuredClone(p) });
        return builder(table, "update", filters, p);
      },
      delete() { return builder(table, "delete", filters, patch); },
      insert(row) {
        state[table] ??= [];
        const r = Array.isArray(row) ? row[0] : row;
        if (table === "training_day_runs") {
          const hasGameDay = r.game_day != null;
          const exists = state[table].some((x) => ((x.game_day != null) === hasGameDay) && (hasGameDay
            ? x.team_id === r.team_id && x.season_id === r.season_id && (x.squad ?? "senior") === (r.squad ?? "senior") && x.game_day === r.game_day
            : x.team_id === r.team_id && x.tick_date === r.tick_date));
          if (exists) return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
        }
        for (const x of (Array.isArray(row) ? row : [row])) state[table].push({ ...x });
        return Promise.resolve({ error: null });
      },
      upsert(rows, upsertOpts = {}) {
        state[table] ??= [];
        const conflict = (upsertOpts.onConflict || "").split(",").map((s) => s.trim()).filter(Boolean);
        for (const r of (Array.isArray(rows) ? rows : [rows])) {
          const idx = conflict.length ? state[table].findIndex((x) => conflict.every((c) => x[c] === r[c])) : -1;
          if (idx >= 0) { if (!upsertOpts.ignoreDuplicates) Object.assign(state[table][idx], r); } else state[table].push({ ...r });
        }
        return Promise.resolve({ error: null });
      },
      then(resolve) {
        state[table] ??= [];
        let result;
        if (op === "update") {
          for (const row of state[table]) if (matchRow(row)) Object.assign(row, patch);
          result = { error: null };
        } else if (op === "delete") {
          state[table] = state[table].filter((row) => !matchRow(row));
          result = { error: null };
        } else if (opts.injectTeamsError && table === "teams") {
          result = { data: null, error: { message: opts.injectTeamsError } };
        } else {
          let rows = state[table].filter(matchRow);
          const ord = filters.find((f) => f[2] === "meta" && f[0] === "__order")?.[1];
          const lim = filters.find((f) => f[2] === "meta" && f[0] === "__limit")?.[1];
          if (ord) rows = [...rows].sort((a, b) => (ord.ascending ? a[ord.col] - b[ord.col] : b[ord.col] - a[ord.col]));
          if (Number.isFinite(lim)) rows = rows.slice(0, lim);
          result = { data: rows, error: null };
        }
        return Promise.resolve(result).then(resolve);
      },
    };
    return obj;
  }
  return {
    async rpc(name, args) {
      if (name === "register_training_date_work") {
        state.training_date_work ??= [];
        let work = state.training_date_work.find((row) => row.team_id === args.p_team_id && row.season_id === args.p_season_id && row.tick_date === args.p_tick_date);
        if (!work) {
          work = {
            team_id: args.p_team_id, season_id: args.p_season_id, tick_date: args.p_tick_date, game_days: args.p_game_days,
            expected_rider_ids: args.p_expected_rider_ids, deadline_at: args.p_deadline_at, status: "pending", quarantined_rider_ids: [],
            opening_conditions: Object.fromEntries((state.rider_condition ?? []).filter((row) => args.p_expected_rider_ids.includes(row.rider_id)).map((row) => [row.rider_id, structuredClone(row)])),
          };
          state.training_date_work.push(work);
        }
        return { data: work, error: null };
      }
      assert.equal(name, "commit_training_date_tick");
      for (const item of args.p_abilities) Object.assign(state.rider_derived_abilities.find((row) => row.rider_id === item.riderId), item.patch);
      for (const item of args.p_conditions) Object.assign(state.rider_condition.find((row) => row.rider_id === item.rider_id), item);
      state.rider_training_scores ??= [];
      state.rider_training_scores.push(...args.p_scores);
      state.rider_derived_ability_history ??= [];
      state.rider_derived_ability_history.push(...args.p_history);
      state.rider_ability_race_day_history ??= [];
      state.rider_ability_race_day_history.push(...args.p_race_history);
      state.training_rider_ticks ??= [];
      for (const report of args.p_report.riders) {
        state.training_rider_ticks.push({ rider_id: report.rider_id, season_id: args.p_season_id, game_day: args.p_game_day, tick_date: args.p_tick_date, team_id: args.p_team_id, report });
      }
      state.training_day_runs.push({ team_id: args.p_team_id, season_id: args.p_season_id, squad: args.p_squad, game_day: args.p_game_day, tick_date: args.p_tick_date, report: args.p_report });
      return { data: { already_ran: false, report: args.p_report }, error: null };
    },
    from(table) {
      calls.push(table);
      state[table] ??= [];
      return builder(table);
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
const TEAM_ID = "team-a";
const OTHER_TEAM_ID = "team-b";
const SEASON_ID = "season-1";
const SEASON_NUMBER = 1;
const NOW = new Date("2026-06-12T10:00:00+02:00");
const NEXT_DAY = new Date("2026-06-13T10:00:00+02:00");

const MANAGER_TEAM = { id: TEAM_ID, user_id: "user-a", is_ai: false, is_bank: false, is_test_account: false };
const AI_TEAM = { id: TEAM_ID, user_id: null, is_ai: true, is_bank: false, is_test_account: false };

// climbing-progress 0.999 + vo2max/hard ⇒ én hel evne-gevinst (samme greb som
// dailyTrainingEngine.test.js), saa baade patch, historik og gains_detail roeres.
function seed({ team = MANAGER_TEAM, flag = null, riderTeamId = TEAM_ID } = {}) {
  return {
    riders: [{
      id: "r1", team_id: riderTeamId, primary_type: "climber", potentiale: 4, birthdate: "2003-01-01",
      firstname: "Test", lastname: "Rytter", is_retired: false,
    }],
    rider_derived_abilities: [{
      rider_id: "r1", ...Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 50])),
      ability_caps: null, ability_progress: { climbing: 0.999 },
    }],
    rider_condition: [{ rider_id: "r1", form: 50, fatigue: 40, injured_until: null, injury_cause: null }],
    training_plans: [
      { rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" },
      { rider_id: "r1", team_id: OTHER_TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" },
    ],
    training_day_runs: [],
    teams: team ? [team] : [],
    app_config: flag == null ? [] : [{ key: DEVELOPMENT_V2_AGING_FLAG_KEY, value: flag }],
  };
}

function run(state, extra = {}) {
  return runTeamTrainingDay({
    supabase: createMockSupabase(state, extra.mockOpts), teamId: TEAM_ID, seasonId: SEASON_ID,
    seasonNumber: SEASON_NUMBER, executedBy: "assistant", now: NOW, ...extra,
  });
}

// Spil-state der skal vaere bit-identisk (training_day_runs uden mock-id).
function gameState(state) {
  return structuredClone({
    rider_derived_abilities: state.rider_derived_abilities,
    rider_condition: state.rider_condition,
    rider_derived_ability_history: state.rider_derived_ability_history ?? [],
    rider_ability_race_day_history: state.rider_ability_race_day_history ?? [],
    rider_training_scores: state.rider_training_scores ?? [],
    training_day_runs: state.training_day_runs.map(({ id: _id, ...row }) => row),
  });
}

// ── Diskriminatoren ───────────────────────────────────────────────────────────
test("#6500: managerhold = user_id sat og ingen af is_ai/is_bank/is_test_account", () => {
  assert.equal(isManagerTeamForDevelopment(MANAGER_TEAM), true);
  assert.equal(isManagerTeamForDevelopment({ ...MANAGER_TEAM, is_ai: null, is_bank: null }), true, "NULL-flag = ikke sat");
  assert.equal(isManagerTeamForDevelopment({ ...MANAGER_TEAM, is_ai: true }), false);
  assert.equal(isManagerTeamForDevelopment({ ...MANAGER_TEAM, is_bank: true }), false);
  assert.equal(isManagerTeamForDevelopment({ ...MANAGER_TEAM, is_test_account: true }), false);
  assert.equal(isManagerTeamForDevelopment({ ...MANAGER_TEAM, user_id: null }), false);
  assert.equal(isManagerTeamForDevelopment(null), false);
});

// ── Flag slukket = bit-identisk ───────────────────────────────────────────────
for (const flag of [null, "off", "beta", false]) {
  test(`#6500 flag ${JSON.stringify(flag)}: AI-hold udvikler sig som i dag, og teams slaas ikke op`, async () => {
    const baseline = seed({ team: AI_TEAM });
    await run(baseline);
    const gated = seed({ team: AI_TEAM, flag });
    const calls = [];
    await run(gated, { mockOpts: { calls } });
    assert.deepEqual(gameState(gated), gameState(baseline));
    assert.ok(!calls.includes("teams"), "ingen ekstra DB-kald naar flaget er slukket");
    assert.equal(gated.rider_derived_abilities[0].climbing, 51, "forudsaetning: AI-holdet fik sin gevinst");
  });
}

// ── Managerhold = bit-identisk med flaget taendt ──────────────────────────────
for (const flag of ["on", true]) {
  test(`#6500 flag ${JSON.stringify(flag)}: managerhold er bit-identisk med flag slukket`, async () => {
    const off = seed();
    await run(off);
    const on = seed({ flag });
    await run(on);
    assert.deepEqual(gameState(on), gameState(off));
    assert.equal(on.rider_derived_abilities[0].climbing, 51);
    assert.equal(on.rider_derived_ability_history.length, 1);
  });
}

// ── Ikke-managerhold: tick'et koerer, udviklingen staar stille ────────────────
const NON_MANAGER_TEAMS = {
  ai: AI_TEAM,
  bank: { ...MANAGER_TEAM, is_bank: true },
  test: { ...MANAGER_TEAM, is_test_account: true },
  "uden manager": { ...MANAGER_TEAM, user_id: null },
};
for (const [label, team] of Object.entries(NON_MANAGER_TEAMS)) {
  test(`#6500 flag on, ${label}-hold: ingen evneaendring, men form/traethed/skade/score uaendret`, async () => {
    const manager = seed({ flag: "on" });
    const managerResult = await run(manager);
    const other = seed({ team, flag: "on" });
    const before = structuredClone(other.rider_derived_abilities[0]);
    const updates = [];
    const result = await run(other, { mockOpts: { updates } });
    const abilityPatches = updates.filter((u) => u.table === "rider_derived_abilities").map((u) => u.patch);
    for (const patch of abilityPatches) {
      assert.ok(!("ability_progress" in patch), "ability_progress skrives slet ikke");
      for (const k of VISIBLE_ABILITIES) assert.ok(!(k in patch), `${k} skrives slet ikke`);
    }

    const ab = other.rider_derived_abilities[0];
    for (const k of VISIBLE_ABILITIES) assert.equal(ab[k], before[k], `${k} uaendret`);
    assert.deepEqual(ab.ability_progress, before.ability_progress, "ability_progress uaendret");
    assert.equal((other.rider_derived_ability_history ?? []).length, 0, "ingen kalenderdags-historik");
    assert.equal((other.rider_ability_race_day_history ?? []).length, 0, "ingen loebsdags-historik");

    assert.deepEqual(other.rider_condition, manager.rider_condition, "form/traethed/skade som managerhold");
    assert.deepEqual(other.rider_training_scores, manager.rider_training_scores, "traeningsscoren som managerhold");

    const rr = result.report.riders[0];
    const mr = managerResult.report.riders[0];
    assert.deepEqual(rr.gains, {});
    assert.deepEqual(rr.gains_detail, {});
    assert.deepEqual(rr.progress_after, rr.progress_before);
    assert.equal(rr.score, mr.score);
    assert.equal(rr.status, mr.status);
    assert.equal(rr.form, mr.form);
    assert.equal(rr.fatigue, mr.fatigue);
    assert.equal(rr.injured, mr.injured);
    assert.ok(mr.gains.climbing >= 1, "forudsaetning: managerholdet fik en gevinst");
  });
}

// ── Holdskifte: udvikling fra dagen efter ─────────────────────────────────────
test("#6500 flag on: rytter der skifter fra AI- til managerhold udvikler sig dagen efter", async () => {
  const state = seed({ team: AI_TEAM, flag: "on" });
  state.teams.push({ ...MANAGER_TEAM, id: OTHER_TEAM_ID });

  const day1 = await run(state);
  assert.deepEqual(day1.report.riders[0].gains, {}, "dag 1 paa AI-holdet: ingen udvikling");
  assert.equal(state.rider_derived_abilities[0].climbing, 50);

  // Transfer mellem de to ticks: rytteren hoerer nu til managerholdet.
  state.riders[0].team_id = OTHER_TEAM_ID;
  const aiDay2 = await run(state, { now: NEXT_DAY });
  assert.equal(aiDay2.report.riders.length, 0, "det gamle AI-hold traener ham ikke laengere");

  const day2 = await run(state, { now: NEXT_DAY, teamId: OTHER_TEAM_ID });
  assert.ok(day2.report.riders[0].gains.climbing >= 1, "dag 2 paa managerholdet: udvikling");
  assert.equal(state.rider_derived_abilities[0].climbing, 51);
  assert.equal(state.rider_derived_ability_history.length, 1);
});

// ── Regel-gaten kaster i stedet for at gaette ─────────────────────────────────
test("#6500 flag on: fejlet holdopslag kaster, og reservationen slettes til retry", async () => {
  const state = seed({ flag: "on" });
  const before = structuredClone(state.rider_derived_abilities);
  await assert.rejects(run(state, { mockOpts: { injectTeamsError: "teams down" } }), /team load .*teams down/);
  assert.equal(state.training_day_runs.length, 0, "ingen haengende reservation");
  assert.deepEqual(state.rider_derived_abilities, before);
});

test("#6500 flag on: manglende holdraekke kaster", async () => {
  const state = seed({ team: null, flag: "on" });
  await assert.rejects(run(state), /team row not found/);
  assert.equal(state.training_day_runs.length, 0);
});

// ── Loebsdags-aksen (#4846): samme gate, ogsaa for soesterbordet ──────────────
function seedRaceDayAxis(state, gameDay = 12) {
  state.app_config.push({ key: TRAINING_TICK_PER_RACE_DAY_FLAG_KEY, value: "on" });
  state.teams = state.teams.map((t) => ({ ...t, league_division_id: "div-1" }));
  state.races = [{ id: "race-1", season_id: SEASON_ID, league_division_id: "div-1" }];
  state.race_stage_schedule = [
    { race_id: "race-1", stage_number: 1, game_day: gameDay, scheduled_at: "2026-06-12T06:00:00Z" },
  ];
}

test("#6500 flag on, loebsdags-aksen: AI-hold skriver ingen loebsdags-historik; managerhold uaendret", async () => {
  const offManager = seed();
  seedRaceDayAxis(offManager);
  await run(offManager, { gameDay: 12, eligibleRiderIds: ["r1"] });
  const onManager = seed({ flag: "on" });
  seedRaceDayAxis(onManager);
  await run(onManager, { gameDay: 12, eligibleRiderIds: ["r1"] });
  assert.deepEqual(gameState(onManager), gameState(offManager));
  assert.equal(onManager.rider_ability_race_day_history.length, 1, "forudsaetning: managerholdet fik et snapshot");

  const ai = seed({ team: AI_TEAM, flag: "on" });
  seedRaceDayAxis(ai);
  const result = await run(ai, { gameDay: 12, eligibleRiderIds: ["r1"] });
  assert.deepEqual(result.report.riders[0].gains, {});
  assert.equal((ai.rider_ability_race_day_history ?? []).length, 0);
  assert.equal((ai.rider_derived_ability_history ?? []).length, 0);
  assert.equal(ai.rider_derived_abilities[0].climbing, 50);
  assert.deepEqual(ai.rider_condition, onManager.rider_condition);
});

// ── Dato-afregningen (training_condition_per_date): flaget laeses strict ───────
async function runDate(state) {
  const dateGameDays = [1, 2, 3, 4, 5];
  let last;
  for (const gameDay of dateGameDays) last = await run(state, { gameDay, dateGameDays, eligibleRiderIds: ["r1"] });
  return last;
}

test("#6500 flag on, dato-afregning: AI-hold faar ingen evner over fem loebsdage, traethed som managerhold", async () => {
  const manager = seed({ flag: "on" });
  seedRaceDayAxis(manager, 1);
  manager.app_config.push({ key: "training_condition_per_date", value: "on" });
  await runDate(manager);

  const ai = seed({ team: AI_TEAM, flag: "on" });
  seedRaceDayAxis(ai, 1);
  ai.app_config.push({ key: "training_condition_per_date", value: "on" });
  const before = structuredClone(ai.rider_derived_abilities[0]);
  await runDate(ai);

  const ab = ai.rider_derived_abilities[0];
  for (const k of VISIBLE_ABILITIES) assert.equal(ab[k], before[k], `${k} uaendret`);
  assert.deepEqual(ab.ability_progress, before.ability_progress);
  assert.equal(ai.rider_derived_ability_history.length, 0);
  assert.equal(ai.rider_ability_race_day_history.length, 0);
  assert.deepEqual(ai.rider_condition, manager.rider_condition, "afregnet form/traethed som managerhold");
  assert.ok(manager.rider_derived_abilities[0].climbing > 50, "forudsaetning: managerholdet udviklede sig");
});

test("#6500 dato-afregning: fejlet flag-laesning kaster i stedet for at blive tolket som slukket", async () => {
  const state = seed({ team: AI_TEAM, flag: "on" });
  seedRaceDayAxis(state, 1);
  state.app_config.push({ key: "training_condition_per_date", value: "on" });
  const underlying = createMockSupabase(state);
  const supabase = {
    ...underlying,
    from(table) {
      if (table !== "app_config") return underlying.from(table);
      let key;
      return {
        select() { return this; },
        eq(_col, value) { key = value; return this; },
        async maybeSingle() {
          if (key === DEVELOPMENT_V2_AGING_FLAG_KEY) return { data: null, error: { message: "flag outage" } };
          return { data: state.app_config.find((row) => row.key === key) ?? null, error: null };
        },
      };
    },
  };
  const before = structuredClone(state.rider_derived_abilities);
  await assert.rejects(run(state, { supabase, gameDay: 1, dateGameDays: [1, 2, 3, 4, 5], eligibleRiderIds: ["r1"] }), /flag outage/);
  assert.deepEqual(state.rider_derived_abilities, before);
});
