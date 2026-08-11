import test from "node:test";
import assert from "node:assert/strict";
import {
  focusSlotState,
  computeTrainingSlotHealth,
  evaluateSlotHealthAlert,
  TRAINING_SLOT_HEALTH_TUNING,
} from "./trainingSlotHealth.js";

// Hjælper: en rider_derived_abilities-agtig række. Kun de evner testen bruger
// sættes; cappedVisibleAbilities springer ikke-numeriske felter over.
function abilityRow(riderId, values, caps) {
  return { rider_id: riderId, ...values, ability_caps: caps };
}

// ── focusSlotState ────────────────────────────────────────────────────────────

test("focusSlotState: partial er tilstanden fladen var blind for (de 291 climbing-ryttere)", () => {
  assert.equal(focusSlotState("vo2max", ["climbing"]), "partial");
  assert.equal(focusSlotState("vo2max", ["climbing", "punch", "tempo"]), "dead");
  assert.equal(focusSlotState("vo2max", []), "open");
  assert.equal(focusSlotState("vo2max", ["sprint"]), "open", "evne uden for fokusset tæller ikke");
  assert.equal(focusSlotState("ikke-et-fokus", ["climbing"]), null);
});

// ── computeTrainingSlotHealth ─────────────────────────────────────────────────

test("computeTrainingSlotHealth: tæller dead/partial/open pr. fokus mod ÆGTE cap-logik", () => {
  const riders = [
    { id: "r-dead", primary_type: "climber" },
    { id: "r-partial", primary_type: "climber" },
    { id: "r-open", primary_type: "climber" },
  ];
  const planByRiderId = { "r-dead": "vo2max", "r-partial": "vo2max", "r-open": "vo2max" };
  const abilityRows = [
    abilityRow("r-dead", { climbing: 70, punch: 62, tempo: 58 }, { climbing: 70, punch: 62, tempo: 58 }),
    abilityRow("r-partial", { climbing: 70, punch: 40, tempo: 41 }, { climbing: 70, punch: 62, tempo: 58 }),
    abilityRow("r-open", { climbing: 51, punch: 40, tempo: 41 }, { climbing: 70, punch: 62, tempo: 58 }),
  ];

  const { rows, totals } = computeTrainingSlotHealth({ riders, planByRiderId, abilityRows });
  const vo2 = rows.find((r) => r.focus === "vo2max");
  assert.deepEqual(vo2, { focus: "vo2max", ridersInTraining: 3, deadSlots: 1, partialSlots: 1 });
  assert.deepEqual(totals, { ridersInTraining: 3, deadSlots: 1, partialSlots: 1 });
  assert.equal(rows.length, 6, "alle seks fokus rapporteres, også med nul-tal");
});

test("computeTrainingSlotHealth: ryttere UDEN plan tælles under assistentens fokus", () => {
  // Det værste tilfælde: spilleren har aldrig valgt fokusset selv, så han leder
  // slet ikke efter det. smartDefaultFocus("sprinter") = sprint.
  const riders = [{ id: "r1", primary_type: "sprinter" }];
  const abilityRows = [abilityRow("r1", { sprint: 80, acceleration: 76 }, { sprint: 80, acceleration: 76 })];
  const { rows } = computeTrainingSlotHealth({ riders, planByRiderId: {}, abilityRows });
  assert.equal(rows.find((r) => r.focus === "sprint").deadSlots, 1);
});

test("computeTrainingSlotHealth: rytter uden afledte evner tælles slet ikke", () => {
  const { totals } = computeTrainingSlotHealth({
    riders: [{ id: "ny", primary_type: "climber" }],
    planByRiderId: { ny: "vo2max" },
    abilityRows: [],
  });
  assert.deepEqual(totals, { ridersInTraining: 0, deadSlots: 0, partialSlots: 0 });
});

test("computeTrainingSlotHealth: tomt input giver nul-rækker, ikke tom liste", () => {
  const { rows, totals } = computeTrainingSlotHealth();
  assert.equal(rows.length, 6);
  assert.equal(totals.ridersInTraining, 0);
});

// ── evaluateSlotHealthAlert ───────────────────────────────────────────────────
// Designprincip 5 (spec §4): en ny gate skal BEVISES at fejle på den defekte
// tilstand. Her er "den defekte tilstand" ikke hypotetisk — det er prod 11/8.

test("evaluateSlotHealthAlert: NEGATIV-TEST — fyrer på en 11/8-agtig forværring", () => {
  // Prod 11/8: 117 helt døde af 2.319 = 5,0 %, altså UNDER andels-loftet. Det er
  // med vilje: andels-gaten alene ville have tiet. Ryttertype-migrationen dræbte
  // 35 slots samme dag — spring-gaten er den der skal fange begivenheden.
  const iGaar = { ridersInTraining: 2319, deadSlots: 90, partialSlots: 700 };
  const iDag = { ridersInTraining: 2319, deadSlots: 117, partialSlots: 741 };
  const kunAndel = evaluateSlotHealthAlert(iDag, null);
  assert.equal(kunAndel.shouldAlert, false, "5,0 % ligger under loftet — derfor findes spring-gaten");

  const medSpring = evaluateSlotHealthAlert(iDag, iGaar);
  assert.equal(medSpring.shouldAlert, true);
  assert.match(medSpring.reasons.join(" "), /steg 27/);
});

test("evaluateSlotHealthAlert: andels-loftet fanger den langsomme forværring uden spring", () => {
  const res = evaluateSlotHealthAlert(
    { ridersInTraining: 1000, deadSlots: 80, partialSlots: 0 },
    { ridersInTraining: 1000, deadSlots: 79, partialSlots: 0 }
  );
  assert.equal(res.shouldAlert, true);
  assert.equal(Math.round(res.deadShare * 1000), 80);
  assert.match(res.reasons.join(" "), /helt døde/);
});

test("evaluateSlotHealthAlert: rolig dag alarmerer ikke, og nul ryttere deler ikke med nul", () => {
  assert.equal(
    evaluateSlotHealthAlert(
      { ridersInTraining: 2319, deadSlots: 117, partialSlots: 741 },
      { ridersInTraining: 2319, deadSlots: 115, partialSlots: 738 }
    ).shouldAlert,
    false
  );
  const tom = evaluateSlotHealthAlert({ ridersInTraining: 0, deadSlots: 0, partialSlots: 0 }, null);
  assert.equal(tom.shouldAlert, false);
  assert.equal(tom.deadShare, 0);
});

test("evaluateSlotHealthAlert: tuning-konstanterne er dem vagten faktisk kører på", () => {
  assert.equal(TRAINING_SLOT_HEALTH_TUNING.deadShareCeiling, 0.07);
  assert.equal(TRAINING_SLOT_HEALTH_TUNING.deadJumpAbsolute, 15);
});
