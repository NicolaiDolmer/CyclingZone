// #8419 · Den samlede planlaegningsside (ejerens beslutninger 26/11): visninger, Match pr. etape,
// "Fordel ryttere" kun paa dage med flere loeb, Startlister for kun dette loeb, og ingen "payback" paa siden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  boardDayFor,
  canDistributeOn,
  isPlanningView,
  matchForScope,
  planningModeFrom,
  racesOnDate,
  startColumnFor,
  PLANNING_MODES,
  PLANNING_VIEWS,
} from "./planningViews.ts";
import type { SeasonRace } from "../../lib/planningWorkbench.ts";

const race = (id: string, start: number, end: number, extra: Partial<SeasonRace> = {}): SeasonRace => ({
  id,
  name: id,
  raceClass: 2,
  stages: end - start + 1,
  status: "scheduled",
  stagesCompleted: 0,
  lineupLocked: false,
  gameDayStart: start,
  gameDayEnd: end,
  sizeMin: 6,
  sizeMax: 6,
  ...extra,
});

// Loebsdag -> dato: dag 1-2 paa samme dato (komprimeret), dag 3 og 4 de naeste datoer.
const dates = new Map<number, string>([
  [1, "2026-11-23"],
  [2, "2026-11-23"],
  [3, "2026-11-24"],
  [4, "2026-11-25"],
]);

test("punkt 1: Uge · Saeson · Maaned, Uge er standard og alt ukendt er Uge", () => {
  assert.deepEqual([...PLANNING_MODES], ["week", "season", "month"]);
  assert.equal(planningModeFrom(null), "week");
  assert.equal(planningModeFrom("season"), "season");
  assert.equal(planningModeFrom("month"), "month");
  assert.equal(planningModeFrom("calendar"), "week");
});

test("punkt 6: fanerne er Trup · Taktik · Formtop · Startlister", () => {
  assert.deepEqual([...PLANNING_VIEWS], ["squad", "tactics", "peak", "startlists"]);
  assert.equal(isPlanningView("startlists"), true);
  assert.equal(isPlanningView("division"), false);
});

test("punkt 7: Match for hele loebet er serverens tal; en etape er rytterens etape-match, aldrig gaettet", () => {
  assert.equal(matchForScope(71, [60, 80, null], "race"), 71);
  assert.equal(matchForScope(71, [60, 80, null], 1), 80);
  assert.equal(matchForScope(71, [60, 80, null], 2), null);
  assert.equal(matchForScope(71, null, 0), null);
});

test("punkt 4: Fordel ryttere kun paa en dato med mere end ét loeb (afmeldte og afsluttede tael ikke)", () => {
  const races = [race("a", 1, 1), race("b", 2, 4), race("c", 3, 3), race("done", 1, 1, { status: "completed" })];
  assert.deepEqual(racesOnDate("2026-11-23", races, dates, new Set()).map((r) => r.id), ["a", "b"]);
  assert.equal(canDistributeOn("2026-11-23", races, dates, new Set()), true);
  assert.equal(canDistributeOn("2026-11-23", races, dates, new Set(["a"])), false);
  assert.equal(canDistributeOn("2026-11-24", races, dates, new Set()), true); // etapeloebet b + c
  assert.equal(canDistributeOn("2026-11-25", races, dates, new Set()), false);
});

test("dags-tavlens dag er kalenderdage fra saesonens foerste dato, 1-baseret", () => {
  assert.equal(boardDayFor("2026-11-23", dates), 1);
  assert.equal(boardDayFor("2026-11-25", dates), 3);
  assert.equal(boardDayFor("2026-11-20", dates), null);
  assert.equal(boardDayFor("", dates), null);
  assert.equal(boardDayFor("2026-11-23", new Map()), null);
});

test("punkt 6: Startlister viser kun dette loebs kolonne", () => {
  const body = { columns: [{ id: "x", teams: [] }, { id: "r1", teams: [{ team: { id: "t" }, riders: [] }] }] };
  assert.equal(startColumnFor(body, "r1")?.id, "r1");
  assert.equal(startColumnFor(body, "nope"), null);
  assert.equal(startColumnFor(null, "r1"), null);
});

test("punkt 9 + 10: ingen forklaringsprosa over tabellen, ?-ikon pr. kolonne, og ordet payback staar ikke paa siden", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const wb = read("./RaceWorkbench.tsx");
  assert.doesNotMatch(wb, /numbersExplanation/);
  assert.doesNotMatch(wb, /views\.hint\./);
  const table = read("./SquadTable.tsx");
  assert.match(table, /ColumnHelp/);
  for (const lang of ["en", "da"]) {
    const planning = read(`../../../public/locales/${lang}/planning.json`);
    assert.doesNotMatch(planning, /payback/i, `${lang}/planning.json`);
  }
});

test("TASTE: ingen smaa versaler paa sidens egne flader", () => {
  for (const file of ["./RaceWorkbench.tsx", "./SquadTable.tsx", "./RaceList.tsx", "./WeekBoard.tsx", "./RouteProfile.tsx", "./StartListsView.tsx", "../../pages/PlanningWorkbenchPage.tsx"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\buppercase\b/, file);
  }
});
