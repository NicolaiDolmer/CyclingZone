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

// "Retry-stien fyrer"-fixture mod den ÆGTE generator: sæson 29's kanoniske træk bryder
// tier 3's summit-bånd (7 < 8) og rettes af gen-træk 2. Ét brydende tier, re-draw lykkes.
//
// ⚠ DENNE KONSTANT ER KNYTTET TIL GENERATORENS VÆGTE. Ændrer nogen ARCHETYPE_PROFILES,
// kan sæson 29's træk begynde at bestå i første forsøg, og testene nedenfor holder op med
// at teste det de påstår (de fejler højlydt — de bliver ikke tavst grønne). Find i så fald
// en ny med:
//
//   for (let n = 1; n <= 60; n++) {
//     const id = `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
//     const d = resolveSeasonDraw({ tierSeedRaces: tierSeedRacesFor(id) });
//     const retried = d.filter((x) => x.attempt > 0);
//     if (retried.length === 1 && retried[0].tier === 3 && !retried[0].exhausted) console.log(id, n);
//   }
//
// Selve re-draw-MEKANIKKEN testes desuden syntetisk (fakeGenerator ovenfor), hvor det er
// garanteret at retry-stien rammes uanset hvad generatorens vægte gør.
const RETRY_SEASON_ID = "00000000-0000-0000-0000-00000000001d";

// ── Syntetiske generatorer (fuld kontrol over hvornår et træk består) ────────
const passingStage = () => ({ profile_type: "high_mountain", finale_type: "long_climb", distance_km: 170, sectors: [] });
const failingStage = () => ({ profile_type: "mountain", finale_type: "descent", distance_km: 170, sectors: [] });
// Tier 3's bånd: summit ≥ 8, M-Down ≤ 55 %, 1 fritstående ITT, 1 brosten-i-etapeløb.
//
// #3469: to FASTE (variant-uafhængige) løb tilføjet — 'd' (bunch-sprint-forsyning) og
// 'e' (nedkørsels-finale-forsyning) — så de nye finale-gulve (bunch_sprint_min ≥ 10,
// descent_finale_min ≥ 4) er opfyldt UANSET om 'a' er i sin fail- eller pass-tilstand.
// 'e' er dimensioneret PRÆCIS til at holde M-Down-loftet (55 %) når 'a' passerer (8 summit
// + 4 nedkørsel = 12 bjerg-etaper, 4/12 ≈ 33 % — rigelig margin) samtidig med at ramme
// descent_finale_min ≥ 4 præcist (samme "lige akkurat"-stil som 'a's summit=8-eksakt-match).
const tier3SeedRaces = () => [
  { id: "a", name: "Bjergløb", race_type: "stage_race", stages: 8 },
  { id: "b", name: "Enkeltstart", race_type: "single", stages: 1 },
  { id: "c", name: "Brostensløb", race_type: "stage_race", stages: 2 },
  { id: "d", name: "Sprint-serien", race_type: "stage_race", stages: 12 },
  { id: "e", name: "Nedkørsels-serien", race_type: "stage_race", stages: 4 },
];
function fakeGenerator(passFrom) {
  return (race) => {
    const variant = race.season_variant ?? 0;
    if (race.id === "b") return [{ profile_type: "itt", finale_type: "solo_tt", distance_km: 30, sectors: [] }];
    if (race.id === "c") {
      return [{ profile_type: "flat", finale_type: "bunch_sprint", distance_km: 170, sectors: [] },
        { profile_type: "cobbles", finale_type: "reduced_sprint", distance_km: 160, sectors: [{ kind: "cobbles" }] }];
    }
    if (race.id === "d") return Array.from({ length: 12 }, () => ({ profile_type: "flat", finale_type: "bunch_sprint", distance_km: 158, sectors: [] }));
    if (race.id === "e") return Array.from({ length: 4 }, () => ({ profile_type: "mountain", finale_type: "descent", distance_km: 170, sectors: [] }));
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

// #3469 (ejer-beslutning 7/8: "Alle divisioner skal have realisme-bånd"): FØR denne
// hærdning havde tier 1/2 ingen mål i TIER_TARGETS, og et vedvarende brud blev ALDRIG
// trukket om. Nu har begge divisioner rigtige bånd — et vedvarende brud (fakeGenerator
// der aldrig rammer et summit-finish) opfører sig derfor nøjagtig som tier 3/4 altid har:
// alle forsøg brugt, exhausted, fald tilbage til det kanoniske træk.
test("#3469: tier 1/2 er nu REALISME-GATEDE ligesom tier 3/4 — et vedvarende brud udtømmer alle forsøg", () => {
  const draw = resolveTierDraw({ tier: 2, seedRaces: tier3SeedRaces(), generateProfiles: fakeGenerator(Infinity) });
  assert.equal(draw.exhausted, true);
  assert.equal(draw.attempt, 0, "udtømt → det kanoniske træk, samme kontrakt som tier 3/4");
  assert.ok(draw.failures.some((f) => f.includes("summit")), draw.failures.join(" · "));
});

test("en løbs-generering der kaster bogføres som 'kunne ikke vurderes', ikke som båndbrud", () => {
  const boom = (race) => { if (race.id === "b") throw new Error("kaboom"); return fakeGenerator(0)(race); };
  const { entry, failures } = drawTierAttempt({ tier: 3, seedRaces: tier3SeedRaces(), generateProfiles: boom });
  assert.ok(entry.errors.some((e) => e.includes("kaboom")), entry.errors.join(" · "));
  // Manglende ITT er nu et ægte båndbrud (løbet forsvandt), men fejlen er BEVARET —
  // #2854-kontrakten: aldrig tavst væk.
  assert.ok(failures.some((f) => f.includes("ITT")), failures.join(" · "));
});

test("determinisme når re-draw fyrer — syntetisk, uafhængig af generatorens vægte", () => {
  // Vægt-uafhængig makker til den ægte-generator-test nedenfor: fakeGenerator(2) består
  // FØRST ved attempt 2, så retry-stien rammes med sikkerhed uanset ARCHETYPE_PROFILES.
  const run = () => resolveTierDraw({ tier: 3, seedRaces: tier3SeedRaces(), generateProfiles: fakeGenerator(2) });
  const a = run(), b = run();
  assert.equal(a.attempt, 2, "fixturen SKAL ramme retry-stien");
  assert.equal(a.attempt, b.attempt);
  assert.equal(JSON.stringify(a.entry), JSON.stringify(b.entry));
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
  const resolved = scoreSeason(draws.map((d) => d.entry));
  // #3469: tier 1/2 fik EGNE realisme-bånd (itt_min/cobbles_min m.fl.). Dette snapshot
  // er sæson 2's ALLEREDE MATERIALISEREDE (historiske, låste) løbs-udvalg — det blev
  // valgt FØR itt_classic/cobbled_tour-reservationerne (#3469 runde 1/2) garanterede den
  // forsyning for tier 1/2 i produktion. Et re-draw kan kun variere PARCOURS-generering
  // for et allerede-fastlåst løbs-udvalg — det kan aldrig opfinde et løb der ikke blev
  // valgt dengang. Det er et hul i DETTE ene historiske øjebliksbillede, ikke i den
  // levende selektions-algoritme (verificeret separat mod S3's plan, se PR-body). Testens
  // fokus (tier 3's re-draw) forbliver derfor uændret: INGEN af de resterende brud må
  // være tier 3's.
  assert.ok(resolved.failures.every((f) => !f.startsWith("tier 3:")), resolved.failures.join(" · "));
  assert.ok(resolved.failures.length > 0, "tier 1/2's historiske hul skal stadig være synligt, ikke tavst forsvundet");
  // Kun den brydende tier 3 trækkes om — de øvrige tiers' parcours røres ikke.
  assert.deepEqual(draws.filter((d) => d.attempt > 0).map((d) => d.tier), [3]);
});

test("#3295: sæson 2's kanoniske træk består tier 3/4's realisme-bånd uden re-draw", () => {
  // Før kompositions-kalibreringen brød sæson 2's tier 3 M-Down-båndet (57 % > 55 %) og
  // krævede et gen-træk. De nye filler-vægte (bjerg ned, kuperet op) fjernede bruddet.
  // Fastholdes som regression-vagt: går denne test i rødt, er kalibreringen drevet
  // tilbage mod den gamle bjerg-tunge fordeling.
  const draws = resolveSeasonDraw({ tierSeedRaces: tierSeedRacesFor(SEASON_2_ID) });
  assert.deepEqual(draws.map((d) => d.attempt), [0, 0, 0, 0], "intet re-draw HJÆLPER — tier 1/2 kan strukturelt ikke (se nedenfor), tier 3/4 har ikke brug for det");

  const resolved = scoreSeason(draws.map((d) => d.entry));
  assert.ok(resolved.failures.every((f) => f.startsWith("tier 1:") || f.startsWith("tier 2:")), resolved.failures.join(" · "));

  // #3469: samme historiske hul som testen ovenfor — sæson 2's tier 1/2-udvalg blev
  // materialiseret FØR itt_classic/cobbled_tour-reservationerne fandtes, så draw.exhausted
  // (ikke et båndbrud i den LEVENDE selektionsalgoritme) er den ærlige rapportering her.
  assert.equal(draws.find((d) => d.tier === 1).exhausted, true);
  assert.equal(draws.find((d) => d.tier === 2).exhausted, true);
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
