// #8580 · Den rullende uge mod dommer-scenarierne (docs/audits/7456-program-dommer-scenarier.md §5).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addDays, weekDateRaces, weekDateRiderFields, weekGameDaysByDate, loadTeamWeekForecast, WEEK_FORECAST_DAYS,
} from "./trainingWeekForecast.js";
import { forecastBindingsFromEntryDays } from "./trainingWeekPlanForecast.js";
import { NO_PRIOR_GAME_DAY } from "./trainingDayCloseTrigger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIV = "div-1";
const st = (race_id, game_day, stage_number = 1) => ({ race_id, game_day, stage_number });

test("addDays krydser maaneds- og sommertidsgraense uden at tabe en dag", () => {
  assert.equal(addDays("2026-11-22", 0), "2026-11-22");
  assert.equal(addDays("2026-11-28", 3), "2026-12-01");
  assert.equal(addDays("2026-03-28", 1), "2026-03-29");
  assert.equal(addDays("2026-03-29", 1), "2026-03-30");
});

test("ugen er i dag + 7 dage (dagsvaelgeren); Program-gitterets 7 kolonner er de foerste 7 (UGE-1)", () => {
  const dates = Array.from({ length: WEEK_FORECAST_DAYS }, (_, i) => addDays("2026-11-25", i));
  assert.equal(dates.length, 8);
  assert.equal(dates[0], "2026-11-25");
  assert.equal(dates[6], "2026-12-01");
  assert.equal(dates[7], "2026-12-02");
});

test("aksen kaedes dato for dato: hver dato faar sine 5 loebsdage, hullet fyldes som i sweepen", () => {
  const dates = ["d0", "d1", "d2"];
  const stagesByDate = new Map([
    ["d0", [st("a", 10), st("a", 14)]],
    ["d1", [st("b", 17), st("b", 19)]],
    ["d2", [st("c", 20), st("c", 24)]],
  ]);
  const out = weekGameDaysByDate({ dates, stagesByDate, divisionId: DIV, basePrior: 9 });
  assert.deepEqual(out.get("d0"), [10, 11, 12, 13, 14]);
  assert.deepEqual(out.get("d1"), [15, 16, 17, 18, 19]);
  assert.deepEqual(out.get("d2"), [20, 21, 22, 23, 24]);
});

test("UGE-5: en dato, hvor aksen ikke giver 5 loebsdage, er null (ingen gaet ud fra datoen)", () => {
  const dates = ["d0", "d1", "d2"];
  const stagesByDate = new Map([
    ["d0", [st("a", 0), st("a", 4)]],
    ["d1", []],
    ["d2", [st("c", 7)]],
  ]);
  const out = weekGameDaysByDate({ dates, stagesByDate, divisionId: DIV, basePrior: NO_PRIOR_GAME_DAY });
  assert.deepEqual(out.get("d0"), [0, 1, 2, 3, 4]);
  assert.equal(out.get("d1"), null, "dato uden loeb i divisionen");
  assert.equal(out.get("d2"), null, "5..7 er kun 3 loebsdage");
  const unknown = weekGameDaysByDate({ dates: ["x"], stagesByDate: new Map([["x", [st("a", 12)]]]), divisionId: DIV, basePrior: null });
  assert.equal(unknown.get("x"), null, "ukendt forrige loebsdag: kun datoens egen loebsdag, ikke 5");
});

const GD = [20, 21, 22, 23, 24];
function fields({ entryDays, schedule, exits = new Map(), riderIds = ["r1"] }) {
  const { plannedStages, boundRiderIdsByGameDay } = forecastBindingsFromEntryDays({ entryDays, schedule, profiles: [], exits });
  return weekDateRiderFields({ gameDays: GD, riderIds, plannedStages, boundRiderIdsByGameDay });
}

test("UGE-2: GT-dato med etaper paa LD2+LD4 giver to loebsfelter; resten er planens pas", () => {
  const entryDays = GD.map((g) => ({ rider_id: "r1", race_id: "gt", game_day: g }));
  const schedule = [st("gt", 21, 5), st("gt", 23, 6)];
  assert.deepEqual(fields({ entryDays, schedule }).r1, { raceSlots: [1, 3], restSlots: [] });
});

test("UGE-2: bundet hel dato uden etape (GT-hviledag) er H x5, aldrig traening", () => {
  const entryDays = GD.map((g) => ({ rider_id: "r1", race_id: "gt", game_day: g }));
  assert.deepEqual(fields({ entryDays, schedule: [] }).r1, { raceSlots: [], restSlots: [0, 1, 2, 3, 4] });
});

test("UGE-3: dagen efter udgang af loebet er der hverken loebs- eller hvilefelter", () => {
  const entryDays = GD.map((g) => ({ rider_id: "r1", race_id: "gt", game_day: g }));
  const schedule = GD.map((g, i) => st("gt", g, i + 1));
  // Udgang paa LD 21 (motorens noegle `rider:race`): bundet t.o.m. 21, derefter planens pas.
  assert.deepEqual(fields({ entryDays, schedule, exits: new Map([["r1:gt", 21]]) }).r1, { raceSlots: [0, 1], restSlots: [] });
  // Udgang dagen foer datoen: ingen binding paa datoen overhovedet.
  assert.deepEqual(fields({ entryDays, schedule, exits: new Map([["r1:gt", 19]]) }).r1, { raceSlots: [], restSlots: [] });
  // Ingen udgang kendt (manglende bevis): bindingen bevares.
  assert.deepEqual(fields({ entryDays, schedule }).r1, { raceSlots: [0, 1, 2, 3, 4], restSlots: [] });
});

test("UGE-4: et loeb i divisionen, som rytteren ikke er udtaget til, er ikke hans loebsfelt", () => {
  const entryDays = GD.map((g) => ({ rider_id: "r2", race_id: "gt", game_day: g }));
  const schedule = GD.map((g, i) => st("gt", g, i + 1));
  const out = fields({ entryDays, schedule, riderIds: ["r1", "r2"] });
  assert.deepEqual(out.r1, { raceSlots: [], restSlots: [] });
  assert.deepEqual(out.r2.raceSlots, [0, 1, 2, 3, 4]);
});

test("UGE-6: holdets loeb pr. dato med navn og etape/endagsloeb, ingen traethed i svaret", () => {
  const races = new Map([["gt", { name: "Tour", stages: 21 }], ["one", { name: "Classic", stages: 1 }]]);
  const out = weekDateRaces({ stages: [st("gt", 21, 6), st("gt", 23, 7), st("one", 22, 1), st("ukendt", 24, 1)], races });
  assert.deepEqual(out, [
    { raceId: "one", name: "Classic", kind: "oneday", stages: [1], ownRiders: 0 },
    { raceId: "gt", name: "Tour", kind: "stage", stages: [6, 7], ownRiders: 0 },
  ]);
  const riderOut = fields({ entryDays: [], schedule: [] }).r1;
  assert.deepEqual(Object.keys(riderOut).sort(), ["raceSlots", "restSlots"], "ingen fatigue/band frem i tiden");
});

// ── I/O med en falsk supabase: dag 0 er dagens svar uaendret (UGE-1) ───────
function fakeSupabase(tables) {
  return {
    from(table) {
      const q = {
        _t: table, _f: [],
        select() { return q; }, eq() { return q; }, in() { return q; }, gte() { return q; }, lt() { return q; },
        order() { return q; }, limit() { return q; }, maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        then(resolveFn, rejectFn) { return Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolveFn, rejectFn); },
      };
      return q;
    },
  };
}

test("UGE-1: dag 0 er praecis det svar, GET /forecast giver (samme objekt, ingen omregning)", async () => {
  const today = { tickDate: "2026-11-22", available: true, settled: false, riders: { r1: { fatigue: 41, band: "ok", raceSlots: [2] } } };
  const week = await loadTeamWeekForecast({
    supabase: fakeSupabase({ riders: [{ id: "r1" }] }),
    team: { id: "t1", league_division_id: DIV }, seasonId: "s1", now: new Date("2026-11-22T10:00:00Z"),
    loadToday: async () => today,
  });
  assert.equal(week.available, true);
  assert.equal(week.days.length, 8);
  assert.equal(week.days[0].today, today);
  assert.equal(week.days[0].date, "2026-11-22");
  for (const day of week.days.slice(1)) {
    assert.equal(day.available, false, "ingen loeb i den falske kalender: ingen gaet");
    assert.deepEqual(day.riders, {});
  }
});

test("route: kontakten off giver { available:false, reason:'disabled' } og samme gate for dag 0 som /forecast", () => {
  const src = readFileSync(resolve(__dirname, "../routes/trainingPrograms.js"), "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf('router.get("/forecast/week"');
  assert.ok(start > 0);
  const block = src.slice(start, src.indexOf("\n  });", start));
  assert.match(block, /isTrainingWeekForecastEnabled\(supabase, \{ isBetaTester \}\)/);
  assert.match(block, /available: false, reason: "disabled", days: \[\]/);
  assert.match(block, /await cellsOn\(req\)/);
});

// ── Fable-dom 22/11, fund 1, 2 og 5 ──────────────────────────────────────────
test("fund 1: skadet rytter er hvile paa loebsdage t.o.m. skadens slut-loebsdag; etape vinder over skade", () => {
  const { plannedStages, boundRiderIdsByGameDay } = forecastBindingsFromEntryDays({ entryDays: [], schedule: [], profiles: [], exits: new Map() });
  const injuredOn = (id, gd) => id === "r1" && gd <= 22;
  const out = weekDateRiderFields({ gameDays: GD, riderIds: ["r1", "r2"], plannedStages, boundRiderIdsByGameDay, injuredOn });
  assert.deepEqual(out.r1, { raceSlots: [], restSlots: [0, 1, 2] });
  assert.deepEqual(out.r2, { raceSlots: [], restSlots: [] });
  const withStage = forecastBindingsFromEntryDays({ entryDays: [{ rider_id: "r1", race_id: "one", game_day: 21 }], schedule: [st("one", 21)], profiles: [], exits: new Map() });
  const out2 = weekDateRiderFields({ gameDays: GD, riderIds: ["r1"], ...withStage, injuredOn });
  assert.deepEqual(out2.r1, { raceSlots: [1], restSlots: [0, 2] });
});

test("fund 2: hvert loeb siger, hvor mange af holdets ryttere der koerer det paa datoen", () => {
  const races = new Map([["gt", { name: "Tour", stages: 21 }], ["one", { name: "Classic", stages: 1 }]]);
  const plannedStages = [{ rider_id: "r1", game_day: 21 }, { rider_id: "r2", game_day: 21 }, { rider_id: "r1", game_day: 23 }];
  const raceIdByEntry = new Map([["r1:21", "gt"], ["r2:21", "gt"], ["r1:23", "gt"]]);
  const out = weekDateRaces({ stages: [st("gt", 21, 6), st("one", 22, 1)], races, plannedStages, raceIdByEntry });
  assert.deepEqual(out.map((r) => [r.raceId, r.ownRiders]), [["one", 0], ["gt", 2]]);
});

function routedSupabase(handler) {
  return {
    from(table) {
      const state = { table, select: "", filters: [] };
      const q = {
        select(cols) { state.select = cols; return q; },
        eq(k, v) { state.filters.push(["eq", k, v]); return q; },
        in(k, v) { state.filters.push(["in", k, v]); return q; },
        gte(k, v) { state.filters.push(["gte", k, v]); return q; },
        lt(k, v) { state.filters.push(["lt", k, v]); return q; },
        order() { return q; }, limit() { return q; },
        then(res, rej) { return Promise.resolve({ data: handler(state), error: null }).then(res, rej); },
      };
      return q;
    },
  };
}

test("fund 5: I/O med etaper over to datoer (inkl. sommertidsskift), binding og skade", async () => {
  // 2027-03-27 (lør) -> 2027-03-28 er sommertid. Aksen: loebsdag 0-4 og 5-9.
  const at = (date, h) => new Date(`${date}T${String(h).padStart(2, "0")}:00:00+01:00`).toISOString();
  const stages = [
    { race_id: "gt", stage_number: 1, game_day: 0, scheduled_at: at("2027-03-27", 12) },
    { race_id: "gt", stage_number: 2, game_day: 4, scheduled_at: at("2027-03-27", 16) },
    { race_id: "gt", stage_number: 3, game_day: 6, scheduled_at: new Date("2027-03-28T13:00:00+02:00").toISOString() },
    { race_id: "gt", stage_number: 4, game_day: 9, scheduled_at: new Date("2027-03-28T17:00:00+02:00").toISOString() },
  ];
  const supabase = routedSupabase(({ table, select, filters }) => {
    if (table === "riders") return [{ id: "r1" }, { id: "r2" }];
    if (table === "races") return [{ id: "gt", name: "Tour Preview", stages: 21 }];
    if (table === "race_stage_schedule" && select.includes("races!inner")) return stages.map((s) => ({ ...s, races: {} }));
    if (table === "race_stage_schedule" && select === "game_day") return []; // ingen loeb foer ugen: saesonstart
    if (table === "race_stage_schedule") return stages.map(({ scheduled_at: _s, ...s }) => s);
    if (table === "race_entry_days") return [0, 5, 6, 7, 8, 9].map((g) => ({ rider_id: "r1", race_id: "gt", game_day: g }));
    if (table === "rider_condition") return [{ rider_id: "r2", injury_season_id: "s1", injury_end_game_day: 7 }];
    if (table === "race_incidents") return [];
    void filters;
    return [];
  });
  const week = await loadTeamWeekForecast({
    supabase, team: { id: "t1", league_division_id: DIV }, seasonId: "s1",
    now: new Date("2027-03-27T09:00:00+01:00"), loadToday: async () => ({ available: true, riders: {} }),
  });
  assert.equal(week.days[0].date, "2027-03-27");
  assert.deepEqual(week.days[0].races.map((r) => r.ownRiders), [1], "dag 0: r1 kører etapen på LD 0, så I dag-chippen kan sige Etape");
  const sun = week.days[1];
  assert.equal(sun.date, "2027-03-28");
  assert.equal(sun.available, true, "akse 5-9 kaedet fra lørdagens 0-4");
  assert.deepEqual(sun.riders.r1, { raceSlots: [1, 4], restSlots: [] }, "etaper paa LD 6 og 9");
  assert.deepEqual(sun.riders.r2, { raceSlots: [], restSlots: [0, 1, 2] }, "skadet t.o.m. LD 7");
  assert.deepEqual(sun.races, [{ raceId: "gt", name: "Tour Preview", kind: "stage", stages: [3, 4], ownRiders: 1 }]);
  assert.equal(week.days[2].available, false, "mandag uden loeb: ingen gaet");
});
