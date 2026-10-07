// backend/lib/engine/v4/form6156.test.ts
// #6156: samlet form (Entrant.form) virker to steder i kernen - jour sans'
// sandsynlighed og et lille, begraenset led paa baereevnen - og er byte-
// identisk med foer, naar feltet mangler.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { initRiderStates } from "./groups.ts";
import { dayformComponent, FORM_CP_TUNING, formCpModifier, jourSansComponent, jourSansProbability } from "./physiology.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type { AbilityKey, Entrant } from "./types.ts";

function abilities(level = 50): Record<AbilityKey, number> {
  return {
    climbing: level, time_trial: level, flat: level, tempo: level, sprint: level, acceleration: level,
    punch: level, endurance: level, recovery: level, durability: level, descending: level,
    cobblestone: level, positioning: level, aggression: level, tactics: level,
  };
}

function entrant(id: string, extra: Partial<Entrant> = {}): Entrant {
  return { rider_id: id, abilities: abilities(), role: "free_role", effort: "normal", condition: 1, ...extra };
}

// ── formCpModifier ──────────────────────────────────────────────────────────

test("#6156 formCpModifier: manglende/ugyldig form er neutral, middel form er neutral", () => {
  for (const f of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(formCpModifier(f as number), 0);
  assert.equal(formCpModifier(FORM_CP_TUNING.neutralForm), 0);
});

test("#6156 formCpModifier: monoton i formen og begraenset af loftet, ogsaa uden for skalaen", () => {
  fc.assert(
    fc.property(fc.double({ min: -500, max: 500, noNaN: true }), fc.double({ min: -500, max: 500, noNaN: true }), (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      assert.ok(formCpModifier(lo) <= formCpModifier(hi));
      assert.ok(Math.abs(formCpModifier(a)) <= FORM_CP_TUNING.maxCp + 1e-12);
    }),
  );
  assert.equal(formCpModifier(100), FORM_CP_TUNING.maxCp);
  assert.equal(formCpModifier(0), -FORM_CP_TUNING.maxCp);
  assert.equal(formCpModifier(250), formCpModifier(100), "over skalaen = loftet");
});

// ── initRiderStates ─────────────────────────────────────────────────────────

test("#6156 initRiderStates: uden Entrant.form er dagsformen praecis den gamle (dagsform + jour sans med form=null)", () => {
  const field = Array.from({ length: 40 }, (_, i) => entrant(`r${i}`));
  const riders = initRiderStates(field, RACE_V4_TUNING, "seed-6156");
  for (const e of field) {
    const expected = dayformComponent({ seed: "seed-6156", riderId: e.rider_id, tuning: RACE_V4_TUNING.dayform })
      + jourSansComponent({ seed: "seed-6156", riderId: e.rider_id, form: null, tuning: RACE_V4_TUNING.dayform });
    assert.equal(Object.is(riders[e.rider_id].dayform, expected), true, e.rider_id);
  }
  // form: null er det samme som et udeladt felt.
  const withNull = initRiderStates(field.map((e) => ({ ...e, form: null })), RACE_V4_TUNING, "seed-6156");
  assert.deepEqual(withNull, riders);
});

test("#6156 initRiderStates: med Entrant.form faar jour sans den rigtige form og baereevnen leddet", () => {
  const seed = "seed-6156-b";
  for (const form of [5, 35, 50, 72, 100]) {
    const [rider] = [entrant("x", { form })];
    const state = initRiderStates([rider], RACE_V4_TUNING, seed).x;
    const expected = dayformComponent({ seed, riderId: "x", tuning: RACE_V4_TUNING.dayform })
      + jourSansComponent({ seed, riderId: "x", form, tuning: RACE_V4_TUNING.dayform })
      + formCpModifier(form);
    assert.equal(state.dayform, expected, `form ${form}`);
  }
});

test("#6156 doktrin: leddet har ingen evne-akse - samme form flytter en svag og en staerk rytter lige meget", () => {
  const seed = "seed-6156-c";
  const delta = (level: number) => {
    const base = initRiderStates([{ ...entrant("x"), abilities: abilities(level) }], RACE_V4_TUNING, seed).x.dayform;
    const peaked = initRiderStates([{ ...entrant("x"), abilities: abilities(level), form: 90 }], RACE_V4_TUNING, seed).x.dayform;
    return peaked - base;
  };
  // Jour sans' udfald afhaenger kun af (seed, rytter, form) - ikke af evnen.
  assert.equal(delta(30), delta(85));
});

test("#6156 jour sans: hoejere samlet form giver faerre daarlige dage over mange etaper", () => {
  const hits = (form: number) => {
    let n = 0;
    for (let s = 0; s < 4000; s++) {
      if (jourSansComponent({ seed: `stage-${s}`, riderId: "x", form, tuning: RACE_V4_TUNING.dayform }) < 0) n++;
    }
    return n;
  };
  assert.ok(jourSansProbability(80, RACE_V4_TUNING.dayform) < jourSansProbability(30, RACE_V4_TUNING.dayform));
  assert.ok(hits(80) < hits(30));
});
