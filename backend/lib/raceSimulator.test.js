import { test } from "node:test";
import assert from "node:assert/strict";

import {
  simulateStage,
  terrainScore,
  stableSeed,
  ABILITY_KEYS,
  ENGINE_VERSION,
} from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────
// Ryttere bygges fra et neutralt 50-grundlag + overrides, så hver fixture har
// alle 10 abilities. Golden-tests bruger arketyper, ikke live-data (populationen
// findes ikke endnu — #677/#669).
function rider(id, overrides = {}) {
  const abilities = {};
  for (const k of ABILITY_KEYS) abilities[k] = 50;
  Object.assign(abilities, overrides);
  return { rider_id: id, team_id: `team-${id}`, abilities };
}

const ELITE_SPRINTER = rider("sprinter", {
  sprint: 95, acceleration: 92, positioning: 88, endurance: 60, climbing: 28, recovery: 55,
});
const PURE_CLIMBER = rider("climber", {
  climbing: 95, endurance: 90, recovery: 82, punch: 70, sprint: 24, acceleration: 32, positioning: 45,
});

const FLAT = { profile_type: "flat", demand_vector: DEMAND_VECTORS.flat };
const MOUNTAIN = { profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain };

function winnerOf(entrants, stageProfile, seed) {
  return simulateStage({ entrants, stageProfile, seed }).ranked[0].rider_id;
}
function rankOf(ranked, id) {
  return ranked.find((r) => r.rider_id === id).rank;
}

// ── Kontrakt / sundhed ────────────────────────────────────────────────────────
test("ENGINE_VERSION + ABILITY_KEYS = de 10 forventede", () => {
  assert.equal(ENGINE_VERSION, 1);
  assert.equal(ABILITY_KEYS.length, 10);
  assert.deepEqual([...ABILITY_KEYS].sort(), [
    "acceleration", "climbing", "cobblestone", "endurance", "positioning",
    "punch", "recovery", "sprint", "tactics", "time_trial",
  ]);
});

test("ranked: længde = entrants, ranks 1..N unikke, vinder har gap 0", () => {
  const entrants = [ELITE_SPRINTER, PURE_CLIMBER, rider("avg1"), rider("avg2")];
  const { ranked } = simulateStage({ entrants, stageProfile: FLAT, seed: 42 });
  assert.equal(ranked.length, 4);
  assert.deepEqual([...new Set(ranked.map((r) => r.rank))].sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.equal(ranked[0].stageGap, 0);
});

test("gaps er ≥0 og ikke-aftagende efter rang", () => {
  const entrants = Array.from({ length: 12 }, (_, i) =>
    rider(`r${i}`, { climbing: 30 + i * 5, endurance: 30 + i * 4 })
  );
  const { ranked } = simulateStage({ entrants, stageProfile: MOUNTAIN, seed: 7 });
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i].stageGap >= ranked[i - 1].stageGap, `gap faldt ved rank ${i + 1}`);
    assert.ok(ranked[i].stageGap >= 0);
  }
});

test("finalScore = summen af komponenterne (forklarlighed)", () => {
  const { ranked } = simulateStage({ entrants: [ELITE_SPRINTER, PURE_CLIMBER], stageProfile: MOUNTAIN, seed: 99 });
  for (const r of ranked) {
    const c = r.components;
    const sum = c.terrain + c.noise + c.form - c.fatigue + c.team;
    assert.ok(Math.abs(sum - r.finalScore) < 1e-12, "finalScore matcher ikke komponenter");
  }
});

test("seams returnerer neutralt i v1 (form/fatigue/team = 0)", () => {
  const { ranked } = simulateStage({ entrants: [ELITE_SPRINTER], stageProfile: FLAT, seed: 1 });
  const c = ranked[0].components;
  assert.equal(c.form, 0);
  assert.equal(c.fatigue, 0);
  assert.equal(c.team, 0);
});

// ── Determinisme ──────────────────────────────────────────────────────────────
test("samme seed + entrants → identisk ranked", () => {
  const entrants = [ELITE_SPRINTER, PURE_CLIMBER, rider("x"), rider("y")];
  assert.deepEqual(
    simulateStage({ entrants, stageProfile: FLAT, seed: 12345 }),
    simulateStage({ entrants, stageProfile: FLAT, seed: 12345 }),
  );
});

test("rangering er uafhængig af input-rækkefølge (stabil rng-orden)", () => {
  const entrants = [ELITE_SPRINTER, PURE_CLIMBER, rider("a"), rider("b"), rider("c")];
  const a = simulateStage({ entrants, stageProfile: MOUNTAIN, seed: 555 }).ranked.map((r) => r.rider_id);
  const shuffled = [...entrants].reverse();
  const b = simulateStage({ entrants: shuffled, stageProfile: MOUNTAIN, seed: 555 }).ranked.map((r) => r.rider_id);
  assert.deepEqual(a, b);
});

test("stabil tiebreaker: identiske ryttere rangeres efter rider_id", () => {
  // Demand uden randomness → ingen støj → rene ties brydes deterministisk af id.
  const stage = { profile_type: "flat", demand_vector: { sprint: 1.0 } };
  const entrants = [rider("c", { sprint: 70 }), rider("a", { sprint: 70 }), rider("b", { sprint: 70 })];
  const ids = simulateStage({ entrants, stageProfile: stage, seed: 3 }).ranked.map((r) => r.rider_id);
  assert.deepEqual(ids, ["a", "b", "c"]);
});

// ── Golden-seed / rolle-matchning (acceptance #1102) ─────────────────────────
test("golden: elite-sprinter slår ren klatrer på flad spurt (flertal af seeds)", () => {
  let sprinterWins = 0;
  const N = 300;
  for (let seed = 1; seed <= N; seed++) {
    const { ranked } = simulateStage({ entrants: [ELITE_SPRINTER, PURE_CLIMBER], stageProfile: FLAT, seed });
    if (rankOf(ranked, "sprinter") < rankOf(ranked, "climber")) sprinterWins++;
  }
  assert.ok(sprinterWins / N > 0.7, `sprinter vandt kun ${sprinterWins}/${N} på flad`);
});

test("golden: elite-klatrer slår ren sprinter på bjerg (flertal af seeds)", () => {
  let climberWins = 0;
  const N = 300;
  for (let seed = 1; seed <= N; seed++) {
    const { ranked } = simulateStage({ entrants: [ELITE_SPRINTER, PURE_CLIMBER], stageProfile: MOUNTAIN, seed });
    if (rankOf(ranked, "climber") < rankOf(ranked, "sprinter")) climberWins++;
  }
  assert.ok(climberWins / N > 0.7, `klatrer vandt kun ${climberWins}/${N} på bjerg`);
});

test("distribution: stjernen vinder oftest, men ikke 100% (varians findes)", () => {
  // 1 stjerne-sprinter + 9 top-sprintere på flad → favorit men slåbar.
  // Rival-feltet ligger TÆT på stjernen (sprint 80-84 vs 86): efter #1102-
  // kalibreringen (flad sprint-vægt 0.30→0.62, NOISE_SD_SCALE 0.20→0.16) er et
  // 10-14-points sprint-gab bevidst nær-deterministisk — varians-egenskaben
  // gælder blandt JÆVNBYRDIGE favoritter, som i den ægte population (dry-run:
  // 24+ distinkte flad-vindere pr. sæson).
  const field = [rider("star", { sprint: 86, acceleration: 84, positioning: 80 })];
  for (let i = 0; i < 9; i++) field.push(rider(`fld${i}`, { sprint: 80 + (i % 5), acceleration: 78, positioning: 74 }));
  let starWins = 0;
  const N = 400;
  for (let seed = 1; seed <= N; seed++) {
    if (winnerOf(field, FLAT, seed) === "star") starWins++;
  }
  const rate = starWins / N;
  assert.ok(rate > 0.45, `stjernen for svag: vandt ${starWins}/${N}`);
  // upper bound er defensiv: 400/400 = motorbrydende determinisme; balance-niveauet bevogtes af dry-run-gaten
  assert.ok(rate < 1.0, `stjernen vandt ALT (${starWins}/${N}) — ingen overraskelser`);
});

// ── Monotonicitet ─────────────────────────────────────────────────────────────
test("monotonicitet: højere relevant ability → højere terrain-score", () => {
  const weak = { climbing: 50 };
  const strong = { climbing: 90 };
  const abil = (o) => Object.assign(Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), o);
  assert.ok(terrainScore(abil(strong), DEMAND_VECTORS.mountain) > terrainScore(abil(weak), DEMAND_VECTORS.mountain));
});

test("terrainScore ignorerer 'randomness' (ikke en ability) og manglende nøgler", () => {
  const abilities = Object.fromEntries(ABILITY_KEYS.map((k) => [k, 60]));
  // demand med kun randomness → terrain = 0 (randomness tæller ikke som ability).
  assert.equal(terrainScore(abilities, { randomness: 1.0 }), 0);
});

// ── Bunch-adfærd (F3 GC-feel) ─────────────────────────────────────────────────
test("flad etape: feltet deler tid (flere gap=0), bjerg åbner gab", () => {
  const tightField = Array.from({ length: 10 }, (_, i) => rider(`r${i}`, { sprint: 70 + (i % 3), positioning: 70 }));
  const flat = simulateStage({ entrants: tightField, stageProfile: FLAT, seed: 11 }).ranked;
  const mtn = simulateStage({ entrants: tightField, stageProfile: MOUNTAIN, seed: 11 }).ranked;
  const flatZeros = flat.filter((r) => r.stageGap === 0).length;
  const mtnMaxGap = Math.max(...mtn.map((r) => r.stageGap));
  assert.ok(flatZeros >= 2, `forventede et felt på flad, fik ${flatZeros} med gap 0`);
  assert.ok(mtnMaxGap > 0, "bjerg gav ingen tids-gab");
});

// ── Guards ────────────────────────────────────────────────────────────────────
test("kaster ved manglende demand_vector eller ikke-heltal seed", () => {
  assert.throws(() => simulateStage({ entrants: [], stageProfile: {}, seed: 1 }), /demand_vector/);
  assert.throws(() => simulateStage({ entrants: [], stageProfile: FLAT, seed: 1.5 }), /seed/);
});

test("stableSeed er deterministisk + 32-bit unsigned", () => {
  assert.equal(stableSeed("race-1:1"), stableSeed("race-1:1"));
  assert.notEqual(stableSeed("race-1:1"), stableSeed("race-1:2"));
  assert.ok(stableSeed("x") >= 0 && stableSeed("x") <= 0xffffffff);
});
