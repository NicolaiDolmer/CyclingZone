import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPOSITION_CATEGORIES, KB_TARGET_FULL, KB_TARGET_INTERIM, ACTIVE_TARGET,
  TTT_ENGINE_SUPPORTED, COMPOSITION_TOLERANCE_PP, compositionCategory,
  computeCompositionStats, aggregateCompositionStats, toleranceFor,
  detectCompositionViolations,
} from "./calendarCompositionTargets.js";
import { PROFILE_TYPES } from "./raceStageProfileGenerator.js";

// Byg et løb af profile_types (ét pr. etape).
const race = (...profileTypes) => ({ stages: profileTypes.map((profile_type) => ({ profile_type })) });

test("mål-profilerne summer til 100 %", () => {
  const sum = (t) => Object.values(t).reduce((a, b) => a + b, 0);
  assert.equal(sum(KB_TARGET_FULL), 100, "K-B (fuld) skal summe til 100");
  assert.equal(sum(KB_TARGET_INTERIM), 100, "K-B (interim) skal summe til 100");
});

test("interim-profilen omfordeler PRÆCIS TTT's andel, resten er uændret", () => {
  // Ejerens interim-direktiv: ITT 10 %/TTT 0. De resterende 2 pp lægges på kuperet.
  assert.equal(KB_TARGET_INTERIM.ttt, 0);
  assert.equal(KB_TARGET_INTERIM.itt, 10);
  assert.equal(KB_TARGET_INTERIM.hilly, KB_TARGET_FULL.hilly + 2);
  assert.equal(KB_TARGET_INTERIM.itt - KB_TARGET_FULL.itt + (KB_TARGET_INTERIM.hilly - KB_TARGET_FULL.hilly), KB_TARGET_FULL.ttt);
  for (const cat of ["flat", "mountain", "cobbles"]) {
    assert.equal(KB_TARGET_INTERIM[cat], KB_TARGET_FULL[cat], `${cat} må ikke ændres af TTT-forbeholdet`);
  }
});

test("ACTIVE_TARGET følger TTT_ENGINE_SUPPORTED-flaget", () => {
  assert.deepEqual(ACTIVE_TARGET, TTT_ENGINE_SUPPORTED ? KB_TARGET_FULL : KB_TARGET_INTERIM);
});

test("alle generator-profiltyper har en kompositions-kategori", () => {
  // Regressions-vagt: en ny profile_type i generatoren må ikke lande usynligt i
  // nævneren uden kategori. Fejler denne, skal PROFILE_TO_CATEGORY udvides.
  for (const pt of PROFILE_TYPES) {
    assert.ok(compositionCategory(pt), `profile_type "${pt}" mangler kompositions-kategori`);
  }
  assert.equal(compositionCategory("noget_ukendt"), null);
});

test("compositionCategory grupperer som ejerens #3295-tabel", () => {
  assert.equal(compositionCategory("flat"), "flat");
  for (const pt of ["rolling", "hilly", "classic"]) assert.equal(compositionCategory(pt), "hilly");
  for (const pt of ["mountain", "high_mountain"]) assert.equal(compositionCategory(pt), "mountain");
  assert.equal(compositionCategory("itt"), "itt");
  assert.equal(compositionCategory("cobbles"), "cobbles");
  assert.equal(compositionCategory("ttt"), "ttt");
});

test("computeCompositionStats: endagsløb tæller 1 løbsdag, etapeløb tæller sine etaper", () => {
  const stats = computeCompositionStats([
    race("flat"),                                  // endagsløb → 1 dag
    race("flat", "hilly", "mountain", "itt"),      // 4 dage
  ]);
  assert.equal(stats.raceDays, 5);
  assert.equal(stats.counts.flat, 2);
  assert.equal(stats.counts.hilly, 1);
  assert.equal(stats.counts.mountain, 1);
  assert.equal(stats.counts.itt, 1);
  assert.equal(stats.pct.flat, 40);
});

test("computeCompositionStats: ukendt profil-type tælles i nævneren OG rapporteres", () => {
  const stats = computeCompositionStats([race("flat", "gravel")]);
  assert.equal(stats.raceDays, 2, "ukendt type skal stadig være en løbsdag");
  assert.equal(stats.unknown.gravel, 1);
  assert.equal(stats.pct.flat, 50);
});

test("computeCompositionStats: tomt input giver 0 %, ikke NaN", () => {
  const stats = computeCompositionStats([]);
  assert.equal(stats.raceDays, 0);
  for (const c of COMPOSITION_CATEGORIES) assert.equal(stats.pct[c], 0);
});

test("aggregateCompositionStats vægter tiers efter faktiske løbsdage, ikke ligeligt", () => {
  const big = computeCompositionStats([race(...Array(90).fill("flat"), ...Array(10).fill("mountain"))]); // 100 dage, 90 % flad
  const small = computeCompositionStats([race(...Array(10).fill("mountain"))]);                          // 10 dage, 0 % flad
  const agg = aggregateCompositionStats([big, small]);
  assert.equal(agg.raceDays, 110);
  // Ligevægtning ville give 45 %; korrekt vægtning giver 90/110.
  assert.ok(Math.abs(agg.pct.flat - (100 * 90) / 110) < 1e-9);
});

test("toleranceFor: små tiers får ±2 løbsdage i stedet for ±2 pp", () => {
  assert.equal(toleranceFor(392), COMPOSITION_TOLERANCE_PP, "stor stikprøve → basis-tolerancen");
  assert.ok(toleranceFor(56) > COMPOSITION_TOLERANCE_PP, "tier 4 (56 dage) → 2 dage er mere end 2 pp");
  assert.ok(Math.abs(toleranceFor(56) - (200 / 56)) < 1e-9);
  assert.equal(toleranceFor(0), COMPOSITION_TOLERANCE_PP, "0 dage må ikke give NaN/Infinity");
});

test("detectCompositionViolations: profil på målet giver 0 brud og én række pr. kategori", () => {
  // Byg præcis ACTIVE_TARGET som 100 løbsdage.
  const stages = [];
  for (const [cat, pct] of Object.entries(ACTIVE_TARGET)) {
    const pt = { flat: "flat", hilly: "hilly", mountain: "mountain", itt: "itt", cobbles: "cobbles", ttt: "ttt" }[cat];
    for (let i = 0; i < pct; i++) stages.push(pt);
  }
  const stats = computeCompositionStats([race(...stages)]);
  const { rows, violations } = detectCompositionViolations({ stats });
  assert.equal(stats.raceDays, 100);
  assert.deepEqual(violations, []);
  assert.equal(rows.length, COMPOSITION_CATEGORIES.length, "alle kategorier rapporteres, ikke kun brud");
  assert.ok(rows.every((r) => r.pass));
});

test("detectCompositionViolations: fanger afvigelse i BEGGE retninger", () => {
  // 100 dage: 34 flade (mål 24 → +10) og 20 kuperede (mål 32 → -12).
  const stages = [...Array(34).fill("flat"), ...Array(20).fill("hilly"), ...Array(46).fill("mountain")];
  const stats = computeCompositionStats([race(...stages)]);
  const { rows, violations } = detectCompositionViolations({ stats, target: KB_TARGET_INTERIM, label: "tier 9" });
  const flat = rows.find((r) => r.category === "flat");
  const hilly = rows.find((r) => r.category === "hilly");
  assert.equal(flat.delta, 10);
  assert.equal(hilly.delta, -12);
  assert.ok(!flat.pass && !hilly.pass);
  assert.ok(violations.some((v) => v.includes("tier 9") && v.includes("flad") && v.includes("+10.0 pp")));
  assert.ok(violations.some((v) => v.includes("kuperet") && v.includes("-12.0 pp")));
});

test("detectCompositionViolations: TTT over 0 er et brud mens motoren ikke understøtter det", () => {
  // Interim-målet er TTT 0 — en TTT-etape ud over tolerancen skal ses.
  const stats = computeCompositionStats([race(...Array(95).fill("hilly"), ...Array(5).fill("ttt"))]);
  const { violations } = detectCompositionViolations({ stats, target: KB_TARGET_INTERIM });
  assert.ok(violations.some((v) => v.includes("TTT")), "5 % TTT mod mål 0 % skal give brud");
});

test("detectCompositionViolations: ukendt profil-type bliver et brud, ikke tavshed", () => {
  const stats = computeCompositionStats([race("gravel")]);
  const { violations } = detectCompositionViolations({ stats });
  assert.ok(violations.some((v) => v.includes("gravel") && v.includes("uden kompositions-kategori")));
});

test("detectCompositionViolations: applyMinRaceDayTolerance løsner kun små stikprøver", () => {
  // 56 dage (tier 4-kvoten): 1 ITT = 1,8 %, mål 10 % → -8,2 pp, brud uanset tolerance.
  // Men 4 ITT = 7,1 % → -2,9 pp: brud ved ±2 pp, OK ved ±3,6 pp (2 dage af 56).
  const stages = [...Array(4).fill("itt"), ...Array(52).fill("hilly")];
  const stats = computeCompositionStats([race(...stages)]);
  const strict = detectCompositionViolations({ stats, target: KB_TARGET_INTERIM });
  const scaled = detectCompositionViolations({ stats, target: KB_TARGET_INTERIM, applyMinRaceDayTolerance: true });
  assert.ok(strict.rows.find((r) => r.category === "itt").pass === false);
  assert.ok(scaled.rows.find((r) => r.category === "itt").pass === true);
});

test("detectCompositionViolations: stats=null giver tomt resultat frem for at kaste", () => {
  const { rows, violations } = detectCompositionViolations({ stats: null });
  assert.deepEqual(rows, []);
  assert.deepEqual(violations, []);
});
