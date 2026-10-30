// #7382: blød overgang når kurve B tændes.
//
// PARAMS er syntetiske testværdier, ikke kalibreringen (den er privat, hard rule 17).
// Rytteren er et alias: en signatur-evne over sit bløde loft, de øvrige evner under.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CURVE_B_IGNITED_AT_CONFIG_KEY, CURVE_B_TRANSITION_DAYS,
  blendCurveBTransition, calendarDaysBetween, curveBTransitionForDate,
  ignitedOnFromConfigValue, readCurveBIgnitedOn,
} from "./developmentCurveBTransition7382.ts";
import { curveBSoftCeiling, validateDevelopmentCurveBParams } from "./developmentCurveB.ts";
import { applyDailyTick, dailyAbilityDelta } from "./dailyTraining.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

const PARAMS = validateDevelopmentCurveBParams({
  rate: 10, levelExponent: 2, capExponent: 0.5,
  load: { fromAge: 16, fullAge: 24, floor: 0.5 },
  potentialCeiling: [0.2, 0.3, 0.4, 0.5, 0.6, 1],
});
const CAP = 93;
const at = (v: number) => Object.fromEntries(VISIBLE_ABILITIES.map((k: string) => [k, v]));
const MAIN = "punch";
const POT = 4.5;

function tick(over: Record<string, unknown> = {}) {
  return applyDailyTick({
    riderId: "rider-A", dateStr: "2026-10-31", age: 27,
    abilities: { ...at(20), [MAIN]: 80 }, caps: at(CAP), progress: {},
    program: { focus: "vo2max_punch", intensity: "hard" }, conditionMult: 1, potentiale: POT,
    primaryType: "puncheur", secondaryType: null, hardDailyCap: 1, ...over,
  });
}
const prog = (r: { progress: Record<string, number> }, k: string) => Number(r.progress[k] ?? 0);

test("fixturen: hovedevnen står over det bløde loft, de andre under (ellers tester vi intet)", () => {
  const soft = curveBSoftCeiling(CAP, POT, PARAMS!);
  assert.ok(80 >= soft && 80 < CAP);
  assert.ok(20 < soft);
});

test("kalenderdage: hele dage, dansk dato ind, ugyldigt = null", () => {
  assert.equal(calendarDaysBetween("2026-10-30", "2026-10-30"), 0);
  assert.equal(calendarDaysBetween("2026-10-30", "2026-11-13"), 14);
  assert.equal(calendarDaysBetween("2026-10-24", "2026-10-26"), 2, "hen over sommertidens slutning");
  assert.equal(calendarDaysBetween("2026-10-31", "2026-10-30"), -1);
  assert.equal(calendarDaysBetween(null, "2026-10-30"), null);
  assert.equal(calendarDaysBetween("30/10", "2026-10-30"), null);
});

test("vinduet: 0 på tændingsdagen, lineært, slut efter 14 dage; intet stempel = ingen overgang", () => {
  assert.equal(CURVE_B_TRANSITION_DAYS, 14);
  assert.equal(curveBTransitionForDate({ ignitedOn: null, tickDate: "2026-10-31" }), null);
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-10-30" })?.weight, 0);
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-11-06" })?.weight, 0.5);
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-11-12" })?.weight, 13 / 14);
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-11-13" }), null, "dag 14 = kun kurve B");
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-10-29" })?.weight, 0, "dato før tænding = gamle fart");
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-10-31", days: 0 }), null);
});

test("blanding: kun over det bløde loft, lineær, aldrig negativ, gammel model regnes kun når den bruges", () => {
  const half = { weight: 0.5 };
  let calls = 0;
  const old = () => { calls++; return 1; };
  assert.equal(blendCurveBTransition({ curveBDelta: 0.2, oldDelta: old, current: 10, softCeiling: 50, transition: half }), 0.2);
  assert.equal(calls, 0, "under loftet: gamle model regnes ikke");
  assert.equal(blendCurveBTransition({ curveBDelta: 0.2, oldDelta: old, current: 60, softCeiling: 50, transition: null }), 0.2);
  assert.equal(blendCurveBTransition({ curveBDelta: 0.2, oldDelta: 1, current: 60, softCeiling: 50, transition: { weight: 0 } }), 1);
  assert.equal(blendCurveBTransition({ curveBDelta: 0.2, oldDelta: 1, current: 60, softCeiling: 50, transition: half }), 0.6);
  assert.equal(blendCurveBTransition({ curveBDelta: 0.2, oldDelta: 1, current: 50, softCeiling: 50, transition: half }), 0.6, "på loftet tæller som over");
  assert.equal(blendCurveBTransition({ curveBDelta: -1, oldDelta: -1, current: 60, softCeiling: 50, transition: half }), 0);
  assert.equal(blendCurveBTransition({ curveBDelta: 0.2, oldDelta: Number.NaN, current: 60, softCeiling: 50, transition: half }), 0.1);
  assert.equal(blendCurveBTransition({ curveBDelta: 0.2, oldDelta: 1, current: 60, softCeiling: 50, transition: { weight: 1 } }), 0.2);
  assert.equal(blendCurveBTransition({ curveBDelta: 0.2, oldDelta: 1, current: 60, softCeiling: 50, transition: { weight: Number.NaN } }), 0.2);
});

test("stemplet: timestamptz bliver dansk kalenderdato", () => {
  assert.equal(ignitedOnFromConfigValue("2026-10-30T20:15:00+00:00"), "2026-10-30");
  assert.equal(ignitedOnFromConfigValue("2026-10-30T23:30:00Z"), "2026-10-31", "efter midnat dansk tid");
  assert.equal(ignitedOnFromConfigValue(null), null);
  assert.equal(ignitedOnFromConfigValue("ikke en dato"), null);
  assert.equal(ignitedOnFromConfigValue(true), null);
});

function fakeConfig(result: { data?: unknown; error?: unknown }) {
  const seen: string[] = [];
  return {
    seen,
    from(table: string) {
      seen.push(table);
      const q = {
        select: () => q,
        eq: (col: string, val: string) => { seen.push(`${col}=${val}`); return q; },
        maybeSingle: async () => result,
      };
      return q;
    },
  };
}

test("læsning: nøglen fra app_config; fejl = ingen overgang, men kaster på den strikse sti", async () => {
  const ok = fakeConfig({ data: { value: "2026-10-30T20:15:00+00:00" }, error: null });
  assert.equal(await readCurveBIgnitedOn(ok), "2026-10-30");
  assert.deepEqual(ok.seen, ["app_config", `key=${CURVE_B_IGNITED_AT_CONFIG_KEY}`]);
  assert.equal(await readCurveBIgnitedOn(fakeConfig({ data: null, error: null })), null);
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await readCurveBIgnitedOn(fakeConfig({ data: null, error: { message: "nede" } })), null);
  } finally {
    console.warn = warn;
  }
  await assert.rejects(readCurveBIgnitedOn(fakeConfig({ data: null, error: { message: "nede" } }), { strict: true }));
});

test("flag off: overgangen ignoreres uden kurve B (bit-identisk)", () => {
  assert.deepEqual(tick({ curveBTransition: { weight: 0 } }), tick());
});

test("kurve B uden overgang (null) er bit-identisk med før #7382", () => {
  assert.deepEqual(tick({ curveB: PARAMS, curveBTransition: null }), tick({ curveB: PARAMS }));
});

test("tændingsdagen: evnen over loftet får den gamle models fart, evnerne under loftet kurve B", () => {
  const old = tick();
  const b = tick({ curveB: PARAMS });
  const day0 = tick({ curveB: PARAMS, curveBTransition: { weight: 0 } });
  assert.ok(prog(old, MAIN) > prog(b, MAIN), "fixturen: gamle model er hurtigere over loftet");
  assert.equal(prog(day0, MAIN), prog(old, MAIN));
  for (const k of VISIBLE_ABILITIES) {
    if (k === MAIN) continue;
    assert.equal(prog(day0, k), prog(b, k), `${k} under loftet: kurve B fra dag 1`);
  }
});

test("over 14 dage glider hovedevnen jævnt ned til kurve B, aldrig negativ", () => {
  const old = prog(tick(), MAIN);
  const b = prog(tick({ curveB: PARAMS }), MAIN);
  let prev = Infinity;
  for (let d = 0; d < CURVE_B_TRANSITION_DAYS; d++) {
    const w = d / CURVE_B_TRANSITION_DAYS;
    const v = prog(tick({ curveB: PARAMS, curveBTransition: { weight: w } }), MAIN);
    assert.ok(v > 0, `dag ${d}`);
    assert.ok(v < prev, `dag ${d}: aftagende`);
    assert.ok(Math.abs(v - ((1 - w) * old + w * b)) < 1e-12, `dag ${d}: lineær`);
    prev = v;
  }
  assert.ok(prev > b, "sidste dag i vinduet er stadig lidt over kurve B");
});

test("ingen loft-mur: evnen på det hårde loft får intet, heller ikke i overgangen", () => {
  const r = tick({ curveB: PARAMS, curveBTransition: { weight: 0 }, abilities: { ...at(20), [MAIN]: CAP } });
  assert.equal(prog(r, MAIN), 0);
  assert.equal(r.gains[MAIN] ?? 0, 0);
});

test("gamle model i overgangen = dailyAbilityDelta uden kurve med den alders-afhængige score", () => {
  const program = { focus: "vo2max_punch", intensity: "hard" };
  const args = { ability: MAIN, current: 80, cap: CAP, age: 27, program, conditionMult: 1, noise: 1,
    potentiale: POT, primaryType: "puncheur", secondaryType: null };
  const old = dailyAbilityDelta(args);
  const b = dailyAbilityDelta({ ...args, curveB: PARAMS });
  assert.ok(old > b && b > 0);
});
