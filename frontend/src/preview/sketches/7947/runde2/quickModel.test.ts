import test from "node:test";
import assert from "node:assert/strict";
import { SESSION_INTENSITY_V3 } from "../../../../lib/trainingDayTypes.js";
import { RECOVERY_SESSION, choiceFromPlan } from "../effortModel.ts";
import {
  HOME,
  choiceForQuick,
  effortOf,
  isActiveRecovery,
  ownTraining,
  planForQuick,
  quickIsValid,
  type Quick,
} from "./quickModel.ts";

const QUICKS: Quick[] = ["rest", "active", "easy", "normal", "hard", "own"];
const HARD_FALLBACK = "vo2max";

// Alle gemte planer i dag: de to hele dage, hvile med et gemt fokus, og hver session.
const PLANS: { focus: string | null; intensity: string }[] = [
  { focus: null, intensity: "rest" },
  { focus: "vo2max_climb", intensity: "rest" },
  { focus: "restitution", intensity: "recovery" },
  ...Object.keys(SESSION_INTENSITY_V3).map((s) => ({
    focus: s,
    intensity: (SESSION_INTENSITY_V3 as Record<string, string>)[s],
  })),
];

test("hvert et-tryks-valg er et gyldigt par for hver gemt plan", () => {
  for (const plan of PLANS) {
    for (const q of QUICKS) {
      assert.ok(quickIsValid(q, plan, HARD_FALLBACK), `${q} paa ${JSON.stringify(plan)}`);
    }
  }
});

test("aktiv restitution bor under Hvile og gemmes som i dag", () => {
  const c = choiceForQuick("active", { focus: "sprint", intensity: "hard" }, HARD_FALLBACK);
  assert.deepEqual(c, { effort: "rest", session: RECOVERY_SESSION });
  const plan = planForQuick("active", { focus: "sprint", intensity: "hard" }, HARD_FALLBACK);
  assert.deepEqual(plan, { focus: "restitution", intensity: "recovery" });
  assert.equal(effortOf(plan), "rest");
  assert.ok(isActiveRecovery(plan));
});

test("hvile beholder rytterens traening, saa et tryk fører tilbage til samme plan", () => {
  for (const plan of PLANS) {
    if (plan.intensity === "rest" || plan.intensity === "recovery" || !plan.focus) continue;
    const rested = planForQuick("rest", plan, HARD_FALLBACK);
    assert.equal(rested.intensity, "rest");
    assert.equal(rested.focus, plan.focus);
    const back = planForQuick("own", rested, HARD_FALLBACK);
    assert.deepEqual(back, plan, `tilbage fra hvile for ${plan.focus}`);
  }
});

test("Haard giver aldrig en let traening, og Hvile giver aldrig en traening", () => {
  for (const plan of PLANS) {
    const hard = choiceForQuick("hard", plan, HARD_FALLBACK);
    assert.equal(hard.effort, "hard");
    assert.equal((SESSION_INTENSITY_V3 as Record<string, string>)[hard.session ?? ""], "hard");
    const rest = choiceForQuick("rest", plan, HARD_FALLBACK);
    assert.equal(rest.session, null);
  }
});

test("rytterens egen traening falder tilbage paa reserven ved restitution og tom plan", () => {
  assert.equal(ownTraining({ focus: "restitution", intensity: "recovery" }, HARD_FALLBACK), HARD_FALLBACK);
  assert.equal(ownTraining(null, HARD_FALLBACK), HARD_FALLBACK);
  assert.equal(ownTraining({ focus: "long_climbs", intensity: "rest" }, HARD_FALLBACK), "long_climbs");
});

test("et tryk aendrer kun det der vises; den gemte plan laeses uaendret", () => {
  for (const plan of PLANS) {
    const before = choiceFromPlan(plan, HOME);
    assert.deepEqual(choiceFromPlan({ ...plan }, HOME), before);
  }
});
