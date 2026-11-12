// #7684: det sande tal under XP. Tallene her er syntetiske; de rigtige er private (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateDevelopmentXpParams } from "./developmentXp.ts";
import type { DevelopmentXpParams } from "./developmentXp.ts";
import {
  STANDARD_CAREER, expectedCareer, expectedTopRating, standardCareerShares,
} from "./developmentXpExpectedTop.ts";
import type { ExpectedTopRider } from "./developmentXpExpectedTop.ts";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { bestRoleForAbilities } from "./riderBestRoleCache.js";

const params = validateDevelopmentXpParams({
  price: { base: 10, exponent: 2 },
  potentialXp: [{ at: 1, value: 10 }, { at: 3, value: 30 }, { at: 6, value: 90 }],
  ageShare: {
    physical: [{ at: 28, value: 1 }, { at: 32, value: 0.5 }, { at: 36, value: 0.1 }],
    mental: [{ at: 32, value: 1 }, { at: 36, value: 0.5 }, { at: 40, value: 0.2 }],
  },
  offFocusShare: 0.1,
  raceOffFocusShare: 0.2,
  typeShare: { signatur: 1, sekundaer: 0.8, haandvaerk: 0.5, andenRolle: 0.3, svaghed: 0.1 },
}) as DevelopmentXpParams;

const flat = (level: number) => Object.fromEntries((VISIBLE_ABILITIES as readonly string[]).map((a) => [a, level]));
const rider = (patch: Partial<ExpectedTopRider> = {}): ExpectedTopRider => ({
  id: "r1", abilities: flat(50), age: 21, potentiale: 4, primaryType: "climber", secondaryType: "puncheur", ...patch,
});
const ratingNow = (r: ExpectedTopRider) => bestRoleForAbilities(r.abilities, {
  primaryType: r.primaryType, secondaryType: r.secondaryType,
}).best_role_rating as number;

test("params er gyldige (forudsætning for resten)", () => {
  assert.ok(params);
});

test("standardkarrieren følger kalenderen og pensionsvinduet, ingen egne tal", () => {
  assert.ok(Object.isFrozen(STANDARD_CAREER));
  assert.ok(Number.isInteger(STANDARD_CAREER.datesPerSeason) && STANDARD_CAREER.datesPerSeason > 0);
  assert.ok(STANDARD_CAREER.endAge > 21);
});

test("standardkarrieren giver mest i typens fokus og lidt i resten", () => {
  const shares = standardCareerShares("climber", "puncheur", params);
  assert.ok(Object.keys(shares).length > 0);
  const values = Object.values(shares);
  assert.ok(values.every((v) => v > 0));
  assert.ok(Math.max(...values) > Math.min(...values), "fokus og resten er ikke ens");
});

test("aldrig under nuværende rating", () => {
  const cases: ExpectedTopRider[] = [
    rider(),
    rider({ age: 34, potentiale: 1 }),
    rider({ age: 40 }),
    rider({ abilities: flat(95), potentiale: 1, age: 30 }),
    rider({ abilities: { ...flat(30), climbing: 80, endurance: 75 }, potentiale: 2 }),
    rider({ primaryType: "sprinter", secondaryType: null, potentiale: 6, age: 18 }),
  ];
  for (const r of cases) {
    const top = expectedTopRating(r, params);
    assert.ok(top != null);
    assert.ok(top >= ratingNow(r), `top ${top} under nu ${ratingNow(r)} for ${JSON.stringify({ age: r.age, pot: r.potentiale })}`);
  }
});

test("en ung rytter forventes at stige", () => {
  const r = rider({ age: 19, abilities: flat(40), potentiale: 5 });
  const career = expectedCareer(r, params);
  assert.ok(career);
  assert.ok(career.rating > career.ratingNow);
  assert.ok(career.atAge >= 19 && career.atAge <= STANDARD_CAREER.endAge);
});

test("en rytter efter karrieren står på sit nu", () => {
  const r = rider({ age: STANDARD_CAREER.endAge + 1 });
  const career = expectedCareer(r, params);
  assert.ok(career);
  assert.equal(career.rating, career.ratingNow);
  assert.deepEqual(career.abilities, flat(50));
});

test("monotont i potentiale: højere potentiale giver aldrig et lavere topniveau", () => {
  const base: ExpectedTopRider[] = [
    rider({ age: 18, abilities: flat(35) }),
    rider({ age: 23, abilities: flat(55) }),
    rider({ age: 27, abilities: { ...flat(45), climbing: 70 }, primaryType: "climber" }),
    rider({ age: 20, abilities: flat(40), primaryType: "sprinter", secondaryType: "rouleur" }),
    rider({ age: 31, abilities: flat(60) }),
  ];
  const potentials = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6];
  for (const r of base) {
    let previous = -Infinity;
    for (const potentiale of potentials) {
      const top = expectedTopRating({ ...r, potentiale }, params) as number;
      assert.ok(top >= previous, `pot ${potentiale}: ${top} < ${previous} (alder ${r.age})`);
      previous = top;
    }
  }
});

test("potentialet skiller ryttere ad: toppen ligger over bunden", () => {
  const r = rider({ age: 18, abilities: flat(35) });
  assert.ok((expectedTopRating({ ...r, potentiale: 6 }, params) as number) > (expectedTopRating({ ...r, potentiale: 1 }, params) as number));
});

test("deterministisk: samme input giver samme svar, og input muteres ikke", () => {
  const r = rider({ age: 19, abilities: flat(40) });
  const before = JSON.stringify(r);
  const a = expectedCareer(r, params);
  const b = expectedCareer({ ...r, abilities: { ...r.abilities } }, params);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(r), before);
});

test("evnerne ved toppen giver præcis topniveauet (én kilde for skøn og prognose)", () => {
  const r = rider({ age: 20, abilities: flat(42) });
  const career = expectedCareer(r, params);
  assert.ok(career);
  assert.equal(ratingNow({ ...r, abilities: career.abilities }), career.rating);
  assert.ok(Object.values(career.abilities).every((v) => Number.isInteger(v) && v >= 0 && v <= 99));
});

test("manglende evner, alder eller rating giver intet sandt tal", () => {
  assert.equal(expectedTopRating(rider({ abilities: null }), params), null);
  assert.equal(expectedTopRating(rider({ age: null }), params), null);
  assert.equal(expectedTopRating(rider({ abilities: {} }), params), null);
});

test("samme sande tal som 10-sæsoners-kørslen måler sine gates på", async () => {
  // Kørslen (spec §8) genkører H1-H3 og H6 mod dette tal. Driver de to fra hinanden,
  // måler gaterne et andet tal end det, skønnet viser.
  const { expectedTopRating: simTop } = await import("../scripts/dev/tenSeasonSim6110.mjs");
  const types = ["climber", "sprinter", "tt", "gc", "puncheur", "rouleur", "baroudeur", "brostensrytter"];
  const abilityKeys = VISIBLE_ABILITIES as readonly string[];
  for (let i = 0; i < 40; i++) {
    const abilities = Object.fromEntries(abilityKeys.map((a, j) => [a, 20 + ((i * 7 + j * 13) % 60)]));
    const input = { id: `r${i}`, abilities, age: 17 + (i % 20), potentiale: 1 + (i % 11) / 2 };
    const primary = types[i % types.length];
    const secondary = types[(i + 3) % types.length];
    assert.equal(
      expectedTopRating({ ...input, primaryType: primary, secondaryType: secondary }, params),
      simTop({ ...input, primary_type: primary, secondary_type: secondary }, params, { datesPerSeason: STANDARD_CAREER.datesPerSeason }),
      `rytter ${i}`,
    );
  }
});

test("ukendt potentiale giver aldrig mere end bundens potentiale", () => {
  const r = rider({ age: 19, abilities: flat(40) });
  assert.equal(expectedTopRating({ ...r, potentiale: null }, params), expectedTopRating({ ...r, potentiale: 1 }, params));
});
