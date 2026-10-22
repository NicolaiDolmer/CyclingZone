// #6804 P7: loebsgrupper i scorecardet og testport-kortet (G1', G12, G14).
// Syntetiske fixtures og SYNTETISKE baand (hard rule 17): ingen maalte tal og
// ingen af de private balance-baand, kun haandlavede vaerdier der tester logikken.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateRaceGroups, bandVerdict, breakawayRaceGroup, buildTestportCard, gapGroupVerdicts, quantile,
  raceGroupMarkdown, raceResultFromDryRun, renderTestportMarkdown, shortGapGroup,
} from "./motorTestportReport.mjs";
import { privateGapBand, shortStageRaceGroup, summarizeTour } from "./tourScorecard.mjs";

const row = (over = {}) => ({ stage: 1, profile_type: "hilly", cls: "hilly", breakawayWon: false, breakawaySize: 6, gapTo10: 10, ...over });
const dryRun = (id, stages, perSeed) => raceResultFromDryRun({ race: { id, name: id, stages }, runs: [{ revision: "rev", seeds: perSeed.length, perSeed, summary: { counts: { PASS: 0, WARN: 0, FAIL: 0, TODO: 0, "N/A": 0 }, stages: [], classes: [], race: { verdicts: {} } } }] });

test("loebsgrupperne: endagsloeb, etapeloeb, Grand Tour og de korte tidsgab-grupper", () => {
  assert.equal(breakawayRaceGroup(1), "one_day");
  assert.equal(breakawayRaceGroup(4), "stage_race");
  assert.equal(breakawayRaceGroup(14), "stage_race");
  assert.equal(breakawayRaceGroup(21), "gt");
  for (const [n, g] of [[1, null], [2, "sr2-4"], [4, "sr2-4"], [5, "sr5-8"], [8, "sr5-8"], [9, null], [21, null]]) {
    assert.equal(shortGapGroup(n), g, `report ${n}`);
    assert.equal(shortStageRaceGroup(n), g, `scorecard ${n}`);
  }
});

test("bandVerdict og gapGroupVerdicts: intet baand = '-', median og hale doemmes hver for sig", () => {
  assert.equal(bandVerdict(0.5, null), "-");
  assert.equal(bandVerdict(null, { min: 0, max: 1 }), "-");
  assert.equal(bandVerdict(0.5, { min: 0, max: 1 }), "PASS");
  assert.equal(bandVerdict(2, { max: 1 }), "FAIL");
  const band = { min: 10, max: 100, medianMin: 20, medianMax: 50 };
  assert.deepEqual(gapGroupVerdicts({ median: 30, p10: 12, p90: 90 }, band), { median: "PASS", tail: "PASS" });
  assert.deepEqual(gapGroupVerdicts({ median: 60, p10: 12, p90: 140 }, band), { median: "FAIL", tail: "FAIL" });
  assert.deepEqual(gapGroupVerdicts({ median: 30, p10: 12, p90: 90 }, null), { median: "-", tail: "-" });
  assert.equal(quantile([5, 1, 3], 0.5), 3);
  assert.equal(quantile([null, undefined], 0.5), null);
});

test("aggregateRaceGroups: udbrud pr. gruppe x terraen, tidsgab kun i korte etapeloeb", () => {
  const races = [
    dryRun("one", 1, [{ seed: 1, rows: [row({ breakawayWon: true })], gcFinalTo10: 5, gcWinnerMargin: 1 }]),
    dryRun("short", 3, [
      { seed: 1, rows: [row(), row({ stage: 2, profile_type: "flat", cls: "flat" }), row({ stage: 3, profile_type: "itt", cls: "itt" })], gcFinalTo10: 40, gcWinnerMargin: 4 },
      { seed: 2, rows: [row({ breakawayWon: true }), row({ stage: 2, profile_type: "flat", cls: "flat" })], gcFinalTo10: 60, gcWinnerMargin: 8 },
    ]),
    dryRun("week", 6, [{ seed: 1, rows: [row()], gcFinalTo10: 200, gcWinnerMargin: 30 }]),
  ];
  const thresholds = {
    breakawayWinShareByGroup: { one_day: { hilly: { min: 0, max: 0.5 } }, stage_race: { hilly: { min: 0.1, max: 0.9 } } },
    breakawayGroupTotalBands: { stage_race: { min: 0.5, max: 1 } },
    shortStageRaceGapBands: { "sr2-4": { gcTo10Final: { min: 30, max: 70 }, gcWinnerMargin: { min: 0, max: 7 } } },
  };
  const g = aggregateRaceGroups(races, "rev", thresholds);
  assert.equal(g.breakaway.one_day.total.n, 1);
  assert.equal(g.breakaway.one_day.byTerrain.hilly.verdict, "FAIL");
  // stage_race: 3 + 1 vejetaper (tidskoersel taelles ikke), 1 udbrudssejr.
  assert.equal(g.breakaway.stage_race.total.n, 5);
  assert.equal(g.breakaway.stage_race.total.breakawayWinShare, 1 / 5);
  assert.equal(g.breakaway.stage_race.total.verdict, "FAIL");
  assert.equal(g.breakaway.stage_race.byTerrain.hilly.verdict, "PASS");
  assert.equal(g.breakaway.stage_race.byTerrain.flat.hasBand, false);
  assert.equal(g.breakaway.stage_race.byTerrain.flat.verdict, "-");
  assert.equal(g.breakaway.gt.total.n, 0);
  assert.equal(g.gaps["sr2-4"].races, 1);
  assert.equal(g.gaps["sr2-4"].gcTo10Final.median, 50);
  assert.deepEqual(g.gaps["sr2-4"].gcTo10Final.verdicts, { median: "PASS", tail: "PASS" });
  assert.deepEqual(g.gaps["sr2-4"].gcWinnerMargin.verdicts, { median: "PASS", tail: "FAIL" });
  assert.equal(g.gaps["sr5-8"].races, 1);
  assert.deepEqual(g.gaps["sr5-8"].gcTo10Final.verdicts, { median: "-", tail: "-" });
});

test("kortet faar loebsgruppe-afsnittet for begge revisioner", () => {
  const races = [dryRun("short", 3, [{ seed: 1, rows: [row({ breakawayWon: true })], gcFinalTo10: 40, gcWinnerMargin: 4 }])];
  const card = buildTestportCard({ raceResults: races, baseline: "rev", candidate: "rev" });
  assert.ok(card.groups.baseline.breakaway.stage_race);
  const md = raceGroupMarkdown(card).join("\n");
  assert.match(md, /Loebsgrupper \(#6804/);
  assert.match(md, /stage_race hilly/);
  assert.match(md, /sr2-4 gcTo10Final/);
  assert.match(renderTestportMarkdown(card), /Loebsgrupper/);
});

test("summarizeTour: et kort etapeloeb doemmes aldrig mod Grand Tour-baandene (#6804 P7)", () => {
  const stages = [1, 2, 3].map((n) => ({ stage_number: n, profile_type: "flat" }));
  const perSeed = [1, 2, 3].map((seed) => ({ seed, rows: stages.map((p) => ({ stage: p.stage_number, gapTo10: 0, breakawayWon: false })), gcWeek1: 1, gcFinalTo10: 50, gcWinnerMargin: 3, gcWinner: "a" }));
  const without = summarizeTour(perSeed, stages, "s5_profiles_v2");
  assert.equal(without.race.gapGroup, "sr2-4");
  assert.equal(without.race.verdicts.gcTo10Final, "N/A");
  assert.equal(without.race.verdicts.gcWinnerMargin, "N/A");
  assert.equal(without.race.verdicts.gcTo10AfterWeek1, "N/A");
  const bands = { "sr2-4": { gcTo10Final: { min: 10, max: 60 }, gcWinnerMargin: { min: 10, max: 20 } } };
  const withBands = summarizeTour(perSeed, stages, "s5_profiles_v2", { shortRaceGapBands: bands });
  assert.equal(withBands.race.verdicts.gcTo10Final, "PASS");
  assert.notEqual(withBands.race.verdicts.gcWinnerMargin, "PASS");
  // En Grand Tour beholder sin dom.
  const gtStages = Array.from({ length: 21 }, (_, i) => ({ stage_number: i + 1, profile_type: "flat" }));
  const gtSeeds = [{ seed: 1, rows: gtStages.map((p) => ({ stage: p.stage_number, gapTo10: 0, breakawayWon: false })), gcWeek1: 1, gcFinalTo10: 50, gcWinnerMargin: 3, gcWinner: "a" }];
  const gt = summarizeTour(gtSeeds, gtStages, "s5_profiles_v2", { shortRaceGapBands: bands });
  assert.equal(gt.race.gapGroup, undefined);
  assert.notEqual(gt.race.verdicts.gcTo10Final, "N/A");
});

test("privateGapBand: kun gyldige graenser, ellers null (N/A)", () => {
  assert.equal(privateGapBand(null), null);
  assert.equal(privateGapBand({}), null);
  assert.equal(privateGapBand({ min: "x" }), null);
  assert.deepEqual({ min: privateGapBand({ min: 1, max: 2 }).min, max: privateGapBand({ min: 1, max: 2 }).max }, { min: 1, max: 2 });
  assert.equal(privateGapBand({ max: 2 }).min, undefined);
});
