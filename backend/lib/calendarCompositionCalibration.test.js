import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NEUTRAL_TILT, MIN_WEIGHT, tiltFiller, applyCompositionTilt, fillersEqual,
  compositionDistance, worstDeviation, searchTilt,
} from "./calendarCompositionCalibration.js";
import { ARCHETYPE_PROFILES } from "./raceStageProfileGenerator.js";
import { resolveSeasonDraw } from "./raceRouteRealismDraw.js";
import { scoreSeason } from "./raceRouteRealismMetrics.js";
import {
  ACTIVE_TARGET, COMPOSITION_CATEGORIES, COMPOSITION_TOLERANCE_PP,
  computeCompositionStats, aggregateCompositionStats,
} from "./calendarCompositionTargets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "seasonTierCalendarSnapshot.json"), "utf8"));
const tierSeedRaces = SNAPSHOT.tiers.map((t) => ({
  tier: t.tier,
  seedRaces: t.races.map((r) => ({ ...r, id: r.external_id, season_id: SNAPSHOT.seasonId })),
}));

test("NEUTRAL_TILT er en no-op — en kalibrering der ikke ændrer noget må ikke ændre nogen kalender", () => {
  const out = applyCompositionTilt({ tilt: NEUTRAL_TILT });
  assert.ok(fillersEqual(out, ARCHETYPE_PROFILES));
});

test("applyCompositionTilt muterer ALDRIG input-tabellen", () => {
  const before = JSON.stringify(ARCHETYPE_PROFILES);
  applyCompositionTilt({ tilt: { flat: 0.5, hilly: 2, mountain: 0.1, itt: 3, cobbles: 1, ttt: 1 } });
  assert.equal(JSON.stringify(ARCHETYPE_PROFILES), before);
});

test("tiltFiller skalerer pr. kompositions-kategori, ikke pr. profil-type", () => {
  // rolling OG hilly er begge "kuperet" — de skal skaleres med samme faktor.
  const out = tiltFiller([
    { value: "flat", weight: 30 }, { value: "rolling", weight: 20 }, { value: "hilly", weight: 10 },
    { value: "mountain", weight: 20 }, { value: "itt", weight: 10 },
  ], { flat: 0.5, hilly: 2, mountain: 1, itt: 1, cobbles: 1, ttt: 1 });
  assert.deepEqual(out, [
    { value: "flat", weight: 15 }, { value: "rolling", weight: 40 }, { value: "hilly", weight: 20 },
    { value: "mountain", weight: 20 }, { value: "itt", weight: 10 },
  ]);
});

test("tiltFiller kan aldrig nulstille et terræn helt (MIN_WEIGHT-gulv)", () => {
  // At fjerne et terræn fra en arketype er en STRUKTUREL ændring (guarantees-territorium),
  // ikke noget en vægt-justering må gøre i det skjulte.
  const out = tiltFiller([{ value: "mountain", weight: 4 }], { ...NEUTRAL_TILT, mountain: 0.01 });
  assert.equal(out[0].weight, MIN_WEIGHT);
});

test("applyCompositionTilt rører ALDRIG endagsløb eller guarantees", () => {
  const out = applyCompositionTilt({ tilt: { flat: 0.1, hilly: 5, mountain: 0.1, itt: 5, cobbles: 5, ttt: 1 } });
  for (const [name, cfg] of Object.entries(ARCHETYPE_PROFILES)) {
    if (cfg.kind === "single") {
      assert.deepEqual(out[name], cfg, `endagsløbs-arketypen ${name} skal stå uændret`);
    } else {
      assert.deepEqual(out[name].guarantees, cfg.guarantees, `${name}'s guarantees må ikke røres`);
    }
  }
});

test("skipArchetypes holder en arketype helt udenfor", () => {
  const out = applyCompositionTilt({ tilt: { ...NEUTRAL_TILT, mountain: 0.5 }, skipArchetypes: ["grand_tour"] });
  assert.deepEqual(out.grand_tour, ARCHETYPE_PROFILES.grand_tour);
  assert.notDeepEqual(out.mountain_tour.filler, ARCHETYPE_PROFILES.mountain_tour.filler);
});

test("compositionDistance er L1 i procentpoint; worstDeviation finder den værste kategori", () => {
  const pct = { flat: 27, hilly: 29, mountain: 33 };
  const target = { flat: 24, hilly: 32, mountain: 28 };
  assert.equal(compositionDistance(pct, target), 3 + 3 + 5);
  assert.deepEqual(worstDeviation(pct, target), { worst: 5, category: "mountain" });
});

test("searchTilt er deterministisk og forbedrer scoren monotont", () => {
  // Syntetisk respons med et kendt optimum ved mountain=0.5 — verificerer at søgningen
  // faktisk finder nedad og at to kørsler giver præcis samme svar (ingen RNG).
  const evaluate = (t) => ({ score: Math.abs(t.mountain - 0.5) + Math.abs(t.flat - 1) });
  const a = searchTilt({ evaluate, axes: ["flat", "mountain"] });
  const b = searchTilt({ evaluate, axes: ["flat", "mountain"] });
  assert.deepEqual(a.tilt, b.tilt, "samme input → samme anbefaling");
  assert.ok(a.score < evaluate(NEUTRAL_TILT).score, "søgningen skal forbedre startpunktet");
  assert.ok(a.tilt.mountain < 1, `forventede mountain < 1, fik ${a.tilt.mountain}`);
});

test("searchTilt holder sig inden for [0.1, 10] — uden for er det en strukturel ændring", () => {
  const evaluate = (t) => ({ score: t.mountain }); // monotont faldende → presser mod nul
  const { tilt } = searchTilt({ evaluate, axes: ["mountain"], rounds: 6 });
  assert.ok(tilt.mountain >= 0.1, `tilt må ikke gå under 0.1, fik ${tilt.mountain}`);
});

test("searchTilt kræver en evaluate-funktion", () => {
  assert.throws(() => searchTilt({}), /evaluate/); // engelsk besked (i18n-guard)
});

// ── REGRESSIONSVAGT for #3295-kalibreringen ─────────────────────────────────
// Det er DENNE test der gør kalibreringen holdbar. Vægtene i ARCHETYPE_PROFILES blev
// fundet empirisk (scripts/calibrateCalendarComposition.js); uden en vagt kan de drive
// tilbage ved en velment justering af én arketype, og skævheden ville først blive
// opdaget af en spiller — præcis forløbet i #3326 og #2177.
test("#3295: den nuværende generator rammer K-B-profilen på det ægte kalender-snapshot", () => {
  const draws = resolveSeasonDraw({ tierSeedRaces });
  const season = aggregateCompositionStats(draws.map((d) => computeCompositionStats(d.entry.races)));

  assert.ok(season.raceDays > 300, `forventede et fuldt sæson-snapshot, fik ${season.raceDays} løbsdage`);

  const outOfBand = COMPOSITION_CATEGORIES
    .map((c) => ({ c, delta: (season.pct[c] ?? 0) - (ACTIVE_TARGET[c] ?? 0) }))
    .filter((x) => Math.abs(x.delta) > COMPOSITION_TOLERANCE_PP);

  assert.deepEqual(
    outOfBand.map((x) => `${x.c} ${x.delta.toFixed(1)}pp`), [],
    `kompositionen er drevet uden for ±${COMPOSITION_TOLERANCE_PP} pp. Genkør ` +
    `\`node scripts/calibrateCalendarComposition.js --season 2\` og opdatér vægtene i ` +
    `ARCHETYPE_PROFILES — ret ikke denne test.`
  );

  // Kompositionen må ikke være købt for realisme: begge sæt bånd skal holde samtidigt.
  assert.deepEqual(scoreSeason(draws.map((d) => d.entry)).failures, [],
    "realisme-båndene skal holde med de samme vægte");
});

test("#3295: balanced_week garanterer en enkeltstart (ITT-løftets kilde)", () => {
  // Løftet fra 6,6 % til 11 % ITT kom fra denne garanti, ikke fra en oppustet filler-vægt
  // der ville gøre TT-loftet (#2029) til den reelle begrænsning.
  assert.ok(ARCHETYPE_PROFILES.balanced_week.guarantees.includes("itt"));
});
