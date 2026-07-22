import { test } from "node:test";
import assert from "node:assert/strict";

import {
  simulateStage,
  terrainScore,
  stableSeed,
  aggressionScore,
  ABILITY_KEYS,
  ENGINE_VERSION,
  FORM_RACE_WEIGHT,
  FATIGUE_RACE_WEIGHT,
  DURABILITY_FATIGUE_DAMPING,
  DESCENDING_FINALE_WEIGHT,
  stageGapModel,
  distanceFactor,
  DISTANCE_BAND_MIDPOINTS,
  LONG_DAY_ENDURANCE_WEIGHT,
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
test("ENGINE_VERSION + ABILITY_KEYS = de 15 forventede (Plan 1 #1122)", () => {
  assert.equal(ENGINE_VERSION, 1);
  assert.equal(ABILITY_KEYS.length, 15);
  assert.deepEqual([...ABILITY_KEYS].sort(), [
    "acceleration", "aggression", "climbing", "cobblestone", "descending",
    "durability", "endurance", "flat", "positioning", "punch",
    "recovery", "sprint", "tactics", "tempo", "time_trial",
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
    const sum = c.terrain + c.noise + c.form - c.fatigue + c.team + (c.breakaway ?? 0) + (c.finale ?? 0);
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
function _scoreFor(id, form, fatigue, seed = 1) {
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

test("#1306 fatigue=100 → +FATIGUE_RACE_WEIGHT positiv magnitude (= vægt-konstanten)", () => {
  const { ranked } = simulateStage({
    // durability:0 → fuld straf (damp=1), så denne test isolerer fatigue-VÆGTEN (#1122).
    entrants: [{ rider_id: "r1", abilities: { ...Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), durability: 0 }, form: 50, fatigue: 100 }],
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

test("#1306 clamp: fatigue=200 → max FATIGUE_RACE_WEIGHT (ikke 2×vægten)", () => {
  const { ranked } = simulateStage({
    // durability:0 → fuld straf (damp=1); clamp-testen isolerer fatigue-VÆGTEN (#1122).
    entrants: [{ rider_id: "r1", abilities: { ...Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])), durability: 0 }, form: 50, fatigue: 200 }],
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

test("#1306/#1021 relativ effekt ≤ ~7 % af typisk terrain-score (form+fatigue forbliver modifier)", () => {
  const TYPICAL_TERRAIN = 0.65;
  const maxEffect = FORM_RACE_WEIGHT + FATIGUE_RACE_WEIGHT; // 0.012 + 0.030 = 0.042
  // #1021-hybrid (ejer-valgt 2026-06-17): fatigue-vægt hævet 0.008→0.030 så durability
  // ikke længere er dødvægt og kondition tæller i tredje uge af en tour. Combined max
  // ~6,5 % af terræn — stadig en modifier; evner dominerer. Den EMPIRISKE "stjerner
  // vinder oftest"-garanti er race:gate (ikke denne statiske øvre bound).
  assert.ok(maxEffect / TYPICAL_TERRAIN <= 0.07,
    `max konditions-effekt = ${(maxEffect / TYPICAL_TERRAIN * 100).toFixed(1)} % > 7 %`);
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

// ── #1122 Plan 1: aggression driver breakaway ─────────────────────────────────
test("#1122 aggressionScore læser aggression-evnen (ikke proxy)", () => {
  const high = { aggression: 90, tactics: 10, endurance: 10, acceleration: 10 };
  const low  = { aggression: 10, tactics: 90, endurance: 90, acceleration: 90 };
  assert.ok(aggressionScore(high) > aggressionScore(low), "høj aggression skal slå høj proxy-sum");
  assert.equal(aggressionScore(high), 90);
});

test("#1122 aggressionScore falder tilbage til proxy uden aggression-data", () => {
  const r = { tactics: 80, endurance: 60, acceleration: 40 };
  assert.equal(aggressionScore(r), 0.5 * 80 + 0.3 * 60 + 0.2 * 40);
});

test("#1122 aggression er i ABILITY_KEYS (loades af loadEntrantsForRace)", () => {
  assert.ok(ABILITY_KEYS.includes("aggression"));
});

// ── #1122 Plan 1: durability dæmper fatigue-seamen ────────────────────────────
test("#1122 durability dæmper trætheds-straffen (kun under træthed)", () => {
  const base = Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50]));
  const stage = { profile_type: "flat", demand_vector: { sprint: 1.0 } }; // ingen støj
  const lowDur  = { ...base, durability: 10 };
  const highDur = { ...base, durability: 90 };
  const score = (ab) => simulateStage({
    entrants: [{ rider_id: "r1", abilities: ab, form: 50, fatigue: 80 }],
    stageProfile: stage, seed: 1,
  }).ranked[0].components.fatigue;
  // højere durability → MINDRE trætheds-straf (komponenten er mindre).
  assert.ok(score(highDur) < score(lowDur), "høj durability skal dæmpe fatigue-komponenten");
});

test("#1122 durability har INGEN effekt uden træthed (neutral)", () => {
  const base = Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50]));
  const stage = { profile_type: "flat", demand_vector: { sprint: 1.0 } };
  const f = (dur) => simulateStage({
    entrants: [{ rider_id: "r1", abilities: { ...base, durability: dur } }], // ingen fatigue
    stageProfile: stage, seed: 1,
  }).ranked[0].components.fatigue;
  assert.equal(f(10), 0);
  assert.equal(f(90), 0);
});

test("#1122 DURABILITY_FATIGUE_DAMPING ∈ (0,1]", () => {
  assert.ok(DURABILITY_FATIGUE_DAMPING > 0 && DURABILITY_FATIGUE_DAMPING <= 1);
});

// ── #1122 Plan 1: descending finale-modifier ──────────────────────────────────
test("#1122 descending giver bonus PÅ descent-finale, intet ellers", () => {
  const base = Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50]));
  const goodDesc = { ...base, descending: 95 };
  const comp = (finale_type) => simulateStage({
    entrants: [{ rider_id: "r1", abilities: goodDesc }],
    stageProfile: { profile_type: "mountain", demand_vector: { climbing: 1.0 }, finale_type },
    seed: 1,
  }).ranked[0].components.finale;
  assert.ok(comp("descent") > 0, "god nedkører skal få bonus på descent-finale");
  assert.equal(comp("long_climb"), 0, "ingen descending-effekt uden descent-finale");
  // descending=99 → maksimal bonus = DESCENDING_FINALE_WEIGHT (centreret om 50).
  const maxBonus = simulateStage({
    entrants: [{ rider_id: "r1", abilities: { ...base, descending: 99 } }],
    stageProfile: { profile_type: "mountain", demand_vector: { climbing: 1.0 }, finale_type: "descent" },
    seed: 1,
  }).ranked[0].components.finale;
  assert.ok(Math.abs(maxBonus - DESCENDING_FINALE_WEIGHT) < 1e-12, `descending=99 → ${maxBonus}, forventet ${DESCENDING_FINALE_WEIGHT}`);
});

test("#1122 dårlig nedkører taber på descent-finale (centreret om 50)", () => {
  const base = Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50]));
  const c = (dsc) => simulateStage({
    entrants: [{ rider_id: "r1", abilities: { ...base, descending: dsc } }],
    stageProfile: { profile_type: "mountain", demand_vector: { climbing: 1.0 }, finale_type: "descent" },
    seed: 1,
  }).ranked[0].components.finale;
  assert.ok(c(95) > 0 && c(10) < 0, "descending centreres om 50: >50 vinder, <50 taber");
});

test("#1122 finalScore inkluderer finale-komponenten (forklarlighed)", () => {
  const { ranked } = simulateStage({
    entrants: [{ rider_id: "r1", abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, 50])) }],
    stageProfile: { profile_type: "mountain", demand_vector: { climbing: 1.0 }, finale_type: "descent" }, seed: 1,
  });
  const c = ranked[0].components;
  const sum = c.terrain + c.noise + c.form - c.fatigue + c.team + (c.breakaway ?? 0) + (c.finale ?? 0);
  assert.ok(Math.abs(sum - ranked[0].finalScore) < 1e-12);
});

// ── Sub-3 (#2771) Task 1: stageGapModel — ankret rute-modifier-model ──────────
test("stageGapModel uden rutedata = anker-værdier (identitet)", () => {
  assert.deepEqual(stageGapModel({ profile_type: "mountain" }), { bunch: 0.0, spread: 600 });
  assert.deepEqual(stageGapModel({ profile_type: "flat" }), { bunch: 0.06, spread: 40 });
  assert.deepEqual(stageGapModel({ profile_type: "ukendt" }), { bunch: 0.03, spread: 150 });
});

test("summit-finish åbner gab: spread ×1.3, bunch 0", () => {
  const m = stageGapModel({
    profile_type: "mountain", distance_km: 160,
    climbs: [{ category: "1", crest_km: 160, summit_finish: true }],
  });
  // kategori-faktor 1 (×1.10) · summit (×1.3): 600·1.1·1.3 = 858
  assert.equal(m.spread, Math.round(600 * 1.1 * 1.3));
  assert.equal(m.bunch, 0);
});

test("dal-finish komprimerer: ≥10 km efter sidste top → ×0.6", () => {
  const m = stageGapModel({
    profile_type: "mountain", distance_km: 170,
    climbs: [{ category: "2", crest_km: 150, summit_finish: false }],
  });
  assert.equal(m.spread, Math.round(600 * 1.0 * 0.6)); // cat2 ×1.0 · dal ×0.6
});

test("HC-kategori skalerer hårdest", () => {
  const hc = stageGapModel({ profile_type: "high_mountain", distance_km: 150, climbs: [{ category: "HC", crest_km: 150, summit_finish: true }] });
  const c3 = stageGapModel({ profile_type: "high_mountain", distance_km: 150, climbs: [{ category: "3", crest_km: 150, summit_finish: true }] });
  assert.ok(hc.spread > c3.spread);
});

test("ITT skalerer med distance; prolog-distance giver små gab", () => {
  assert.equal(stageGapModel({ profile_type: "itt", distance_km: 30 }).spread, 700);
  assert.equal(stageGapModel({ profile_type: "itt", distance_km: 6 }).spread, 150);  // clamp-gulv
  assert.equal(stageGapModel({ profile_type: "itt", distance_km: 40 }).spread, Math.round(700 * 40 / 30));
});

test("samlet spread-clamp [40, 1000]", () => {
  const m = stageGapModel({ profile_type: "high_mountain", distance_km: 140, climbs: [{ category: "HC", crest_km: 140, summit_finish: true }] });
  assert.ok(m.spread <= 1000);
});

// ── Sub-3 (#2771) Task 2: distance→fatigue + endurance-term (long_day) ────────
test("distanceFactor: kendt profil + distance skalerer om bandMid, clamp [0.85, 1.2]; ellers identitet (1)", () => {
  assert.equal(DISTANCE_BAND_MIDPOINTS.mountain, 170);
  assert.equal(distanceFactor({ profile_type: "mountain", distance_km: 204 }), 1.2); // 204/170=1.2 (loft)
  assert.equal(distanceFactor({ profile_type: "mountain" }), 1); // ingen distance
  assert.equal(distanceFactor({ profile_type: "ukendt", distance_km: 200 }), 1); // ukendt profil
  assert.equal(distanceFactor({ profile_type: "mountain", distance_km: 10 }), 0.85); // gulv
});

test("distFactor skalerer fatigue-straf på lange dage; ingen distance → identitet", () => {
  const base = { profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain };
  const long = { ...base, distance_km: 204 }; // bandMid mountain = 170 → factor 1.2
  const entrantA = { ...rider("a", { climbing: 50, durability: 0 }), fatigue: 60 };
  const r1 = simulateStage({ entrants: [entrantA], stageProfile: base, seed: 1 });
  const r2 = simulateStage({ entrants: [entrantA], stageProfile: long, seed: 1 });
  assert.ok(r2.ranked[0].components.fatigue > r1.ranked[0].components.fatigue);
});

test("endurance-term: lang dag favoriserer endurance; kort dag straffer; components.long_day sat", () => {
  const long = { profile_type: "mountain", distance_km: 204, demand_vector: DEMAND_VECTORS.mountain };
  const hi = simulateStage({ entrants: [rider("a", { climbing: 50, endurance: 99 })], stageProfile: long, seed: 1 });
  const lo = simulateStage({ entrants: [rider("a", { climbing: 50, endurance: 0 })], stageProfile: long, seed: 1 });
  assert.ok(hi.ranked[0].components.long_day > 0);
  assert.ok(lo.ranked[0].components.long_day < 0);
});

test("flag-off-ækvivalent: uden distance_km er components.long_day 0 og alt uændret", () => {
  const bare = { profile_type: "mountain", demand_vector: { ...DEMAND_VECTORS.mountain, randomness: 0.5 } };
  const entrants = [ELITE_SPRINTER, PURE_CLIMBER, rider("avg1"), rider("avg2")];
  const r = simulateStage({ entrants, stageProfile: bare, seed: 7 });
  assert.ok(r.ranked.every((x) => x.components.long_day === 0));
});

test("LONG_DAY_ENDURANCE_WEIGHT er den forventede kalibrerings-konstant (0.05)", () => {
  assert.equal(LONG_DAY_ENDURANCE_WEIGHT, 0.05);
});
