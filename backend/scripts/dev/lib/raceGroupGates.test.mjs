// #7214 loebsgruppe-gaten (monumenter + favoritsejre). Syntetiske fixtures (hard
// rule 17): ingen maalte tal; baandene her er opdigtede testvaerdier.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bandFor, buildRaceGroupCard, evaluateRaceGroupGates, FAVOURITE_TOP_N, groupSlices, measureCheck, MONUMENT_RACE_CLASS,
  RACE_GROUP_CHECKS, raceGroupGateLine, raceGroupGatesApply, raceGroupGateSection, raceGroupOf, routeFavourites,
} from "./raceGroupGates.mjs";
import { aggregateRaceGroups, buildTestportCard, raceResultFromDryRun, renderTestportMarkdown } from "./motorTestportReport.mjs";

const BASE = "base";
const CAND = "cand";
const check = (id) => RACE_GROUP_CHECKS.find((c) => c.id === id);

// Testens egnethed: summen af evne x vaegt (samme form som terrainScore, uden skala).
const suitability = (ab, stages) => stages.reduce((s, p) => s + Object.entries(p.demand_vector ?? {}).reduce((a, [k, w]) => a + (Number(ab?.[k]) || 0) * w, 0), 0) / stages.length;

const riders = ["a", "b", "c", "d", "e"];
// a-c er bedst til bjerg, c-e bedst til spurt.
const abilities = [
  { rider_id: "a", climbing: 90, sprint: 10 }, { rider_id: "b", climbing: 80, sprint: 20 }, { rider_id: "c", climbing: 70, sprint: 70 },
  { rider_id: "d", climbing: 20, sprint: 80 }, { rider_id: "e", climbing: 10, sprint: 90 },
];
const flat = (n) => ({ stage_number: n, profile_type: "flat", demand_vector: { sprint: 1 } });
const mtn = (n) => ({ stage_number: n, profile_type: "mountain", demand_vector: { climbing: 1 } });
const cache = (id, raceClass, profiles) => ({ race: { id, race_class: raceClass, stages: profiles.length }, profiles, entries: riders.map((r) => ({ rider_id: r, team_id: `t-${r}`, race_role: "helper" })), abilities });

function ctxOf(c) {
  const stages = c.profiles.length;
  return { stages, group: stages <= 1 ? "one_day" : stages >= 15 ? "gt" : "stage_race", raceClass: c.race.race_class, raceGroup: raceGroupOf({ stages, raceClass: c.race.race_class }), favourites: routeFavourites(c, { suitability }), roleByRider: new Map(), teamByRider: new Map(), sprintRankByRider: new Map() };
}
const row = (stage, winnerId, extra = {}) => ({ stage, profile_type: "flat", cls: "flat", winnerId, breakawayWon: false, ...extra });
const rr = (raceId, stages, raceClass, perSeedByRev) => ({ raceId, name: raceId, stages, raceClass, runs: Object.fromEntries(Object.entries(perSeedByRev).map(([rev, perSeed]) => [rev, { revision: rev, perSeed }])) });

test("raceGroupOf: monument = endagsloeb med race_class Monuments; etapeloeb er aldrig monument", () => {
  assert.equal(MONUMENT_RACE_CLASS, "Monuments");
  assert.equal(raceGroupOf({ stages: 1, raceClass: "Monuments" }), "monument");
  assert.equal(raceGroupOf({ stages: 1, raceClass: "Class1" }), "one_day");
  assert.equal(raceGroupOf({ stages: 1 }), "one_day");
  assert.equal(raceGroupOf({ stages: 5, raceClass: "Monuments" }), "stage_race");
  assert.equal(raceGroupOf({ stages: 21, raceClass: "TourFrance" }), "gt");
});

test("raceGroupGatesApply: blokerer kun efter s5_profiles_v3 (fail closed for ukendte navne)", () => {
  assert.equal(raceGroupGatesApply("s5_profiles_v3"), false);
  assert.equal(raceGroupGatesApply("s5_profiles_v2"), false);
  assert.equal(raceGroupGatesApply("legacy"), false);
  assert.equal(raceGroupGatesApply("s5_profiles_v3_1"), true);
  assert.equal(raceGroupGatesApply("s5_profiles_v4"), true);
  assert.equal(raceGroupGatesApply("noget_nyt"), true);
  assert.equal(raceGroupGatesApply(null), false);
});

test("routeFavourites: top 3 til ruten; samlet uden flade etaper; holdtidskoersel uden favoritter", () => {
  assert.equal(FAVOURITE_TOP_N, 3);
  const one = routeFavourites(cache("m", "Monuments", [flat(1)]), { suitability });
  assert.deepEqual([...one.raceFav].sort(), ["c", "d", "e"]);
  const sr = routeFavourites(cache("s", "Class1", [flat(1), mtn(2), flat(3), { stage_number: 4, profile_type: "ttt", demand_vector: { time_trial: 1 } }]), { suitability });
  assert.deepEqual([...sr.raceFav].sort(), ["a", "b", "c"], "samlet: kun bjerg-etapen (flade og holdtidskoersel ude)");
  assert.deepEqual([...sr.stageFav.get(1)].sort(), ["c", "d", "e"]);
  assert.deepEqual([...sr.stageFav.get(2)].sort(), ["a", "b", "c"]);
  assert.equal(sr.stageFav.get(4), null);
  const onlyFlat = routeFavourites(cache("f", "Class1", [flat(1), flat(2)]), { suitability });
  assert.deepEqual([...onlyFlat.raceFav].sort(), ["c", "d", "e"], "kun flade etaper: alle etaper");
  const noDemand = routeFavourites(cache("x", "Class1", [{ stage_number: 1, profile_type: "flat" }]), { suitability });
  assert.equal(noDemand.raceFav, null);
  assert.throws(() => routeFavourites(cache("m", "Monuments", [flat(1)])), /suitability/);
});

test("measureCheck: endagsloeb og monumenter skilles; favorit-vinder taeller pr. seed", () => {
  const mon = cache("mon", "Monuments", [flat(1)]);
  const od = cache("od", "Class1", [flat(1)]);
  const contexts = new Map([["mon", ctxOf(mon)], ["od", ctxOf(od)]]);
  const results = [
    rr("mon", 1, "Monuments", { [CAND]: [{ seed: 1, gcWinner: "e", rows: [row(1, "e")] }, { seed: 2, gcWinner: "a", rows: [row(1, "a", { breakawayWon: true })] }] }),
    rr("od", 1, "Class1", { [CAND]: [{ seed: 1, gcWinner: "d", rows: [row(1, "d")] }] }),
  ];
  const m = measureCheck(check("monument"), results, CAND, contexts);
  assert.deepEqual({ n: m.n, hits: m.hits, share: m.share, races: m.races, missing: m.missing }, { n: 2, hits: 1, share: 0.5, races: 1, missing: 0 });
  const o = measureCheck(check("one_day"), results, CAND, contexts);
  assert.deepEqual({ n: o.n, hits: o.hits }, { n: 1, hits: 1 });
  const br = measureCheck(check("monument_breakaway"), results, CAND, contexts);
  assert.deepEqual({ n: br.n, hits: br.hits }, { n: 2, hits: 1 });
});

test("measureCheck: klassement og etapesejre i etapeloeb; manglende kontekst = MANGLER", () => {
  const sr = cache("sr", "Class1", [flat(1), mtn(2)]);
  const contexts = new Map([["sr", ctxOf(sr)]]);
  const results = [rr("sr", 2, "Class1", { [CAND]: [{ seed: 1, gcWinner: "a", rows: [row(1, "a"), row(2, "a", { profile_type: "mountain", cls: "mountain" })] }] })];
  const gc = measureCheck(check("stage_race_gc"), results, CAND, contexts);
  assert.deepEqual({ n: gc.n, hits: gc.hits }, { n: 1, hits: 1 });
  const st = measureCheck(check("stage_race_stage"), results, CAND, contexts);
  assert.deepEqual({ n: st.n, hits: st.hits }, { n: 2, hits: 1 }, "flad etape vundet af en klatrer: ingen favorit");
  const noCtx = measureCheck(check("stage_race_gc"), results, CAND, new Map());
  assert.equal(noCtx.missing, 1);
  assert.equal(measureCheck(check("gt_gc"), results, CAND, contexts).n, 0);
});

test("evaluateRaceGroupGates: PASS/FAIL mod baandet, '-' uden baand, N/A uden loeb, MANGLER uden kontekst", () => {
  const mon = cache("mon", "Monuments", [flat(1)]);
  const contexts = new Map([["mon", ctxOf(mon)]]);
  const results = [rr("mon", 1, "Monuments", { [CAND]: [{ seed: 1, gcWinner: "e", rows: [row(1, "e")] }] })];
  const bands = { monumentBreakawayWinShare: { max: 0.5 }, favouriteWinShare: { monument: { min: 0.9 } } };
  const ev = evaluateRaceGroupGates({ raceResults: results, revision: CAND, contexts, bands });
  const by = Object.fromEntries(ev.checks.map((c) => [c.id, c.status]));
  assert.equal(by.monument_breakaway, "PASS");
  assert.equal(by.monument, "PASS");
  assert.equal(by.one_day, "N/A");
  assert.equal(by.gt_gc, "N/A");
  assert.equal(ev.blocked, false);
  const fail = evaluateRaceGroupGates({ raceResults: results, revision: CAND, contexts, bands: { ...bands, favouriteWinShare: { monument: { max: 0.1 } } } });
  assert.equal(fail.checks.find((c) => c.id === "monument").status, "FAIL");
  assert.equal(fail.blocked, true);
  const noBand = evaluateRaceGroupGates({ raceResults: results, revision: CAND, contexts, bands: null });
  assert.equal(noBand.checks.find((c) => c.id === "monument").status, "-");
  assert.equal(noBand.blocked, true, "fail closed: et manglende baand blokerer en kandidat efter v3");
  const missing = evaluateRaceGroupGates({ raceResults: results, revision: CAND, contexts: new Map(), bands });
  assert.equal(missing.checks.find((c) => c.id === "monument").status, "MANGLER");
  assert.equal(bandFor(check("monument_breakaway"), bands), bands.monumentBreakawayWinShare);
});

test("buildRaceGroupCard + sektion: v3 selv blokeres ikke, kandidater efter v3 gør; tal kun i kortet", () => {
  const mon = cache("mon", "Monuments", [flat(1)]);
  const contexts = new Map([["mon", ctxOf(mon)]]);
  const perSeed = [{ seed: 1, gcWinner: "e", rows: [row(1, "e")] }];
  const results = [rr("mon", 1, "Monuments", { [BASE]: perSeed, s5_profiles_v3: perSeed, s5_profiles_v4: perSeed })];
  const v3 = buildRaceGroupCard({ raceResults: results, baseline: BASE, candidate: "s5_profiles_v3", contexts, thresholds: {} });
  assert.equal(v3.applies, false);
  assert.equal(v3.candidate.blocked, true);
  const card = { baseline: BASE, candidate: "s5_profiles_v3", raceGroupGates: v3 };
  assert.match(raceGroupGateLine(card), /til orientering/);
  const v4 = buildRaceGroupCard({ raceResults: results, baseline: BASE, candidate: "s5_profiles_v4", contexts, thresholds: {} });
  assert.match(raceGroupGateLine({ baseline: BASE, candidate: "s5_profiles_v4", raceGroupGates: v4 }), /BLOKERET/);
  const md = raceGroupGateSection({ baseline: BASE, candidate: "s5_profiles_v4", raceGroupGates: v4 }).join("\n");
  assert.match(md, /## Løbsgrupper \(ejer 26\/10\)/);
  assert.match(md, /monumenter/);
  assert.ok(v4.slices.candidate.monument.races === 1 && v4.slices.candidate.one_day === null);
});

test("groupSlices: G17/S0 pr. gruppe; monumenter for sig", () => {
  const mon = cache("mon", "Monuments", [flat(1)]);
  const od = cache("od", "Class1", [flat(1)]);
  const contexts = new Map([["mon", ctxOf(mon)], ["od", ctxOf(od)]]);
  const ab = (out) => ({ starters: 10, out, byRole: {} });
  const results = [
    rr("mon", 1, "Monuments", { [CAND]: [{ seed: 1, gcWinner: "e", abandons: ab(2), rows: [row(1, "e")] }] }),
    rr("od", 1, "Class1", { [CAND]: [{ seed: 1, gcWinner: "d", abandons: ab(0), rows: [row(1, "d")] }] }),
  ];
  const s = groupSlices(results, CAND, contexts);
  assert.equal(s.monument.abandonShare, 0.2);
  assert.equal(s.one_day.abandonShare, 0);
  assert.equal(s.gt, null);
});

test("motorTestportReport: monument er egen udbrudsgruppe; samlet baand fra raceGroupBands; one_day-baandet uaendret", () => {
  const dry = (id, raceClass, rows) => raceResultFromDryRun({ race: { id, name: id, stages: 1, race_class: raceClass }, runs: [{ revision: CAND, seeds: 1, perSeed: [{ seed: 1, rows }], summary: { counts: {}, stages: [], classes: [], race: { verdicts: {} } } }] });
  const results = [dry("mon", "Monuments", [row(1, "a", { breakawayWon: true })]), dry("od", "Class1", [row(1, "d")])];
  assert.equal(results[0].raceClass, "Monuments");
  const g = aggregateRaceGroups(results, CAND, { breakawayGroupTotalBands: { one_day: { max: 0.5 } }, raceGroupBands: { monumentBreakawayWinShare: { max: 0.5 } } });
  assert.equal(g.breakaway.monument.total.n, 1);
  assert.equal(g.breakaway.monument.total.verdict, "FAIL");
  assert.equal(g.breakaway.one_day.total.n, 1);
  assert.equal(g.breakaway.one_day.total.verdict, "PASS");
  const card = buildTestportCard({ raceResults: results, baseline: CAND, candidate: CAND, thresholds: {} });
  assert.ok(card.raceGroupGates?.candidate);
  assert.match(renderTestportMarkdown(card), /## Løbsgrupper \(ejer 26\/10\)/);
});
