// #6750: samle-logikken i motor-testporten. Syntetiske fixtures (hard rule 17):
// ingen maalte tal fra motoren, kun haandlavede scorecards.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateRevision, benchView, buildTestportCard, copenhagenDate, fmtS, HARD_GATES, median,
  perRaceRows, raceResultFromDryRun, renderTestportHtml, renderTestportMarkdown, sideBySideRows, verdictTallies,
} from "./motorTestportReport.mjs";

const counts = (PASS, WARN, FAIL) => ({ PASS, WARN, FAIL, TODO: 0, "N/A": 0 });

function row(over = {}) {
  return {
    stage: 1, profile_type: "flat", cls: "flat", gapTo10: 0, breakawaySize: 3, breakawayWon: false, breakawayWinMargin: null,
    labelContradictions: 0, minuteLossAtZeroKm: 0, flatBreakawayWinMinutes: 0, gcTop10InBreakOver5Min: 0, ownTeamChasesOwn: 0, clampedAtCap: 0,
    ittGapTo10Per40Km: null, winnerId: "w", winnerRole: "sprint_captain", breakawayRiderIds: ["b1", "b2", "b3"], earlyCatch: false, reformed: false,
    ...over,
  };
}

function run(revision, perSeed, { c = counts(1, 0, 0), raceVerdicts = {} } = {}) {
  return {
    revision, seeds: perSeed.length, perSeed,
    summary: { counts: c, stages: [{ verdicts: { gapTo10: "PASS" } }], classes: [{ verdicts: { breakawayWinShare: "FAIL" } }], race: { verdicts: raceVerdicts } },
  };
}

function dryRun({ id, name, stages = 1, runs }) {
  return { race: { id, name, stages }, generatedAt: "2026-01-01T00:00:00Z", runs };
}

test("raceResultFromDryRun noegler runs paa revision og afviser tomt", () => {
  const rr = raceResultFromDryRun(dryRun({ id: "r1", name: "Loeb A", runs: [run("base", []), run("cand", [])] }));
  assert.deepEqual(Object.keys(rr.runs).sort(), ["base", "cand"]);
  assert.equal(rr.name, "Loeb A");
  assert.equal(raceResultFromDryRun({ race: { id: "x" }, runs: [] }), null);
  assert.equal(raceResultFromDryRun(null), null);
});

test("verdictTallies taeller etape-, profiltype- og loebsdomme pr. noegle", () => {
  const t = verdictTallies({ stages: [{ verdicts: { gapTo10: "PASS" } }, { verdicts: { gapTo10: "FAIL" } }], classes: [{ verdicts: { breakawaySize: "WARN" } }], race: { verdicts: { gcTo10Final: "N/A" } } });
  assert.equal(t.gapTo10.PASS, 1);
  assert.equal(t.gapTo10.FAIL, 1);
  assert.equal(t.breakawaySize.WARN, 1);
  assert.equal(t.gcTo10Final["N/A"], 1);
});

test("aggregateRevision: haarde gates, store udbrudssejre, terraen og favorit-udbrudssejre", () => {
  const races = [
    raceResultFromDryRun(dryRun({ id: "r1", name: "A", runs: [run("rev", [{ seed: 1, rows: [
      row({ breakawayWon: true, breakawayWinMargin: 700, winnerRole: "captain", labelContradictions: 1 }),
      row({ stage: 2, profile_type: "mountain", cls: "mountain", gapTo10: 90, breakawaySize: 8 }),
      row({ stage: 3, profile_type: "itt", cls: "itt", ittGapTo10Per40Km: 50, breakawayRiderIds: [], winnerRole: undefined }),
    ] }], { c: counts(3, 1, 2), raceVerdicts: { labelContradictions: "FAIL" } })] })),
    raceResultFromDryRun(dryRun({ id: "r2", name: "B", runs: [run("other", [])] })),
  ];
  const a = aggregateRevision(races, "rev");
  assert.equal(a.races, 1);
  assert.equal(a.missing, 1);
  assert.equal(a.stageRuns, 3);
  assert.equal(a.roadRuns, 2);
  assert.deepEqual(a.counts, counts(3, 1, 2));
  assert.deepEqual(a.hardGates.labelContradictions, { total: 1, racesHit: 1, racesFail: 1, measured: 3 });
  assert.equal(a.hardGates.clampedAtCap.racesHit, 0);
  assert.equal(a.bigBreakawayWins, 1);
  assert.equal(a.bigBreakawayWinShare, 0.5);
  assert.equal(a.ittGapTo10Per40KmMedian, 50);
  assert.equal(a.byClass.flat.breakawayWinShare, 1);
  assert.equal(a.byClass.flat.gapTo10Median, null, "nr. 10 maales kun paa hentede seeds");
  assert.equal(a.byClass.mountain.gapTo10Median, 90);
  assert.equal(a.byProfileType.mountain.breakawaySizeMedian, 8);
  assert.deepEqual(a.favouriteBreakawayWins, { count: 1, ofBreakawayWins: 1, breakawayWins: 1, ofRoadRuns: 0.5 });
});

test("aggregateRevision: GC-vinder fra udbrud og tidlige indhentninger paa etapeloeb", () => {
  const seedA = { seed: 1, gcWinner: "g", gcFinalTo10: 300, gcWinnerMargin: 30, rows: [
    row({ breakawayRiderIds: ["g", "x"], breakawayWon: true, winnerId: "g", earlyCatch: true, reformed: true }),
    row({ stage: 2, breakawayRiderIds: ["y"] }),
  ] };
  const seedB = { seed: 2, gcWinner: "h", gcFinalTo10: 500, gcWinnerMargin: 50, rows: [row({ breakawayRiderIds: ["x"], earlyCatch: true }), row({ stage: 2, breakawayRiderIds: [] })] };
  const rr = raceResultFromDryRun(dryRun({ id: "r", name: "Etapeloeb", stages: 2, runs: [run("rev", [seedA, seedB])] }));
  const a = aggregateRevision([rr], "rev");
  assert.equal(a.stageRaces.races, 1);
  assert.equal(a.stageRaces.gcTo10FinalMedian, 400);
  assert.equal(a.stageRaces.gcWinnerMarginMedian, 40);
  assert.deepEqual(a.gcWinnerFromBreak, { seeds: 2, member: 1, memberShare: 0.5, wonFromBreak: 1, wonFromBreakShare: 0.5 });
  assert.deepEqual(a.earlyCatches, { count: 2, ofBreakaways: 2 / 3, breakaways: 3, reformed: 1, reformedShare: 0.5 });
});

test("aggregateRevision: aeldre scorecards uden de nye felter giver null, ikke 0", () => {
  const old = row({ breakawayWon: true });
  for (const k of ["winnerId", "winnerRole", "breakawayRiderIds", "earlyCatch", "reformed"]) delete old[k];
  const rr = raceResultFromDryRun(dryRun({ id: "r", name: "Gammel", stages: 2, runs: [run("rev", [{ seed: 1, gcWinner: "g", rows: [old] }])] }));
  const a = aggregateRevision([rr], "rev");
  assert.equal(a.favouriteBreakawayWins, null);
  assert.equal(a.gcWinnerFromBreak, null);
  assert.equal(a.earlyCatches, null);
});

test("buildTestportCard: kandidat side om side, regressioner paa haarde gates og pr. loeb sorteret efter FAIL-forvaerring", () => {
  const mk = (id, baseFail, candFail, candGate) => raceResultFromDryRun(dryRun({ id, name: `Loeb ${id}`, runs: [
    run("base", [{ seed: 1, rows: [row()] }], { c: counts(5, 0, baseFail) }),
    run("cand", [{ seed: 1, rows: [row({ ownTeamChasesOwn: candGate })] }], { c: counts(5, 0, candFail) }),
  ] }));
  const card = buildTestportCard({ raceResults: [mk("a", 1, 1, 0), mk("b", 0, 3, 2), null], baseline: "base", candidate: "cand", meta: { seeds: 1, generatedAt: "t" } });
  assert.equal(card.races, 2);
  assert.equal(card.sameRevision, false);
  assert.equal(card.verdict.failDelta, 3);
  assert.deepEqual(card.verdict.hardGateRegressions.map((r) => r.gate), ["ownTeamChasesOwn"]);
  assert.equal(card.perRace[0].raceId, "b");
  assert.equal(card.perRace[0].candidate.hardGateHits, 2);
  const failRow = sideBySideRows(card).find((r) => r[0] === "FAIL");
  assert.deepEqual(failRow, ["FAIL", "1", "4", "+3"]);
});

test("buildTestportCard: kandidat = baseline genbruger samme aggregat (roegtest)", () => {
  const rr = raceResultFromDryRun(dryRun({ id: "a", name: "A", runs: [run("same", [{ seed: 1, rows: [row()] }])] }));
  const card = buildTestportCard({ raceResults: [rr], baseline: "same", candidate: "same" });
  assert.equal(card.sameRevision, true);
  assert.equal(card.revisions.baseline, card.revisions.candidate);
  assert.equal(card.verdict.failDelta, 0);
  assert.ok(sideBySideRows(card).every((r) => r[3] === "=" || r[3] === "-"));
});

test("benchView plukker gate-domme og udbrud pr. terraen/afslutning", () => {
  const v = benchView({ config: { revision: "rev" }, scope: "all", summary: { gate: { medians: { flat_sprint: 1 }, verdicts: { flat_sprint: "inside" }, sources: {} }, all: { byTerrainFinish: { "flat/flat_sprint": { n: 2, median: 1, breakawayWinPct: 50, winnerTypesPct: {} } } } } });
  assert.equal(v.revision, "rev");
  assert.equal(v.gate.verdicts.flat_sprint, "inside");
  assert.deepEqual(v.byTerrainFinish["flat/flat_sprint"], { n: 2, median: 1, breakawayWinPct: 50 });
  assert.equal(benchView({}), null);
});

test("renderTestportMarkdown og -Html indeholder dom, haarde gates, bench og pr. loeb", () => {
  const rr = raceResultFromDryRun(dryRun({ id: "a", name: "Loeb <A>", runs: [run("base", [{ seed: 1, rows: [row()] }]), run("cand", [{ seed: 1, rows: [row({ clampedAtCap: 1 })] }])] }));
  const bench = benchView({ config: { revision: "cand" }, scope: "all", summary: { gate: { medians: { punch: 2 }, verdicts: { punch: "below" } }, all: { byTerrainFinish: {} } } });
  const card = buildTestportCard({ raceResults: [rr], baseline: "base", candidate: "cand", benchByRevision: { cand: bench }, meta: { seeds: 1, failedRaces: ["x"] } });
  const md = renderTestportMarkdown(card);
  assert.match(md, /# Motor-testport \(#6750\): cand mod base/);
  assert.match(md, /Haarde gates VAERRE under kandidaten: ramt loft/);
  assert.match(md, /1 loeb fejlede/);
  for (const [, label] of HARD_GATES) assert.ok(md.includes(label), label);
  assert.match(md, /\| punch \| - \| - \| 2 s \| below \|/);
  assert.match(md, /Loeb <A>/);
  const html = renderTestportHtml(card);
  assert.match(html, /^<!doctype html>/);
  assert.ok(!html.includes("<A>"), "ingen raa markup fra data i HTML");
  assert.match(html, /Haarde gates vaerre/);
});

test("smaa hjaelpere: median, fmtS, copenhagenDate", () => {
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(median([]), null);
  assert.equal(fmtS(-65), "-1:05");
  assert.equal(fmtS(null), "-");
  assert.equal(copenhagenDate(new Date("2026-10-17T22:30:00Z")), "2026-10-18");
});

test("tourScorecard.testportStageFacts: vinder, rolle, udbrudsryttere, tidlig indhentning og nyt udbrud", async () => {
  const { testportStageFacts } = await import("./tourScorecard.mjs");
  const { S5_REFORMATION_TUNING } = await import("../../../lib/engine/v4/mechanics/breakaway.ts");
  const km = 100;
  const early = km * S5_REFORMATION_TUNING.maxStageFraction - 1;
  const late = km * S5_REFORMATION_TUNING.maxStageFraction + 1;
  const results = [{ rider_id: "w", status: "finished", time_seconds: 10, rank: 1 }, { rider_id: "z", status: "finished", time_seconds: 12, rank: 2 }];
  const out = (events) => ({ results, timeline: { events } });
  const roles = new Map([["w", "captain"]]);
  const caughtEarly = out([
    { type: "breakaway_formed", km: 1, params: { rider_ids: ["a", "b"] } },
    { type: "breakaway_caught", km: early, params: { rider_ids: ["a", "b"] } },
    { type: "breakaway_formed", km: early + 1, params: { rider_ids: ["c"], reformation: true } },
  ]);
  const f = testportStageFacts(caughtEarly, { distance_km: km }, roles);
  assert.equal(f.winnerId, "w");
  assert.equal(f.winnerRole, "captain");
  assert.deepEqual(f.breakawayRiderIds.sort(), ["a", "b", "c"]);
  assert.equal(f.earlyCatch, true);
  assert.equal(f.reformed, true);
  const lateCatch = testportStageFacts(out([{ type: "breakaway_formed", km: 1, params: { rider_ids: ["a"] } }, { type: "breakaway_caught", km: late, params: { rider_ids: ["a"] } }]), { distance_km: km }, null);
  assert.equal(lateCatch.earlyCatch, false);
  assert.equal(lateCatch.winnerRole, null);
  assert.equal(testportStageFacts(out([]), { distance_km: km }).earlyCatch, false, "intet udbrud = ingen indhentning");
});

test("perRaceRows taaler loeb uden koersel under en revision", () => {
  const rr = raceResultFromDryRun(dryRun({ id: "a", name: "A", runs: [run("base", [])] }));
  const rows = perRaceRows([rr], "base", "cand");
  assert.equal(rows[0].candidate, null);
});
