// #6804 v3-gaterne (G16-G19 + G2-flad) og #2757 S0. Syntetiske fixtures (hard
// rule 17): ingen maalte tal, baandene her er opdigtede testvaerdier.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateV3Gates, GATE_STATUS, inBand, isSprinter, measureG16, measureG17, measureG18, measureG19, measureG2F,
  measureSprintFinale, raceContextFromCache, raceGroupOfStages, V3_GATES, v3GatesApply,
} from "./v3Gates.mjs";
import { createJerseyTally } from "./jerseyTally.mjs";

const REV = "cand";
const raceResult = (raceId, stages, perSeed) => ({ raceId, name: raceId, stages, runs: { [REV]: { revision: REV, perSeed } } });

function ctx(over = {}) {
  return {
    stages: 5, group: "stage_race", divisionId: "d1",
    roleByRider: new Map([["spr", "sprint_captain"], ["lo", "helper"], ["gc", "captain"], ["x", "helper"]]),
    teamByRider: new Map([["spr", "t1"], ["lo", "t1"], ["gc", "t2"], ["x", "t3"]]),
    sprintRankByRider: new Map([["spr", 1], ["lo", 2], ["x", 3], ["gc", 9]]),
    flatStages: 2, mountainNonSummitStages: new Set([3]),
    ...over,
  };
}

const ALL_BANDS = {
  G16: { gcAlsoKom: { stage_race: { max: 0.5 }, gt: { max: 0.5 } }, komFromBreak: { min: 0.5 } },
  G17: { abandonShare: { stage_race: { min: 0.01, max: 0.5 } }, captainVsHelperMaxRatio: 1 },
  G18: { minFlatStages: 2, topSprinters: 2, sprinterWins: { min: 0.5 }, gcWinnerWins: { max: 0.25 } },
  G19: { gapTo10Median: { max: 100 } },
  G2F: { upperZoneSeconds: { flat: 300, rolling: 400 }, hardMaxSeconds: 600 },
};

test("raceGroupOfStages og inBand", () => {
  assert.equal(raceGroupOfStages(1), "one_day");
  assert.equal(raceGroupOfStages(7), "stage_race");
  assert.equal(raceGroupOfStages(21), "gt");
  assert.equal(inBand(0.3, { max: 0.5 }), true);
  assert.equal(inBand(0.6, { max: 0.5 }), false);
  assert.equal(inBand(0.1, { min: 0.2 }), false);
  assert.equal(inBand(0.1, {}), null, "et baand uden graenser er ugyldigt");
  assert.equal(inBand(null, { max: 1 }), null);
});

test("v3GatesApply: kun s5_profiles_v3 og senere", () => {
  assert.equal(v3GatesApply("s5_profiles_v3"), true);
  assert.equal(v3GatesApply("s5_profiles_v12"), true);
  assert.equal(v3GatesApply("s5_profiles_v2"), false);
  assert.equal(v3GatesApply("official_times_v5"), false);
  assert.equal(v3GatesApply(null), false);
});

test("stubs: uden motor-sporenes felter er G16, G17 og G2-flad MANGLER, og kandidaten er blokeret", () => {
  const rr = [raceResult("r1", 5, [{ gcWinner: "gc", rows: [{ stage: 1, profile_type: "flat" }] }])];
  const res = evaluateV3Gates({ raceResults: rr, revision: REV, contexts: new Map([["r1", ctx()]]), bands: ALL_BANDS });
  const by = Object.fromEntries(res.gates.map((g) => [g.id, g.status]));
  assert.equal(by.G16, GATE_STATUS.MISSING);
  assert.equal(by.G17, GATE_STATUS.MISSING);
  assert.equal(by.G2F, GATE_STATUS.MISSING);
  assert.equal(res.blocked, true);
  assert.deepEqual(res.gates.map((g) => g.id), V3_GATES.map((g) => g.id));
});

test("G16: klassementsvinder = bjergtroeje pr. gruppe, og udbrudspoint", () => {
  const seeds = [
    { gcWinner: "gc", komWinner: "gc", komWinnerBreakawayPoints: 0 },
    { gcWinner: "gc", komWinner: "x", komWinnerBreakawayPoints: 10 },
  ];
  const m = measureG16([raceResult("r1", 5, seeds)], REV, new Map([["r1", ctx()]]));
  assert.equal(m.byGroup.stage_race.n, 2);
  assert.equal(m.byGroup.stage_race.gcAlsoKom, 0.5);
  assert.equal(m.byGroup.gt.n, 0);
  assert.equal(m.komFromBreak.share, 0.5);
  assert.equal(measureG16([raceResult("r1", 1, seeds)], REV, new Map()), null, "endagsloeb taeller ikke");
});

test("G16 uden udbrudspoint-feltet (komWinner leveret, motor-sporet ikke endnu) er MANGLER", () => {
  const rr = [raceResult("r1", 5, [{ gcWinner: "gc", komWinner: "x" }])];
  const g = evaluateV3Gates({ raceResults: rr, revision: REV, contexts: new Map([["r1", ctx()]]), bands: ALL_BANDS }).gates.find((x) => x.id === "G16");
  assert.equal(g.status, GATE_STATUS.MISSING);
  assert.match(g.why, /udbrudspoint/);
});

test("G17: andel udgaaede og kaptajner mod hjaelpere", () => {
  const ab = (out, capOut) => ({ starters: 10, out, byRole: { captain: { starters: 2, out: capOut }, helper: { starters: 8, out: out - capOut } } });
  const m = measureG17([raceResult("r1", 5, [{ abandons: ab(2, 0) }, { abandons: ab(2, 1) }])], REV, new Map([["r1", ctx()]]));
  assert.equal(m.byGroup.stage_race.share, 0.2);
  assert.equal(m.captainRate, 0.25);
  assert.equal(m.helperRate, 3 / 16);
  const g = evaluateV3Gates({ raceResults: [raceResult("r1", 5, [{ abandons: ab(2, 0) }, { abandons: ab(2, 1) }])], revision: REV, contexts: new Map([["r1", ctx()]]), bands: ALL_BANDS }).gates.find((x) => x.id === "G17");
  assert.equal(g.status, GATE_STATUS.FAIL, "kaptajner udgaar oftere end hjaelpere");
});

test("isSprinter: sprint-kaptajn eller blandt feltets bedste sprintere", () => {
  const c = ctx();
  assert.equal(isSprinter("spr", c, 0), true);
  assert.equal(isSprinter("lo", c, 2), true);
  assert.equal(isSprinter("x", c, 2), false);
  assert.equal(isSprinter("gc", c, 2), false);
});

test("G18: kun loeb med nok flade etaper; sprinter- og klassementsvinder-andel", () => {
  const seeds = [{ gcWinner: "gc", pointsWinner: "spr" }, { gcWinner: "gc", pointsWinner: "gc" }];
  const contexts = new Map([["r1", ctx()], ["r2", ctx({ flatStages: 1 })]]);
  const m = measureG18([raceResult("r1", 5, seeds), raceResult("r2", 5, seeds)], REV, contexts, { minFlatStages: 2, topSprinters: 2 });
  assert.equal(m.n, 2);
  assert.equal(m.races, 1);
  assert.equal(m.sprinterWins, 0.5);
  assert.equal(m.gcWinnerWins, 0.5);
  assert.equal(measureG18([raceResult("r1", 5, seeds)], REV, contexts, {}), null, "uden privat baand ingen maaling");
  const g = evaluateV3Gates({ raceResults: [raceResult("r1", 5, seeds)], revision: REV, contexts, bands: ALL_BANDS }).gates.find((x) => x.id === "G18");
  assert.equal(g.status, GATE_STATUS.FAIL);
  assert.match(g.why, /klassementsvinderen/);
});

test("G19: nr. 10 paa bjerg uden topankomst pr. division; udbrudssejre og andre etaper taeller ikke", () => {
  const rows = [
    { stage: 3, gapTo10: 60, breakawayWon: false },
    { stage: 3, gapTo10: 999, breakawayWon: true },
    { stage: 2, gapTo10: 999, breakawayWon: false },
  ];
  const contexts = new Map([["r1", ctx()], ["r2", ctx({ divisionId: "d2" })]]);
  const rr = [raceResult("r1", 5, [{ rows }]), raceResult("r2", 5, [{ rows: [{ stage: 3, gapTo10: 140, breakawayWon: false }] }])];
  const m = measureG19(rr, REV, contexts);
  assert.equal(m.n, 2);
  assert.equal(m.byDivision.d1.median, 60);
  assert.equal(m.byDivision.d2.median, 140);
  const g = evaluateV3Gates({ raceResults: rr, revision: REV, contexts, bands: ALL_BANDS }).gates.find((x) => x.id === "G19");
  assert.equal(g.status, GATE_STATUS.FAIL);
  assert.match(g.why, /d2/);
  const noStages = new Map([["r1", ctx({ mountainNonSummitStages: new Set() })], ["r2", ctx({ mountainNonSummitStages: new Set() })]]);
  const none = evaluateV3Gates({ raceResults: rr, revision: REV, contexts: noStages, bands: ALL_BANDS }).gates.find((x) => x.id === "G19");
  assert.equal(none.status, GATE_STATUS.NA, "ingen bjergetape uden topankomst = N/A, ikke blokerende");
  const noCtx = evaluateV3Gates({ raceResults: rr, revision: REV, contexts: new Map(), bands: ALL_BANDS }).gates.find((x) => x.id === "G19");
  assert.equal(noCtx.status, GATE_STATUS.MISSING, "manglende loebskontekst er manglende evidens (Codex)");
  const noGap = [raceResult("r1", 5, [{ rows: [{ stage: 3, gapTo10: null, breakawayWon: false }] }])];
  assert.equal(evaluateV3Gates({ raceResults: noGap, revision: REV, contexts, bands: ALL_BANDS }).gates.find((x) => x.id === "G19").status, GATE_STATUS.MISSING);
});

test("G2-flad: over oevre zone uden 'ingen jagt-interesse' og over haard graense", () => {
  const rows = [
    { profile_type: "flat", breakawayMaxLead: 350, breakawayUnchased: false },
    { profile_type: "flat", breakawayMaxLead: 350, breakawayUnchased: true },
    { profile_type: "rolling", breakawayMaxLead: 650, breakawayUnchased: true },
    { profile_type: "hilly", breakawayMaxLead: 2000 },
  ];
  const m = measureG2F([raceResult("r1", 5, [{ rows }])], REV, new Map(), ALL_BANDS.G2F);
  assert.equal(m.n, 3);
  assert.equal(m.overUpperWithoutUnchased, 1);
  assert.equal(m.overHardMax, 1);
  const noBand = measureG2F([raceResult("r1", 5, [{ rows }])], REV, new Map(), {});
  assert.equal(noBand.overUpperWithoutUnchased, null);
});

test("alle gates groenne = ikke blokeret", () => {
  const seeds = [
    { gcWinner: "gc", komWinner: "x", komWinnerBreakawayPoints: 5, pointsWinner: "spr",
      abandons: { starters: 10, out: 1, byRole: { captain: { starters: 2, out: 0 }, helper: { starters: 8, out: 1 } } },
      rows: [{ stage: 1, profile_type: "flat", breakawayMaxLead: 200, breakawayUnchased: false }, { stage: 3, gapTo10: 50, breakawayWon: false }] },
  ];
  const res = evaluateV3Gates({ raceResults: [raceResult("r1", 5, seeds)], revision: REV, contexts: new Map([["r1", ctx()]]), bands: ALL_BANDS });
  assert.deepEqual(res.gates.map((g) => g.status), ["PASS", "PASS", "PASS", "PASS", "PASS"]);
  assert.equal(res.blocked, false);
  assert.deepEqual(res.reasons, []);
});

test("manglende privat baand blokerer (fail closed)", () => {
  const seeds = [{ gcWinner: "gc", komWinner: "x", komWinnerBreakawayPoints: 5 }];
  const res = evaluateV3Gates({ raceResults: [raceResult("r1", 5, seeds)], revision: REV, contexts: new Map([["r1", ctx()]]), bands: null });
  assert.equal(res.gates.find((g) => g.id === "G16").status, GATE_STATUS.MISSING);
  assert.equal(res.blocked, true);
});

test("S0: vinderens sprint-rang, rolle, lead-out der slog egen kaptajn og top 10 mod sprint-rang", () => {
  const rows = [
    { stage: 1, profile_type: "flat", breakawayWon: false, sprintTop10: ["spr", "lo", "x"] },
    { stage: 2, profile_type: "flat", breakawayWon: false, sprintTop10: ["lo", "spr", "x"] },
    { stage: 3, profile_type: "cobbles", breakawayWon: false, sprintTop10: ["gc", "x"] },
    { stage: 4, profile_type: "flat", breakawayWon: true, sprintTop10: ["x"] },
    { stage: 5, profile_type: "hilly", breakawayWon: false, sprintTop10: ["x"] },
  ];
  const s = measureSprintFinale([raceResult("r1", 5, [{ rows }])], REV, new Map([["r1", ctx()]]));
  assert.equal(s.alle.n, 3);
  assert.equal(s.alle.bestSprinterWins, 1 / 3);
  assert.equal(s.alle.top3Wins, 2 / 3);
  assert.equal(s.alle.helperBeatOwnSprintCaptain, 1 / 3);
  assert.equal(s["terraen:flat"].n, 2);
  assert.equal(s["terraen:flat"].top10MeanRankDiffMedian, 1 / 3, "median af [0, 2/3]");
  assert.equal(s["terraen:cobbles"].roleShares.captain, 1);
  assert.equal(s["gruppe:stage_race"].n, 3);
  assert.equal(measureSprintFinale([raceResult("r1", 5, [{ rows }])], REV, new Map()), null, "uden loebskontekst ingen maaling");
});

test("raceContextFromCache: sprint-rang, roller, flade etaper og bjerg uden topankomst", () => {
  const cache = {
    race: { id: "r1", stages: 3, league_division_id: "d9" },
    profiles: [{ stage_number: 1, profile_type: "flat" }, { stage_number: 2, profile_type: "flat" }, { stage_number: 3, profile_type: "mountain", finale_type: "descent" }],
    entries: [{ rider_id: "a", team_id: "t", race_role: "sprint_captain" }, { rider_id: "b", team_id: "t", race_role: "helper" }, { rider_id: "nope", team_id: "t", race_role: "helper" }],
    abilities: [{ rider_id: "a", sprint: 80 }, { rider_id: "b", sprint: 90 }],
  };
  const c = raceContextFromCache(cache, { isMountainNonSummit: (p) => p.profile_type === "mountain" && p.finale_type !== "long_climb" });
  assert.equal(c.group, "stage_race");
  assert.equal(c.divisionId, "d9");
  assert.equal(c.sprintRankByRider.get("b"), 1);
  assert.equal(c.sprintRankByRider.get("a"), 2);
  assert.equal(c.sprintRankByRider.has("nope"), false, "ryttere uden evner koeres ikke");
  assert.equal(c.flatStages, 2);
  assert.deepEqual([...c.mountainNonSummitStages], [3]);
  assert.equal(raceContextFromCache(null), null);
});

test("createJerseyTally: passager naar de findes, ellers classPointsForRank; vinder kun blandt dem der fuldfoerte", () => {
  const t = createJerseyTally();
  t.addStage({ profile: { profile_type: "flat" }, ranked: [{ rider_id: "a", rank: 1 }, { rider_id: "b", rank: 2 }], passages: { perRider: new Map([["a", { sprint_points: 4, kom_points: 0 }], ["b", { sprint_points: 9, kom_points: 3 }]]) } });
  t.addStage({ profile: { profile_type: "mountain" }, ranked: [{ rider_id: "c", rank: 1 }, { rider_id: "a", rank: 2 }], passages: null });
  const w = t.winners([{ rider_id: "a" }, { rider_id: "c" }]);
  assert.equal(w.pointsWinner, "c", "b fuldfoerte ikke; c har 25 mod a's 4 + 20");
  assert.equal(w.komWinner, "c");
  assert.deepEqual(createJerseyTally().winners([{ rider_id: "a" }]), { pointsWinner: null, komWinner: null });
});

test("Codex: G17 taeller sprint-kaptajner som kaptajner og kun helper som hjaelpere", () => {
  const abandons = { starters: 10, out: 2, byRole: { sprint_captain: { starters: 1, out: 1 }, captain: { starters: 1, out: 0 }, helper: { starters: 6, out: 1 }, hunter: { starters: 2, out: 0 } } };
  const m = measureG17([raceResult("r1", 5, [{ abandons }])], REV, new Map([["r1", ctx()]]));
  assert.equal(m.captainRate, 0.5);
  assert.equal(m.helperRate, 1 / 6);
});

test("Codex: G2-flad uden brugbare forspring eller uden oevre zone for et maalt terraen er MANGLER", () => {
  const nulls = [raceResult("r1", 5, [{ rows: [{ profile_type: "flat", breakawayMaxLead: null }] }])];
  assert.equal(evaluateV3Gates({ raceResults: nulls, revision: REV, bands: ALL_BANDS }).gates.find((g) => g.id === "G2F").status, GATE_STATUS.MISSING);
  const rolling = [raceResult("r1", 5, [{ rows: [{ profile_type: "rolling", breakawayMaxLead: 100, breakawayUnchased: false }] }])];
  const bands = { ...ALL_BANDS, G2F: { upperZoneSeconds: { flat: 300 }, hardMaxSeconds: 600 } };
  const g = evaluateV3Gates({ raceResults: rolling, revision: REV, bands }).gates.find((x) => x.id === "G2F");
  assert.equal(g.status, GATE_STATUS.MISSING);
  assert.match(g.why, /rolling/);
});
