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

test("#6984: stageCaughtBreakaway finder front-ryttere der ikke er i front ved sidste snapshot", () => {
  const out = { groupSnapshots: [
    { km: 50, groups: [{ kind: "breakaway", rider_ids: ["a", "b"] }, { kind: "peloton", rider_ids: ["c"] }] },
    { km: 150, groups: [{ kind: "breakaway", rider_ids: ["b"] }, { kind: "peloton", rider_ids: ["a", "c"] }] },
    { km: 180, groups: [{ kind: "solo", rider_ids: ["b"] }, { kind: "peloton", rider_ids: ["a", "c"] }] },
  ] };
  assert.deepEqual([...stageCaughtBreakaway(out, "flat")], ["a"]);
  assert.equal(stageCaughtBreakaway(out, "itt").size, 0);
  assert.equal(stageCaughtBreakaway(null, "flat").size, 0);
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
