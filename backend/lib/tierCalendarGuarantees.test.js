import test from "node:test";
import assert from "node:assert/strict";
import {
  computeTierCoverageStats, detectCoverageViolations, CLASS_STAGE_LENGTH_BAND,
  TIER_TERRAIN_FAMILY_MIN, TIER_ONE_DAY_SHARE_MIN, TIER_MOUNTAIN_FREE_STAGE_RACE_MIN,
} from "./tierCalendarGuarantees.js";

// Byg et minimalt raceRow + profil-par til testene. profileTypes = liste af profile_type
// pr. etape (længden afgør stages for stage_race).
function race(pool_race_id, race_class, race_type, profileTypes) {
  const stages = race_type === "stage_race" ? profileTypes.length : 1;
  return {
    row: { pool_race_id, race_class, race_type, stages },
    profiles: profileTypes.map((profile_type) => ({ profile_type })),
  };
}

function buildFixture(races) {
  const raceRows = races.map((r) => r.row);
  const profilesByPoolRaceId = new Map(races.map((r) => [r.row.pool_race_id, r.profiles]));
  return { raceRows, profilesByPoolRaceId };
}

test("computeTierCoverageStats: tæller oneDayShare, terræn-familier, mountain-free stage races", () => {
  const races = [
    race("s1", "ProSeries", "single", ["cobbles"]),
    race("s2", "ProSeries", "single", ["flat"]),
    race("s3", "ProSeries", "single", ["hilly"]),
    race("r1", "ProSeries", "stage_race", ["flat", "hilly", "hilly"]), // #3327: hilly_tour-lignende, INGEN bjerg
    race("r2", "ProSeries", "stage_race", ["flat", "mountain", "high_mountain"]),
  ];
  const { raceRows, profilesByPoolRaceId } = buildFixture(races);
  const stats = computeTierCoverageStats({ raceRows, profilesByPoolRaceId });

  assert.equal(stats.totalRaces, 5);
  assert.equal(stats.oneDayRaces, 3);
  assert.equal(stats.stageRaces, 2);
  assert.equal(stats.oneDayShare, 0.6);
  assert.equal(stats.familyCounts.cobbles, 1);
  assert.equal(stats.familyCounts.flat_sprint, 3); // 1 single + 2 stage race "flat" guarantees
  assert.equal(stats.familyCounts.hilly, 3); // 1 single + 2 fra r1
  assert.equal(stats.mountainFreeStageRaces, 1, "kun r1 har 0 bjerg-etaper");
});

test("computeTierCoverageStats: 'classic' tælles separat, IKKE med i cobbles-garantien (RNG-afhængig)", () => {
  const races = [race("s1", "ProSeries", "single", ["classic"])];
  const { raceRows, profilesByPoolRaceId } = buildFixture(races);
  const stats = computeTierCoverageStats({ raceRows, profilesByPoolRaceId });
  assert.equal(stats.familyCounts.cobbles, 0, "classic skal IKKE tælle som cobbles");
  assert.equal(stats.classicStages, 1, "men vises separat i rapporten");
});

test("computeTierCoverageStats: flager etapeløb uden for klassens etapeantal-bånd (#3328)", () => {
  const races = [
    race("ps-8", "ProSeries", "stage_race", ["flat", "hilly", "mountain", "flat", "hilly", "mountain", "flat", "hilly"]), // 8 etaper > ProSeries-bånd [3,5]
    race("wtc-4", "OtherWorldTourC", "stage_race", ["flat", "hilly", "mountain", "flat"]), // 4 etaper < WT-C-bånd [6,8]
  ];
  const { raceRows, profilesByPoolRaceId } = buildFixture(races);
  const stats = computeTierCoverageStats({ raceRows, profilesByPoolRaceId, classStageLengthBand: CLASS_STAGE_LENGTH_BAND });
  assert.equal(stats.classBandViolations.length, 2);
  assert.match(stats.classBandViolations[0], /ps-8.*ProSeries.*8 etaper.*\[3-5\]/);
  assert.match(stats.classBandViolations[1], /wtc-4.*OtherWorldTourC.*4 etaper.*\[6-8\]/);
});

test("detectCoverageViolations: fanger en kalender UDEN brosten-dækning (#3327)", () => {
  // Tier 2-lignende kalender uden ÉN eneste cobbles-etape.
  const races = [
    race("s1", "ProSeries", "single", ["flat"]),
    race("s2", "ProSeries", "single", ["hilly"]),
    race("r1", "ProSeries", "stage_race", ["flat", "mountain", "mountain", "hilly"]),
  ];
  const { raceRows, profilesByPoolRaceId } = buildFixture(races);
  const stats = computeTierCoverageStats({ raceRows, profilesByPoolRaceId });
  const violations = detectCoverageViolations({ tier: 2, stats });

  assert.ok(violations.some((v) => v.includes('terræn-familie "cobbles"') && v.includes("#3327")), violations.join(" · "));
  assert.ok(violations.some((v) => v.includes(`under garanteret minimum ${TIER_TERRAIN_FAMILY_MIN[2].cobbles}`)), violations.join(" · "));
});

test("detectCoverageViolations: ren kalender (alle garantier opfyldt) giver INGEN violations", () => {
  // Byg en kalender der rigeligt opfylder tier 2's mins (cobbles 6, flat 15, itt 4, hilly 8,
  // mountain-free 2, oneDayShare ≥ 40%).
  const races = [];
  for (let i = 0; i < 8; i++) races.push(race(`cob-${i}`, "ProSeries", "single", ["cobbles"]));
  for (let i = 0; i < 16; i++) races.push(race(`flat-${i}`, "ProSeries", "single", ["flat"]));
  for (let i = 0; i < 5; i++) races.push(race(`itt-${i}`, "ProSeries", "single", ["itt"]));
  for (let i = 0; i < 9; i++) races.push(race(`hil-${i}`, "ProSeries", "single", ["hilly"]));
  for (let i = 0; i < 3; i++) races.push(race(`mf-${i}`, "ProSeries", "stage_race", ["flat", "hilly", "hilly"]));
  for (let i = 0; i < 40; i++) races.push(race(`sr-${i}`, "ProSeries", "stage_race", ["flat", "mountain", "hilly", "flat"]));

  const { raceRows, profilesByPoolRaceId } = buildFixture(races);
  const stats = computeTierCoverageStats({ raceRows, profilesByPoolRaceId });
  const violations = detectCoverageViolations({ tier: 2, stats });
  assert.deepEqual(violations, [], violations.join(" · "));
});

test("detectCoverageViolations: flager for lav endagsløb-andel (#3327)", () => {
  const races = [race("s1", "ProSeries", "single", ["flat"])];
  for (let i = 0; i < 20; i++) races.push(race(`sr-${i}`, "ProSeries", "stage_race", ["flat", "mountain", "hilly"]));
  const { raceRows, profilesByPoolRaceId } = buildFixture(races);
  const stats = computeTierCoverageStats({ raceRows, profilesByPoolRaceId });
  const violations = detectCoverageViolations({ tier: 2, stats });
  assert.ok(violations.some((v) => v.includes("endagsløb-andel") && v.includes("#3327")), violations.join(" · "));
  assert.ok(stats.oneDayShare < TIER_ONE_DAY_SHARE_MIN[2]);
});

test("detectCoverageViolations: flager for få mountain-free etapeløb (#3327)", () => {
  const races = [];
  for (let i = 0; i < 20; i++) races.push(race(`sr-${i}`, "ProSeries", "stage_race", ["flat", "mountain", "hilly"]));
  for (let i = 0; i < 20; i++) races.push(race(`od-${i}`, "ProSeries", "single", ["flat"]));
  const { raceRows, profilesByPoolRaceId } = buildFixture(races);
  const stats = computeTierCoverageStats({ raceRows, profilesByPoolRaceId });
  assert.equal(stats.mountainFreeStageRaces, 0);
  const violations = detectCoverageViolations({ tier: 2, stats });
  assert.ok(violations.some((v) => v.includes("uden bjerg-etape") && v.includes(`${TIER_MOUNTAIN_FREE_STAGE_RACE_MIN[2]}`)), violations.join(" · "));
});

test("detectCoverageViolations: klasse↔længde-bånd-brud rammer SAMME violation-liste som terræn-garantierne", () => {
  const races = [
    race("ps-8", "ProSeries", "stage_race", ["flat", "hilly", "mountain", "flat", "hilly", "mountain", "flat", "hilly"]),
  ];
  const { raceRows, profilesByPoolRaceId } = buildFixture(races);
  const stats = computeTierCoverageStats({ raceRows, profilesByPoolRaceId, classStageLengthBand: CLASS_STAGE_LENGTH_BAND });
  const violations = detectCoverageViolations({ tier: 2, stats });
  assert.ok(violations.some((v) => v.includes("klasse↔længde-bånd brudt") && v.includes("#3328")), violations.join(" · "));
});

// #3469 (hærdnings-pakken): mountain-familien (mountain+high_mountain) tælles nu som en
// egen terræn-familie, samme håndhævelse (coverage-gate/apply-refusal) som cobbles/flat/
// itt/hilly.
test("computeTierCoverageStats: 'mountain' tæller BÅDE mountain og high_mountain-profiler (#3469)", () => {
  const races = [
    race("r1", "ProSeries", "stage_race", ["flat", "mountain", "high_mountain", "high_mountain"]),
  ];
  const { raceRows, profilesByPoolRaceId } = buildFixture(races);
  const stats = computeTierCoverageStats({ raceRows, profilesByPoolRaceId });
  assert.equal(stats.familyCounts.mountain, 3, "1 mountain + 2 high_mountain = 3 bjerg-familie-etaper");
});

test("detectCoverageViolations: fanger en kalender UDEN bjerg-dækning (#3469)", () => {
  // Tier 3-lignende kalender med kun 2 bjerg-etaper — langt under tier 3's mål (12).
  const races = [
    race("s1", "ProSeries", "single", ["flat"]),
    race("s2", "ProSeries", "single", ["cobbles"]),
    race("r1", "ProSeries", "stage_race", ["flat", "mountain", "hilly"]),
  ];
  const { raceRows, profilesByPoolRaceId } = buildFixture(races);
  const stats = computeTierCoverageStats({ raceRows, profilesByPoolRaceId });
  const violations = detectCoverageViolations({ tier: 3, stats });

  assert.ok(violations.some((v) => v.includes('terræn-familie "mountain"') && v.includes("#3327")), violations.join(" · "));
  assert.ok(violations.some((v) => v.includes(`under garanteret minimum ${TIER_TERRAIN_FAMILY_MIN[3].mountain}`)), violations.join(" · "));
});

test("detectCoverageViolations: tomme override-maps (LEGACY_MIX-mønster) slår ALLE garantier fra", () => {
  const { raceRows, profilesByPoolRaceId } = buildFixture([race("s1", "ProSeries", "single", ["flat"])]);
  const stats = computeTierCoverageStats({ raceRows, profilesByPoolRaceId });
  const violations = detectCoverageViolations({
    tier: 2, stats, oneDayShareMin: {}, terrainFamilyMin: {}, mountainFreeMin: {},
  });
  assert.deepEqual(violations, []);
});
