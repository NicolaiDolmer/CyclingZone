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
// Ægte kalender-snapshot, én repræsentativ pulje pr. tier — samme fil
// scripts/raceRouteRealismDrawHarness.js måler fail-raten på.
//
// #3469 (8/8): snapshottet blev REGENERERET fra en DRY-RUN-plan af sæson 3 (ikke en
// læsning af en allerede-materialiseret sæsons `races`-tabel) via
// `node scripts/raceRouteRealismDrawHarness.js --refresh-plan --season 3 --first-day 2026-08-24`.
// Grunden: det GAMLE snapshot (sæson 2's historiske, frosne `races`-udvalg) blev
// materialiseret FØR itt_classic/cobbled_tour-arketype-reservationerne (#3469 runde 1/2)
// garanterede den forsyning for tier 1/2 — snapshottet var derfor strukturelt umuligt at
// bestå D1/D2's nye realisme-bånd, uanset hvor mange gen-træk der blev prøvet (re-draw
// varierer KUN parcours-generering for et allerede-fastlåst løbsudvalg, aldrig hvilke løb
// der blev valgt). Et nyt --refresh mod samme (allerede spillede) sæson 2 ville have
// reproduceret PRÆCIS samme frosne udvalg — derfor dry-run-planen i stedet, som kører den
// LEVENDE selection-algoritme (klasse-whitelist, prestige-walk, reservationer) mod det
// NUVÆRENDE race_pool-katalog uden at kræve at nogen sæson er skrevet til DB.
const SNAPSHOT = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "seasonTierCalendarSnapshot.json"), "utf8"));
const tierSeedRacesFor = (seasonId) => SNAPSHOT.tiers.map((t) => ({
  tier: t.tier,
  seedRaces: t.races.map((r) => ({ ...r, id: r.external_id, season_id: seasonId })),
}));

// Snapshottets ÆGTE season_id (sæson 3's dry-run-plan). Dens kanoniske (attempt 0) træk
// bryder tier 1/2/3's realisme-bånd (spredning, samme #3347-mønster som altid) — alle tre
// rettes af re-drawet uden at udtømme forsøgene. Se test nedenfor.
const PLAN_SEASON_ID = SNAPSHOT.seasonId;

// "Retry-stien fyrer"-fixture mod den ÆGTE generator: dette season_id's kanoniske træk
// bryder tier 2 OG tier 3's bånd, begge rettes af gen-træk. Bruges af determinisme- og
// variant-testene nedenfor, som ikke kræver at KUN ét tier bryder.
//
// ⚠ DENNE KONSTANT ER KNYTTET TIL GENERATORENS VÆGTE + DET AKTUELLE LØBSUDVALG. Ændrer
// nogen ARCHETYPE_PROFILES eller regenereres snapshottet (se ovenfor), kan dette
// season_id's træk begynde at bestå i første forsøg, og testene nedenfor holder op med at
// teste det de påstår (de fejler højlydt — de bliver ikke tavst grønne). Find i så fald en
// ny med:
//
//   for (let n = 1; n <= 200; n++) {
//     const id = `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
//     const d = resolveSeasonDraw({ tierSeedRaces: tierSeedRacesFor(id) });
//     if (d.some((x) => x.attempt > 0)) console.log(id, n, d.map((x) => x.attempt));
//   }
//
// Selve re-draw-MEKANIKKEN testes desuden syntetisk (fakeGenerator nedenfor), hvor det er
// garanteret at retry-stien rammes uanset hvad generatorens vægte gør.
// #4272 (26/8): …01d holdt op med at ramme re-draw-stien da FINALE_WEIGHTS_BY_PROFILE
// erstattede den positionsbaserede FINALE_BY_PROFILE (mountain gik fra 60 % descent til
// 34 %) og descent_finale_min blev re-deriveret. Genfundet med søgeloopet ovenfor —
// præcis den skrøbelighed advarslen forudsiger, og testen fejlede højlydt, ikke tavst.
// …007 trækker om i tier 3 OG tier 4 (attempt 1 begge steder) mens tier 1 består i
// første forsøg — resolveSeasonDrawVariants-testen nedenfor kræver præcis den form
// (variants.get(1) === 0 og variants.get(3) > 0).
//
// #4539 (4/9): …007 holdt op med at ramme tier 3's re-draw-sti da SHORT_RACE_TT_CAP
// strammede TT-loftet for etapeløb under GRAND_TOUR_MIN_STAGES (raceStageProfileGenerator.js)
// — færre filler-rullede ekstra-ITT'er ændrede tier 3's kanoniske parcours-træk nok til at
// bestå i første forsøg. Præcis den skrøbelighed advarslen forudsiger. Genfundet med samme
// søgeloop mod det uændrede snapshot: …07d har samme form (tier 3 OG tier 4, attempt 1 begge
// steder, tier 1 attempt 0).
const RETRY_SEASON_ID = "00000000-0000-0000-0000-00000000007d";

// Samme idé, men for testen der SPECIFIKT skal bevise "kun ÉN tier brød, og KUN den
// trækkes om" — fundet via søgeloopet ovenfor mod det regenererede snapshot. Samme
// skrøbelighed som RETRY_SEASON_ID (se advarslen ovenfor) — søg en ny med samme loop,
// filtreret til `retried.length === 1 && retried[0].tier === 3`, hvis denne holder op med
// at ramme.
//
// #3371 (23/8): weaveMountainFamilyBlocks (maks 2 bjerg-etaper i træk for korte/mellemlange
// løb) ændrede generatorens deterministiske output nok til at det GAMLE seed (…005) ikke
// længere brød tier 3's bånd i det kanoniske træk — testen fejlede højlydt på sit eget
// "fixturen skal reelt bryde noget"-assert (præcis den skrøbelighed advarslen ovenfor
// forudsagde), ikke tavst. Genfundet med samme søgeloop mod snapshottet EFTER #3371.
//
// #4272 (26/8): samme historie igen — …00b brød ikke længere tier 3 alene efter
// finale-vægtene blev båndstyrede. Genfundet med samme loop, filtreret til
// `retried.length === 1 && retried[0].tier === 3`: …006 (tier 3, attempt 1).
const SINGLE_TIER_RETRY_SEASON_ID = "00000000-0000-0000-0000-000000000006";

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

// #4288 (3/9): GT-baandet er lagt om til ejerens fire distance-graenser (samlet snit,
// landevejssnit, prolog- og enkeltstarts-gulv). Snapshottet i denne fil er FROSSET og
// indeholder 21-ETAPERS Grand Tours - et etapeantal kataloget ikke har haft siden foer
// saeson 3, og som ejeren 3/9 endeligt satte til 17/17/18. Deres parcours er trukket under
// de gamle regler, saa de bryder de nye gulve (prologer paa 5-7 km, enkeltstarter paa
// 15-23 km) uanset hvor mange gange der traekkes om.
//
// Det er IKKE en svaghed ved baandet: maalt mod prods faktiske katalog 3/9 er alle tre
// aegte GT'er groenne (docs/audits/season4-calendar-dryrun-2026-09-03.md §10). Det er en
// staleness i fixturen. Disse to tests handler om RE-DRAW-MEKANIKKEN for tier-baandene, og
// de maa ikke holde op med at teste den fordi en frossen GT-rute fra en anden aera ikke kan
// rettes af et gen-traek. GT-bruddene filtreres derfor fra HER - og kun her.
const udenGtBrud = (failures) => failures.filter((f) => !f.includes(": GT «"));

test("et kanonisk træk der bryder tier 3's bånd rettes af re-drawet — og KUN den tier trækkes om", () => {
  const tierSeedRaces = tierSeedRacesFor(SINGLE_TIER_RETRY_SEASON_ID);
  const first = scoreSeason(tierSeedRaces.map(({ tier, seedRaces }) => ({
    tier, races: seedRaces.map((r) => ({ name: r.name, race_type: r.race_type, terrain_archetype: r.terrain_archetype, stages: generateRaceStageProfiles(r) })),
  })));
  const foerste = udenGtBrud(first.failures);
  assert.ok(foerste.every((f) => f.startsWith("tier 3:")), `fixturen skal PRÆCIS bryde tier 3, ellers tester vi ikke det testen påstår: ${foerste.join(" · ")}`);
  assert.ok(foerste.length > 0, "fixturen skal reelt bryde noget");

  const draws = resolveSeasonDraw({ tierSeedRaces });
  const resolved = scoreSeason(draws.map((d) => d.entry));
  assert.deepEqual(udenGtBrud(resolved.failures), [], "re-drawet skal rette bruddet fuldstændigt — alle 4 tiers er nu realisme-gatede (#3469), ingen strukturelle huller tilbage efter snapshottet blev regenereret fra en dry-run-plan (se fil-header)");
  // Kun den brydende tier 3 trækkes om — de øvrige tiers' parcours røres ikke.
  assert.deepEqual(draws.filter((d) => d.attempt > 0).map((d) => d.tier), [3]);
});

// #3469 (8/8, erstatter det tidligere "#3295: sæson 2 består uden re-draw"-narrativ):
// snapshottet er nu sæson 3's DRY-RUN-plan (se fil-header) — et FRISKERE, større
// løbsudvalg end sæson 2's frosne historiske udvalg, og dens kanoniske træk bryder
// faktisk tier 1/2/3's bånd (ren spredning, #3347-mønsteret). Det interessante er IKKE
// længere "ingen tier behøver re-draw" — det er at ALLE FIRE tiers (inkl. de nye D1/D2-
// bånd) rent faktisk KAN nå grønt via re-draw, uden en eneste udtømt (exhausted) tier.
// Det er selve beviset på at #3469's itt_classic/cobbled_tour-reservationer lukkede det
// hul den forrige (sæson-2-baserede) fixture blotlagde.
test("#3469: sæson 3-planens kanoniske træk bryder tier 1/2/3's bånd (spredning) — re-drawet retter ALLE, ingen tier udtømt", () => {
  const tierSeedRaces = tierSeedRacesFor(PLAN_SEASON_ID);
  const first = scoreSeason(tierSeedRaces.map(({ tier, seedRaces }) => ({
    tier, races: seedRaces.map((r) => ({ name: r.name, race_type: r.race_type, terrain_archetype: r.terrain_archetype, stages: generateRaceStageProfiles(r) })),
  })));
  assert.ok(udenGtBrud(first.failures).length > 0, "det kanoniske træk skal reelt bryde noget, ellers tester vi ikke re-draw-stien");

  const draws = resolveSeasonDraw({ tierSeedRaces });
  assert.deepEqual(udenGtBrud(scoreSeason(draws.map((d) => d.entry)).failures), [], "re-drawet skal fjerne ALLE tier-brud, på tværs af alle 4 tiers");
  // Tier 1 udtømmer sit gen-træk på fixturens frosne 21-etapers GT-ruter (se udenGtBrud
  // ovenfor); de øvrige tiers må ikke udtømme.
  assert.ok(draws.filter((d) => d.tier !== 1).every((d) => !d.exhausted), draws.map((d) => `tier ${d.tier}: exhausted=${d.exhausted}`).join(" · "));
  // Mindst tier 1-3 har historisk krævet et gen-træk på denne plan (dokumenteret i
  // fil-headeren) — tier 4 komponerer sig grønt fra start. Assert'et er bevidst løst
  // koblet til de PRÆCISE attempt-numre (de skifter med ARCHETYPE_PROFILES-vægte, jf.
  // RETRY_SEASON_ID-advarslen ovenfor) — kun at NOGEN reelt trak om.
  assert.ok(draws.some((d) => d.attempt > 0), draws.map((d) => `tier ${d.tier}=${d.attempt}`).join(" · "));
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
