import test from "node:test";
import assert from "node:assert/strict";
import {
  focusSlotState,
  computeTrainingSlotHealth,
  evaluateSlotHealthAlert,
  typicalRaceDayTicksPerTeam,
  calendarDayEquivalents,
  TRAINING_SLOT_HEALTH_TUNING,
} from "./trainingSlotHealth.js";
import { ALL_SESSIONS } from "./trainingDayTypes.js";
import { TRAINING_RACE_DAY_CONFIG, raceDayBudgetDivisor } from "./trainingRaceDayTick.js";

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
  // Vagten rapporterer ÉN række pr. session i ALL_SESSIONS, også med nul-tal
  // (#3762: uden restitution). Tallet bindes til listen frem for at stå som en
  // literal, så et nyt split (#4631: to intervaldage mere) ikke fejler som en
  // regression i en vagt der bare tæller flere rækker.
  assert.equal(rows.length, ALL_SESSIONS.length, "alle sessioner rapporteres, også med nul-tal");
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
  assert.equal(rows.length, ALL_SESSIONS.length);
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

// ── #4848 / gate G9: spring-gaten på løbsdags-kadencen ────────────────────────

const J = TRAINING_SLOT_HEALTH_TUNING.deadJumpAbsolute;

test("evaluateSlotHealthAlert G9: trainingDays udeladt/1/under 1 er BIT-IDENTISK med den gamle gate", () => {
  const cases = [
    [{ ridersInTraining: 2319, deadSlots: 117, partialSlots: 741 }, { ridersInTraining: 2319, deadSlots: 90, partialSlots: 700 }],
    [{ ridersInTraining: 2319, deadSlots: 117, partialSlots: 741 }, { ridersInTraining: 2319, deadSlots: 115, partialSlots: 738 }],
    [{ ridersInTraining: 1000, deadSlots: 80, partialSlots: 0 }, { ridersInTraining: 1000, deadSlots: 79, partialSlots: 0 }],
    [{ ridersInTraining: 0, deadSlots: 0, partialSlots: 0 }, null],
  ];
  for (const [today, prev] of cases) {
    const base = evaluateSlotHealthAlert(today, prev);
    assert.equal(base.jumpScale, 1);
    for (const trainingDays of [undefined, 1, 0.4, 0, NaN, -3]) {
      assert.deepEqual(evaluateSlotHealthAlert(today, prev, undefined, { trainingDays }), base, `trainingDays=${trainingDays}`);
    }
  }
});

test("evaluateSlotHealthAlert G9: et efterslæbs-interval med mere træning end én dag giver IKKE falsk alarm", () => {
  // Springet svarer præcis til loftet pr. kalenderdag, men intervallet rummede to
  // kalenderdags-ækvivalenter træning (fx en division der tog et efterslæb).
  const prev = { ridersInTraining: 2000, deadSlots: 50, partialSlots: 0 };
  const today = { ridersInTraining: 2000, deadSlots: 50 + J, partialSlots: 0 };
  assert.equal(evaluateSlotHealthAlert(today, prev).shouldAlert, true, "kontrol: gammel gate fyrer");
  const scaled = evaluateSlotHealthAlert(today, prev, undefined, { trainingDays: 2 });
  assert.equal(scaled.shouldAlert, false);
  assert.equal(scaled.jumpScale, 2);
});

test("evaluateSlotHealthAlert G9: et ÆGTE spring fanges stadig på løbsdags-kadencen", () => {
  const prev = { ridersInTraining: 2000, deadSlots: 50, partialSlots: 0 };
  const today = { ridersInTraining: 2000, deadSlots: 50 + 2 * J, partialSlots: 0 };
  const res = evaluateSlotHealthAlert(today, prev, undefined, { trainingDays: 2 });
  assert.equal(res.shouldAlert, true);
  assert.match(res.reasons.join(" "), /løbsdags-tick/);
});

test("evaluateSlotHealthAlert G9: andels-gaten er kadence-uafhængig (skaleres ikke)", () => {
  const res = evaluateSlotHealthAlert(
    { ridersInTraining: 1000, deadSlots: 80, partialSlots: 0 },
    { ridersInTraining: 1000, deadSlots: 79, partialSlots: 0 },
    undefined,
    { trainingDays: 5 }
  );
  assert.equal(res.shouldAlert, true);
  assert.match(res.reasons.join(" "), /helt døde/);
});

test("typicalRaceDayTicksPerTeam: median af distinkte løbsdage pr. hold; trupper kollapser", () => {
  const rows = [];
  // Tre hold à fem løbsdage, heraf ét med en U23-trup på de samme løbsdage.
  for (const team of ["A", "B", "C"]) {
    for (let gd = 10; gd < 15; gd++) rows.push({ team_id: team, season_id: "s4", game_day: gd });
  }
  for (let gd = 10; gd < 15; gd++) rows.push({ team_id: "A", season_id: "s4", game_day: gd }); // U23-trup
  // Ét hold tog et efterslæb (otte løbsdage) — medianen må ikke flytte sig.
  for (let gd = 3; gd < 11; gd++) rows.push({ team_id: "D", season_id: "s4", game_day: gd });
  rows.push({ team_id: "E", season_id: null, game_day: null }); // gammel nøgle ignoreres
  // Median af [5, 5, 5, 8] = 5.
  assert.equal(typicalRaceDayTicksPerTeam(rows), 5);
});

test("typicalRaceDayTicksPerTeam: ingen løbsdags-rækker → 0; ulige antal hold → midterste", () => {
  assert.equal(typicalRaceDayTicksPerTeam([]), 0);
  assert.equal(typicalRaceDayTicksPerTeam(null), 0);
  assert.equal(typicalRaceDayTicksPerTeam([{ team_id: "A", game_day: null }]), 0);
  const rows = [
    { team_id: "A", season_id: "s", game_day: 1 },
    { team_id: "B", season_id: "s", game_day: 1 }, { team_id: "B", season_id: "s", game_day: 2 },
    { team_id: "C", season_id: "s", game_day: 1 }, { team_id: "C", season_id: "s", game_day: 2 }, { team_id: "C", season_id: "s", game_day: 3 },
  ];
  assert.equal(typicalRaceDayTicksPerTeam(rows), 2);
});

test("typicalRaceDayTicksPerTeam: samme game_day i to sæsoner er to ticks (sæsonskifte i intervallet)", () => {
  const rows = [
    { team_id: "A", season_id: "s3", game_day: 0 },
    { team_id: "A", season_id: "s4", game_day: 0 },
  ];
  assert.equal(typicalRaceDayTicksPerTeam(rows), 2);
});

test("calendarDayEquivalents G9: en normal løbsdato ≈ én kalenderdags træning (G1-deleren)", () => {
  const cfg = TRAINING_RACE_DAY_CONFIG;
  // En normal kalenderdato bærer sæsonens løbsdage fordelt på lige så mange datoer
  // som den gamle kalenderdags-sæson havde ticks.
  const raceDaysPerDate = cfg.raceDaysPerSeason / cfg.legacyDaysPerSeason;
  const eq = calendarDayEquivalents({
    raceDayTicks: raceDaysPerDate,
    raceDayBudgetDivisor: raceDayBudgetDivisor(cfg),
    legacyDaysPerSeason: cfg.legacyDaysPerSeason,
  });
  // Deleren bevarer sæsonens samlede udvikling, så én løbsdato skal ligge tæt på
  // én kalenderdag — IKKE på antallet af løbsdage. Det er hele pointen: at dividere
  // med rå ticks ville gøre vagten blind.
  assert.ok(eq > 0.75 && eq < 1.5, `ækvivalenter ${eq}`);
  assert.ok(eq < raceDaysPerDate / 2);
});

test("calendarDayEquivalents: ugyldige input → null, nul ticks → 0", () => {
  assert.equal(calendarDayEquivalents({ raceDayTicks: 5, raceDayBudgetDivisor: 0, legacyDaysPerSeason: 28 }), null);
  assert.equal(calendarDayEquivalents({ raceDayTicks: 5, raceDayBudgetDivisor: 100, legacyDaysPerSeason: 0 }), null);
  assert.equal(calendarDayEquivalents({ raceDayTicks: -1, raceDayBudgetDivisor: 100, legacyDaysPerSeason: 28 }), null);
  assert.equal(calendarDayEquivalents({ raceDayTicks: NaN, raceDayBudgetDivisor: 100, legacyDaysPerSeason: 28 }), null);
  assert.equal(calendarDayEquivalents(), null);
  assert.equal(calendarDayEquivalents({ raceDayTicks: 0, raceDayBudgetDivisor: 100, legacyDaysPerSeason: 28 }), 0);
});
