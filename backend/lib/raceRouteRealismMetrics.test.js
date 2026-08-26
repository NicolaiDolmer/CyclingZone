// backend/lib/raceRouteRealismMetrics.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreTier, scoreSeason, TIER_TARGETS, VERDICT, tierGateState } from "./raceRouteRealismMetrics.js";

const st = (profile_type, finale_type, distance_km = 160) => ({ profile_type, finale_type, distance_km, sectors: [] });
const stageRace = (stages) => ({ race_type: "stage_race", stages });
const oneDay = (profile_type, finale_type) => ({ race_type: "single", stages: [st(profile_type, finale_type)] });

// ── Fixtures til sæson-aggregatet (scoreSeason) ─────────────────────────────
// En tier-3-pulje der opfylder ALLE #2755/#3469-mål (summit ≥ 8, M-Down ≤ 55%, 1 ITT,
// 1 brosten, bunch_sprint ≥ 10, descent-finale ≥ 4, solo_tt-slutfinale ≥ 1).
function passingTier3Races() {
  return [
    stageRace(Array.from({ length: 4 }, () => st("high_mountain", "long_climb", 170))
      .concat(Array.from({ length: 4 }, () => st("mountain", "descent", 170)))),
    stageRace(Array.from({ length: 4 }, () => st("high_mountain", "long_climb", 170))),
    oneDay("itt", "solo_tt"),
    stageRace(Array.from({ length: 10 }, () => st("flat", "bunch_sprint", 158))
      .concat([{ ...st("cobbles", "reduced_sprint", 160), sectors: [{ kind: "cobbles", start_km: 80, length_km: 2 }] }])),
  ];
}

// #3469: en tier-1-pulje der opfylder ALLE mål (summit ≥ 12, M-Down ≤ 55%, 1 ITT,
// 1 brosten, bunch_sprint ≥ 15, descent-finale ≥ 8, solo_tt-slutfinale ≥ 2).
function passingTier1Races() {
  return [
    stageRace(Array.from({ length: 12 }, () => st("high_mountain", "long_climb", 170))),
    stageRace(Array.from({ length: 8 }, () => st("mountain", "descent", 170))),
    stageRace(Array.from({ length: 15 }, () => st("flat", "bunch_sprint", 158))),
    oneDay("itt", "solo_tt"),
    oneDay("itt", "solo_tt"),
    stageRace([st("flat", "bunch_sprint"), { ...st("cobbles", "reduced_sprint", 160), sectors: [{ kind: "cobbles", start_km: 80, length_km: 2 }] }]),
  ];
}

// 21 etaper: 3318 km (∈ 3200–3500) og 42 kategoriserede stigninger (≥ 25) — kun
// HC-antallet varieres, så en fixture kan fejle PRÆCIS ét GT-bånd.
function grandTourStages({ hc = 4, stageCount = 21 } = {}) {
  return Array.from({ length: stageCount }, (_, i) => ({
    ...st("flat", "bunch_sprint", 158),
    climbs: i < hc ? [{ category: "HC" }, { category: "1" }] : [{ category: "2" }, { category: "3" }],
  }));
}

test("scoreTier tæller summit = long_climb på mtn/hm", () => {
  const races = [{ ...stageRace(), stages: [st("high_mountain", "long_climb"), st("mountain", "long_climb"), st("mountain", "descent")] }];
  const s = scoreTier(3, races);
  assert.equal(s.summit_finishes, 2);
  assert.equal(s.mdown_pct, 33); // 1 descent af 3 bjerg-etaper
});

test("scoreTier tæller fritstående ITT + brosten-i-etapeløb", () => {
  const races = [
    oneDay("itt", "solo_tt"),
    { ...stageRace(), stages: [st("flat", "bunch_sprint"), { ...st("cobbles", "reduced_sprint"), sectors: [{ kind: "cobbles", start_km: 80, length_km: 2 }] }] },
  ];
  const s = scoreTier(3, races);
  assert.equal(s.standalone_itt, 1);
  assert.equal(s.cobbles_in_stagerace, 1);
});

test("GO/NO-GO: en tier under mål fejler gaten", () => {
  const flatOnly = [{ ...stageRace(), stages: [st("flat", "bunch_sprint"), st("mountain", "descent")] }];
  const s = scoreTier(3, flatOnly);
  assert.equal(s.pass, false);
  assert.ok(s.failures.some((f) => f.includes("summit")));
});

// #2854: scorecardet printede "✅ GO — alle gatede tiers grønne" + exit 0 selvom
// en grand tour faldt udenfor HC-båndet, fordi kun scoreTier gate'de verdicten.
test("#2854: en grand tour udenfor HC-båndet må ikke give GO", () => {
  const summary = scoreSeason([
    { tier: 1, races: [...passingTier1Races(), { ...stageRace(grandTourStages({ hc: 1 })), name: "Tour de l'Hexagone" }] },
    { tier: 3, races: passingTier3Races() },
  ]);

  const gt = summary.tiers.find((t) => t.tier === 1).grandTours[0];
  assert.equal(gt.pass, false, "fixturen skal fejle GT-båndet (ellers tester vi ingenting)");
  assert.ok(summary.tiers.every((t) => t.score.pass), "alle tier-scores skal bestå (ellers er det tier-gaten der fælder)");

  assert.notEqual(summary.verdict, "GO");
  assert.notEqual(summary.exitCode, 0);
  assert.ok(summary.failures.some((f) => f.includes("HC-stigninger")), `HC-bruddet skal stå i failures: ${JSON.stringify(summary.failures)}`);
});

test("TIER_TARGETS matcher #2755 for tier 3 og 4", () => {
  assert.equal(TIER_TARGETS[3].summit_min, 8);
  assert.equal(TIER_TARGETS[3].mdown_max_pct, 55);
  assert.equal(TIER_TARGETS[4].summit_min, 4);
  assert.equal(TIER_TARGETS[4].mdown_max_pct, 60);
});

// #3469: D1/D2 er nu udfyldt, samme form som D3/D4 (ejer-beslutning 7/8: "Alle
// divisioner skal have realisme-bånd") — inkl. de nye finale-gulve fra leverance 2.
test("#3469: TIER_TARGETS matcher hærdnings-pakken for D1/D2", () => {
  assert.equal(TIER_TARGETS[1].summit_min, 12);
  assert.equal(TIER_TARGETS[1].mdown_max_pct, 55);
  assert.equal(TIER_TARGETS[1].itt_min, 1);
  assert.equal(TIER_TARGETS[1].cobbles_min, 1);
  assert.equal(TIER_TARGETS[1].bunch_sprint_min, 15);
  assert.equal(TIER_TARGETS[1].descent_finale_min, 8);
  assert.equal(TIER_TARGETS[1].solo_tt_final_min, 2);

  // D2 opgraderet 7/8 (samme dag, følge-commit) efter de 3 ejer-godkendte katalog-løb
  // landede — se docstringen i raceRouteRealismMetrics.js for målingen bag opgraderingen.
  assert.equal(TIER_TARGETS[2].summit_min, 8);
  assert.equal(TIER_TARGETS[2].mdown_max_pct, 60);
  assert.equal(TIER_TARGETS[2].itt_min, 1);
  assert.equal(TIER_TARGETS[2].cobbles_min, 1);
  assert.equal(TIER_TARGETS[2].bunch_sprint_min, 15);
  // #4272 (26/8): 10 → 5. Ejerens finale-bånd gør 10 matematisk uopnåeligt for D2
  // (23 mountain × 0,35 + 7 high_mountain × 0,15 = 9,1 < 10), så gulvet deadlockede
  // re-drawet — 20 af 400 sæsoner udtømte alle 12 forsøg. Se docstringen i
  // raceRouteRealismMetrics.js for udledningen og målingen.
  assert.equal(TIER_TARGETS[2].descent_finale_min, 5);
  assert.equal(TIER_TARGETS[2].solo_tt_final_min, 1);
});

// #4272: gulvene for nedkørsels-finaler skal ligge UNDER det ejerens bånd kan levere,
// ellers leder re-drawet efter en fordeling båndet forbyder. Låser den relation, så en
// fremtidig hævning af et gulv ikke gen-introducerer deadlocken.
test("#4272: descent_finale_min er opnåeligt inden for finale-båndene i alle divisioner", () => {
  // Målt på S3-planen (scripts/dev/calendarScorecard4218.mjs): faktiske nedkørsels-finaler
  // pr. division. Gulvet skal have margin ned til dette, ikke ligge over det.
  const måltPåS3 = { 1: 10, 2: 7, 3: 4, 4: 3 };
  for (const tier of [1, 2, 3, 4]) {
    assert.ok(
      TIER_TARGETS[tier].descent_finale_min <= måltPåS3[tier],
      `tier ${tier}: gulv ${TIER_TARGETS[tier].descent_finale_min} > målt ${måltPåS3[tier]} — re-drawet vil lede efter noget båndet forbyder (#4272)`
    );
  }
});

// #3469: alle 4 divisioner er nu realisme-gatede — ingen tier er længere bevidst
// u-gatet ("advisory"). Erstatter den tidligere antagelse om at D1/D2 var advisory.
test("#3469: alle divisioner er nu gated — ingen advisory-tier tilbage", () => {
  assert.equal(tierGateState(1), "gated");
  assert.equal(tierGateState(2), "gated");
  assert.equal(tierGateState(3), "gated");
  assert.equal(tierGateState(4), "gated");
});

// D2's tidligere observerede skred (summit 4, M-Down 53 %) — under de GAMLE u-gatede
// D2-bånd (før #3469) passerede dette stiltiende. Under de NYE (og siden OPGRADEREDE,
// samme dag) bånd (summit_min 8) skal det fanges som et rødt båndbrud.
test("#3469: D2's tidligere skred (summit 4, M-Down 53%) fanges som rødt under de nye bånd", () => {
  const skredRaces = [
    // 4 summit-finaler + 4 andre bjerg-etaper, hvoraf 53% (afrundet) ender i nedkørsel.
    stageRace(
      Array.from({ length: 4 }, () => st("high_mountain", "long_climb", 170))
        .concat(Array.from({ length: 5 }, () => st("mountain", "descent", 170))),
    ),
    oneDay("itt", "solo_tt"),
    stageRace([st("flat", "bunch_sprint"), { ...st("cobbles", "reduced_sprint", 160), sectors: [{ kind: "cobbles", start_km: 80, length_km: 2 }] }]),
  ];
  const s = scoreTier(2, skredRaces);
  assert.equal(s.summit_finishes, 4);
  assert.equal(s.mdown_pct, 56); // 5/9 ≈ 56% — under det (opgraderede) 60%-loft
  assert.equal(s.pass, false, "summit_min=8 skal fælde skredet, selvom M-Down er inden for det opgraderede 60%-loft");
  assert.ok(s.failures.some((f) => f.includes("summit 4 < 8")), s.failures.join(" · "));
});

// ── scoreSeason: GO kræver at HVER gatet delscore kørte og bestod (#2854) ────

test("scoreSeason: alt grønt → GO + exit 0", () => {
  const summary = scoreSeason([
    { tier: 1, races: [...passingTier1Races(), { ...stageRace(grandTourStages({ hc: 4 })), name: "Tour de l'Hexagone" }] },
    { tier: 3, races: passingTier3Races() },
  ]);
  assert.equal(summary.verdict, VERDICT.GO);
  assert.equal(summary.exitCode, 0);
  assert.equal(summary.gatedTiersEvaluated, 2);
  assert.equal(summary.grandToursEvaluated, 1);
  assert.deepEqual(summary.failures, []);
  assert.deepEqual(summary.unassessed, []);
});

test("scoreSeason: et tier-båndbrud giver stadig NO-GO", () => {
  const summary = scoreSeason([{ tier: 3, races: [stageRace([st("flat", "bunch_sprint")])] }]);
  assert.equal(summary.verdict, VERDICT.NO_GO);
  assert.equal(summary.exitCode, 1);
  assert.ok(summary.failures.some((f) => f.includes("summit")));
});

test("scoreSeason: tom kalender giver UKENDT — ikke GO", () => {
  const empty = scoreSeason([]);
  assert.equal(empty.verdict, VERDICT.UNKNOWN);
  assert.equal(empty.exitCode, 2);

  const noRaces = scoreSeason([{ tier: 3, races: [] }]);
  assert.equal(noRaces.verdict, VERDICT.UNKNOWN);
  assert.equal(noRaces.exitCode, 2);
  assert.ok(noRaces.unassessed.some((u) => u.includes("0 løb")));
  assert.deepEqual(noRaces.failures, [], "0 løb er fravær af evidens, ikke et båndbrud");
});

// #3469: FØR hærdnings-pakken var D1/D2 bevidst u-gatede ("advisory"), så en sæson med
// KUN en u-gatet tier målte reelt intet. Efter #3469 er der ingen "advisory"-tier
// tilbage (se testen ovenfor) — scenariet kan nu kun opstå via en helt UKENDT tier
// (ikke i TIER_TARGETS overhovedet).
test("scoreSeason: kun ukendte tiers målte reelt intet → UKENDT", () => {
  const summary = scoreSeason([{ tier: 9, races: [stageRace([st("flat", "bunch_sprint")])] }]);
  assert.equal(summary.verdict, VERDICT.UNKNOWN);
  assert.ok(summary.unassessed.some((u) => u.includes("ingen gatet tier")));
  assert.equal(summary.tiers[0].gateState, "undefined", "tier 9 er ikke defineret i TIER_TARGETS overhovedet");
});

test("scoreSeason: en tier uden mål i TIER_TARGETS er ikke tavst grøn", () => {
  const summary = scoreSeason([
    { tier: 3, races: passingTier3Races() },
    { tier: 9, races: [stageRace([st("flat", "bunch_sprint")])] },
  ]);
  assert.equal(summary.verdict, VERDICT.UNKNOWN);
  assert.equal(summary.exitCode, 2);
  assert.ok(summary.unassessed.some((u) => u.includes("tier 9")));
});

test("scoreSeason: en GT-arketype med for få etaper rapporteres, ikke sprunget over", () => {
  const summary = scoreSeason([
    { tier: 3, races: passingTier3Races() },
    { tier: 1, races: [...passingTier1Races(), { ...stageRace(grandTourStages({ stageCount: 18 })), name: "Vuelta Ibérica", terrain_archetype: "grand_tour" }] },
  ]);
  assert.equal(summary.verdict, VERDICT.UNKNOWN);
  assert.equal(summary.grandToursEvaluated, 0);
  assert.ok(summary.unassessed.some((u) => u.includes("Vuelta Ibérica") && u.includes("18 etaper")));
});

test("scoreSeason: generator-fejl bogføres som ikke-vurderet, ikke som båndbrud", () => {
  const summary = scoreSeason([{ tier: 3, races: passingTier3Races(), errors: ["profil-generering fejlede for «X»: boom"] }]);
  assert.equal(summary.verdict, VERDICT.UNKNOWN);
  assert.equal(summary.exitCode, 2);
  assert.deepEqual(summary.failures, []);
  assert.ok(summary.unassessed.some((u) => u.includes("boom")));
});

test("scoreSeason: et konkret båndbrud vinder over UKENDT (exit 1)", () => {
  const summary = scoreSeason([
    { tier: 3, races: [stageRace([st("flat", "bunch_sprint")])] },
    { tier: 4, races: [] },
  ]);
  assert.equal(summary.verdict, VERDICT.NO_GO);
  assert.equal(summary.exitCode, 1);
  assert.ok(summary.failures.length > 0 && summary.unassessed.length > 0, "begge lister rapporteres");
});

test("scoreSeason: distance-outliers er advisory og fælder ikke gaten", () => {
  const races = passingTier3Races();
  races.push(oneDay("flat", "bunch_sprint"));
  races[races.length - 1].stages[0].distance_km = 260; // udenfor flat-båndet [150,200]
  const summary = scoreSeason([{ tier: 3, races }]);
  assert.equal(summary.verdict, VERDICT.GO);
  assert.ok(summary.advisories.some((a) => a.includes("WT-distancebåndet")));
});
