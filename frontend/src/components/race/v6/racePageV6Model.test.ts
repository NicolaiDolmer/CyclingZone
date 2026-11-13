// #7778 · Loebssiden v6: faner og hovedets handling.
import test from "node:test";
import assert from "node:assert/strict";
import { RACE_PAGE_V6_TABS, resolveV6Tab, tacticsCta, v6Tabs } from "./racePageV6Model.ts";

test("en koert etape aabner paa Resultater, en kommende paa Etape (valg 5)", () => {
  assert.equal(resolveV6Tab(null, { ridden: true, isStageRace: true }), "results");
  assert.equal(resolveV6Tab(null, { ridden: false, isStageRace: true }), "stage");
  assert.equal(resolveV6Tab("nonsense", { ridden: true, isStageRace: true }), "results");
});

test("en gyldig ?tab= vinder; Resultater staar foerst", () => {
  assert.equal(RACE_PAGE_V6_TABS[0], "results");
  for (const tab of ["results", "stage", "standings", "tactics", "team"]) {
    assert.equal(resolveV6Tab(tab, { ridden: true, isStageRace: true }), tab);
  }
});

test("endagsloeb har ingen Stillinger-fane", () => {
  assert.deepEqual([...v6Tabs(false)], ["results", "stage", "tactics", "team"]);
  assert.equal(resolveV6Tab("standings", { ridden: true, isStageRace: false }), "results");
});

const riders = [{ rider_id: "r1", name: "A", race_role: "captain" }, { rider_id: "r2", name: "B", race_role: "helper" }];
const schedule = [
  { stage_number: 1, scheduled_at: "2026-11-12T10:00:00.000Z" },
  { stage_number: 2, scheduled_at: "2026-11-13T10:00:00.000Z" },
];
const base = { stagesCompleted: 1, totalStages: 3, raceFinished: false, schedule, riders, overrides: [], nowMs: Date.parse("2026-11-12T18:00:00.000Z") };

test("efter en koert etape peger knappen paa naeste etape med dens laasetid", () => {
  const cta = tacticsCta({ ...base, selectedStage: 1 });
  assert.equal(cta?.stage, 2);
  assert.equal(cta?.locksAt?.toISOString(), "2026-11-13T10:00:00.000Z");
  assert.ok(cta && cta.total > 0);
});

test("ingen knap naar etapen er startet, loebet er slut eller holdet er udgaaet", () => {
  assert.equal(tacticsCta({ ...base, selectedStage: 1, nowMs: Date.parse("2026-11-13T10:00:00.000Z") }), null);
  assert.equal(tacticsCta({ ...base, selectedStage: 1, raceFinished: true }), null);
  assert.equal(tacticsCta({ ...base, selectedStage: 1, riders: riders.map((r) => ({ ...r, abandoned: true })) }), null);
  assert.equal(tacticsCta({ ...base, selectedStage: 3, stagesCompleted: 3 }), null);
});
