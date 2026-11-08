// #7890 (generalproeve foer Tour de l'Hexagone): tidsgraense-varslet (#7715) skal regne paa
// traetheden ved etapens start, som motoren goer (applyStageStartFatigue), ikke paa
// morgenens tal. Ellers kan en rytter ryge ud af traethed paa dagens sidste etape uden varsel.
// Syntetiske scenarier, ingen kalibrerede balancevaerdier.
import { test } from "node:test";
import assert from "node:assert/strict";

import { enteringFatigueV2, stageLoadV2 } from "./conditionModelV2.js";
import {
  loadStageStartFatigues7715, loadTodayStageLoads7715, stageStartFatigues7715, timeLimitRiskByRider7715,
} from "./timeLimitFatigue7715.js";
import { RACE_7715, entrants7715, stages7715, tiredRiderIds7715 } from "./__fixtures__/raceRunner7715Scenarios.js";

const REV = "s5_profiles_v3";
// Tre etaper i tredje uge: 15 og 16 samme dato (10:00 og 16:00 dansk tid), 17 dagen efter.
const STAGES = [
  { stage_number: 15, profile_type: "high_mountain", distance_km: 170 },
  { stage_number: 16, profile_type: "high_mountain", distance_km: 165 },
  { stage_number: 17, profile_type: "high_mountain", distance_km: 175 },
];
const SCHEDULE = [
  { stage_number: 15, scheduled_at: "2026-11-13T09:00:00Z", game_day: 80 },
  { stage_number: 16, scheduled_at: "2026-11-13T15:00:00Z", game_day: 82 },
  { stage_number: 17, scheduled_at: "2026-11-14T09:00:00Z", game_day: 84 },
];
const RIDER = { rider_id: "r1", fatigue: 70, abilities: { recovery: 40 } };

test("#7890 foerste etape paa datoen: aabningen, uaendret", () => {
  const out = stageStartFatigues7715({ riders: [RIDER], stages: STAGES, schedule: SCHEDULE, todayStr: "2026-11-13", revision: REV });
  assert.equal(out.get(15).get("r1"), 70);
  assert.equal(out.get(17).get("r1"), 70, "ny dato starter fra aabningen");
});

test("#7890 senere etape samme dato: aabningen plus prognosen for den tidligere etape, som motoren", () => {
  const out = stageStartFatigues7715({ riders: [RIDER], stages: STAGES, schedule: SCHEDULE, todayStr: "2026-11-13", revision: REV });
  const load = stageLoadV2({ profileType: "high_mountain", distanceKm: 170, stageNumber: 15, effort: "normal", rulesRevision: REV });
  assert.equal(out.get(16).get("r1"), enteringFatigueV2({ openingFatigue: 70, priorLoadsToday: [load], recoveryAbility: 40 }));
  assert.ok(out.get(16).get("r1") > 70, "dagens foerste etape goer ham traettere");
});

test("#7890 en koert etape i dag taeller med sin registrerede belastning, kun dens egen loebsdag", () => {
  const recorded = new Map([["r1", [{ game_day: 80, load: 22 }, { game_day: 79, load: 99 }]]]);
  const out = stageStartFatigues7715({ riders: [RIDER], stages: STAGES, schedule: SCHEDULE, stagesCompleted: 15, todayStr: "2026-11-13", recordedLoadsByRider: recorded, revision: REV });
  assert.equal(out.has(15), false, "koerte etaper faar intet varsel");
  assert.equal(out.get(16).get("r1"), enteringFatigueV2({ openingFatigue: 70, priorLoadsToday: [22], recoveryAbility: 40 }));
});

test("#7890 registrerede belastninger fra en anden dato bruges ikke", () => {
  const recorded = new Map([["r1", [{ game_day: 80, load: 22 }]]]);
  const out = stageStartFatigues7715({ riders: [RIDER], stages: STAGES, schedule: SCHEDULE, stagesCompleted: 15, todayStr: "2026-11-12", recordedLoadsByRider: recorded, revision: REV });
  assert.equal(out.get(16).get("r1"), enteringFatigueV2({ openingFatigue: 70, priorLoadsToday: [0], recoveryAbility: 40 }));
});

test("#7890 holdets indsats styrer prognosen", () => {
  const normal = stageStartFatigues7715({ riders: [RIDER], stages: STAGES, schedule: SCHEDULE, todayStr: "2026-11-13", revision: REV }).get(16).get("r1");
  const allOut = stageStartFatigues7715({ riders: [RIDER], stages: STAGES, schedule: SCHEDULE, todayStr: "2026-11-13", revision: REV, effortFor: () => "all_out" }).get(16).get("r1");
  const easy = stageStartFatigues7715({ riders: [RIDER], stages: STAGES, schedule: SCHEDULE, todayStr: "2026-11-13", revision: REV, effortFor: () => "grupetto" }).get(16).get("r1");
  assert.ok(allOut >= normal && normal >= easy, `${allOut} >= ${normal} >= ${easy}`);
});

test("#7890 uden plan for etapen, eller uden traethed: aabningen eller intet tal", () => {
  const out = stageStartFatigues7715({ riders: [RIDER, { rider_id: "r2", fatigue: null }], stages: STAGES, schedule: [], todayStr: "2026-11-13", revision: REV });
  assert.equal(out.get(16).get("r1"), 70);
  assert.equal(out.get(16).has("r2"), false);
});

test("#7890 varslet bruger traetheden ved start, og en rytter uden skoen beholder sin egen", () => {
  const race = { ...RACE_7715, stages_completed: 0, engine_rules_revision: REV };
  const riders = entrants7715();
  const stages = stages7715();
  const base = timeLimitRiskByRider7715({ riders, stages, race });
  const tired = tiredRiderIds7715().find((id) => base[id]);
  assert.ok(tired, "scenariet skal ramme");
  const rested = new Map(stages.map((s) => [s.stage_number, new Map([[tired, 0]])]));
  const withStart = timeLimitRiskByRider7715({ riders, stages, race, fatigueAtStage: rested });
  assert.equal(withStart[tired], undefined, "udhvilet ved start = intet varsel");
  for (const id of Object.keys(base)) if (id !== tired) assert.deepEqual(withStart[id], base[id]);
  assert.deepEqual(timeLimitRiskByRider7715({ riders, stages, race, fatigueAtStage: null }), base, "uden skoen: som foer");
});

test("#7890 varslet fanger en rytter, der foerst bliver for traet efter dagens foerste etape", () => {
  const race = { ...RACE_7715, stages_completed: 0, engine_rules_revision: REV };
  const stages = stages7715();
  const mountain = stages.find((s) => s.profile_type !== "flat");
  const riders = entrants7715().filter((e) => tiredRiderIds7715().includes(e.rider_id)).map((e) => ({ ...e, fatigue: 0 }));
  assert.deepEqual(timeLimitRiskByRider7715({ riders, stages: [mountain], race }), {}, "udhvilet om morgenen: intet varsel");
  const tiredAtStart = new Map([[mountain.stage_number, new Map(riders.map((r) => [r.rider_id, 95]))]]);
  const risk = timeLimitRiskByRider7715({ riders, stages: [mountain], race, fatigueAtStage: tiredAtStart });
  assert.ok(Object.keys(risk).length > 0, "udkoert ved etapens start: varsel");
});

function stub({ conditionV2 = "on", scheduleError = null, orders = [], loads = [], loadsError = null, throwOn = null } = {}) {
  const calls = [];
  const chain = (table, result) => {
    const c = {
      select: () => c, eq: (col, v) => { calls.push([table, col, v]); return c; }, in: () => c, is: () => c, order: () => c,
      maybeSingle: async () => result(),
      then: (resolve) => resolve(result()),
    };
    return c;
  };
  return {
    calls,
    from(table) {
      if (throwOn === table) throw new Error("boom");
      if (table === "app_config") return chain(table, () => ({ data: conditionV2 == null ? null : { value: conditionV2 }, error: null }));
      if (table === "race_stage_schedule") return chain(table, () => (scheduleError ? { data: null, error: scheduleError } : { data: SCHEDULE, error: null }));
      if (table === "race_team_orders") return chain(table, () => ({ data: orders, error: null }));
      if (table === "training_race_loads") return chain(table, () => (loadsError ? { data: null, error: loadsError } : { data: loads, error: null }));
      throw new Error(`uventet tabel ${table}`);
    },
  };
}

const RACE = { id: "race-x", stages_completed: 0, engine_rules_revision: REV };
const NOW = new Date("2026-11-13T08:00:00Z");

test("#7890 loadStageStartFatigues7715: kun under condition_model_v2", async () => {
  const off = await loadStageStartFatigues7715({ supabase: stub(), race: RACE, riders: [RIDER], stages: STAGES, now: NOW, checkConditionV2: async () => false });
  assert.equal(off, null);
  const on = await loadStageStartFatigues7715({ supabase: stub(), race: RACE, riders: [RIDER], stages: STAGES, now: NOW, checkConditionV2: async () => true });
  assert.ok(on.get(16).get("r1") > 70);
});

test("#7890 loadStageStartFatigues7715: holdets gemte indsats bruges, og fejl = null (aldrig en vaeltet flade)", async () => {
  const orders = [{ stage_number: 15, riders: [{ rider_id: "r1", effort: "grupetto" }] }];
  const s = stub({ orders });
  const withOrder = await loadStageStartFatigues7715({ supabase: s, race: RACE, teamId: "t1", riders: [RIDER], stages: STAGES, now: NOW, checkConditionV2: async () => true });
  const normal = await loadStageStartFatigues7715({ supabase: stub(), race: RACE, teamId: "t1", riders: [RIDER], stages: STAGES, now: NOW, checkConditionV2: async () => true });
  assert.ok(withOrder.get(16).get("r1") <= normal.get(16).get("r1"));
  assert.ok(s.calls.some(([t, c, v]) => t === "race_team_orders" && c === "team_id" && v === "t1"));
  assert.equal(await loadStageStartFatigues7715({ supabase: stub({ scheduleError: { message: "x" } }), race: RACE, riders: [RIDER], stages: STAGES, now: NOW, checkConditionV2: async () => true }), null);
  assert.equal(await loadStageStartFatigues7715({ supabase: stub({ throwOn: "race_stage_schedule" }), race: RACE, riders: [RIDER], stages: STAGES, now: NOW, checkConditionV2: async () => true }), null);
});

test("#7890 loadStageStartFatigues7715: et startet loeb laeser datoens registrerede belastninger", async () => {
  const s = stub({ loads: [{ rider_id: "r1", game_day: 80, load: 30 }] });
  const out = await loadStageStartFatigues7715({ supabase: s, race: { ...RACE, stages_completed: 15 }, riders: [RIDER], stages: STAGES, now: new Date("2026-11-13T12:00:00Z"), checkConditionV2: async () => true });
  assert.equal(out.get(16).get("r1"), enteringFatigueV2({ openingFatigue: 70, priorLoadsToday: [30], recoveryAbility: 40 }));
  assert.ok(s.calls.some(([t, c, v]) => t === "training_race_loads" && c === "tick_date" && v === "2026-11-13"));
});

test("#7890 loadTodayStageLoads7715: fejl = tomt, aldrig en undtagelse", async () => {
  assert.equal((await loadTodayStageLoads7715({ supabase: stub({ loadsError: { message: "x" } }), riderIds: ["r1"], todayStr: "2026-11-13" })).size, 0);
  assert.equal((await loadTodayStageLoads7715({ supabase: stub({ throwOn: "training_race_loads" }), riderIds: ["r1"], todayStr: "2026-11-13" })).size, 0);
});
