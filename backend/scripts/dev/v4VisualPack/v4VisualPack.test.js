// #5804: tests for den visuelle v4-testpakkes rene dele (udvaelgelse, analyse,
// resumé, HTML). Syntetiske data: ingen navne, ingen maalte tal fra prod.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  syntheticRaceId, copenhagenDate, selectRacesForCoverage, coverageReport, analyzeStage,
  summarizeAnalyses, terrainFamily, parseGap, breakawayMembers, displayEvents,
} from "./packCore.js";
import { buildPack } from "./buildPack.js";
import { renderPackHtml, renderFilmSvg, esc, fmtGap, groupKindFromId } from "./renderPackHtml.js";

const WINDOW = { from: "2026-09-28", to: "2026-10-04" };

function stage(n, profile, day, hourUtc = 17) {
  return { stage_number: n, profile_type: profile, scheduled_at: `${day}T${String(hourUtc).padStart(2, "0")}:30:00.000Z` };
}

test("syntheticRaceId er deterministisk og UUID-formet", () => {
  const a = syntheticRaceId("senior:pool-1:42");
  assert.equal(a, syntheticRaceId("senior:pool-1:42"));
  assert.notEqual(a, syntheticRaceId("senior:pool-1:43"));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
});

test("copenhagenDate bruger dansk lokaltid, ikke UTC", () => {
  assert.equal(copenhagenDate("2026-10-04T22:30:00.000Z"), "2026-10-05");
  assert.equal(copenhagenDate("2026-09-28T17:30:00.000Z"), "2026-09-28");
  assert.equal(copenhagenDate(null), null);
});

test("terrainFamily samler enkeltstart-typerne og kender ukendte", () => {
  assert.equal(terrainFamily("itt"), "enkeltstart");
  assert.equal(terrainFamily("itt_hilly"), "enkeltstart");
  assert.equal(terrainFamily("high_mountain"), "hoejfjeld");
  assert.equal(terrainFamily("noget_nyt"), "noget_nyt");
});

test("selectRacesForCoverage daekker de kraevede familier og foretraekker det billigste loeb", () => {
  const races = [
    { id: "a", squad: "senior", tier: 1, race_type: "single", stages: [stage(1, "flat", "2026-09-28")] },
    { id: "b", squad: "senior", tier: 1, race_type: "stage_race", stages: [stage(1, "flat", "2026-09-29"), stage(2, "mountain", "2026-09-30")] },
    { id: "c", squad: "senior", tier: 1, race_type: "single", stages: [stage(1, "mountain", "2026-10-01")] },
    { id: "d", squad: "senior", tier: 1, race_type: "single", stages: [stage(1, "itt", "2026-10-12")] },
  ];
  const picked = selectRacesForCoverage({ races, window: WINDOW });
  const ids = picked.map((p) => p.id).sort();
  assert.deepEqual(ids, ["a", "c"], "to endagsloeb daekker flad+bjerg billigere end etapeloebet");
  const cov = coverageReport({ races, picked, window: WINDOW });
  assert.equal(cov.length, 1);
  assert.deepEqual(cov[0].covered, ["bjerg", "flad"]);
  assert.ok(cov[0].notInWeek.includes("enkeltstart"), "loeb uden for ugen taeller ikke");
});

test("selectRacesForCoverage: et etapeloeb koeres fra etape 1 til sidste uge-1-etape", () => {
  const races = [{
    id: "gt", squad: "senior", tier: 1, race_type: "stage_race",
    stages: [stage(1, "cobbles", "2026-10-03"), stage(2, "hilly", "2026-10-04"), stage(3, "flat", "2026-10-05")],
  }];
  const [p] = selectRacesForCoverage({ races, window: WINDOW });
  assert.deepEqual(p.week1Stages, [1, 2]);
  assert.equal(p.simulateThrough, 2);
});

test("parseGap og fmtGap er hinandens omvendte for hele sekunder", () => {
  assert.equal(parseGap("+1:05"), 65);
  assert.equal(parseGap("+0:00"), 0);
  assert.equal(parseGap(null), 0);
  assert.equal(fmtGap(65), "+1:05");
  assert.equal(fmtGap(7), "+7s");
  assert.equal(fmtGap(0), "s.t.");
});

function rec({ family = "flad", distance = 100, events = [], results, v3rows, snapshots, trace = { breakaway_win: false }, favorites = [{ rider_id: "r1" }] }) {
  return {
    raceKey: "race-x",
    stage_number: 1,
    family,
    distance_km: distance,
    favorites,
    riderTeam: { r1: "t1", r2: "t2", r3: "t1", r4: "t3" },
    v4: {
      results,
      events,
      groupSnapshots: snapshots,
      snapshots: [],
      incidents: [],
      trace,
      timelineValid: true,
    },
    v3: { rows: v3rows, events: [], incidents: [] },
  };
}

const CLEAN_RESULTS = [
  { rider_id: "r1", rank: 1, time_seconds: 1000, group_id: "p", status: "finished" },
  { rider_id: "r2", rank: 2, time_seconds: 1000, group_id: "p", status: "finished" },
  { rider_id: "r3", rank: 3, time_seconds: 1001, group_id: "p", status: "finished" },
  { rider_id: "r4", rank: 4, time_seconds: 1060, group_id: "q", status: "finished" },
];
const V3_ROWS = [
  { rider_id: "r1", rank: 1, gap: 0 },
  { rider_id: "r2", rank: 2, gap: 0 },
  { rider_id: "r3", rank: 3, gap: 0 },
  { rider_id: "r4", rank: 4, gap: 5 },
];
const MIDRACE_SNAPSHOTS = [
  { km: 40, groups: [{ group_id: "breakaway-0", kind: "breakaway", rider_ids: ["r4"], gap_seconds: 0 }, { group_id: "p", kind: "peloton", rider_ids: ["r1", "r2", "r3"], gap_seconds: 60 }] },
  { km: 100, groups: [{ group_id: "p", kind: "peloton", rider_ids: ["r1", "r2", "r3", "r4"], gap_seconds: 0 }] },
];

test("analyzeStage: ren massespurt giver ingen alvorlige anomalier", () => {
  const a = analyzeStage(rec({
    results: CLEAN_RESULTS,
    v3rows: V3_ROWS,
    snapshots: MIDRACE_SNAPSHOTS,
    events: [
      { km: 40, type: "breakaway_formed", params: { rider_ids: ["r4"] } },
      { km: 95, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["r4"] } },
      { km: 100, type: "sprint_decided", params: { rider_ids: ["r1"], win_type: "sprint_win" } },
    ],
  }));
  assert.equal(a.v4.winType, "sprint_win");
  assert.equal(a.v3.winType, "sprint_win");
  assert.equal(a.sameWinner, true);
  assert.equal(a.top10Overlap, 4);
  assert.equal(a.favorite.v4Rank, 1);
  assert.equal(a.breakaway.formedDuringRace, true);
  assert.deepEqual(a.anomalies.filter((x) => x.severity !== "lav"), []);
});

test("analyzeStage: udbrud der 'gaar' paa maallinjen og ét segment markeres", () => {
  const a = analyzeStage(rec({
    results: CLEAN_RESULTS,
    v3rows: V3_ROWS,
    snapshots: [MIDRACE_SNAPSHOTS[1]],
    events: [{ km: 100, type: "breakaway_formed", params: { rider_ids: ["r4"] } }],
  }));
  const codes = a.anomalies.map((x) => x.code);
  assert.ok(codes.includes("breakaway_at_finish"));
  assert.ok(codes.includes("single_segment"));
  assert.equal(a.breakaway.formedDuringRace, false);
});

test("analyzeStage: OTL paa en flad etape er alvorlig, paa bjerg kun info", () => {
  const withOtl = [...CLEAN_RESULTS.slice(0, 3), { rider_id: "r4", rank: 4, time_seconds: 4000, group_id: "q", status: "otl" }];
  const flat = analyzeStage(rec({ results: withOtl, v3rows: V3_ROWS, snapshots: MIDRACE_SNAPSHOTS }));
  const flatOtl = flat.anomalies.find((x) => x.code === "otl_non_mountain");
  assert.equal(flatOtl.severity, "hoej");
  assert.equal(flat.v4.otl, 1);
  assert.equal(flat.v4.lastGap, 3000, "sidste mand medregner OTL-rytteren");
  const mountain = analyzeStage(rec({ family: "bjerg", results: withOtl, v3rows: V3_ROWS, snapshots: MIDRACE_SNAPSHOTS }));
  assert.equal(mountain.anomalies.find((x) => x.code === "otl_mountain").severity, "lav");
});

test("analyzeStage: motorens udbrudsdom uden en udbrydder som vinder er alvorlig", () => {
  const a = analyzeStage(rec({ results: CLEAN_RESULTS, v3rows: V3_ROWS, snapshots: MIDRACE_SNAPSHOTS, trace: { breakaway_win: true } }));
  assert.ok(a.anomalies.some((x) => x.code === "trace_breakaway_mismatch" && x.severity === "hoej"));
});

test("analyzeStage: 'udbrud holder' paa sidste segment men slaaet i finalen er kun info", () => {
  const a = analyzeStage(rec({
    results: CLEAN_RESULTS,
    v3rows: V3_ROWS,
    snapshots: MIDRACE_SNAPSHOTS,
    events: [
      { km: 40, type: "breakaway_formed", params: { rider_ids: ["r4"] } },
      { km: 100, type: "breakaway_survived", params: { group_id: "breakaway-0", rider_ids: ["r4"] } },
    ],
  }));
  const hit = a.anomalies.find((x) => x.code === "survived_then_beaten");
  assert.equal(hit.severity, "lav");
  assert.ok(!a.anomalies.some((x) => x.code === "caught_and_survived"));
});

test("breakawayMembers samler alle udbrud paa tvaers af snapshots", () => {
  const ids = breakawayMembers([
    { km: 10, groups: [{ kind: "breakaway", rider_ids: ["a"] }] },
    { km: 50, groups: [{ kind: "breakaway", rider_ids: ["b"] }, { kind: "peloton", rider_ids: ["c"] }] },
  ]);
  assert.deepEqual([...ids].sort(), ["a", "b"]);
});

test("displayEvents tynder gap_update ud men beholder alt andet", () => {
  const out = displayEvents([
    { km: 1, type: "gap_update", params: {} },
    { km: 5, type: "gap_update", params: {} },
    { km: 5, type: "incident", params: {} },
    { km: 30, type: "gap_update", params: {} },
  ]);
  assert.deepEqual(out.map((e) => `${e.km}:${e.type}`), ["1:gap_update", "5:incident", "30:gap_update"]);
});

test("summarizeAnalyses taeller favoritter, udbrud og anomalier", () => {
  const a1 = analyzeStage(rec({ results: CLEAN_RESULTS, v3rows: V3_ROWS, snapshots: MIDRACE_SNAPSHOTS }));
  const a2 = analyzeStage(rec({ results: CLEAN_RESULTS, v3rows: V3_ROWS, snapshots: [MIDRACE_SNAPSHOTS[1]], events: [{ km: 100, type: "breakaway_formed", params: {} }] }));
  const s = summarizeAnalyses([a1, a2]);
  assert.equal(s.stages, 2);
  assert.equal(s.favorites.winV4, 2);
  assert.equal(s.sameWinner, 2);
  assert.equal(s.breakaway.formed, 0, "et udbrud der kun 'gaar' paa stregen taeller ikke som dannet");
  assert.ok(s.anomalies.hoej >= 1);
});

test("groupKindFromId laeser gruppe-arten af motorens id", () => {
  assert.equal(groupKindFromId("breakaway-2000"), "breakaway");
  assert.equal(groupKindFromId("gruppetto-1000"), "gruppetto");
  assert.equal(groupKindFromId("finale-bunch-0"), "peloton");
});

test("renderFilmSvg tegner grupper og maerker uden at fejle paa tomme data", () => {
  assert.match(renderFilmSvg({}), /^<svg/u);
  const svg = renderFilmSvg({
    snapshots: [[40, [["breakaway", 3, 0, "b"], ["peloton", 100, 120, "p"]]], [100, [["peloton", 103, 0, "p"]]]],
    events: [{ km: 40, type: "breakaway_formed", params: {} }, { km: 100, type: "finish", params: {} }],
    gapTrack: [[70, "b", 0], [70, "peloton-0", 60]],
    distanceKm: 100,
  });
  assert.ok((svg.match(/<circle/gu) ?? []).length >= 5);
  assert.ok(svg.includes(">U<"));
});

test("buildPack + renderPackHtml: selvstaendig side, ingen eksterne scripts, HTML escapes", () => {
  const raw = {
    meta: { generated_at: "2026-09-26T19:00:00.000Z", source: "dry-run-plan", window: WINDOW, flags: {}, notes: [], coverage: [] },
    races: [{
      key: "race-x", name: "<Loeb & co>", tier: 1, squad: "senior", race_class: "Class1", stageCount: 1,
      riders: { r1: { name: "Rytter <A>", team: "t1" } }, teams: { t1: { name: "Hold \"A\"" } },
    }],
    stages: [{
      ...rec({ results: CLEAN_RESULTS, v3rows: V3_ROWS, snapshots: MIDRACE_SNAPSHOTS }),
      scheduled_at: "2026-09-28T17:30:00.000Z",
    }],
  };
  const pack = buildPack(raw);
  assert.equal(pack.stages.length, 1);
  assert.equal(pack.stages[0].v4.groupSnapshots, undefined, "raa snapshots droppes efter analysen");
  assert.ok(pack.text.works.length > 0);
  const html = renderPackHtml(pack);
  assert.match(html, /^<!doctype html>/u);
  assert.ok(!/<script[^>]+src=/iu.test(html), "ingen eksterne scripts");
  assert.ok(!/<link[^>]+stylesheet/iu.test(html), "ingen eksterne stylesheets");
  assert.ok(html.includes("&lt;Loeb &amp; co&gt;"));
  assert.ok(html.includes("Rytter &lt;A&gt;"));
  assert.ok(!html.includes("<Loeb & co>"));
  assert.equal((html.match(/<section class="stage"/gu) ?? []).length, 1);
});

test("esc escaper alle fem HTML-tegn", () => {
  assert.equal(esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});
