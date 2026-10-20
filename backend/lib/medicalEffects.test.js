import test from "node:test";
import assert from "node:assert/strict";
import {
  medicalBonus, medicalRecoveryMultiplier, medicalDisplayBonus, medicalTrainingInjuryRisk, medicalInjuryDays,
  applyMedicalToRaceIncidents, applyMedicalToStageOutputs, doctorAssessment, assessmentLevels, doctorSeasonAdvice,
} from "./medicalEffects.js";
import { recoveryV2, settleTrainingDateConditionV2 } from "./conditionModelV2.js";
import { isTrackEffectLive } from "./facilityConstants.js";
import { resolveTrackLiveFlags, displayTrackBonus } from "./facilityRoutesHandlers.js";

test("medicin: ingen afdeling = ingen effekt; bedre afdeling og chef = mere", () => {
  assert.equal(medicalBonus(0, { overall: 99 }), 0);
  const t1 = medicalBonus(1, null), t5 = medicalBonus(5, null), t5top = medicalBonus(5, { overall: 99 });
  assert.ok(t1 > 0 && t5 > t1 && t5top > t5);
  assert.ok(t5top <= 1);
});

test("M1: forstærker rytterens recovery-evne; en god restituerer får mest, gulvet røres ikke", () => {
  const b = medicalBonus(5, { overall: 99 });
  assert.equal(medicalRecoveryMultiplier(0), 1);
  const gain = (rec) => recoveryV2({ fatigue: 60, recoveryAbility: rec, medicalBonus: b }) - recoveryV2({ fatigue: 60, recoveryAbility: rec });
  assert.ok(gain(90) > gain(50) && gain(50) > gain(10), "mere til den gode restituerer");
  assert.ok(Math.abs(gain(0)) < 1e-9, "uden evne ingen effekt (gulvet uændret)");
  // Samme som at give rytteren evne × (1 + visningstal).
  const asAbility = recoveryV2({ fatigue: 60, recoveryAbility: 50 * (1 + medicalDisplayBonus(b)) });
  assert.ok(Math.abs(recoveryV2({ fatigue: 60, recoveryAbility: 50, medicalBonus: b }) - asAbility) < 1e-9);
  assert.equal(displayTrackBonus("medical", 5, { overall: 99 }), medicalDisplayBonus(b));
});

test("M2 + M3 i træning: lavere risiko, kortere skade, mindst én dag", () => {
  assert.equal(medicalTrainingInjuryRisk(0.1, 0), 0.1);
  assert.ok(medicalTrainingInjuryRisk(0.1, 0.3) < 0.1);
  assert.equal(medicalInjuryDays(5, 0), 5);
  assert.ok(medicalInjuryDays(5, 0.3) < 5);
  assert.equal(medicalInjuryDays(1, 0.33), 1);
  const args = { riderId: "r", dateStr: "2026-10-26", condition: { fatigue: 90, form: 60 }, intensities: Array(5).fill("hard"), raceLoads: [0, 0, 0, 0, 0], recoveryAbility: 50 };
  const without = settleTrainingDateConditionV2(args);
  const withMed = settleTrainingDateConditionV2({ ...args, medicalBonus: 0.3 });
  assert.ok(withMed.risk < without.risk);
  assert.ok(withMed.fatigue <= without.fatigue);
});

test("M2 + M3 i løb: skade undgås deterministisk eller forkortes; andre hændelser urørt", () => {
  const incidents = Array.from({ length: 200 }, (_, i) => ({ rider_id: `r${i}`, stage_number: 3, kind: "crash", outcome: "abandon", injury_days: 4 }));
  incidents.push({ rider_id: "m", stage_number: 3, kind: "mechanical", outcome: "time_loss", injury_days: null });
  const bonus = new Map(incidents.map((i) => [i.rider_id, 0.33]));
  const out = applyMedicalToRaceIncidents(incidents, bonus, { raceId: "race" });
  const again = applyMedicalToRaceIncidents(incidents, bonus, { raceId: "race" });
  assert.deepEqual(out, again, "seedet = deterministisk");
  const avoided = out.filter((i) => i.kind === "crash" && i.injury_days == null).length;
  assert.ok(avoided > 10 && avoided < 60, `undgået ${avoided}/200`);
  assert.ok(out.filter((i) => i.injury_days > 0).every((i) => i.injury_days < 4));
  assert.equal(out.at(-1), incidents.at(-1));
  assert.equal(incidents[0].injury_days, 4, "input muteres ikke");
  const none = applyMedicalToRaceIncidents(incidents, new Map(), { raceId: "race" });
  assert.deepEqual(none, incidents);
});

test("M2 + M3: hændelser og løbsfilmens tidslinje får samme skadelængde", () => {
  const incidents = [{ rider_id: "a", stage_number: 2, kind: "crash", outcome: "abandon", injury_days: 10 }, { rider_id: "b", stage_number: 2, kind: "crash", outcome: "abandon", injury_days: 10 }];
  const timelines = [{ stage_number: 2, events: [
    { km: 40, type: "incident", params: { rider_id: "a", kind: "crash", outcome: "abandon", injury_days: 10 } },
    { km: 41, type: "incident", params: { rider_id: "b", kind: "crash", outcome: "abandon", injury_days: 10 } },
    { km: 50, type: "attack", params: { rider_id: "a" } },
  ] }];
  const bonus = new Map([["a", 0.33], ["b", 0]]);
  const out = applyMedicalToStageOutputs({ incidents, timelines, bonusByRider: bonus, raceId: "race" });
  const evA = out.timelines[0].events[0].params.injury_days;
  assert.equal(evA, out.incidents[0].injury_days, "rytter a: tidslinje = hændelse");
  assert.equal(out.timelines[0].events[1].params.injury_days, 10, "rytter b uden afdeling uændret");
  assert.equal(out.timelines[0].events[2], timelines[0].events[2]);
  assert.equal(out.incidents[0].outcome, "abandon", "udfaldet bevares");
  assert.equal(timelines[0].events[0].params.injury_days, 10, "input muteres ikke");
});

test("M4: flere vurderings-trin med højere niveau; ord-nøgler", () => {
  assert.equal(assessmentLevels(0), 2);
  assert.equal(assessmentLevels(3), 3);
  assert.equal(assessmentLevels(5), 4);
  assert.equal(doctorAssessment({ fatigue: 30, tier: 0 }), "ready");
  assert.equal(doctorAssessment({ fatigue: 80, tier: 0 }), "tired");
  assert.equal(doctorAssessment({ fatigue: 30, tier: 3 }), "fresh");
  assert.equal(doctorAssessment({ fatigue: 60, tier: 5 }), "tired");
  assert.equal(doctorAssessment({ fatigue: 80, tier: 5 }), "rest");
  assert.equal(doctorAssessment({ fatigue: 10, injured: true, tier: 5 }), "injured");
  assert.equal(doctorAssessment({ fatigue: null, tier: 5 }), null);
});

test("M8: sæsonråd før en Grand Tour", () => {
  const season = { seasonFreeDays: 20, seasonCapDays: 55 };
  assert.equal(doctorSeasonAdvice({ fatigue: 20, seasonRaceDays: 10, plannedRaceDaysToLastGt: 20, tier: 3 }, season), "ready");
  assert.equal(doctorSeasonAdvice({ fatigue: 20, seasonRaceDays: 30, plannedRaceDaysToLastGt: 30, tier: 3 }, season), "ready_but_spent_later");
  assert.equal(doctorSeasonAdvice({ fatigue: 20, seasonRaceDays: 60, plannedRaceDaysToLastGt: 0, tier: 3 }, season), "already_heavy");
  assert.equal(doctorSeasonAdvice({ fatigue: 75, seasonRaceDays: 5, plannedRaceDaysToLastGt: 0, tier: 3 }, season), "rest_first");
  assert.equal(doctorSeasonAdvice({ fatigue: 5, injured: true, seasonRaceDays: 5, plannedRaceDaysToLastGt: 0 }, season), "injured");
});

test("medicin-sporet er live præcis når condition_model_v2 er on; læsefejl = slukket", async () => {
  assert.equal(isTrackEffectLive("medical"), false);
  assert.equal(isTrackEffectLive("medical", { conditionModelV2: true }), true);
  assert.equal(isTrackEffectLive("training", { conditionModelV2: false }), true);
  assert.deepEqual(await resolveTrackLiveFlags({ academyIntakePullEnabled: false, conditionModelV2: true }), { academyIntakePullEnabled: false, conditionModelV2: true });
  const failing = { from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null, error: { message: "offline" } }; } }; } };
  const flags = await resolveTrackLiveFlags({ academyIntakePullEnabled: false }, failing);
  assert.equal(flags.conditionModelV2, false);
});

test("medicin-sporet kan hverken købes eller bemandes, når flaget er off", async () => {
  const { postFacilityUpgradeHandler, getStaffCandidatesHandler, postStaffHireHandler } = await import("./facilityRoutesHandlers.js");
  const off = { academyIntakePullEnabled: false, conditionModelV2: false, facilitiesEnabled: true };
  const never = () => { throw new Error("må ikke kaldes"); };
  assert.equal((await postFacilityUpgradeHandler({ teamId: "t", track: "medical" }, null, { flags: off, purchaseFacilityUpgrade: never })).status, 403);
  assert.equal((await getStaffCandidatesHandler({ teamId: "t", role: "medical" }, null, { flags: off })).status, 403);
  assert.equal((await postStaffHireHandler({ teamId: "t", role: "medical", candidateName: "x" }, null, { flags: off, hireStaff: never })).status, 403);
  const on = { ...off, conditionModelV2: true };
  const res = await postFacilityUpgradeHandler({ teamId: "t", track: "medical" }, null, { flags: on, purchaseFacilityUpgrade: async () => ({ ok: true }) });
  assert.equal(res.status, 200);
  const training = await postFacilityUpgradeHandler({ teamId: "t", track: "training" }, null, { flags: off, purchaseFacilityUpgrade: async () => ({ ok: true }) });
  assert.equal(training.status, 200, "andre spor uændret");
});
