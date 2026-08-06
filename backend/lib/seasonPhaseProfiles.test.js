import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRaceDateText, computeSeasonSpan, seasonFraction, SEASON_PHASES, phaseOf,
  computeChronologyClumping, computePhaseStats,
} from "./seasonPhaseProfiles.js";

test("parseRaceDateText: enkelt-dato d/m", () => {
  assert.deepEqual(parseRaceDateText("1/2"), { startDoy: 32, endDoy: 32 });
  assert.deepEqual(parseRaceDateText("18/10"), { startDoy: 291, endDoy: 291 });
});

test("parseRaceDateText: interval d/m - d/m", () => {
  assert.deepEqual(parseRaceDateText("9/8 - 11/8"), { startDoy: 221, endDoy: 223 });
  assert.deepEqual(parseRaceDateText("22/8 - 13/9"), { startDoy: 234, endDoy: 256 });
});

test("parseRaceDateText: whitespace-tolerant", () => {
  assert.deepEqual(parseRaceDateText("  1/2  "), { startDoy: 32, endDoy: 32 });
  assert.deepEqual(parseRaceDateText("9/8  -  11/8"), { startDoy: 221, endDoy: 223 });
});

test("parseRaceDateText: tom/manglende/uparselig → null", () => {
  assert.equal(parseRaceDateText(""), null);
  assert.equal(parseRaceDateText("   "), null);
  assert.equal(parseRaceDateText(null), null);
  assert.equal(parseRaceDateText(undefined), null);
  assert.equal(parseRaceDateText("foo"), null);
});

test("parseRaceDateText: ugyldige datoer → null (ingen skudår, ingen dag 32)", () => {
  assert.equal(parseRaceDateText("29/2"), null); // ikke-skudår: februar har 28 dage
  assert.equal(parseRaceDateText("32/1"), null); // januar har 31 dage
  assert.equal(parseRaceDateText("0/1"), null);
  assert.equal(parseRaceDateText("1/13"), null); // måned 13 findes ikke
});

test("computeSeasonSpan: min/maks startDoy over parsebare rækker, ignorerer resten", () => {
  const rows = [
    { date_text: "20/1" }, // doy 20
    { date_text: "19/10" }, // doy 292
    { date_text: "foo" }, // ignoreres
    { date_text: null }, // ignoreres
    { date_text: "15/6" }, // doy 166, ikke ekstremum
  ];
  assert.deepEqual(computeSeasonSpan(rows), { minDoy: 20, maxDoy: 292 });
});

test("computeSeasonSpan: intet parsebart → {0,0}", () => {
  assert.deepEqual(computeSeasonSpan([]), { minDoy: 0, maxDoy: 0 });
  assert.deepEqual(computeSeasonSpan([{ date_text: "foo" }, { date_text: "" }]), { minDoy: 0, maxDoy: 0 });
});

test("seasonFraction: normaliserer + clamper til 0..1", () => {
  const span = { minDoy: 20, maxDoy: 220 };
  assert.equal(seasonFraction(20, span), 0);
  assert.equal(seasonFraction(220, span), 1);
  assert.equal(seasonFraction(120, span), 0.5);
  assert.equal(seasonFraction(0, span), 0); // før min → clamp 0
  assert.equal(seasonFraction(400, span), 1); // efter maks → clamp 1
});

test("seasonFraction: span på 0 (eller ugyldigt) → 0,5", () => {
  assert.equal(seasonFraction(100, { minDoy: 100, maxDoy: 100 }), 0.5);
  assert.equal(seasonFraction(100, {}), 0.5);
  assert.equal(seasonFraction(NaN, { minDoy: 20, maxDoy: 220 }), 0.5);
});

test("SEASON_PHASES: dækker 0..1 sammenhængende, summer korrekt, frosset", () => {
  assert.equal(SEASON_PHASES.length, 6);
  assert.equal(SEASON_PHASES[0].min, 0);
  assert.equal(SEASON_PHASES[SEASON_PHASES.length - 1].max, 1.0);
  for (let i = 1; i < SEASON_PHASES.length; i++) {
    assert.equal(SEASON_PHASES[i].min, SEASON_PHASES[i - 1].max, `bånd ${i} støder ikke op til bånd ${i - 1}`);
  }
  assert.ok(Object.isFrozen(SEASON_PHASES));
  assert.ok(Object.isFrozen(SEASON_PHASES[0]));
});

test("phaseOf: finder korrekt bånd inkl. grænseværdier", () => {
  assert.equal(phaseOf(0).name, "Season Opening");
  assert.equal(phaseOf(0.1).name, "Season Opening");
  assert.equal(phaseOf(0.15).name, "Classics Block"); // øvre grænse eksklusiv i forrige bånd
  assert.equal(phaseOf(0.37).name, "First GT Block");
  assert.equal(phaseOf(0.54).name, "High Summer");
  assert.equal(phaseOf(0.71).name, "Second GT/Late Summer");
  assert.equal(phaseOf(0.93).name, "Autumn Finale");
  assert.equal(phaseOf(1.0).name, "Autumn Finale"); // sidste bånd lukket i begge ender
  assert.equal(phaseOf(-1).name, "Season Opening"); // clampes
  assert.equal(phaseOf(2).name, "Autumn Finale"); // clampes
});

test("phaseOf: ikke-tal → null", () => {
  assert.equal(phaseOf(NaN), null);
  assert.equal(phaseOf(undefined), null);
});

test("phaseOf: verificeret mod #3469-katalogets ægte GT-fraktioner", () => {
  // Giro della Penisola 8/5 (doy 128), Tour de l'Hexagone 4/7 (doy 185), Vuelta Ibérica
  // 22/8 (doy 234) — over det målte katalog-spænd [20,292].
  const span = { minDoy: 20, maxDoy: 292 };
  assert.equal(phaseOf(seasonFraction(128, span)).name, "First GT Block");
  assert.equal(phaseOf(seasonFraction(185, span)).name, "High Summer");
  assert.equal(phaseOf(seasonFraction(234, span)).name, "Second GT/Late Summer");
});

// ── computeChronologyClumping ──────────────────────────────────────────────────────
function placementAt(id, race_class, real_day, lane) {
  return { id, race_class, stagesPlaced: [{ stage_number: 1, real_day, game_day: real_day, lane }] };
}

test("computeChronologyClumping: alle dage i ét lille vindue → windowShare 1", () => {
  const placements = [
    placementAt("a", "cobbled_classic", 0, 0),
    placementAt("b", "cobbled_classic", 1, 0),
    placementAt("c", "cobbled_classic", 2, 0),
    placementAt("d", "flat", 10, 0), // anden arketype, ignoreres
  ];
  const r = computeChronologyClumping({ placements, archetypes: ["cobbled_classic"], totalSlots: 28, density: 1, windowFraction: 0.25 });
  assert.equal(r.matchedDays, 3);
  assert.equal(r.windowShare, 1); // vindue = round(28*0.25)=7 slots, 0-2 er inden for 7
});

test("computeChronologyClumping: jævnt spredt over hele tidslinjen → lav windowShare", () => {
  const placements = Array.from({ length: 8 }, (_, i) => placementAt(`x${i}`, "cobbled_classic", i * 4, 0)); // 0,4,8,...,28
  const r = computeChronologyClumping({ placements, archetypes: ["cobbled_classic"], totalSlots: 32, density: 1, windowFraction: 0.25 });
  assert.ok(r.windowShare < 0.6, `forventede lav klumpning, fik ${r.windowShare}`);
});

test("computeChronologyClumping: intet match → windowShare 0", () => {
  const r = computeChronologyClumping({ placements: [placementAt("a", "flat", 0, 0)], archetypes: ["cobbled_classic"], totalSlots: 28 });
  assert.equal(r.matchedDays, 0);
  assert.equal(r.windowShare, 0);
});

// ── computePhaseStats ──────────────────────────────────────────────────────────────
test("computePhaseStats: fordeler løbsdage pr. fase + arketype via fractionByRaceId", () => {
  const placements = [
    { id: "opener", race_class: "ProSeries", stagesPlaced: [{ stage_number: 1, real_day: 0, game_day: 0, lane: 0 }] },
    { id: "gt", race_class: "GiroVuelta", stagesPlaced: [
      { stage_number: 1, real_day: 10, game_day: 10, lane: 0 },
      { stage_number: 2, real_day: 11, game_day: 11, lane: 0 },
    ] },
    { id: "unknown", race_class: "Class1", stagesPlaced: [{ stage_number: 1, real_day: 5, game_day: 5, lane: 0 }] },
  ];
  const fractionByRaceId = new Map([["opener", 0.05], ["gt", 0.45]]); // "unknown" mangler bevidst
  const stats = computePhaseStats({ placements, fractionByRaceId, totalSlots: 28, density: 1 });

  assert.equal(stats.unknownFraction, 1); // "unknown"s 1 løbsdag
  const opening = stats.phases.find((p) => p.name === "Season Opening");
  const gtBlock = stats.phases.find((p) => p.name === "First GT Block");
  assert.equal(opening.raceDays, 1);
  assert.deepEqual(opening.byArchetype, { ProSeries: 1 });
  assert.equal(gtBlock.raceDays, 2);
  assert.deepEqual(gtBlock.byArchetype, { GiroVuelta: 2 });
  assert.equal(stats.clumping, null); // ingen clumpArchetypes bedt om
});

test("computePhaseStats: clumpArchetypes udløser klumpnings-metrik", () => {
  const placements = [
    { id: "a", race_class: "cobbled_classic", stagesPlaced: [{ stage_number: 1, real_day: 0, game_day: 0, lane: 0 }] },
    { id: "b", race_class: "cobbled_classic", stagesPlaced: [{ stage_number: 1, real_day: 1, game_day: 1, lane: 0 }] },
  ];
  const fractionByRaceId = new Map([["a", 0.2], ["b", 0.21]]);
  const stats = computePhaseStats({ placements, fractionByRaceId, totalSlots: 28, density: 1, clumpArchetypes: ["cobbled_classic"] });
  assert.ok(stats.clumping);
  assert.equal(stats.clumping.matchedDays, 2);
  assert.equal(stats.clumping.windowShare, 1);
});

test("computePhaseStats: tomt input → alle faser 0, ingen crash", () => {
  const stats = computePhaseStats({});
  assert.equal(stats.phases.length, 6);
  assert.ok(stats.phases.every((p) => p.raceDays === 0));
  assert.equal(stats.unknownFraction, 0);
});
