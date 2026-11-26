// #8781 · Saeson-visningens fire linser: linse-skift, Rutematch-gitteret, Form-linsens data og
// kontrakten mod den gamle side (matrixen genbruges, ordet "payback" staar ikke paa fladen).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SEASON_LENSES,
  SEASON_LENS_STORAGE_KEY,
  activeSeasonNumber,
  buildRouteMatchGrid,
  isSeasonLens,
  lensShowsMatrix,
  lensUsesProblemsFilter,
  matrixLensFor,
  pendingSuggestionCount,
  readStoredLens,
  storeLens,
  viewedSeason,
} from "./seasonMatrixLenses.ts";
import { riderSuitability } from "../../lib/suitability.js";

const here = (p: string) => new URL(p, import.meta.url);
const viewSrc = readFileSync(here("./SeasonMatrixView.tsx"), "utf8");
const matrixSrc = readFileSync(here("../racehub/SeasonMatrix.jsx"), "utf8");
const locale = (lng: string, ns: string) => JSON.parse(readFileSync(here(`../../../public/locales/${lng}/${ns}.json`), "utf8"));

test("four lenses in the owner's order: Udtagelser, Rutematch, Form, Belastning", () => {
  assert.deepEqual([...SEASON_LENSES], ["entries", "routeMatch", "form", "load"]);
  assert.equal(isSeasonLens("form"), true);
  assert.equal(isSeasonLens("formPeak"), false, "the old matrix lens is not a view lens");
  assert.equal(isSeasonLens(undefined), false);
});

test("lens switch: entries and load are the old matrix, route match and form are their own surfaces", () => {
  assert.equal(lensShowsMatrix("entries"), true);
  assert.equal(lensShowsMatrix("load"), true);
  assert.equal(lensShowsMatrix("routeMatch"), false);
  assert.equal(lensShowsMatrix("form"), false);
  assert.equal(matrixLensFor("entries"), "entries");
  assert.equal(matrixLensFor("load"), "load");
  // Paa Rutematch og Form staar matrixen skjult men monteret; den vises i Udtagelser-tilstand.
  assert.equal(matrixLensFor("routeMatch"), "entries");
  assert.equal(matrixLensFor("form"), "entries");
  assert.equal(lensUsesProblemsFilter("entries"), true);
  assert.equal(lensUsesProblemsFilter("routeMatch"), false);
});

test("the lens choice is remembered and survives a blocked storage", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.equal(readStoredLens(storage), "entries");
  storeLens(storage, "routeMatch");
  assert.equal(store.get(SEASON_LENS_STORAGE_KEY), "routeMatch");
  assert.equal(readStoredLens(storage), "routeMatch");
  store.set(SEASON_LENS_STORAGE_KEY, "nonsense");
  assert.equal(readStoredLens(storage), "entries");
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readStoredLens(blocked), "entries");
  assert.doesNotThrow(() => storeLens(blocked, "form"));
  assert.equal(readStoredLens(null), "entries");
});

test("route match grid: races in calendar order, riders by name, best per race marked (ties too)", () => {
  const races = [
    { id: "r2", name: "Later race", gameDayStart: 9, demandVector: { climbing: 1 } },
    { id: "r1", name: "Early race", gameDayStart: 2, demandVector: { sprint: 1 } },
  ];
  const riders = [
    { id: "b", name: "Bertil", abilities: { climbing: 80, sprint: 40 } },
    { id: "a", name: "Anders", abilities: { climbing: 50, sprint: 40 } },
  ];
  const score = (ab: Record<string, number | null>, dv: Record<string, number>) => Number(ab[Object.keys(dv)[0]]);
  const grid = buildRouteMatchGrid(races, riders, score);
  assert.deepEqual(grid.races.map((r) => r.id), ["r1", "r2"]);
  assert.deepEqual(grid.rows.map((r) => r.rider.id), ["a", "b"]);
  // r1: begge 40 -> begge bedst. r2: Bertil 80 bedst.
  assert.deepEqual(grid.rows[0].cells.map((c) => [c.score, c.best]), [[40, true], [50, false]]);
  assert.deepEqual(grid.rows[1].cells.map((c) => [c.score, c.best]), [[40, true], [80, true]]);
  assert.equal(grid.bestByRace.get("r2"), 80);
});

test("route match grid: no invented zero for a rider without abilities or a race without a route", () => {
  const grid = buildRouteMatchGrid(
    [{ id: "r1", name: "No route", gameDayStart: 1, demandVector: null }, { id: "r2", name: "Route", gameDayStart: 2, demandVector: { tt: 1 } }],
    [{ id: "a", name: "A", abilities: null }, { id: "b", name: "B", abilities: { tt: 70 } }],
    () => 70,
  );
  assert.equal(grid.rows[0].cells[0].score, null);
  assert.equal(grid.rows[0].cells[1].score, null);
  assert.equal(grid.rows[1].cells[0].score, null);
  assert.equal(grid.rows[1].cells[1].score, 70);
  assert.equal(grid.rows[1].cells[1].best, true);
  assert.equal(grid.bestByRace.has("r1"), false);
});

test("route match grid uses the game's own suitability score by default", () => {
  const grid = buildRouteMatchGrid(
    [{ id: "r", name: "R", gameDayStart: 1, demandVector: { climbing: 1 } }],
    [{ id: "a", name: "A", abilities: { climbing: 70 } }],
  );
  const expected = (riderSuitability as (a: unknown, d: unknown) => { score: number })({ climbing: 70 }, { climbing: 1 }).score;
  assert.ok(expected > 0);
  assert.equal(grid.rows[0].cells[0].score, expected);
});

test("form lens data: only drafts with a target count, seasons resolve to the active one", () => {
  const riders = [
    { peaks: [{ isSuggestion: true, targetRaceId: "x" }, { isSuggestion: true, targetRaceId: null }, { isSuggestion: false, targetRaceId: "y" }] },
    { peaks: [{ isSuggestion: true, targetRaceId: "z" }] },
    {},
  ];
  assert.equal(pendingSuggestionCount(riders), 2);
  assert.equal(pendingSuggestionCount(null), 0);
  const seasons = [{ number: 3, status: "completed" }, { number: 4, status: "active" }, { number: 5, status: "upcoming" }];
  assert.equal(activeSeasonNumber(seasons), 4);
  assert.equal(viewedSeason(null, seasons), 4);
  assert.equal(viewedSeason(5, seasons), 5);
  assert.equal(activeSeasonNumber([]), null);
});

test("view contract: default export with onOpenRace, the old matrix stays mounted and embedded", () => {
  assert.match(viewSrc, /export default function SeasonMatrixView\(\{ onOpenRace \}: \{ onOpenRace\?: \(raceId: string\) => void \}\)/);
  assert.match(viewSrc, /<div hidden=\{!lensShowsMatrix\(lens\)\}/, "the matrix is hidden, not unmounted, so a draft survives a lens switch");
  assert.match(viewSrc, /<SeasonMatrix[\s\S]*?embedded[\s\S]*?onOpenRace=\{onOpenRace\}[\s\S]*?onData=\{onData\}/);
  assert.match(viewSrc, /window\.confirm\(t\("matrix\.leaveUnsaved"\)\)/, "a season switch with unsaved changes asks first");
  // Ingen nye endpoints: data kommer fra matrixen og Formplan-fanens board.
  assert.doesNotMatch(viewSrc, /\bfetch\(|apiFetch|VITE_API_URL/);
  // Formplanens egne komponenter genbruges, ingen kopi.
  for (const c of ["MasterCanvas", "MobileLanes", "PlannerSquad", "PlannerDrawer", "PlannerAssistantCard", "PlannerStatusLine"]) {
    assert.match(viewSrc, new RegExp(`from "\\.\\./planner/${c}\\.jsx"`), c);
  }
});

test("TASTE on the new surface: no small caps, no gold in the route match highlight", () => {
  assert.doesNotMatch(viewSrc, /uppercase|tracking-wide/);
  const bestClass = viewSrc.match(/cell\.best \? "([^"]+)"/)?.[1] ?? "";
  assert.ok(bestClass.length > 0);
  assert.doesNotMatch(bestClass, /accent/);
  assert.match(viewSrc, /tabular-nums/);
});

test("old page unchanged: the matrix keeps its own lenses and small caps without the new props", () => {
  assert.match(matrixSrc, /const lens = lensProp \?\? lensState;/);
  assert.match(matrixSrc, /const problemsOnly = problemsOnlyProp \?\? problemsOnlyState;/);
  assert.match(matrixSrc, /const capsClass = embedded \? "" : "uppercase tracking-wide";/);
  assert.match(matrixSrc, /if \(onOpenRace\) onOpenRace\(raceId\);\s*else if \(date\) onOpenDay\?\.\(date\);/);
  assert.match(matrixSrc, /const LENSES = \["entries", "routeMatch", "formPeak", "load"\];/);
});

test("copy: every lens has a label and help in all languages, and 'payback' is gone from the form plan", () => {
  for (const lng of ["en", "da", "es", "fr", "nl"]) {
    const m = locale(lng, "races").matrix;
    for (const key of SEASON_LENSES) {
      assert.ok(m.lens[key], `${lng} lens.${key}`);
      assert.ok(m.lensHelp[key], `${lng} lensHelp.${key}`);
    }
    for (const key of ["rider", "cellAria", "bestAria", "noScore", "openRace"]) assert.ok(m.routeGrid[key], `${lng} routeGrid.${key}`);
    assert.doesNotMatch(JSON.stringify(m.lensHelp), /payback/i);
  }
  for (const lng of ["en", "da"]) {
    assert.doesNotMatch(locale(lng, "planner").squad.raceOptionPayback, /payback/i);
  }
});
