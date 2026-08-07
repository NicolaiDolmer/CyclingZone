import test from "node:test";
import assert from "node:assert/strict";
import { computeRacingTodayByRider, loadRacingTodayByRider } from "./racingTodayLookup.js";

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

function fakeSupabase({ entries, sched, races, entryError, schedError, raceError } = {}) {
  return {
    from(table) {
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
    entries: [{ race_id: "race-a", rider_id: "rider-1" }],
    sched: [{ race_id: "race-a" }],
    races: [{ id: "race-a", name: "Tour de Zone" }],
  });
  const out = await loadRacingTodayByRider(supabase, "team-1", ["rider-1", "rider-2"], new Date("2026-08-10T10:00:00Z"));
  assert.deepEqual(out, { "rider-1": { race: "Tour de Zone" } });
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
