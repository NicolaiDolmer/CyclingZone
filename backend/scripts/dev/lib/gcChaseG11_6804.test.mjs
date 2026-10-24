// #6804 G11: klassementsjagten henter udbruddet i foerste del af etapen + yo-yo.
// Syntetiske film og SYNTETISKE lofter (hard rule 17): kun logikken testes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateRaceGroups, G11_RACE_GROUPS, raceGroupMarkdown, raceResultFromDryRun } from "./motorTestportReport.mjs";
import { gcChaseCatchFacts } from "./tourScorecard.mjs";
import { S5_REFORMATION_TUNING } from "../../../lib/engine/v4/mechanics/breakaway.ts";

const D = 200;
const early = D * S5_REFORMATION_TUNING.maxStageFraction * 0.5;
const late = D * S5_REFORMATION_TUNING.maxStageFraction + 10;
const formed = (km, ids, extra = {}) => ({ km, type: "breakaway_formed", params: { rider_ids: ids, ...extra } });
const caught = (km, ids, teams) => ({ km, type: "breakaway_caught", params: { rider_ids: ids, ...(teams ? { chasing_team_ids: teams } : {}) } });
const reaction = (km, team, status) => ({ km, type: "gc_reaction", params: { team_id: team, status, reason: "rival_ahead" } });

test("G11: en indhentning i foerste del af et hold med igangvaerende klassementsreaktion taeller", () => {
  const ev = [formed(5, ["a", "b"]), reaction(10, "T1", "started"), caught(early, ["a", "b"], ["T1", "T2"]), reaction(early, "T1", "stopped")];
  assert.deepEqual(gcChaseCatchFacts(ev, D), { gcEarlyCatch: true, yoyo: false });
});

test("G11: ikke klassementsjagt (ingen reaktion, stoppet reaktion eller andre hold) og sen indhentning taeller ikke", () => {
  assert.equal(gcChaseCatchFacts([formed(5, ["a"]), caught(early, ["a"], ["T1"])], D).gcEarlyCatch, false, "ingen reaktion");
  assert.equal(gcChaseCatchFacts([formed(5, ["a"]), reaction(10, "T1", "started"), reaction(20, "T1", "stopped"), caught(early, ["a"], ["T1"])], D).gcEarlyCatch, false, "stoppet foer");
  assert.equal(gcChaseCatchFacts([formed(5, ["a"]), reaction(10, "T1", "started"), caught(early, ["a"], ["T2"])], D).gcEarlyCatch, false, "andet hold hentede");
  assert.equal(gcChaseCatchFacts([formed(5, ["a"]), reaction(10, "T1", "started"), caught(early, ["a"])], D).gcEarlyCatch, false, "ingen jagende hold");
  assert.equal(gcChaseCatchFacts([formed(5, ["a"]), reaction(10, "T1", "started"), caught(late, ["a"], ["T1"])], D).gcEarlyCatch, false, "i anden del");
  assert.deepEqual(gcChaseCatchFacts([], D), { gcEarlyCatch: false, yoyo: false });
  assert.deepEqual(gcChaseCatchFacts(null, D), { gcEarlyCatch: false, yoyo: false });
});

test("G11: yo-yo = hentet, nyt udbrud, hentet igen", () => {
  const base = [formed(5, ["a"]), reaction(10, "T1", "started"), caught(early, ["a"], ["T1"]), formed(early + 2, ["c", "d"], { reformation: true })];
  assert.equal(gcChaseCatchFacts(base, D).yoyo, false, "det nye udbrud holder");
  const twice = [...base, caught(late, ["c"], ["T1"])];
  assert.deepEqual(gcChaseCatchFacts(twice, D), { gcEarlyCatch: true, yoyo: true });
});

test("G11: aggregeret pr. etapeloebsgruppe (GT og korte), endagsloeb maales ikke; lofter er private og valgfrie", () => {
  const row = (over) => ({ stage: 1, profile_type: "flat", cls: "flat", breakawayWon: false, ...over });
  const dry = (id, stages, rows) => raceResultFromDryRun({ race: { id, name: id, stages }, runs: [{ revision: "rev", seeds: 1, perSeed: [{ seed: 1, rows }], summary: { counts: {}, stages: [], classes: [], race: { verdicts: {} } } }] });
  const races = [
    dry("gt", 21, [row({ gcEarlyCatch: true, yoyo: true }), row({ gcEarlyCatch: false, yoyo: false }), row({ gcEarlyCatch: true, yoyo: false }), row({ gcEarlyCatch: false, yoyo: false })]),
    dry("sr", 5, [row({ gcEarlyCatch: false, yoyo: false }), row({ gcEarlyCatch: true, yoyo: false })]),
    dry("od", 1, [row({ gcEarlyCatch: true, yoyo: true })]),
  ];
  assert.deepEqual([...G11_RACE_GROUPS], ["gt", "stage_race"]);
  const a = aggregateRaceGroups(races, "rev", { gcChaseCatchBands: { gt: { gcEarlyCatchMaxShare: 0.4, yoyoMaxShare: 0.5 } } });
  assert.deepEqual(a.gcChase.gt, { n: 4, gcEarlyCatches: 2, gcEarlyCatchShare: 0.5, yoyo: 1, yoyoShare: 0.25, verdicts: { gcEarlyCatch: "FAIL", yoyo: "PASS" } });
  assert.deepEqual(a.gcChase.stage_race.verdicts, { gcEarlyCatch: "-", yoyo: "-" }, "uden privat loft: ingen dom");
  assert.equal(a.gcChase.stage_race.gcEarlyCatchShare, 0.5);
  assert.equal("one_day" in a.gcChase, false);
  // Aeldre scorecards uden feltet: null, ikke 0.
  assert.equal(aggregateRaceGroups([dry("gt", 21, [row({})])], "rev").gcChase.gt, null);
  const md = raceGroupMarkdown({ baseline: "rev", candidate: "rev", groups: { baseline: a, candidate: a } }).join("\n");
  assert.match(md, /G11/);
  assert.match(md, /gt tidlig GC-indhentning/);
  assert.match(md, /stage_race yo-yo/);
});

test("G11 (Codex #7171): en reaktion der starter i indhentningens segment taeller (motoren skriver indhentningen foerst)", () => {
  const ev = [formed(5, ["a"]), caught(early, ["a"], ["T1"]), reaction(early, "T1", "started")];
  assert.equal(gcChaseCatchFacts(ev, D).gcEarlyCatch, true);
  assert.equal(gcChaseCatchFacts([formed(5, ["a"]), caught(early, ["a"], ["T1"]), reaction(early + 5, "T1", "started")], D).gcEarlyCatch, false, "en senere start taeller ikke");
});
