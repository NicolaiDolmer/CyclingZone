import test from "node:test";
import assert from "node:assert/strict";
import { raceConditionLoads, stageCaughtBreakaway, loadSeasonRaceDaysByRider, stageConditionWork } from "./raceFatigue.js";
import { stageLoadV2, CONDITION_V2_CONFIG } from "./conditionModelV2.js";

test("#6984: raceConditionLoads uden conditionV2 er uændret", () => {
  const before = raceConditionLoads(["a", "b"], "mountain", null, "s5_profiles_v1", { stageNumber: 5 });
  const same = raceConditionLoads(["a", "b"], "mountain", null, "s5_profiles_v1", { stageNumber: 5 }, null);
  assert.deepEqual(same, before);
});

test("#6984: raceConditionLoads med conditionV2 bruger v2-belastningen for alle revisioner", () => {
  const conditionV2 = { distanceKm: 200, seasonRaceDaysByRider: new Map([["a", 40]]) };
  for (const revision of ["legacy", "official_times_v3", "s5_profiles_v1"]) {
    const [a, b] = raceConditionLoads(["a", "b"], "mountain", null, revision, { stageNumber: 3 }, conditionV2);
    assert.equal(a.load, stageLoadV2({ profileType: "mountain", distanceKm: 200, stageNumber: 3, seasonRaceDays: 41, rulesRevision: revision }));
    assert.equal(b.load, stageLoadV2({ profileType: "mountain", distanceKm: 200, stageNumber: 3, seasonRaceDays: 1, rulesRevision: revision }));
    assert.ok(a.load > b.load, "sæsonbelastning");
  }
});

test("#6984: hentet udbrud koster et tillæg; et udbrud der kommer hjem gør ikke", () => {
  const work = { stageNumber: 1, exposure: new Map([["a", { front: 0.6, shelter: 0 }], ["b", { front: 0.6, shelter: 0 }]]), caught: new Set(["a"]) };
  const [a, b] = raceConditionLoads(["a", "b"], "flat", null, "s5_profiles_v1", work, { distanceKm: 180, seasonRaceDaysByRider: new Map() });
  assert.ok(a.load > b.load);
  assert.equal(b.load, CONDITION_V2_CONFIG.profileLoad.flat * (1 + CONDITION_V2_CONFIG.frontWork * 0.6));
});

test("#6984: stageCaughtBreakaway følger motorens deltagelseshistorik (ikke sidste snapshot)", () => {
  const out = {
    results: [{ rider_id: "a" }, { rider_id: "b" }, { rider_id: "c" }, { rider_id: "d" }, { rider_id: "p" }],
    timeline: { events: [
      { km: 0, type: "stage_start", params: { distance_km: 180 } },
      { km: 10, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["a", "b"] } },
      { km: 150, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["a", "b"], chase_group_id: "peloton-0", chase_group_kind: "peloton" } },
      { km: 180, type: "finish", params: { top: [{ rider_id: "p", rank: 1 }] } },
    ] },
    // Sidste snapshot efter finalen: alle i "peloton"-placeringsgrupper; må ikke afgøre noget.
    groupSnapshots: [{ km: 180, groups: [{ kind: "peloton", rider_ids: ["a", "b", "c", "d", "p"] }] }],
  };
  assert.deepEqual([...stageCaughtBreakaway(out, "flat")].sort(), ["a", "b"]);
  const home = {
    results: [{ rider_id: "c" }, { rider_id: "d" }, { rider_id: "p" }],
    timeline: { events: [
      { km: 10, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["c", "d"] } },
      { km: 180, type: "breakaway_survived", params: { group_id: "breakaway-0", rider_ids: ["c", "d"], gap_seconds: 20 } },
      { km: 180, type: "finish", params: { top: [{ rider_id: "c", rank: 1 }] } },
    ] },
    groupSnapshots: [{ km: 180, groups: [{ kind: "peloton", rider_ids: ["c", "d"] }, { kind: "peloton", rider_ids: ["p"] }] }],
  };
  assert.equal(stageCaughtBreakaway(home, "flat").size, 0, "et udbrud der holdt hjem er ikke hentet, selv i peloton-placeringsgrupper");
  assert.equal(stageCaughtBreakaway(out, "itt").size, 0);
  assert.equal(stageCaughtBreakaway({ groupSnapshots: out.groupSnapshots }, "flat").size, 0, "uden tidslinje: ingen markering");
  const work = stageConditionWork({ rulesRevision: "s5_profiles_v1", stageNumber: 2, profileType: "flat", v4Result: { v4Output: out, efforts: new Map() } });
  assert.ok(work.caught.has("a"));
});

test("#6984: loadSeasonRaceDaysByRider tæller distinkte løbsdage og springer etapen selv over", async () => {
  const rows = [
    { rider_id: "a", game_day: 1, race_id: "r1", stage_number: 1 },
    { rider_id: "a", game_day: 2, race_id: "r1", stage_number: 2 },
    { rider_id: "a", game_day: 2, race_id: "r1", stage_number: 2 },
    { rider_id: "a", game_day: 9, race_id: "r2", stage_number: 1 },
    { rider_id: "b", game_day: 3, race_id: "r3", stage_number: 1 },
  ];
  const calls = [];
  const supabase = { from(table) { calls.push(table); const q = { _ids: null,
    select() { return q; }, eq(c, v) { assert.equal(c, "season_id"); assert.equal(v, "s5"); return q; },
    in(_c, ids) { q._ids = ids; return q; }, is(c, v) { assert.equal(c, "duplicate_of_race_id"); assert.equal(v, null); return q; },
    order() { return q; }, async range(from) { return { data: from === 0 ? rows.filter((r) => q._ids.includes(r.rider_id)) : [], error: null }; } }; return q; } };
  const days = await loadSeasonRaceDaysByRider({ supabase, seasonId: "s5", riderIds: ["a", "b", "c"], excludeRaceId: "r2", excludeStageNumber: 1 });
  assert.deepEqual(Object.fromEntries(days), { a: 2, b: 1, c: 0 });
  assert.deepEqual(calls, ["training_race_loads"]);
  assert.deepEqual(Object.fromEntries(await loadSeasonRaceDaysByRider({ supabase, seasonId: null, riderIds: ["a"] })), { a: 0 });
});

test("#6984 B2: applySameDateEnteringFatigueV2 lægger datoens tidligere etaper oven i åbningen", async () => {
  const { applySameDateEnteringFatigueV2 } = await import("./raceFatigue.js");
  const { enteringFatigueV2 } = await import("./conditionModelV2.js");
  const filters = [];
  const supabase = { from(table) {
    const q = { select() { return q; }, eq(c, v) { filters.push([table, "eq", c, v]); return q; }, in() { return q; },
      lt(c, v) { filters.push([table, "lt", c, v]); return q; }, is() { return q; }, order() { return q; },
      async maybeSingle() { return { data: { game_day: 12, scheduled_at: "2026-11-01T14:00:00Z" }, error: null }; },
      then(resolve) { resolve({ data: [{ rider_id: "a", game_day: 10, load: 20 }, { rider_id: "a", game_day: 11, load: 15 }], error: null }); } };
    return q; } };
  const entrants = [{ rider_id: "a", fatigue: 30, abilities: { recovery: 60 } }, { rider_id: "b", fatigue: 30 }, { rider_id: "c" }];
  const raised = await applySameDateEnteringFatigueV2({ supabase, raceId: "r", stageNumber: 3, entrants });
  assert.equal(raised, 1);
  assert.equal(entrants[0].fatigue, enteringFatigueV2({ openingFatigue: 30, priorLoadsToday: [20, 15], recoveryAbility: 60 }));
  assert.equal(entrants[1].fatigue, 30);
  assert.equal(entrants[2].fatigue, undefined);
  assert.ok(filters.some(([t, op, c, v]) => t === "training_race_loads" && op === "eq" && c === "tick_date" && v === "2026-11-01"));
  assert.ok(filters.some(([t, op, c, v]) => t === "training_race_loads" && op === "lt" && c === "game_day" && v === 12));
});
