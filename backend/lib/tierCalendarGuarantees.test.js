import test from "node:test";
import assert from "node:assert/strict";
import {
  computeTierCoverageStats, detectCoverageViolations, CLASS_STAGE_LENGTH_BAND,
  TIER_TERRAIN_FAMILY_MIN, TIER_ONE_DAY_SHARE_MIN, TIER_MOUNTAIN_FREE_STAGE_RACE_MIN,
  TIER_ARCHETYPE_RESERVATIONS, MOUNTAIN_FREE_IDENTITY_TYPES, TIER_IDENTITY_MOUNTAIN_FREE_STAGE_RACES,
} from "./tierCalendarGuarantees.js";
import { ARCHETYPE_PROFILES, IDENTITY_PROFILES } from "./raceStageProfileGenerator.js";
import { TIER_IDENTITY_DISTRIBUTION } from "./raceIdentityTypes.js";

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

// ── #5405: arketype-reservations-tabellen er låst ──────────────────────────────────────
//
// Tabellen er ikke en konstant nogen må justere i forbifarten. Tallene er MÅLT (tørkørsel
// 19-20/9 uden --uniform-tilt, ejer-go 20/9), og de hænger sammen med en katalog-udvidelse
// i samme PR: uden de tre nye ProSeries-summit_tour-løb kan de hævede summit_tour-tal for
// D2 og D3 ikke mættes, og uden D3's balanced_week betaler D3 hver ny bjergdag med sin
// enkeltstart. Testene her fælder sig selv, hvis nogen flytter et tal uden en ny måling.
// Måle-tallene ligger i balance-internals/ (gitignoreret) — repoet er offentligt.

test("#5405 reservations-tabellen: tallene er låst og må kun flyttes med en ny måling", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(TIER_ARCHETYPE_RESERVATIONS)),
    {
      1: { itt_classic: 1, cobbled_classic: 6, cobbled_tour: 1 },
      2: { summit_tour: 5, cobbled_tour: 1, itt_classic: 1, hilly_tour: 2, cobbled_classic: 5 },
      3: { summit_tour: 5, cobbled_tour: 1, itt_classic: 1, hilly_tour: 1, cobbled_classic: 4, balanced_week: 1 },
      4: { summit_tour: 2, cobbled_tour: 1, itt_classic: 2, hilly_tour: 2, balanced_week: 2 },
    },
    "Reservations-tabellen er ændret. Den er ikke en tuning-knap: hvert tal er målt i en "
    + "tørkørsel og hænger sammen med katalogets forsyning. Ændr den kun sammen med en ny "
    + "måling og et ejer-go — og opdatér tabellen i docs/CALENDAR_RULES.md §5 i samme PR.",
  );
});

test("#5405 D3 beholder den ENE arketype i sit vindue der garanterer en enkeltstart", () => {
  // Mekanikken bag hele #5405: D3's bjerg-arketyper garanterer ingen ITT, så hver ekstra
  // bjergdag kostede D3 en enkeltstart. balanced_week er den eneste arketype i D3's
  // klasse-vindue med `itt` blandt sine GARANTIER (ikke bare som filler-vægt).
  assert.equal(TIER_ARCHETYPE_RESERVATIONS[3].balanced_week, 1);
  assert.ok(
    ARCHETYPE_PROFILES.balanced_week.guarantees.includes("itt"),
    "balanced_week har mistet sin itt-garanti — så holder D3's enkeltstart ikke længere, "
    + "og reservationen her er blevet virkningsløs.",
  );
  for (const archetype of ["summit_tour", "hilly_tour", "cobbled_tour"]) {
    assert.ok(
      !(ARCHETYPE_PROFILES[archetype].guarantees ?? []).includes("itt"),
      `${archetype} garanterer nu en itt. Får en bjerg-arketype sin egen enkeltstart, er `
      + "D3's balanced_week-reservation måske ikke længere nødvendig — mål efter, fjern den ikke blindt.",
    );
  }
});

// ── #6857 (L2 #6928): løbsidentitet og bjergfri etapeløb ─────────────────────────────

test("#6857 TIER_MOUNTAIN_FREE_STAGE_RACE_MIN er gulvet uden typer; uændret og låst", () => {
  assert.deepEqual({ ...TIER_MOUNTAIN_FREE_STAGE_RACE_MIN }, { 1: 0, 2: 2, 3: 1, 4: 2 });
});

test("#6857 de bjergfri typer følger generatoren, og tabel A giver flere bjergfri etapeløb end gulvet", () => {
  assert.deepEqual([...MOUNTAIN_FREE_IDENTITY_TYPES].sort(), Object.entries(IDENTITY_PROFILES).filter(([, p]) => p.mountainFree).map(([t]) => t).sort());
  // Ejerens tabel A (18/10): sprinter + kuperet + brosten + enkeltstart + grus pr. division.
  assert.deepEqual({ ...TIER_IDENTITY_MOUNTAIN_FREE_STAGE_RACES }, { 1: 7, 2: 11, 3: 10, 4: 11 });
  for (const tier of [1, 2, 3, 4]) {
    assert.ok(TIER_IDENTITY_MOUNTAIN_FREE_STAGE_RACES[tier] >= TIER_MOUNTAIN_FREE_STAGE_RACE_MIN[tier], `D${tier}: typerne må aldrig sænke gulvet`);
    const total = Object.values(TIER_IDENTITY_DISTRIBUTION[tier]).reduce((s, n) => s + n, 0);
    assert.ok(TIER_IDENTITY_MOUNTAIN_FREE_STAGE_RACES[tier] < total, `D${tier}: ikke alle etapeløb er bjergfri`);
  }
});

function typedFixture(entries) {
  const races = entries.map(([id, type, profileTypes]) => ({ ...race(id, "ProSeries", "stage_race", profileTypes), type }));
  const { raceRows, profilesByPoolRaceId } = buildFixture(races);
  const identityTypeByPoolRaceId = new Map(races.map((r) => [r.row.pool_race_id, r.type]));
  return computeTierCoverageStats({ raceRows, profilesByPoolRaceId, identityTypeByPoolRaceId });
}

test("#6857 computeTierCoverageStats: tæller typede etapeløb og bjergfri typer der har fået bjerg", () => {
  const stats = typedFixture([
    ["sp", "sprinters", ["flat", "flat", "hilly"]],
    ["hi", "hilly", ["hilly", "medium_mountain", "rolling"]], // mellembjerg er tilladt i en bjergfri type
    ["co", "cobbles_benelux", ["cobbles", "mountain", "flat"]], // brudt løfte
    ["cl", "climbers_gt_prelude", ["mountain", "high_mountain", "flat"]],
    ["un", null, ["flat", "hilly", "hilly"]],
  ]);
  assert.equal(stats.identityTypedStageRaces, 4);
  assert.equal(stats.identityMountainFreeExpected, 3);
  assert.deepEqual(stats.identityMountainFreeBroken, ["co (cobbles_benelux)"]);
  assert.equal(stats.mountainFreeStageRaces, 3, "sp + hi + det utypede");
});

test("#6857 detectCoverageViolations: gulvet hæves til antallet af typede bjergfri løb, og et brudt løfte nævnes", () => {
  const ok = typedFixture([
    ["a", "sprinters", ["flat", "flat", "hilly"]],
    ["b", "hilly", ["hilly", "hilly", "rolling"]],
    ["c", "gravel", ["gravel", "flat", "hilly"]],
  ]);
  assert.deepEqual(detectCoverageViolations({ tier: 2, stats: ok, oneDayShareMin: {}, terrainFamilyMin: {} }), []);
  const broken = typedFixture([
    ["a", "sprinters", ["flat", "flat", "hilly"]],
    ["b", "hilly", ["hilly", "mountain", "rolling"]],
    ["c", "gravel", ["gravel", "high_mountain", "hilly"]],
  ]);
  const v = detectCoverageViolations({ tier: 2, stats: broken, oneDayShareMin: {}, terrainFamilyMin: {} });
  assert.ok(v.some((x) => x.includes("kun 1 etapeløb uden bjerg-etape, under garanteret minimum 3")), v.join(" · "));
  assert.ok(v.some((x) => x.includes("bjergfri type med bjerg-etape — b (hilly)")), v.join(" · "));
  assert.ok(v.some((x) => x.includes("c (gravel)")), v.join(" · "));
  // Tomt override-map (LEGACY_MIX) slår stadig hele garantien fra, også med typer.
  assert.deepEqual(detectCoverageViolations({ tier: 2, stats: broken, oneDayShareMin: {}, terrainFamilyMin: {}, mountainFreeMin: {} }), []);
});

test("#6857 kalender-stien: typerne fra race_pool når generatoren, stemples v7, og hvert bjergfrit løb er bjergfrit", async () => {
  const { readFileSync } = await import("node:fs");
  const { runOfflineSeasonGates } = await import("../scripts/dev/seasonCalendarGatesOffline.mjs");
  const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/racePoolCatalog.prod.json", import.meta.url), "utf8"));
  const args = { seasonNumber: 5, firstDay: "2026-10-28", lastDay: "2026-11-28" };
  const base = await runOfflineSeasonGates({ ...args, fixture });
  const archetype = new Map(fixture.catalog.map((c) => [c.id, c.terrain_archetype]));
  // Syntetisk tildeling efter tabel A (L4 forfatter den rigtige): typerne i fast rækkefølge
  // på divisionens korte etapeløb, længste først.
  const order = ["climbers_gt_prelude", "allround", "mountains_first", "hilly", "time_trial", "sprinters", "cobbles_benelux", "gravel"];
  const typeById = new Map();
  for (const t of base.plan.planTiers) {
    const rows = t.pools[0].raceRows.filter((r) => r.race_type === "stage_race" && archetype.get(r.pool_race_id) !== "grand_tour")
      .sort((a, b) => b.stages - a.stages || String(a.pool_race_id).localeCompare(String(b.pool_race_id)));
    const types = order.flatMap((type) => Array(TIER_IDENTITY_DISTRIBUTION[t.tier][type]).fill(type));
    assert.equal(rows.length, types.length, `D${t.tier}: tabel A dækker præcis divisionens korte etapeløb`);
    rows.forEach((r, i) => typeById.set(r.pool_race_id, types[i]));
  }
  const typed = { ...fixture, catalog: fixture.catalog.map((c) => (typeById.has(c.id) ? { ...c, race_identity_type: typeById.get(c.id) } : c)) };
  const r = await runOfflineSeasonGates({ ...args, fixture: typed });
  for (const t of r.plan.planTiers) {
    const cs = t.coverageStats;
    assert.equal(cs.identityTypedStageRaces, Object.values(TIER_IDENTITY_DISTRIBUTION[t.tier]).reduce((s, n) => s + n, 0), `D${t.tier}`);
    assert.equal(cs.identityMountainFreeExpected, TIER_IDENTITY_MOUNTAIN_FREE_STAGE_RACES[t.tier], `D${t.tier}`);
    assert.deepEqual(cs.identityMountainFreeBroken, [], `D${t.tier}`);
    for (const row of t.pools[0].raceRows) {
      const versions = new Set((t.profilesByPoolRaceId.get(row.pool_race_id) ?? []).map((p) => p.generator_version));
      assert.deepEqual([...versions], [typeById.has(row.pool_race_id) ? 7 : 6], `D${t.tier} ${row.pool_race_id}`);
    }
  }
  assert.ok(!r.hard.some((v) => v.includes("#6857")), r.hard.join(" · "));

  // v5 (S1-S4) læser aldrig typerne: samme typede katalog giver hverken identitets-tælling
  // eller andre brud end det utypede.
  const s4 = { seasonNumber: 4, firstDay: "2026-09-28" };
  const v5Typed = await runOfflineSeasonGates({ ...s4, fixture: typed });
  const v5Plain = await runOfflineSeasonGates({ ...s4, fixture });
  assert.equal(v5Typed.plan.profileModel, "v5");
  for (const t of v5Typed.plan.planTiers) assert.equal(t.coverageStats.identityTypedStageRaces, 0, `S4 D${t.tier}`);
  assert.deepEqual(v5Typed.plan.planTiers.map((t) => t.calendarViolations), v5Plain.plan.planTiers.map((t) => t.calendarViolations));
});

test("#6857 uden typer er dækningen uændret (ingen identitets-felter tæller)", () => {
  const { raceRows, profilesByPoolRaceId } = buildFixture([race("r1", "ProSeries", "stage_race", ["flat", "hilly", "hilly"])]);
  const stats = computeTierCoverageStats({ raceRows, profilesByPoolRaceId });
  assert.equal(stats.identityTypedStageRaces, 0);
  assert.equal(stats.identityMountainFreeExpected, 0);
  assert.deepEqual(stats.identityMountainFreeBroken, []);
});

test("#5405 D2 og D3 reserverer mere summit_tour end D1 og D4 tilsammen", () => {
  // Retningen er hele pointen med ændringen: afgørende bjergdage skulle op i netop D2 og
  // D3. Vendes det om igen uden en måling, er #5405 rullet tilbage ved et uheld.
  const summit = (tier) => TIER_ARCHETYPE_RESERVATIONS[tier].summit_tour ?? 0;
  assert.ok(summit(2) + summit(3) > summit(1) + summit(4), "D2+D3 skal bære bjerg-reservationen");
  assert.ok(summit(2) > summit(4) && summit(3) > summit(4), "D4 må ikke reservere mest bjerg");
});
