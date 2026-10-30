// #5319: v3-standardfokus i motoren (fund i den samlede måling 29/10). En
// enkeltstartsrytter UDEN gemt plan får smartDefaultFocus = Tærskel; under v3
// træner Tærskel ikke enkeltstart, så motoren skal give itt_long. Syntetiske tal.
import test from "node:test";
import assert from "node:assert/strict";

import { runTeamTrainingDay } from "./dailyTrainingEngine.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

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

const TEAM_ID = "team-a";
const SEASON_ID = "season-1";
const NOW = new Date("2026-06-12T10:00:00+02:00");

function seed({ v3, plan = null, primary = "tt", secondary = null }) {
  return {
    riders: [{
      id: "r1", team_id: TEAM_ID, primary_type: primary, secondary_type: secondary, potentiale: 4, birthdate: "2003-01-01",
      firstname: "Test", lastname: "Rytter", is_retired: false,
    }],
    rider_derived_abilities: [{
      rider_id: "r1", ...Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 50])),
      ability_caps: null, ability_progress: {},
    }],
    rider_condition: [{ rider_id: "r1", form: 50, fatigue: 10, injured_until: null, injury_cause: null }],
    training_plans: plan ? [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, ...plan }] : [],
    training_day_runs: [],
    teams: [{ id: TEAM_ID, user_id: "user-a", is_ai: false, is_bank: false, is_test_account: false }],
    app_config: v3 == null ? [] : [{ key: "training_catalog_v3", value: v3 }],
  };
}

async function progressAfter(state) {
  await runTeamTrainingDay({
    supabase: createMockSupabase(state), teamId: TEAM_ID, seasonId: SEASON_ID,
    seasonNumber: 1, executedBy: "assistant", now: NOW,
  });
  return state.rider_derived_abilities[0].ability_progress ?? {};
}

test("v3 on: tt uden plan træner enkeltstart (itt_long) som fokus, en gemt Tærskel-plan gør ikke", async () => {
  const noPlan = await progressAfter(seed({ v3: "on" }));
  const savedThreshold = await progressAfter(seed({ v3: "on", plan: { focus: "threshold", intensity: "normal" } }));
  // Uden plan: itt_long = enkeltstart i fokus. Gemt Tærskel (spillerens valg; kun migrationen flytter den):
  // v3-Tærskel = tempo + udholdenhed, enkeltstart kun som uden-for-fokus.
  assert.ok(Number(noPlan.time_trial ?? 0) > Number(savedThreshold.time_trial ?? 0),
    `enkeltstart: uden plan ${noPlan.time_trial} skal være over gemt Tærskel ${savedThreshold.time_trial}`);
  // v3-Tærskel har tempo i fokus; itt_long har ikke.
  assert.ok(Number(savedThreshold.tempo ?? 0) > Number(noPlan.tempo ?? 0));
});

test("v3 off: tt uden plan er bit-identisk med i dag (Tærskel = enkeltstart + tempo)", async () => {
  const off = await progressAfter(seed({ v3: "off" }));
  const missing = await progressAfter(seed({ v3: null }));
  assert.deepEqual(off, missing);
  assert.ok(Number(off.time_trial ?? 0) > 0);
});

test("v3 on: andre typer uden plan er urørte", async () => {
  const on = await progressAfter(seed({ v3: "on", primary: "climber" }));
  const off = await progressAfter(seed({ v3: "off", primary: "climber" }));
  assert.deepEqual(on, off);
});
