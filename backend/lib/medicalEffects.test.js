import test from "node:test";
import assert from "node:assert/strict";
import {
  medicalBonus, medicalRecoveryMultiplier, medicalDisplayBonus, medicalTrainingInjuryRisk, medicalInjuryDays,
  applyMedicalToRaceIncidents, applyMedicalToRaceIncidentsForRace, doctorAssessment, assessmentLevels, doctorSeasonAdvice,
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

test("M1: restitutionen vokser med bonus, og klubben viser samme tal", () => {
  const b = medicalBonus(5, { overall: 99 });
  assert.equal(medicalRecoveryMultiplier(0), 1);
  const plain = recoveryV2({ fatigue: 60, recoveryAbility: 50 });
  const med = recoveryV2({ fatigue: 60, recoveryAbility: 50, medicalBonus: b });
  assert.ok(Math.abs(med / plain - (1 + medicalDisplayBonus(b))) < 1e-9);
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

test("M2 + M3 i løb: IO henter hold fra startfeltet og bonus pr. hold", async () => {
  const supabase = { from(table) {
    const q = { _t: table, _eq: {}, select() { return q; }, eq(c, v) { q._eq[c] = v; return q; }, in() { return q; },
      then(resolve) {
        if (table === "race_entries") return resolve({ data: [{ rider_id: "a", team_id: "T1" }, { rider_id: "b", team_id: "T0" }], error: null });
        if (table === "team_facilities") return resolve({ data: q._eq.team_id === "T1" ? [{ track: "medical", tier: 5 }] : [], error: null });
        return resolve({ data: [], error: null });
      } };
    return q; } };
  const incidents = [{ rider_id: "a", stage_number: 1, injury_days: 10 }, { rider_id: "b", stage_number: 1, injury_days: 10 }];
  const out = await applyMedicalToRaceIncidentsForRace({ supabase, raceId: "race", incidents });
  assert.equal(out[1].injury_days, 10, "hold uden afdeling uændret");
  assert.ok(out[0].injury_days == null || out[0].injury_days < 10);
  assert.equal(await applyMedicalToRaceIncidentsForRace({ supabase, raceId: "race", incidents: [{ rider_id: "a", injury_days: null }] }).then((x) => x[0].injury_days), null);
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
