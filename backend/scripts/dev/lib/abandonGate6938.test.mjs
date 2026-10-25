// #6938 G17: udgaaede pr. loebsgruppe (motorTestportReport.abandonGateG17) og
// testportens traethed mellem etaperne (tourScorecard.afterStageCondition).
// Ingen maalte tal her (hard rule 17); kun definitionerne.
import { test } from "node:test";
import assert from "node:assert/strict";

import { ABANDON_RACE_GROUPS, abandonGateG17, abandonRaceGroup, buildTestportCard, renderTestportMarkdown } from "./motorTestportReport.mjs";
import { abandonCounts, afterStageCondition, runStagesInOrder } from "./tourScorecard.mjs";

const seed = (starters, out, captains, captainsOut, helpers, helpersOut) => ({
  abandons: {
    starters,
    out,
    startersByRole: { captain: captains, helper: helpers, other: starters - captains - helpers },
    outByRole: { captain: captainsOut, helper: helpersOut, other: out - captainsOut - helpersOut },
  },
});
const race = (stages, runs) => ({ raceId: `r${stages}`, name: `r${stages}`, stages, runs });

test("#6938 G17: loebsgrupperne daekker alle etapeantal uden overlap", () => {
  assert.equal(abandonRaceGroup(1), "one_day");
  assert.equal(abandonRaceGroup(3), "short");
  assert.equal(abandonRaceGroup(7), "week");
  assert.equal(abandonRaceGroup(21), "grand_tour");
  assert.equal(abandonRaceGroup(0), null);
  assert.equal(abandonRaceGroup(null), null);
  for (let n = 1; n <= 30; n++) {
    assert.equal(ABANDON_RACE_GROUPS.filter(([, lo, hi]) => n >= lo && n <= hi).length, 1, `${n} etaper`);
  }
});

test("#6938 G17: andelen udgaaede pr. gruppe, baand-dom og kaptajnreglen", () => {
  const results = [
    race(21, { v3: { perSeed: [seed(100, 20, 10, 1, 60, 15), seed(100, 10, 10, 1, 60, 8)] }, v2: { perSeed: [seed(100, 2, 10, 0, 60, 2)] } }),
    race(1, { v3: { perSeed: [seed(50, 10, 5, 3, 30, 6)] } }),
    race(5, { v3: { perSeed: [{ rows: [] }] } }), // aeldre scorecard uden feltet: springes over
  ];
  const bands = { grand_tour: { min: 0.1, max: 0.2 }, one_day: { min: 0.3, max: 0.6 } };
  const g = abandonGateG17(results, "v3", { bands });
  assert.equal(g.grand_tour.races, 1);
  assert.equal(g.grand_tour.seeds, 2);
  assert.equal(g.grand_tour.outShare, 30 / 200);
  assert.equal(g.grand_tour.captainOutShare, 2 / 20);
  assert.equal(g.grand_tour.helperOutShare, 23 / 120);
  assert.deepEqual(g.grand_tour.verdicts, { band: "PASS", captainsNotAboveHelpers: "PASS" });
  // Endagsloebet: for faa udgaaede OG kaptajnerne udgaar oftere end hjaelperne.
  assert.deepEqual(g.one_day.verdicts, { band: "FAIL", captainsNotAboveHelpers: "FAIL" });
  // Ingen data: N/A; data uden baand: TODO.
  assert.equal(g.week.seeds, 0);
  assert.deepEqual(g.week.verdicts, { band: "N/A", captainsNotAboveHelpers: "N/A" });
  assert.equal(abandonGateG17(results, "v3").grand_tour.verdicts.band, "TODO");
  // Kortet baerer G17 for begge revisioner og viser afsnittet.
  const card = buildTestportCard({ raceResults: results, baseline: "v2", candidate: "v3", thresholds: { abandonG17Bands: bands } });
  assert.equal(card.g17.candidate.grand_tour.outShare, 30 / 200);
  assert.equal(card.g17.baseline.grand_tour.outShare, 2 / 100);
  assert.match(renderTestportMarkdown(card), /## G17 udgaaede pr\. loebsgruppe/);
});

test("#6938 G17: abandonCounts taeller startere og udgaaede pr. rollegruppe", () => {
  const entrants = [
    { rider_id: "a", race_role: "captain" },
    { rider_id: "b", race_role: "sprint_captain" },
    { rider_id: "c", race_role: "helper" },
    { rider_id: "d", race_role: "helper" },
    { rider_id: "e", race_role: "free_role" },
  ];
  assert.deepEqual(abandonCounts(entrants, [{ rider_id: "a" }, { rider_id: "c" }, { rider_id: "e" }]), {
    starters: 5,
    out: 2,
    startersByRole: { captain: 2, helper: 2, other: 1 },
    outByRole: { captain: 1, helper: 1 },
    byRole: { captain: { starters: 2, out: 1 }, helper: { starters: 2, out: 1 }, other: { starters: 1, out: 0 } },
  });
});

test("#6938: testportens traethed stiger efter en haard etape og formen foelger #6984-modellen", () => {
  const rider = { rider_id: "x", fatigue: 30, form: 60, effort: "normal", abilities: { recovery: 50 } };
  const mountain = afterStageCondition(rider, { profile_type: "high_mountain", distance_km: 200, stage_number: 15 });
  const flat = afterStageCondition(rider, { profile_type: "flat", distance_km: 150, stage_number: 2 });
  assert.ok(mountain.fatigue > flat.fatigue, "en bjergetape sent i loebet slider mere end en flad etape tidligt");
  assert.ok(mountain.fatigue >= 0 && mountain.fatigue <= 100);
  assert.equal(typeof mountain.form, "number");
  assert.equal(rider.fatigue, 30, "input muteres ikke");
});

test("#6938 (Codex P2): med --track-fatigue faar onStage feltet SOM DET KOERTE etapen, ikke tilstanden efter", () => {
  const simulated = [];
  const v4 = {
    simulateStage: (input) => {
      simulated.push(input.entrants.map((e) => [e.rider_id, e.fatigue, e.form]));
      return { ranked: input.entrants.map((e, i) => ({ rider_id: e.rider_id, rank: i + 1, stageGap: i })), passages: null, v4Output: { results: [] }, timeline: null };
    },
  };
  const data = { race: { id: "r" }, orders: [], profiles: [1, 2, 3].map((n) => ({ stage_number: n, profile_type: "high_mountain", distance_km: 200 })) };
  const entrants = ["a", "b"].map((id) => ({ rider_id: id, team_id: "t", fatigue: 20, form: 60, effort: "normal", abilities: { recovery: 50 } }));
  const seen = [];
  runStagesInOrder({ v4, data, revision: "orders_gc_v2", seedTag: "x", entrants, trackFatigue: true, onStage: ({ entrants: e }) => seen.push(e.map((x) => [x.rider_id, x.fatigue, x.form])) });
  assert.equal(seen.length, 3);
  assert.deepEqual(seen, simulated, "onStage-feltet er det motoren fik paa etapen");
  assert.ok(simulated[1][0][1] > simulated[0][0][1], "traetheden foeres videre til naeste etape");
});

test("#6938 G17 (Codex #7178): abandonCounts leverer kontraktens byRole (v3Gates.measureG17)", () => {
  const entrants = [
    { rider_id: "a", race_role: "captain" }, { rider_id: "b", race_role: "sprint_captain" },
    { rider_id: "c", race_role: "helper" }, { rider_id: "d", race_role: "helper" },
  ];
  const abandons = abandonCounts(entrants, [{ rider_id: "a" }, { rider_id: "c" }]);
  assert.deepEqual(abandons.byRole, { captain: { starters: 2, out: 1 }, helper: { starters: 2, out: 1 } });
});
