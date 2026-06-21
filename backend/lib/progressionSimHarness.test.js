import test from "node:test";
import assert from "node:assert/strict";

import {
  makeSyntheticPopulation,
  simulateProgression,
  scoreAcceptanceCriteria,
  runHarness,
} from "./progressionSimHarness.js";

// ── Synthetic population er deterministisk ──────────────────────────────────────

test("makeSyntheticPopulation er deterministisk for samme seed", () => {
  const a = makeSyntheticPopulation({ count: 120, seed: 2026 });
  const b = makeSyntheticPopulation({ count: 120, seed: 2026 });
  assert.deepEqual(a, b);
});

test("makeSyntheticPopulation dækker hele alders- og potentiale-spændet", () => {
  const pop = makeSyntheticPopulation({ count: 200, seed: 2026 });
  const ages = pop.map((r) => r.age);
  const pots = pop.map((r) => r.potentiale);
  assert.ok(Math.min(...ages) <= 20, "indeholder unge ryttere (<=20)");
  assert.ok(Math.max(...ages) >= 36, "indeholder ryttere i retirement-vinduet (>=36)");
  assert.ok(Math.max(...pots) >= 5, "indeholder høj-potentiale ryttere");
  // Hver rytter har et komplet ability-sæt og en gyldig type
  for (const r of pop) {
    assert.ok(r.id && r.primary_type, "rytter har id + type");
    assert.ok(Number.isFinite(r.abilities.climbing), "rytter har abilities");
  }
});

// ── Simulation kører N sæsoner og bevarer trajektorier ──────────────────────────

test("simulateProgression returnerer per-rytter trajektorie over N sæsoner", () => {
  const pop = makeSyntheticPopulation({ count: 50, seed: 2026 });
  const sim = simulateProgression(pop, { seasons: 3 });
  assert.equal(sim.trajectories.length, pop.length);
  for (const tr of sim.trajectories) {
    // startår + 3 sæsoner = 4 snapshots
    assert.equal(tr.snapshots.length, 4, "snapshot pr. sæson + start");
    // Ryttere ældes 1/sæson; pensionerede fryses (som is_retired-filteret i engine).
    if (!tr.retired) {
      assert.equal(tr.snapshots[0].age + 3, tr.snapshots[3].age, "alder stiger 1/sæson");
    }
  }
});

test("simulateProgression er deterministisk (samme population → identisk resultat)", () => {
  const pop = makeSyntheticPopulation({ count: 40, seed: 7 });
  const a = simulateProgression(pop, { seasons: 4 });
  const b = simulateProgression(pop, { seasons: 4 });
  assert.equal(a.hash, b.hash, "samme run-hash");
  assert.deepEqual(a.trajectories, b.trajectories);
});

test("simulateProgression: re-run hash er IDENTISK = idempotens-bevis (acceptkriterie e)", () => {
  const pop = makeSyntheticPopulation({ count: 100, seed: 2026 });
  const first = simulateProgression(pop, { seasons: 5 }).hash;
  const second = simulateProgression(pop, { seasons: 5 }).hash;
  assert.equal(first, second, "identisk run → identisk hash");
});

// ── Scorecard rammer alle 5 acceptkriterier ─────────────────────────────────────

test("scoreAcceptanceCriteria: ung høj-pot stiger (a), gammel falder (b), retirement (c)", () => {
  const pop = makeSyntheticPopulation({ count: 200, seed: 2026 });
  const sim = simulateProgression(pop, { seasons: 3 });
  const score = scoreAcceptanceCriteria(sim);

  // (a) mindst én ung høj-pot rytter stiger målbart over 3 sæsoner
  assert.ok(score.criteria.a.met, `(a) ung høj-pot rise: ${score.criteria.a.detail}`);
  assert.ok(score.criteria.a.exemplar.signatureGain > 0, "eksemplar har positiv signatur-vækst");

  // (b) mindst én ældre rytter (>peak) falder målbart
  assert.ok(score.criteria.b.met, `(b) ældre decline: ${score.criteria.b.detail}`);
  assert.ok(score.criteria.b.exemplar.signatureDrop > 0, "eksemplar har positivt fald");

  // (c) retirements forekommer i høj-alder
  assert.ok(score.criteria.c.met, `(c) retirement: ${score.criteria.c.detail}`);
  assert.ok(score.criteria.c.totalRetired > 0, "mindst én pensionering");
});

test("scoreAcceptanceCriteria: U25-development-delta er positiv (board #813 / d)", () => {
  const pop = makeSyntheticPopulation({ count: 200, seed: 2026 });
  const sim = simulateProgression(pop, { seasons: 3 });
  const score = scoreAcceptanceCriteria(sim);
  assert.ok(score.criteria.d.met, `(d) U25 dev-delta: ${score.criteria.d.detail}`);
  // Board-målet er >= 8 points/sæson; harness skal vise den er opnåelig
  assert.ok(score.criteria.d.avgU25DeltaPerSeason >= 8, "gnsn. U25-vækst opnår board-tærskel (8)");
});

test("scoreAcceptanceCriteria: idempotens-kriteriet (e) er met når hash matcher", () => {
  const pop = makeSyntheticPopulation({ count: 80, seed: 2026 });
  const sim = simulateProgression(pop, { seasons: 4 });
  const score = scoreAcceptanceCriteria(sim);
  assert.ok(score.criteria.e.met, `(e) idempotens: ${score.criteria.e.detail}`);
});

// ── runHarness er den fulde, runbare pipeline ───────────────────────────────────

test("runHarness producerer en fuld rapport med alle 5 kriterier", () => {
  const report = runHarness({ count: 200, seed: 2026, seasons: 3 });
  assert.ok(report.allMet, "alle 5 kriterier opfyldt");
  for (const key of ["a", "b", "c", "d", "e"]) {
    assert.ok(report.score.criteria[key], `kriterie ${key} er rapporteret`);
  }
  assert.ok(typeof report.summaryText === "string" && report.summaryText.length > 0, "menneskelæsbar opsummering");
  assert.ok(report.hash, "run-hash til idempotens");
});
