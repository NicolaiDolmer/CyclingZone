import test from "node:test";
import assert from "node:assert/strict";
import {
  EFFORTS,
  RECOVERY_SESSION,
  choiceFromPlan,
  isValidChoice,
  planFromChoice,
  sessionsForEffort,
  transitionRow,
} from "./effortModel.ts";
import {
  DAY_TYPES_WITHOUT_SESSION,
  SESSION_INTENSITY_V3,
  SKILL_SESSIONS,
  dayTypeForProgram,
  sessionForProgram,
} from "../../../lib/trainingDayTypes.js";

const HOMES: ("rest" | "easy")[] = ["rest", "easy"];

// Alle valg i dag: de to hele dage og hver session.
const LEGACY_PLANS: { focus: string; intensity: string }[] = [
  { focus: "endurance", intensity: "rest" },
  { focus: "restitution", intensity: "recovery" },
  ...Object.keys(SESSION_INTENSITY_V3).map((s) => ({ focus: s, intensity: (SESSION_INTENSITY_V3 as Record<string, string>)[s] })),
];

test("hver gemt dag kan vises og skrives tilbage uaendret, uanset hvor aktiv restitution bor", () => {
  for (const recoveryHome of HOMES) {
    for (const plan of LEGACY_PLANS) {
      const { effort, session } = choiceFromPlan(plan, { recoveryHome });
      assert.ok(effort && EFFORTS.includes(effort), `${plan.focus}/${plan.intensity} fik ingen indsats`);
      assert.ok(isValidChoice(effort, session, { recoveryHome }), `${plan.focus} er ikke et gyldigt valg`);
      const back = planFromChoice(effort!, session, { keepFocus: plan.focus });
      if (effort === "rest") {
        assert.equal(back.intensity, "rest");
        assert.equal(back.focus, plan.focus, "hvile bevarer fokus i kolonnen");
      } else {
        assert.equal(dayTypeForProgram(back), dayTypeForProgram(plan));
        assert.equal(sessionForProgram(back), sessionForProgram(plan));
      }
    }
  }
});

test("hvile tilbyder ingen traening, og traening paa hvile afvises", () => {
  assert.deepEqual(sessionsForEffort("rest", { recoveryHome: "easy" }), []);
  assert.equal(isValidChoice("rest", null, { recoveryHome: "easy" }), true);
  assert.equal(isValidChoice("rest", "vo2max", { recoveryHome: "easy" }), false);
  assert.equal(isValidChoice("rest", "vo2max", { recoveryHome: "rest" }), false);
});

test("en hard session kan ikke vaelges paa en let eller mellem indsats", () => {
  for (const effort of ["rest", "easy", "normal"]) {
    for (const s of sessionsForEffort("hard")) {
      assert.equal(isValidChoice(effort as "rest" | "easy" | "normal", s, { recoveryHome: "easy" }), false, `${s} paa ${effort}`);
    }
  }
});

test("hver session bor paa praecis en indsats (aktiv restitution paa den valgte)", () => {
  for (const recoveryHome of HOMES) {
    const seen = new Map();
    for (const effort of EFFORTS) {
      for (const s of sessionsForEffort(effort, { recoveryHome })) {
        assert.ok(!seen.has(s), `${s} findes paa baade ${seen.get(s)} og ${effort}`);
        seen.set(s, effort);
      }
    }
    for (const s of Object.keys(SESSION_INTENSITY_V3)) assert.ok(seen.has(s), `${s} mangler`);
    assert.equal(seen.get(RECOVERY_SESSION), recoveryHome);
  }
});

test("faerdighedsdage ligger paa let indsats, som deres egen intensitet allerede siger", () => {
  for (const s of SKILL_SESSIONS) {
    assert.equal(choiceFromPlan({ focus: s, intensity: (SESSION_INTENSITY_V3 as Record<string, string>)[s] }).effort, "easy");
  }
});

test("et gemt fokus paa en hvileplan er ignoreret, ikke trænet", () => {
  const row = transitionRow({ focus: "sprint", intensity: "rest" }, { recoveryHome: "rest" });
  assert.equal(row.effort, "rest");
  assert.equal(row.session, null);
  assert.equal(row.focusIgnored, true);
  assert.ok(DAY_TYPES_WITHOUT_SESSION.includes(row.dayType));
});

test("ingen plan giver intet valg", () => {
  assert.deepEqual(choiceFromPlan(null), { effort: null, session: null });
});
