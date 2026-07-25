// backend/lib/raceRouteRealismMetrics.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreTier, scoreSeason, TIER_TARGETS, VERDICT } from "./raceRouteRealismMetrics.js";

const st = (profile_type, finale_type, distance_km = 160) => ({ profile_type, finale_type, distance_km, sectors: [] });
const stageRace = (stages) => ({ race_type: "stage_race", stages });
const oneDay = (profile_type, finale_type) => ({ race_type: "single", stages: [st(profile_type, finale_type)] });

// ── Fixtures til sæson-aggregatet (scoreSeason) ─────────────────────────────
// En tier-3-pulje der opfylder ALLE #2755-mål (summit ≥ 8, M-Down ≤ 55%, 1 ITT, 1 brosten).
function passingTier3Races() {
  return [
    stageRace(Array.from({ length: 8 }, () => st("high_mountain", "long_climb", 170))),
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
    { tier: 1, races: [{ ...stageRace(grandTourStages({ hc: 1 })), name: "Tour de l'Hexagone" }] },
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

// ── scoreSeason: GO kræver at HVER gatet delscore kørte og bestod (#2854) ────

test("scoreSeason: alt grønt → GO + exit 0", () => {
  const summary = scoreSeason([
    { tier: 1, races: [{ ...stageRace(grandTourStages({ hc: 4 })), name: "Tour de l'Hexagone" }] },
    { tier: 3, races: passingTier3Races() },
  ]);
  assert.equal(summary.verdict, VERDICT.GO);
  assert.equal(summary.exitCode, 0);
  assert.equal(summary.gatedTiersEvaluated, 1);
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

test("scoreSeason: kun u-gatede tiers målte reelt intet → UKENDT", () => {
  const summary = scoreSeason([{ tier: 1, races: [{ ...stageRace(grandTourStages()), name: "GT" }] }]);
  assert.equal(summary.verdict, VERDICT.UNKNOWN);
  assert.ok(summary.unassessed.some((u) => u.includes("ingen gatet tier")));
  assert.equal(summary.tiers[0].gateState, "advisory", "tier 1 er bevidst u-gatet, ikke grøn");
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
    { tier: 1, races: [{ ...stageRace(grandTourStages({ stageCount: 18 })), name: "Vuelta Ibérica", terrain_archetype: "grand_tour" }] },
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
