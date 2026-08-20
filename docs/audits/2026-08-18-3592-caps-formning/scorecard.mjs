// #3592 — engangsscript, KUN i scratchpad. Simulerer den ANBEFALEDE kandidat
// (magnitude-normaliseret-by-max caps-faktor, decoupled fra signatureFactor) mod
// riders_full.json, UDEN at ændre repoet. Genimplementerer kun buildYouthCaps'
// matematik lokalt med patched vægte/formel, importerer CAPS_SHAPING_WEIGHTS +
// YOUTH_PROGRESSION_CONFIG fra de FAKTISKE kilder for at undgå config-drift.

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const riderProgressionUrl = pathToFileURL("C:/Dev/CyclingZone/backend/lib/riderProgression.js").href;
const capsShapingWeightsUrl = pathToFileURL("C:/Dev/CyclingZone/backend/lib/weights/capsShapingWeights.js").href;

const {
  buildYouthCaps: buildYouthCapsBASELINE,
  YOUTH_PROGRESSION_CONFIG,
  CRAFT_ABILITIES,
} = await import(riderProgressionUrl);
const { CAPS_SHAPING_WEIGHTS } = await import(capsShapingWeightsUrl);

const BASE_WEIGHTS_BY_TYPE = Object.fromEntries(CAPS_SHAPING_WEIGHTS.map((t) => [t.key, t.weights]));

// ── KANDIDAT (v2 — GLOBAL per-evne-ejerskab, ikke per-type-max): KUN
// magnitude-ændring, INGEN fortegns-skift (time_trial var allerede positiv hos
// gc, er stadig positiv). Eneste tal-ændring: gc.time_trial 3->2 — bryder
// tie-break'et ved at gøre tt den STÆRKESTE ejer af time_trial (globalt),
// fremfor et fladt per-type-max der straffer ALLE gc's øvrige signatur-evner.
const PATCHED_WEIGHTS_BY_TYPE = JSON.parse(JSON.stringify(BASE_WEIGHTS_BY_TYPE));
PATCHED_WEIGHTS_BY_TYPE.gc.time_trial = 2; // var 3 — eneste tal-ændring i denne simulation

// Global maks-positiv-vægt PR. EVNE på tværs af alle 8 typer (beregnes af den
// AKTUELLE weightsByType-tabel, så patchede vægte automatisk opdaterer denne).
function globalMaxPositiveByAbility(weightsByType) {
  const out = {};
  for (const weights of Object.values(weightsByType)) {
    for (const [ability, w] of Object.entries(weights)) {
      if (w > 0) out[ability] = Math.max(out[ability] || 0, w);
    }
  }
  return out;
}

// capsSignatureFraction — NY, caps-only funktion. w<=0 => 0 (uændret ift. i dag).
// w>0 => w / (global maks-positiv-vægt for DENNE evne på tværs af alle typer).
// En type der EJER en evne alene (fx brostensrytters cobblestone=6) beholder
// factor 1.0 uanset øvrige typers vægte. Kun evner der er DELT med en type der
// vægter dem højere bliver skaleret ned — modsat v1 (normaliser-by-egen-max),
// som straffede EN typs samtlige signatur-evner blot fordi typen har flere end én.
function capsSignatureFraction(weightsByType, primaryType, ability) {
  const weights = weightsByType[primaryType];
  const w = weights?.[ability];
  if (w == null || w <= 0) return 0;
  const globalMax = globalMaxPositiveByAbility(weightsByType)[ability] || 0;
  return globalMax > 0 ? w / globalMax : 0;
}

function tagForClass(klasse, cfg) {
  switch (klasse) {
    case "signatur": return cfg.naturalPrimaryFactor;
    case "sekundaer": return cfg.naturalSecondaryFactor;
    case "haandvaerk": return cfg.craftFactor;
    case "svaghed": return cfg.oppositeFactor;
    default: return cfg.neutralFactor;
  }
}

// abilityRoleClass — klasse-afgørelsen er UÆNDRET (kun fortegn), så
// roleRateFactor (RATEN, dailyTraining.js) og training.js's focusTrainability
// forbliver bit-identiske. Kun TAGGET (youthRoleFactor) patches herunder.
function abilityRoleClass(weightsByType, primaryType, secondaryType, ability, cfg) {
  const wp = weightsByType[primaryType]?.[ability];
  const ws = weightsByType[secondaryType]?.[ability];
  let klasse;
  if (wp > 0) klasse = "signatur";
  else if (ws > 0) klasse = "sekundaer";
  else if (wp < 0 || ws < 0) klasse = "svaghed";
  else klasse = "andenRolle";
  if (CRAFT_ABILITIES.includes(ability) && Number.isFinite(cfg?.craftFactor) && cfg.craftFactor > tagForClass(klasse, cfg)) {
    return "haandvaerk";
  }
  return klasse;
}

// youthRoleFactor — PATCHED: signatur/sekundaer TAG ganges med capsSignatureFraction.
// svaghed/andenRolle/haandvaerk uændret.
function youthRoleFactorPatched(weightsByType, primaryType, secondaryType, ability, cfg) {
  const klasse = abilityRoleClass(weightsByType, primaryType, secondaryType, ability, cfg);
  const baseTag = tagForClass(klasse, cfg);
  if (klasse === "signatur") return baseTag * capsSignatureFraction(weightsByType, primaryType, ability);
  if (klasse === "sekundaer") return baseTag * capsSignatureFraction(weightsByType, secondaryType, ability);
  return baseTag;
}

function youthLoftForPotential(potentiale, cfg) {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const p = clamp(Number(potentiale) || 1, 1, 6);
  const lo = Math.floor(p), hi = Math.ceil(p);
  const a = cfg.loftByPotential[lo] ?? 0;
  const b = cfg.loftByPotential[hi] ?? a;
  return a + (b - a) * (p - lo);
}

const clampCap = (n) => Math.max(0, Math.min(99, Math.round(n)));

function buildYouthCapsPatched(potentiale, primaryType, secondaryType, weightsByType, cfg = YOUTH_PROGRESSION_CONFIG) {
  const caps = {};
  const abilities = new Set([
    ...Object.keys(weightsByType[primaryType] || {}),
    ...Object.keys(weightsByType[secondaryType] || {}),
    ...CRAFT_ABILITIES,
    // resten af VISIBLE_ABILITIES tilføjes nedenfor via caller (samme sæt som baseline)
  ]);
  for (const ability of abilities) {
    const target = youthLoftForPotential(potentiale, cfg) * youthRoleFactorPatched(weightsByType, primaryType, secondaryType, ability, cfg);
    caps[ability] = clampCap(target);
  }
  return caps;
}

function capsTypeScore(weightsByType, capsObj, typeKey) {
  const weights = weightsByType[typeKey];
  if (!weights) return null;
  let sum = 0, wsum = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (w <= 0) continue;
    const v = Number(capsObj?.[k]);
    if (Number.isFinite(v)) { sum += v * w; wsum += w; }
  }
  return wsum > 0 ? sum / wsum : null;
}

const raw = fs.readFileSync("C:/Dev/CyclingZone/docs/snapshots/3591/riders_full.json", "utf8");
const riders = JSON.parse(raw);
const pot56 = riders.filter((r) => r.owner_kind === "human" && Number(r.potentiale) >= 5);

const ALL_ABILITIES = [...new Set(riders.flatMap((r) => Object.keys(r.abilities || {})))];

function baselineCapsFull(r) {
  // buildYouthCaps fra repoet dækker allerede VISIBLE_ABILITIES fuldt ud.
  return buildYouthCapsBASELINE(r.potentiale, r.primary_type, r.secondary_type);
}
function patchedCapsFull(r) {
  const caps = {};
  for (const ability of ALL_ABILITIES) {
    const target = youthLoftForPotential(r.potentiale, YOUTH_PROGRESSION_CONFIG)
      * youthRoleFactorPatched(PATCHED_WEIGHTS_BY_TYPE, r.primary_type, r.secondary_type, ability, YOUTH_PROGRESSION_CONFIG);
    caps[ability] = clampCap(target);
  }
  return caps;
}

const UAFGJORT_GAP = 1.0;
function pairStats(riderList, weightsByType, capsFn, pair) {
  const [a, b] = pair;
  let uafgjort = 0;
  const gaps = [];
  for (const r of riderList) {
    const caps = capsFn(r);
    const sa = capsTypeScore(weightsByType, caps, a);
    const sb = capsTypeScore(weightsByType, caps, b);
    if (sa == null || sb == null) continue;
    const gap = Math.abs(sa - sb);
    gaps.push(gap);
    if (gap < UAFGJORT_GAP) uafgjort += 1;
  }
  gaps.sort((x, y) => x - y);
  return {
    pair: `${a}/${b}`,
    n: riderList.length,
    uafgjort,
    uafgjortPct: riderList.length ? (100 * uafgjort / riderList.length).toFixed(1) : "n/a",
    medianGap: gaps.length ? gaps[Math.floor(gaps.length / 2)].toFixed(2) : "n/a",
  };
}

function typeSpecificStats(riderList, weightsByType, capsFn, pair, dominantSide) {
  const [a, b] = pair;
  const filterType = dominantSide === "b" ? b : a;
  const subset = riderList.filter((r) => r.primary_type === filterType || r.secondary_type === filterType);
  return { filterType, ...pairStats(subset, weightsByType, capsFn, pair) };
}

console.log("=== FØR (baseline, BASE_WEIGHTS) ===");
console.log(JSON.stringify(pairStats(pot56, BASE_WEIGHTS_BY_TYPE, baselineCapsFull, ["tt", "gc"]), null, 2));
console.log(JSON.stringify(pairStats(pot56, BASE_WEIGHTS_BY_TYPE, baselineCapsFull, ["rouleur", "brostensrytter"]), null, 2));
console.log("--- type-specifik (superset-side camouflerer subset-side) ---");
console.log(JSON.stringify(typeSpecificStats(pot56, BASE_WEIGHTS_BY_TYPE, baselineCapsFull, ["tt", "gc"], "b"), null, 2));
console.log(JSON.stringify(typeSpecificStats(pot56, BASE_WEIGHTS_BY_TYPE, baselineCapsFull, ["rouleur", "brostensrytter"], "b"), null, 2));

console.log("\n=== EFTER (kandidat 1: global per-evne-ejerskab caps-faktor + gc.time_trial 3->2) ===");
console.log(JSON.stringify(pairStats(pot56, PATCHED_WEIGHTS_BY_TYPE, patchedCapsFull, ["tt", "gc"]), null, 2));
console.log(JSON.stringify(pairStats(pot56, PATCHED_WEIGHTS_BY_TYPE, patchedCapsFull, ["rouleur", "brostensrytter"]), null, 2));
console.log("--- type-specifik (superset-side camouflerer subset-side) ---");
console.log(JSON.stringify(typeSpecificStats(pot56, PATCHED_WEIGHTS_BY_TYPE, patchedCapsFull, ["tt", "gc"], "b"), null, 2));
console.log(JSON.stringify(typeSpecificStats(pot56, PATCHED_WEIGHTS_BY_TYPE, patchedCapsFull, ["rouleur", "brostensrytter"], "b"), null, 2));
console.log("--- kontrol: subset-side (tt/rouleur) uændret lav? ---");
console.log(JSON.stringify(typeSpecificStats(pot56, PATCHED_WEIGHTS_BY_TYPE, patchedCapsFull, ["tt", "gc"], "a"), null, 2));
console.log(JSON.stringify(typeSpecificStats(pot56, PATCHED_WEIGHTS_BY_TYPE, patchedCapsFull, ["rouleur", "brostensrytter"], "a"), null, 2));

// ── Fordelingsskift pr. type: median caps-type-score (egen type mod egne caps)
// FØR/EFTER, for at se om nogen type "kollapser" (falder markant).
console.log("\n=== Fordelingsskift: median egen-type caps-score pr. primær-type (pot-5-6) ===");
const TYPE_KEYS = CAPS_SHAPING_WEIGHTS.map((t) => t.key);
for (const type of TYPE_KEYS) {
  const subset = pot56.filter((r) => r.primary_type === type);
  if (!subset.length) continue;
  const beforeScores = subset.map((r) => capsTypeScore(BASE_WEIGHTS_BY_TYPE, baselineCapsFull(r), type)).sort((a, b) => a - b);
  const afterScores = subset.map((r) => capsTypeScore(PATCHED_WEIGHTS_BY_TYPE, patchedCapsFull(r), type)).sort((a, b) => a - b);
  const med = (arr) => arr[Math.floor(arr.length / 2)];
  console.log(`${type}: n=${subset.length} median FØR=${med(beforeScores).toFixed(1)} median EFTER=${med(afterScores).toFixed(1)} delta=${(med(afterScores) - med(beforeScores)).toFixed(1)}`);
}

// ── Max abs. ændring i loft pr. evne, fordelt over hele pot-5-6-populationen.
console.log("\n=== Max abs. ændring i loft pr. evne (pot-5-6, hele populationen) ===");
const maxDeltaByAbility = {};
const sumDeltaByAbility = {};
const nByAbility = {};
for (const r of pot56) {
  const before = baselineCapsFull(r);
  const after = patchedCapsFull(r);
  for (const ability of ALL_ABILITIES) {
    const b = before[ability];
    const a = after[ability];
    if (b == null || a == null) continue;
    const d = Math.abs(a - b);
    maxDeltaByAbility[ability] = Math.max(maxDeltaByAbility[ability] || 0, d);
    sumDeltaByAbility[ability] = (sumDeltaByAbility[ability] || 0) + d;
    nByAbility[ability] = (nByAbility[ability] || 0) + 1;
  }
}
for (const ability of Object.keys(maxDeltaByAbility).sort()) {
  console.log(`${ability}: max=${maxDeltaByAbility[ability]} mean=${(sumDeltaByAbility[ability] / nByAbility[ability]).toFixed(2)}`);
}

fs.writeFileSync(
  "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/82bfa4aa-694a-4b0e-8385-ae53af7e028b/scratchpad/3592/scorecard-output.json",
  JSON.stringify({
    before: {
      ttGc: pairStats(pot56, BASE_WEIGHTS_BY_TYPE, baselineCapsFull, ["tt", "gc"]),
      rouleurBrostens: pairStats(pot56, BASE_WEIGHTS_BY_TYPE, baselineCapsFull, ["rouleur", "brostensrytter"]),
      ttGcByGc: typeSpecificStats(pot56, BASE_WEIGHTS_BY_TYPE, baselineCapsFull, ["tt", "gc"], "b"),
      rouleurBrostensByBrostens: typeSpecificStats(pot56, BASE_WEIGHTS_BY_TYPE, baselineCapsFull, ["rouleur", "brostensrytter"], "b"),
    },
    after: {
      ttGc: pairStats(pot56, PATCHED_WEIGHTS_BY_TYPE, patchedCapsFull, ["tt", "gc"]),
      rouleurBrostens: pairStats(pot56, PATCHED_WEIGHTS_BY_TYPE, patchedCapsFull, ["rouleur", "brostensrytter"]),
      ttGcByGc: typeSpecificStats(pot56, PATCHED_WEIGHTS_BY_TYPE, patchedCapsFull, ["tt", "gc"], "b"),
      rouleurBrostensByBrostens: typeSpecificStats(pot56, PATCHED_WEIGHTS_BY_TYPE, patchedCapsFull, ["rouleur", "brostensrytter"], "b"),
    },
    maxDeltaByAbility,
  }, null, 2),
);
