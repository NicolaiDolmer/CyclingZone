// #7890 (generalproeve foer Tour de l'Hexagone): tidsgraense-varslet (#7715) skal regne paa
// traetheden ved etapens start, som motoren goer (applyStageStartFatigue), ikke paa
// morgenens tal. Ellers kan en rytter ryge ud af traethed paa dagens sidste etape uden varsel.
// Syntetiske scenarier, ingen kalibrerede balancevaerdier.
import { test } from "node:test";
import assert from "node:assert/strict";

import { enteringFatigueV2, stageLoadV2 } from "./conditionModelV2.js";
import { riderFatigueAtStageStart } from "./riderFatigueNow.js";
import {
  loadDateStageLoads7715, loadStageStartFatigues7715, stageStartFatigues7715, timeLimitRiskByRider7715,
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
const DATE = "2026-11-13";
const RIDER = { rider_id: "r1", fatigue: 70, abilities: { recovery: 40 } };
const forecast15 = (extra = {}) => stageLoadV2({ profileType: "high_mountain", distanceKm: 170, stageNumber: 15, effort: "normal", seasonRaceDays: 1, rulesRevision: REV, ...extra });
const run = (args = {}) => stageStartFatigues7715({ riders: [RIDER], stages: STAGES, schedule: SCHEDULE, revision: REV, ...args });

test("#7890 foerste etape paa datoen og ny dato: aabningen, uaendret", () => {
  const out = run();
  assert.equal(out.get(15).get("r1"), 70);
  assert.equal(out.get(17).get("r1"), 70);
});

test("#7890 senere etape samme dato: aabningen plus prognosen for den tidligere etape, som motoren", () => {
  const out = run();
  assert.equal(out.get(16).get("r1"), enteringFatigueV2({ openingFatigue: 70, priorLoadsToday: [forecast15()], recoveryAbility: 40 }));
  assert.ok(out.get(16).get("r1") > 70, "dagens foerste etape goer ham traettere i tredje uge");
});

test("#7890 en koert etape taeller med de registrerede raekker, praecis som motorens kerne", () => {
  const rows = [{ game_day: 80, load: 22 }, { game_day: 79, load: 5 }, { game_day: 83, load: 99 }];
  const out = run({ stagesCompleted: 15, recordedLoadsByDate: new Map([[DATE, new Map([["r1", rows]])]]) });
  assert.equal(out.has(15), false, "koerte etaper faar intet varsel");
  // Motoren: alle datoens raekker foer etapens loebsdag, én pr. raekke, i loebsdags-orden.
  const engine = riderFatigueAtStageStart({ openingFatigue: 70, loadsBeforeStage: [5, 22], recoveryAbility: 40 });
  assert.equal(out.get(16).get("r1"), engine);
});

test("#7890 en koert etape uden raekker for rytteren: aabningen, som motoren (ingen ekstra restitution)", () => {
  const out = run({ stagesCompleted: 15, recordedLoadsByDate: new Map([[DATE, new Map()]]) });
  assert.equal(out.get(16).get("r1"), 70);
  assert.equal(riderFatigueAtStageStart({ openingFatigue: 70, loadsBeforeStage: [], recoveryAbility: 40 }), 70);
});

test("#7890 ukendte raekker for datoen (opslaget fejlede): den koerte etape faar en prognose", () => {
  const out = run({ stagesCompleted: 15 });
  assert.equal(out.get(16).get("r1"), enteringFatigueV2({ openingFatigue: 70, priorLoadsToday: [forecast15()], recoveryAbility: 40 }));
});

test("#7890 prognosen bruger saesonens loebsdage som motoren", () => {
  const fresh = run().get(16).get("r1");
  const late = run({ seasonRaceDaysByRider: new Map([["r1", 60]]) }).get(16).get("r1");
  assert.equal(late, enteringFatigueV2({ openingFatigue: 70, priorLoadsToday: [forecast15({ seasonRaceDays: 61 })], recoveryAbility: 40 }));
  assert.ok(late >= fresh);
});

test("#7890 holdets indsats styrer prognosen", () => {
  const normal = run().get(16).get("r1");
  const allOut = run({ effortFor: () => "all_out" }).get(16).get("r1");
  const easy = run({ effortFor: () => "grupetto" }).get(16).get("r1");
  assert.ok(allOut >= normal && normal >= easy, `${allOut} >= ${normal} >= ${easy}`);
});

test("#7890 uden plan for etapen, eller uden traethed: aabningen eller intet tal", () => {
  const out = stageStartFatigues7715({ riders: [RIDER, { rider_id: "r2", fatigue: null }], stages: STAGES, schedule: [], revision: REV });
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
  const mountain = stages7715().find((s) => s.profile_type !== "flat");
  const riders = entrants7715().filter((e) => tiredRiderIds7715().includes(e.rider_id)).map((e) => ({ ...e, fatigue: 0 }));
  assert.deepEqual(timeLimitRiskByRider7715({ riders, stages: [mountain], race }), {}, "udhvilet om morgenen: intet varsel");
  const tiredAtStart = new Map([[mountain.stage_number, new Map(riders.map((r) => [r.rider_id, 95]))]]);
  assert.ok(Object.keys(timeLimitRiskByRider7715({ riders, stages: [mountain], race, fatigueAtStage: tiredAtStart })).length > 0);
});

function stub({ scheduleError = null, orders = [], loads = [], loadsError = null, throwOn = null } = {}) {
  const calls = [];
  const chain = (table, result) => {
    const c = {
      select: () => c, eq: (col, v) => { calls.push([table, col, v]); return c; }, in: () => c, is: () => c, order: () => c,
      then: (resolve) => resolve(result()),
    };
    return c;
  };
  return {
    calls,
    from(table) {
      if (throwOn === table) throw new Error("boom");
      if (table === "race_stage_schedule") return chain(table, () => (scheduleError ? { data: null, error: scheduleError } : { data: SCHEDULE, error: null }));
      if (table === "race_team_orders") return chain(table, () => ({ data: orders, error: null }));
      if (table === "training_race_loads") return chain(table, () => (loadsError ? { data: null, error: loadsError } : { data: loads, error: null }));
      throw new Error(`uventet tabel ${table}`);
    },
  };
}

const RACE = { id: "race-x", season_id: "s1", stages_completed: 0, engine_rules_revision: REV };
const V2 = { checkConditionV2: async () => true, loadInstant: async () => new Map(), loadSeasonRaceDays: async () => new Map() };

test("#7890 loadStageStartFatigues7715: kun under condition_model_v2", async () => {
  assert.equal(await loadStageStartFatigues7715({ supabase: stub(), race: RACE, riders: [RIDER], stages: STAGES, ...V2, checkConditionV2: async () => false }), null);
  const on = await loadStageStartFatigues7715({ supabase: stub(), race: RACE, riders: [RIDER], stages: STAGES, ...V2 });
  assert.ok(on.get(16).get("r1") > 70);
});

test("#7890 loadStageStartFatigues7715: holdets gemte indsats bruges, og fejl = null (aldrig en vaeltet flade)", async () => {
  const s = stub({ orders: [{ stage_number: 15, riders: [{ rider_id: "r1", effort: "grupetto" }] }] });
  const withOrder = await loadStageStartFatigues7715({ supabase: s, race: RACE, teamId: "t1", riders: [RIDER], stages: STAGES, ...V2 });
  const normal = await loadStageStartFatigues7715({ supabase: stub(), race: RACE, teamId: "t1", riders: [RIDER], stages: STAGES, ...V2 });
  assert.ok(withOrder.get(16).get("r1") <= normal.get(16).get("r1"));
  assert.ok(s.calls.some(([t, c, v]) => t === "race_team_orders" && c === "team_id" && v === "t1"));
  assert.equal(await loadStageStartFatigues7715({ supabase: stub({ scheduleError: { message: "x" } }), race: RACE, riders: [RIDER], stages: STAGES, ...V2 }), null);
  assert.equal(await loadStageStartFatigues7715({ supabase: stub({ throwOn: "race_stage_schedule" }), race: RACE, riders: [RIDER], stages: STAGES, ...V2 }), null);
});

test("#7890 loadStageStartFatigues7715: et startet loeb laeser den koerte etapes dato, ogsaa efter midnat", async () => {
  const s = stub({ loads: [{ rider_id: "r1", game_day: 80, load: 30 }] });
  const out = await loadStageStartFatigues7715({ supabase: s, race: { ...RACE, stages_completed: 15 }, riders: [RIDER], stages: STAGES, ...V2 });
  assert.equal(out.get(16).get("r1"), enteringFatigueV2({ openingFatigue: 70, priorLoadsToday: [30], recoveryAbility: 40 }));
  assert.ok(s.calls.some(([t, c, v]) => t === "training_race_loads" && c === "tick_date" && v === DATE), "etapens egen dato, ikke vaegurets");
});

test("#7890 loadStageStartFatigues7715: fejl i raekkerne = prognose for den koerte etape, ikke en restitution", async () => {
  const out = await loadStageStartFatigues7715({ supabase: stub({ loadsError: { message: "x" } }), race: { ...RACE, stages_completed: 15 }, riders: [RIDER], stages: STAGES, ...V2 });
  assert.equal(out.get(16).get("r1"), enteringFatigueV2({ openingFatigue: 70, priorLoadsToday: [forecast15()], recoveryAbility: 40 }));
});

test("#7890 loadStageStartFatigues7715: saesonens loebsdage hentes og bruges; fejl = som saesonens foerste dag", async () => {
  const late = await loadStageStartFatigues7715({ supabase: stub(), race: RACE, riders: [RIDER], stages: STAGES, checkConditionV2: async () => true, loadInstant: async () => new Map(), loadSeasonRaceDays: async () => new Map([["r1", 60]]) });
  assert.equal(late.get(16).get("r1"), enteringFatigueV2({ openingFatigue: 70, priorLoadsToday: [forecast15({ seasonRaceDays: 61 })], recoveryAbility: 40 }));
  const failed = await loadStageStartFatigues7715({ supabase: stub(), race: RACE, riders: [RIDER], stages: STAGES, checkConditionV2: async () => true, loadInstant: async () => new Map(), loadSeasonRaceDays: async () => { throw new Error("x"); } });
  assert.equal(failed.get(16).get("r1"), enteringFatigueV2({ openingFatigue: 70, priorLoadsToday: [forecast15()], recoveryAbility: 40 }));
});

test("#7890 loadStageStartFatigues7715: saesonens ledger laeses kun, naar en etape faar en prognose", async () => {
  let calls = 0;
  const count = async () => { calls += 1; return new Map(); };
  // Etape 15 koert og dens raekker kendt; 16 har kun den koerte etape foran sig; 17 er alene paa sin dato.
  await loadStageStartFatigues7715({ supabase: stub({ loads: [] }), race: { ...RACE, stages_completed: 15 }, riders: [RIDER], stages: STAGES, checkConditionV2: async () => true, loadInstant: async () => new Map(), loadSeasonRaceDays: count });
  assert.equal(calls, 0);
  await loadStageStartFatigues7715({ supabase: stub(), race: RACE, riders: [RIDER], stages: STAGES, checkConditionV2: async () => true, loadInstant: async () => new Map(), loadSeasonRaceDays: count });
  assert.equal(calls, 1, "etape 16 faar en prognose for etape 15");
});

test("#7890 loadDateStageLoads7715: fejl = null (ukendt), aldrig en undtagelse", async () => {
  assert.equal(await loadDateStageLoads7715({ supabase: stub({ loadsError: { message: "x" } }), riderIds: ["r1"], tickDate: DATE }), null);
  assert.equal(await loadDateStageLoads7715({ supabase: stub({ throwOn: "training_race_loads" }), riderIds: ["r1"], tickDate: DATE }), null);
  const ok = await loadDateStageLoads7715({ supabase: stub({ loads: [{ rider_id: "r1", game_day: 80, load: 3 }] }), riderIds: ["r1"], tickDate: DATE });
  assert.deepEqual(ok.get("r1"), [{ game_day: 80, load: 3 }]);
});

test("#7737 foer taending: en stemplet rytter faar motorens rekonstruktion, og koerte etaper laegges ikke oveni igen", () => {
  const recorded = new Map([[DATE, new Map([["r1", [{ game_day: 80, load: 30 }]]])]]);
  // Etape 15 er koert; etape 16 samme dato. Rekonstruktionen (52) indeholder allerede etape 15.
  const stamped = run({ stagesCompleted: 15, recordedLoadsByDate: recorded, instantByStage: new Map([[16, new Map([["r1", 52]])]]) });
  assert.equal(stamped.get(16).get("r1"), 52);
  // Uden stempel: uaendret adfaerd (aabningen plus den registrerede belastning).
  const legacy = run({ stagesCompleted: 15, recordedLoadsByDate: recorded });
  assert.equal(legacy.get(16).get("r1"), enteringFatigueV2({ openingFatigue: 70, priorLoadsToday: [30], recoveryAbility: 40 }));
  // Etape 17 (ny dato, intet stempel der) er urørt.
  assert.equal(stamped.get(17).get("r1"), 70);
});

test("#7737 foer taending: loaderen henter rekonstruktionen pr. kommende etape med etapens dato og loebsdag", async () => {
  const asked = [];
  const loadInstant = async ({ tickDate, beforeGameDay, failOpenWhenOff }) => {
    asked.push([tickDate, beforeGameDay, failOpenWhenOff]);
    return beforeGameDay === 82 ? new Map([["r1", { fatigue: 52, form: 60 }]]) : new Map();
  };
  const out = await loadStageStartFatigues7715({ supabase: stub(), race: RACE, riders: [RIDER], stages: STAGES, ...V2, loadInstant });
  // Etape 15 er ikke koert endnu: rekonstruktionen (52) plus prognosen for etape 15, som motoren.
  assert.equal(out.get(16).get("r1"), enteringFatigueV2({ openingFatigue: 52, priorLoadsToday: [forecast15()], recoveryAbility: 40 }));
  assert.deepEqual(asked, [[DATE, 80, true], [DATE, 82, true], ["2026-11-14", 84, true]]);
});
