// #4846 fase B2 — loebsdags-ticket: G1-deleren, seed-noeglen og loebsdags-opslaget.
import test from "node:test";
import assert from "node:assert/strict";

import {
  TRAINING_RACE_DAY_CONFIG, raceDayBudgetDivisor, raceDaySeedKey, resolveTeamRaceDay,
  resolveRaceDayBudgetDivisor, loadBoundRiderIdsForRaceDay,
  resolveCalendarRaceDayTarget, loadRaceExitGameDays, dropBindingsAfterRaceExit,
} from "./trainingRaceDayTick.js";
import { applyDailyTick, dailyAbilityDelta, DAILY_TRAINING_CONFIG, growthFractionForAge } from "./dailyTraining.js";
import { PROGRESSION_CONFIG } from "./riderProgression.js";
import { isTrainingTickPerRaceDayEnabled, TRAINING_TICK_PER_RACE_DAY_FLAG_KEY } from "./trainingTickRaceDayFlag.js";
import { SEASON_RACE_DAY_TARGET } from "./calendarRaceDayTargets.js";

// ── Mini-mock: kun det resolveTeamRaceDay/flaget faktisk kalder ───────────────
function mockSupabase(tables, opts = {}) {
  return {
    from(table) {
      const rows = tables[table] ?? [];
      const state = { filters: [], inLists: [], order: null, limit: null };
      const api = {
        select() { return api; },
        eq(col, val) { state.filters.push([col, val, "eq"]); return api; },
        lte(col, val) { state.filters.push([col, val, "lte"]); return api; },
        in(col, vals) { state.inLists.push([col, vals]); return api; },
        order(col, o = {}) { state.order = { col, ascending: o.ascending !== false }; return api; },
        limit(n) { state.limit = n; return api; },
        run() {
          if (opts.errorOn === table) return { data: null, error: { message: "boom" } };
          let out = rows.filter((r) => state.filters.every(([c, v, op]) => (op === "lte" ? r[c] <= v : r[c] === v)));
          for (const [col, vals] of state.inLists) out = out.filter((r) => vals.includes(r[col]));
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

// ── #6711: deleren er forankret i loebsdage pr. DATO, ikke i saesonens laengde ──
//
// Saesonerne i #5833-planen: S4 = 28 datoer, S5 = 32 datoer, S6 = 27 datoer, alle med
// kalenderens 5 loebsdage pr. dato. Modelleret lokalt, saa testen ikke raadner naar et
// nyt saesonmaal tilfoejes til SEASON_RACE_DAY_TARGET.
const RACE_DAYS_PER_DATE = TRAINING_RACE_DAY_CONFIG.raceDaysPerDate;
const SEASONS_6711 = Object.freeze([
  { label: "S4 (140)", seasonNumber: 4, raceDays: 140 },
  { label: "S5 (160)", seasonNumber: 5, raceDays: 160 },
  { label: "S6 (135)", seasonNumber: 6, raceDays: 135 },
]);
// Deleren som den saa ud FOER #6711: skaleret med saesonens samlede loebsdage.
const legacySeasonScaledDivisor = (raceDays) =>
  (raceDays * TRAINING_RACE_DAY_CONFIG.legacyDaysPerSeason) / TRAINING_RACE_DAY_CONFIG.calendarTicksPerSeasonToday;

const RIDER_6711 = Object.freeze({
  ability: "endurance", cap: 90, age: 20, program: { focus: "endurance", intensity: "normal" },
  conditionMult: 1, bonus: false, noise: 1, potentiale: 4,
});
// Evnens forloeb dato for dato: kurven[i] = vaerdien efter dato i (5 loebsdags-ticks pr. dato).
function perDateCurve(dates, divisor, start = 40) {
  const curve = [];
  let current = start;
  for (let d = 0; d < dates; d += 1) {
    for (let slot = 0; slot < RACE_DAYS_PER_DATE; slot += 1) {
      current += dailyAbilityDelta({ ...RIDER_6711, current, budgetDivisor: divisor });
    }
    curve.push(current);
  }
  return curve;
}

test("#6711: ankeret er kalenderens 5 loebsdage pr. dato, og reference-saesonen er S4's", () => {
  assert.equal(RACE_DAYS_PER_DATE, 5);
  assert.equal(TRAINING_RACE_DAY_CONFIG.raceDaysPerSeason,
    RACE_DAYS_PER_DATE * TRAINING_RACE_DAY_CONFIG.legacyDaysPerSeason,
    "reference-saesonen er udledt af ankeret, ikke et frit tal");
  assert.equal(TRAINING_RACE_DAY_CONFIG.raceDaysPerSeason, SEASON_RACE_DAY_TARGET[4],
    "ankeret rammer S4's kalendermaal, ellers aendrer #6711 S4's udbytte");
});

test("#6711: S4 (140) faar BIT-IDENTISK deler og udvikling som foer", () => {
  const before = legacySeasonScaledDivisor(SEASON_RACE_DAY_TARGET[4]);
  const after = resolveRaceDayBudgetDivisor({ seasonNumber: 4 });
  assert.ok(Object.is(after, before), `deleren skal vaere bit-identisk: foer ${before}, efter ${after}`);
  assert.ok(Object.is(raceDayBudgetDivisor(), before));
  // Hele saesonen gennem den AEGTE dailyAbilityDelta: hvert mellemresultat ens.
  assert.deepStrictEqual(perDateCurve(28, after), perDateCurve(28, before));
  // ... og gennem applyDailyTick (stoej, skade-rul, carry, fokus-pakke).
  const tickArgs = {
    riderId: "r-6711", dateStr: "2026-10-16", age: 22, tickSeedKey: "season-4#gd17",
    abilities: { climbing: 50, endurance: 50, sprint: 50 },
    caps: { climbing: 80, endurance: 80, sprint: 80 },
    progress: {}, program: { focus: "endurance", intensity: "normal" },
    conditionMult: 1, potentiale: 4,
  };
  assert.deepStrictEqual(
    applyDailyTick({ ...tickArgs, budgetDivisor: after }),
    applyDailyTick({ ...tickArgs, budgetDivisor: before }),
  );
});

test("#6711: deleren er ens for 140, 160 og 135 loebsdage (og for ukendte saesoner)", () => {
  const reference = raceDayBudgetDivisor();
  for (const { label, seasonNumber } of SEASONS_6711) {
    assert.ok(Object.is(resolveRaceDayBudgetDivisor({ seasonNumber }), reference), label);
  }
  for (const seasonNumber of [null, undefined, 3, 99]) {
    assert.ok(Object.is(resolveRaceDayBudgetDivisor({ seasonNumber }), reference), `saeson ${String(seasonNumber)}`);
  }
  assert.ok(Object.is(resolveRaceDayBudgetDivisor(), reference), "uden argumenter");
});

test("#6711: forventet udvikling pr. virkelig dato er ens for 140, 160 og 135", () => {
  const curves = SEASONS_6711.map(({ seasonNumber, raceDays }) => {
    assert.equal(raceDays % RACE_DAYS_PER_DATE, 0, "praemissen: hele datoer");
    return perDateCurve(raceDays / RACE_DAYS_PER_DATE, resolveRaceDayBudgetDivisor({ seasonNumber }));
  });
  const shared = Math.min(...curves.map((c) => c.length));
  for (let i = 1; i < curves.length; i += 1) {
    assert.deepStrictEqual(curves[i].slice(0, shared), curves[0].slice(0, shared),
      `${SEASONS_6711[i].label}: samme dato giver samme evne som ${SEASONS_6711[0].label}`);
  }
  // En laengere saeson giver mere SAMLET udvikling, fordi den har flere datoer.
  const [s4, s5, s6] = curves.map((c) => c.at(-1));
  assert.ok(s5 > s4 && s4 > s6, `saesonens total foelger antal datoer: S4 ${s4}, S5 ${s5}, S6 ${s6}`);
});

test("#6711: den gamle saeson-skalerede deler tyndede S5 ud (negativ-test)", () => {
  // Uden forankringen giver den foerste loebsdag i S5 kun 140/160 af S4's udbytte, og
  // i S6 mere end S4's. Det er praecis fejlen #6711 retter.
  const firstDelta = (divisor) => dailyAbilityDelta({ ...RIDER_6711, current: 40, budgetDivisor: divisor });
  const s4 = firstDelta(legacySeasonScaledDivisor(140));
  const s5 = firstDelta(legacySeasonScaledDivisor(160));
  const s6 = firstDelta(legacySeasonScaledDivisor(135));
  assert.ok(Math.abs(s5 / s4 - 140 / 160) < 1e-9, `S5/S4 = ${s5 / s4}`);
  assert.ok(s6 > s4, "S6 ville have faaet mere pr. dag end S4");
  const fixed = firstDelta(resolveRaceDayBudgetDivisor({ seasonNumber: 5 }));
  assert.ok(Object.is(fixed, s4), "med forankringen faar S5 S4's udbytte pr. loebsdag");
});

test("#4846: deler-opslaget er SYNKRONT — ingen dynamisk import at vente paa", () => {
  assert.equal(typeof resolveRaceDayBudgetDivisor({ seasonNumber: 4 }), "number");
});

test("#6711: en cfg-override flytter deleren via ankeret, ikke via saesonens maal", () => {
  const cfg = { ...TRAINING_RACE_DAY_CONFIG, raceDaysPerDate: 10 };
  assert.ok(Math.abs(raceDayBudgetDivisor(cfg) - 2 * raceDayBudgetDivisor()) < 1e-9);
  assert.ok(Object.is(resolveRaceDayBudgetDivisor({ seasonNumber: 5, cfg }), raceDayBudgetDivisor(cfg)));
});

// Diff-tjekket af PR #5608 (24/9): aksens laengde maa IKKE arves. Kalenderen pakker
// efter `SEASON_RACE_DAY_TARGET[n] ?? null`, saa en saeson uden eget tal har intet maal.
test("#4846: aksens maal laeses med kalenderens regel — en saeson uden eget tal arver IKKE", () => {
  assert.equal(resolveCalendarRaceDayTarget({ seasonNumber: 4 }), SEASON_RACE_DAY_TARGET[4]);
  for (const seasonNumber of [3, 5, 99]) {
    assert.equal(resolveCalendarRaceDayTarget({ seasonNumber }), SEASON_RACE_DAY_TARGET[seasonNumber] ?? null,
      `saeson ${seasonNumber}: samme svar som kalenderen`);
  }
  // Tabellen som i dag ({ 4: 140 }), laast lokalt saa testen ikke raadner naar et nyt
  // saesonmaal tilfoejes.
  const today = { 4: 140 };
  assert.equal(resolveCalendarRaceDayTarget({ seasonNumber: 3, table: today }), null,
    "en saeson uden eget maal: ingen forlaengelse");
});

test("#4846: kalenderens maal — ukendt, ugyldigt eller ikke-positivt giver null, aldrig 0", () => {
  const table = { 4: 140, 5: 0, 6: -3, 7: "x", 8: 12.5, 9: null, 10: "120" };
  assert.equal(resolveCalendarRaceDayTarget({ seasonNumber: 4, table }), 140);
  assert.equal(resolveCalendarRaceDayTarget({ seasonNumber: "4", table }), 140, "tal som tekst, som seasonTransition.js' Number()");
  assert.equal(resolveCalendarRaceDayTarget({ seasonNumber: 10, table }), 120);
  for (const seasonNumber of [5, 6, 7, 8, 9, 11, null, undefined, Number.NaN, 4.5]) {
    assert.equal(resolveCalendarRaceDayTarget({ seasonNumber, table }), null, `saeson ${String(seasonNumber)}`);
  }
  assert.equal(resolveCalendarRaceDayTarget({ seasonNumber: 4, table: null }), null);
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

// ── #5949: udgaaet rytter frigives fra dagen EFTER udgangsdagen ──────────────
// Et 8-etapers loeb paa loebsdag 10..17 (etape n paa loebsdag 9+n). Rytter "a"
// udgaar paa etape 2 (loebsdag 11), rytter "b" koerer hele loebet.
const TOUR_DAYS = [10, 11, 12, 13, 14, 15, 16, 17];

function tourTables({ incidents = [], schedule = TOUR_DAYS.map((d, i) => ({ race_id: "tour", stage_number: i + 1, game_day: d })) } = {}) {
  return {
    race_entry_days: ["a", "b"].flatMap((rider_id) => TOUR_DAYS.map((game_day) => ({
      rider_id, season_id: BIND_SEASON, game_day, race_id: "tour", team_id: "t1",
    }))),
    race_incidents: incidents,
    race_stage_schedule: schedule,
  };
}

async function boundOn(tables, gameDay, extra = {}) {
  const out = await loadBoundRiderIdsForRaceDay({
    supabase: mockSupabase(tables), riderIds: ["a", "b"], seasonId: BIND_SEASON, gameDay, ...extra,
  });
  assert.equal(out.error, null);
  return [...out.data].sort();
}

const ABANDON_STAGE_2 = { race_id: "tour", stage_number: 2, rider_id: "a", kind: "time_limit", outcome: "abandon" };

test("#5949: udgang paa etape 2 af 8 => bundet til og med udgangsdagen, fri dag 3-8", async () => {
  const tables = tourTables({ incidents: [ABANDON_STAGE_2] });
  assert.deepEqual(await boundOn(tables, 10), ["a", "b"], "etape 1: begge koerer");
  assert.deepEqual(await boundOn(tables, 11), ["a", "b"], "udgangsdagen er stadig bundet (hvile)");
  for (const day of TOUR_DAYS.slice(2)) {
    assert.deepEqual(await boundOn(tables, day), ["b"], `loebsdag ${day}: a foelger programmet igen`);
  }
});

test("#5949: frigivelsen gaelder ogsaa uden DNS-frigivelsen (releaseDns=false)", async () => {
  const tables = tourTables({ incidents: [ABANDON_STAGE_2] });
  assert.deepEqual(await boundOn(tables, 11, { releaseDns: false }), ["a", "b"]);
  assert.deepEqual(await boundOn(tables, 12, { releaseDns: false }), ["b"]);
});

test("#5949: skadet udgang (styrt) frigives ogsaa; hvilen kommer fra skade-gaten, ikke bindingen", async () => {
  // Bindingen siger kun "ikke i loebet laengere". Motoren og prognosen giver en skadet
  // rytter hvile via isInjuredOnRaceDay foer bindingen overhovedet vurderes
  // (se trainingWeekPlanForecast.test.js for hele kaeden).
  const tables = tourTables({ incidents: [{ ...ABANDON_STAGE_2, kind: "crash", injury_days: 3 }] });
  assert.deepEqual(await boundOn(tables, 12), ["b"]);
});

test("#5949: kun outcome=abandon taeller; tidstab og andre loeb frigiver intet", async () => {
  const tables = tourTables({
    incidents: [
      { race_id: "tour", stage_number: 2, rider_id: "b", kind: "crash", outcome: "time_loss" },
      { race_id: "andet-loeb", stage_number: 1, rider_id: "a", kind: "crash", outcome: "abandon" },
    ],
  });
  tables.race_stage_schedule.push({ race_id: "andet-loeb", stage_number: 1, game_day: 2 });
  assert.deepEqual(await boundOn(tables, 14), ["a", "b"]);
});

test("#5949: manglende game_day for udgangsetapen bevarer bindingen (manglende bevis = hvile)", async () => {
  const tables = tourTables({
    incidents: [ABANDON_STAGE_2],
    schedule: [{ race_id: "tour", stage_number: 2, game_day: null }],
  });
  assert.deepEqual(await boundOn(tables, 14), ["a", "b"]);
});

test("#5949: fejl i udgangs-opslaget RETURNERES — bindingen gaettes aldrig", async () => {
  for (const table of ["race_incidents", "race_stage_schedule"]) {
    const out = await loadBoundRiderIdsForRaceDay({
      supabase: mockSupabase(tourTables({ incidents: [ABANDON_STAGE_2] }), { errorOn: table }),
      riderIds: ["a", "b"], seasonId: BIND_SEASON, gameDay: 14,
    });
    assert.equal(out.data, null, table);
    assert.ok(out.error, table);
  }
});

test("#5949: dropBindingsAfterRaceExit er ren og bruger raekkens egen game_day", () => {
  const exits = new Map([["a:tour", 11]]);
  const rows = [
    { rider_id: "a", race_id: "tour", game_day: 11 },
    { rider_id: "a", race_id: "tour", game_day: 12 },
    { rider_id: "b", race_id: "tour", game_day: 12 },
  ];
  assert.deepEqual(dropBindingsAfterRaceExit(rows, exits), [rows[0], rows[2]]);
  assert.deepEqual(dropBindingsAfterRaceExit(rows, new Map()), rows);
  assert.deepEqual(dropBindingsAfterRaceExit([{ rider_id: "a", race_id: "tour" }], exits, 13), []);
});

test("#5949: loadRaceExitGameDays tager den tidligste udgang og koster ingen DB-tur uden bindinger", async () => {
  const tables = tourTables({
    incidents: [ABANDON_STAGE_2, { ...ABANDON_STAGE_2, stage_number: 3, kind: "injury" }],
  });
  const out = await loadRaceExitGameDays({
    supabase: mockSupabase(tables), rows: [{ rider_id: "a", race_id: "tour" }],
  });
  assert.equal(out.error, null);
  assert.deepEqual([...out.data], [["a:tour", 11]]);
  let calls = 0;
  const empty = await loadRaceExitGameDays({ supabase: { from() { calls += 1; return {}; } }, rows: [] });
  assert.equal(calls, 0);
  assert.equal(empty.data.size, 0);
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
