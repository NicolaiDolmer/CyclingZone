// EKSPLORATIV probe B (#2353-appendix): top-kompression af terrain-komponenten.
// Invarianter (orkestrator 12/7): (a) deterministisk + percentil-baseret,
// (b) monotont ordens-bevarende, (c) kun i v3-grenen — flag-off bit-identisk
// (dækkes af raceEngineV3FlagOff.test.js), (d) rører ikke parcours/udbrud.
import test from "node:test";
import assert from "node:assert/strict";

import { compressTopTerrain, simulateStage, ABILITY_KEYS } from "./raceSimulator.js";
import { RACE_V3_TUNING } from "./raceRoles.js";

const mapOf = (pairs) => new Map(pairs);

test("τ=1.0 (default) er identitet — SAMME Map-instans returneres (zero-cost no-op)", () => {
  const m = mapOf([["a", 0.5], ["b", 0.7]]);
  assert.equal(compressTopTerrain(m, 1.0), m, "τ=1 skal returnere input-mappen urørt");
  assert.equal(compressTopTerrain(m, 1.5), m, "τ>1 behandles som identitet (aldrig ekspansion)");
  assert.equal(RACE_V3_TUNING.TOP_COMPRESSION_TAU, 1.0, "default-tuning SKAL være 1.0 (ingen effekt før ejer-beslutning)");
});

test("kun scores OVER felt-p90 komprimeres; s ≤ p90 er urørt", () => {
  // 10 værdier: sorteret [0.40..0.49]; p90 = floor(0.9*10)=idx 9 → ... brug 20
  // værdier så p90-indekset (18) efterlader én over. Værdier 0.40..0.59.
  const pairs = Array.from({ length: 20 }, (_, i) => [`r${i}`, 0.40 + i * 0.01]);
  const m = mapOf(pairs);
  const out = compressTopTerrain(m, 0.5);
  // p90 = sorted[floor(0.9*20)=18] = 0.58. Kun r19 (0.59) er over.
  for (let i = 0; i <= 18; i++) {
    assert.equal(out.get(`r${i}`), m.get(`r${i}`), `r${i} (≤ p90) skal være urørt`);
  }
  assert.ok(Math.abs(out.get("r19") - (0.58 + 0.5 * 0.01)) < 1e-12, "r19: p90 + τ·(s−p90)");
});

test("monotont ordens-bevarende for τ > 0 (strengt: ingen nye ties)", () => {
  const pairs = Array.from({ length: 50 }, (_, i) => [`r${String(i).padStart(2, "0")}`, 0.3 + i * 0.007]);
  const m = mapOf(pairs);
  for (const tau of [0.5, 0.65, 0.8]) {
    const out = compressTopTerrain(m, tau);
    const rawOrder = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const outOrder = [...out.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    assert.deepEqual(outOrder, rawOrder, `τ=${tau}: rækkefølgen skal bevares`);
    // Strengt: distinkte input → distinkte output.
    assert.equal(new Set(out.values()).size, out.size, `τ=${tau}: ingen nye ties`);
  }
});

test("deterministisk + gab-kompression: top-gab skaleres med præcis τ", () => {
  const pairs = Array.from({ length: 100 }, (_, i) => [`r${String(i).padStart(3, "0")}`, 0.3 + i * 0.003]);
  const m = mapOf(pairs);
  const a = compressTopTerrain(m, 0.5);
  const b = compressTopTerrain(m, 0.5);
  assert.deepEqual([...a.entries()], [...b.entries()], "deterministisk");
  // Begge topværdier er over p90 (sorted[90]=0.57): gab #1→#2 skaleres med τ.
  const rawGap = m.get("r099") - m.get("r098");
  const compGap = a.get("r099") - a.get("r098");
  assert.ok(Math.abs(compGap - 0.5 * rawGap) < 1e-12, `top-gab skal skaleres med τ: ${compGap} vs ${0.5 * rawGap}`);
});

test("felter < 2 ryttere: urørt (ingen percentil at beregne)", () => {
  const single = mapOf([["a", 0.9]]);
  assert.equal(compressTopTerrain(single, 0.5), single);
  const empty = mapOf([]);
  assert.equal(compressTopTerrain(empty, 0.5), empty);
});

// ── Invariant (d): udbruds-mekanikken kører på RÅT terrain ───────────────────
// τ er env-styret ved module-load, så en direkte integrations-test af τ<1 i
// simulateStage kræver child-proces (det gør probe-sweepen). Her verificeres
// den STRUKTURELLE del: med default τ=1.0 er v3-terrain-komponenten identisk
// med det rå terrain — dvs. wiring-punktet ændrer intet før ejer-beslutning.
function abil(v) {
  const a = {};
  for (const k of ABILITY_KEYS) a[k] = v;
  return a;
}

test("simulateStage v3 med default τ=1.0: terrain-komponenten er det rå terrain (wiring er dormant)", () => {
  const entrants = Array.from({ length: 30 }, (_, i) => ({ rider_id: `r${i}`, abilities: abil(40 + i) }));
  const stage = { profile_type: "mountain", demand_vector: { climbing: 0.7, endurance: 0.3, randomness: 0 } };
  const off = simulateStage({ entrants, stageProfile: stage, seed: 11, v3: false });
  const on = simulateStage({ entrants, stageProfile: stage, seed: 11, v3: true });
  for (const id of entrants.map((e) => e.rider_id)) {
    assert.equal(
      on.ranked.find((r) => r.rider_id === id).components.terrain,
      off.ranked.find((r) => r.rider_id === id).components.terrain,
      `terrain for ${id} skal være uændret ved default τ=1.0`
    );
  }
});
