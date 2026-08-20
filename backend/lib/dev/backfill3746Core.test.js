// backend/lib/dev/backfill3746Core.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { planRider, selectRoleTypes, buildPlan, capsEqual } from "./backfill3746Core.js";
import { VISIBLE_ABILITIES } from "../abilityDerivation.js";

function allAbilities(v) {
  return Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, v]));
}

function baseRow(overrides = {}) {
  return {
    riderId: "r1",
    firstname: "Test",
    lastname: "Rytter",
    birthdate: "1996-05-01", // sæson 2 (2027) ⇒ 31 år
    potentiale: 4,
    teamId: null,
    archetypeDraw: null,
    persistedPrimaryType: "climber",
    persistedSecondaryType: "tt",
    currentAbilities: allAbilities(20),
    currentCaps: allAbilities(0), // bevidst forkert, så planen altid ændrer noget i disse tests
    ...overrides,
  };
}

test("draw-først: archetype_draw vinder over de persisterede typer", () => {
  const row = baseRow({
    archetypeDraw: { primary: "sprinter", secondary: "puncheur" },
    persistedPrimaryType: "climber",
    persistedSecondaryType: "tt",
  });
  const { primary, secondary, source } = selectRoleTypes(row);
  assert.equal(primary, "sprinter");
  assert.equal(secondary, "puncheur");
  assert.equal(source, "draw");

  const plan = planRider(row, 2);
  assert.equal(plan.primary, "sprinter");
  assert.equal(plan.secondary, "puncheur");
  assert.equal(plan.typeSource, "draw");
});

test("uden draw: falder tilbage til de persisterede typer, uændret", () => {
  const row = baseRow({ archetypeDraw: null });
  const { primary, secondary, source } = selectRoleTypes(row);
  assert.equal(primary, "climber");
  assert.equal(secondary, "tt");
  assert.equal(source, "persisted");
});

test("uden draw MEN med draw.primary=null (halvt/tomt objekt): falder også tilbage", () => {
  const row = baseRow({ archetypeDraw: { primary: null, secondary: null } });
  const { primary, source } = selectRoleTypes(row);
  assert.equal(primary, "climber");
  assert.equal(source, "persisted");
});

test("archetype_draw uden secondary falder tilbage til null, ikke til det persisterede secondary (spejler backfillCores.js)", () => {
  const row = baseRow({
    archetypeDraw: { primary: "sprinter" }, // ingen secondary
    persistedPrimaryType: "climber",
    persistedSecondaryType: "tt",
  });
  const { primary, secondary } = selectRoleTypes(row);
  assert.equal(primary, "sprinter");
  assert.equal(secondary, null);
});

test("alders-kontrakten: birthdate mangler ⇒ age=null sendes EKSPLICIT, kaster ikke", () => {
  const row = baseRow({ birthdate: null });
  assert.doesNotThrow(() => planRider(row, 2));
  const plan = planRider(row, 2);
  assert.equal(plan.age, null);
});

test("alders-kontrakten: age regnes via ageForSeason(birthdate, seasonNumber), ikke et vilkårligt tal", () => {
  // LAUNCH_REFERENCE_YEAR = 2026, sæson 2 ⇒ referenceår 2027. Født 1996 ⇒ 31 år.
  const row = baseRow({ birthdate: "1996-05-01" });
  const plan = planRider(row, 2);
  assert.equal(plan.age, 31);
});

test("afrunding: alle 15 caps er hele tal", () => {
  const row = baseRow();
  const plan = planRider(row, 2);
  for (const k of VISIBLE_ABILITIES) {
    assert.ok(Number.isInteger(plan.nye[k]), `${k} skal være et helt tal, var ${plan.nye[k]}`);
  }
});

test("idempotens: kører man planen igen med de NYE caps som gamle, er der intet at ændre", () => {
  const row = baseRow();
  const first = planRider(row, 2);
  assert.equal(first.changed, true); // currentCaps var bevidst forkert i baseRow

  const second = planRider({ ...row, currentCaps: first.nye }, 2);
  assert.equal(second.changed, false);
  assert.ok(capsEqual(second.gamle, second.nye));
});

test("idempotens over buildPlan: anden kørsel af hele planen giver 0 ændrede rækker", () => {
  const rows = [
    baseRow({ riderId: "a" }),
    baseRow({ riderId: "b", archetypeDraw: { primary: "sprinter", secondary: "puncheur" } }),
    baseRow({ riderId: "c", birthdate: null }),
  ];
  const first = buildPlan(rows, 2);
  assert.ok(first.plan.length > 0);

  // Anden kørsel: brug de skrevne caps som "gamle".
  const rowsAfter = rows.map((r, i) => ({ ...r, currentCaps: first.computed[i].nye }));
  const second = buildPlan(rowsAfter, 2);
  assert.equal(second.plan.length, 0);
});

test("gulv-brud er IKKE en fejl (#3794): evne > nyt loft tælles, men gater intet", () => {
  const row = baseRow({
    currentAbilities: allAbilities(99), // langt over ethvert rolle-tag
    currentCaps: allAbilities(99),
  });
  assert.doesNotThrow(() => planRider(row, 2));
  const plan = planRider(row, 2);
  assert.ok(plan.floorBreaches.length > 0, "forventer mindst ét gulv-brud når evnen er 99 overalt");
});

test("to gulv-brud-tal: det REELLE (taperet) tal kan være >= det rå flad-tag-tal, aldrig omvendt for en post-peak rytter", () => {
  // Post-peak (peakAge=28) rytter: taperingen SÆNKER loftet under det rå tag,
  // så en evne der ligger mellem det taperede og det rå loft tæller kun med
  // i floorBreaches (reelt), ikke i floorBreachesFlatTag (design-tallet).
  const row = baseRow({
    birthdate: "1988-01-01", // sæson 2 ⇒ ~39 år, langt forbi peak
    persistedPrimaryType: "climber",
    persistedSecondaryType: "tt",
    currentAbilities: allAbilities(60),
    currentCaps: allAbilities(0),
  });
  const plan = planRider(row, 2);
  assert.ok(plan.floorBreaches.length >= plan.floorBreachesFlatTag.length);
});

test("summarizePlan tæller floor-breaches og op/ned pr. evne-plads over HELE populationen (også uændrede)", () => {
  const rows = [
    baseRow({ riderId: "a" }), // currentCaps=0 ⇒ alt løftes
    baseRow({ riderId: "b", currentAbilities: allAbilities(99), currentCaps: allAbilities(99) }),
  ];
  const { computed, stats } = buildPlan(rows, 2);
  assert.equal(stats.ridersTotal, 2);
  assert.ok(stats.totalFloorBreaches > 0);
  assert.equal(
    stats.totalFloorBreaches,
    computed.reduce((sum, c) => sum + c.floorBreaches.length, 0),
  );
  // mindst én evne-plads skal have registreret et løft (rider "a" starter fra 0)
  const anyUp = Object.values(stats.perAbility).some((a) => a.up > 0);
  assert.ok(anyUp);
});
