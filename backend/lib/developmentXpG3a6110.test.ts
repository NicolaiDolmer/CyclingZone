// #6110 G3a (spec docs/superpowers/specs/2026-11-20-6110-potentiale-p-og-udvikling-g3a-design.md
// §3 og §6.1, #8520): afstanden til P i XP, logaritmisk pris, træthed, roterende plan i
// skønnet. Alle tal her er syntetiske; de rigtige er private (hard rule 17). Uden de nye felter
// i talfilen og uden P er alt som før.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buyPoints, developmentXpTick, validateDevelopmentXpParams, xpBestTypeRating, xpDistanceFactor, xpFatigueFactor,
  xpPriceForNextPoint, xpWearOf,
} from "./developmentXp.ts";
import type { DevelopmentXpParams } from "./developmentXp.ts";
import { expectedCareer, standardCareerRotation, standardCareerShares } from "./developmentXpExpectedTop.ts";
import { V3_RIDER_TYPE_HARD_PAIRS } from "./trainingCatalogV3.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { bestRoleForAbilities } from "./riderBestRoleCache.js";

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
// Opdigtede G3a-felter.
const DISTANCE = Object.freeze({ h: 8 });
const FATIGUE = Object.freeze({ above: 70, share: 0.9 });
const GROWTH = Object.freeze({ base: 10, growth: 0.05 });
const v = (patch: Record<string, unknown>) => validateDevelopmentXpParams({ ...RAW, ...patch });
const base = v({}) as DevelopmentXpParams;
const g3a = v({ price: GROWTH, distance: DISTANCE, fatigue: FATIGUE }) as DevelopmentXpParams;
const flat = (level: number) => Object.fromEntries((VISIBLE_ABILITIES as readonly string[]).map((a) => [a, level]));

// ── Talfilen ────────────────────────────────────────────────────────────────────────────────

test("talfilen: G3a-felterne valideres og fryses; udeladt = som før", () => {
  assert.ok(base && g3a);
  assert.equal(base.distance, undefined);
  assert.equal(base.fatigue, undefined);
  assert.deepEqual(g3a.price, GROWTH);
  assert.deepEqual(g3a.distance, DISTANCE);
  assert.deepEqual(g3a.fatigue, FATIGUE);
  for (const part of [g3a.price, g3a.distance, g3a.fatigue]) assert.ok(Object.isFrozen(part));
  assert.deepEqual(v({ distance: { h: 8, exponent: 1.5 } })?.distance, { h: 8, exponent: 1.5 });
});

test("talfilen: sat, men ugyldig, afviser hele talfilen (fail-safe)", () => {
  const bad: Record<string, Record<string, unknown>> = {
    "distance null": { distance: null },
    "distance tal": { distance: 8 },
    "h mangler": { distance: {} },
    "h nul": { distance: { h: 0 } },
    "h negativ": { distance: { h: -3 } },
    "h over skalaen": { distance: { h: 101 } },
    "h tekst": { distance: { h: "8" } },
    "eksponent nul": { distance: { h: 8, exponent: 0 } },
    "eksponent for stor": { distance: { h: 8, exponent: 11 } },
    "distance stavefejl": { distance: { H: 8 } },
    "fatigue null": { fatigue: null },
    "tærskel negativ": { fatigue: { above: -1, share: 0.9 } },
    "tærskel 100": { fatigue: { above: 100, share: 0.9 } },
    "andel 1 (ingen effekt skal udelades)": { fatigue: { above: 70, share: 1 } },
    "andel nul": { fatigue: { above: 70, share: 0 } },
    "fatigue stavefejl": { fatigue: { above: 70, share: 0.9, extra: 1 } },
    "growth nul": { price: { base: 10, growth: 0 } },
    "growth negativ": { price: { base: 10, growth: -0.1 } },
    "growth over en fordobling": { price: { base: 10, growth: 1.5 } },
    "growth og eksponent": { price: { base: 10, growth: 0.05, exponent: 2 } },
    "growth og top": { price: { base: 10, growth: 0.05, top: 140 } },
    "hverken growth eller eksponent": { price: { base: 10 } },
    "datePlus2 (afløst)": { datePlus2: { minPotential: 5, belowLevel: 30 } },
  };
  for (const [name, patch] of Object.entries(bad)) assert.equal(v(patch), null, name);
});

test("talfilen: G3a's pris har ingen top, så aldringen står frit; kandidat B's pakke gælder uændret", () => {
  const AGING = { plateauThroughAge: 28, declineByYearsPastPlateau: [{ maxYears: 99, drop: 1 }] };
  assert.ok(v({ price: GROWTH, aging: AGING }), "G3a-pris med aldring");
  assert.ok(v({ price: GROWTH }), "G3a-pris uden aldring");
  assert.equal(v({ aging: AGING }), null, "kandidat B: aldring uden top afvises stadig");
});

// ── Logaritmisk pris ────────────────────────────────────────────────────────────────────────

test("logaritmisk pris: hvert point en fast procent dyrere end det forrige, endelig til 99", () => {
  assert.equal(xpPriceForNextPoint(0, g3a), GROWTH.base);
  for (let level = 1; level <= 99; level++) {
    const ratio = xpPriceForNextPoint(level, g3a) / xpPriceForNextPoint(level - 1, g3a);
    assert.ok(Math.abs(ratio - (1 + GROWTH.growth)) < 1e-12, `evne ${level}: samme procent`);
  }
  assert.ok(Number.isFinite(xpPriceForNextPoint(99, g3a)));
  assert.equal(xpPriceForNextPoint(150, g3a), xpPriceForNextPoint(99, g3a), "over 99 regnes som 99");
  // Points købt for samme XP falder logaritmisk: dobbelt XP giver aldrig dobbelt så mange point højt oppe.
  const one = buyPoints({ level: 60, xp: xpPriceForNextPoint(60, g3a) * 20 }, g3a).points;
  const two = buyPoints({ level: 60, xp: xpPriceForNextPoint(60, g3a) * 40 }, g3a).points;
  assert.ok(two > one && two < 2 * one);
});

test("logaritmisk pris: kandidat B's pris er bit-identisk, når growth ikke er sat", () => {
  for (let level = 0; level <= 99; level++) {
    assert.equal(xpPriceForNextPoint(level, base), RAW.price.base * Math.pow(1 - level / 100, -RAW.price.exponent));
  }
});

// ── Afstanden til P ─────────────────────────────────────────────────────────────────────────

test("afstand: stor langt fra P, mod nul tæt på P, nul ved og over P", () => {
  const f = (rating: number, ceiling = 80) => xpDistanceFactor({ ceiling, rating }, g3a);
  assert.equal(f(80 - DISTANCE.h), 0.5, "halv fart ved afstanden h");
  assert.ok(f(30) > f(60) && f(60) > f(75) && f(75) > f(79), "jo tættere på P, jo langsommere");
  assert.ok(f(79) > 0 && f(79) < 0.2, "tæt på P går det næsten i stå");
  assert.equal(f(80), 0, "ved P");
  assert.equal(f(85), 0, "over P");
  assert.ok(f(10) < 1, "aldrig over fuld fart");
});

test("afstand: eksponenten gør overgangen skarpere eller blødere, men rører aldrig h's midtpunkt-logik", () => {
  const sharp = v({ distance: { h: 8, exponent: 2 } }) as DevelopmentXpParams;
  const soft = v({ distance: { h: 8, exponent: 0.5 } }) as DevelopmentXpParams;
  const plain = xpDistanceFactor({ ceiling: 80, rating: 70 }, g3a);
  assert.ok(Math.abs(xpDistanceFactor({ ceiling: 80, rating: 70 }, sharp) - plain ** 2) < 1e-12);
  assert.ok(Math.abs(xpDistanceFactor({ ceiling: 80, rating: 70 }, soft) - Math.sqrt(plain)) < 1e-12);
});

test("afstand: slid sænker målet; ukendt eller ugyldigt slid er intet", () => {
  assert.equal(xpDistanceFactor({ ceiling: 80, rating: 70, wear: 10 }, g3a), 0, "slidt ned til sin rating");
  assert.ok(xpDistanceFactor({ ceiling: 80, rating: 70, wear: 4 }, g3a) < xpDistanceFactor({ ceiling: 80, rating: 70 }, g3a));
  for (const wear of [null, undefined, Number.NaN, -3, "x"]) {
    assert.equal(xpWearOf({ wear }), 0, String(wear));
  }
  assert.equal(xpWearOf(null), 0);
  assert.equal(xpWearOf({ wear: 2.5 }), 2.5);
});

test("afstand: uden P, uden rating eller uden talfilens distance er faktoren 1 (XP som før)", () => {
  for (const ceiling of [null, undefined, 0, 100, Number.NaN]) {
    assert.equal(xpDistanceFactor({ ceiling: ceiling as number, rating: 50 }, g3a), 1, `P ${String(ceiling)}`);
  }
  assert.equal(xpDistanceFactor({ ceiling: 80, rating: null }, g3a), 1);
  assert.equal(xpDistanceFactor({ ceiling: 80, rating: 79 }, base), 1, "talfil uden distance");
});

test("bedste type: samme tal som bedste-rolle-reglen", () => {
  for (const abilities of [flat(50), { ...flat(30), climbing: 80, endurance: 70 }, { ...flat(40), sprint: 85, acceleration: 80 }]) {
    assert.equal(xpBestTypeRating(abilities), bestRoleForAbilities(abilities).best_role_rating);
  }
  assert.equal(xpBestTypeRating(null), null);
});

// ── Tick'et ─────────────────────────────────────────────────────────────────────────────────

const ABILITIES = { ...flat(40), climbing: 60 };
const XP = xpPriceForNextPoint(60, g3a) * 0.6;
const tickWith = (params: DevelopmentXpParams, rider: Record<string, unknown> | null) => developmentXpTick({
  abilities: ABILITIES, progress: {}, rider, xpFor: (a) => (a === "climbing" || a === "endurance" ? XP : 0),
}, params);

test("tick: afstandsfaktoren ganges på al XP, regnet én gang ud fra evnerne ved tick'ets start", () => {
  const rating = xpBestTypeRating(ABILITIES) as number;
  const ceiling = rating + 10;
  const factor = xpDistanceFactor({ ceiling, rating }, g3a);
  assert.ok(factor > 0 && factor < 1);
  const out = tickWith(g3a, { ceiling });
  assert.ok(Math.abs(out.xp.climbing - XP * factor) < 1e-9);
  assert.ok(Math.abs(out.xp.endurance - XP * factor) < 1e-9, "samme faktor for alle evner");
  assert.equal(tickWith(g3a, { ceiling: rating }).xp.climbing, undefined, "ved P: intet XP");
});

test("tick: uden P, uden rytter eller uden distance er tick'et bit-identisk med før", () => {
  const plain = developmentXpTick({ abilities: ABILITIES, progress: {}, xpFor: (a) => (a === "climbing" ? XP : 0) }, base);
  for (const rider of [null, {}, { ceiling: null }, { ceiling: 70, fatigue: 90 }]) {
    assert.deepEqual(developmentXpTick({ abilities: ABILITIES, progress: {}, rider, xpFor: (a) => (a === "climbing" ? XP : 0) }, base), plain, JSON.stringify(rider));
  }
  const g3aNoP = v({ price: RAW.price, distance: DISTANCE }) as DevelopmentXpParams;
  assert.deepEqual(developmentXpTick({ abilities: ABILITIES, progress: {}, rider: { age: 22 }, xpFor: (a) => (a === "climbing" ? XP : 0) }, g3aNoP), plain, "uden P: faktor 1");
});

test("tick: træthed over tærsklen giver lidt mindre XP; ved og under tærsklen og ukendt = fuld", () => {
  const full = tickWith(g3a, {}).xp.climbing;
  assert.ok(Math.abs(tickWith(g3a, { fatigue: FATIGUE.above + 1 }).xp.climbing - full * FATIGUE.share) < 1e-9);
  for (const fatigue of [FATIGUE.above, 10, null, Number.NaN]) {
    assert.equal(tickWith(g3a, { fatigue }).xp.climbing, full, String(fatigue));
  }
  assert.equal(xpFatigueFactor(95, base), 1, "talfil uden fatigue: ingen effekt");
});

test("tick: en gemt bjælke betales ud, også når rytteren står ved P (intet tabes)", () => {
  const rating = xpBestTypeRating(ABILITIES) as number;
  const out = developmentXpTick({ abilities: ABILITIES, progress: { climbing: 2.4 }, rider: { ceiling: rating }, xpFor: () => 0 }, g3a);
  assert.equal(out.gains.climbing, buyPoints({ level: 60, bar: 2.4 }, g3a).points);
});

// ── Skønnet (expectedCareer) ────────────────────────────────────────────────────────────────

test("skøn: rotationen er typens to hårde sessioner, en lang tur og løbslære", () => {
  const rotation = standardCareerRotation("climber") as Array<{ focus: string }>;
  assert.deepEqual(rotation.map((p) => p.focus), [...V3_RIDER_TYPE_HARD_PAIRS.climber, "endurance", "loebslaere"]);
  assert.deepEqual((standardCareerRotation(null) as Array<{ focus: string }>).map((p) => p.focus), ["endurance", "loebslaere"]);
  // Planerne træner forskellige evner: ikke ét fast program.
  const shares = rotation.map((p) => standardCareerShares("climber", null, base, p as never));
  const top = shares.map((s) => Object.entries(s).sort((a, b) => b[1] - a[1])[0][0]);
  assert.ok(new Set(top).size > 1, `rotationens planer har samme topevne: ${top.join(", ")}`);
});

const RIDER = Object.freeze({ id: "g3a", abilities: { ...flat(35), climbing: 45, endurance: 42 }, age: 19, potentiale: 4, primaryType: "climber", secondaryType: null });

test("skøn: samme afstandsfaktor som motoren; P er et blødt mål, der aldrig overskrides", () => {
  const now = xpBestTypeRating(RIDER.abilities) as number;
  const free = expectedCareer(RIDER, g3a);
  assert.ok(free && free.rating > now + 10, "forudsætning: uden P når han langt");
  const ceiling = now + 8;
  const capped = expectedCareer({ ...RIDER, ceiling }, g3a);
  assert.ok(capped, "et skøn findes");
  assert.ok(capped.rating <= ceiling, `P er målet: ${capped.rating} > ${ceiling}`);
  assert.ok(capped.rating >= now, "aldrig under nuværende rating");
  assert.ok(capped.rating < free.rating);
  // Slid sænker målet.
  const worn = expectedCareer({ ...RIDER, ceiling, wear: 4 }, g3a);
  assert.ok(worn && worn.rating <= ceiling - 4 + 1);
});

test("skøn: uden P eller uden distance er skønnet uafhængigt af P-feltet", () => {
  const noDistance = v({ price: GROWTH }) as DevelopmentXpParams;
  assert.deepEqual(expectedCareer({ ...RIDER, ceiling: 40 }, noDistance), expectedCareer(RIDER, noDistance));
  assert.deepEqual(expectedCareer({ ...RIDER, ceiling: null }, g3a), expectedCareer(RIDER, g3a));
});

test("skøn: ingen grænse pr. dato (G3a); en rytter med rigeligt XP kan stige mere end 2 på en dato", () => {
  const rich = v({ ...RAW, potentialXp: [{ at: 1, value: 5000 }, { at: 6, value: 9000 }] }) as DevelopmentXpParams;
  const one = expectedCareer(RIDER, rich, { endAge: 19, datesPerSeason: 1, declineLoad: { raceDays: 0, hardDays: 0 } });
  assert.ok(one);
  const gained = Math.max(...Object.entries(one.abilities).map(([a, n]) => n - (RIDER.abilities as Record<string, number>)[a]));
  assert.ok(gained > 2, `én dato gav højst +${gained}`);
});
