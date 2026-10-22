// #4613 — løbssidens faner. Ren logik, ingen React (samme mønster som
// raceIntention.test.js: repoet kører node --test uden jsdom).

import test from "node:test";
import assert from "node:assert/strict";
import {
  racePhase,
  raceTabsFor,
  resolveRaceTab,
  defaultRaceTab,
  isStageLockedForTactics,
  hasScheduledStartPassed,
  firstOpenStage,
} from "./racePageTabs.js";

test("racePhase: et løb der ikke er kørt endnu er 'før'", () => {
  assert.equal(racePhase({ status: "scheduled", stagesCompleted: 0, stages: 5 }), "before");
  assert.equal(racePhase({ status: "scheduled", stagesCompleted: 0, stages: 1 }), "before");
  assert.equal(racePhase({}), "before");
});

test("racePhase: status forbliver 'scheduled' gennem hele afviklingen (#1825) — fasen læses af stages_completed", () => {
  assert.equal(racePhase({ status: "scheduled", stagesCompleted: 2, stages: 5 }), "during");
  assert.equal(racePhase({ status: "scheduled", stagesCompleted: 4, stages: 5 }), "during");
});

test("racePhase: sidste etape kørt ELLER status completed er 'efter'", () => {
  assert.equal(racePhase({ status: "scheduled", stagesCompleted: 5, stages: 5 }), "after");
  assert.equal(racePhase({ status: "completed", stagesCompleted: 2, stages: 5 }), "after");
  assert.equal(racePhase({ status: "completed", stagesCompleted: 1, stages: 1 }), "after");
});

test("racePhase: et importeret løb uden stages_completed men MED resultater er kørt færdigt", () => {
  // Gamle PCM-importer har ingen stages_completed — de har aldrig haft en
  // "under løbet"-tilstand i denne app og må ikke vise en Taktik-fane.
  assert.equal(racePhase({ status: "imported", stagesCompleted: 0, stages: 3, hasResults: true }), "after");
});

test("faner: etapeløb får Resultater først når der ER noget at vise", () => {
  assert.deepEqual(raceTabsFor({ phase: "before", isStageRace: true }),
    ["overview", "team", "tactics", "stages"]);
  assert.deepEqual(raceTabsFor({ phase: "during", isStageRace: true }),
    ["overview", "team", "tactics", "stages", "results"]);
  assert.deepEqual(raceTabsFor({ phase: "after", isStageRace: true }),
    ["overview", "results", "stages", "team"]);
});

test("faner: et endagsløb mister Taktik i det øjeblik det starter", () => {
  // Én dag, én taktik — den låser ved start, så fanen ville stå tom.
  assert.ok(raceTabsFor({ phase: "before", isStageRace: false }).includes("tactics"));
  assert.ok(!raceTabsFor({ phase: "during", isStageRace: false }).includes("tactics"));
  assert.ok(!raceTabsFor({ phase: "after", isStageRace: false }).includes("tactics"));
});

test("faner: etapeløb BEHOLDER Taktik under løbet (de kommende etaper er stadig åbne)", () => {
  assert.ok(raceTabsFor({ phase: "during", isStageRace: true }).includes("tactics"));
});

test("resolveRaceTab: en fane fra en tidligere fase falder tilbage til fasens første", () => {
  const after = raceTabsFor({ phase: "after", isStageRace: true });
  assert.equal(resolveRaceTab("tactics", after), "overview");
  assert.equal(resolveRaceTab("results", after), "results");
  assert.equal(defaultRaceTab(after), "overview");
  assert.equal(defaultRaceTab([]), "overview");
});

test("isStageLockedForTactics: kørt etape, passeret start eller afsluttet løb er låst", () => {
  const now = Date.parse("2026-09-06T12:00:00Z");
  assert.equal(isStageLockedForTactics({ stageNumber: 2, stagesCompleted: 3, now }), true);
  assert.equal(isStageLockedForTactics({ stageNumber: 4, stagesCompleted: 3, scheduledAt: "2026-09-06T11:00:00Z", now }), true);
  assert.equal(isStageLockedForTactics({ stageNumber: 4, stagesCompleted: 3, scheduledAt: "2026-09-06T13:00:00Z", now }), false);
  assert.equal(isStageLockedForTactics({ stageNumber: 4, stagesCompleted: 0, raceCompleted: true, now }), true);
});

test("isStageLockedForTactics: et schedule-hul låser ALDRIG en kommende etape", () => {
  // Spejler backendens defensive valg (raceTeamOrdersApi.isStageLocked): en
  // manglende scheduled_at må ikke fastlåse taktikken for et helt løb.
  const now = Date.parse("2026-09-06T12:00:00Z");
  assert.equal(isStageLockedForTactics({ stageNumber: 4, stagesCompleted: 3, scheduledAt: null, now }), false);
});

test("firstOpenStage: den første etape der kan sættes; er alt låst, den sidste", () => {
  const stages = [
    { stage_number: 1, locked: true },
    { stage_number: 2, locked: true },
    { stage_number: 3, locked: false },
  ];
  assert.equal(firstOpenStage(stages), 3);
  assert.equal(firstOpenStage(stages.map((s) => ({ ...s, locked: true }))), 3);
  assert.equal(firstOpenStage([]), null);
});

// #6959: taktik og trup laaser samtidig ved loebets start (etape 1's planlagte start).
const START = "2026-10-02T12:00:00Z";
const T_BEFORE = Date.parse("2026-10-02T11:59:59Z");
const T_AFTER = Date.parse("2026-10-02T12:00:01Z");

test("#6959 racePhase: start passeret uden koert etape (pause) er 'during', foer start er 'before'", () => {
  assert.equal(racePhase({ status: "scheduled", stagesCompleted: 0, stages: 5, firstStageScheduledAt: START, now: T_BEFORE }), "before");
  assert.equal(racePhase({ status: "scheduled", stagesCompleted: 0, stages: 5, firstStageScheduledAt: START, now: T_AFTER }), "during");
});

test("#6959 racePhase: schedule-hul holder loebet aabent (before) indtil en etape er koert", () => {
  assert.equal(racePhase({ status: "scheduled", stagesCompleted: 0, stages: 5, firstStageScheduledAt: null, now: T_AFTER }), "before");
  assert.equal(racePhase({ status: "scheduled", stagesCompleted: 0, stages: 5, now: T_AFTER }), "before");
});

test("#6959 racePhase: en flyttet start (planlagt pause) aabner loebet igen", () => {
  assert.equal(racePhase({ status: "scheduled", stagesCompleted: 0, stages: 5, firstStageScheduledAt: "2026-10-09T12:00:00Z", now: T_AFTER }), "before");
});

test("#6959 trup (fase) og etape-1-taktik skifter i SAMME oejeblik", () => {
  for (const now of [T_BEFORE, T_AFTER]) {
    const squadLocked = racePhase({ status: "scheduled", stagesCompleted: 0, stages: 5, firstStageScheduledAt: START, now }) !== "before";
    const tacticsLocked = isStageLockedForTactics({ stageNumber: 1, stagesCompleted: 0, scheduledAt: START, now });
    assert.equal(squadLocked, tacticsLocked);
  }
});

test("#6959 hasScheduledStartPassed: manglende/ugyldigt tidspunkt er aabent", () => {
  assert.equal(hasScheduledStartPassed(null, T_AFTER), false);
  assert.equal(hasScheduledStartPassed("ikke-en-dato", T_AFTER), false);
  assert.equal(hasScheduledStartPassed(START, T_BEFORE), false);
  assert.equal(hasScheduledStartPassed(START, T_AFTER), true);
});
