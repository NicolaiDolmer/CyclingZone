// #5950 / #6110: loebsdag = haard dag + rolle-vaegtet tillaeg (raceDayRoleYield5950.js).
// Tallene er syntetiske (hard rule 17); den rigtige kalibrering ligger privat.
// Testene laaser:
//   · flag off (null, "off", "beta"), ogsaa med params i miljoeet = bit-identisk med i dag
//   · flag on uden params = dagens model + vaerdi-fri advarsel
//   · flag on + params: basis er en haard dag, tillaegget er ens i alt for alle roller,
//     rollen afgoer kun hvor det lander, og maks +1 pr. evne pr. loebsdag holder
import test from "node:test";
import assert from "node:assert/strict";

import { runTeamTrainingDay } from "./dailyTrainingEngine.js";
import { applyDailyTick, RACE_PROFILE_ABILITY_MAP } from "./dailyTraining.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { raceDayProgram } from "./raceDayYield.js";
import {
  RACE_DAY_ROLE_YIELD_FLAG_KEY, RACE_DAY_ROLE_YIELD_PARAMS_ENV, RACE_DAY_ROLE_YIELD_PARAMS_KEY,
  DECISIVE_ABILITY_BY_PROFILE, HELPER_ABILITIES_BY_PROFILE,
  isRaceDayRoleYieldEnabled, loadRaceDayRoleYield, raceDayRoleBaseProgram, raceDayRoleBonusWeights,
  raceDayRoleByRider, raceDayRoleGroup, raceDayRoleYieldMultipliers, raceDayRoleAbilityGroups,
  validateRaceDayRoleYieldParams, withRaceDayRoleYield, loadRaceDayRoleByRider,
} from "./raceDayRoleYield5950.js";
import { VALID_RACE_ROLES } from "./raceRoles.js";
import { clearPrivateConfigCache } from "./privateConfig.ts";

// Syntetiske params, IKKE kalibreringen.
const PARAMS = Object.freeze({ stageBonus: 0.5, leadShare: 0.6 });
const PROFILES = Object.keys(RACE_PROFILE_ABILITY_MAP);
const ROLES = [...VALID_RACE_ROLES, null, "unknown_role"];

// ── Lille in-memory Supabase-mock (kopi af developmentScoreWiring.engine.test.js) ──
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

// ── Fixtures til motor-testene (samme form som developmentScoreWiring.engine.test.js) ──
const TEAM_ID = "team-a";
const SEASON_ID = "season-1";
const SEASON_NUMBER = 1;
const NOW = new Date("2026-06-12T10:00:00+02:00");
const IMPORTED_AT_TODAY = "2026-06-12T08:00:00Z";

function seed({ flags = {}, raced = false, profile = "mountain" } = {}) {
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
    teams: [{ id: TEAM_ID, user_id: "user-a", is_ai: false, is_bank: false, is_test_account: false }],
    app_config: Object.entries(flags).map(([key, value]) => ({ key, value })),
  };
  if (raced) {
    state.app_config.push({ key: "race_day_development_enabled", value: "on" });
    state.race_results = [{ rider_id: "r1", result_type: "stage", race_id: "race-1", stage_number: 1, imported_at: IMPORTED_AT_TODAY }];
    state.race_stage_profiles = [{ race_id: "race-1", stage_number: 1, profile_type: profile }];
  }
  return state;
}

async function run(state, { env = {}, calls } = {}) {
  const key = RACE_DAY_ROLE_YIELD_PARAMS_ENV;
  const prev = process.env[key];
  if (env[key] === undefined) delete process.env[key];
  else process.env[key] = env[key];
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  clearPrivateConfigCache();
  try {
    const result = await runTeamTrainingDay({
      supabase: createMockSupabase(state, { calls }), teamId: TEAM_ID, seasonId: SEASON_ID,
      seasonNumber: SEASON_NUMBER, executedBy: "assistant", now: NOW,
    });
    return { result, warnings };
  } finally {
    console.warn = warn;
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

function gameState(state) {
  return structuredClone({
    rider_derived_abilities: state.rider_derived_abilities,
    rider_condition: state.rider_condition,
    rider_derived_ability_history: state.rider_derived_ability_history ?? [],
    rider_training_scores: state.rider_training_scores ?? [],
    training_day_runs: state.training_day_runs.map(({ id: _id, ...row }) => row),
  });
}

const PARAMS_ENV = { [RACE_DAY_ROLE_YIELD_PARAMS_ENV]: JSON.stringify(PARAMS) };
const progressed = (row, k) => Number(row[k]) + Number(row.ability_progress?.[k] ?? 0);

// ── Golden: slukket = bit-identisk, ogsaa med params i miljoeet ───────────────
for (const raced of [false, true]) {
  for (const value of [null, "off", "beta"]) {
    test(`#5950 golden (${raced ? "loebsdag" : "traeningsdag"}, flag ${JSON.stringify(value)}): bit-identisk med i dag, ingen rolle- eller params-opslag`, async () => {
      const today = seed({ raced });
      await run(today);
      const flags = value == null ? {} : { [RACE_DAY_ROLE_YIELD_FLAG_KEY]: value };
      const gated = seed({ flags, raced });
      const calls = [];
      await run(gated, { env: PARAMS_ENV, calls });
      assert.deepEqual(gameState(gated), gameState(today));
      assert.ok(!calls.includes("private_config"), "ingen params-opslag naar flaget er slukket");
      assert.ok(!calls.includes("race_entries"), "ingen rolle-opslag naar flaget er slukket");
    });
  }
}

test("#5950: flag on uden params = dagens loebsdag + advarsel uden tal", async () => {
  for (const raced of [false, true]) {
    const today = seed({ raced });
    await run(today);
    const on = seed({ flags: { [RACE_DAY_ROLE_YIELD_FLAG_KEY]: "on" }, raced });
    const { warnings } = await run(on);
    assert.deepEqual(gameState(on), gameState(today));
    assert.ok(warnings.some((w) => w.includes("[race-day-role-yield]")));
    assert.ok(!warnings.some((w) => /stageBonus|leadShare|0\.5|0\.6/.test(w)), "advarslen viser aldrig params");
  }
});

test("#5950: flag on + params: traeningsdagen er uroert, loebsdagen giver mere i etapens afgoerende evne", async () => {
  const trainToday = seed();
  await run(trainToday);
  const trainOn = seed({ flags: { [RACE_DAY_ROLE_YIELD_FLAG_KEY]: "on" } });
  await run(trainOn, { env: PARAMS_ENV });
  assert.deepEqual(gameState(trainOn), gameState(trainToday), "traeningsdag: bit-identisk");

  const raceToday = seed({ raced: true });
  await run(raceToday);
  const raceOn = seed({ flags: { [RACE_DAY_ROLE_YIELD_FLAG_KEY]: "on" }, raced: true });
  const { warnings } = await run(raceOn, { env: PARAMS_ENV });
  const p0 = raceToday.rider_derived_abilities[0];
  const p1 = raceOn.rider_derived_abilities[0];
  assert.ok(progressed(p1, "climbing") > progressed(p0, "climbing"), "bjergetapens klatring faar mere");
  for (const k of VISIBLE_ABILITIES) assert.ok(p1[k] - 50 <= 1, `${k}: hoejst +1 pr. loebsdag`);
  assert.ok(!warnings.some((w) => w.includes("[race-day-role-yield]")), "ingen advarsel med gyldige params");
});

test("#5950: params fra private_config bruges foer reserven i miljoeet", async () => {
  const fromTable = seed({ flags: { [RACE_DAY_ROLE_YIELD_FLAG_KEY]: "on" }, raced: true });
  fromTable.private_config = [{ key: RACE_DAY_ROLE_YIELD_PARAMS_KEY, value: PARAMS }];
  await run(fromTable);
  const fromEnv = seed({ flags: { [RACE_DAY_ROLE_YIELD_FLAG_KEY]: "on" }, raced: true });
  await run(fromEnv, { env: PARAMS_ENV });
  assert.deepEqual(gameState(fromTable), gameState(fromEnv));
});

// ── Rene funktioner ───────────────────────────────────────────────────────────
test("#5950: params-validering (fail-safe null ved alt ugyldigt)", () => {
  assert.deepEqual(validateRaceDayRoleYieldParams(PARAMS), PARAMS);
  for (const bad of [null, [], "x", {}, { stageBonus: -1, leadShare: 0.5 }, { stageBonus: 0.2, leadShare: 0 },
    { stageBonus: 0.2, leadShare: 1.5 }, { stageBonus: Number.NaN, leadShare: 0.5 }, { stageBonus: 99, leadShare: 0.5 }]) {
    assert.equal(validateRaceDayRoleYieldParams(bad), null, JSON.stringify(bad));
  }
});

test("#5950: slukket kobling returnerer de samme argumenter (samme objekt)", () => {
  const args = { abilityYieldMult: { climbing: 1.2 }, staff: null };
  assert.equal(withRaceDayRoleYield(args, { params: null, profileType: "flat", role: "captain" }), args);
  const empty = {};
  assert.equal(withRaceDayRoleYield(empty), empty);
});

test("#5950: rollegrupper (kaptajn/jaeger leder, hjaelpere hjaelper, fri og ukendt balanceret)", () => {
  assert.equal(raceDayRoleGroup("captain"), "leader");
  assert.equal(raceDayRoleGroup("sprint_captain"), "leader");
  assert.equal(raceDayRoleGroup("co_captain"), "leader");
  assert.equal(raceDayRoleGroup("hunter"), "hunter");
  assert.equal(raceDayRoleGroup("helper"), "helper");
  assert.equal(raceDayRoleGroup("luxury_helper"), "helper");
  assert.equal(raceDayRoleGroup("free_role"), "free");
  assert.equal(raceDayRoleGroup(null), "free");
  assert.equal(raceDayRoleGroup("unknown_role"), "free");
  for (const role of VALID_RACE_ROLES) assert.ok(["leader", "hunter", "helper", "free"].includes(raceDayRoleGroup(role)), role);
});

test("#5950: alle evnelister er rigtige evner, og hver profil har en afgoerende evne i sin profil", () => {
  for (const profile of PROFILES) {
    assert.ok(VISIBLE_ABILITIES.includes(DECISIVE_ABILITY_BY_PROFILE[profile]), profile);
    assert.ok(RACE_PROFILE_ABILITY_MAP[profile].includes(DECISIVE_ABILITY_BY_PROFILE[profile]), `${profile}: afgoerende evne i profilen`);
    for (const a of HELPER_ABILITIES_BY_PROFILE[profile]) assert.ok(VISIBLE_ABILITIES.includes(a), `${profile}: ${a}`);
    assert.ok(HELPER_ABILITIES_BY_PROFILE[profile].includes("teamwork"), `${profile}: hjaelperen udvikler holdarbejde (S21)`);
    for (const group of ["leader", "hunter", "helper"]) {
      const { lead, support } = raceDayRoleAbilityGroups(profile, group);
      assert.ok(lead.length > 0);
      assert.ok(!lead.some((a) => support.includes(a)), "lead og support er disjunkte");
    }
    assert.ok(raceDayRoleAbilityGroups(profile, "leader").support.includes("leadership"), "kaptajnen udvikler lederskab (S21)");
  }
});

test("#5950 D3 variant A: tillaegget er ens i alt for alle roller paa alle profiler", () => {
  for (const profile of PROFILES) {
    const budget = RACE_PROFILE_ABILITY_MAP[profile].length;
    for (const role of ROLES) {
      const sum = Object.values(raceDayRoleBonusWeights(profile, role, PARAMS.leadShare)).reduce((s, w) => s + w, 0);
      assert.ok(Math.abs(sum - budget) < 1e-9, `${profile}/${role}: ${sum}`);
    }
  }
});

test("#5950: flad etape - kaptajnen faar mest spurt, hjaelperen mest i hjaelpe-evner, fri rolle i midten", () => {
  const cap = raceDayRoleBonusWeights("flat", "sprint_captain", PARAMS.leadShare);
  const helper = raceDayRoleBonusWeights("flat", "helper", PARAMS.leadShare);
  const free = raceDayRoleBonusWeights("flat", "free_role", PARAMS.leadShare);
  const top = (w) => Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(top(cap), "sprint");
  assert.ok((helper.sprint ?? 0) < cap.sprint, "hjaelperen faar mindre spurt end kaptajnen");
  assert.ok(helper.teamwork > (cap.teamwork ?? 0), "hjaelperen faar holdarbejde");
  assert.ok(free.sprint < cap.sprint && free.sprint > (helper.sprint ?? 0), "fri rolle: balanceret");
  for (const k of new Set([...Object.keys(cap), ...Object.keys(helper)])) {
    assert.ok(Math.abs((free[k] ?? 0) - ((cap[k] ?? 0) + (helper[k] ?? 0)) / 2) < 1e-12, `S17 halvt/halvt: ${k}`);
  }
});

test("#5950: bjergetape - kaptajnen faar mest klatring; hjaelperen mindre klatring, mere allround", () => {
  const cap = raceDayRoleBonusWeights("mountain", "captain", PARAMS.leadShare);
  const helper = raceDayRoleBonusWeights("mountain", "helper", PARAMS.leadShare);
  assert.equal(Object.entries(cap).sort((a, b) => b[1] - a[1])[0][0], "climbing");
  assert.ok(helper.climbing > 0 && helper.climbing < cap.climbing);
  assert.ok(helper.tempo > (cap.tempo ?? 0));
});

test("#5950: basis er en haard dag paa etapens profil-evner", () => {
  for (const profile of [...PROFILES, null, "nonsense"]) {
    const p = raceDayRoleBaseProgram(profile);
    assert.equal(p.intensity, "hard");
    assert.deepEqual([...p.focusAbilities], [...raceDayProgram(profile).focusAbilities]);
  }
});

function tickArgs(program, extra = {}) {
  const abilities = Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 40]));
  return {
    riderId: "r1", dateStr: "2026-10-31", age: 24, abilities,
    caps: Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 90])),
    progress: {}, program, conditionMult: 1, potentiale: 4, hardDailyCap: Infinity, ...extra,
  };
}
const yielded = (r) => Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, (r.gains[k] ?? 0) + Number(r.progress[k] ?? 0)]));

test("#5950: tillaegget er additivt oven paa haard-dagen og lander kun i rollens evner", () => {
  for (const profile of PROFILES) {
    const hard = yielded(applyDailyTick(tickArgs(raceDayRoleBaseProgram(profile))));
    const totals = [];
    for (const role of ROLES) {
      const extra = withRaceDayRoleYield({}, { params: PARAMS, profileType: profile, role });
      const race = yielded(applyDailyTick(tickArgs(raceDayRoleBaseProgram(profile), extra)));
      const weights = raceDayRoleBonusWeights(profile, role, PARAMS.leadShare);
      let bonus = 0;
      for (const k of VISIBLE_ABILITIES) {
        const d = race[k] - hard[k];
        if (!(weights[k] > 0)) assert.ok(Math.abs(d) < 1e-12, `${profile}/${role}: ${k} uden vaegt er uroert`);
        else assert.ok(d > 0, `${profile}/${role}: ${k} faar tillaeg`);
        bonus += d;
      }
      totals.push(bonus);
    }
    // Uden anlaeg (rolle-rate 1) og ens gab er tillaegget i point ens for alle roller.
    for (const t of totals) assert.ok(Math.abs(t - totals[0]) < 1e-9, `${profile}: ${totals.join(",")}`);
  }
});

test("#5950: maks +1 pr. evne pr. loebsdag holder, ogsaa med et stort tillaeg", () => {
  const big = { stageBonus: 5, leadShare: 1 };
  for (const role of ["captain", "helper", "free_role"]) {
    const extra = withRaceDayRoleYield({}, { params: big, profileType: "flat", role });
    const r = applyDailyTick(tickArgs(raceDayRoleBaseProgram("flat"), { ...extra, hardDailyCap: 1, progress: { sprint: 0.99, teamwork: 0.99 } }));
    for (const k of VISIBLE_ABILITIES) assert.ok((r.gains[k] ?? 0) <= 1, `${role}: ${k}`);
  }
});

test("#5950: catch-up-tillaegget ganges sammen med rolle-tillaegget", () => {
  const prior = { abilityYieldMult: { climbing: 2, sprint: 1.5 }, staff: null };
  const out = withRaceDayRoleYield(prior, { params: PARAMS, profileType: "mountain", role: "captain" });
  const roleOnly = raceDayRoleYieldMultipliers({ params: PARAMS, profileType: "mountain", role: "captain" });
  assert.equal(out.staff, null);
  assert.ok(Math.abs(out.abilityYieldMult.climbing - roleOnly.climbing * 2) < 1e-12);
  assert.equal(out.abilityYieldMult.sprint, 1.5);
  assert.equal(out.program.intensity, "hard");
});

test("#5950: rolle pr. rytter - etape-raekken vinder over basisrollen, andre loeb ignoreres", () => {
  const stageByRider = new Map([
    ["a", { raceId: "R1", stageNumber: 2 }],
    ["b", { raceId: "R1", stageNumber: 2 }],
    ["c", { raceId: "R2", stageNumber: 1 }],
  ]);
  const entries = [
    { race_id: "R1", rider_id: "a", race_role: "helper" },
    { race_id: "R1", rider_id: "b", race_role: "captain" },
    { race_id: "R9", rider_id: "c", race_role: "captain" },
  ];
  const stageRoles = [
    { race_id: "R1", stage_number: 2, rider_id: "a", race_role: "hunter" },
    { race_id: "R1", stage_number: 1, rider_id: "b", race_role: "helper" },
  ];
  const map = raceDayRoleByRider(stageByRider, entries, stageRoles);
  assert.equal(map.get("a"), "hunter");
  assert.equal(map.get("b"), "captain");
  assert.equal(map.has("c"), false);
});

test("#5950: rolle-opslaget er fail-safe (fejl = tomt kort = fri rolle)", async () => {
  const stageByRider = new Map([["a", { raceId: "R1", stageNumber: 1 }]]);
  const failing = { from: () => ({ select: () => ({ in: () => ({ in: async () => ({ data: null, error: { message: "boom" } }) }) }) }) };
  const warnings = [];
  const map = await loadRaceDayRoleByRider({ supabase: failing, stageByRider, log: { warn: (m) => warnings.push(m) } });
  assert.equal(map.size, 0);
  assert.ok(warnings.some((w) => w.includes("[race-day-role-yield]")));
  assert.equal((await loadRaceDayRoleByRider({ supabase: failing, stageByRider: new Map() })).size, 0);
});

test("#5950: flag-laesning - beta er off, strict kaster ved databasefejl", async () => {
  const state = { app_config: [{ key: RACE_DAY_ROLE_YIELD_FLAG_KEY, value: "beta" }] };
  assert.equal(await isRaceDayRoleYieldEnabled(createMockSupabase(state)), false);
  state.app_config[0].value = "on";
  assert.equal(await isRaceDayRoleYieldEnabled(createMockSupabase(state)), true);
  assert.equal(await isRaceDayRoleYieldEnabled(createMockSupabase(state), { strict: true }), true);
  const broken = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "down" } }) }) }) }) };
  await assert.rejects(() => isRaceDayRoleYieldEnabled(broken, { strict: true }));
});

test("#5950: ugyldig raekke i private_config bruger ALDRIG reserven", async () => {
  clearPrivateConfigCache();
  const state = {
    app_config: [{ key: RACE_DAY_ROLE_YIELD_FLAG_KEY, value: "on" }],
    private_config: [{ key: RACE_DAY_ROLE_YIELD_PARAMS_KEY, value: { stageBonus: -3 } }],
  };
  const warnings = [];
  const params = await loadRaceDayRoleYield({
    supabase: createMockSupabase(state), env: PARAMS_ENV, log: { warn: (m) => warnings.push(m) },
  });
  assert.equal(params, null);
  assert.ok(warnings.length > 0);
});
