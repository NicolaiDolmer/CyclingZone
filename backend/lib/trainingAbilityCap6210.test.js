// #6210: maks +1 pr. evne pr. rytter pr. DATO, uanset hvor mange stier der rammer
// datoen. Regressionstesten koerer to stier samme dato gennem den rigtige motor:
// "Train now" (trainNow.js kalder runTeamTrainingDay med executedBy "manager") paa
// datoens foerste loebsdag, og aftenens sweep (executedBy "assistant") paa den naeste.
import test from "node:test";
import assert from "node:assert/strict";

import {
  runTeamTrainingDay, capTickGainsPerDate, sumDateGains, ABILITY_GAIN_CAP_PER_DATE,
} from "./dailyTrainingEngine.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { TRAINING_TICK_PER_RACE_DAY_FLAG_KEY } from "./trainingTickRaceDayFlag.js";

// ── Pure helper ──────────────────────────────────────────────────────────────

test("capTickGainsPerDate: point ud over datoens rest laegges tilbage paa baren", () => {
  const tickResult = {
    abilities: { climbing: 52, sprint: 41 },
    progress: { climbing: 0.3, sprint: 0.2 },
    gains: { climbing: 2, sprint: 1 },
    score: 1,
  };
  const out = capTickGainsPerDate({
    tickResult, abilities: { climbing: 50, sprint: 40 }, usedGains: { sprint: 1 },
  });
  assert.equal(out.abilities.climbing, 50 + ABILITY_GAIN_CAP_PER_DATE);
  assert.equal(out.gains.climbing, 1);
  assert.equal(out.progress.climbing, 1.3, "det klippede point baeres videre (carry-over)");
  assert.equal(out.abilities.sprint, 40, "sprint har allerede faaet sit point i dag");
  assert.equal("sprint" in out.gains, false);
  assert.equal(out.progress.sprint, 1.2);
  assert.deepEqual(out.capped_by_date, { climbing: 1, sprint: 1 });
  assert.deepEqual(tickResult.gains, { climbing: 2, sprint: 1 }, "input muteres ikke");
});

test("capTickGainsPerDate: inden for loftet er resultatet uaendret", () => {
  const tickResult = { abilities: { climbing: 51 }, progress: { climbing: 0.1 }, gains: { climbing: 1 } };
  assert.equal(capTickGainsPerDate({ tickResult, abilities: { climbing: 50 }, usedGains: {} }), tickResult);
});

test("sumDateGains: summerer kun positive hele point fra datoens rapporter", () => {
  assert.deepEqual(
    sumDateGains([{ gains: { climbing: 1 } }, { gains: { climbing: 1, sprint: 0 } }, null, {}]),
    { climbing: 2 },
  );
});

// ── Motoren: to stier samme dato ─────────────────────────────────────────────

const TEAM_ID = "team-6210";
const SEASON_ID = "season-6210";
const NOW = new Date("2026-06-12T10:00:00+02:00");
const NEARLY = () => Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 0.9999]));

// Lille in-memory Supabase: kun de operationer motoren bruger paa loebsdags-stien.
function createMockSupabase(state) {
  function builder(table, op = "select", filters = [], patch = null) {
    const matches = (row) => filters.every(([col, val, kind]) => {
      if (kind === "meta") return true;
      if (kind === "in") return val.includes(row[col]);
      if (kind === "gte") return row[col] >= val;
      if (kind === "lt") return row[col] < val;
      if (kind === "lte") return row[col] <= val;
      return row[col] === val;
    });
    const next = (f) => builder(table, op, [...filters, f], patch);
    const obj = {
      select: () => builder(table, "select", filters, patch),
      eq: (c, v) => next([c, v, "eq"]),
      is: (c, v) => next([c, v, "eq"]),
      in: (c, v) => next([c, v, "in"]),
      gte: (c, v) => next([c, v, "gte"]),
      lt: (c, v) => next([c, v, "lt"]),
      lte: (c, v) => next([c, v, "lte"]),
      order: (col, o = {}) => next(["__order", { col, asc: o.ascending !== false }, "meta"]),
      limit: (n) => next(["__limit", n, "meta"]),
      update: (p) => builder(table, "update", filters, p),
      delete: () => builder(table, "delete", filters, patch),
      async maybeSingle() {
        const { data, error } = await obj;
        return { data: data?.[0] ?? null, error };
      },
      insert(row) {
        state[table] ??= [];
        const r = Array.isArray(row) ? row[0] : row;
        const clash = state[table].some((x) => (r.game_day != null
          ? x.team_id === r.team_id && x.season_id === r.season_id && x.game_day === r.game_day
          : x.game_day == null && x.team_id === r.team_id && x.tick_date === r.tick_date));
        if (clash) return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
        state[table].push({ ...r });
        return Promise.resolve({ error: null });
      },
      upsert(rows, o = {}) {
        state[table] ??= [];
        const keys = (o.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        for (const r of Array.isArray(rows) ? rows : [rows]) {
          const i = keys.length ? state[table].findIndex((x) => keys.every((k) => x[k] === r[k])) : -1;
          if (i < 0) state[table].push({ ...r });
          else if (!o.ignoreDuplicates) Object.assign(state[table][i], r);
        }
        return Promise.resolve({ error: null });
      },
      then(resolve, reject) {
        state[table] ??= [];
        let result;
        if (op === "update") {
          for (const row of state[table]) if (matches(row)) Object.assign(row, patch);
          result = { error: null };
        } else if (op === "delete") {
          state[table] = state[table].filter((row) => !matches(row));
          result = { error: null };
        } else {
          let rows = state[table].filter(matches);
          const ord = filters.find((f) => f[0] === "__order")?.[1];
          const lim = filters.find((f) => f[0] === "__limit")?.[1];
          if (ord) rows = [...rows].sort((a, b) => (ord.asc ? 1 : -1) * (Number(a[ord.col]) - Number(b[ord.col])));
          if (Number.isFinite(lim)) rows = rows.slice(0, lim);
          result = { data: rows, error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return obj;
  }

  return {
    from: (table) => builder(table),
    async rpc(name, args) {
      if (name === "register_training_date_work") {
        state.training_date_work ??= [];
        let work = state.training_date_work.find((w) => w.team_id === args.p_team_id
          && w.season_id === args.p_season_id && w.tick_date === args.p_tick_date);
        if (!work) {
          work = {
            team_id: args.p_team_id, season_id: args.p_season_id, tick_date: args.p_tick_date,
            game_days: args.p_game_days, expected_rider_ids: args.p_expected_rider_ids, status: "pending",
            quarantined_rider_ids: [],
            opening_conditions: Object.fromEntries(state.rider_condition
              .filter((c) => args.p_expected_rider_ids.includes(c.rider_id)).map((c) => [c.rider_id, structuredClone(c)])),
          };
          state.training_date_work.push(work);
        }
        return { data: work, error: null };
      }
      assert.equal(name, "commit_training_date_tick");
      for (const item of args.p_abilities) {
        Object.assign(state.rider_derived_abilities.find((row) => row.rider_id === item.riderId), item.patch);
      }
      for (const item of args.p_conditions) {
        Object.assign(state.rider_condition.find((row) => row.rider_id === item.rider_id), item);
      }
      state.training_rider_ticks ??= [];
      for (const report of args.p_report.riders) {
        state.training_rider_ticks.push({
          rider_id: report.rider_id, season_id: args.p_season_id, game_day: args.p_game_day,
          tick_date: args.p_tick_date, team_id: args.p_team_id, report,
        });
      }
      state.training_day_runs.push({
        team_id: args.p_team_id, season_id: args.p_season_id, squad: args.p_squad,
        game_day: args.p_game_day, tick_date: args.p_tick_date, report: args.p_report,
      });
      return { data: { already_ran: false, report: args.p_report }, error: null };
    },
  };
}

function seedState({ perDate }) {
  const abilities = Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 50]));
  return {
    app_config: [
      { key: TRAINING_TICK_PER_RACE_DAY_FLAG_KEY, value: "on" },
      ...(perDate ? [{ key: "training_condition_per_date", value: "on" }] : []),
    ],
    teams: [{ id: TEAM_ID, league_division_id: "div-6210" }],
    riders: [{
      id: "r1", team_id: TEAM_ID, primary_type: "climber", potentiale: 4, birthdate: "2003-01-01",
      firstname: "Test", lastname: "Rytter", is_retired: false,
    }],
    rider_derived_abilities: [{ rider_id: "r1", ...abilities, ability_caps: null, ability_progress: NEARLY() }],
    rider_condition: [{ rider_id: "r1", form: 50, fatigue: 10, injured_until: null, injury_cause: null }],
    training_plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "climbing", intensity: "hard" }],
    training_day_runs: [],
  };
}

function run(state, extra) {
  return runTeamTrainingDay({
    supabase: createMockSupabase(state), teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: 1,
    now: NOW, eligibleRiderIds: ["r1"], ...extra,
  });
}

const visible = (row) => Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, row[k]]));

for (const perDate of [true, false]) {
  const label = perDate ? "dato-kvitteringer (live-stien)" : "loebsdags-stien uden dato-kvitteringer";
  const dateDays = perDate ? { dateGameDays: [1, 2, 3, 4, 5] } : {};

  test(`#6210 ${label}: Train now + aftenens sweep samme dato giver hoejst +1 pr. evne`, async () => {
    const state = seedState({ perDate });
    const start = visible(state.rider_derived_abilities[0]);

    // Sti 1: Train now (manager) paa datoens foerste loebsdag.
    const first = await run(state, { executedBy: "manager", gameDay: 1, ...dateDays });
    const firstGains = first.report.riders[0].gains;
    assert.ok(Object.keys(firstGains).length > 0, "forudsaetning: foerste sti giver point");

    // Fremdriften kunstigt fuld igen, saa sti 2 ALENE ville give endnu et point overalt.
    state.rider_derived_abilities[0].ability_progress = NEARLY();
    // Sti 2: aftenens sweep (assistant) paa datoens naeste loebsdag.
    const second = await run(state, { executedBy: "assistant", gameDay: 2, ...dateDays });
    const rr = second.report.riders.find((r) => r.rider_id === "r1");

    const end = visible(state.rider_derived_abilities[0]);
    for (const k of VISIBLE_ABILITIES) {
      assert.ok(end[k] - start[k] <= ABILITY_GAIN_CAP_PER_DATE, `${k}: +${end[k] - start[k]} paa én dato`);
    }
    for (const k of Object.keys(firstGains)) {
      assert.equal(k in rr.gains, false, `${k} fik allerede sit point i dag`);
      assert.ok(rr.gains_deferred_by_date_cap[k] >= 1, `${k}: det klippede point er udskudt, ikke tabt`);
      assert.ok(state.rider_derived_abilities[0].ability_progress[k] >= 1, `${k}: baren baerer pointet videre`);
    }
  });

  test(`#6210 ${label}: naeste dato giver igen et point`, async () => {
    const state = seedState({ perDate });
    await run(state, { executedBy: "manager", gameDay: 1, ...dateDays });
    const afterFirstDate = visible(state.rider_derived_abilities[0]);
    state.rider_derived_abilities[0].ability_progress = NEARLY();
    const next = await run(state, {
      executedBy: "assistant", gameDay: 6, tickDateOverride: "2026-06-13",
      ...(perDate ? { dateGameDays: [6, 7, 8, 9, 10] } : {}),
    });
    assert.ok(Object.values(next.report.riders[0].gains).some((n) => n === 1), "loftet er pr. dato, ikke for altid");
    const end = visible(state.rider_derived_abilities[0]);
    assert.ok(VISIBLE_ABILITIES.some((k) => end[k] === afterFirstDate[k] + 1));
  });

  test(`#6210 ${label}: et kalenderdags-tick samme dato taeller ogsaa med (sti-skifte midt paa datoen)`, async () => {
    const state = seedState({ perDate });
    // Fail-safe-faldet (fx hold uden division) skrev et kalenderdags-tick tidligere paa datoen.
    const popped = Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 1]));
    state.training_day_runs.push({
      team_id: TEAM_ID, tick_date: "2026-06-12", game_day: null,
      report: { riders: [{ rider_id: "r1", gains: popped }] },
    });
    const start = visible(state.rider_derived_abilities[0]);
    const result = await run(state, { executedBy: "assistant", gameDay: 1, ...dateDays });
    assert.deepEqual(result.report.riders[0].gains, {}, "datoen har allerede givet sit point i hver evne");
    assert.deepEqual(visible(state.rider_derived_abilities[0]), start);
  });
}
