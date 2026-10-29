// Kaptajnens lae paa stigningen (KUN s5_profiles_v3, ejer 27/10): team_cp_factor
// naar klatre-selektionen. Aeldre revisioner ser kun klatreevnen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHELTER_CLIMB_WEIGHT_V3, shelteredClimbing } from "./climbSelection.ts";
import type { Entrant } from "../types.ts";

const rider = { abilities: { climbing: 80 } } as unknown as Entrant;

test("aeldre revisioner: klatreevnen er uaendret uanset holdfaktor", () => {
  assert.equal(shelteredClimbing(rider, 1.2, false), 80);
  assert.equal(shelteredClimbing(rider, 0.6, false), 80);
});

test("s5_profiles_v3: laeet loefter kaptajnen proportionalt med vaegten; hjaelperens pris roerer ikke selektionen", () => {
  assert.equal(SHELTER_CLIMB_WEIGHT_V3, 0.25);
  assert.equal(shelteredClimbing(rider, 1, true), 80);
  assert.ok(Math.abs(shelteredClimbing(rider, 1.2, true) - 80 * 1.05) < 1e-9);
  assert.equal(shelteredClimbing(rider, 0.6, true), 80);
});

test("s5_profiles_v3 uden holdfaktor (ingen holdspil): klatreevnen er uaendret", () => {
  assert.equal(shelteredClimbing(rider, undefined, true), 80);
});
