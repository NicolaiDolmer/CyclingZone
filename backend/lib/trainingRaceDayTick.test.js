// #4846 fase B2 — loebsdags-ticket: G1-deleren, seed-noeglen og loebsdags-opslaget.
import test from "node:test";
import assert from "node:assert/strict";

import {
  TRAINING_RACE_DAY_CONFIG, raceDayBudgetDivisor, raceDaySeedKey, resolveTeamRaceDay,
  resolveRaceDaysPerSeason, resolveRaceDayBudgetDivisor, loadBoundRiderIdsForRaceDay,
} from "./trainingRaceDayTick.js";
import { dailyAbilityDelta, DAILY_TRAINING_CONFIG, growthFractionForAge } from "./dailyTraining.js";
import { PROGRESSION_CONFIG } from "./riderProgression.js";
import { isTrainingTickPerRaceDayEnabled, TRAINING_TICK_PER_RACE_DAY_FLAG_KEY } from "./trainingTickRaceDayFlag.js";
import { SEASON_RACE_DAY_TARGET } from "./calendarRaceDayTargets.js";

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
test("G1: deleren holder forholdet mellem antal ticks og deler konstant", () => {
  // #4847 (ejer 15/9, TRAINING_RULES.md §13.3 beslutning 2): 140 loebsdage pr. saeson,
  // ikke 80. Tallet er ejer-besluttet og samtidig kalenderpakkerens maal.
  assert.equal(TRAINING_RACE_DAY_CONFIG.raceDaysPerSeason, 140);
  assert.equal(TRAINING_RACE_DAY_CONFIG.legacyDaysPerSeason, DAILY_TRAINING_CONFIG.daysPerSeason,
    "referencen i formlen skal foelge den faktiske deler i DAILY_TRAINING_CONFIG");
  const D = raceDayBudgetDivisor();
  assert.ok(Math.abs(D - (140 * 28) / 31) < 1e-9, `D = ${D}`);
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

test("G1: UDEN rekalibrering ville flere ticks overtræne markant (negativ-test)", () => {
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
  // Samme deler, men det NYE antal ticks (140) — praecis den fejl gaten fanger.
  const naive = run(TRAINING_RACE_DAY_CONFIG.raceDaysPerSeason, null);
  assert.ok(naive / today > 1.8, `uden rekalibrering ${(naive / today).toFixed(2)}x — gaten skal kunne se det`);
});

// ── #4847 punkt 5: deleren LAESER maalet, duplikerer det ikke ─────────────────
test("#4847: maalet laeses fra calendarRaceDayTargets.js (statisk import, #4846)", () => {
  assert.equal(
    resolveRaceDaysPerSeason({ seasonNumber: 4 }),
    SEASON_RACE_DAY_TARGET[4],
    "traeningsdeleren og kalenderpakkeren skal dele ÉN sandhed — ikke to kopier af 140",
  );
  // Ejerens laaste tal (TRAINING_RULES.md §13.3 beslutning 2).
  assert.equal(resolveRaceDaysPerSeason({ seasonNumber: 4 }), 140);
});

test("#4846: opslaget er SYNKRONT — ingen dynamisk import at vente paa", () => {
  const out = resolveRaceDaysPerSeason({ seasonNumber: 4 });
  assert.equal(typeof out, "number", "et Promise her ville betyde at den dynamiske import er tilbage");
  assert.equal(typeof resolveRaceDayBudgetDivisor({ seasonNumber: 4 }), "number");
});

test("#4847: en ukendt saeson arver det hoejeste kendte maal, aldrig 0", () => {
  const n = resolveRaceDaysPerSeason({ seasonNumber: 99 });
  assert.ok(Number.isFinite(n) && n > 0, `maalet skal altid vaere et positivt tal, fik ${n}`);
  assert.ok(n >= 80, "et maal under D1's naturlige antal loebsdage ville vaere uopnaaeligt");
  assert.equal(resolveRaceDaysPerSeason({ seasonNumber: null }), n, "ukendt saesonnummer = samme arv");
});

test("#4846: en tabel uden et eneste positivt maal falder tilbage paa konfigurationens tal", () => {
  const cfg = { ...TRAINING_RACE_DAY_CONFIG, raceDaysPerSeason: 77 };
  assert.equal(resolveRaceDaysPerSeason({ seasonNumber: 4, cfg, table: {} }), 77);
  assert.equal(resolveRaceDaysPerSeason({ seasonNumber: 4, cfg, table: { 4: 0, 5: -3 } }), 77);
  assert.equal(resolveRaceDaysPerSeason({ seasonNumber: 5, cfg, table: { 4: 120, 6: 150 } }), 150,
    "en saeson uden eget tal arver det HOEJESTE kendte maal");
});

test("#4847: deleren matcher den synkrone formel", () => {
  const D = resolveRaceDayBudgetDivisor({ seasonNumber: 4 });
  const raceDays = resolveRaceDaysPerSeason({ seasonNumber: 4 });
  assert.ok(Math.abs(D - (raceDays * 28) / 31) < 1e-9, `D = ${D}`);
  assert.ok(Math.abs(D - raceDayBudgetDivisor()) < 1e-9, "S4's deler = konfigurationens deler (140)");
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

// ── #4847: loebsdags-bindingen (ejer-regel 2 + 3, 18/9) ──────────────────────
// Kilden er race_entry_days, som siden #4217 baerer HELE spaendet pr. udtagelse —
// GT-hviledagene inklusive. Det er praecis mængden "bundet, maa ikke traene".

const BIND_SEASON = "season-b";

function bindingTables(rows) {
  return { race_entry_days: rows };
}

test("#4847: bindingen laeser race_entry_days paa (saeson, loebsdag) — GT-hviledagen er MED", async () => {
  // Et 3-etapers loeb med en hviledag paa loebsdag 21: rebuild-funktionen skriver
  // hele spaendet 20..23, saa rytteren er bundet ogsaa paa den dag han ikke koerer.
  const supabase = mockSupabase(bindingTables([
    { rider_id: "a", season_id: BIND_SEASON, game_day: 20, race_id: "gt", team_id: "t1" },
    { rider_id: "a", season_id: BIND_SEASON, game_day: 21, race_id: "gt", team_id: "t1" },
    { rider_id: "a", season_id: BIND_SEASON, game_day: 22, race_id: "gt", team_id: "t1" },
    { rider_id: "b", season_id: BIND_SEASON, game_day: 20, race_id: "gt", team_id: "t1" },
  ]));

  const restDay = await loadBoundRiderIdsForRaceDay({
    supabase, riderIds: ["a", "b"], seasonId: BIND_SEASON, gameDay: 21,
  });
  assert.equal(restDay.error, null);
  assert.deepEqual([...restDay.data], ["a"], "a er bundet paa hviledagen, b er fri");
});

test("#4847: en anden SAESONS binding paa samme loebsdag taeller ikke (game_day nulstilles hver saeson)", async () => {
  const supabase = mockSupabase(bindingTables([
    { rider_id: "a", season_id: "en-anden-saeson", game_day: 21, race_id: "gt", team_id: "t1" },
  ]));
  const out = await loadBoundRiderIdsForRaceDay({
    supabase, riderIds: ["a"], seasonId: BIND_SEASON, gameDay: 21,
  });
  assert.deepEqual([...out.data], [], "samme fejlklasse som #3070 — saesonen SKAL med i noeglen");
});

test("#4847: en query-fejl RETURNERES (kald-stedet kaster) — bindingen gaettes aldrig", async () => {
  const supabase = mockSupabase(bindingTables([]), { errorOn: "race_entry_days" });
  const out = await loadBoundRiderIdsForRaceDay({
    supabase, riderIds: ["a"], seasonId: BIND_SEASON, gameDay: 21,
  });
  assert.equal(out.data, null, "null = 'ved det ikke', ikke 'ingen er bundet'");
  assert.ok(out.error, "fejlen skjules ikke bag en tom maengde");
});

test("#4847: daarlige argumenter giver en fejl, ikke en tavs tom maengde", async () => {
  const supabase = mockSupabase(bindingTables([]));
  for (const args of [
    { supabase, riderIds: ["a"], seasonId: null, gameDay: 3 },
    { supabase, riderIds: ["a"], seasonId: BIND_SEASON, gameDay: null },
    { supabase: {}, riderIds: ["a"], seasonId: BIND_SEASON, gameDay: 3 },
  ]) {
    const out = await loadBoundRiderIdsForRaceDay(args);
    assert.equal(out.data, null);
    assert.ok(out.error);
  }
});

test("#4847: en tom trup koster ingen DB-tur", async () => {
  let calls = 0;
  const supabase = { from() { calls += 1; return {}; } };
  const out = await loadBoundRiderIdsForRaceDay({
    supabase, riderIds: [], seasonId: BIND_SEASON, gameDay: 3,
  });
  assert.equal(calls, 0);
  assert.deepEqual([...out.data], []);
});
