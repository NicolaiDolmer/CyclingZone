import { test } from "node:test";
import assert from "node:assert/strict";

import {
  simulateStage,
  terrainScore,
  stableSeed,
  ABILITY_KEYS,
  ENGINE_VERSION,
  FORM_RACE_WEIGHT,
  FATIGUE_RACE_WEIGHT,
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
    const sum = c.terrain + c.noise + c.form - c.fatigue + c.team + (c.breakaway ?? 0);
    assert.ok(Math.abs(sum - r.finalScore) < 1e-12, "finalScore matcher ikke komponenter");
  }
});

// Neutral path: entrant uden form/fatigue-nøgler (flag-OFF / intet data i DB) →
// team-seam er stadig 0 (#1307); form/fatigue returnerer 0 via NaN-guard.
test("seams returnerer neutralt uden condition-data (form/fatigue/team = 0)", () => {
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
  // Grænsen er justeret til 0.20 (#1307 Task 9-kalibrering): flat-profilen er
  // breakaway-egnet, og gate-kalibreringen mod den ÆGTE pyramide-population
  // landede på BREAKAWAY_TOP_EXCLUDED=0.05 + flat maxBonus=0.30. I DETTE lille
  // 10-rytter-fixture er cut'et floor(10·0.05)=0 → ALLE ryttere (inkl. stjernen)
  // er escapee-kandidater med op til +0.30 bonus, mens noise-sd kun er ~0.0128:
  // i et lille felt forstørres udbruds-effekten massivt (målt: 0.255 ved N=400 —
  // stadig 2,5× en jævnbyrdig rival). I en realistisk population (140 ryttere)
  // er effekten langt mindre (flad escapee-vinder-andel 2-6 % i gaten).
  // Balance-niveauet bevogtes af race:gate-kalibreringen (`npm run race:gate`);
  // dette fixture tester kun "favorit oftest, men slåbar".
  const field = [rider("star", { sprint: 86, acceleration: 84, positioning: 80 })];
  for (let i = 0; i < 9; i++) field.push(rider(`fld${i}`, { sprint: 80 + (i % 5), acceleration: 78, positioning: 74 }));
  let starWins = 0;
  const N = 400;
  for (let seed = 1; seed <= N; seed++) {
    if (winnerOf(field, FLAT, seed) === "star") starWins++;
  }
  const rate = starWins / N;
  assert.ok(rate > 0.20, `stjernen for svag: vandt ${starWins}/${N}`);
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
  // #1307: flad bunch-egenskab testes på et <4-rytter-felt — udbrud kræver ≥4
  // ryttere, så GAP_MODEL-adfærden måles isoleret fra breakaway-mekanikken (en
  // vindende escapee åbner legitimt gab til feltet, præcis som irl, og ville
  // gøre gap=0-tællingen afhængig af kalibrerings-konstanterne).
  const tightTrio = Array.from({ length: 3 }, (_, i) => rider(`r${i}`, { sprint: 70 + (i % 3), positioning: 70 }));
  const tightField = Array.from({ length: 10 }, (_, i) => rider(`r${i}`, { sprint: 70 + (i % 3), positioning: 70 }));
  const flat = simulateStage({ entrants: tightTrio, stageProfile: FLAT, seed: 11 }).ranked;
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

// ── formComponent / fatigueComponent (#1306) ──────────────────────────────────

// Hjælper: kør simulateStage med ét felt uden støj (randomness=0) og returnér
// finalScore for rytteren med givet id.
function scoreFor(id, form, fatigue, seed = 1) {
  const entrants = [{ rider_id: id, abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), form, fatigue }];
  const stage = { profile_type: "flat", demand_vector: { sprint: 1.0 } }; // ingen randomness
  return simulateStage({ entrants, stageProfile: stage, seed }).ranked[0].finalScore;
}

test("#1306 neutral: entrant uden form/fatigue → form=0, fatigue=0 (NaN-guard)", () => {
  // ELITE_SPRINTER har ingen form/fatigue nøgler — backward compat.
  const { ranked } = simulateStage({ entrants: [ELITE_SPRINTER], stageProfile: FLAT, seed: 1 });
  const c = ranked[0].components;
  assert.equal(c.form, 0, "form skal være 0 uden data");
  assert.equal(c.fatigue, 0, "fatigue skal være 0 uden data");
});

test("#1306 neutral: form=50 → formComponent = 0 (midtpunkt)", () => {
  // (50-50)/50 * FORM_RACE_WEIGHT = 0
  const { ranked } = simulateStage({
    entrants: [{ rider_id: "r1", abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), form: 50, fatigue: 0 }],
    stageProfile: FLAT,
    seed: 1,
  });
  assert.ok(Math.abs(ranked[0].components.form) < 1e-12, "form=50 → formComponent ≈ 0");
});

test("#1306 form=100 → +FORM_RACE_WEIGHT (0.012)", () => {
  const { ranked } = simulateStage({
    entrants: [{ rider_id: "r1", abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), form: 100, fatigue: 0 }],
    stageProfile: { profile_type: "flat", demand_vector: { sprint: 1.0 } },
    seed: 1,
  });
  assert.ok(Math.abs(ranked[0].components.form - FORM_RACE_WEIGHT) < 1e-12, `form=100 → ${ranked[0].components.form}`);
});

test("#1306 form=0 → -FORM_RACE_WEIGHT (-0.012)", () => {
  const { ranked } = simulateStage({
    entrants: [{ rider_id: "r1", abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), form: 0, fatigue: 0 }],
    stageProfile: { profile_type: "flat", demand_vector: { sprint: 1.0 } },
    seed: 1,
  });
  assert.ok(Math.abs(ranked[0].components.form - (-FORM_RACE_WEIGHT)) < 1e-12, `form=0 → ${ranked[0].components.form}`);
});

test("#1306 fatigue=100 → +FATIGUE_RACE_WEIGHT positiv magnitude (0.008)", () => {
  const { ranked } = simulateStage({
    entrants: [{ rider_id: "r1", abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), form: 50, fatigue: 100 }],
    stageProfile: { profile_type: "flat", demand_vector: { sprint: 1.0 } },
    seed: 1,
  });
  assert.ok(Math.abs(ranked[0].components.fatigue - FATIGUE_RACE_WEIGHT) < 1e-12, `fatigue=100 → ${ranked[0].components.fatigue}`);
});

test("#1306 fatigue=0 → fatigueComponent = 0", () => {
  const { ranked } = simulateStage({
    entrants: [{ rider_id: "r1", abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), form: 50, fatigue: 0 }],
    stageProfile: { profile_type: "flat", demand_vector: { sprint: 1.0 } },
    seed: 1,
  });
  assert.equal(ranked[0].components.fatigue, 0);
});

test("#1306 clamp: form=200 → max +FORM_RACE_WEIGHT (ikke 0.036)", () => {
  const { ranked } = simulateStage({
    entrants: [{ rider_id: "r1", abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), form: 200, fatigue: 0 }],
    stageProfile: { profile_type: "flat", demand_vector: { sprint: 1.0 } },
    seed: 1,
  });
  const f = ranked[0].components.form;
  assert.ok(Math.abs(f - FORM_RACE_WEIGHT) < 1e-12, `form=200 clampet til 100 → ${f}`);
});

test("#1306 clamp: form=-50 → min -FORM_RACE_WEIGHT", () => {
  const { ranked } = simulateStage({
    entrants: [{ rider_id: "r1", abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), form: -50, fatigue: 0 }],
    stageProfile: { profile_type: "flat", demand_vector: { sprint: 1.0 } },
    seed: 1,
  });
  const f = ranked[0].components.form;
  assert.ok(Math.abs(f - (-FORM_RACE_WEIGHT)) < 1e-12, `form=-50 clampet til 0 → ${f}`);
});

test("#1306 clamp: fatigue=200 → max FATIGUE_RACE_WEIGHT (ikke 0.016)", () => {
  const { ranked } = simulateStage({
    entrants: [{ rider_id: "r1", abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), form: 50, fatigue: 200 }],
    stageProfile: { profile_type: "flat", demand_vector: { sprint: 1.0 } },
    seed: 1,
  });
  const fat = ranked[0].components.fatigue;
  assert.ok(Math.abs(fat - FATIGUE_RACE_WEIGHT) < 1e-12, `fatigue=200 clampet til 100 → ${fat}`);
});

test("#1306 garbage input (NaN/strings/undefined/{}) → neutralt 0", () => {
  // null/[] konverterer til 0 via Number() → clamp → gyldigt tal (laveste form).
  // Kun ægte ikke-numeriske værdier returnerer 0 via NaN-guard.
  for (const bad of [NaN, "hej", undefined, {}]) {
    const { ranked } = simulateStage({
      entrants: [{ rider_id: "r1", abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), form: bad, fatigue: bad }],
      stageProfile: { profile_type: "flat", demand_vector: { sprint: 1.0 } },
      seed: 1,
    });
    assert.equal(ranked[0].components.form, 0, `form garbage(${String(bad)}) → ikke 0`);
    assert.equal(ranked[0].components.fatigue, 0, `fatigue garbage(${String(bad)}) → ikke 0`);
  }
});

test("#1306 bounds: |formComponent| ≤ FORM_RACE_WEIGHT for alle gyldige inputs", () => {
  const stage = { profile_type: "flat", demand_vector: { sprint: 1.0 } };
  for (const form of [0, 25, 50, 75, 100]) {
    const { ranked } = simulateStage({
      entrants: [{ rider_id: "r1", abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), form, fatigue: 0 }],
      stageProfile: stage,
      seed: 1,
    });
    const f = ranked[0].components.form;
    assert.ok(Math.abs(f) <= FORM_RACE_WEIGHT + 1e-12, `form=${form} → |formComponent|=${Math.abs(f)} > ${FORM_RACE_WEIGHT}`);
  }
});

test("#1306 bounds: fatigueComponent ∈ [0, FATIGUE_RACE_WEIGHT] for alle gyldige inputs", () => {
  const stage = { profile_type: "flat", demand_vector: { sprint: 1.0 } };
  for (const fatigue of [0, 25, 50, 75, 100]) {
    const { ranked } = simulateStage({
      entrants: [{ rider_id: "r1", abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), form: 50, fatigue }],
      stageProfile: stage,
      seed: 1,
    });
    const fat = ranked[0].components.fatigue;
    assert.ok(fat >= 0 && fat <= FATIGUE_RACE_WEIGHT + 1e-12,
      `fatigue=${fatigue} → fatigueComponent=${fat} udenfor [0, ${FATIGUE_RACE_WEIGHT}]`);
  }
});

test("#1306 relativ effekt ≤ ~3.5 % af typisk terrain-score", () => {
  const TYPICAL_TERRAIN = 0.65;
  const maxEffect = FORM_RACE_WEIGHT + FATIGUE_RACE_WEIGHT; // 0.012 + 0.008 = 0.020
  assert.ok(maxEffect / TYPICAL_TERRAIN <= 0.035,
    `max konditions-effekt = ${maxEffect / TYPICAL_TERRAIN * 100} % > 3.5 %`);
});

test("#1306 integration: form=100/fatigue=0 slår neutral med ≈FORM_RACE_WEIGHT (deterministisk)", () => {
  // Ingen støj → score-delta er præcis 0.012.
  const stage = { profile_type: "flat", demand_vector: { sprint: 1.0 } };
  const abilities = Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50]));
  const neutral = simulateStage({
    entrants: [{ rider_id: "r1", abilities }],
    stageProfile: stage,
    seed: 42,
  }).ranked[0].finalScore;
  const boosted = simulateStage({
    entrants: [{ rider_id: "r1", abilities, form: 100, fatigue: 0 }],
    stageProfile: stage,
    seed: 42,
  }).ranked[0].finalScore;
  assert.ok(Math.abs((boosted - neutral) - FORM_RACE_WEIGHT) < 1e-12,
    `forventet +${FORM_RACE_WEIGHT}, fik ${boosted - neutral}`);
});

test("#1306 integration: to seeds → identisk resultat (determinisme med condition)", () => {
  const stage = { profile_type: "flat", demand_vector: { sprint: 1.0 } };
  const abilities = Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50]));
  const entrants = [
    { rider_id: "a", abilities, form: 80, fatigue: 30 },
    { rider_id: "b", abilities, form: 40, fatigue: 70 },
  ];
  assert.deepEqual(
    simulateStage({ entrants, stageProfile: stage, seed: 999 }),
    simulateStage({ entrants, stageProfile: stage, seed: 999 }),
  );
});

test("#1306: null condition-data er neutral, ikke worst-form (review-fix B1)", () => {
  const { ranked } = simulateStage({
    entrants: [{ rider_id: "r1", abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), form: null, fatigue: null }],
    stageProfile: { profile_type: "flat", demand_vector: { sprint: 1.0 } },
    seed: 1,
  });
  assert.equal(ranked[0].components.form, 0, "form=null skal være neutral, ikke -0.012");
  assert.equal(ranked[0].components.fatigue, 0, "fatigue=null skal være neutral");
});
