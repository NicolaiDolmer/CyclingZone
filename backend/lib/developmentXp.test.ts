// #6110: tests for XP-modulet. Tallene her er syntetiske; de rigtige er private (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  XP_ROLE_CLASSES, abilityXpForTick, buyPoints, validateDevelopmentXpParams, xpAgeShare, xpBarView,
  xpPerDate, xpPriceForNextPoint, xpSessionShare, xpTypeShare,
} from "./developmentXp.ts";
import type { DevelopmentXpParams } from "./developmentXp.ts";

const RAW = Object.freeze({
  price: { base: 10, exponent: 2 },
  potentialXp: [{ at: 1, value: 10 }, { at: 3, value: 30 }, { at: 6, value: 90 }],
  ageShare: {
    physical: [{ at: 28, value: 1 }, { at: 32, value: 0.5 }, { at: 36, value: 0.1 }],
    mental: [{ at: 32, value: 1 }, { at: 36, value: 0.5 }, { at: 40, value: 0.2 }],
  },
  offFocusShare: 0.1,
  raceOffFocusShare: 0.2,
  typeShare: { signatur: 1, sekundaer: 0.8, haandvaerk: 0.5, andenRolle: 0.3, svaghed: 0.1 },
});

const params = validateDevelopmentXpParams(RAW) as DevelopmentXpParams;
const tweak = (patch: Record<string, unknown>) => validateDevelopmentXpParams({ ...RAW, ...patch });

test("validering: gyldige params bliver en frossen kopi", () => {
  assert.ok(params);
  assert.ok(Object.isFrozen(params));
  assert.ok(Object.isFrozen(params.price));
  assert.ok(Object.isFrozen(params.potentialXp));
  assert.ok(Object.isFrozen(params.potentialXp[0]));
  assert.ok(Object.isFrozen(params.ageShare.mental));
  assert.ok(Object.isFrozen(params.typeShare));
  assert.notEqual(params.potentialXp, RAW.potentialXp);
});

test("validering: manglende eller ødelagte felter giver null (fail-safe)", () => {
  for (const raw of [null, undefined, 7, "x", {}, []]) assert.equal(validateDevelopmentXpParams(raw), null);
  for (const key of Object.keys(RAW)) {
    const copy: Record<string, unknown> = { ...RAW };
    delete copy[key];
    assert.equal(validateDevelopmentXpParams(copy), null, `uden ${key}`);
  }
  assert.equal(tweak({ price: { base: 0, exponent: 2 } }), null);
  assert.equal(tweak({ price: { base: 10, exponent: 0 } }), null);
  assert.equal(tweak({ price: { base: 10, exponent: Number.NaN } }), null);
  assert.equal(tweak({ price: null }), null);
});

test("validering: potentialet", () => {
  assert.equal(tweak({ potentialXp: [{ at: 1, value: 10 }] }), null, "mindst to punkter");
  assert.equal(tweak({ potentialXp: [{ at: 3, value: 10 }, { at: 1, value: 20 }] }), null, "stigende punkter");
  assert.equal(tweak({ potentialXp: [{ at: 1, value: 20 }, { at: 3, value: 10 }] }), null, "højere potentiale giver aldrig mindre");
  assert.equal(tweak({ potentialXp: [{ at: 1, value: 0 }, { at: 3, value: 10 }] }), null, "ingen tjener nul");
  assert.equal(tweak({ potentialXp: [null, { at: 3, value: 10 }] }), null);
});

test("validering: alderen", () => {
  const age = (physical: unknown, mental: unknown = RAW.ageShare.mental) => tweak({ ageShare: { physical, mental } });
  assert.equal(age([{ at: 28, value: 0.9 }]), null, "starter på fuld XP");
  assert.equal(age([{ at: 28, value: 1 }, { at: 30, value: 0.5 }, { at: 32, value: 0.6 }]), null, "stiger aldrig igen");
  assert.equal(age([{ at: 28, value: 1 }, { at: 30, value: 0 }]), null, "aldrig nul");
  assert.equal(age([]), null);
  assert.equal(age(RAW.ageShare.physical, null), null);
  assert.equal(age(RAW.ageShare.mental, RAW.ageShare.physical), null, "mentale evner får aldrig mindre end fysiske");
  assert.ok(age(RAW.ageShare.physical, RAW.ageShare.physical), "lige meget er tilladt");
  // Interpolationen må ikke afrunde et punkt under sig selv og afvise gyldige params.
  assert.ok(age(
    [{ at: 28, value: 1 }, { at: 34, value: 0.2 }],
    [{ at: 32, value: 1 }, { at: 38, value: 0.2 }],
  ), "samme slutværdi på to kurver er gyldig");
});

test("validering: fokus og type", () => {
  for (const share of [0, 1, -0.1, Number.NaN]) {
    assert.equal(tweak({ offFocusShare: share }), null);
    assert.equal(tweak({ raceOffFocusShare: share }), null);
  }
  const type = (patch: Record<string, number>) => tweak({ typeShare: { ...RAW.typeShare, ...patch } });
  assert.equal(type({ signatur: 0.9 }), null, "signaturen er enheden");
  assert.equal(type({ sekundaer: 0.4 }), null, "rækkefølgen holder");
  assert.equal(type({ svaghed: 0 }), null, "alt kan trænes");
  assert.equal(type({ sekundaer: 1.2 }), null);
  assert.deepEqual([...XP_ROLE_CLASSES].map((c) => params.typeShare[c]), [1, 0.8, 0.5, 0.3, 0.1]);
});

test("prisen: stiger med evnen, er endelig til 99, og kun evnen tæller", () => {
  let previous = 0;
  for (let level = 0; level <= 99; level++) {
    const price = xpPriceForNextPoint(level, params);
    assert.ok(Number.isFinite(price) && price > previous, `evne ${level}`);
    previous = price;
  }
  assert.equal(xpPriceForNextPoint(0, params), RAW.price.base);
  assert.equal(xpPriceForNextPoint(-5, params), xpPriceForNextPoint(0, params));
  assert.equal(xpPriceForNextPoint(120, params), xpPriceForNextPoint(99, params));
  assert.equal(xpPriceForNextPoint(Number.NaN, params), xpPriceForNextPoint(0, params));
});

test("alder: fuld til kurven falder, aldrig over 1, mentale evner længst", () => {
  assert.equal(xpAgeShare(19, params), 1);
  assert.equal(xpAgeShare(28, params), 1);
  assert.equal(xpAgeShare(30, params), 0.75);
  assert.equal(xpAgeShare(60, params), 0.1, "fladt efter sidste punkt, aldrig nul");
  assert.equal(xpAgeShare(null, params), 1);
  assert.equal(xpAgeShare(undefined, params, { mental: true }), 1);
  assert.equal(xpAgeShare(32, params, { mental: true }), 1);
  for (let age = 16; age <= 45; age++) {
    assert.ok(xpAgeShare(age, params, { mental: true }) >= xpAgeShare(age, params), `alder ${age}`);
  }
});

test("XP pr. dag: samme som 19-årig og 28-årig, potentialet afgør, glidende mellem punkter", () => {
  assert.equal(xpPerDate({ potentiale: 3, age: 19 }, params), xpPerDate({ potentiale: 3, age: 28 }, params));
  assert.equal(xpPerDate({ potentiale: 3, age: 19 }, params), 30);
  assert.equal(xpPerDate({ potentiale: 2, age: 19 }, params), 20);
  assert.equal(xpPerDate({ potentiale: 4.5, age: 19 }, params), 60);
  assert.equal(xpPerDate({ potentiale: 3, age: 30 }, params), 22.5);
  assert.equal(xpPerDate({ potentiale: 3, age: 34, mental: true }, params), 22.5);
  assert.equal(xpPerDate({ potentiale: 9, age: 19 }, params), 90, "fladt over øverste punkt");
  assert.equal(xpPerDate({ potentiale: null, age: 19 }, params), 10, "ukendt potentiale får bunden");
  assert.ok(xpPerDate({ potentiale: 6, age: 25 }, params) > xpPerDate({ potentiale: 1, age: 25 }, params));
});

test("sessionen: mest i fokus, lidt i resten, intet på hvile", () => {
  const off = params.offFocusShare;
  assert.equal(xpSessionShare({ inFocus: true, intensityShare: 1 }), 1);
  assert.equal(xpSessionShare({ inFocus: true, intensityShare: 0.5, weight: 2 }), 1);
  assert.equal(xpSessionShare({ inFocus: false, intensityShare: 1, offFocusShare: off }), off);
  assert.equal(xpSessionShare({ inFocus: false, intensityShare: 0.5, offFocusShare: off }), 0.5 * off);
  assert.equal(xpSessionShare({ inFocus: false, intensityShare: 1 }), 0, "ingen off-fokus på en restitutionsdag");
  assert.equal(xpSessionShare({ inFocus: true, intensityShare: 0 }), 0);
  assert.equal(xpSessionShare({ inFocus: true, intensityShare: Number.NaN }), 0);
  assert.equal(xpSessionShare({ inFocus: true, intensityShare: 1, weight: -1 }), 0);
});

test("typen: andel af XP, færdighedsdagen højst håndværk, ukendt klasse er anden rolle", () => {
  assert.equal(xpTypeShare("signatur", params), 1);
  assert.equal(xpTypeShare("svaghed", params), 0.1);
  assert.equal(xpTypeShare("signatur", params, { skillDay: true }), 0.5);
  assert.equal(xpTypeShare("svaghed", params, { skillDay: true }), 0.1, "dagen løfter aldrig");
  assert.equal(xpTypeShare("hemmelig", params), 0.3);
  assert.equal(xpTypeShare(null, params), 0.3);
});

test("XP på en evne: produktet af leddene, tickets andel, aldrig negativ", () => {
  const args = { riderXp: 100, sessionShare: 0.5, typeShare: 0.8 };
  assert.equal(abilityXpForTick(args), 40);
  assert.equal(abilityXpForTick({ ...args, dayMult: 1.5 }), 60);
  assert.equal(abilityXpForTick({ ...args, ticksPerDate: 4 }), 10);
  assert.equal(abilityXpForTick({ ...args, dayMult: Number.NaN }), 40, "korrupt led er neutralt");
  assert.equal(abilityXpForTick({ ...args, dayMult: -1 }), 40);
  assert.equal(abilityXpForTick({ ...args, ticksPerDate: 0 }), 40);
  assert.equal(abilityXpForTick({ ...args, sessionShare: 0 }), 0);
  assert.equal(abilityXpForTick({ ...args, riderXp: Number.NaN }), 0);
  assert.equal(abilityXpForTick({ ...args, riderXp: -5 }), 0);
});

test("køb: under prisen køber intet, og XP lægges på bjælken", () => {
  const price = xpPriceForNextPoint(50, params);
  const out = buyPoints({ level: 50, bar: 0.25, xp: price / 4 }, params);
  assert.deepEqual(out, { level: 50, bar: 0.5, points: 0 });
});

test("køb: overskud regnes om til den nye pris, og ingen XP går tabt", () => {
  const price50 = xpPriceForNextPoint(50, params);
  const price51 = xpPriceForNextPoint(51, params);
  const out = buyPoints({ level: 50, bar: 0.5, xp: price50 }, params);
  assert.equal(out.level, 51);
  assert.equal(out.points, 1);
  assert.ok(Math.abs(out.bar * price51 - price50 / 2) < 1e-9, "resten er værd det samme efter købet");
  assert.ok(out.bar < 0.5, "den nye andel er mindre, fordi prisen er højere");
});

test("køb: XP stemmer over mange små og store køb", () => {
  for (const chunk of [3, 50, 150]) {
    let state = { level: 10, bar: 0 };
    let paid = 0;
    let earned = 0;
    for (let i = 0; i < 400; i++) {
      earned += chunk;
      const before = state.level;
      const next = buyPoints({ ...state, xp: chunk }, params);
      for (let l = before; l < next.level; l++) paid += xpPriceForNextPoint(l, params);
      state = { level: next.level, bar: next.bar };
    }
    const left = xpBarView(state, params).xp;
    assert.ok(Math.abs(earned - paid - left) < 1e-6, `chunk ${chunk}`);
  }
});

test("køb: et stort beløb køber flere point uden loft, loftet bærer resten videre", () => {
  const xp = xpPriceForNextPoint(10, params) + xpPriceForNextPoint(11, params) + xpPriceForNextPoint(12, params);
  const free = buyPoints({ level: 10, xp }, params);
  assert.equal(free.points, 3);
  const capped = buyPoints({ level: 10, xp, maxPoints: 1 }, params);
  assert.equal(capped.points, 1);
  assert.equal(capped.level, 11);
  assert.ok(capped.bar > 1, "det klippede ligger på bjælken");
  const later = buyPoints({ level: capped.level, bar: capped.bar, maxPoints: 1 }, params);
  assert.equal(later.points, 1, "baren betales ud uden ny XP");
  assert.equal(later.level, 12);
  const none = buyPoints({ level: 10, xp, maxPoints: 0 }, params);
  assert.equal(none.points, 0);
  assert.ok(Math.abs(none.bar * xpPriceForNextPoint(10, params) - xp) < 1e-9);
});

test("køb: baren over 1 fra den gamle model betales ud med højst +1 pr. dato", () => {
  let state = { level: 40, bar: 7.05 };
  let dates = 0;
  while (state.bar >= 1 && dates < 20) {
    const next = buyPoints({ ...state, maxPoints: 1 }, params);
    assert.equal(next.points, 1);
    state = { level: next.level, bar: next.bar };
    dates += 1;
  }
  assert.ok(dates > 1 && state.level === 40 + dates);
});

test("køb: 99 køber intet og klipper bjælken, 98 kan stadig nå 99", () => {
  const top = buyPoints({ level: 99, bar: 0.5, xp: 1e12 }, params);
  assert.equal(top.level, 99);
  assert.equal(top.points, 0);
  assert.ok(top.bar < 1);
  const almost = buyPoints({ level: 98, xp: 1e12 }, params);
  assert.equal(almost.level, 99);
  assert.equal(almost.points, 1);
  assert.ok(almost.bar < 1);
});

test("køb: korrupt input forgifter ikke", () => {
  assert.deepEqual(buyPoints({ level: 50, bar: Number.NaN, xp: Number.NaN }, params), { level: 50, bar: 0, points: 0 });
  assert.deepEqual(buyPoints({ level: 50, bar: -1, xp: -1 }, params), { level: 50, bar: 0, points: 0 });
  assert.deepEqual(buyPoints({ level: Number.NaN, bar: 0.4, xp: 10 }, params), { level: Number.NaN, bar: 0.4, points: 0 });
  assert.equal(buyPoints({ level: 50, xp: 1e9, maxPoints: Number.NaN }, params).points, 0);
});

test("køb: rører ikke input og er deterministisk", () => {
  const input = Object.freeze({ level: 30, bar: 0.2, xp: 400, maxPoints: 1 });
  assert.deepEqual(buyPoints(input, params), buyPoints(input, params));
});

test("visningen: x af y XP følger andel og pris", () => {
  const price = xpPriceForNextPoint(60, params);
  assert.deepEqual(xpBarView({ level: 60, bar: 0.25 }, params), { xp: 0.25 * price, price });
  assert.deepEqual(xpBarView({ level: 60 }, params), { xp: 0, price });
  assert.deepEqual(xpBarView({ level: 60, bar: Number.NaN }, params), { xp: 0, price });
});

test("X5: en hel træningsdag giver altid XP, også for den svageste kombination", () => {
  const riderXp = xpPerDate({ potentiale: 1, age: 45 }, params);
  const xp = abilityXpForTick({
    riderXp,
    sessionShare: xpSessionShare({ inFocus: true, intensityShare: 0.5 }),
    typeShare: xpTypeShare("svaghed", params),
    ticksPerDate: 5,
  });
  assert.ok(xp > 0);
});
