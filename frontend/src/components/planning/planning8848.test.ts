// #8848 + #8857 · Saesonmatrixen paa planlaegningssiden: aabner ved i dag, én sandhed under matrixen
// (TASTE P11), cellerne forklaret paa fladen; stigningslisten under etapeprofilen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  firstColumnFromToday,
  firstRaceFromToday,
  matrixFooterParts,
  rolesInMatrix,
} from "./seasonMatrixLenses.ts";
import { climbRows } from "./stageClimbRows.ts";

const here = (p: string) => new URL(p, import.meta.url);
const matrixSrc = readFileSync(here("../racehub/SeasonMatrix.jsx"), "utf8");
const viewSrc = readFileSync(here("./SeasonMatrixView.tsx"), "utf8");
const pageSrc = readFileSync(here("../../pages/PlanningWorkbenchPage.tsx"), "utf8");
const routeSrc = readFileSync(here("./RouteProfile.tsx"), "utf8");
const listSrc = readFileSync(here("./StageClimbList.tsx"), "utf8");
const locale = (lng: string) => JSON.parse(readFileSync(here(`../../../public/locales/${lng}/planning.json`), "utf8"));

const dates = new Map([
  [10, "2026-11-20"],
  [11, "2026-11-21"],
  [12, "2026-11-27"],
  [13, "2026-11-28"],
]);

test("#8848 the matrix opens at today: first day column dated today or later", () => {
  const cols = [
    { raceId: "past", gameDay: 10 },
    { raceId: "past", gameDay: 11 },
    { raceId: "now", gameDay: 12 },
    { raceId: "now", gameDay: 13 },
  ];
  assert.equal(firstColumnFromToday(cols, dates, "2026-11-27"), 2);
  assert.equal(firstColumnFromToday(cols, dates, "2026-11-22"), 2);
  assert.equal(firstColumnFromToday(cols, dates, "2026-11-01"), 0);
  assert.equal(firstColumnFromToday(cols, dates, "2026-12-01"), null, "a finished season keeps its start");
  assert.equal(firstColumnFromToday([{ raceId: "x", gameDay: 99 }], dates, "2026-11-01"), null, "no dated column");
});

test("#8848 mobile race picker starts at the first race that has not ended", () => {
  const races = [
    { id: "past", gameDayEnd: 11 },
    { id: "running", gameDayEnd: 13 },
  ];
  assert.equal(firstRaceFromToday(races, dates, "2026-11-27"), "running");
  assert.equal(firstRaceFromToday(races, dates, "2026-11-21"), "past", "a race ending today still counts");
  assert.equal(firstRaceFromToday(races, dates, "2026-12-01"), null);
});

test("#8848 one truth: the footer never says 'no problems' while races need a squad", () => {
  assert.equal(matrixFooterParts(0, 0), "none");
  assert.deepEqual(matrixFooterParts(0, 1), ["needSquad"]);
  assert.deepEqual(matrixFooterParts(2, 1), ["needSquad", "problems"]);
  assert.deepEqual(matrixFooterParts(3, 0), ["problems"]);
  assert.equal(matrixFooterParts(0, undefined), "none");
});

test("#8848 the footer uses the page header's own sentence and number (same key, same count)", () => {
  assert.match(pageSrc, /needSquadCount=\{upcomingNeed\}/);
  assert.match(pageSrc, /t\("subtitle\.needSquad", \{ count: upcomingNeed \}\)/);
  assert.match(matrixSrc, /t\("planning:subtitle\.needSquad", \{ count: needSquadCount \}\)/);
  // Kun den aktive saeson: sidehovedets tal handler ikke om en anden saeson.
  assert.match(viewSrc, /needSquadCount=\{seasonChoice == null \? needSquadCount : undefined\}/);
});

test("#8848 the legend lists only the roles in the matrix, in the fixed letter order", () => {
  const order = ["captain", "co_captain", "sprint_captain", "hunter", "free_role", "luxury_helper", "helper"];
  assert.deepEqual(rolesInMatrix(["helper", null, "captain", "helper", undefined], order), ["captain", "helper"]);
  assert.deepEqual(rolesInMatrix([], order), []);
});

test("#8848 the legend and scroll only change the embedded matrix (old /planning unchanged)", () => {
  assert.match(matrixSrc, /if \(!embedded \|\| loading \|\| !data\) return undefined;/);
  assert.match(matrixSrc, /\{embedded && \(legendRoles\.length > 0 \|\| mobileView\) && \(/);
  assert.match(matrixSrc, /\(embedded \? raceById\.get\(firstRaceFromToday/);
});

test("#8848/#8857 new copy exists in every language with full words", () => {
  for (const lng of ["da", "en", "es", "fr", "nl"]) {
    const j = locale(lng);
    for (const key of ["legendLabel", "legendEmpty"]) assert.ok(j.seasonMatrix?.[key], `${lng} seasonMatrix.${key}`);
    for (const key of ["title", "name", "category", "top", "length", "average", "toFinish", "showOnProfile", "mobileFacts"]) {
      assert.ok(j.climbList?.[key], `${lng} climbList.${key}`);
    }
    assert.match(j.climbList.mobileFacts, /\{km\}.*\{length\}.*\{average\}.*\{toFinish\}/);
  }
});

const profile = { distance_km: 180, climbs: [] } as any;

test("#8857 climb rows: name, category, top km, length, average and km to the finish", () => {
  const climbs = [
    { name: "Côte A", category: "3", crest_km: 120.4, length_km: 4.2, avg_gradient: 5.1 },
    { name: "  ", category: "hc", crest_km: 162, length_km: 15.5, avg_gradient: 7.2 },
  ];
  const rows = climbRows(profile, null, climbs);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => [r.index, r.name, r.category, r.topKm, r.lengthKm, r.avgGradient, r.kmToGo]),
    [
      [0, "Côte A", "3", 120, 4.2, 5.1, rows[0].kmToGo],
      [1, null, "hc", 162, 15.5, 7.2, rows[1].kmToGo],
    ],
  );
  assert.ok(rows[0].kmToGo > rows[1].kmToGo, "the earlier climb is further from the finish");
  assert.deepEqual(climbRows(profile, null, []), []);
});

test("#8857 the climb list sits under the planning profile and follows its selected climb", () => {
  assert.match(routeSrc, /<StageClimbList profile=\{profile\} series=\{series\} climbs=\{climbs\} selected=\{index\} onSelect=\{setSelectedClimb\} \/>/);
  assert.match(routeSrc, /<StageClimbList profile=\{profile as StageProfile\} climbs=\{sortedClimbs\(profile as StageProfile\)\} \/>/);
  // Genbrugelig: kun profilen ind, ingen afhaengighed til planlaegningssidens state.
  assert.doesNotMatch(listSrc, /planningWorkbench|usePlanner|PlanningWorkbenchPage/);
  assert.match(listSrc, /data-sort-exempt=/);
});
