// #6110 ejervalg 19/11 (kandidat B): prisens top, datoreglen uden alder, aldring og sent fald
// under XP. Alle tal her er syntetiske; de rigtige er private (hard rule 17). Uden de nye felter
// i talfilen skal alt være bit-identisk med i dag.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  XP_MAX_POINTS_PER_DATE, XP_POINTS_PER_DATE, validateDevelopmentXpParams, xpDatePointCap, xpPriceForNextPoint,
} from "./developmentXp.ts";
import type { DevelopmentXpParams } from "./developmentXp.ts";
import { AGING_V2_CONFIG, AGING_V2_DECLINING_ABILITIES, developRiderSeasonV2, xpAgingConfig } from "./riderProgression.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

const RAW = Object.freeze({
  price: { base: 10, exponent: 2 },
  potentialXp: [{ at: 1, value: 10 }, { at: 3, value: 30 }, { at: 6, value: 90 }],
  ageShare: { physical: [{ at: 33, value: 1 }, { at: 34, value: 0.8 }], mental: [{ at: 33, value: 1 }, { at: 34, value: 0.8 }] },
  offFocusShare: 0.1,
  raceOffFocusShare: 0.2,
  typeShare: { signatur: 1, sekundaer: 0.8, haandvaerk: 0.5, andenRolle: 0.3, svaghed: 0.1 },
});
const AGING = Object.freeze({
  plateauThroughAge: 26,
  declineByYearsPastPlateau: [{ maxYears: 3, drop: 1 }, { maxYears: 6, drop: 2 }, { maxYears: 99, drop: 3 }],
  late: { fromAge: 32, drop: 0.5 },
});
const v = (patch: Record<string, unknown>) => validateDevelopmentXpParams({ ...RAW, ...patch });

test("prisens top: udeladt = dagens pris, bit for bit", () => {
  const today = v({}) as DevelopmentXpParams;
  assert.deepEqual(Object.keys(today.price), ["base", "exponent"]);
  for (let level = 0; level <= 99; level++) assert.equal(xpPriceForNextPoint(level, today), 10 * Math.pow(1 - level / 100, -2));
});

test("prisens top: højere top gør toppen billigere, ens for alle, og prisen stiger stadig", () => {
  const flat = v({ price: { ...RAW.price, top: 140 } }) as DevelopmentXpParams;
  assert.equal(flat.price.top, 140);
  assert.ok(Object.isFrozen(flat.price));
  const today = v({}) as DevelopmentXpParams;
  for (let level = 1; level <= 99; level++) {
    assert.equal(xpPriceForNextPoint(level, flat), 10 * Math.pow(1 - level / 140, -2));
    assert.ok(xpPriceForNextPoint(level, flat) < xpPriceForNextPoint(level, today), `evne ${level}: billigere`);
    assert.ok(xpPriceForNextPoint(level, flat) > xpPriceForNextPoint(level - 1, flat), `evne ${level}: stiger`);
  }
});

test("prisens top: ugyldig top afviser hele talfilen (fail-safe)", () => {
  for (const top of [100, 99, 0, -5, 1001, "140", null, Number.NaN]) {
    assert.equal(v({ price: { ...RAW.price, top } }), null, `top ${String(top)}`);
  }
});

test("datoreglen uden alder: +2 for toptalent på meget lav evne uanset alder", () => {
  const p = v({ datePlus2: { minPotential: 5, belowLevel: 30 } }) as DevelopmentXpParams;
  assert.ok(p);
  assert.equal(p.datePlus2?.maxAge, undefined);
  for (const age of [17, 25, 33, 38, null, undefined]) {
    assert.equal(xpDatePointCap({ startLevel: 20, age, potentiale: 5 }, p), XP_MAX_POINTS_PER_DATE, `alder ${age}`);
  }
  assert.equal(xpDatePointCap({ startLevel: 30, age: 19, potentiale: 6 }, p), XP_POINTS_PER_DATE, "ikke meget lav");
  assert.equal(xpDatePointCap({ startLevel: 10, age: 19, potentiale: 4.5 }, p), XP_POINTS_PER_DATE, "ikke toptalent");
  assert.equal(xpDatePointCap({ startLevel: 10, age: 19, potentiale: null }, p), XP_POINTS_PER_DATE, "ukendt potentiale");
});

test("datoreglen med alder (som før): alderen gælder stadig, når talfilen sætter den", () => {
  const p = v({ datePlus2: { maxAge: 22, minPotential: 5, belowLevel: 30 } }) as DevelopmentXpParams;
  assert.equal(xpDatePointCap({ startLevel: 10, age: 22, potentiale: 5 }, p), XP_MAX_POINTS_PER_DATE);
  assert.equal(xpDatePointCap({ startLevel: 10, age: 23, potentiale: 5 }, p), XP_POINTS_PER_DATE);
  assert.equal(xpDatePointCap({ startLevel: 10, age: null, potentiale: 5 }, p), XP_POINTS_PER_DATE, "ukendt alder = lavt tal");
  for (const maxAge of [0, -1, "22", null]) {
    assert.equal(v({ datePlus2: { maxAge, minPotential: 5, belowLevel: 30 } }), null, `maxAge ${String(maxAge)}`);
  }
});

test("aldring i talfilen: valideres og bliver dagens cfg med nye trin og sent fald", () => {
  const p = v({ aging: AGING }) as DevelopmentXpParams;
  assert.ok(p?.aging);
  assert.ok(Object.isFrozen(p.aging));
  const cfg = xpAgingConfig(p) as Record<string, unknown>;
  assert.equal(cfg.plateauThroughAge, 26);
  assert.equal(cfg.brakeLoadDays, AGING_V2_CONFIG.brakeLoadDays, "bremsen er dagens");
  assert.equal(cfg.offTypeDeclineFactor, AGING_V2_CONFIG.offTypeDeclineFactor);
  assert.deepEqual(cfg.late, { fromAge: 32, drop: 0.5 });
  assert.equal(xpAgingConfig(v({}) as DevelopmentXpParams), null, "ingen aldring = dagens");
  assert.equal(xpAgingConfig(null), null);
});

test("aldring i talfilen: ugyldig aldring afviser hele talfilen (fail-safe)", () => {
  const bad = [
    null, 7, {},
    { ...AGING, plateauThroughAge: 19 },
    { ...AGING, plateauThroughAge: 28.5 },
    { ...AGING, declineByYearsPastPlateau: [] },
    { ...AGING, declineByYearsPastPlateau: [{ maxYears: 3, drop: 2 }, { maxYears: 2, drop: 3 }] },
    { ...AGING, declineByYearsPastPlateau: [{ maxYears: 3, drop: 2 }, { maxYears: 6, drop: 1 }] },
    { ...AGING, declineByYearsPastPlateau: [{ maxYears: 3, drop: -1 }] },
    { ...AGING, late: { fromAge: 26, drop: 0.5 } },
    { ...AGING, late: { fromAge: 32, drop: 0 } },
    { ...AGING, late: null },
  ];
  for (const aging of bad) assert.equal(v({ aging }), null, JSON.stringify(aging));
});

const ABILITIES = Object.freeze(Object.fromEntries(VISIBLE_ABILITIES.map((k, i) => [k, 50 + (i % 20)])));
const LATE_ABILITIES = VISIBLE_ABILITIES.filter((a) => !AGING_V2_DECLINING_ABILITIES.includes(a));
const sum = (o: Record<string, number>, keys: readonly string[]) => keys.reduce((s, k) => s + o[k], 0);

test("aldring: dagens cfg = dagens resultat, og en cfg uden `late` rører aldrig teknik/mentalt", () => {
  const cfgNoLate = xpAgingConfig(v({ aging: { ...AGING, late: undefined } }) as DevelopmentXpParams);
  for (const age of [27, 30, 33, 36, 40]) {
    const rider = { id: `r-${age}`, primary_type: "climber", age };
    const today = developRiderSeasonV2(rider, ABILITIES, 7);
    const explicit = developRiderSeasonV2(rider, ABILITIES, 7, { cfg: AGING_V2_CONFIG });
    assert.deepEqual(explicit, today, `alder ${age}: eksplicit dagens cfg er bit-identisk`);
    const noLate = developRiderSeasonV2(rider, ABILITIES, 7, { cfg: cfgNoLate });
    assert.equal(sum(noLate.next, LATE_ABILITIES), sum(ABILITIES, LATE_ABILITIES), `alder ${age}: teknik/mentalt uændret`);
  }
});

test("aldring under XP: tidligere start, og sent fald i teknik/mentalt fra fromAge, bremset af løb", () => {
  const cfg = xpAgingConfig(v({ aging: AGING }) as DevelopmentXpParams);
  // Starten: 27-årig falder i den nye regel (plateau 26), ikke i dagens (plateau 30).
  const r27 = { id: "r27", primary_type: "climber", age: 27 };
  assert.equal(developRiderSeasonV2(r27, ABILITIES, 7).aging.totalDrop, 0);
  assert.ok(developRiderSeasonV2(r27, ABILITIES, 7, { cfg }).aging.totalDrop > 0);
  // Sent fald: før fromAge intet i teknik/mentalt, fra fromAge et fald tæt på drop pr. evne.
  const before = developRiderSeasonV2({ id: "r31", primary_type: "climber", age: 31 }, ABILITIES, 7, { cfg });
  assert.equal(sum(before.next, LATE_ABILITIES), sum(ABILITIES, LATE_ABILITIES));
  const at = developRiderSeasonV2({ id: "r32", primary_type: "climber", age: 32 }, ABILITIES, 7, { cfg });
  const lateDrop = sum(ABILITIES, LATE_ABILITIES) - sum(at.next, LATE_ABILITIES);
  const expected = 0.5 * LATE_ABILITIES.length;
  assert.ok(lateDrop === Math.floor(expected) || lateDrop === Math.ceil(expected), `fald ${lateDrop} for forventet ${expected}`);
  // Fuld belastning bremser alt, også det sene fald.
  const raced = developRiderSeasonV2({ id: "r32", primary_type: "climber", age: 32 }, ABILITIES, 7,
    { cfg, load: { raceDays: AGING_V2_CONFIG.brakeLoadDays, hardDays: 0 } });
  assert.equal(raced.aging.totalDrop, 0);
  assert.deepEqual(raced.next, Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, ABILITIES[k]])));
});
