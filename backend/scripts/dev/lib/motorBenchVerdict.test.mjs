// #6451: motor-testbaenkens rene dom-funktioner (dedup, nedkoerselsmarkering, dom).
import test from "node:test";
import assert from "node:assert/strict";
import {
  beforeAfter, breakawaySplit, buildVerdict, compareGroups, dedupRoutes, isOneDayDescentFinish, judge,
  profileVerdicts, routeKey, statusFromScore,
} from "./motorBenchVerdict.mjs";
import { finishDescentIndexFor, SHARED_TIME_MODEL_V3_TUNING, SHARED_TIME_MODEL_V2_TUNING } from "../../../lib/engine/v4/mechanics/timeModel.ts";

const REVS = ["rev_a", "rev_b"];

const rev = (statuses, values = {}) => ({
  ...values,
  verdicts: Object.fromEntries(Object.entries(statuses).map(([k, s]) => [k, { status: s, band: { min: null, max: null } }])),
});

function stageRow({ name, stage = 1, profile_type = "hilly", distance_km = 180, descentFinish = false, a = {}, b = {}, av = {}, bv = {} }) {
  return {
    stage, profile_type, finale_type: null, cls: "hilly", distance_km,
    routeKey: routeKey(name, { stage_number: stage, profile_type, finale_type: null, distance_km }),
    descentFinish,
    revisions: { rev_a: rev(a, av), rev_b: rev(b, bv) },
  };
}
const race = (id, name, stages, oneDay = stages.length === 1) => ({ id, name, oneDay, stages });

test("routeKey: samme loeb og etape i to divisioner giver samme noegle; anden etape/distance ikke", () => {
  const p = { stage_number: 2, profile_type: "hilly", finale_type: "punch", distance_km: 190 };
  assert.equal(routeKey("Loeb X", p), routeKey("Loeb X", { ...p }));
  assert.equal(routeKey("Loeb X", p), routeKey("Loeb X", { stage: 2, profile_type: "hilly", finale_type: "punch", distance_km: 190 }), "etapeprofil og bench-raekke matcher");
  assert.notEqual(routeKey("Loeb X", p), routeKey("Loeb X", { ...p, stage_number: 3 }));
  assert.notEqual(routeKey("Loeb X", p), routeKey("Loeb X", { ...p, distance_km: 200 }));
  assert.notEqual(routeKey("Loeb X", p), routeKey("Loeb Y", p));
});

test("dedupRoutes: samme rute i fire divisioner er een stemme med gennemsnit over divisionerne", () => {
  const races = [
    race("r1", "Klassiker", [stageRow({ name: "Klassiker", a: { breakawayWinShare: "FAIL" }, b: { breakawayWinShare: "PASS" }, av: { breakawayWinShare: 1 }, bv: { breakawayWinShare: 0.2 } })]),
    race("r2", "Klassiker", [stageRow({ name: "Klassiker", a: { breakawayWinShare: "FAIL" }, b: { breakawayWinShare: "PASS" }, av: { breakawayWinShare: 0.8 }, bv: { breakawayWinShare: 0.4 } })]),
    race("r3", "Klassiker", [stageRow({ name: "Klassiker", a: { breakawayWinShare: "FAIL" }, b: { breakawayWinShare: "FAIL" }, av: { breakawayWinShare: 1 }, bv: { breakawayWinShare: 1 } })]),
    race("r4", "Klassiker", [stageRow({ name: "Klassiker", a: { breakawayWinShare: "FAIL" }, b: { breakawayWinShare: "PASS" }, av: { breakawayWinShare: 0.6 }, bv: { breakawayWinShare: 0.2 } })]),
    race("r5", "Andet loeb", [stageRow({ name: "Andet loeb", a: { gapTo10: "PASS" }, b: { gapTo10: "WARN" } })]),
  ];
  const groups = dedupRoutes(races, REVS);
  assert.equal(groups.length, 2, "fem raekker, to ruter");
  const g = groups.find((x) => x.raceName === "Klassiker");
  assert.equal(g.divisions, 4);
  assert.deepEqual(g.raceIds, ["r1", "r2", "r3", "r4"]);
  assert.equal(g.byRevision.rev_a.values.breakawayWinShare, 0.85);
  assert.equal(g.byRevision.rev_b.values.breakawayWinShare, 0.45);
  assert.equal(g.byRevision.rev_a.scores.breakawayWinShare, 0);
  assert.equal(g.byRevision.rev_b.scores.breakawayWinShare, 0.75);
  assert.equal(g.byRevision.rev_b.statuses.breakawayWinShare, "PASS");
  assert.equal(g.byRevision.rev_a.scores.gapTo10, null, "uden status: ingen stemme");
});

test("dedupRoutes: raekker uden routeKey (aeldre bench.json) faar samme noegle som nye", () => {
  const old = stageRow({ name: "Klassiker", a: { gapTo10: "PASS" }, b: { gapTo10: "PASS" } });
  delete old.routeKey;
  const fresh = stageRow({ name: "Klassiker", a: { gapTo10: "PASS" }, b: { gapTo10: "PASS" } });
  assert.equal(dedupRoutes([race("o", "Klassiker", [old])], REVS)[0].key, fresh.routeKey);
});

test("statusFromScore: midlet point tilbage til naermeste status", () => {
  assert.equal(statusFromScore(1), "PASS");
  assert.equal(statusFromScore(0.75), "PASS");
  assert.equal(statusFromScore(0.5), "WARN");
  assert.equal(statusFromScore(0.25), "FAIL");
  assert.equal(statusFromScore(0), "FAIL");
  assert.equal(statusFromScore(null), null);
});

test("isOneDayDescentFinish: motorens #6200-detektion, kun i endagsloeb", () => {
  const descentFinish = { profile_type: "hilly", finale_type: "descent", segments: [
    { kind: "flat", from_km: 0, to_km: 150 }, { kind: "climb", from_km: 150, to_km: 170 }, { kind: "descent", from_km: 170, to_km: 190 },
  ] };
  const runIn = { profile_type: "hilly", finale_type: "descent", segments: [
    { kind: "climb", from_km: 150, to_km: 170 }, { kind: "descent", from_km: 170, to_km: 185 }, { kind: "flat", from_km: 185, to_km: 188 },
  ] };
  const longRunIn = { ...runIn, segments: [...runIn.segments.slice(0, 2), { kind: "flat", from_km: 185, to_km: 215 }] };
  const climbFinish = { profile_type: "hilly", finale_type: "punch", segments: [{ kind: "flat", from_km: 0, to_km: 170 }, { kind: "climb", from_km: 170, to_km: 172 }] };
  const det = { finishDescentIndexFor, tuning: SHARED_TIME_MODEL_V3_TUNING };
  assert.equal(isOneDayDescentFinish({ oneDay: true, route: descentFinish, ...det }), true);
  assert.equal(isOneDayDescentFinish({ oneDay: false, route: descentFinish, ...det }), false, "etapeloeb markeres aldrig");
  assert.equal(isOneDayDescentFinish({ oneDay: true, route: runIn, ...det }), true, "kort stykke efter nedkoerslen taeller under v3-tuningen");
  assert.equal(isOneDayDescentFinish({ oneDay: true, route: runIn, finishDescentIndexFor, tuning: SHARED_TIME_MODEL_V2_TUNING }), false, "v2-tuningen har intet run-in");
  assert.equal(isOneDayDescentFinish({ oneDay: true, route: longRunIn, ...det }), false, "langt stykke efter nedkoerslen er ikke en nedkoerselsfinale");
  assert.equal(isOneDayDescentFinish({ oneDay: true, route: climbFinish, ...det }), false);
  assert.equal(isOneDayDescentFinish({ oneDay: true, route: null, ...det }), false);
});

test("judge: bedre/vaerre kraever et netto paa mindst en tiendedel, ellers i tvivl", () => {
  assert.equal(judge({ better: 0, worse: 0, comparisons: 0 }), "unsure");
  assert.equal(judge({ better: 3, worse: 1, comparisons: 20 }), "better");
  assert.equal(judge({ better: 2, worse: 1, comparisons: 20 }), "unsure");
  assert.equal(judge({ better: 1, worse: 4, comparisons: 20 }), "worse");
  assert.equal(judge({ better: 1, worse: 0, comparisons: 3 }), "better");
});

test("compareGroups + breakawaySplit: udbrudssejre paa nedkoerselsfinaler taeller for sig, ikke i bedre/vaerre", () => {
  const races = [
    race("d", "Nedkoersel", [stageRow({ name: "Nedkoersel", descentFinish: true, a: { breakawayWinShare: "PASS" }, b: { breakawayWinShare: "FAIL" }, av: { breakawayWinShare: 0.2 }, bv: { breakawayWinShare: 1 } })]),
    race("n", "Normal", [stageRow({ name: "Normal", a: { breakawayWinShare: "FAIL" }, b: { breakawayWinShare: "PASS" }, av: { breakawayWinShare: 0.8 }, bv: { breakawayWinShare: 0.4 } })]),
  ];
  const groups = dedupRoutes(races, REVS);
  const cmp = compareGroups(groups.map((g) => ({ groupA: g, groupB: g, revA: "rev_a", revB: "rev_b", descentFinish: g.descentFinish })));
  assert.deepEqual({ better: cmp.better, worse: cmp.worse, comparisons: cmp.comparisons }, { better: 1, worse: 0, comparisons: 1 });
  assert.equal(cmp.status, "better");
  const split = breakawaySplit(groups, "rev_b");
  assert.equal(split.all.routes, 2);
  assert.equal(split.all.meanWinShare, 0.7);
  assert.deepEqual(split.withoutDescentFinish, { routes: 1, meanWinShare: 0.4 });
  assert.deepEqual(split.descentFinishOnly, { routes: 1, meanWinShare: 1 });
});

test("profileVerdicts: dom pr. profil paa de-duplikerede ruter", () => {
  const races = [
    race("h1", "Bakke", [stageRow({ name: "Bakke", a: { gapTo10: "FAIL" }, b: { gapTo10: "PASS" } })]),
    race("h2", "Bakke", [stageRow({ name: "Bakke", a: { gapTo10: "FAIL" }, b: { gapTo10: "PASS" } })]),
    race("f1", "Flad", [stageRow({ name: "Flad", profile_type: "flat", a: { gapTo10: "PASS" }, b: { gapTo10: "FAIL" } })]),
  ];
  const v = profileVerdicts(dedupRoutes(races, REVS), { baseline: "rev_a", candidate: "rev_b" });
  assert.equal(v.hilly.routes, 1);
  assert.equal(v.hilly.rows, 2);
  assert.equal(v.hilly.duplicateRows, 1);
  assert.equal(v.hilly.better, 1, "to divisioner, een stemme");
  assert.equal(v.hilly.status, "better");
  assert.equal(v.flat.status, "worse");
});

test("beforeAfter + buildVerdict: foer/efter mod forrige koersel paa matchede ruter", () => {
  const prev = { generatedAt: "foer", revisions: REVS, races: [
    race("p1", "Bakke", [stageRow({ name: "Bakke", b: { gapTo10: "FAIL" } })]),
    race("p2", "Kun foer", [stageRow({ name: "Kun foer", b: { gapTo10: "PASS" } })]),
  ] };
  const now = { generatedAt: "nu", revisions: REVS, races: [
    race("n1", "Bakke", [stageRow({ name: "Bakke", a: { gapTo10: "FAIL" }, b: { gapTo10: "PASS" } })]),
    race("n2", "Bakke", [stageRow({ name: "Bakke", a: { gapTo10: "FAIL" }, b: { gapTo10: "PASS" } })]),
    race("n3", "Kun nu", [stageRow({ name: "Kun nu", a: { gapTo10: "PASS" }, b: { gapTo10: "PASS" } })]),
  ] };
  const ba = beforeAfter(dedupRoutes(prev.races, ["rev_b"]), dedupRoutes(now.races, REVS), { revision: "rev_b" });
  assert.equal(ba.matchedRoutes, 1);
  assert.equal(ba.onlyNow, 1);
  assert.equal(ba.onlyBefore, 1);
  assert.equal(ba.byProfile.hilly.better, 1);
  assert.equal(ba.overall.status, "better");

  const v = buildVerdict(now, { previous: prev });
  assert.equal(v.baseline, "rev_a");
  assert.equal(v.candidate, "rev_b");
  assert.deepEqual(v.dedup, { rows: 3, routes: 2, duplicateRows: 1 });
  assert.equal(v.beforeAfter.previousGeneratedAt, "foer");
  assert.equal(v.beforeAfter.overall.better, 1);
  assert.equal(buildVerdict(now).beforeAfter, null, "uden forrige koersel: ingen foer/efter");
  assert.equal(buildVerdict(now, { previous: { revisions: ["andet"], races: prev.races } }).beforeAfter, null, "forrige uden kandidat-revisionen: ingen foer/efter");
});
