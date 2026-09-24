import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkCatalogSupply,
  raceCategoryYieldBounds,
  classWindowFor,
  quotasForRaceDays,
  buildSupplyGoals,
  classifySupplyFindings,
  shortfallOf,
  KNOWN_SUPPLY_DEVIATIONS,
  BLOCKING_VERDICTS,
  VERDICT_LABELS,
  GENERIC_SINGLE_PROFILES,
  GENERIC_STAGE_FILLER_PROFILES,
  GENERIC_STAGE_GUARANTEES,
  SUPPLY_DEFAULT_RACE_DAYS,
} from "./catalogSupplyCheck.js";
import { generateRaceStageProfiles } from "./raceStageProfileGenerator.js";
import { TERRAIN_FAMILY_BY_PROFILE_TYPE } from "./tierCalendarGuarantees.js";

const PROD_CATALOG = JSON.parse(
  readFileSync(new URL("./__fixtures__/racePoolCatalog.prod.json", import.meta.url), "utf8")
).catalog;

const isMountainFamily = (p) => TERRAIN_FAMILY_BY_PROFILE_TYPE[p] === "mountain";
const isHighMountain = (p) => p === "high_mountain";
const isItt = (p) => p === "itt" || p === "itt_hilly" || p === "ttt";

// ── Forsyning pr. løb: det tal hele dommen hviler på ───────────────────────────────────

test("endagsløb med fast kerneterræn har min = max = 1 for sin egen kategori", () => {
  // cobbled_classic har ÉN vægt (cobbles), så udfaldet er deterministisk.
  const race = { race_type: "single", stages: 1, terrain_archetype: "cobbled_classic" };
  assert.deepEqual(raceCategoryYieldBounds(race, (p) => p === "cobbles"), { min: 1, max: 1 });
  assert.deepEqual(raceCategoryYieldBounds(race, isMountainFamily), { min: 0, max: 0 });
});

test("endagsløb med to vægte i SAMME familie er garanteret for familien, ikke for profiltypen", () => {
  // mountain_classic ruller high_mountain/mountain 50/50 — begge er bjerg-familien.
  const race = { race_type: "single", stages: 1, terrain_archetype: "mountain_classic" };
  assert.deepEqual(raceCategoryYieldBounds(race, isMountainFamily), { min: 1, max: 1 });
  assert.deepEqual(raceCategoryYieldBounds(race, isHighMountain), { min: 0, max: 1 });
});

test("etapeløb: garantier sætter bunden, filler sætter loftet", () => {
  // summit_tour garanterer flat + mountain + 2× high_mountain og har high_mountain i filler.
  const race = { race_type: "stage_race", stages: 7, terrain_archetype: "summit_tour" };
  const hm = raceCategoryYieldBounds(race, isHighMountain);
  assert.equal(hm.min, 2, "de to garanterede høj-bjerg-etaper kan ikke rulles væk");
  assert.equal(hm.max, 2 + 3, "de 3 filler-pladser kan alle falde ud som høj-bjerg");
});

test("etapeløb: garantier trimmes til etapeantallet", () => {
  const race = { race_type: "stage_race", stages: 3, terrain_archetype: "summit_tour" };
  // guarantees = [flat, mountain, high_mountain, high_mountain] → slice(0,3) = een high_mountain
  assert.deepEqual(raceCategoryYieldBounds(race, isHighMountain), { min: 1, max: 1 });
});

test("TT-loftet begrænser enkeltstarts-loftet, også når filler har itt", () => {
  // balanced_week garanterer 1 itt og har itt i filler. Under GT-længden er loftet 1 (#4539),
  // så et 6-etapers løb kan ALDRIG levere mere end én enkeltstart uanset filler-træk.
  const short = { race_type: "stage_race", stages: 6, terrain_archetype: "balanced_week" };
  assert.deepEqual(raceCategoryYieldBounds(short, isItt), { min: 1, max: 1 });
  // En Grand Tour må have 2 (#2029).
  const gt = { race_type: "stage_race", stages: 18, terrain_archetype: "grand_tour" };
  assert.equal(raceCategoryYieldBounds(gt, isItt).max, 2);
});

test("ukendt arketype falder tilbage på generatorens generiske sti", () => {
  const race = { race_type: "stage_race", stages: 6, terrain_archetype: "findes-ikke" };
  // Generisk garanterer flad + bjerg; resten er filler uden TT.
  assert.equal(raceCategoryYieldBounds(race, isMountainFamily).min, 1);
  assert.equal(raceCategoryYieldBounds(race, (p) => p === "flat").min, 1);
  // Enkeltstarten er en 70 %-mønt ved ≥5 etaper: mulig, aldrig garanteret.
  assert.deepEqual(raceCategoryYieldBounds(race, isItt), { min: 0, max: 1 });
  const tiny = { race_type: "stage_race", stages: 3, terrain_archetype: "findes-ikke" };
  assert.equal(raceCategoryYieldBounds(tiny, isItt).max, 0, "under 5 etaper trækkes der ingen ITT");
});

// FORWARD-GUARD: de generiske vægte er SPEJLET i catalogSupplyCheck.js, fordi de er
// modul-private i generatoren. Spejlet må ikke drive fra virkeligheden — det er præcis den
// slags stille hul §5 har betalt for tre gange (`rolling`, `classic`, `itt_hilly`).
test("spejlet af generatorens generiske vægte matcher det generatoren faktisk producerer", () => {
  const seenSingle = new Set();
  const seenStage = new Set();
  for (let seed = 0; seed < 400; seed++) {
    for (const p of generateRaceStageProfiles({ id: `s-${seed}`, race_type: "single", stages: 1 }, { seed })) {
      seenSingle.add(p.profile_type);
    }
    for (const p of generateRaceStageProfiles({ id: `m-${seed}`, race_type: "stage_race", stages: 8 }, { seed })) {
      seenStage.add(p.profile_type);
    }
  }
  for (const t of seenSingle) {
    assert.ok(GENERIC_SINGLE_PROFILES.includes(t), `generatoren producerer "${t}" for et endagsløb uden arketype — spejlet i catalogSupplyCheck.js mangler den`);
  }
  const allowedStage = new Set([...GENERIC_STAGE_FILLER_PROFILES, ...GENERIC_STAGE_GUARANTEES, "itt"]);
  for (const t of seenStage) {
    assert.ok(allowedStage.has(t), `generatoren producerer "${t}" for et etapeløb uden arketype — spejlet i catalogSupplyCheck.js mangler den`);
  }
  // Og den anden vej: spejlet må heller ikke love noget generatoren aldrig leverer.
  for (const t of GENERIC_SINGLE_PROFILES) {
    assert.ok(seenSingle.has(t), `spejlet lover "${t}" for endagsløb, men 400 seeds producerede den aldrig`);
  }
});

// ── Klasse-vinduet ─────────────────────────────────────────────────────────────────────

test("klasse-vinduet bruger de samme tre filtre som udvælgeren", () => {
  const catalog = [
    { id: "gt", race_class: "TourFrance", race_type: "stage_race", stages: 18, terrain_archetype: "grand_tour" },
    { id: "ps-ok", race_class: "ProSeries", race_type: "stage_race", stages: 4, terrain_archetype: "summit_tour" },
    { id: "ps-for-lang", race_class: "ProSeries", race_type: "stage_race", stages: 8, terrain_archetype: "summit_tour" },
    { id: "c2", race_class: "Class2", race_type: "single", stages: 1, terrain_archetype: "flat_sprint" },
  ];
  const d1 = classWindowFor(1, catalog).map((r) => r.id);
  assert.ok(d1.includes("gt"), "D1 er klasse-ubegrænset og må have Grand Tours");
  assert.ok(!d1.includes("ps-for-lang"), "klasse↔etapeantal-båndet gælder også D1");
  const d3 = classWindowFor(3, catalog).map((r) => r.id);
  assert.deepEqual(d3, ["ps-ok"], "D3 må kun have ProSeries/Class1, ingen GT, inden for båndet");
  assert.deepEqual(classWindowFor(4, catalog).map((r) => r.id), ["c2"]);
});

// ── Dommene, mod syntetiske kataloger hvor svaret er kendt på forhånd ──────────────────

// Ét mål, ét katalog, kendt facit — så dommene kan afprøves uden at afhænge af prod-tal.
const mountainFloorGoal = (perTier) => [{
  id: "test:mountain", kind: "floor", rule: "§5-test", label: "bjerg-gulv (test)",
  inCategory: isMountainFamily, requirementFor: (tier) => perTier[tier] ?? null,
}];

test("et mål over loftet dømmes 'kan ikke nås'", () => {
  // 10 flade endagsløb: kvoten kan rammes præcist, men der findes ikke ét bjerg-løb.
  const catalog = Array.from({ length: 10 }, (_, i) => ({
    id: `f${i}`, name: `f${i}`, race_class: "Class2", race_type: "single", stages: 1,
    terrain_archetype: "flat_sprint",
  }));
  const res = checkCatalogSupply({
    catalog, tiers: [4], quotas: { 4: 10 }, goals: mountainFloorGoal({ 4: 1 }),
  });
  const row = res.rows.find((r) => r.goalId === "test:mountain");
  assert.equal(row.verdict, "impossible");
  assert.equal(row.bestAchievable, 0);
  assert.equal(shortfallOf(row), 1);
  assert.deepEqual(row.missingSources.present, [], "ingen arketype i vinduet kan bidrage");
});

test("kan kvoten slet ikke rammes eksakt, er det i sig selv et fund", () => {
  const catalog = [
    { id: "a", name: "a", race_class: "Class2", race_type: "stage_race", stages: 4, terrain_archetype: "summit_tour" },
  ];
  const res = checkCatalogSupply({
    catalog, tiers: [4], quotas: { 4: 7 }, goals: mountainFloorGoal({ 4: 1 }),
  });
  assert.equal(res.quotaReachable[4], false, "4 etaper kan ikke summe til 7");
  assert.equal(res.rows[0].verdict, "impossible");
});

test("to divisioner der deler et klasse-bånd dømmes 'contested' når forsyningen ikke kan mætte begge", () => {
  // ProSeries ligger i BÅDE D2's og D3's vindue. Der er kun ét bjerg-løb i det fælles bånd,
  // og hver division skal bruge et. Uanset hvem der vælger først, kommer én af dem til kort.
  const filler = (n, prefix, cls) => Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`, name: `${prefix}${i}`, race_class: cls, race_type: "single", stages: 1,
    terrain_archetype: "flat_sprint",
  }));
  const catalog = [
    { id: "m1", name: "m1", race_class: "ProSeries", race_type: "single", stages: 1, terrain_archetype: "mountain_classic" },
    ...filler(20, "b", "ProSeries"),
  ];
  const res = checkCatalogSupply({
    catalog, tiers: [2, 3], quotas: { 2: 6, 3: 6 }, goals: mountainFloorGoal({ 2: 1, 3: 1 }),
  });
  const rows = res.rows.filter((r) => r.goalId === "test:mountain");
  for (const row of rows) {
    assert.equal(row.verdict, "contested", `D${row.tier} skulle være bestridt`);
    assert.deepEqual(row.contestedWith.group, [2, 3]);
    assert.equal(row.contestedWith.supply, 1);
    assert.equal(row.contestedWith.demand, 2);
    assert.equal(shortfallOf(row), 1);
  }
});

test("rækker loftet, men er forsyningen ren filler, dømmes målet 'luck-dependent'", () => {
  // hilly_tour garanterer aldrig en rullende etape — den kommer kun fra filler.
  const catalog = Array.from({ length: 12 }, (_, i) => ({
    id: `h${i}`, name: `h${i}`, race_class: "Class1", race_type: "stage_race", stages: 4,
    terrain_archetype: "hilly_tour",
  }));
  const res = checkCatalogSupply({
    catalog, tiers: [4], quotas: { 4: 12 },
    goals: [{
      id: "test:rolling", kind: "floor", rule: "§5-test", label: "rullende-gulv (test)",
      inCategory: (p) => p === "rolling", requirementFor: () => 2,
    }],
  });
  const row = res.rows[0];
  assert.equal(row.verdict, "luck-dependent");
  assert.ok(row.bestAchievable >= 2, "loftet rækker rigeligt");
  assert.equal(row.bestGuaranteed, 0, "ingen garanteret rullende etape");
});

test("en arketype-reservation uden forsyning i vinduet dømmes 'kan ikke nås'", () => {
  // D4 reserverer 2 balanced_week; kataloget har ingen i Class1/Class2.
  const catalog = Array.from({ length: 30 }, (_, i) => ({
    id: `c${i}`, name: `c${i}`, race_class: "Class2", race_type: "single", stages: 1,
    terrain_archetype: "flat_sprint",
  }));
  const res = checkCatalogSupply({ catalog, tiers: [4], quotas: { 4: 12 }, goals: [] });
  const bw = res.reservations.find((r) => r.goalId === "reservation:balanced_week" && r.tier === 4);
  assert.equal(bw.verdict, "impossible");
  assert.equal(bw.supplyInWindow, 0);
  assert.equal(bw.requirement, 2);
  assert.equal(shortfallOf(bw), 2);
});

// ── Kvoten ─────────────────────────────────────────────────────────────────────────────

test("kvoten udledes af density × løbsdatoer, ikke af den forældede default-konstant", () => {
  // CALENDAR_RULES §1b: TIER_GAME_DAY_QUOTA står stadig med D4 = 56 fra dengang tætheden var 2.
  assert.deepEqual(quotasForRaceDays(28), { 1: 140, 2: 112, 3: 84, 4: 84 });
  assert.equal(SUPPLY_DEFAULT_RACE_DAYS, 28);
});

// ── Gaten mod det committede prod-katalog ──────────────────────────────────────────────
//
// Den her er selve vagten. Den skal være GRØN i dag og RØD i det øjeblik forsyningen bliver
// værre. Alle tal nedenfor er ANTAL (etaper/løb) — ingen målte fordelinger, repoet er
// offentligt.

// Højeste tilladte underskud pr. kendt afvigelse og division, målt 19/9 mod denne fixture.
// Vokser et af dem, er kataloget gået tilbage og testen fælder sig selv. Tallene må kun
// sættes NED (når kataloget bliver bedre) — aldrig op for at gøre en test grøn igen.
const LOCKED_SHORTFALLS = Object.freeze({
  "5405-rolling-har-ingen-garanteret-kilde:1": 15,
  "5405-rolling-har-ingen-garanteret-kilde:2": 6,
  "5405-rolling-har-ingen-garanteret-kilde:3": 4,
  "5405-rolling-har-ingen-garanteret-kilde:4": 3,
});

test("prod-kataloget: ingen division har et mål der beviseligt ikke kan nås", () => {
  const res = checkCatalogSupply({ catalog: PROD_CATALOG });
  for (const tier of [1, 2, 3, 4]) {
    assert.equal(res.quotaReachable[tier], true, `D${tier} kan ikke ramme sin kvote eksakt`);
  }
  const blocking = res.findings.filter((f) => BLOCKING_VERDICTS.includes(f.verdict));
  assert.deepEqual(
    blocking.map((f) => `D${f.tier} ${f.goalId}: ${VERDICT_LABELS[f.verdict]}`),
    [],
    "NYT forsyningsbrud. Et katalog-loft lukkes ved at TILFØJE løb (CALENDAR_RULES §5b) — "
    + "ikke ved at slække et mål og ikke ved at registrere det som en afvigelse her.",
  );
});

test("prod-kataloget: hvert fund er dækket af en kendt, navngiven afvigelse", () => {
  const res = checkCatalogSupply({ catalog: PROD_CATALOG });
  const { unexpected, expected } = classifySupplyFindings(res.findings, {
    shortfallLimits: LOCKED_SHORTFALLS,
  });
  assert.deepEqual(
    unexpected.map((f) => `D${f.tier} ${f.goalId} (${f.verdict})`),
    [],
    "Et fund uden en registreret afvigelse. Er det en ægte forværring, skal kataloget rettes "
    + "(§5b). Er det en bevidst, accepteret tilstand, skal den skrives ind i "
    + "KNOWN_SUPPLY_DEVIATIONS med en udløbsdato — ikke bare fjernes fra testen.",
  );
  assert.equal(expected.length, 4, "de fire kendte rullende-fund (én pr. division) skal stadig være der");
});

test("prod-kataloget: ingen kendt afvigelse er blevet VÆRRE", () => {
  const res = checkCatalogSupply({ catalog: PROD_CATALOG });
  const { worsened } = classifySupplyFindings(res.findings, { shortfallLimits: LOCKED_SHORTFALLS });
  assert.deepEqual(
    worsened.map((w) => `${w.deviation.id} D${w.finding.tier}: ${w.actual} > ${w.limit}`),
    [],
    "Forsyningen er gået tilbage siden tallet blev låst. Hæv IKKE grænsen for at få testen grøn.",
  );
});

// #4827: denne test skal bevise STRUKTUREN (hver afvigelse har en gyldig, ikke-udløbet
// dato PÅ DET TIDSPUNKT TESTEN BLEV SKREVET) — ikke fungere som den nightly udløbs-vagt.
// Et bart `new Date()` gjorde testen klokke-afhængig: CI kører også med uret skubbet langt
// frem (CZ_TEST_CLOCK_OFFSET_DAYS, #3385-mekanismen), og ville dermed fælde denne test hver
// gang en afvigelse passerer sin reviewBy — uanset om nogen faktisk har set på kataloget.
// Den ÆGTE udløbs-vagt med den rigtige vægur-klokke er flyttet til et natligt,
// ikke-gatende tjek: `--check-expiry` i backend/scripts/dev/catalogSupplyReport.mjs, kaldt
// fra .github/workflows/calendar-invariant-audit.yml.
const STRUCTURAL_TODAY = "2026-09-19";

test("de kendte afvigelser er tidsbegrænsede og ikke udløbet", () => {
  const { expired } = classifySupplyFindings([], { today: STRUCTURAL_TODAY });
  assert.deepEqual(
    expired.map((d) => `${d.id} (udløb ${d.reviewBy})`),
    [],
    "En forventet afvigelse er udløbet. Kør backend/scripts/dev/catalogSupplyReport.mjs mod "
    + "prod-kataloget, afgør med ejeren om den er lukket eller skal forlænges, og opdatér "
    + "KNOWN_SUPPLY_DEVIATIONS — en 'midlertidig' undtagelse uden udløb er bare en regel "
    + "ingen har skrevet ned.",
  );
  for (const dev of KNOWN_SUPPLY_DEVIATIONS) {
    assert.match(dev.reviewBy, /^\d{4}-\d{2}-\d{2}$/, `${dev.id} mangler en gyldig udløbsdato`);
    assert.equal(dev.issue, 5405, `${dev.id} skal henvise til det issue den kom fra`);
    assert.ok(dev.note.length > 40, `${dev.id} skal forklare hvad den dækker og hvordan den lukkes`);
  }
});

test("alle mål har et krav og en dom i alle fire divisioner", () => {
  const res = checkCatalogSupply({ catalog: PROD_CATALOG });
  const goals = buildSupplyGoals();
  assert.ok(goals.length > 0);
  for (const row of res.rows) {
    assert.ok(Object.hasOwn(VERDICT_LABELS, row.verdict), `ukendt dom "${row.verdict}"`);
    assert.ok(Number.isInteger(row.requirement), `${row.goalId} D${row.tier} mangler et krav i etaper`);
    assert.ok(row.bestAchievable == null || row.bestAchievable >= row.bestGuaranteed,
      `${row.goalId} D${row.tier}: loftet kan aldrig ligge under den garanterede forsyning`);
  }
});

// ── #5405: forsyningen bag de hævede bjerg-reservationer ───────────────────────────────
//
// Reservations-ændringen (D2/D3 summit_tour op, D3 får balanced_week) og de tre nye
// ProSeries-summit_tour-løb er ÉT indgreb. Testene her er det led der binder dem sammen:
// forsvinder løbene fra kataloget igen, kan reservationerne ikke mættes, og det skal en
// test sige — ikke en tørkørsel ingen har kørt.

const NYE_BJERGLOEB_5405 = Object.freeze([
  "Volta Galega", "Rundfahrt der Hohen Tauern", "Volta Portuguesa",
]);

test("#5405 prod-kataloget rummer de tre nye ProSeries-bjergløb", () => {
  for (const navn of NYE_BJERGLOEB_5405) {
    const race = PROD_CATALOG.find((r) => r.name === navn);
    assert.ok(race, `${navn} mangler i fixturen. Den er forsyningen bag D2's og D3's hævede `
      + "summit_tour-reservationer — se database/2026-09-20-5405-tre-nye-bjergloeb.sql.");
    assert.equal(race.race_class, "ProSeries",
      `${navn} skal ligge i ProSeries — den ENESTE klasse D2 og D3 deler. Flyttes den til `
      + "Class1, kan den pr. konstruktion aldrig nå D2, og hele ændringen mister sin virkning.");
    assert.equal(race.terrain_archetype, "summit_tour");
    assert.equal(race.race_type, "stage_race");
  }
});

test("#5405 D2's og D3's summit_tour-reservationer kan mættes af kataloget", () => {
  const res = checkCatalogSupply({ catalog: PROD_CATALOG });
  for (const tier of [2, 3]) {
    const row = res.reservations.find((r) => r.goalId === "reservation:summit_tour" && r.tier === tier);
    assert.ok(row, `ingen dom over D${tier}'s summit_tour-reservation`);
    assert.equal(
      row.verdict, "reachable",
      `D${tier}'s summit_tour-reservation er ikke længere dækket (${VERDICT_LABELS[row.verdict]}). `
      + "Enten er reservationen hævet uden at kataloget fulgte med, eller også er der fjernet "
      + "bjergløb fra ProSeries. Lukkes ved at TILFØJE løb (CALENDAR_RULES §5b), ikke ved at "
      + "sænke reservationen tilbage.",
    );
  }
});

test("#5405 D3's balanced_week-reservation har en kilde i D3's eget klasse-vindue", () => {
  const res = checkCatalogSupply({ catalog: PROD_CATALOG });
  const row = res.reservations.find((r) => r.goalId === "reservation:balanced_week" && r.tier === 3);
  assert.ok(row, "D3 har ingen balanced_week-reservation længere — det er den der betaler "
    + "D3's enkeltstart tilbage, når bjergdagene stiger (#5405).");
  assert.ok(row.supplyInWindow >= row.requirement,
    `D3 kan ikke mætte sin balanced_week-reservation (${row.supplyInWindow} < ${row.requirement}).`);
});
