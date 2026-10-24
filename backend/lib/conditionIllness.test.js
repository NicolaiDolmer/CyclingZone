// #6938 sygdom af langvarig ekstrem traethed: kontrakter (ingen kalibrerede tal i assertions).
import test from "node:test";
import assert from "node:assert/strict";
import { assessIllness, extremeFatigueStreak, ILLNESS_CONFIG as C, illnessRisk, rollIllness } from "./conditionIllness.js";

const hi = C.extremeFatigue + 5;

test("stimen taeller kun dage i traek over taersklen, nyeste foerst", () => {
  assert.deepEqual(extremeFatigueStreak([hi, hi, C.extremeFatigue - 1, hi]).days, 2);
  assert.equal(extremeFatigueStreak([C.extremeFatigue - 1, hi, hi]).days, 0, "i dag under taersklen = ingen stime");
  assert.equal(extremeFatigueStreak([]).days, 0);
  assert.equal(extremeFatigueStreak([hi, null, hi]).days, 1, "manglende dag bryder stimen");
});

test("ingen risiko under minimumsstimen; risikoen stiger med laengde og grad og har et loft", () => {
  assert.equal(illnessRisk({ streakDays: C.minStreakDays - 1, meanFatigue: 100 }), 0);
  const a = illnessRisk({ streakDays: C.minStreakDays, meanFatigue: C.extremeFatigue });
  const longer = illnessRisk({ streakDays: C.minStreakDays + 2, meanFatigue: C.extremeFatigue });
  const harder = illnessRisk({ streakDays: C.minStreakDays, meanFatigue: 100 });
  assert.ok(a > 0 && longer > a && harder > a);
  assert.ok(illnessRisk({ streakDays: 60, meanFatigue: 100 }) <= C.maxRisk);
});

test("den medicinske afdeling saenker risikoen, aldrig under 0", () => {
  const base = illnessRisk({ streakDays: C.minStreakDays + 1, meanFatigue: 95 });
  const med = illnessRisk({ streakDays: C.minStreakDays + 1, meanFatigue: 95, medicalBonus: 1 });
  assert.ok(med < base && med >= 0);
  assert.equal(illnessRisk({ streakDays: C.minStreakDays + 1, meanFatigue: 95, medicalBonus: 5 }), med, "bonus er loftet til 1");
});

test("rullet er seedet pr. rytter og dato, og varigheden ligger i spaendet", () => {
  assert.deepEqual(rollIllness({ riderId: "r", dateStr: "2026-11-01", risk: 1 }), rollIllness({ riderId: "r", dateStr: "2026-11-01", risk: 1 }));
  assert.equal(rollIllness({ riderId: "r", dateStr: "2026-11-01", risk: 0 }).ill, false);
  for (let i = 0; i < 50; i++) {
    const r = rollIllness({ riderId: `r${i}`, dateStr: "2026-11-01", risk: 1 });
    assert.ok(r.ill && r.days >= C.minDays && r.days <= C.maxDays, `r${i}: ${r.days}`);
  }
});

test("assessIllness: en rask, kun moderat traet rytter bliver aldrig syg", () => {
  for (let i = 0; i < 100; i++) assert.equal(assessIllness({ riderId: `m${i}`, dateStr: "2026-11-02", fatigues: [70, 75, 80, 80, 80] }).ill, false);
});
