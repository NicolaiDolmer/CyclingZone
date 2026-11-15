// #7778 · Loebssiden v6: faner og hovedets handling.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RACE_PAGE_V6_TABS, resolveV6Tab, tacticsCta, v6Tabs, v6TacticsResults, v6TacticsStage } from "./racePageV6Model.ts";

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

// ── PR #8173-review: Taktik-fanens etape og etapens resultater ──

test("Taktik: den seneste eksplicitte navigation vinder, ogsaa guld-knappen efter et valg i striben", () => {
  // Kørt etape 1 valgt i Taktiks stribe: sammenligningen for etape 1.
  assert.equal(v6TacticsStage({ requested: 1, ctaStage: 2, selectedStage: 1 }), 1);
  // Guld-knappen sender etape 2 som ny eksplicit navigation: editoren for etape 2.
  assert.equal(v6TacticsStage({ requested: 2, ctaStage: 2, selectedStage: 1 }), 2);
  // Fanen åbnet direkte: guld-knappens etape, ellers den valgte.
  assert.equal(v6TacticsStage({ requested: null, ctaStage: 2, selectedStage: 1 }), 2);
  assert.equal(v6TacticsStage({ requested: null, ctaStage: null, selectedStage: 3 }), 3);
});

test("Taktik: valget i striben og guld-knappen gaar gennem samme sidetilstand (ingen lokal kopi der vinder)", () => {
  const page = readFileSync(new URL("./RacePageV6.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /tacticsPick/, "ingen lokal Taktik-etape, der overtrumfer hovedets knap");
  assert.match(page, /requested: tacticsStageRequest/);
  assert.match(page, /const selectTacticsStage = \(n: number\) => onOpenTactics\(n\)/);
  const detail = readFileSync(new URL("../../../pages/RaceDetailPage.jsx", import.meta.url), "utf8");
  assert.match(detail, /<RacePageV6 [^\n]*tacticsStageRequest=\{v2TacticsStage\}/);
});

test("Taktik paa en koert etape: etapens resultater hentes, med indlaesning og fejl foer sammenligningen", () => {
  const stateFor = (n: number) => ({ 1: "loaded", 2: "failed" } as Record<number, "loaded" | "failed">)[n] ?? "loading";
  assert.equal(v6TacticsResults({ activeTab: "tactics", stage: 1, stagesCompleted: 3, stateFor }), "loaded");
  assert.equal(v6TacticsResults({ activeTab: "tactics", stage: 2, stagesCompleted: 3, stateFor }), "failed");
  assert.equal(v6TacticsResults({ activeTab: "tactics", stage: 3, stagesCompleted: 3, stateFor }), "loading");
  assert.equal(v6TacticsResults({ activeTab: "tactics", stage: 4, stagesCompleted: 3, stateFor }), null, "kommende etape: editoren");
  assert.equal(v6TacticsResults({ activeTab: "stage", stage: 1, stagesCompleted: 3, stateFor }), null);
  const page = readFileSync(new URL("./RacePageV6.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(tacticsResults !== null\) loadStage\?\.\(tacticsStage\)/, "valget starter hentningen pr. etape");
  assert.match(page, /resultsState=\{tacticsResults\}/);
  const detail = readFileSync(new URL("../../../pages/RaceDetailPage.jsx", import.meta.url), "utf8");
  assert.match(detail, /loadStage=\{startStageFetch\}/);
  assert.match(detail, /stageStateFor=\{\(n\) => stageFetchState\(n, \{ loaded: loadedStages, failed: failedStages \}\)\}/);
  assert.match(detail, /stageErrorFor=\{stageLoadErrorFor\}/);
});
