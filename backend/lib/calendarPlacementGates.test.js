// backend/lib/calendarPlacementGates.test.js
// #4270 (ejer-beslutninger 3/9): de tre placerings-gates + rolling-baandet.
//
// TESTENE ER SKALA-INVARIANTER, ikke aflaesninger af den kalender vi tilfaeldigvis har.
// En test der laaser "D1 har 36 loebsdage med eet loeb" ville skulle rettes hver gang
// kataloget aendrer sig, og ville derfor holde op med at vaere en vagt. Det der laases er
// REGLEN: hvilken akse den maaler paa, hvornaar den siger fra, og hvornaar den tier.
//
// Ingen vaegur-tid, ingen DB, ingen fs - alle datoer/tal injiceres (hard rule 16).

import test from "node:test";
import assert from "node:assert/strict";
import {
  gameDaySpansByRace, detectMonumentsInsideGrandTours, computeGameDayOverlap,
  detectMinOverlapViolations, detectQuotaViolations,
} from "./calendarPlacementGates.js";
import { TIER_OVERLAP_MIN, TIER_MULTI_RACE_DAY_MIN_SHARE, TIER_DENSITY, TIER_OVERLAP_CAP } from "./calendarTierCaps.js";
import {
  detectTerrainBandViolations, detectCoverageViolations, computeTierCoverageStats,
  TIER_TERRAIN_FAMILY_MIN, TIER_TERRAIN_FAMILY_MAX, TERRAIN_BAND_FAMILIES,
  CLASS_STAGE_LENGTH_BAND, TERRAIN_FAMILY_BY_PROFILE_TYPE,
} from "./tierCalendarGuarantees.js";

const stage = (pool_race_id, game_day, scheduled_at = "2026-09-28") => ({ pool_race_id, game_day, scheduled_at });
const race = (pool_race_id, extra = {}) => ({ pool_race_id, name: pool_race_id, race_type: "stage_race", ...extra });

// ── §4/#4203: monument maa ikke ligge inde i et GT's LOEBSDAGS-spaend ────────────────

// GT'en spaender loebsdag 0-19 (17 etaper + 2 hviledage). Monumentet paa loebsdag 11
// ligger inde i spaendet - praecis den tilstand S3 havde for 4 af 5 monumenter.
function gtOgMonument({ monumentGameDay }) {
  const stageRows = [];
  for (let i = 0; i < 17; i += 1) stageRows.push(stage("gt", i < 9 ? i : i + 1));
  stageRows.push(stage("mon", monumentGameDay));
  return {
    raceRows: [race("gt", { name: "Vuelta Ibérica", stages: 17 }), race("mon", { name: "La Doyenne", race_type: "single", race_class: "Monuments", stages: 1 })],
    stageRows,
  };
}

test("#4203: et monument INDE i et GT's løbsdags-spænd er et brud", () => {
  const v = detectMonumentsInsideGrandTours({ tier: 1, ...gtOgMonument({ monumentGameDay: 11 }) });
  assert.equal(v.length, 1);
  assert.match(v[0], /La Doyenne/);
  assert.match(v[0], /Vuelta Ibérica/);
  assert.match(v[0], /#4203/);
});

test("#4203: et monument UDEN FOR spændet er ikke et brud — hverken før eller efter", () => {
  for (const gd of [-1, 18, 25]) {
    const v = detectMonumentsInsideGrandTours({ tier: 1, ...gtOgMonument({ monumentGameDay: gd }) });
    assert.deepEqual(v, [], `løbsdag ${gd} skal være ren`);
  }
});

test("#4203: GT'ens HVILEDAG tæller med i spændet — rytteren er bundet dér også", () => {
  // Hviledagen er loebsdag 9 (efter etape 9, GT_REST_DAY_PATTERN[2]) og har ingen etape.
  // Ligger monumentet dér, er GT-rytterne stadig bundet, og det skal vaere et brud.
  const v = detectMonumentsInsideGrandTours({ tier: 1, ...gtOgMonument({ monumentGameDay: 9 }) });
  assert.equal(v.length, 1, "et hul midt i spændet er ikke en fri dag");
});

test("#4203: gaten måler på game_day, IKKE på kalenderdatoen (CALENDAR_RULES §0)", () => {
  // Samme kalenderdag, forskellige loebsdage: i D1 baerer een dato 3-5 loebsdage, saa
  // monumentet deler dato med GT'en uden at dele loebsdag. Det er TILLADT.
  const raceRows = [race("gt", { stages: 16 }), race("mon", { race_type: "single", race_class: "Monuments", stages: 1 })];
  const stageRows = [];
  for (let i = 0; i < 16; i += 1) stageRows.push(stage("gt", i < 9 ? i : i + 1, "2026-09-28"));
  stageRows.push(stage("mon", 40, "2026-09-28")); // samme DATO, loebsdag langt uden for spaendet
  assert.deepEqual(detectMonumentsInsideGrandTours({ tier: 1, raceRows, stageRows }), []);
});

test("#4203: et etapeløb under GT-tærsklen udløser ikke gaten", () => {
  const raceRows = [race("kort", { stages: 6 }), race("mon", { race_type: "single", race_class: "Monuments", stages: 1 })];
  const stageRows = [...Array.from({ length: 6 }, (_, i) => stage("kort", i)), stage("mon", 3)];
  assert.deepEqual(detectMonumentsInsideGrandTours({ tier: 1, raceRows, stageRows }), []);
});

test("gameDaySpansByRace: spændet er [min, max] over løbets egne løbsdage", () => {
  const spans = gameDaySpansByRace([stage("a", 4), stage("a", 9), stage("a", 6), stage("b", 2)]);
  assert.deepEqual(spans.get("a"), { first: 4, last: 9, stages: 3 });
  assert.deepEqual(spans.get("b"), { first: 2, last: 2, stages: 1 });
});

// ── §1/#3329: mindste-overlap ────────────────────────────────────────────────────────

test("#3329: overlappet tælles pr. LØB, ikke pr. etape", () => {
  // Tre etaper af SAMME loeb paa samme loebsdag er eet loeb, ikke tre.
  const o = computeGameDayOverlap({ stageRows: [stage("a", 0), stage("a", 0), stage("a", 0), stage("b", 0)] });
  assert.equal(o.maxOverlap, 2);
  assert.equal(o.minOverlap, 2);
  assert.equal(o.gameDays, 1);
});

test("#3329: andelen af løbsdage med mindst 2 løb er dét gaten dømmer på", () => {
  const stageRows = [
    stage("a", 0), stage("b", 0),   // 2 loeb
    stage("a", 1),                  // 1 loeb
    stage("b", 2), stage("c", 2),   // 2 loeb
    stage("c", 3),                  // 1 loeb
  ];
  const o = computeGameDayOverlap({ stageRows, overlapMin: 1 });
  assert.equal(o.gameDays, 4);
  assert.equal(o.multiRaceDays, 2);
  assert.equal(o.multiRaceShare, 0.5);
  assert.deepEqual(o.histogram, { 1: 2, 2: 2 });

  // 50 % er over D3/D4's gulv (40 %) og under D2's (55 %) — samme tal, to domme.
  assert.deepEqual(detectMinOverlapViolations({ tier: 3, overlap: o }), []);
  const d2 = detectMinOverlapViolations({ tier: 2, overlap: o });
  assert.equal(d2.length, 1);
  assert.match(d2[0], /50\.0 % af løbsdagene/);
  assert.match(d2[0], /#3329/);
});

test("#3329: gulvene er sat under det målte, ikke over — de er regressionsvagter", () => {
  // Maalt paa S4's plan 3/9: D1 54,4 % · D2 69,0 % · D3 50,0 % · D4 50,0 %.
  // Et gulv OVER det maalte ville blokere saesonen i stedet for at vogte den
  // (samme fejlklasse som .claude/learnings/2026-08-06-garanti-uden-forsyning...).
  const maalt = { 1: 0.544, 2: 0.690, 3: 0.500, 4: 0.500 };
  for (const tier of [1, 2, 3, 4]) {
    assert.ok(TIER_MULTI_RACE_DAY_MIN_SHARE[tier] < maalt[tier],
      `tier ${tier}: gulv ${TIER_MULTI_RACE_DAY_MIN_SHARE[tier]} skal ligge under det målte ${maalt[tier]}`);
  }
});

test("#3329: en løbsdag under det absolutte gulv navngives, så den kan findes", () => {
  const o = computeGameDayOverlap({ stageRows: [stage("a", 7)], overlapMin: 2 });
  const v = detectMinOverlapViolations({ tier: 1, overlap: o, overlapMin: { 1: 2 }, multiRaceShareMin: {} });
  assert.equal(v.length, 1);
  assert.match(v[0], /løbsdag 7/);
});

// ── §1b/#4270: eksakt kvote ──────────────────────────────────────────────────────────

test("§1b: kvoten skal rammes EKSAKT — hverken 99 eller 101", () => {
  assert.deepEqual(detectQuotaViolations({ tier: 3, quota: 84, totalGameDays: 84 }), []);
  const under = detectQuotaViolations({ tier: 3, quota: 84, totalGameDays: 83 });
  assert.equal(under.length, 1);
  assert.match(under[0], /-1/);
  const over = detectQuotaViolations({ tier: 3, quota: 84, totalGameDays: 85 });
  assert.equal(over.length, 1);
  assert.match(over[0], /\+1/);
});

test("§1b: en manglende kvote er ikke et brud — det er fravær af evidens", () => {
  assert.deepEqual(detectQuotaViolations({ tier: 3, quota: null, totalGameDays: 84 }), []);
  assert.deepEqual(detectQuotaViolations({ tier: 3, quota: 84, totalGameDays: null }), []);
});

// ── §5: rolling-baandet + classic/gravel i familierne ────────────────────────────────

const profiler = (typer) => new Map([["r1", typer.map((t) => ({ profile_type: t }))]]);
const statsFor = (typer) => computeTierCoverageStats({
  raceRows: [{ pool_race_id: "r1", race_type: "stage_race", race_class: "ProSeries", stages: typer.length }],
  profilesByPoolRaceId: profiler(typer),
});

test("§5: rolling har BÅDE gulv og loft i alle fire divisioner (ejer 3/9)", () => {
  for (const tier of [1, 2, 3, 4]) {
    assert.ok(Number.isInteger(TIER_TERRAIN_FAMILY_MIN[tier].rolling), `tier ${tier} mangler rolling-gulv`);
    assert.ok(Number.isInteger(TIER_TERRAIN_FAMILY_MAX[tier].rolling), `tier ${tier} mangler rolling-loft`);
    assert.ok(TIER_TERRAIN_FAMILY_MIN[tier].rolling < TIER_TERRAIN_FAMILY_MAX[tier].rolling,
      `tier ${tier}: gulvet skal ligge under loftet`);
  }
});

test("§5: rolling-båndet siger fra i begge retninger", () => {
  const under = detectTerrainBandViolations({ tier: 1, stats: statsFor(["flat"]) });
  assert.equal(under.length, 1);
  assert.match(under[0], /under gulvet/);

  const over = detectTerrainBandViolations({
    tier: 4, stats: statsFor(Array.from({ length: TIER_TERRAIN_FAMILY_MAX[4].rolling + 1 }, () => "rolling")),
  });
  assert.equal(over.length, 1);
  assert.match(over[0], /over loftet/);

  const iBand = detectTerrainBandViolations({
    tier: 4, stats: statsFor(Array.from({ length: TIER_TERRAIN_FAMILY_MAX[4].rolling }, () => "rolling")),
  });
  assert.deepEqual(iBand, []);
});

test("§5: rolling-båndet ligger UDEN FOR detectCoverageViolations' dom (#4215's CI-gate)", () => {
  // Ellers ville en ejer-beslutning om S4's kalender vaelte en groen CI-gate for alt
  // andet arbejde i repoet. Baandet stopper --apply via scorecardets applyBlocking.
  assert.deepEqual([...TERRAIN_BAND_FAMILIES], ["rolling"]);
  const uden = detectCoverageViolations({ tier: 1, stats: statsFor(["flat"]) });
  assert.ok(!uden.some((v) => v.includes("rolling")), uden.join(" · "));
});

test("§5: `classic` tælles nu i hilly, og `gravel` er forberedt som brosten (#4105)", () => {
  assert.equal(TERRAIN_FAMILY_BY_PROFILE_TYPE.classic, "hilly");
  assert.equal(TERRAIN_FAMILY_BY_PROFILE_TYPE.gravel, "cobbles");
  const s = statsFor(["classic", "classic", "hilly", "gravel", "cobbles"]);
  assert.equal(s.familyCounts.hilly, 3, "2 classic + 1 hilly");
  assert.equal(s.familyCounts.cobbles, 2, "1 gravel + 1 cobbles");
  assert.equal(s.classicStages, 2, "classic rapporteres stadig separat");
});

// ── §1: D4's densitet og dens foelgevirkning ─────────────────────────────────────────

test("§1: D4 kører 3 etaper om dagen fra S4, og slots følger tætheden", () => {
  assert.equal(TIER_DENSITY[4], 3);
  assert.equal(TIER_OVERLAP_CAP[4], 2, "cap'en er UÆNDRET — den er binding-tryk, ikke pacing");
  assert.equal(TIER_OVERLAP_MIN[4], 1);
});

// ── §4/#3328: Class1/Class2's etapebaand ────────────────────────────────────────────

test("#3328/§4: Class1 og Class2 har båndet 3-6 (ejer 3/9), under WorldTours 6-8", () => {
  assert.deepEqual([...CLASS_STAGE_LENGTH_BAND.Class1], [3, 6]);
  assert.deepEqual([...CLASS_STAGE_LENGTH_BAND.Class2], [3, 6]);
  const to = computeTierCoverageStats({
    raceRows: [{ pool_race_id: "x", race_type: "stage_race", race_class: "Class2", stages: 2 }],
    profilesByPoolRaceId: new Map([["x", [{ profile_type: "hilly" }, { profile_type: "flat" }]]]),
  });
  assert.equal(to.classBandViolations.length, 1, "et 2-etapers Class2-etapeløb falder ud af båndet");
  assert.match(to.classBandViolations[0], /\[3-6\]/);
});
