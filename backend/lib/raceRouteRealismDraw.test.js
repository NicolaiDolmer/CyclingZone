// backend/lib/raceRouteRealismDraw.test.js — #3347 deterministisk re-draw af parcours-trækket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveTierDraw, resolveSeasonDraw, resolveSeasonDrawVariants, resolveVariantByRaceId, drawTierAttempt, MAX_REALISM_DRAW_ATTEMPTS } from "./raceRouteRealismDraw.js";
import { generateRaceStageProfiles } from "./raceStageProfileGenerator.js";
import { scoreSeason } from "./raceRouteRealismMetrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Ægte kalender-snapshot (sæson 2, én repræsentativ pulje pr. tier) — samme fil
// scripts/raceRouteRealismDrawHarness.js måler fail-raten på.
const SNAPSHOT = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "seasonTierCalendarSnapshot.json"), "utf8"));
const tierSeedRacesFor = (seasonId) => SNAPSHOT.tiers.map((t) => ({
  tier: t.tier,
  seedRaces: t.races.map((r) => ({ ...r, id: r.external_id, season_id: seasonId })),
}));

// Sæson 2's ÆGTE id. Frem til #3295-kalibreringen (2026-08-06) brød dens kanoniske
// tier-3-træk M-Down-båndet (57 % > 55 %) — præcis det tilfælde #3347 blev åbnet på — og
// den var derfor fixturen for "retry-stien fyrer". Efter kalibreringen (bjerg-vægte ned,
// kuperet op) består sæson 2's kanoniske træk i FØRSTE forsøg. Det er en gevinst, ikke en
// regression, og den fastholdes af sin egen test nedenfor.
const SEASON_2_ID = SNAPSHOT.seasonId;

// Ny "retry-stien fyrer"-fixture: sæson 6's kanoniske træk bryder tier 3's summit-bånd
// (7 < 8) og rettes af gen-træk 1. Samme egenskaber som sæson 2 havde før — ét brydende
// tier, re-draw lykkes — så determinisme- og variant-testene måler stadig det de påstår.
// Fundet ved at scanne sæson-id 1-40 mod den ægte generator, ikke valgt for at få
// testene grønne: den SKAL bryde et bånd, ellers tester de intet.
const RETRY_SEASON_ID = "00000000-0000-0000-0000-000000000006";

// ── Syntetiske generatorer (fuld kontrol over hvornår et træk består) ────────
const passingStage = () => ({ profile_type: "high_mountain", finale_type: "long_climb", distance_km: 170, sectors: [] });
const failingStage = () => ({ profile_type: "mountain", finale_type: "descent", distance_km: 170, sectors: [] });
// Tier 3's bånd: summit ≥ 8, M-Down ≤ 55 %, 1 fritstående ITT, 1 brosten-i-etapeløb.
const tier3SeedRaces = () => [
  { id: "a", name: "Bjergløb", race_type: "stage_race", stages: 8 },
  { id: "b", name: "Enkeltstart", race_type: "single", stages: 1 },
  { id: "c", name: "Brostensløb", race_type: "stage_race", stages: 2 },
];
function fakeGenerator(passFrom) {
  return (race) => {
    const variant = race.season_variant ?? 0;
    if (race.id === "b") return [{ profile_type: "itt", finale_type: "solo_tt", distance_km: 30, sectors: [] }];
    if (race.id === "c") {
      return [{ profile_type: "flat", finale_type: "bunch_sprint", distance_km: 170, sectors: [] },
        { profile_type: "cobbles", finale_type: "reduced_sprint", distance_km: 160, sectors: [{ kind: "cobbles" }] }];
    }
    const stage = variant >= passFrom ? passingStage : failingStage;
    return Array.from({ length: 8 }, stage);
  };
}

test("træk der består i første forsøg → attempt 0 (bit-identisk med før #3347)", () => {
  const draw = resolveTierDraw({ tier: 3, seedRaces: tier3SeedRaces(), generateProfiles: fakeGenerator(0) });
  assert.equal(draw.attempt, 0);
  assert.equal(draw.exhausted, false);
  assert.equal(draw.attemptsTried, 1);
  assert.deepEqual(draw.failures, []);
  assert.deepEqual(draw.firstDrawFailures, []);
});

test("træk der bryder båndene trækkes om, indtil det består — mindste attempt vinder", () => {
  const draw = resolveTierDraw({ tier: 3, seedRaces: tier3SeedRaces(), generateProfiles: fakeGenerator(3) });
  assert.equal(draw.attempt, 3);
  assert.equal(draw.exhausted, false);
  assert.deepEqual(draw.failures, []);
  // Re-draw sker ALDRIG i tavshed: det kanoniske træks brud rapporteres videre.
  assert.ok(draw.firstDrawFailures.some((f) => f.includes("summit")), draw.firstDrawFailures.join(" · "));
});

test("gaten forbliver HÅRD: alle forsøg brugt → attempt 0 + exhausted + attempt 0's brud", () => {
  const draw = resolveTierDraw({ tier: 3, seedRaces: tier3SeedRaces(), generateProfiles: fakeGenerator(Infinity) });
  assert.equal(draw.exhausted, true);
  assert.equal(draw.attempt, 0, "udtømt → det KANONISKE træk, ikke 'bedste af N'");
  assert.equal(draw.attemptsTried, MAX_REALISM_DRAW_ATTEMPTS);
  assert.ok(draw.failures.length > 0, "brud må ikke forsvinde fordi vi prøvede igen");
  assert.deepEqual(draw.failures, draw.firstDrawFailures);
});

test("u-gatede tiers (1/2) trækkes aldrig om for tier-bånd — de har ingen", () => {
  // Ingen mål i TIER_TARGETS for tier 1/2 → ingen failures → attempt 0.
  const draw = resolveTierDraw({ tier: 2, seedRaces: tier3SeedRaces(), generateProfiles: fakeGenerator(Infinity) });
  assert.equal(draw.attempt, 0);
  assert.equal(draw.exhausted, false);
});

test("en løbs-generering der kaster bogføres som 'kunne ikke vurderes', ikke som båndbrud", () => {
  const boom = (race) => { if (race.id === "b") throw new Error("kaboom"); return fakeGenerator(0)(race); };
  const { entry, failures } = drawTierAttempt({ tier: 3, seedRaces: tier3SeedRaces(), generateProfiles: boom });
  assert.ok(entry.errors.some((e) => e.includes("kaboom")), entry.errors.join(" · "));
  // Manglende ITT er nu et ægte båndbrud (løbet forsvandt), men fejlen er BEVARET —
  // #2854-kontrakten: aldrig tavst væk.
  assert.ok(failures.some((f) => f.includes("ITT")), failures.join(" · "));
});

// ── Determinisme mod den ÆGTE generator ─────────────────────────────────────
test("determinisme: samme season_id → bit-identisk kalender (også når re-draw fyrer)", () => {
  const a = resolveSeasonDraw({ tierSeedRaces: tierSeedRacesFor(RETRY_SEASON_ID) });
  const b = resolveSeasonDraw({ tierSeedRaces: tierSeedRacesFor(RETRY_SEASON_ID) });
  assert.deepEqual(a.map((d) => d.attempt), b.map((d) => d.attempt));
  assert.equal(JSON.stringify(a.map((d) => d.entry)), JSON.stringify(b.map((d) => d.entry)),
    "hele kalenderen (profiler + ruter) skal være bit-identisk mellem to kørsler");
  // Fixturen SKAL ramme retry-stien, ellers tester ovenstående ikke det den påstår.
  assert.ok(a.some((d) => d.attempt > 0), `fixturen forventes at ramme re-draw-stien; attempts=${a.map((d) => d.attempt)}`);
});

test("et kanonisk træk der bryder tier 3's bånd rettes af re-drawet — og KUN den tier trækkes om", () => {
  const tierSeedRaces = tierSeedRacesFor(RETRY_SEASON_ID);
  const first = scoreSeason(tierSeedRaces.map(({ tier, seedRaces }) => ({
    tier, races: seedRaces.map((r) => ({ name: r.name, race_type: r.race_type, terrain_archetype: r.terrain_archetype, stages: generateRaceStageProfiles(r) })),
  })));
  assert.ok(first.failures.some((f) => f.startsWith("tier 3:")), first.failures.join(" · "));

  const draws = resolveSeasonDraw({ tierSeedRaces });
  assert.deepEqual(scoreSeason(draws.map((d) => d.entry)).failures, []);
  // Kun den brydende tier trækkes om — de øvrige tiers' parcours røres ikke.
  assert.deepEqual(draws.filter((d) => d.attempt > 0).map((d) => d.tier), [3]);
});

test("#3295: sæson 2's kanoniske træk består nu ALLE realisme-bånd uden re-draw", () => {
  // Før kompositions-kalibreringen brød sæson 2's tier 3 M-Down-båndet (57 % > 55 %) og
  // krævede et gen-træk. De nye filler-vægte (bjerg ned, kuperet op) fjernede bruddet.
  // Fastholdes som regression-vagt: går denne test i rødt, er kalibreringen drevet
  // tilbage mod den gamle bjerg-tunge fordeling.
  const draws = resolveSeasonDraw({ tierSeedRaces: tierSeedRacesFor(SEASON_2_ID) });
  assert.deepEqual(draws.map((d) => d.attempt), [0, 0, 0, 0], "ingen tier skal behøve et gen-træk");
  assert.deepEqual(scoreSeason(draws.map((d) => d.entry)).failures, []);
});

test("re-draw ændrer BÅDE etape-profiler (pass 1) og ruter (pass 2)", () => {
  // GT-båndet måler total-km/stigninger/HC, som er pass 2-data. Ligger rute-seed'en
  // ikke på samme sæson-akse som profil-seed'en, kan et re-draw aldrig rette et GT-brud.
  const race = { id: "gt", external_id: "gt", race_type: "stage_race", stages: 21, terrain_archetype: "grand_tour", season_id: "s-test" };
  const base = generateRaceStageProfiles(race);
  const retry = generateRaceStageProfiles({ ...race, season_variant: 1 });
  assert.notDeepEqual(base.map((s) => s.profile_type), retry.map((s) => s.profile_type));
  assert.notEqual(base.reduce((s, x) => s + x.distance_km, 0), retry.reduce((s, x) => s + x.distance_km, 0));
});

test("season_variant 0 giver PRÆCIS samme output som et kald helt uden feltet", () => {
  const race = { id: "r", external_id: "e1", race_type: "stage_race", stages: 7, terrain_archetype: "mountain_tour", season_id: "s9" };
  assert.deepEqual(generateRaceStageProfiles({ ...race, season_variant: 0 }), generateRaceStageProfiles(race));
});

test("resolveSeasonDrawVariants giver tier → variant til skrive-stierne", () => {
  const variants = resolveSeasonDrawVariants({ tierSeedRaces: tierSeedRacesFor(RETRY_SEASON_ID) });
  assert.equal(variants.get(1), 0);
  assert.ok(variants.get(3) > 0);
});

// ── resolveVariantByRaceId: den form backfill-scripterne har data i ──────────
test("resolveVariantByRaceId: alle puljer i en tier får SAMME variant (laveste pulje er repræsentant)", () => {
  const tier3 = SNAPSHOT.tiers.find((t) => t.tier === 3).races;
  // Samme løbssæt fan-out'et til to puljer (11 og 12) — som i virkeligheden (#2276).
  const races = [11, 12].flatMap((div) => tier3.map((r, i) => ({
    id: `${div}-${i}`, name: r.name, race_type: r.race_type, stages: r.stages,
    pool_race_id: `p${i}`, season_id: RETRY_SEASON_ID, league_division_id: div,
  })));
  const catalogMeta = new Map(tier3.map((r, i) => [`p${i}`, { external_id: r.external_id, terrain_archetype: r.terrain_archetype }]));
  const seen = [];
  const byRaceId = resolveVariantByRaceId({ races, catalogMeta, tierByDivision: new Map([[11, 3], [12, 3]]), onDraw: (d) => seen.push(d) });

  const variants = new Set(byRaceId.values());
  assert.equal(variants.size, 1, "de to puljer må ALDRIG få hver sin variant");
  assert.ok([...variants][0] > 0, "fixturens tier 3 forventes at ramme re-draw-stien");
  assert.equal(seen.length, 1, "variantet løses ÉN gang pr. (sæson, tier), ikke pr. pulje");
});

test("resolveVariantByRaceId: løb uden season_id eller uden kendt division → variant 0", () => {
  const races = [
    { id: "a", race_type: "single", stages: 1, pool_race_id: "p", league_division_id: 11 }, // ingen season_id
    { id: "b", race_type: "single", stages: 1, pool_race_id: "p", season_id: "s", league_division_id: 999 }, // ukendt division
  ];
  const byRaceId = resolveVariantByRaceId({ races, catalogMeta: new Map(), tierByDivision: new Map([[11, 3]]) });
  assert.equal(byRaceId.get("a"), 0);
  assert.equal(byRaceId.get("b"), 0);
});
