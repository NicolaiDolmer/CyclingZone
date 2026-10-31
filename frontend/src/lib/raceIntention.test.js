// Løbsdagens intention (#4632) — ren logik-test for raceIntention.js.
// Ingen React, ingen DOM: samme mønster som stageRoleMatrixLogic.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import {
  EFFORT_SCALE,
  orderedEfforts,
  intentionFor,
  setIntention,
  copyStageIntentions,
  nextEditableStage,
  stageIntentionCounts,
  untouchedStages,
  isIndividualTimeTrialProfile,
  effortsForStage,
  effortForStage,
  withIndividualTimeTrialEfforts,
} from "./raceIntention.js";
import { buildDraftMatrix, diffToOverrides } from "./stageRoleMatrixLogic.js";

const RIDERS = [
  { rider_id: "r1", name: "Rider One", race_role: "captain" },
  { rider_id: "r2", name: "Rider Two", race_role: "helper" },
  { rider_id: "r3", name: "Rider Three", race_role: "sprint_captain" },
];

// Etapeløb midt i afviklingen: etape 1-2 kørt, 3-5 redigerbare.
function stageRaceMatrix(overrides = []) {
  return buildDraftMatrix({
    riders: RIDERS,
    overrides,
    stageNumbers: [1, 2, 3, 4, 5],
    stagesCompleted: 2,
  });
}

test("orderedEfforts: flaget OFF giver TRE trin, ON giver FEM — altid i skala-rækkefølge", () => {
  // Serverens OFF-vokabular (VALID_EFFORTS) er IKKE i skala-rækkefølge; fladen
  // skal alligevel vise letteste → hårdeste.
  assert.deepEqual(orderedEfforts(["protect", "normal", "save"]), ["save", "normal", "protect"]);
  assert.deepEqual(
    orderedEfforts(["grupetto", "save", "normal", "protect", "all_out"]),
    ["grupetto", "save", "normal", "protect", "all_out"],
  );
  assert.deepEqual(orderedEfforts(["grupetto", "save", "normal", "protect", "all_out"]), [...EFFORT_SCALE]);
});

test("orderedEfforts: intet vokabular fra serveren → kun 'normal' (aldrig en hardkodet femtrins-liste)", () => {
  assert.deepEqual(orderedEfforts(undefined), ["normal"]);
  assert.deepEqual(orderedEfforts([]), ["normal"]);
});

test("orderedEfforts: et trin serveren kender og denne build ikke, tabes ikke lydløst", () => {
  assert.deepEqual(orderedEfforts(["normal", "future_step"]), ["normal", "future_step"]);
});

test("ikke valgt = rollens standard: en urørt celle er 'normal' for alle roller", () => {
  const matrix = stageRaceMatrix();
  for (const rider of RIDERS) {
    assert.equal(intentionFor({ matrix, stageNumber: 3, riderId: rider.rider_id }), "normal");
  }
  // Og der er intet at gemme: en urørt draft giver et tomt payload.
  assert.deepEqual(diffToOverrides({ matrix, riders: RIDERS }), []);
});

test("gem sender kun de ryttere der er ændret på den åbne etape", () => {
  let matrix = stageRaceMatrix();
  matrix = setIntention({ matrix, stageNumber: 3, riderId: "r1", effort: "all_out" });
  matrix = setIntention({ matrix, stageNumber: 3, riderId: "r3", effort: "grupetto" });

  const payload = diffToOverrides({ matrix, riders: RIDERS });
  assert.deepEqual(payload, [
    { stage_number: 3, rider_id: "r1", race_role: "captain", effort: "all_out" },
    { stage_number: 3, rider_id: "r3", race_role: "sprint_captain", effort: "grupetto" },
  ]);
  // Rytteren der stod på rollens standard er IKKE med — passivitet skriver
  // ingen række.
  assert.ok(!payload.some((o) => o.rider_id === "r2"));
});

test("gem taber ALDRIG en intention på en anden kommende etape (PUT'en er REPLACE)", () => {
  // Etape 4 har allerede en gemt intention; spilleren rører kun etape 3.
  let matrix = stageRaceMatrix([
    { stage_number: 4, rider_id: "r2", race_role: "helper", effort: "save" },
  ]);
  matrix = setIntention({ matrix, stageNumber: 3, riderId: "r1", effort: "protect" });

  const payload = diffToOverrides({ matrix, riders: RIDERS });
  assert.deepEqual(payload, [
    { stage_number: 3, rider_id: "r1", race_role: "captain", effort: "protect" },
    { stage_number: 4, rider_id: "r2", race_role: "helper", effort: "save" },
  ]);
});

test("kørte etaper kommer aldrig med i draften — og kan derfor aldrig gemmes", () => {
  const matrix = stageRaceMatrix([
    { stage_number: 1, rider_id: "r1", race_role: "captain", effort: "protect" },
  ]);
  assert.equal(matrix[1], undefined);
  assert.equal(matrix[2], undefined);
  assert.deepEqual(diffToOverrides({ matrix, riders: RIDERS }), []);
});

test("kopiér til næste etape flytter intentionerne, ikke rollerne", () => {
  let matrix = stageRaceMatrix();
  matrix = setIntention({ matrix, stageNumber: 3, riderId: "r1", effort: "all_out" });
  matrix = setIntention({ matrix, stageNumber: 3, riderId: "r2", effort: "save" });

  const next = nextEditableStage({ editableStages: [3, 4, 5], stageNumber: 3 });
  assert.equal(next, 4);

  matrix = copyStageIntentions({ matrix, fromStage: 3, toStage: next, riders: RIDERS });
  assert.equal(intentionFor({ matrix, stageNumber: 4, riderId: "r1" }), "all_out");
  assert.equal(intentionFor({ matrix, stageNumber: 4, riderId: "r2" }), "save");
  assert.equal(intentionFor({ matrix, stageNumber: 4, riderId: "r3" }), "normal");
  // Rollen er løbs-bred og må ikke rejse med kopien.
  assert.equal(matrix[4].r1.race_role, "captain");
  assert.equal(matrix[4].r2.race_role, "helper");
  // Etape 5 er urørt.
  assert.equal(intentionFor({ matrix, stageNumber: 5, riderId: "r1" }), "normal");
});

test("kopiér springer udgåede ryttere over", () => {
  const riders = [...RIDERS, { rider_id: "r4", name: "Out", race_role: "helper", abandoned: true }];
  let matrix = buildDraftMatrix({ riders, overrides: [], stageNumbers: [3, 4], stagesCompleted: 2 });
  matrix = setIntention({ matrix, stageNumber: 3, riderId: "r4", effort: "save" });
  matrix = copyStageIntentions({ matrix, fromStage: 3, toStage: 4, riders });
  assert.equal(intentionFor({ matrix, stageNumber: 4, riderId: "r4" }), "normal");
});

test("nextEditableStage: sidste etape har ingen 'kopiér til'-modtager", () => {
  assert.equal(nextEditableStage({ editableStages: [3, 4, 5], stageNumber: 5 }), null);
  // Endagsløb: én etape, ingen næste.
  assert.equal(nextEditableStage({ editableStages: [1], stageNumber: 1 }), null);
});

test("fodlinjen tæller sat vs. rollens standard, og udgåede tæller ikke med", () => {
  const riders = [...RIDERS, { rider_id: "r4", name: "Out", race_role: "helper", abandoned: true }];
  let matrix = buildDraftMatrix({ riders, overrides: [], stageNumbers: [3, 4, 5], stagesCompleted: 2 });
  matrix = setIntention({ matrix, stageNumber: 3, riderId: "r1", effort: "all_out" });

  assert.deepEqual(stageIntentionCounts({ matrix, riders, stageNumber: 3 }), { set: 1, onDefault: 2 });
  assert.deepEqual(untouchedStages({ matrix, riders, editableStages: [3, 4, 5], exceptStage: 3 }), [4, 5]);

  matrix = setIntention({ matrix, stageNumber: 5, riderId: "r2", effort: "grupetto" });
  assert.deepEqual(untouchedStages({ matrix, riders, editableStages: [3, 4, 5], exceptStage: 3 }), [4]);
});

test("endagsløb: én redigerbar 'etape', og intentionen gemmes på stage_number 1", () => {
  let matrix = buildDraftMatrix({ riders: RIDERS, overrides: [], stageNumbers: [1], stagesCompleted: 0 });
  assert.deepEqual(Object.keys(matrix), ["1"]);
  matrix = setIntention({ matrix, stageNumber: 1, riderId: "r1", effort: "all_out" });
  assert.deepEqual(diffToOverrides({ matrix, riders: RIDERS }), [
    { stage_number: 1, rider_id: "r1", race_role: "captain", effort: "all_out" },
  ]);
  assert.deepEqual(stageIntentionCounts({ matrix, riders: RIDERS, stageNumber: 1 }), { set: 1, onDefault: 2 });
  assert.deepEqual(untouchedStages({ matrix, riders: RIDERS, editableStages: [1], exceptStage: 1 }), []);
});

// #7332 (ejer 31/10): enkeltstart = kun Kør roligt, Normal og Alt ud.
const FIVE = ["grupetto", "save", "normal", "protect", "all_out"];

test("#7332: kun itt og itt_hilly er enkeltstart, holdtidskørsel er ikke", () => {
  assert.equal(isIndividualTimeTrialProfile("itt"), true);
  assert.equal(isIndividualTimeTrialProfile("itt_hilly"), true);
  for (const p of ["ttt", "flat", "mountain", "hilly", "", null, undefined, 7]) {
    assert.equal(isIndividualTimeTrialProfile(p), false, String(p));
  }
});

test("#7332: effortsForStage skjuler grupetto og protect paa en enkeltstart", () => {
  assert.deepEqual(effortsForStage(FIVE, "itt"), ["save", "normal", "all_out"]);
  assert.deepEqual(effortsForStage(FIVE, "itt_hilly"), ["save", "normal", "all_out"]);
  // Alle andre etaper (ogsaa ttt og en ukendt profil) faar praecis serverens trin.
  assert.deepEqual(effortsForStage(FIVE, "ttt"), FIVE);
  assert.deepEqual(effortsForStage(FIVE, "flat"), FIVE);
  assert.deepEqual(effortsForStage(FIVE, undefined), FIVE);
  // Flaget OFF (tre trin): protect forsvinder ogsaa, save og normal bliver.
  assert.deepEqual(effortsForStage(["protect", "normal", "save"], "itt"), ["save", "normal"]);
});

test("#7332: effortForStage goer grupetto/protect til save paa en enkeltstart", () => {
  for (const p of ["itt", "itt_hilly"]) {
    assert.equal(effortForStage("grupetto", p), "save");
    assert.equal(effortForStage("protect", p), "save");
    for (const e of ["save", "normal", "all_out"]) assert.equal(effortForStage(e, p), e);
  }
  for (const p of ["ttt", "flat", null]) {
    for (const e of FIVE) assert.equal(effortForStage(e, p), e);
  }
});

test("#7332: kopi til en enkeltstart lander som save, kopi til andre etaper er uaendret", () => {
  let matrix = stageRaceMatrix();
  matrix = setIntention({ matrix, stageNumber: 3, riderId: "r1", effort: "grupetto" });
  matrix = setIntention({ matrix, stageNumber: 3, riderId: "r2", effort: "protect" });
  matrix = setIntention({ matrix, stageNumber: 3, riderId: "r3", effort: "all_out" });
  const toItt = copyStageIntentions({ matrix, fromStage: 3, toStage: 4, riders: RIDERS, toProfileType: "itt" });
  assert.equal(intentionFor({ matrix: toItt, stageNumber: 4, riderId: "r1" }), "save");
  assert.equal(intentionFor({ matrix: toItt, stageNumber: 4, riderId: "r2" }), "save");
  assert.equal(intentionFor({ matrix: toItt, stageNumber: 4, riderId: "r3" }), "all_out");
  const toTtt = copyStageIntentions({ matrix, fromStage: 3, toStage: 4, riders: RIDERS, toProfileType: "ttt" });
  assert.equal(intentionFor({ matrix: toTtt, stageNumber: 4, riderId: "r1" }), "grupetto");
  assert.equal(intentionFor({ matrix: toTtt, stageNumber: 4, riderId: "r2" }), "protect");
  // Uden profil (kendt adfaerd foer #7332): uaendret.
  const noProfile = copyStageIntentions({ matrix, fromStage: 3, toStage: 4, riders: RIDERS });
  assert.equal(intentionFor({ matrix: noProfile, stageNumber: 4, riderId: "r2" }), "protect");
});

test("#7332: withIndividualTimeTrialEfforts normaliserer kun enkeltstart-etaper (kontrakt mod PUT)", () => {
  let matrix = stageRaceMatrix([
    { stage_number: 3, rider_id: "r2", race_role: "helper", effort: "protect" },
    { stage_number: 4, rider_id: "r2", race_role: "helper", effort: "protect" },
    { stage_number: 5, rider_id: "r1", race_role: "captain", effort: "grupetto" },
  ]);
  const profileByStage = { 3: { profile_type: "itt" }, 4: { profile_type: "ttt" }, 5: { profile_type: "itt_hilly" } };
  const out = withIndividualTimeTrialEfforts({ matrix, profileByStage });
  // PUT-payloaden: rollen uroert, effort = save paa itt/itt_hilly, ttt beholder protect.
  assert.deepEqual(diffToOverrides({ matrix: out, riders: RIDERS }), [
    { stage_number: 3, rider_id: "r2", race_role: "helper", effort: "save" },
    { stage_number: 4, rider_id: "r2", race_role: "helper", effort: "protect" },
    { stage_number: 5, rider_id: "r1", race_role: "captain", effort: "save" },
  ]);
  // Ren: input uroert, og uden enkeltstart faas samme objekt tilbage.
  assert.equal(matrix[3].r2.effort, "protect");
  assert.equal(withIndividualTimeTrialEfforts({ matrix, profileByStage: {} }), matrix);
});
