// backend/lib/engine/v4/finale.modifierScale.test.ts
// #5957: dagens modifikatorer (W'-reserve, dagsform, indsats) i finale-
// placeringsscoren skaleres med rytterens finale-evne relativt til puljens
// bedste. Foer var udsvinget et absolut tal for alle, saa en frisk rytter uden
// finale-evne kunne slaa specialisten paa friskhed og dagsform alene.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { computeFinaleAbilityScore, finaleAbilityTerm, finaleModifierScale } from "./finale.ts";
import { EFFORT_GAIN_EXTRA_TUNING, FINALE_EXTRA_TUNING, RACE_V4_TUNING } from "./tuning.ts";
import type { AbilityKey, EffortLevel } from "./types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilities(base: number, overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = base;
  return { ...out, ...overrides };
}

const SPRINT = RACE_V4_TUNING.finale.demandVectorByFinaleType.bunch_sprint;
const EXTRA = FINALE_EXTRA_TUNING;
const EFFORTS: EffortLevel[] = ["grupetto", "save", "normal", "protect", "all_out"];

function scaleFor(ability: number, best: number): number {
  return finaleModifierScale(ability, best, EXTRA.modifierScaleFloor, EXTRA.modifierFullScaleShare);
}

test("finaleModifierScale: puljens bedste og de reelle kandidater faar modifikatorerne fuldt ud", () => {
  assert.equal(finaleModifierScale(0.4, 0.4, 0.1), 1);
  assert.equal(finaleModifierScale(0.3, 0.4, 0.1, 0.5), 1, "over andelen af den bedste = fuld skala");
  assert.equal(finaleModifierScale(0.1, 0.4, 0.1, 0.5), 0.5, "halvdelen af referencen = halv skala");
  assert.equal(finaleModifierScale(0, 0.4, 0.1), 0, "ingen finale-evne = ingen modifikatorer");
});

test("finaleModifierScale: gulvet under referencen holder skalaen endelig i en svag pulje", () => {
  assert.ok(Math.abs(finaleModifierScale(0.02, 0.04, 0.1) - 0.2) < 1e-12);
  assert.equal(finaleModifierScale(0.05, 0, 0.1), 0.5);
  assert.equal(finaleModifierScale(0.05, 0, 0), 1, "uden reference og gulv: neutral skala");
  assert.ok(Math.abs(finaleModifierScale(0.02, 0.4, 0.1, 0.1) - 0.2) < 1e-12, "gulvet slaar en lav andel af referencen");
  assert.equal(finaleModifierScale(Number.NaN, 0.4, 0.1), 0);
  assert.equal(finaleModifierScale(0.2, Number.NaN, 0.1), 1);
});

test("computeFinaleAbilityScore: default-skalaen er det gamle additive opgoer (bit-identisk)", () => {
  const ab = abilities(40, { sprint: 70 });
  const legacy = computeFinaleAbilityScore(ab, 0.6, SPRINT, 0.15, "all_out", 0.03, 5, 0.1);
  const explicit = computeFinaleAbilityScore(ab, 0.6, SPRINT, 0.15, "all_out", 0.03, 5, 0.1, 1);
  assert.equal(legacy, explicit);
});

test("computeFinaleAbilityScore: skala 0 = kun det rene evne-led", () => {
  const ab = abilities(40, { sprint: 70 });
  const score = computeFinaleAbilityScore(ab, 1, SPRINT, 0.15, "all_out", 0.1, 5, 0.1, 0);
  assert.equal(score, finaleAbilityTerm(ab, SPRINT));
});

test("#5957: en frisk hjaelperytter uden spurt slaar ikke en traet spurter paa friskhed og dagsform", () => {
  const sprinter = abilities(25, { sprint: 70, acceleration: 60, positioning: 45, flat: 40 });
  const helper = abilities(25, { sprint: 15, acceleration: 15, positioning: 15, flat: 30 });
  const best = finaleAbilityTerm(sprinter, SPRINT);
  const helperAbility = finaleAbilityTerm(helper, SPRINT);
  const args = (reserve: number, form: number) => [SPRINT, EXTRA.wprimeReserveWeight, "normal" as EffortLevel, form, EXTRA.dayformScoreWeight, EXTRA.dayformScoreClamp] as const;

  // En daarlig dag for spurteren og en god dag for hjaelperen (to
  // standardafvigelser af dagsformen hver vej), tom mod fuld reserve.
  const twoSd = 2 * RACE_V4_TUNING.dayform.sd;
  assert.ok(scaleFor(helperAbility, best) < 1, "hjaelperen ligger under kandidat-andelen");
  const sprinterScore = computeFinaleAbilityScore(sprinter, 0, ...args(0, -twoSd), scaleFor(best, best));
  const helperScore = computeFinaleAbilityScore(helper, 1, ...args(1, twoSd), scaleFor(helperAbility, best));
  assert.ok(sprinterScore > helperScore, `spurteren (${sprinterScore}) skal staa foran hjaelperen (${helperScore})`);

  // Kontrol: med det gamle, uskalerede opgoer vendte samme dag raekkefoelgen.
  const helperLegacy = computeFinaleAbilityScore(helper, 1, ...args(1, twoSd));
  const sprinterLegacy = computeFinaleAbilityScore(sprinter, 0, ...args(0, -twoSd));
  assert.ok(helperLegacy > sprinterLegacy, "fejlen #5957 beskriver: friskhed + dagsform alene vendte opgoeret");
});

test("#5957: blandt reelle kandidater kan dagsformen stadig vende opgoeret (favoritten er ikke deterministisk)", () => {
  const favorite = abilities(25, { sprint: 75, acceleration: 60, positioning: 45, flat: 40 });
  const rival = abilities(25, { sprint: 70, acceleration: 58, positioning: 44, flat: 40 });
  const best = finaleAbilityTerm(favorite, SPRINT);
  const rivalAbility = finaleAbilityTerm(rival, SPRINT);
  assert.equal(scaleFor(rivalAbility, best), 1);
  const favScore = computeFinaleAbilityScore(favorite, 0.5, SPRINT, EXTRA.wprimeReserveWeight, "normal", -0.05, EXTRA.dayformScoreWeight, EXTRA.dayformScoreClamp, 1);
  const rivalScore = computeFinaleAbilityScore(rival, 0.5, SPRINT, EXTRA.wprimeReserveWeight, "normal", 0.05, EXTRA.dayformScoreWeight, EXTRA.dayformScoreClamp, 1);
  assert.ok(rivalScore > favScore);
});

test("#5957: scoren med evne-skaleret modifikator er monotont ikke-faldende i rytterens egen evne (fast-check)", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...(Object.keys(SPRINT) as AbilityKey[])),
      fc.integer({ min: 0, max: 98 }),
      fc.integer({ min: 1, max: 30 }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: -0.1, max: 0.1, noNaN: true }),
      fc.constantFrom(...EFFORTS),
      fc.integer({ min: 0, max: 99 }),
      (key, low, step, reserve, form, effort, poolBestRaw) => {
        const high = Math.min(99, low + step);
        const abLow = abilities(20, { [key]: low });
        const abHigh = abilities(20, { [key]: high });
        const poolBest = Math.max(finaleAbilityTerm(abHigh, SPRINT), poolBestRaw / 99);
        const score = (ab: Record<AbilityKey, number>) => computeFinaleAbilityScore(
          ab, reserve, SPRINT, EXTRA.wprimeReserveWeight, effort, form, EXTRA.dayformScoreWeight, EXTRA.dayformScoreClamp,
          scaleFor(finaleAbilityTerm(ab, SPRINT), poolBest),
        );
        return score(abHigh) >= score(abLow) - 1e-12;
      },
    ),
    { numRuns: 300 },
  );
});

test("#5957: tuning-kontrakt — gulvet holder det mindste negative modifikator-udsving under evne-leddets haeldning", () => {
  // Det mest negative udsving en koerende rytter kan faa: indsats-knaek med tom reserve.
  const worst = Math.min(
    ...EFFORTS.map((e) => -EFFORT_GAIN_EXTRA_TUNING.finaleCrack[e]),
    ...EFFORTS.map((e) => EFFORT_GAIN_EXTRA_TUNING.finalePush[e] + EXTRA.wprimeReserveWeight),
  );
  assert.ok(EXTRA.modifierScaleFloor > 0);
  assert.ok(1 + worst / EXTRA.modifierScaleFloor > 0, "d(score)/d(evne-led) skal vaere positiv selv ved gulvet");
  assert.ok(EXTRA.modifierFullScaleShare > 0 && EXTRA.modifierFullScaleShare <= 1);
});
