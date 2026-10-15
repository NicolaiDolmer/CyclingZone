// #5928 (ejer 15/10): GT-traethed hober sig op over hele loebet, og reelt arbejde koster.
// Kun under s5_profiles_v1; alle andre revisioner er bit-identiske med foer.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GT_FATIGUE_TUNING,
  attachConditionWork,
  conditionWorkForRun,
  raceConditionLoads,
  raceFatigueLoad,
  s5RaceFatigueLoad,
  stageAccumulationMultiplier,
  stageConditionWork,
  stageRaceConditionLoad,
  stageWorkExposure,
  workExposureMultiplier,
} from "./raceFatigue.js";
import { effortFatigueMultiplier } from "./raceRoles.js";
import { settleTrainingDateCondition } from "./trainingDateCondition.js";

const S5 = "s5_profiles_v1";
const loadOf = (rows, id) => rows.find((r) => r.rider_id === id).load;

test("#5928: alle revisioner foer S5 er uaendrede, ogsaa naar arbejdet sendes med", () => {
  const efforts = new Map([["a", "protect"]]);
  const work = { stageNumber: 17, efforts: new Map([["a", "all_out"]]), exposure: new Map([["a", { front: 1, shelter: 0 }]]) };
  for (const rev of [null, "legacy", "orders_gc_v2", "official_times_v3", "official_times_v4"]) {
    assert.deepEqual(
      raceConditionLoads(["a", "b"], "mountain", efforts, rev, work),
      raceConditionLoads(["a", "b"], "mountain", efforts, rev),
      `revision ${rev} skal ignorere arbejdet`,
    );
  }
  assert.equal(loadOf(raceConditionLoads(["a"], "mountain", null, "official_times_v4", work), "a"), raceFatigueLoad("mountain"));
});

test("#5928: S5's nye profiler faar en rigtig belastning (mellembjerg mellem kuperet og bjerg)", () => {
  assert.ok(s5RaceFatigueLoad("medium_mountain") > raceFatigueLoad("hilly"));
  assert.ok(s5RaceFatigueLoad("medium_mountain") < raceFatigueLoad("mountain"));
  assert.ok(s5RaceFatigueLoad("gravel") > raceFatigueLoad("rolling"));
  for (const p of ["flat", "mountain", "high_mountain", "itt"]) assert.equal(s5RaceFatigueLoad(p), raceFatigueLoad(p));
});

test("#5928: etapens plads i loebet - etape 1 uaendret, aldrig faldende, med loft", () => {
  assert.equal(stageAccumulationMultiplier(1), 1);
  let prev = 0;
  for (let n = 1; n <= 30; n++) {
    const m = stageAccumulationMultiplier(n);
    assert.ok(m >= prev, `etape ${n} maa ikke koste mindre end etape ${n - 1}`);
    prev = m;
  }
  const cap = 1 + GT_FATIGUE_TUNING.accumulationPerStage * GT_FATIGUE_TUNING.accumulationCapStages;
  assert.equal(stageAccumulationMultiplier(GT_FATIGUE_TUNING.accumulationCapStages + 1), cap);
  assert.equal(stageAccumulationMultiplier(99), cap);
  // En GT's sidste uge koster markant mere end den foerste; et kort etapeloeb mærker det knap.
  assert.ok(stageAccumulationMultiplier(17) > 1.5 * stageAccumulationMultiplier(1));
  assert.ok(stageAccumulationMultiplier(3) < 1.2);
  assert.equal(stageAccumulationMultiplier(undefined), 1);
  assert.equal(stageAccumulationMultiplier(0), 1);
});

test("#5928: arbejde - front koster mere end feltet, grupettoen mindre, enkeltstart er ens", () => {
  const field = workExposureMultiplier(null, { profileType: "mountain" });
  const front = workExposureMultiplier({ front: 0.8, shelter: 0 }, { profileType: "mountain" });
  const grupetto = workExposureMultiplier({ front: 0, shelter: 0.8 }, { profileType: "mountain" });
  assert.equal(field, 1);
  assert.ok(front > field && grupetto < field);
  assert.ok(workExposureMultiplier({ front: 1, shelter: 0 }) <= GT_FATIGUE_TUNING.workFactorMax);
  assert.ok(workExposureMultiplier({ front: 0, shelter: 1 }) >= GT_FATIGUE_TUNING.workFactorMin);
  for (const tt of ["itt", "itt_hilly", "ttt"]) assert.equal(workExposureMultiplier({ front: 1, shelter: 0 }, { profileType: tt }), 1);
  // Korrupte andele er neutrale, aldrig NaN.
  assert.equal(workExposureMultiplier({ front: NaN, shelter: "x" }, { profileType: "flat" }), 1);
});

test("#5928: en hjaelper der arbejder belastes mere end en der spares, paa samme etape", () => {
  const base = { profileType: "mountain", stageNumber: 12, rulesRevision: S5 };
  const working = stageRaceConditionLoad({ ...base, effort: "protect", exposure: { front: 0.4, shelter: 0 } });
  const normal = stageRaceConditionLoad({ ...base, effort: "normal" });
  const spared = stageRaceConditionLoad({ ...base, effort: "grupetto", exposure: { front: 0, shelter: 0.7 } });
  assert.ok(working > normal && normal > spared, `${working} > ${normal} > ${spared}`);
  // Enkeltstart: alle koerer alene og fuldt ud; hverken indsats eller gruppe flytter belastningen.
  const tt = { profileType: "itt", stageNumber: 12, rulesRevision: S5 };
  assert.equal(stageRaceConditionLoad({ ...tt, effort: "grupetto", exposure: { front: 1, shelter: 0 } }), stageRaceConditionLoad({ ...tt }));
});

test("#5928: raceConditionLoads under S5 = stageRaceConditionLoad; motorens indsats vinder over etape-ordren", () => {
  const work = { stageNumber: 9, efforts: new Map([["a", "protect"]]), exposure: new Map([["b", { front: 0.5, shelter: 0 }]]) };
  const rows = raceConditionLoads(["a", "b", "c", "a"], "high_mountain", new Map([["a", "save"], ["c", "save"]]), S5, work);
  assert.deepEqual(rows.map((r) => r.rider_id), ["a", "b", "c"], "unikke ryttere, samme raekkefoelge");
  assert.equal(loadOf(rows, "a"), stageRaceConditionLoad({ profileType: "high_mountain", stageNumber: 9, effort: "protect", rulesRevision: S5 }));
  assert.equal(loadOf(rows, "b"), stageRaceConditionLoad({ profileType: "high_mountain", stageNumber: 9, exposure: { front: 0.5, shelter: 0 }, rulesRevision: S5 }));
  // Ingen motor-indsats for c: etape-ordren (save) bruges som foer.
  assert.equal(loadOf(rows, "c"), raceFatigueLoad("high_mountain") * effortFatigueMultiplier("save", { profileType: "high_mountain", rulesRevision: S5 }) * stageAccumulationMultiplier(9));
  // Uden arbejde: etape 1 og normal indsats = profilens belastning.
  assert.equal(loadOf(raceConditionLoads(["z"], "mountain", null, S5), "z"), raceFatigueLoad("mountain"));
});

test("#5928: stageWorkExposure maaler km-vaegtede andele fra motorens gruppe-snapshots", () => {
  const v4Output = {
    groupSnapshots: [
      { km: 100, groups: [{ kind: "breakaway", rider_ids: ["a"] }, { kind: "peloton", rider_ids: ["b", "c"] }] },
      { km: 150, groups: [{ kind: "chase", rider_ids: ["a"] }, { kind: "peloton", rider_ids: ["b"] }, { kind: "gruppetto", rider_ids: ["c"] }] },
      { km: 200, groups: [{ kind: "peloton", rider_ids: ["a", "b"] }, { kind: "gruppetto", rider_ids: ["c"] }] },
    ],
  };
  const ex = stageWorkExposure(v4Output, "mountain");
  assert.deepEqual(ex.get("a"), { front: 0.75, shelter: 0 });
  assert.deepEqual(ex.get("c"), { front: 0, shelter: 0.5 });
  assert.equal(ex.has("b"), false, "kun feltet: intet tillaeg");
  assert.equal(stageWorkExposure(v4Output, "itt").size, 0);
  assert.equal(stageWorkExposure({}, "flat").size, 0);
  assert.equal(stageWorkExposure(null, "flat").size, 0);
});

test("#5928: stageConditionWork kun under S5; arbejdet haeftes usynligt paa run'et", () => {
  const v4Result = { v4Output: { groupSnapshots: [{ km: 10, groups: [{ kind: "solo", rider_ids: ["a"] }] }] }, efforts: new Map([["a", "all_out"]]) };
  assert.equal(stageConditionWork({ rulesRevision: "official_times_v4", stageNumber: 3, profileType: "flat", v4Result }), null);
  assert.equal(stageConditionWork({ rulesRevision: S5, stageNumber: 3, profileType: "flat", v4Result: null }), null);
  const work = stageConditionWork({ rulesRevision: S5, stageNumber: 3, profileType: "flat", v4Result });
  assert.equal(work.stageNumber, 3);
  assert.equal(work.efforts.get("a"), "all_out");
  assert.deepEqual(work.exposure.get("a"), { front: 1, shelter: 0 });

  const run = { stage_number: 3, entrant_snapshot: ["a"] };
  const plain = { ...run };
  attachConditionWork(run, work);
  assert.deepEqual(run, plain, "run-formen er uaendret (persistering og determinisme-tests)");
  assert.equal(Object.keys(run).includes("conditionWork"), false);
  assert.equal(conditionWorkForRun(run), work);
  assert.deepEqual(conditionWorkForRun({ stage_number: 7 }), { stageNumber: 7 });
  assert.equal(attachConditionWork(plain, null), plain);
  assert.equal("conditionWork" in plain, false);
});

/**
 * En GT som prod afregner den: 17 etaper paa 6 datoer, traetheden laeses ved datoens start
 * og afregnes EEN gang pr. dato med de 5 loebsdages samlede belastning (en etape = en plads,
 * resten normal traening).
 */
function simulateGt({ rulesRevision, effort = "normal", exposure = null, start = 15 }) {
  const days = [
    ["itt", "flat"], ["flat", "hilly", "flat"], ["mountain", "rolling", "hilly"],
    ["high_mountain", "mountain", "flat"], ["mountain", "high_mountain", "hilly"], ["high_mountain", "flat", "mountain"],
  ];
  let condition = { fatigue: start, form: 50 };
  let stage = 0;
  const closing = [];
  for (const [d, profiles] of days.entries()) {
    const loads = profiles.map((p) => {
      stage += 1;
      const work = { stageNumber: stage, efforts: new Map([["r", effort]]), exposure: exposure ? new Map([["r", exposure]]) : new Map() };
      return raceConditionLoads(["r"], p, null, rulesRevision, work)[0].load;
    });
    const intensities = Array.from({ length: 5 }, (_, i) => (i < loads.length ? "race" : "normal"));
    const raceLoads = Array.from({ length: 5 }, (_, i) => loads[i] ?? 0);
    const res = settleTrainingDateCondition({ riderId: "r", dateStr: `2026-10-0${d + 1}`, condition, intensities, raceLoads });
    condition = { fatigue: res.fatigue, form: res.form };
    closing.push(res.fatigue);
  }
  return closing;
}

test("#5928: uge 3 er tydeligt haardere under S5; S4-revisionen giver praecis de samme tal som i dag", () => {
  const today = simulateGt({ rulesRevision: "official_times_v4" });
  const gt = simulateGt({ rulesRevision: S5 });
  const week = (xs, w) => (xs[2 * w - 2] + xs[2 * w - 1]) / 2;
  assert.ok(week(gt, 3) > week(today, 3) + 10, `uge 3: ${week(gt, 3)} mod i dag ${week(today, 3)}`);
  assert.ok(week(gt, 3) - week(gt, 1) > week(today, 3) - week(today, 1), "traetheden stiger mere gennem loebet");
  for (let i = 1; i < gt.length; i++) assert.ok(gt[i] >= gt[i - 1], "traetheden hober sig op dato for dato");
  // Ugen foer: foerste dato er naesten uaendret (etape 1-2 koster som foer).
  assert.ok(gt[0] - today[0] <= 1);
  // S4-loeb: belastningen er profilens, uanset arbejdet.
  assert.deepEqual(simulateGt({ rulesRevision: "official_times_v4", effort: "protect", exposure: { front: 1, shelter: 0 } }), today);
});

test("#5928: hjaelperen der arbejder ender GT'en mere traet end den der spares", () => {
  const working = simulateGt({ rulesRevision: S5, effort: "protect", exposure: { front: 0.3, shelter: 0 } });
  const spared = simulateGt({ rulesRevision: S5, effort: "grupetto", exposure: { front: 0, shelter: 0.5 } });
  assert.ok(working.at(-1) > spared.at(-1) + 10, `arbejder ${working.at(-1)} mod sparet ${spared.at(-1)}`);
});
