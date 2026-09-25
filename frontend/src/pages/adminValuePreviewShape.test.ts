// #5686 · Ren datamodel for værdi-forhåndsvisningen. Syntetiske data, ingen
// prod-tal (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FILTERS,
  ageBandOf,
  buildRows,
  deltaPct,
  filterOptions,
  filterRows,
  median,
  sortRows,
  stepLabelKey,
  summarize,
  teamTotals,
  type PreviewRider,
  type PreviewTeam,
} from "./adminValuePreviewShape.ts";

const rider = (over: Partial<PreviewRider> & { id: string }): PreviewRider => ({
  name: `Rider ${over.id}`,
  teamId: null,
  human: false,
  isAcademy: false,
  age: 25,
  type: "climber",
  valuationType: null,
  before: 100,
  after: 100,
  cpvBefore: 10,
  cpvAfter: 10,
  ...over,
});

const TEAMS: PreviewTeam[] = [
  { id: "tA", name: "Hold A", division: 1, human: true },
  { id: "tB", name: "Hold B", division: 2, human: true },
  { id: "tAI", name: "Hold AI", division: 1, human: false },
];

const RIDERS: PreviewRider[] = [
  rider({ id: "r1", teamId: "tA", human: true, age: 20, before: 100, after: 40, type: "sprinter" }),
  rider({ id: "r2", teamId: "tA", human: true, age: 27, before: 200, after: 150 }),
  rider({ id: "r3", teamId: "tB", human: true, age: 31, before: 100, after: 120 }),
  rider({ id: "r4", teamId: "tAI", human: false, age: 23, before: 300, after: 300 }),
  rider({ id: "r5", teamId: null, human: false, age: 35, before: 0, after: 10, name: "Free Agent" }),
];

const rows = buildRows({ riders: RIDERS, teams: TEAMS });

test("deltaPct: null når FØR ikke er positiv", () => {
  assert.equal(deltaPct(100, 50), -50);
  assert.equal(deltaPct(0, 10), null);
  assert.equal(deltaPct(null, 10), null);
});

test("buildRows: hold-navn, division og ændring i kr/%", () => {
  const r1 = rows.find((r) => r.id === "r1")!;
  assert.equal(r1.teamName, "Hold A");
  assert.equal(r1.division, 1);
  assert.equal(r1.deltaKr, -60);
  assert.equal(r1.deltaPct, -60);
  const r5 = rows.find((r) => r.id === "r5")!;
  assert.equal(r5.teamName, null);
  assert.equal(r5.deltaPct, null);
  assert.deepEqual(buildRows(null), []);
});

test("ageBandOf: fire alders-bånd", () => {
  assert.equal(ageBandOf(21), "u22");
  assert.equal(ageBandOf(22), "22-25");
  assert.equal(ageBandOf(29), "26-29");
  assert.equal(ageBandOf(30), "30+");
  assert.equal(ageBandOf(null), null);
});

test("filterRows: managerhold som standard, division, hold, type, alder, søgning", () => {
  assert.deepEqual(filterRows(rows, DEFAULT_FILTERS).map((r) => r.id), ["r1", "r2", "r3"]);
  assert.equal(filterRows(rows, { ...DEFAULT_FILTERS, scope: "all" }).length, 5);
  assert.deepEqual(filterRows(rows, { ...DEFAULT_FILTERS, scope: "all", division: "1" }).map((r) => r.id), ["r1", "r2", "r4"]);
  assert.deepEqual(filterRows(rows, { ...DEFAULT_FILTERS, teamId: "tB" }).map((r) => r.id), ["r3"]);
  assert.deepEqual(filterRows(rows, { ...DEFAULT_FILTERS, type: "sprinter" }).map((r) => r.id), ["r1"]);
  assert.deepEqual(filterRows(rows, { ...DEFAULT_FILTERS, ageBand: "30+" }).map((r) => r.id), ["r3"]);
  assert.deepEqual(filterRows(rows, { ...DEFAULT_FILTERS, scope: "all", q: "hold b" }).map((r) => r.id), ["r3"]);
  assert.deepEqual(filterRows(rows, { ...DEFAULT_FILTERS, scope: "all", q: "free" }).map((r) => r.id), ["r5"]);
});

test("sortRows: på ændring i % og kr, null altid sidst, stabil på id", () => {
  const all = filterRows(rows, { ...DEFAULT_FILTERS, scope: "all" });
  assert.deepEqual(sortRows(all, "deltaPct", "asc").map((r) => r.id), ["r1", "r2", "r4", "r3", "r5"]);
  assert.deepEqual(sortRows(all, "deltaPct", "desc").map((r) => r.id), ["r3", "r4", "r2", "r1", "r5"]);
  assert.deepEqual(sortRows(all, "deltaKr", "asc").map((r) => r.id), ["r1", "r2", "r4", "r5", "r3"]);
  assert.deepEqual(sortRows(all, "name", "asc").map((r) => r.id)[0], "r5");
});

test("summarize: totaler, op/ned, fald >= 25 % og >= 50 %, median", () => {
  const s = summarize(filterRows(rows, DEFAULT_FILTERS));
  assert.equal(s.n, 3);
  assert.equal(s.before, 400);
  assert.equal(s.after, 310);
  assert.equal(s.deltaKr, -90);
  assert.equal(s.deltaPct, -22.5);
  assert.equal(s.up, 1);
  assert.equal(s.down, 2);
  assert.equal(s.same, 0);
  // r1 falder 60 %, r2 præcis 25 % (tæller med, <= -25); kun r1 >= 50
  assert.equal(s.drop25, 2);
  assert.equal(s.drop50, 1);
  assert.equal(s.medianPct, -25);
  assert.equal(summarize([]).deltaPct, null);
});

test("teamTotals: pr. hold over de filtrerede ryttere, fri agenter uden række", () => {
  const all = filterRows(rows, { ...DEFAULT_FILTERS, scope: "all" });
  const teams = teamTotals(all);
  assert.deepEqual(teams.map((t) => t.id).sort(), ["tA", "tAI", "tB"]);
  const a = teams.find((t) => t.id === "tA")!;
  assert.equal(a.n, 2);
  assert.equal(a.before, 300);
  assert.equal(a.after, 190);
  assert.equal(a.deltaKr, -110);
  assert.ok(Math.abs((a.deltaPct ?? 0) - (-110 / 3)) < 1e-9);
});

test("filterOptions: udledt af rækkerne og afgrænset af scope", () => {
  const managers = filterOptions(rows, "managers");
  assert.deepEqual(managers.teams.map((t) => t.id), ["tA", "tB"]);
  assert.deepEqual(managers.divisions, [1, 2]);
  assert.deepEqual(managers.types, ["climber", "sprinter"]);
  assert.equal(filterOptions(rows, "all").teams.length, 3);
});

test("median + trin-etiketter", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(stepLabelKey(0), "valuePreview.steps.runDay");
  assert.equal(stepLabelKey(3), "valuePreview.steps.week");
});
