// #7382: blød overgang når kurve B tændes.
//
// PARAMS er syntetiske testværdier, ikke kalibreringen (den er privat, hard rule 17).
// Rytteren er et alias: en signatur-evne over sit bløde loft, de øvrige evner under.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CURVE_B_IGNITED_AT_CONFIG_KEY, CURVE_B_TRANSITION_DAYS,
  blendCurveBTransition, calendarDaysBetween, curveBTransitionForDate,
  ensureCurveBIgnitedOn, ignitedOnFromConfigValue, readCurveBIgnitedOn,
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

test("vinduet: 0 på startdagen, lineært, slut efter 14 dage; intet stempel = ingen overgang", () => {
  assert.equal(CURVE_B_TRANSITION_DAYS, 14);
  assert.equal(curveBTransitionForDate({ ignitedOn: null, tickDate: "2026-10-31" }), null);
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-10-30" })?.weight, 0);
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-11-06" })?.weight, 0.5);
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-11-12" })?.weight, 13 / 14);
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-11-13" }), null, "dag 14 = kun kurve B");
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-10-29" })?.weight, 0, "dato før start = gamle fart");
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-10-31", days: 0 }), null);
});

test("vinduet: 14 daglige ticks fra og med den første aktive dag, den første med den gamle models fulde fart", () => {
  const start = "2026-10-30";
  const weights: number[] = [];
  for (let d = 0; d < 30; d++) {
    const tickDate = new Date(Date.parse(`${start}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    const t = curveBTransitionForDate({ ignitedOn: start, tickDate });
    if (t) weights.push(t.weight);
  }
  assert.equal(weights.length, CURVE_B_TRANSITION_DAYS);
  assert.equal(weights[0], 0);
  assert.ok(weights.every((w, i) => i === 0 || w > weights[i - 1]), "stigende");
  assert.ok(weights.every((w) => w < 1));
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
  assert.equal(blendCurveBTransition({ curveBDelta: 0.2, oldDelta: Number.NaN, current: 60, softCeiling: 50, transition: half }), 0.2, "ugyldig gammel = kurve B");
  assert.equal(blendCurveBTransition({ curveBDelta: 0.2, oldDelta: 0.05, current: 60, softCeiling: 50, transition: { weight: 0 } }), 0.2,
    "gamle model langsommere: kurve B, overgangen bremser aldrig");
  assert.equal(blendCurveBTransition({ curveBDelta: 0.2, oldDelta: 1, current: 60, softCeiling: 50, transition: { weight: 1 } }), 0.2);
  assert.equal(blendCurveBTransition({ curveBDelta: 0.2, oldDelta: 1, current: 60, softCeiling: 50, transition: { weight: Number.NaN } }), 0.2);
});

test("stemplet: motorens danske dato læses uændret, et tidsstempel bliver dansk kalenderdato", () => {
  assert.equal(ignitedOnFromConfigValue("2026-10-31"), "2026-10-31");
  assert.equal(ignitedOnFromConfigValue("2026-02-30"), null, "ikke en rigtig dato");
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

// app_config som en lille tabel: upsert med ignoreDuplicates = insert ... on conflict do nothing.
function fakeConfigTable(rows: Array<{ key: string; value: unknown }>, { upsertError = null as unknown } = {}) {
  const upserts: Array<{ row: Record<string, unknown>; opts: Record<string, unknown> }> = [];
  return {
    rows, upserts,
    from(_table: string) {
      let key: string | undefined;
      const q = {
        select: () => q,
        eq: (_col: string, val: string) => { key = val; return q; },
        maybeSingle: async () => ({ data: rows.find((r) => r.key === key) ?? null, error: null }),
        upsert: async (row: { key: string; value: unknown }, opts: Record<string, unknown>) => {
          upserts.push({ row, opts });
          if (upsertError) return { error: upsertError };
          const i = rows.findIndex((r) => r.key === row.key);
          if (i < 0) rows.push({ key: row.key, value: row.value });
          else if (!opts?.ignoreDuplicates) rows[i] = { key: row.key, value: row.value };
          return { error: null };
        },
      };
      return q;
    },
  };
}

test("stempling: første aktive dag stemples med tick-datoen, et eksisterende stempel overskrives aldrig", async () => {
  const db = fakeConfigTable([]);
  assert.equal(await ensureCurveBIgnitedOn(db, { tickDate: "2026-10-31" }), "2026-10-31");
  assert.deepEqual(db.upserts[0].opts, { onConflict: "key", ignoreDuplicates: true });
  assert.equal(db.upserts[0].row.key, CURVE_B_IGNITED_AT_CONFIG_KEY);
  assert.equal(await ensureCurveBIgnitedOn(db, { tickDate: "2026-11-05" }), "2026-10-31", "næste dag: samme start");
  assert.deepEqual(db.rows, [{ key: CURVE_B_IGNITED_AT_CONFIG_KEY, value: "2026-10-31" }]);
});

test("stempling: fejl = ingen ny start (læser det der står), men kaster på den strikse sti", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const failing = fakeConfigTable([{ key: CURVE_B_IGNITED_AT_CONFIG_KEY, value: "2026-10-30" }], { upsertError: { message: "nede" } });
    assert.equal(await ensureCurveBIgnitedOn(failing, { tickDate: "2026-10-31" }), "2026-10-30");
    assert.equal(await ensureCurveBIgnitedOn(fakeConfigTable([], { upsertError: { message: "nede" } }), { tickDate: "2026-10-31" }), null);
    const bad = fakeConfigTable([]);
    assert.equal(await ensureCurveBIgnitedOn(bad, { tickDate: "31/10" }), null);
    assert.equal(bad.upserts.length, 0, "ugyldig dato stemples aldrig");
  } finally {
    console.warn = warn;
  }
  await assert.rejects(ensureCurveBIgnitedOn(fakeConfigTable([], { upsertError: { message: "nede" } }), { tickDate: "2026-10-31", strict: true }));
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

test("overgangen giver aldrig mindre end kurve B, for alle aldre og potentialer", () => {
  for (const age of [17, 21, 25, 29, 33, 36]) {
    for (const potentiale of [1, 2.5, 4.5, 6]) {
      const b = tick({ age, potentiale, curveB: PARAMS });
      for (const weight of [0, 0.5, 13 / 14]) {
        const t = tick({ age, potentiale, curveB: PARAMS, curveBTransition: { weight } });
        for (const k of VISIBLE_ABILITIES) assert.ok(prog(t, k) >= prog(b, k) - 1e-12, `alder ${age}, pot ${potentiale}, ${k}`);
      }
    }
  }
});

test("ingen loft-mur: evnen på det hårde loft får intet, heller ikke i overgangen", () => {
  const r = tick({ curveB: PARAMS, curveBTransition: { weight: 0 }, abilities: { ...at(20), [MAIN]: CAP } });
  assert.equal(prog(r, MAIN), 0);
  assert.equal(r.gains[MAIN] ?? 0, 0);
});

test("gamle model i overgangen = tick uden kurve, med den alders-afhængige score (alle aldre)", () => {
  const day0 = (age: number) => prog(tick({ age, curveB: PARAMS, curveBTransition: { weight: 0 } }), MAIN);
  const old = (age: number) => prog(tick({ age }), MAIN);
  for (const age of [19, 27, 34]) assert.equal(day0(age), old(age), `alder ${age}`);
  assert.notEqual(old(19), old(34), "kontrol: den gamle models fart afhænger af alderen (ikke alders-neutral)");
});

test("fixturen for blandingen: gamle model er hurtigere end kurve B over loftet", () => {
  const program = { focus: "vo2max_punch", intensity: "hard" };
  const args = { ability: MAIN, current: 80, cap: CAP, age: 27, program, conditionMult: 1, noise: 1,
    potentiale: POT, primaryType: "puncheur", secondaryType: null };
  const old = dailyAbilityDelta(args);
  const b = dailyAbilityDelta({ ...args, curveB: PARAMS });
  assert.ok(old > b && b > 0);
});

test("Udviklingsscore B: den gamle model i overgangen bruger scorens led, som uden kurve B", () => {
  const developmentScore = { score: 60, devMult: 1.3, kind: "training" };
  const old = tick({ developmentScore });
  const b = tick({ developmentScore, curveB: PARAMS });
  const day0 = tick({ developmentScore, curveB: PARAMS, curveBTransition: { weight: 0 } });
  assert.notEqual(prog(old, MAIN), prog(tick(), MAIN), "kontrol: scoren B ændrer den gamle model");
  assert.ok(prog(old, MAIN) > prog(b, MAIN), "kontrol: gamle model hurtigere over loftet");
  assert.equal(prog(day0, MAIN), prog(old, MAIN), "dag 0 = den gamle model med scorens led");
  const half = tick({ developmentScore, curveB: PARAMS, curveBTransition: { weight: 0.5 } });
  assert.ok(Math.abs(prog(half, MAIN) - (prog(old, MAIN) + prog(b, MAIN)) / 2) < 1e-12, "lineær blanding");
  for (const k of VISIBLE_ABILITIES) {
    if (k === MAIN) continue;
    assert.equal(prog(day0, k), prog(b, k), `${k} under loftet: kurve B`);
  }
});
