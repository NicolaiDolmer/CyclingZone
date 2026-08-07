import test from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "./fictionalRiderGenerator.js";
import {
  ARCHETYPE_TYPES,
  TARGET_CALENDAR_PROFILE_KB,
  DEMAND_MAP,
  computeCalendarDemand,
  computeArchetypeDistribution,
  DEFAULT_DISTRIBUTION,
  FLOOR_PCT,
  drawArchetype,
  drawArchetypePair,
  HYBRID_PROBABILITY,
} from "./archetypeDistribution.js";

// Design-spec arbejdstal (docs/superpowers/specs/2026-08-06-ryttertype-fundament-
// v2-design.md §2, tabellen under "Arbejdstal"). Formlen er sandheden — disse er
// kun en ±1-2pp-tolerance-check, ikke selve kontrakten.
const SPEC_WORKING_NUMBERS = {
  climber: 16, rouleur: 16, sprinter: 14, puncheur: 13,
  baroudeur: 12, brostensrytter: 10, gc: 9, tt: 10,
};

test("computeArchetypeDistribution: summer til nøjagtigt 100", () => {
  const dist = computeArchetypeDistribution();
  const sum = ARCHETYPE_TYPES.reduce((s, t) => s + dist[t], 0);
  assert.ok(Math.abs(sum - 100) < 1e-6, `sum ${sum} != 100`);
});

test("computeArchetypeDistribution: gulvet respekteres (ingen type under FLOOR_PCT)", () => {
  const dist = computeArchetypeDistribution();
  for (const t of ARCHETYPE_TYPES) {
    assert.ok(dist[t] >= FLOOR_PCT - 1e-6, `${t}=${dist[t]} under gulvet ${FLOOR_PCT}`);
  }
});

test("computeArchetypeDistribution: matcher spec'ens arbejdstal inden for ±2pp", () => {
  const dist = computeArchetypeDistribution();
  for (const [type, target] of Object.entries(SPEC_WORKING_NUMBERS)) {
    const diff = Math.abs(dist[type] - target);
    assert.ok(diff <= 2, `${type}: ${dist[type]} afviger ${diff.toFixed(2)}pp fra arbejdstal ${target} (>2pp)`);
  }
});

test("computeCalendarDemand: K-B-kalenderen (summer til 100) giver rå efterspørgsel der summer til 100", () => {
  const demand = computeCalendarDemand();
  const sum = ARCHETYPE_TYPES.reduce((s, t) => s + demand[t], 0);
  assert.ok(Math.abs(sum - 100) < 1e-6, `sum ${sum} != 100`);
});

test("TARGET_CALENDAR_PROFILE_KB summer til 100 (#3295 K-B gameplay-justeret)", () => {
  const sum = Object.values(TARGET_CALENDAR_PROFILE_KB).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100);
});

test("DEMAND_MAP: hver kategoris andele summer til 1 (ingen efterspørgsel forsvinder/opfindes)", () => {
  for (const [category, shares] of Object.entries(DEMAND_MAP)) {
    const sum = Object.values(shares).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${category}: andele summer til ${sum}, ikke 1`);
  }
});

test("kalender-drift: en ændret K-B-profil giver en ny fordeling AFLEDT af formlen (ikke en fastfrosset tabel)", () => {
  const bumpedFlad = { ...TARGET_CALENDAR_PROFILE_KB, flad: TARGET_CALENDAR_PROFILE_KB.flad + 10, kuperet: TARGET_CALENDAR_PROFILE_KB.kuperet - 10 };
  const dist = computeArchetypeDistribution({ calendarProfile: bumpedFlad });
  const base = DEFAULT_DISTRIBUTION;
  assert.ok(dist.sprinter > base.sprinter, "flere flade dage skal løfte sprinter-andelen");
  const sum = ARCHETYPE_TYPES.reduce((s, t) => s + dist[t], 0);
  assert.ok(Math.abs(sum - 100) < 1e-6, `sum ${sum} != 100 efter kalender-justering`);
});

test("drawArchetype: deterministisk (samme seed → samme træk) + konsumerer præcis 1 rng()-kald", () => {
  let calls = 0;
  const baseRng = makeRng(42);
  const countingRng = () => { calls++; return baseRng(); };
  const a = drawArchetype(makeRng(42));
  const b = drawArchetype(makeRng(42));
  assert.equal(a, b);
  drawArchetype(countingRng);
  assert.equal(calls, 1);
});

test("drawArchetype: langsigtet fordeling konvergerer mod DEFAULT_DISTRIBUTION", () => {
  const rng = makeRng(2026);
  const counts = Object.fromEntries(ARCHETYPE_TYPES.map((t) => [t, 0]));
  const N = 50000;
  for (let i = 0; i < N; i++) counts[drawArchetype(rng)]++;
  for (const t of ARCHETYPE_TYPES) {
    const pct = (counts[t] / N) * 100;
    assert.ok(Math.abs(pct - DEFAULT_DISTRIBUTION[t]) <= 1.5, `${t}: målt ${pct.toFixed(2)}% vs mål ${DEFAULT_DISTRIBUTION[t]}%`);
  }
});

test("drawArchetypePair: hybrid-rate konvergerer mod HYBRID_PROBABILITY (~15%)", () => {
  const rng = makeRng(7);
  let hybridCount = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const draw = drawArchetypePair(rng);
    if (draw.isHybrid) {
      hybridCount++;
      assert.notEqual(draw.secondary, draw.primary, "hybrid-sekundær må ikke være samme som primær");
      assert.ok(ARCHETYPE_TYPES.includes(draw.secondary));
    } else {
      assert.equal(draw.secondary, null);
    }
    assert.ok(ARCHETYPE_TYPES.includes(draw.primary));
  }
  const pct = (hybridCount / N) * 100;
  assert.ok(Math.abs(pct - HYBRID_PROBABILITY * 100) <= 1.5, `hybrid-rate ${pct.toFixed(2)}% vs mål ${HYBRID_PROBABILITY * 100}%`);
});

test("drawArchetypePair: determinisme (samme seed → samme sekvens af træk)", () => {
  const a = [], b = [];
  const rngA = makeRng(123);
  const rngB = makeRng(123);
  for (let i = 0; i < 100; i++) { a.push(drawArchetypePair(rngA)); b.push(drawArchetypePair(rngB)); }
  assert.deepEqual(a, b);
});
