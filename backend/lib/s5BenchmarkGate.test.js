// backend/lib/s5BenchmarkGate.test.js
// #6367 (S5-etapeprofiler, Spor 3): benchmark-gaten.
//
// Gatens egen test (byg-planen Spor 3): den nuvaerende v5-generator SKAL vaere roed paa
// (1) etape og (2) Grand Tour. Naar generatoren kan S5-modellen (#6359), SKAL samme
// Grand Tours vaere groenne paa (1)-(3); den test aktiverer sig selv.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  S5_PROFILE_MODEL, S5_FIRST_SEASON, profileModelForSeason,
  deriveTerrainTypeBPlus, s5FinishOf, checkStage,
  S5_GT_QUOTAS, S5_GT_ROAD_TERRAINS, S5_GT_QUOTA_TOLERANCE,
  grandTourTypeOf, isGrandTourRace, expectedGrandTourCounts, checkGrandTour,
  loadS5Benchmark, benchmarkFinishShares, benchmarkGapIntervals, SEASON_FINISH_CLASSES,
  checkSeasonFinishShares, evaluateMotorGaps, loadMotorGapFile, MOTOR_GAP_MIN_BENCHMARK_N,
  evaluateS5BenchmarkGate, formatS5BenchmarkReport,
} from "./s5BenchmarkGate.js";
import * as routeGenerator from "./raceRouteGenerator.js";
import { generateRaceStageProfiles, balanceFinaleQuotas } from "./raceStageProfileGenerator.js";
import { makeRng } from "./fictionalRiderGenerator.js";

const BENCHMARK = loadS5Benchmark();
const CATALOG = JSON.parse(readFileSync(new URL("./__fixtures__/racePoolCatalog.prod.json", import.meta.url), "utf8")).catalog;

// ── Syntetiske etaper (én pr. terræn, hver med en lovlig S5-afslutning) ──────────────

const D = 180;
const climb = (category, length_km, crest_km, summit_finish = false) => ({ name: "x", category, length_km, avg_gradient: 6, crest_km, summit_finish });
const finishSprint = (ramp) => [{ kind: "finish", km: D, ...(ramp ?? {}) }];
const STAGE = {
  flat: () => ({ profile_type: "flat", finale_type: "flat_sprint", distance_km: D, climbs: [], sprints: finishSprint() }),
  rolling: () => ({ profile_type: "rolling", finale_type: "flat_sprint", distance_km: D, climbs: [climb("4", 2, 60), climb("4", 2, 120)], sprints: finishSprint() }),
  hilly: () => ({ profile_type: "hilly", finale_type: "flat_sprint", distance_km: D, climbs: [climb("3", 4, 140)], sprints: finishSprint() }),
  medium_mountain: () => ({ profile_type: "medium_mountain", finale_type: "flat_sprint", distance_km: D, climbs: [climb("2", 6, 60), climb("2", 6, 130)], sprints: finishSprint() }),
  mountainSummit: () => ({ profile_type: "mountain", finale_type: "long_climb", distance_km: D, climbs: [climb("2", 6, 80), climb("1", 10, D, true)], sprints: finishSprint() }),
  mountainDescent: () => ({ profile_type: "mountain", finale_type: "descent", distance_km: D, climbs: [climb("2", 6, 80), climb("1", 10, D - 15)], sprints: finishSprint() }),
  highSummit: () => ({ profile_type: "high_mountain", finale_type: "long_climb", distance_km: D, climbs: [climb("1", 10, 90), climb("HC", 12, D, true)], sprints: finishSprint() }),
  highDescent: () => ({ profile_type: "high_mountain", finale_type: "descent", distance_km: D, climbs: [climb("1", 10, 90), climb("HC", 12, D - 12)], sprints: finishSprint() }),
  itt: () => ({ profile_type: "itt", finale_type: "solo_tt", distance_km: 30, climbs: [], sprints: finishSprint() }),
};

/** En Tour-type-GT der rammer kvoten og ugestrukturen præcist (18 etaper). */
function perfectTour() {
  const order = [
    "itt", "flat", "hilly", "rolling", "hilly", "medium_mountain",
    "highDescent", "hilly", "highSummit", "mountainDescent", "hilly", "highSummit",
    "hilly", "itt", "highSummit", "flat", "highSummit", "flat",
  ];
  return {
    pool_race_id: "gt-tour", name: "Tour de Test", race_type: "stage_race", race_class: "TourFrance", terrain_archetype: "grand_tour",
    stages: order.map((k, i) => ({ ...STAGE[k](), stage_number: i + 1 })),
  };
}

// ── 0. Hvem gaten gælder ─────────────────────────────────────────────────────────

test("profileModelForSeason: S5 og frem er S5-modellen; S1-S4 og ugyldige værdier er v5", () => {
  assert.equal(S5_FIRST_SEASON, 5);
  assert.equal(profileModelForSeason(4), "v5");
  assert.equal(profileModelForSeason(5), S5_PROFILE_MODEL);
  assert.equal(profileModelForSeason(6), "s5");
  assert.equal(profileModelForSeason("5"), "s5");
  for (const bad of [null, undefined, "x", 4.5, NaN]) assert.equal(profileModelForSeason(bad), "v5");
});

// ── 1. B+ ─────────────────────────────────────────────────────────────────────────

test("B+ (spec §2): hver regel, oppefra, inkl. kort 5's rettelser", () => {
  const c = (category, length_km, summit_finish = false) => ({ category, length_km, summit_finish });
  assert.equal(deriveTerrainTypeBPlus([c("HC", 12)]), "high_mountain");
  assert.equal(deriveTerrainTypeBPlus([c("1", 10), c("1", 10), c("1", 10)]), "high_mountain");
  assert.equal(deriveTerrainTypeBPlus([c("1", 10), c("1", 10)]), "mountain");
  assert.equal(deriveTerrainTypeBPlus([c("2", 5), c("2", 5)]), "medium_mountain");
  assert.equal(deriveTerrainTypeBPlus([c("2", 8)]), "medium_mountain");
  assert.equal(deriveTerrainTypeBPlus([c("2", 5, true)]), "medium_mountain", "kat. 2 på 5 km som bjergtopmål");
  assert.equal(deriveTerrainTypeBPlus([c("2", 6)]), "hilly", "en enlig kat. 2 under 8 km er kort kat. 2 = kuperet");
  assert.equal(deriveTerrainTypeBPlus([c("2", 4), c("2", 4.9)]), "hilly", "kort kat. 2 tæller som kuperet");
  assert.equal(deriveTerrainTypeBPlus([c("3", 3)]), "hilly");
  assert.equal(deriveTerrainTypeBPlus([c("4", 2), c("4", 2), c("4", 2), c("4", 2)]), "rolling", "kat. 4 tæller ALDRIG mod kuperet (kort 5)");
  assert.equal(deriveTerrainTypeBPlus([c("4", 2), c("4", 2)]), "rolling");
  assert.equal(deriveTerrainTypeBPlus([c("4", 2)]), "flat");
  assert.equal(deriveTerrainTypeBPlus([]), "flat");
  assert.equal(deriveTerrainTypeBPlus(null), "flat");
  assert.equal(deriveTerrainTypeBPlus([c("5", 3), c("?", 9)]), "flat", "ukendte kategorier ignoreres");
});

test("B+ er den samme regel som generatorens deriveTerrainType (aktiveres når #6359 eksporterer den)", (t) => {
  const generatorRule = routeGenerator.deriveTerrainType;
  if (typeof generatorRule !== "function") {
    t.skip("raceRouteGenerator.js eksporterer endnu ikke deriveTerrainType (#6359)");
    return;
  }
  const rng = makeRng(6367);
  const cats = ["HC", "1", "2", "3", "4"];
  for (let i = 0; i < 2000; i++) {
    const n = Math.floor(rng() * 6);
    const climbs = Array.from({ length: n }, () => ({
      category: cats[Math.floor(rng() * cats.length)],
      length_km: Math.round(rng() * 140) / 10 + 1,
      summit_finish: rng() < 0.2,
    }));
    assert.equal(deriveTerrainTypeBPlus(climbs), generatorRule(climbs), JSON.stringify(climbs));
  }
});

// ── 2. Etape-tjekket (del 1) ────────────────────────────────────────────────────

test("checkStage: de syntetiske S5-etaper er lovlige", () => {
  for (const [k, make] of Object.entries(STAGE)) {
    assert.deepEqual(checkStage(make()).violations, [], k);
  }
});

test("checkStage: type ≠ B+ er et brud", () => {
  const s = { ...STAGE.hilly(), profile_type: "mountain", finale_type: "descent" };
  assert.ok(checkStage(s).violations.some((v) => v.startsWith("type mountain ≠ B+ hilly")));
});

test("checkStage: afslutning uden for matrixen (udbrud, bjergtop på kuperet) er et brud", () => {
  const breakaway = { ...STAGE.hilly(), finale_type: "breakaway" };
  assert.ok(checkStage(breakaway).violations.some((v) => v.includes("breakaway er ikke tilladt på hilly")));
  const summitOnHilly = { ...STAGE.hilly(), finale_type: "long_climb" };
  assert.ok(checkStage(summitOnHilly).violations.some((v) => v.includes("long_climb er ikke tilladt på hilly")));
  const sprintOnMountain = { ...STAGE.mountainSummit(), finale_type: "bunch_sprint" };
  assert.ok(checkStage(sprintOnMountain).violations.some((v) => v.includes("flat_sprint er ikke tilladt på mountain")), "bunch_sprint læses som flad spurt");
});

test("checkStage: bjergtop kræver et topmål af terrænets kategori", () => {
  const noSummit = { ...STAGE.mountainSummit(), climbs: [climb("1", 10, D - 40)] };
  assert.ok(checkStage(noSummit).violations.some((v) => v.includes("uden målstigning")));
  // Mellembjerg-bjergtop er kat. 2; et kat. 2-topmål på en bjerg-etape er ikke en bjergtop.
  const wrongCat = { ...STAGE.mountainSummit(), climbs: [climb("1", 10, 60), climb("2", 6, D, true)] };
  assert.ok(checkStage(wrongCat).violations.some((v) => v.includes("kræver kat. 1")));
  const mediumSummit = { profile_type: "medium_mountain", finale_type: "long_climb", distance_km: D, climbs: [climb("2", 6, D, true)], sprints: finishSprint() };
  assert.deepEqual(checkStage(mediumSummit).violations, []);
});

test("checkStage: nedkørsel kræver en kat. 3+-top 5-25 km før mål (kort 5)", () => {
  const tooFar = { ...STAGE.mountainDescent(), climbs: [climb("1", 10, D - 40)] };
  assert.ok(checkStage(tooFar).violations.some((v) => v.includes("5-25 km før mål")));
  const tooClose = { ...STAGE.mountainDescent(), climbs: [climb("1", 10, D - 2)] };
  assert.ok(checkStage(tooClose).violations.some((v) => v.includes("5-25 km før mål")));
  const lastIsCat4 = { profile_type: "hilly", finale_type: "descent", distance_km: D, climbs: [climb("3", 4, 100), climb("4", 2, D - 10)], sprints: finishSprint() };
  assert.ok(checkStage(lastIsCat4).violations.some((v) => v.includes("kat. 3 eller hårdere")));
  const hillyDescent = { profile_type: "hilly", finale_type: "descent", distance_km: D, climbs: [climb("3", 4, D - 20)], sprints: finishSprint() };
  assert.deepEqual(checkStage(hillyDescent).violations, []);
});

test("checkStage: mur, bakke og stigende spurt kræver finale-rampen fra spec §3", () => {
  const ramp = (finale_type, r) => ({ ...STAGE.hilly(), finale_type, sprints: finishSprint(r) });
  assert.deepEqual(checkStage(ramp("wall_finish", { ramp_km: 1.0, ramp_gradient: 14 })).violations, []);
  assert.deepEqual(checkStage(ramp("punch", { ramp_km: 2.0, ramp_gradient: 6.5 })).violations, []);
  assert.deepEqual(checkStage(ramp("uphill_sprint", { ramp_km: 0.7, ramp_gradient: 3.5 })).violations, []);
  assert.ok(checkStage(ramp("wall_finish", null)).violations.some((v) => v.includes("uden finale-rampe")));
  assert.ok(checkStage(ramp("wall_finish", { ramp_km: 1.5, ramp_gradient: 14 })).violations.some((v) => v.includes("under 1.5 km")), "mur er UNDER 1,5 km");
  assert.ok(checkStage(ramp("punch", { ramp_km: 2.0, ramp_gradient: 9 })).violations.length === 1);
  assert.ok(checkStage(ramp("uphill_sprint", { ramp_km: 1.6, ramp_gradient: 3 })).violations.length === 1);
});

test("checkStage: flad spurt på mellembjerg kræver at sidste top ligger langt fra mål", () => {
  const close = { ...STAGE.medium_mountain(), climbs: [climb("2", 6, 60), climb("2", 6, D - 15)] };
  assert.ok(checkStage(close).violations.some((v) => v.includes("mere end 25 km før mål")));
});

test("checkStage: tidskørsler står uden for matrixen; holdtidskørsel er sin egen afslutning", () => {
  assert.equal(s5FinishOf({ profile_type: "ttt", finale_type: "solo_tt" }), "ttt");
  assert.equal(s5FinishOf({ profile_type: "itt_hilly", finale_type: null }), "solo_tt");
  assert.equal(s5FinishOf({ profile_type: "flat", finale_type: "reduced_sprint" }), "flat_sprint");
  assert.equal(s5FinishOf({ profile_type: "flat", finale_type: "breakaway" }), "breakaway");
  const hillyItt = { profile_type: "itt_hilly", finale_type: "solo_tt", distance_km: 30, climbs: [climb("3", 3, 20)], sprints: [] };
  assert.deepEqual(checkStage(hillyItt).violations, []);
});

// ── 3. Grand Tours (del 2) ──────────────────────────────────────────────────────

test("expectedGrandTourCounts: ved kvotens eget etapeantal er forventningen kvoten selv", () => {
  for (const [type, stages] of [["tour", 18], ["giro", 17], ["vuelta", 17]]) {
    const q = S5_GT_QUOTAS[type];
    const e = expectedGrandTourCounts(type, stages);
    for (const t of S5_GT_ROAD_TERRAINS) assert.equal(e.terrains[t], q[t], `${type} ${t}`);
    assert.equal(e.summits, q.summits);
    assert.equal(e.timeTrials, q.itt + q.ttt);
  }
  // Skaleret til 21 etaper: tidskørslerne holdes, landevejen fylder resten.
  const e21 = expectedGrandTourCounts("giro", 21);
  assert.equal(Object.values(e21.terrains).reduce((s, n) => s + n, 0), 21 - e21.timeTrials);
});

test("grandTourTypeOf + isGrandTourRace: Tour-klassen, ellers regionen (som generatoren)", () => {
  assert.equal(grandTourTypeOf({ race_class: "TourFrance", name: "Giro x" }), "tour");
  const gts = CATALOG.filter((c) => c.terrain_archetype === "grand_tour");
  assert.equal(gts.length, 3);
  assert.deepEqual(gts.map((c) => grandTourTypeOf(c)).sort(), ["giro", "tour", "vuelta"]);
  assert.equal(isGrandTourRace({ terrain_archetype: "grand_tour", stages: [] }), true);
  assert.equal(isGrandTourRace({ race_type: "stage_race", stages: new Array(8).fill({}) }), false);
});

test("checkGrandTour: en GT der rammer kvoten og ugestrukturen er grøn", () => {
  const g = checkGrandTour(perfectTour());
  assert.equal(g.gtType, "tour");
  assert.deepEqual(g.violations, []);
});

test("checkGrandTour: kvote-afvigelse ud over tolerancen er rød, og tolerancen er som dokumenteret", () => {
  assert.deepEqual({ ...S5_GT_QUOTA_TOLERANCE }, { perTerrain: 1, roadL1: 2, summits: 1, timeTrials: 0 });
  // Én bakkeetape -> flad: inden for ±1 pr. terræn og præcis 2 i alt = stadig grøn.
  const one = perfectTour();
  one.stages[2] = { ...STAGE.flat(), stage_number: 3 };
  assert.deepEqual(checkGrandTour(one).violations, []);
  // To bakkeetaper -> flad: hilly 3/5 og flat 5/3 = rød.
  const two = perfectTour();
  two.stages[2] = { ...STAGE.flat(), stage_number: 3 };
  two.stages[4] = { ...STAGE.flat(), stage_number: 5 };
  const v = checkGrandTour(two).violations;
  assert.ok(v.some((x) => x.startsWith("hilly 3 mod kvote 5")));
  assert.ok(v.some((x) => x.startsWith("terræn-afvigelse i alt 4")));
  // En tidskørsel for meget/lidt er rød (tolerance 0).
  const tt = perfectTour();
  tt.stages[13] = { ...STAGE.hilly(), stage_number: 14 };
  assert.ok(checkGrandTour(tt).violations.some((x) => x.startsWith("tidskørsler 1 mod kvote 2")));
});

test("checkGrandTour: ugestrukturen (spec §5)", () => {
  const swap = (gt, a, b) => { [gt.stages[a], gt.stages[b]] = [gt.stages[b], gt.stages[a]]; return gt; };
  // Højbjerg i første tredjedel.
  assert.ok(checkGrandTour(swap(perfectTour(), 1, 8)).violations.some((v) => v.includes("højbjerg på etape 2")));
  // Sidste dag bjerg.
  assert.ok(checkGrandTour(swap(perfectTour(), 17, 16)).violations.some((v) => v.includes("sidste etape er high_mountain")));
  // Ingen sen tidskørsel.
  assert.ok(checkGrandTour(swap(perfectTour(), 13, 7)).violations.some((v) => v.includes("ingen tidskørsel i sidste tredjedel")));
  // Kongeetapen (højbjerg) kun i midten: flyt de to sene højbjerge frem, bakker bagud.
  const early = swap(swap(perfectTour(), 14, 7), 16, 10);
  assert.ok(checkGrandTour(early).violations.some((v) => v.includes("kongeetapen (high_mountain)")));
});

// ── 4. Benchmark, sæson (del 3) og motor (del 4) ─────────────────────────────────

test("benchmarken læses af filen: 315 etaper, andele summer til 1, bjergtoppens interval er spec §5's", () => {
  assert.equal(BENCHMARK.length, 315);
  const { n, shares } = benchmarkFinishShares(BENCHMARK);
  assert.equal(n, 315);
  assert.ok(Math.abs(Object.values(shares).reduce((s, p) => s + p, 0) - 1) < 1e-9);
  assert.equal(shares.other, 0, "benchmarken har ingen afslutning uden for S5-klasserne");
  const iv = benchmarkGapIntervals(BENCHMARK);
  // Spec §5: "bjergtop 116 s (80-194)" - medianen og kvartilerne.
  assert.equal(iv.long_climb.median, 116);
  assert.equal(Math.floor(iv.long_climb.p25), 80);
  assert.equal(Math.floor(iv.long_climb.p75), 194);
  assert.ok(iv.ttt.n < MOTOR_GAP_MIN_BENCHMARK_N, "holdtidskørslen har for få etaper til at blive dømt");
});

test("checkSeasonFinishShares: benchmark-fordelingen er grøn, en ren spurt-sæson er rød", () => {
  const { shares } = benchmarkFinishShares(BENCHMARK);
  const n = 200;
  const stages = [];
  for (const c of SEASON_FINISH_CLASSES) {
    for (let i = 0; i < Math.round(shares[c] * n); i++) stages.push({ finish: c === "tt" ? "solo_tt" : c });
  }
  assert.deepEqual(checkSeasonFinishShares({ stages, benchmark: BENCHMARK }).violations, []);
  const sprints = Array.from({ length: 52 }, () => ({ finish: "flat_sprint" }));
  const red = checkSeasonFinishShares({ stages: sprints, benchmark: BENCHMARK });
  assert.ok(red.violations.some((v) => v.startsWith("flat_sprint 100.0 %")));
  assert.ok(red.violations.some((v) => v.startsWith("long_climb 0.0 %")));
  assert.deepEqual(checkSeasonFinishShares({ stages: [], benchmark: BENCHMARK }).violations.length, 1);
});

test("evaluateMotorGaps: stub blokerer ikke; en rigtig måling uden for intervallet gør", () => {
  const stub = loadMotorGapFile();
  assert.equal(stub.stub, true);
  const s = evaluateMotorGaps({ motor: stub, benchmark: BENCHMARK });
  assert.equal(s.status, "stub");
  assert.deepEqual(s.violations, [], "stubbens tal er benchmarkens egne medianer");

  const real = { stub: false, medians: { ...stub.medians, long_climb: 30 } };
  const r = evaluateMotorGaps({ motor: real, benchmark: BENCHMARK });
  assert.equal(r.status, "red");
  assert.ok(r.violations.some((v) => v.startsWith("long_climb: motor 30 s uden for")));

  const missing = { stub: false, medians: { flat_sprint: 0 } };
  assert.ok(evaluateMotorGaps({ motor: missing, benchmark: BENCHMARK }).violations.some((v) => v.includes("ikke målt")));
});

// ── 5. Hele gaten ─────────────────────────────────────────────────────────────────

function gtRacesFromCatalog() {
  return CATALOG.filter((c) => c.terrain_archetype === "grand_tour").map((c) => ({
    id: c.id, pool_race_id: c.id, external_id: c.external_id ?? null, name: c.name, race_type: c.race_type,
    stages: c.stages, terrain_archetype: c.terrain_archetype, race_class: c.race_class, season_id: "s5-test",
  }));
}

test("gaten: syntetisk perfekt sæson er grøn på (1)-(3); stub-motor blokerer ikke", () => {
  const tours = [perfectTour(), { ...perfectTour(), pool_race_id: "gt-2", name: "Tour de Test 2" }, { ...perfectTour(), pool_race_id: "gt-3", name: "Tour de Test 3" }];
  const res = evaluateS5BenchmarkGate({ races: tours, benchmark: BENCHMARK, motor: loadMotorGapFile() });
  assert.equal(res.parts.stages.green, true);
  assert.equal(res.parts.grandTours.green, true);
  assert.equal(res.parts.motor.status, "stub");
  // (3) kan være rød på en kunstig sæson af tre ens Tours; resten afgør om den blokerer.
  assert.equal(res.green, res.parts.season.green);
  // Samme løb i to divisioner tælles én gang.
  const dup = evaluateS5BenchmarkGate({ races: [tours[0], tours[0]], benchmark: BENCHMARK, motor: loadMotorGapFile() });
  assert.equal(dup.parts.grandTours.races.length, 1);
  // Ingen motor-fil = del (4) ikke målt = blokerende.
  const noMotor = evaluateS5BenchmarkGate({ races: tours, benchmark: BENCHMARK, motor: null });
  assert.ok(noMotor.blocking.some((b) => b.includes("motor-bench mangler")));
  assert.ok(formatS5BenchmarkReport(res).some((l) => l.includes("STUB")));
});

test("GATENS EGEN TEST: den nuværende v5-generator er RØD på (1) etape og (2) Grand Tour, på tværs af seeds", () => {
  for (const seed of [1, 2, 3, 6367]) {
    const seeds = gtRacesFromCatalog();
    const generated = balanceFinaleQuotas(seeds.map((r) => generateRaceStageProfiles(r, { seed: seed + r.stages })));
    const races = seeds.map((r, i) => ({ ...r, stages: generated[i] }));
    const res = evaluateS5BenchmarkGate({ races, benchmark: BENCHMARK, motor: loadMotorGapFile() });
    assert.equal(res.parts.stages.green, false, `seed ${seed}: (1) skal være rød på v5`);
    assert.ok(res.parts.stages.mismatchedType > 0, `seed ${seed}: v5 har etaper hvis type ikke er B+`);
    assert.equal(res.parts.grandTours.green, false, `seed ${seed}: (2) skal være rød på v5`);
    assert.equal(res.green, false);
  }
});

test("S5-modellen (aktiveres når generatoren kan profileModel: \"s5\", #6359) er GRØN på (1)-(3)", (t) => {
  const seeds = gtRacesFromCatalog();
  const probe = generateRaceStageProfiles(seeds[0], { profileModel: "s5" });
  if (!probe.every((s) => s.generator_version >= 6)) {
    t.skip("generatoren kender endnu ikke S5-modellen (#6359)");
    return;
  }
  const races = seeds.map((r) => ({ ...r, stages: generateRaceStageProfiles(r, { profileModel: "s5" }) }));
  const res = evaluateS5BenchmarkGate({ races, benchmark: BENCHMARK, motor: loadMotorGapFile() });
  assert.deepEqual(res.parts.stages.violations, []);
  assert.deepEqual(res.parts.grandTours.violations, []);
  assert.deepEqual(res.parts.season.violations, []);
  assert.equal(res.green, true);
});
