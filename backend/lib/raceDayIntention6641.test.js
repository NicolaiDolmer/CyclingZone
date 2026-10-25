// #6641 + #6940: gruppettoens traethed pr. etapetype (KUN s5_profiles_v3) og
// loebsdagens intention som udbytte-modifikator (variant B, bag flaget).
import { test } from "node:test";
import assert from "node:assert/strict";

import { effortFatigueMultiplier, GRUPETTO_FATIGUE_BY_PROFILE_6940, RACE_V3_TUNING } from "./raceRoles.js";
import { isS5ProfilesV3OrLater, RACE_RULES_REVISIONS } from "./raceEngineRulesRevision.ts";
import { loadRaceDayEffortByRider, raceDayEffortByRider, raceDayIntentionYieldMultiplier } from "./raceDayIntentionYield.js";

const PROFILES = ["flat", "rolling", "hilly", "classic", "cobbles", "gravel", "medium_mountain", "mountain", "high_mountain", "itt", null, "unknown"];

test("#6940: alle revisioner foer s5_profiles_v3 beholder den faste grupetto-traethed (bit-identisk)", () => {
  for (const rulesRevision of [...RACE_RULES_REVISIONS.filter((r) => !isS5ProfilesV3OrLater(r)), null]) {
    for (const profileType of PROFILES) {
      assert.equal(effortFatigueMultiplier("grupetto", { profileType, rulesRevision }), RACE_V3_TUNING.FATIGUE_MULTIPLIER_GRUPETTO, `${rulesRevision}/${profileType}`);
    }
  }
});

test("#6940: under s5_profiles_v3 sparer grupettoen mindst paa fladt og mest i bjergene", () => {
  const m = (profileType) => effortFatigueMultiplier("grupetto", { profileType, rulesRevision: "s5_profiles_v3" });
  assert.ok(m("flat") > m("hilly"), "fladt sparer mindre end kuperet");
  assert.ok(m("hilly") > m("mountain"), "kuperet sparer mindre end bjerg");
  assert.ok(m("rolling") >= m("hilly"));
  assert.equal(m("mountain"), m("high_mountain"));
  assert.equal(m("unknown"), RACE_V3_TUNING.FATIGUE_MULTIPLIER_GRUPETTO, "ukendt profil: den faste vaerdi");
  assert.ok(Object.isFrozen(GRUPETTO_FATIGUE_BY_PROFILE_6940));
});

test("#6940: trappen vendes aldrig — grupetto <= save < normal paa hver profil under s5_profiles_v3", () => {
  for (const profileType of PROFILES) {
    const ctx = { profileType, rulesRevision: "s5_profiles_v3" };
    const g = effortFatigueMultiplier("grupetto", ctx);
    const s = effortFatigueMultiplier("save", ctx);
    assert.ok(g <= s, `${profileType}: grupetto ${g} > save ${s}`);
    assert.ok(s < effortFatigueMultiplier("normal", ctx), profileType);
    assert.ok(g > 0, profileType);
  }
});

test("#6641 variant B: udbytte-multiplikatoren foelger trappen, og intet valg giver 1,0", () => {
  const order = ["grupetto", "save", "normal", "protect", "all_out"].map(raceDayIntentionYieldMultiplier);
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1]);
  assert.equal(raceDayIntentionYieldMultiplier("normal"), 1);
  for (const none of [null, undefined, "", "bogus"]) assert.equal(raceDayIntentionYieldMultiplier(none), 1, String(none));
});

test("#6641 variant B: kun raekken for den etape rytteren koerte i dag taeller", () => {
  const stageByRider = new Map([
    ["r1", { raceId: "A", stageNumber: 3 }],
    ["r2", { raceId: "A", stageNumber: 3 }],
    ["r3", { raceId: "B", stageNumber: 1 }],
  ]);
  const rows = [
    { race_id: "A", stage_number: 3, rider_id: "r1", effort: "all_out" },
    { race_id: "A", stage_number: 2, rider_id: "r2", effort: "grupetto" }, // gaarsdagens etape
    { race_id: "B", stage_number: 1, rider_id: "r3", effort: null },
    { race_id: "A", stage_number: 3, rider_id: "rX", effort: "save" }, // koerte ikke i dag
  ];
  const out = raceDayEffortByRider(stageByRider, rows);
  assert.deepEqual([...out.entries()], [["r1", "all_out"]]);
});

function fakeSupabase(result) {
  const calls = [];
  const builder = {
    select(cols) { calls.push(["select", cols]); return builder; },
    in(col, vals) { calls.push(["in", col, vals]); return builder; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return { calls, from(table) { calls.push(["from", table]); return builder; } };
}

test("#6641 variant B: opslaget laeser race_stage_roles for dagens loeb og ryttere", async () => {
  const supabase = fakeSupabase({ data: [{ race_id: "A", stage_number: 3, rider_id: "r1", effort: "protect" }], error: null });
  const out = await loadRaceDayEffortByRider({ supabase, stageByRider: new Map([["r1", { raceId: "A", stageNumber: 3 }]]) });
  assert.equal(out.get("r1"), "protect");
  assert.deepEqual(supabase.calls[0], ["from", "race_stage_roles"]);
});

test("#6641 variant B: fejl i opslaget og ingen loebsdag giver et tomt kort (= variant A)", async () => {
  const original = console.warn;
  console.warn = () => {};
  try {
    const failing = fakeSupabase({ data: null, error: { message: "boom" } });
    assert.equal((await loadRaceDayEffortByRider({ supabase: failing, stageByRider: new Map([["r1", { raceId: "A", stageNumber: 1 }]]) })).size, 0);
  } finally {
    console.warn = original;
  }
  const untouched = fakeSupabase({ data: [], error: null });
  assert.equal((await loadRaceDayEffortByRider({ supabase: untouched, stageByRider: new Map() })).size, 0);
  assert.equal(untouched.calls.length, 0, "ingen query uden loebsdag");
});
