import test from "node:test";
import assert from "node:assert/strict";
import { computeRacingTodayByRider, loadRacingTodayByRider } from "./racingTodayLookup.js";
import { readFileSync } from "node:fs";
import { loadBoundRiderIdsForRaceDay } from "./trainingRaceDayTick.js";

// ── computeRacingTodayByRider (ren funktion) ──────────────────────────────────

test("computeRacingTodayByRider: matcher kun entries hvis race_id har en etape i dag", () => {
  const out = computeRacingTodayByRider({
    entryRows: [
      { race_id: "race-a", rider_id: "rider-1" },
      { race_id: "race-b", rider_id: "rider-2" }, // race-b har INGEN etape i dag
    ],
    todayRaceIds: ["race-a"],
    raceNameById: new Map([["race-a", "Tour de Zone"]]),
  });
  assert.deepEqual(out, { "rider-1": { race: "Tour de Zone" } });
});

test("computeRacingTodayByRider: tomme entries/todayRaceIds giver tomt map", () => {
  assert.deepEqual(computeRacingTodayByRider({}), {});
  assert.deepEqual(computeRacingTodayByRider({ entryRows: [], todayRaceIds: ["race-a"] }), {});
  assert.deepEqual(computeRacingTodayByRider({ entryRows: [{ race_id: "race-a", rider_id: "rider-1" }], todayRaceIds: [] }), {});
});

test("computeRacingTodayByRider: manglende løbsnavn (races-select fejlede delvist) giver race:null, ikke en kastet fejl", () => {
  const out = computeRacingTodayByRider({
    entryRows: [{ race_id: "race-a", rider_id: "rider-1" }],
    todayRaceIds: ["race-a"],
    raceNameById: new Map(),
  });
  assert.deepEqual(out, { "rider-1": { race: null } });
});

test("computeRacingTodayByRider: 1-rytter-1-løb-invarianten betyder normalt ét match, men en uventet dobbelt-række er harmløs (sidste vinder)", () => {
  const out = computeRacingTodayByRider({
    entryRows: [
      { race_id: "race-a", rider_id: "rider-1" },
      { race_id: "race-b", rider_id: "rider-1" },
    ],
    todayRaceIds: ["race-a", "race-b"],
    raceNameById: new Map([["race-a", "Race A"], ["race-b", "Race B"]]),
  });
  assert.equal(out["rider-1"].race, "Race B");
});

// ── loadRacingTodayByRider (I/O-wrapper, fake supabase) ───────────────────────

const SIX_IDS = [1, 2, 3, 4, 5, 6].map((n) => `rider-${n}`);
const SIX_ENTRIES = SIX_IDS.map((rider_id) => ({ race_id: "race-a", rider_id }));

function fakeSupabase({ entries, sched, races, entryError, schedError, raceError, conditions, conditionError } = {}) {
  return {
    from(table) {
      if (table === "rider_condition") {
        return { select: () => ({ in: async () => ({ data: conditions ?? [], error: conditionError ?? null }) }) };
      }
      if (table === "race_entries") {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: entries ?? [], error: entryError ?? null }),
            }),
          }),
        };
      }
      if (table === "race_stage_schedule") {
        return {
          select: () => ({
            gte: () => ({
              lt: async () => ({ data: sched ?? [], error: schedError ?? null }),
            }),
          }),
        };
      }
      if (table === "races") {
        return {
          select: () => ({
            in: async () => ({ data: races ?? [], error: raceError ?? null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test("loadRacingTodayByRider: happy path — rider entered in a race scheduled today gets the race name", async () => {
  const supabase = fakeSupabase({
    entries: SIX_ENTRIES,
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour de Zone", stages_completed: 0 }],
  });
  const out = await loadRacingTodayByRider(supabase, "team-1", [...SIX_IDS, "rider-7"], new Date("2026-08-10T10:00:00Z"));
  assert.equal(out["rider-1"].race, "Tour de Zone");
  assert.equal(Object.keys(out).length, 6);
});

test("loadRacingTodayByRider: rider entered but no stage scheduled today → not racing", async () => {
  const supabase = fakeSupabase({
    entries: [{ race_id: "race-a", rider_id: "rider-1" }],
    sched: [], // ingen etaper i dag
    races: [],
  });
  const out = await loadRacingTodayByRider(supabase, "team-1", ["rider-1"], new Date());
  assert.deepEqual(out, {});
});

test("loadRacingTodayByRider: tomt riderIds/manglende teamId/manglende supabase-client → {} uden query", async () => {
  assert.deepEqual(await loadRacingTodayByRider(fakeSupabase(), "team-1", [], new Date()), {});
  assert.deepEqual(await loadRacingTodayByRider(fakeSupabase(), null, ["rider-1"], new Date()), {});
  assert.deepEqual(await loadRacingTodayByRider(null, "team-1", ["rider-1"], new Date()), {});
});

test("loadRacingTodayByRider: fail-safe — query-fejl på entries/schedule/races giver {} i stedet for at kaste", async () => {
  const entryErrSupabase = fakeSupabase({ entryError: new Error("boom") });
  assert.deepEqual(await loadRacingTodayByRider(entryErrSupabase, "team-1", ["rider-1"], new Date()), {});

  const schedErrSupabase = fakeSupabase({ schedError: new Error("boom") });
  assert.deepEqual(await loadRacingTodayByRider(schedErrSupabase, "team-1", ["rider-1"], new Date()), {});

  const raceErrSupabase = fakeSupabase({
    entries: [{ race_id: "race-a", rider_id: "rider-1" }],
    sched: [{ race_id: "race-a" }],
    raceError: new Error("boom"),
  });
  assert.deepEqual(await loadRacingTodayByRider(raceErrSupabase, "team-1", ["rider-1"], new Date()), {});
});

test("loadRacingTodayByRider: fail-safe — en synkron/netværks-exception giver {} i stedet for at kaste", async () => {
  const throwingSupabase = { from: () => { throw new Error("network"); } };
  assert.deepEqual(await loadRacingTodayByRider(throwingSupabase, "team-1", ["rider-1"], new Date()), {});
});

// ── #5945: hold der ikke starter faar ikke "løber i dag" ──────────────────────

test("computeRacingTodayByRider: startsByRaceId=false skjuler badget, manglende noegle bevarer det (#5945)", () => {
  const args = {
    entryRows: [{ race_id: "race-a", rider_id: "rider-1" }, { race_id: "race-b", rider_id: "rider-2" }],
    todayRaceIds: ["race-a", "race-b"],
    raceNameById: new Map([["race-a", "A"], ["race-b", "B"]]),
  };
  assert.deepEqual(computeRacingTodayByRider({ ...args, startsByRaceId: new Map([["race-a", false]]) }), { "rider-2": { race: "B" } });
  assert.deepEqual(Object.keys(computeRacingTodayByRider(args)).sort(), ["rider-1", "rider-2"]);
});

test("loadRacingTodayByRider: hold med 3 udtagne og ingen frie ryttere faar intet badge (#5945)", async () => {
  const supabase = fakeSupabase({
    entries: SIX_ENTRIES.slice(0, 3),
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour de Zone", stages_completed: 0 }],
  });
  assert.deepEqual(await loadRacingTodayByRider(supabase, "team-1", SIX_IDS.slice(0, 3), new Date()), {});
});

test("loadRacingTodayByRider: 3 udtagne + 3 frie ryttere naar gulvet (assistenten fylder op) og beholder badget", async () => {
  const supabase = fakeSupabase({
    entries: SIX_ENTRIES.slice(0, 3),
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour de Zone", stages_completed: 0 }],
  });
  const out = await loadRacingTodayByRider(supabase, "team-1", SIX_IDS, new Date());
  assert.deepEqual(Object.keys(out).sort(), SIX_IDS.slice(0, 3));
});

test("loadRacingTodayByRider: skadede frie ryttere taeller ikke med til gulvet", async () => {
  const supabase = fakeSupabase({
    entries: SIX_ENTRIES.slice(0, 3),
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour de Zone", stages_completed: 0 }],
    conditions: SIX_IDS.slice(3).map((rider_id) => ({ rider_id, injured_until: "2999-01-01" })),
  });
  assert.deepEqual(await loadRacingTodayByRider(supabase, "team-1", SIX_IDS, new Date()), {});
});

test("loadRacingTodayByRider: et loeb i gang roeres ikke selvom holdet er under gulvet", async () => {
  const supabase = fakeSupabase({
    entries: SIX_ENTRIES.slice(0, 3),
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour de Zone", stages_completed: 2 }],
  });
  const out = await loadRacingTodayByRider(supabase, "team-1", SIX_IDS.slice(0, 3), new Date());
  assert.deepEqual(Object.keys(out).sort(), SIX_IDS.slice(0, 3));
});

test("loadRacingTodayByRider: svigtende skadesopslag fejler mod stiller-op (badge som foer), aldrig throw", async () => {
  const supabase = fakeSupabase({
    entries: SIX_ENTRIES.slice(0, 3),
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour de Zone", stages_completed: 0 }],
    conditionError: new Error("boom"),
  });
  const out = await loadRacingTodayByRider(supabase, "team-1", SIX_IDS, new Date());
  assert.equal(Object.keys(out).length, 3);
});

// ── #5945: et hold der IKKE startede træner normalt ───────────────────────────
// "Løber i dag"-badget er PRE-hoc og skjules nu for hold der ikke starter. Selve
// træningen afgøres af to andre kilder, og begge skal blive ved at give det samme
// svar for et hold der blev fjernet fra startfeltet:
//   1) dailyTrainingEngine.loadRacedRiderIdsToday er POST-hoc paa race_results — et
//      hold uden resultater har ingen "koerte i dag"-raekker og traener normalt.
//   2) loadBoundRiderIdsForRaceDay slipper bindingen for ryttere der ikke staar i
//      loebets uforanderlige startfelt-snapshot (DNS), saa en rytter fra et hold der
//      blev fjernet ved start heller ikke er bundet.

test("pin: loadRacedRiderIdsToday laeser race_results (post-hoc), ikke race_entries", () => {
  const src = readFileSync(new URL("./dailyTrainingEngine.js", import.meta.url), "utf8");
  const start = src.indexOf("async function loadRacedRiderIdsToday");
  assert.ok(start > 0, "loadRacedRiderIdsToday findes");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.match(body, /\.from\("race_results"\)/);
  assert.doesNotMatch(body, /.from("race_entries")/);
});

test("pin: rytter fra et hold der ikke staar i startfeltet er ikke bundet paa loebsdagen og traener normalt", async () => {
  const tables = {
    race_entry_days: [
      { rider_id: "rider-1", race_id: "race-a", season_id: "s1", game_day: 4 },
      { rider_id: "rider-2", race_id: "race-a", season_id: "s1", game_day: 4 },
    ],
    // Startfeltet blev laast uden dette holds ryttere (holdet var under gulvet).
    race_simulation_runs: [{ race_id: "race-a", stage_number: 1, entrant_snapshot: ["other-team-rider"] }],
  };
  const supabase = {
    from(table) {
      const state = { inList: null, filters: [] };
      const api = {
        select() { return api; },
        eq(col, val) { state.filters.push([col, val]); return api; },
        in(col, vals) { state.inList = [col, vals]; return api; },
        then(resolve) {
          let rows = tables[table] ?? [];
          rows = rows.filter((r) => state.filters.every(([c, v]) => r[c] === v));
          if (state.inList) rows = rows.filter((r) => state.inList[1].includes(r[state.inList[0]]));
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return api;
    },
  };
  const out = await loadBoundRiderIdsForRaceDay({ supabase, riderIds: ["rider-1", "rider-2"], seasonId: "s1", gameDay: 4 });
  assert.equal(out.error, null);
  assert.equal(out.data.size, 0);
});
