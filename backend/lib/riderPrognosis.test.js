import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  prognoseAbilityEndpoint,
  prognoseAbilities,
  prognoseAbilityBands,
  PROGNOSIS_ENVELOPES,
} from "./riderPrognosis.js";
import { peakAgeForType, ROLE_CLASS_RATE } from "./riderProgression.js";
import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";
import { validateDevelopmentXpParams } from "./developmentXp.ts";
import { expectedCareer, expectedTopRating } from "./developmentXpExpectedTop.ts";
import { bestRoleForAbilities } from "./riderBestRoleCache.js";

// Rytter med luft til alle 15 synlige evner (langt under ethvert rolle-tag,
// så vækst aldrig er nul af en tilfældighed).
const NOW = Object.fromEntries(REGISTRY_ABILITY_KEYS.map((k, i) => [k, 20 + (i % 5) * 3]));

test("prognoseAbilityEndpoint er deterministisk (samme input → samme output)", () => {
  const args = {
    current: 30, cap: 80, age: 18, peakAge: 28,
    roleRate: ROLE_CLASS_RATE.signatur, potRate: 0.5, envelope: PROGNOSIS_ENVELOPES.dedikeret,
  };
  assert.equal(prognoseAbilityEndpoint(args), prognoseAbilityEndpoint({ ...args }));
});

test("prognoseAbilityEndpoint: gap 0 giver ingen vækst", () => {
  const v = prognoseAbilityEndpoint({
    current: 70, cap: 70, age: 18, peakAge: 28,
    roleRate: ROLE_CLASS_RATE.signatur, potRate: 0.89, envelope: PROGNOSIS_ENVELOPES.dedikeret,
  });
  assert.equal(v, 70);
});

test("prognoseAbilityEndpoint: dedikeret envelope når mindst lige så langt som spredt", () => {
  const base = {
    current: 30, cap: 90, age: 17, peakAge: 28,
    roleRate: ROLE_CLASS_RATE.signatur, potRate: 0.6,
  };
  const spredt = prognoseAbilityEndpoint({ ...base, envelope: PROGNOSIS_ENVELOPES.spredt });
  const dedikeret = prognoseAbilityEndpoint({ ...base, envelope: PROGNOSIS_ENVELOPES.dedikeret });
  assert.ok(dedikeret >= spredt, `dedikeret (${dedikeret}) skal nå mindst lige så langt som spredt (${spredt})`);
});

test("prognoseAbilityEndpoint: clamp [0,99]", () => {
  const v = prognoseAbilityEndpoint({
    current: 98, cap: 99, age: 16, peakAge: 28,
    roleRate: ROLE_CLASS_RATE.signatur, potRate: 0.89, envelope: PROGNOSIS_ENVELOPES.dedikeret,
  });
  assert.ok(v >= 0 && v <= 99);
});

test("prognoseAbilities: post-peak-rytter giver endpoint = nuværende evne (ingen vækst efter peak)", () => {
  const type = "climber";
  const peakAge = peakAgeForType(type);
  const out = prognoseAbilities({
    nowAbilities: NOW, age: peakAge + 3, primaryType: type, secondaryType: null,
    potentiale: 6, envelope: PROGNOSIS_ENVELOPES.dedikeret,
  });
  for (const [ability, endpoint] of Object.entries(out)) {
    assert.equal(endpoint, Math.round(Math.max(0, Math.min(99, NOW[ability]))), `${ability}: post-peak skal stå stille`);
  }
});

test("prognoseAbilities er deterministisk", () => {
  const args = {
    nowAbilities: NOW, age: 19, primaryType: "sprinter", secondaryType: "puncheur",
    potentiale: 4, envelope: PROGNOSIS_ENVELOPES.spredt,
  };
  assert.deepEqual(prognoseAbilities(args), prognoseAbilities({ ...args }));
});

test("prognoseAbilityBands: lo <= hi for alle evner, heltal", () => {
  const bands = prognoseAbilityBands({
    nowAbilities: NOW, age: 19, primaryType: "gc", secondaryType: "climber",
    potLo: 2.5, potHi: 5.5,
  });
  for (const [ability, b] of Object.entries(bands)) {
    assert.ok(Number.isInteger(b.lo) && Number.isInteger(b.hi), ability);
    assert.ok(b.lo <= b.hi, `${ability}: lo ${b.lo} > hi ${b.hi}`);
  }
});

test("prognoseAbilityBands: post-peak-rytter giver bånd = nuværende evne (lo == hi == now)", () => {
  const type = "rouleur";
  const peakAge = peakAgeForType(type);
  const bands = prognoseAbilityBands({
    nowAbilities: NOW, age: peakAge + 5, primaryType: type, secondaryType: null,
    potLo: 1, potHi: 6,
  });
  for (const [ability, b] of Object.entries(bands)) {
    const now = Math.round(Math.max(0, Math.min(99, NOW[ability])));
    assert.equal(b.lo, now, `${ability} lo`);
    assert.equal(b.hi, now, `${ability} hi`);
  }
});

test("prognoseAbilityBands er deterministisk på tværs af to kald", () => {
  const args = {
    nowAbilities: NOW, age: 20, primaryType: "baroudeur", secondaryType: "tt",
    potLo: 3, potHi: 5,
  };
  assert.deepEqual(prognoseAbilityBands(args), prognoseAbilityBands({ ...args }));
});

test("PROGNOSIS_ENVELOPES: dedikeret > spredt (definitionen af de to træningsstile)", () => {
  assert.ok(PROGNOSIS_ENVELOPES.dedikeret > PROGNOSIS_ENVELOPES.spredt);
});

// ── #7684: XP-modellen (samme kilde som skønnet) ──────────────────────────────

// Frossen golden (#7587): hashen er regnet på merge-base-koden (9ad395c7c) før
// XP-grenen kom ind, ikke på den nye kodes egen slukkede gren. Uden developmentXp
// skal prognosen være bit-identisk med den.
const FROZEN_OFF_HASH = "7ddf7c8eda406bcfcbd8048f451b87e49d832fa6b24d9bc7f77d4793be5d0acd";

function prognosisGrid() {
  const types = ["climber", "sprinter", "tt", "gc", "puncheur", "rouleur", "baroudeur", "brostensrytter"];
  const out = [];
  for (let i = 0; i < 48; i++) {
    const now = Object.fromEntries(REGISTRY_ABILITY_KEYS.map((k, j) => [k, 15 + ((i * 11 + j * 7) % 70)]));
    const age = 16 + (i % 21);
    const primaryType = types[i % 8];
    const secondaryType = i % 3 ? types[(i + 5) % 8] : null;
    for (const potentiale of [1, 2.5, 4, 6]) {
      for (const envelope of Object.values(PROGNOSIS_ENVELOPES)) {
        out.push(prognoseAbilities({ nowAbilities: now, age, primaryType, secondaryType, potentiale, envelope }));
      }
    }
    out.push(prognoseAbilityBands({ nowAbilities: now, age, primaryType, secondaryType, potLo: 1 + (i % 4), potHi: 3 + (i % 4) }));
  }
  return createHash("sha256").update(JSON.stringify(out)).digest("hex");
}

test("uden XP er prognosen bit-identisk med merge-base (frossen golden)", () => {
  assert.equal(prognosisGrid(), FROZEN_OFF_HASH);
});

// Syntetiske XP-tal, ikke kalibreringen (privat, hard rule 17).
const XP = validateDevelopmentXpParams({
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
const XP_RIDER = { nowAbilities: NOW, age: 20, primaryType: "climber", secondaryType: "puncheur", riderId: "r1" };

test("XP: prognosen er standardkarrierens top, samme kilde som skønnets sande tal", () => {
  const out = prognoseAbilities({ ...XP_RIDER, potentiale: 4, envelope: PROGNOSIS_ENVELOPES.spredt, developmentXp: XP });
  const career = expectedCareer({ id: "r1", abilities: NOW, age: 20, potentiale: 4, primaryType: "climber", secondaryType: "puncheur" }, XP);
  const rating = bestRoleForAbilities(out, { primaryType: "climber", secondaryType: "puncheur" }).best_role_rating;
  assert.equal(rating, career.rating);
  assert.equal(rating, expectedTopRating({ id: "r1", abilities: NOW, age: 20, potentiale: 4, primaryType: "climber", secondaryType: "puncheur" }, XP));
});

test("XP: NULL-evner forbliver manglende i prognosen, ingen opdigtet nul-prognose (Codex-fund PR #8044)", () => {
  const missing = REGISTRY_ABILITY_KEYS.filter((_, i) => i % 3 === 0);
  const withNulls = { ...NOW, ...Object.fromEntries(missing.map((a) => [a, null])) };
  const present = Object.fromEntries(Object.entries(NOW).filter(([a]) => !missing.includes(a)));
  const args = { ...XP_RIDER, potentiale: 4, envelope: PROGNOSIS_ENVELOPES.spredt, developmentXp: XP };
  const out = prognoseAbilities({ ...args, nowAbilities: withNulls });
  for (const a of missing) assert.equal(a in out, false, `${a} fik en prognose`);
  assert.deepEqual(out, prognoseAbilities({ ...args, nowAbilities: present }));
  const allNull = Object.fromEntries(REGISTRY_ABILITY_KEYS.map((a) => [a, null]));
  assert.deepEqual(prognoseAbilities({ ...args, nowAbilities: allNull }), {});
});

test("XP: envelopen flytter intet, kun potentialet", () => {
  const spredt = prognoseAbilities({ ...XP_RIDER, potentiale: 4, envelope: PROGNOSIS_ENVELOPES.spredt, developmentXp: XP });
  const dedikeret = prognoseAbilities({ ...XP_RIDER, potentiale: 4, envelope: PROGNOSIS_ENVELOPES.dedikeret, developmentXp: XP });
  assert.deepEqual(spredt, dedikeret);
});

test("XP: ingen evne under sit nu, og båndet er heltal med lo <= hi", () => {
  for (const age of [17, 22, 27, 31, 35, 40]) {
    const bands = prognoseAbilityBands({ ...XP_RIDER, age, potLo: 2, potHi: 5, developmentXp: XP });
    for (const [ability, b] of Object.entries(bands)) {
      assert.ok(Number.isInteger(b.lo) && Number.isInteger(b.hi), ability);
      assert.ok(b.lo <= b.hi, `${ability} ${age}: lo ${b.lo} > hi ${b.hi}`);
      assert.ok(b.lo >= NOW[ability], `${ability} ${age}: under nu`);
    }
  }
});

test("XP: båndets top er aldrig under bunden i rating, og deterministisk", () => {
  const args = { ...XP_RIDER, potLo: 1.5, potHi: 5.5, developmentXp: XP };
  const bands = prognoseAbilityBands(args);
  assert.deepEqual(bands, prognoseAbilityBands({ ...args }));
  const lo = Object.fromEntries(Object.entries(bands).map(([a, b]) => [a, b.lo]));
  const hi = Object.fromEntries(Object.entries(bands).map(([a, b]) => [a, b.hi]));
  const rate = (ab) => bestRoleForAbilities(ab, { primaryType: "climber", secondaryType: "puncheur" }).best_role_rating;
  assert.ok(rate(hi) >= rate(lo));
});
