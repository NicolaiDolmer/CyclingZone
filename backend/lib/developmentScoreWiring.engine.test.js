// #6950: motor-koblingen af Udviklingsscore B og catch-up via loeb, koert gennem
// runTeamTrainingDay. Tallene er syntetiske (hard rule 17). Testene laaser:
//   · flag off (ogsaa med params i miljoeet) = bit-identisk med i dag (golden)
//   · flag on uden params eller uden dato-loftet (#7075) = dagens model
//   · flag on + params = scoren styrer udviklingen; S10 ingen bidrag
//   · D6: AI-hold udvikler sig ikke, naar scoren eller catch-up er taendt
//   · catch-up: kun loebsdagen, og ikke oven i scoren
import test from "node:test";
import assert from "node:assert/strict";

import { runTeamTrainingDay } from "./dailyTrainingEngine.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { DEVELOPMENT_SCORE_V2_FLAG_KEY, DEVELOPMENT_SCORE_V2_PARAMS_ENV } from "./developmentScoreWiring.js";
import { RACE_DAY_CATCHUP_FLAG_KEY, RACE_DAY_CATCHUP_PARAMS_ENV } from "./raceCatchUpWiring.js";
import { SCORE_PARAMS, CATCHUP_PARAMS } from "./developmentScoreWiring.fixtures.js";

// ── Lille in-memory Supabase-mock (kopi af dailyTrainingManagerOnly.test.js) ──
function createMockSupabase(state, opts = {}) {
  const calls = opts.calls ?? [];
  function builder(table, op = "select", filters = [], patch = null) {
    // #6759: PostgREST-JSON-sti ("report->>token") slaas op i kolonnens objekt.
    const cell = (row, col) => (col.includes("->>") ? row[col.split("->>")[0]]?.[col.split("->>")[1]] : row[col]);
    const matchRow = (rawRow) => !filters.some(([col, val, fop]) => {
      if (fop === "meta") return false;
      const row = { [col]: cell(rawRow, col) };
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
        // #6759: .update()/.delete() + .select() returnerer de ramte raekker.
        if (op === "update") {
          const hit = state[table].filter(matchRow);
          for (const row of hit) Object.assign(row, patch);
          result = { data: hit, error: null };
        } else if (op === "delete") {
          const hit = state[table].filter(matchRow);
          state[table] = state[table].filter((row) => !matchRow(row));
          result = { data: hit, error: null };
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
const SEASON_ID = "season-1";
const SEASON_NUMBER = 1;
const NOW = new Date("2026-06-12T10:00:00+02:00");
const IMPORTED_AT_TODAY = "2026-06-12T08:00:00Z";

const MANAGER_TEAM = { id: TEAM_ID, user_id: "user-a", is_ai: false, is_bank: false, is_test_account: false };
const AI_TEAM = { id: TEAM_ID, user_id: null, is_ai: true, is_bank: false, is_test_account: false };

function seed({ team = MANAGER_TEAM, flags = {}, raced = false } = {}) {
  const state = {
    riders: [{
      id: "r1", team_id: TEAM_ID, primary_type: "climber", potentiale: 4, birthdate: "2003-01-01",
      firstname: "Test", lastname: "Rytter", is_retired: false,
    }],
    rider_derived_abilities: [{
      rider_id: "r1", ...Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 50])),
      ability_caps: null, ability_progress: { climbing: 0.4 },
    }],
    rider_condition: [{ rider_id: "r1", form: 50, fatigue: 40, injured_until: null, injury_cause: null }],
    training_plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
    training_day_runs: [],
    teams: team ? [team] : [],
    app_config: Object.entries(flags).map(([key, value]) => ({ key, value })),
  };
  if (raced) {
    // Kalenderdags-stien: rytteren koerte en bjergetape i dag, og loebsudviklingen er taendt.
    state.app_config.push({ key: "race_day_development_enabled", value: "on" });
    state.race_results = [{ rider_id: "r1", result_type: "stage", race_id: "race-1", stage_number: 1, imported_at: IMPORTED_AT_TODAY }];
    state.race_stage_profiles = [{ race_id: "race-1", stage_number: 1, profile_type: "mountain" }];
  }
  return state;
}

const ALL_PARAMS_ENV = {
  [DEVELOPMENT_SCORE_V2_PARAMS_ENV]: JSON.stringify(SCORE_PARAMS),
  [RACE_DAY_CATCHUP_PARAMS_ENV]: JSON.stringify(CATCHUP_PARAMS),
};

async function run(state, { env = {}, calls } = {}) {
  const keys = [DEVELOPMENT_SCORE_V2_PARAMS_ENV, RACE_DAY_CATCHUP_PARAMS_ENV];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const result = await runTeamTrainingDay({
      supabase: createMockSupabase(state, { calls }), teamId: TEAM_ID, seasonId: SEASON_ID,
      seasonNumber: SEASON_NUMBER, executedBy: "assistant", now: NOW,
    });
    return { result, warnings };
  } finally {
    console.warn = warn;
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

// Spil-state der skal vaere bit-identisk (training_day_runs uden mock-id).
function gameState(state) {
  return structuredClone({
    rider_derived_abilities: state.rider_derived_abilities,
    rider_condition: state.rider_condition,
    rider_derived_ability_history: state.rider_derived_ability_history ?? [],
    rider_training_scores: state.rider_training_scores ?? [],
    training_day_runs: state.training_day_runs.map(({ id: _id, ...row }) => row),
  });
}

const CAP = { ability_cap_per_date_enabled: "on" };
const SCORE_ON = { ...CAP, [DEVELOPMENT_SCORE_V2_FLAG_KEY]: "on" };
const CATCHUP_ON = { ...CAP, [RACE_DAY_CATCHUP_FLAG_KEY]: "on" };
const BOTH_ON = { ...SCORE_ON, [RACE_DAY_CATCHUP_FLAG_KEY]: "on" };

// ── Golden: slukket = bit-identisk, ogsaa med params i miljoeet ───────────────
for (const raced of [false, true]) {
  for (const value of [null, "off", "beta"]) {
    test(`#6950 golden (${raced ? "loebsdag" : "traeningsdag"}, flag ${JSON.stringify(value)}): bit-identisk med i dag, ingen holdopslag`, async () => {
      const today = seed({ flags: CAP, raced });
      await run(today);
      const flags = value == null ? CAP : { ...CAP, [DEVELOPMENT_SCORE_V2_FLAG_KEY]: value, [RACE_DAY_CATCHUP_FLAG_KEY]: value };
      const gated = seed({ flags, raced });
      const calls = [];
      await run(gated, { env: ALL_PARAMS_ENV, calls });
      assert.deepEqual(gameState(gated), gameState(today));
      assert.ok(!calls.includes("teams"), "ingen ekstra holdopslag naar flagene er slukket");
    });
  }
}

test("#6950: flag on uden params = dagens model + advarsel uden tal", async () => {
  for (const raced of [false, true]) {
    const today = seed({ flags: CAP, raced });
    await run(today);
    const on = seed({ flags: BOTH_ON, raced });
    const { warnings } = await run(on);
    assert.deepEqual(gameState(on).rider_derived_abilities, gameState(today).rider_derived_abilities);
    assert.deepEqual(on.rider_training_scores, today.rider_training_scores);
    assert.ok(warnings.some((w) => w.includes("[development-score-b]")));
    assert.ok(warnings.some((w) => w.includes("[race-catchup]")));
    assert.ok(!warnings.some((w) => /supplement|midpoint|talentByPotentiale/.test(w)), "advarslen viser aldrig params");
  }
});

test("#6950: flag on, men maks +1 pr. dato slukket = dagens model (scoren taendes aldrig uden dato-loftet)", async () => {
  const today = seed();
  await run(today);
  const on = seed({ flags: { [DEVELOPMENT_SCORE_V2_FLAG_KEY]: "on", [RACE_DAY_CATCHUP_FLAG_KEY]: "on" }, raced: false });
  await run(on, { env: ALL_PARAMS_ENV });
  assert.deepEqual(gameState(on).rider_derived_abilities, gameState(today).rider_derived_abilities);
});

test("#6950: scoren on + params styrer traeningsdagens udvikling, og scorens tal gemmes uden bidrag (S10)", async () => {
  const today = seed({ flags: CAP });
  await run(today);
  const on = seed({ flags: SCORE_ON });
  await run(on, { env: ALL_PARAMS_ENV });
  assert.notDeepEqual(on.rider_derived_abilities[0].ability_progress, today.rider_derived_abilities[0].ability_progress, "scoren aendrer fremdriften");
  const row = on.rider_training_scores.at(-1);
  assert.ok(row.score >= 1 && row.score <= 99);
  assert.equal(row.contributions, null, "ingen faktorer eller bidrag gemmes");
  assert.equal(row.was_race_day, false);
  for (const ability of VISIBLE_ABILITIES) {
    const before = 50;
    assert.ok(on.rider_derived_abilities[0][ability] - before <= 1, `${ability}: hoejst +1 pr. dato`);
  }
});

test("#6950: scoren on paa en loebsdag giver loebsdagens udvikling; loebsdagens tal skrives stadig ikke (PR b)", async () => {
  const today = seed({ flags: CAP, raced: true });
  await run(today);
  const on = seed({ flags: SCORE_ON, raced: true });
  await run(on, { env: ALL_PARAMS_ENV });
  assert.notDeepEqual(on.rider_derived_abilities[0].ability_progress, today.rider_derived_abilities[0].ability_progress);
  const row = on.rider_training_scores.at(-1);
  assert.equal(row.was_race_day, true);
  assert.equal(row.score, null);
});

test("#6950 D6: med scoren eller catch-up taendt udvikler et AI-hold sig ikke (ogsaa uden Udvikling 2.0 del 1-flaget)", async () => {
  for (const [flags, raced] of [[SCORE_ON, false], [CATCHUP_ON, true]]) {
    const ai = seed({ team: AI_TEAM, flags, raced });
    const before = structuredClone(ai.rider_derived_abilities[0]);
    const calls = [];
    const { result } = await run(ai, { env: ALL_PARAMS_ENV, calls });
    assert.ok(calls.includes("teams"), "holdet slaas op");
    for (const k of VISIBLE_ABILITIES) assert.equal(ai.rider_derived_abilities[0][k], before[k], `${k} uaendret`);
    assert.deepEqual(ai.rider_derived_abilities[0].ability_progress, before.ability_progress);
    assert.deepEqual(result.report.riders[0].gains, {});
  }
});

test("#6950 catch-up: loebsdagen faar tillaegget, traeningsdagen er uroert", async () => {
  const trainToday = seed({ flags: CAP });
  await run(trainToday);
  const trainOn = seed({ flags: CATCHUP_ON });
  await run(trainOn, { env: ALL_PARAMS_ENV });
  assert.deepEqual(gameState(trainOn), gameState(trainToday), "traeningsdag: bit-identisk");

  const raceToday = seed({ flags: CAP, raced: true });
  await run(raceToday);
  const raceOn = seed({ flags: CATCHUP_ON, raced: true });
  await run(raceOn, { env: ALL_PARAMS_ENV });
  const p0 = raceToday.rider_derived_abilities[0];
  const p1 = raceOn.rider_derived_abilities[0];
  const progressed = (row, k) => Number(row[k]) + Number(row.ability_progress?.[k] ?? 0);
  assert.ok(progressed(p1, "climbing") > progressed(p0, "climbing"), "etapens hovedevne faar mere");
});

test("#6950: scoren og catch-up taendt sammen = scoren alene (loebets ekstra taelles ikke to gange)", async () => {
  for (const raced of [false, true]) {
    const scoreOnly = seed({ flags: SCORE_ON, raced });
    await run(scoreOnly, { env: ALL_PARAMS_ENV });
    const both = seed({ flags: BOTH_ON, raced });
    await run(both, { env: ALL_PARAMS_ENV });
    assert.deepEqual(gameState(both).rider_derived_abilities, gameState(scoreOnly).rider_derived_abilities);
    assert.deepEqual(both.rider_training_scores, scoreOnly.rider_training_scores);
  }
});
