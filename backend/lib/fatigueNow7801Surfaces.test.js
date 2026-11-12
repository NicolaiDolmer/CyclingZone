// #7801: Udtagelsen, Holdfanen og rytterkortet viser trætheden lige nu bag fatigue_now_7801.
//
// Slukket = bit-identisk med merge-basen, bevist mod en FROSSET digest
// (__fixtures__/fatigueNow7801SurfacesOffBase.json, genereret i et separat checkout af basen
// før fladerne blev rørt). Den genereres aldrig med den nye kode.
// Tændt = samme kerne som Træningssiden (riderFatigueNow), ikke en ny beregning.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getSelectionContext, nextStageForFatigue7801, ridersAtOpeningFatigue, surfaceFatigueNow7801 } from "./raceSelection.js";
import { getStageRolesContext } from "./raceStageRolesApi.js";
import { riderCardFatigueNow7801 } from "./riderCardFatigueNow7801.js";
import { riderFatigueNow } from "./riderFatigueNow.js";
import { buildScenario, FIXED_NOW, surfaceOffDigests, tableFake } from "./__fixtures__/fatigueNow7801SurfacesOffScenarios.js";

const BASE = JSON.parse(readFileSync(new URL("./__fixtures__/fatigueNow7801SurfacesOffBase.json", import.meta.url), "utf8"));

const ON_CONFIG = [
  { key: "fatigue_now_7801", value: "on" },
  { key: "condition_model_v2", value: "on" },
  { key: "training_condition_per_date", value: "on" },
  { key: "training_tick_per_race_day", value: "on" },
];
const withConfig = (state, config) => ({ ...state, app_config: config });

/** Første scenarie med et løb i gang, ryttere med belastninger i dag og en etape tilbage. */
function liveScenario() {
  for (let seed = 1; seed <= 400; seed++) {
    const s = buildScenario(seed);
    const { race, state } = s;
    const loaded = new Set(state.training_race_loads.map((l) => l.rider_id));
    const withCond = state.rider_condition.filter((c) => loaded.has(c.rider_id));
    if (race.stages_completed >= 1 && race.stages_completed < race.stages && withCond.length >= 2) return s;
  }
  throw new Error("no live scenario");
}

/** Forventet tal direkte fra kernen: åbningen plus datoens kørte etaper før næste etape. */
function expectedLive({ state, race }) {
  const nextGameDay = state.race_stage_schedule.find((s) => s.stage_number === race.stages_completed + 1).game_day;
  const recovery = new Map(state.rider_derived_abilities.map((a) => [a.rider_id, a.recovery]));
  return new Map(state.rider_condition.map((c) => {
    const loads = state.training_race_loads.filter((l) => l.rider_id === c.rider_id && l.game_day < nextGameDay)
      .sort((a, b) => a.game_day - b.game_day).map((l) => l.load);
    return [c.rider_id, riderFatigueNow({ openingFatigue: c.fatigue, dateLoads: loads, recoveryAbility: recovery.get(c.rider_id) })];
  }));
}

test("#7801 slukket: Udtagelse og Holdfane er bit-identiske med merge-basen (frossen digest)", async () => {
  const now = await surfaceOffDigests();
  assert.equal(now.length, BASE.digests.length);
  assert.deepEqual(now, BASE.digests);
});

test("#7801 slukket: intet ud over kontakten læses for trætheden", async () => {
  const { state, race, teamId } = liveScenario();
  const reads = [];
  const live = await surfaceFatigueNow7801({
    supabase: tableFake(withConfig(state, [{ key: "fatigue_now_7801", value: "beta" }]), { reads }),
    race, stages: state.race_stage_profiles, conditions: state.rider_condition, teamId, now: FIXED_NOW,
  });
  assert.equal(live, null);
  assert.deepEqual(reads, ["app_config"]);
});

test("#7801 tændt: Udtagelsen viser kernens tal lige nu; lægen får stadig morgenens tal", async () => {
  const s = liveScenario();
  const expected = expectedLive(s);
  const opening = new Map(s.state.rider_condition.map((c) => [c.rider_id, c.fatigue]));
  const ctx = await getSelectionContext({ supabase: tableFake(withConfig(s.state, ON_CONFIG)), race: s.race, teamId: s.teamId, now: FIXED_NOW });
  let changed = 0;
  for (const row of ctx.riders) {
    if (!opening.has(row.id)) { assert.equal(row.fatigue, null); continue; }
    assert.equal(row.fatigue, expected.get(row.id), row.id);
    if (row.fatigue !== opening.get(row.id)) changed++;
  }
  assert.ok(changed > 0, "scenariet skal have ryttere med kørte etaper i dag");
  for (const row of ridersAtOpeningFatigue(ctx)) {
    assert.equal(row.fatigue, opening.has(row.id) ? opening.get(row.id) : null);
  }
  assert.equal(JSON.stringify(ctx).includes("openingFatigueByRider"), false, "svaret ændrer ikke form");
});

test("#7801 slukket: ridersAtOpeningFatigue er præcis ctx.riders", async () => {
  const s = liveScenario();
  const ctx = await getSelectionContext({ supabase: tableFake(withConfig(s.state, [])), race: s.race, teamId: s.teamId, now: FIXED_NOW });
  assert.equal(ridersAtOpeningFatigue(ctx), ctx.riders);
});

test("#7801 tændt: Holdfanen viser samme tal som Udtagelsen", async () => {
  const s = liveScenario();
  const expected = expectedLive(s);
  const ctx = await getStageRolesContext({ supabase: tableFake(withConfig(s.state, ON_CONFIG)), race: s.race, teamId: s.teamId, now: FIXED_NOW });
  assert.ok(ctx.riders.length > 0);
  for (const row of ctx.riders) {
    assert.equal(row.fatigue, expected.has(row.rider_id) ? expected.get(row.rider_id) : null, row.rider_id);
  }
});

test("#7801 tændt: løb i morgen viser tallet nu (med dagens etaper), ikke morgenens", async () => {
  const today = "2026-06-15";
  const state = {
    app_config: ON_CONFIG,
    rider_condition: [{ rider_id: "a", form: 50, fatigue: 50 }],
    rider_derived_abilities: [{ rider_id: "a", recovery: 60 }],
    race_stage_schedule: [{ race_id: "tomorrow", stage_number: 1, game_day: 101, scheduled_at: "2026-06-16T09:00:00Z" }],
    training_race_loads: [{ rider_id: "a", game_day: 100, tick_date: today, load: 30, consumed_at: null, duplicate_of_race_id: null }],
  };
  const live = await surfaceFatigueNow7801({
    supabase: tableFake(state), race: { id: "tomorrow", stages: 1, stages_completed: 0 }, stages: [{ stage_number: 1 }],
    conditions: state.rider_condition, teamId: "t1", now: FIXED_NOW,
  });
  const expected = riderFatigueNow({ openingFatigue: 50, dateLoads: [30], recoveryAbility: 60 });
  assert.notEqual(expected, 50);
  assert.equal(live.get("a"), expected);
});

test("#7801 tændt: kan tallet ikke regnes, viser fladen intet tal frem for morgenens", async () => {
  const s = liveScenario();
  const fake = tableFake(withConfig(s.state, ON_CONFIG));
  const failing = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (resolve) => resolve({ data: null, error: { message: "boom" } });
      if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: { message: "boom" } });
      return () => failing;
    },
  });
  const supabase = { from: (table) => (table === "race_stage_schedule" ? failing : fake.from(table)) };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const live = await surfaceFatigueNow7801({ supabase, race: s.race, stages: s.state.race_stage_profiles, conditions: s.state.rider_condition, teamId: s.teamId, now: FIXED_NOW });
    assert.equal(live.size, 0);
  } finally {
    console.warn = warn;
  }
});

test("#7801 nextStageForFatigue7801: første etape før start, ellers næste ikke-kørte, null efter sidste", () => {
  const stages = [{ stage_number: 1 }, { stage_number: 2 }, { stage_number: 3 }];
  assert.equal(nextStageForFatigue7801({ race: { stages: 3, stages_completed: 0 }, stages }), 1);
  assert.equal(nextStageForFatigue7801({ race: { stages: 3, stages_completed: 1 }, stages }), 2);
  assert.equal(nextStageForFatigue7801({ race: { stages: 3, stages_completed: 3 }, stages }), null);
  // Uden profiler: løbets etapeantal afgør.
  assert.equal(nextStageForFatigue7801({ race: { stages: 3, stages_completed: 2 }, stages: [] }), 3);
  assert.equal(nextStageForFatigue7801({ race: { stages: 1, stages_completed: 0 }, stages: [] }), 1);
});

test("#7801 rytterkortet: slukket læser kun kontakten", async () => {
  const reads = [];
  const out = await riderCardFatigueNow7801({ supabase: tableFake({ app_config: [] }, { reads }), riderId: "a", teamId: "t1", now: FIXED_NOW });
  assert.deepEqual(out, { enabled: false });
  assert.deepEqual(reads, ["app_config"]);
  assert.deepEqual(await riderCardFatigueNow7801({ supabase: tableFake({}), riderId: "a", teamId: null }), { enabled: false });
});

test("#7801 rytterkortet: tændt giver Træningssidens tal for egen rytter, intet for andres", async () => {
  const today = "2026-06-15";
  const state = {
    app_config: ON_CONFIG,
    riders: [{ id: "a", team_id: "t1" }, { id: "b", team_id: "t2" }],
    rider_condition: [{ rider_id: "a", form: 50, fatigue: 40 }, { rider_id: "b", form: 50, fatigue: 40 }],
    rider_derived_abilities: [{ rider_id: "a", recovery: 55 }],
    training_race_loads: [{ rider_id: "a", game_day: 100, tick_date: today, load: 25, consumed_at: null, duplicate_of_race_id: null }],
  };
  const own = await riderCardFatigueNow7801({ supabase: tableFake(state), riderId: "a", teamId: "t1", now: FIXED_NOW });
  assert.deepEqual(own, { enabled: true, own: true, fatigue: riderFatigueNow({ openingFatigue: 40, dateLoads: [25], recoveryAbility: 55 }) });
  assert.notEqual(own.fatigue, 40);
  const other = await riderCardFatigueNow7801({ supabase: tableFake(state), riderId: "b", teamId: "t1", now: FIXED_NOW });
  assert.deepEqual(other, { enabled: true, own: false, fatigue: null });
});
