// #4846 fase B2 — loebsdags-ticket: G1-deleren, seed-noeglen og loebsdags-opslaget.
import test from "node:test";
import assert from "node:assert/strict";

import {
  TRAINING_RACE_DAY_CONFIG, raceDayBudgetDivisor, raceDaySeedKey, resolveTeamRaceDay,
} from "./trainingRaceDayTick.js";
import { dailyAbilityDelta, DAILY_TRAINING_CONFIG, growthFractionForAge } from "./dailyTraining.js";
import { PROGRESSION_CONFIG } from "./riderProgression.js";
import { isTrainingTickPerRaceDayEnabled, TRAINING_TICK_PER_RACE_DAY_FLAG_KEY } from "./trainingTickRaceDayFlag.js";

// ── Mini-mock: kun det resolveTeamRaceDay/flaget faktisk kalder ───────────────
function mockSupabase(tables, opts = {}) {
  return {
    from(table) {
      const rows = tables[table] ?? [];
      const state = { filters: [], inList: null, order: null, limit: null };
      const api = {
        select() { return api; },
        eq(col, val) { state.filters.push([col, val, "eq"]); return api; },
        lte(col, val) { state.filters.push([col, val, "lte"]); return api; },
        in(col, vals) { state.inList = [col, vals]; return api; },
        order(col, o = {}) { state.order = { col, ascending: o.ascending !== false }; return api; },
        limit(n) { state.limit = n; return api; },
        run() {
          if (opts.errorOn === table) return { data: null, error: { message: "boom" } };
          let out = rows.filter((r) => state.filters.every(([c, v, op]) => (op === "lte" ? r[c] <= v : r[c] === v)));
          if (state.inList) out = out.filter((r) => state.inList[1].includes(r[state.inList[0]]));
          if (state.order) {
            out = [...out].sort((a, b) => (state.order.ascending
              ? Number(a[state.order.col]) - Number(b[state.order.col])
              : Number(b[state.order.col]) - Number(a[state.order.col])));
          }
          if (Number.isFinite(state.limit)) out = out.slice(0, state.limit);
          return { data: out, error: null };
        },
        async maybeSingle() { const r = api.run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        then(resolve) { return Promise.resolve(api.run()).then(resolve); },
      };
      return api;
    },
  };
}

const SEASON_ID = "season-x";
const DIVISION_ID = "div-2";
const NOW = new Date("2026-09-14T08:00:00Z");

function calendarTables({ divisionId = DIVISION_ID } = {}) {
  return {
    teams: [{ id: "t1", league_division_id: divisionId }],
    races: [
      { id: "r1", season_id: SEASON_ID, league_division_id: DIVISION_ID },
      { id: "r2", season_id: SEASON_ID, league_division_id: DIVISION_ID },
      { id: "other", season_id: SEASON_ID, league_division_id: "div-9" },
    ],
    race_stage_schedule: [
      { race_id: "r1", game_day: 3, scheduled_at: "2026-09-14T05:00:00Z" },
      { race_id: "r2", game_day: 4, scheduled_at: "2026-09-14T07:00:00Z" },
      { race_id: "r2", game_day: 5, scheduled_at: "2026-09-14T17:00:00Z" }, // endnu ikke startet
      { race_id: "other", game_day: 40, scheduled_at: "2026-09-14T05:00:00Z" }, // anden division
    ],
  };
}

// ── G1: sæsonens samlede udvikling ───────────────────────────────────────────
test("G1: deleren holder T/D konstant — 80 × 28 / 31", () => {
  assert.equal(TRAINING_RACE_DAY_CONFIG.raceDaysPerSeason, 80);
  assert.equal(TRAINING_RACE_DAY_CONFIG.legacyDaysPerSeason, DAILY_TRAINING_CONFIG.daysPerSeason,
    "referencen i formlen skal foelge den faktiske deler i DAILY_TRAINING_CONFIG");
  const D = raceDayBudgetDivisor();
  assert.ok(Math.abs(D - (80 * 28) / 31) < 1e-9, `D = ${D}`);
  const before = TRAINING_RACE_DAY_CONFIG.calendarTicksPerSeasonToday / DAILY_TRAINING_CONFIG.daysPerSeason;
  const after = TRAINING_RACE_DAY_CONFIG.raceDaysPerSeason / D;
  assert.ok(Math.abs(before - after) < 1e-9, "T/D er uaendret");
});

test("G1: sæsonens samlede evne-udvikling er uændret i ALLE fire alders-bånd (< 1 %)", () => {
  // Compounding koeres gennem den AEGTE dailyAbilityDelta, ikke gennem
  // approksimationen — en gate der ikke spejler produktionsstien er ingen gate.
  const program = { focus: "endurance", intensity: "normal" };
  const seasonFraction = (age, ticks, divisor) => {
    const cap = 90;
    let current = 40;
    for (let i = 0; i < ticks; i += 1) {
      current += dailyAbilityDelta({
        ability: "endurance", current, cap, age, program,
        conditionMult: 1, bonus: false, noise: 1, potentiale: 4, budgetDivisor: divisor,
      });
    }
    return (current - 40) / (cap - 40);
  };

  const ages = PROGRESSION_CONFIG.growthFractionByAge.map((row) => Math.min(row.maxAge, 34));
  const D = raceDayBudgetDivisor();
  for (const age of ages) {
    const today = seasonFraction(age, TRAINING_RACE_DAY_CONFIG.calendarTicksPerSeasonToday, null);
    const after = seasonFraction(age, TRAINING_RACE_DAY_CONFIG.raceDaysPerSeason, D);
    const drift = Math.abs(after / today - 1);
    assert.ok(drift < 0.01,
      `alder ${age} (f=${growthFractionForAge(age)}): drift ${(drift * 100).toFixed(2)} % skal vaere under 1 %`);
  }
});

test("G1: UDEN rekalibrering ville 80 ticks overtræne markant (negativ-test)", () => {
  const program = { focus: "endurance", intensity: "normal" };
  const run = (ticks, divisor) => {
    let current = 40;
    for (let i = 0; i < ticks; i += 1) {
      current += dailyAbilityDelta({
        ability: "endurance", current, cap: 90, age: 20, program,
        conditionMult: 1, bonus: false, noise: 1, potentiale: 4, budgetDivisor: divisor,
      });
    }
    return current - 40;
  };
  const today = run(31, null);
  const naive = run(80, null); // samme deler, 80 ticks — den fejl gaten fanger
  assert.ok(naive / today > 1.8, `uden rekalibrering ${(naive / today).toFixed(2)}x — gaten skal kunne se det`);
});

// ── Seed-nøglen (A3) ─────────────────────────────────────────────────────────
test("seed-nøglen bærer sæson OG løbsdag", () => {
  assert.equal(raceDaySeedKey({ seasonId: "s1", gameDay: 7 }), "s1#gd7");
  assert.notEqual(
    raceDaySeedKey({ seasonId: "s1", gameDay: 7 }),
    raceDaySeedKey({ seasonId: "s1", gameDay: 8 }),
  );
  assert.notEqual(
    raceDaySeedKey({ seasonId: "s1", gameDay: 7 }),
    raceDaySeedKey({ seasonId: "s2", gameDay: 7 }),
    "game_day nulstilles hver saeson — noeglen skal baere sæsonen",
  );
});

// ── resolveTeamRaceDay ───────────────────────────────────────────────────────
test("resolveTeamRaceDay: seneste STARTEDE løbsdag i holdets egen division", async () => {
  const res = await resolveTeamRaceDay({
    supabase: mockSupabase(calendarTables()), teamId: "t1", seasonId: SEASON_ID, now: NOW,
  });
  assert.equal(res.reason, "ok");
  assert.equal(res.gameDay, 4, "løbsdag 5 er ikke startet endnu, og 40 hører til en anden division");
});

test("resolveTeamRaceDay: hold uden division får et DEFINERET svar (ikke en stille stopper)", async () => {
  const res = await resolveTeamRaceDay({
    supabase: mockSupabase(calendarTables({ divisionId: null })), teamId: "t1", seasonId: SEASON_ID, now: NOW,
  });
  assert.equal(res.gameDay, null);
  assert.equal(res.reason, "no_division");
});

test("resolveTeamRaceDay: ingen startet etape endnu → null", async () => {
  const tables = calendarTables();
  tables.race_stage_schedule = tables.race_stage_schedule.map((s) => ({ ...s, scheduled_at: "2026-09-20T05:00:00Z" }));
  const res = await resolveTeamRaceDay({
    supabase: mockSupabase(tables), teamId: "t1", seasonId: SEASON_ID, now: NOW,
  });
  assert.equal(res.gameDay, null);
  assert.equal(res.reason, "no_started_stage");
});

test("resolveTeamRaceDay: fail-safe — en query-fejl kaster ALDRIG", async () => {
  for (const [table, reason] of [["teams", "team_error"], ["races", "races_error"], ["race_stage_schedule", "stages_error"]]) {
    const res = await resolveTeamRaceDay({
      supabase: mockSupabase(calendarTables(), { errorOn: table }),
      teamId: "t1", seasonId: SEASON_ID, now: NOW,
    });
    assert.equal(res.gameDay, null);
    assert.equal(res.reason, reason);
  }
  assert.deepEqual(
    await resolveTeamRaceDay({ supabase: null, teamId: "t1", seasonId: SEASON_ID }),
    { gameDay: null, reason: "bad_args" },
  );
});

// ── Flaget ───────────────────────────────────────────────────────────────────
test("flaget er fail-safe: manglende række, off og ukendt værdi giver alle false", async () => {
  const cases = [[], [{ key: TRAINING_TICK_PER_RACE_DAY_FLAG_KEY, value: "off" }], [{ key: TRAINING_TICK_PER_RACE_DAY_FLAG_KEY, value: "vrøvl" }]];
  for (const app_config of cases) {
    assert.equal(await isTrainingTickPerRaceDayEnabled(mockSupabase({ app_config })), false);
  }
});

test("flaget: on gælder alle, beta kun motor-skrivninger", async () => {
  const on = mockSupabase({ app_config: [{ key: TRAINING_TICK_PER_RACE_DAY_FLAG_KEY, value: "on" }] });
  assert.equal(await isTrainingTickPerRaceDayEnabled(on), true);

  const beta = mockSupabase({ app_config: [{ key: TRAINING_TICK_PER_RACE_DAY_FLAG_KEY, value: "beta" }] });
  assert.equal(await isTrainingTickPerRaceDayEnabled(beta), false, "ingen viewer, ingen motor-flag → lukket");
  assert.equal(await isTrainingTickPerRaceDayEnabled(beta, { engineWrite: true }), true);
});
