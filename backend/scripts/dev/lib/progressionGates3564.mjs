// #3564 — porte for progressionskæden (potentiale → loft → startniveau → vækst → type → værdi → løn).
//
// RENE funktioner: population ind, { id, navn, pass, målt, grænse, detaljer } ud. INGEN DB,
// INGEN mutation af motor-kode — filen importerer udelukkende EKSISTERENDE, uændrede
// funktioner fra backend/lib/*.js (academyGenerator, riderProgression, abilityDerivation,
// physiologySeeding, riderTypes) og bygger porte-logik OVENPÅ dem.
//
// Navngivning følger spec §6 (docs/superpowers/specs/2026-08-09-3564-progressionskaede-
// samlet-design.md): I1-I3 = de omdøbte 9/8-invarianter (design-princip 8); T1-T4 = de nye
// porte pr. trin. Se gates3564NegativeProof.mjs for BEVISET (hver port skal fejle på >=1
// kendt defekt-fixture og bestå F5/sund-population — design-princip 5).

import {
  buildCapsForRider,
  buildYouthCaps,
  YOUTH_PROGRESSION_CONFIG,
} from "../../../lib/riderProgression.js";
import { VISIBLE_ABILITIES } from "../../../lib/abilityDerivation.js";
import { deriveAbilities } from "../../../lib/abilityDerivation.js";
import { seedPhysiologyFromLegacy } from "../../../lib/physiologySeeding.js";
import { computeRiderTypes, NEUTRAL_BASELINE } from "../../../lib/riderTypes.js";
import { generateAcademyCandidates, POTENTIALE_TIERS, POTENTIALE_DECAY } from "../../../lib/academyGenerator.js";

// ── Fælles konstanter ──────────────────────────────────────────────────────────
// De 10 fysiske evner (aggression UNDTAGET — alders-drevet gulv, se
// abilityDerivation.js's aggressionFrac / archetypeGenerationGates.test.js's kommentar).
export const PHYSICAL_ABILITIES = Object.freeze([
  "climbing", "time_trial", "flat", "tempo", "sprint",
  "acceleration", "punch", "endurance", "recovery", "durability",
]);

// ── Statistik-hjælpere ──────────────────────────────────────────────────────────
export function median(values) {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Nearest-rank percentil (p ∈ [0,100]). Dokumenteret metodevalg: simpel, deterministisk,
// ingen interpolation mellem punkter — konservativ for hale-gates (runder MOD den
// strengeste nabo-observation, ikke imellem).
export function percentile(values, p) {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

// Lineær interpolation af loftByPotential (duplikerer bevidst riderProgression.js' private
// youthLoftForPotential — gate-koden må IKKE afhænge af interne, ueksporterede detaljer i
// motoren, og formlen er triviel/read-only. cfg.loftByPotential er selve motorens EGEN,
// importerede tabel — kun interpolationen er duplikeret, ikke tallene). ROUNDET til
// nærmeste hele tal, PRÆCIS som buildYouthCaps/youthAbilityCap gør (Math.round(target)) —
// uden dette runder motoren .5-tiers OP (fx pot 1.5 → 42, ikke 41.5) mens en urundet
// grænse her ville give falske brud på netop de halve tiers (målt: pot1.5 p99=42 mod en
// urundet grænse på 41.5 — 0 reelle brud, ét regnefejl-brud).
export function loftForPotential(potentiale, loftByPotential = YOUTH_PROGRESSION_CONFIG.loftByPotential) {
  const p = Math.max(1, Math.min(6, Number(potentiale) || 1));
  const lo = Math.floor(p), hi = Math.ceil(p);
  const a = loftByPotential[lo] ?? 0;
  const b = loftByPotential[hi] ?? a;
  return Math.round(a + (b - a) * (p - lo));
}

// P(potentiale >= threshold) under academyGenerator.js's EGEN geometriske trækfordeling
// (POTENTIALE_TIERS × POTENTIALE_DECAY, importeret read-only — ikke en hardkodet konstant,
// så gaten forbliver korrekt hvis decay-raten ændres).
export function geometricTailProbability(threshold) {
  const weights = POTENTIALE_TIERS.map((_, k) => POTENTIALE_DECAY ** k);
  const sum = weights.reduce((a, b) => a + b, 0);
  let tail = 0;
  POTENTIALE_TIERS.forEach((t, k) => { if (t >= threshold) tail += weights[k]; });
  return tail / sum;
}

// Halemasse på den KONTINUERTE 1-99-målfordeling (trin 1-remappen: tier k=0..10 har
// centrum 1+k·9,8, massen 0,55^k spredt uniformt over ±4,9 klippet til [1,99]).
// FORLIG 9/8 (harness-runden): P(pot99 ≥ 90) = 0,201 % — IKKE det samme som
// geometricTailProbability(5.5) = 0,322 % på den diskrete 1-6-skala, fordi tier 9
// (centrum 89,2) har ca. halvdelen af sin masse UNDER 90 efter spredningen. Brug
// denne til post-migrations-populationer (1-99) og den diskrete til dagens 1-6-tal.
export function continuousTailProbability99(threshold = 90) {
  const weights = POTENTIALE_TIERS.map((_, k) => POTENTIALE_DECAY ** k);
  const sum = weights.reduce((a, b) => a + b, 0);
  let tail = 0;
  for (let k = 0; k < POTENTIALE_TIERS.length; k++) {
    const v = 1 + k * 9.8;
    const lo = Math.max(v - 4.9, 1), hi = Math.min(v + 4.9, 99);
    const over = Math.max(0, hi - Math.max(lo, threshold));
    const span = hi - lo;
    if (over > 0 && span > 0) tail += (weights[k] / sum) * (over / span);
  }
  return tail;
}

function result(id, navn, pass, målt, grænse, detaljer) {
  return { id, navn, pass, målt, grænse, detaljer };
}

// ── Afled-kæde: spejler PRÆCIS archetypeGenerationGates.test.js' runCohort ─────────
// (generateAcademyCandidates → seedPhysiologyFromLegacy → deriveAbilities →
//  computeRiderTypes(NEUTRAL_BASELINE) → buildCapsForRider → computeRiderTypes(typesBaseline)).
//
// Returnerer ét "cohort record" pr. rytter — den fælles valuta alle T1/T3/I-porte spiser.
export function buildCohortRecord({ riderRow, id, referenceYear, typesBaseline, includeAge = true }) {
  const rr = { id, ...riderRow };
  const physiology = seedPhysiologyFromLegacy(rr);
  const abilities = deriveAbilities(physiology, rr);
  const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);
  const baseline = {};
  for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
  const age = includeAge ? referenceYear - Number(String(rr.birthdate).slice(0, 4)) : undefined;
  const caps = buildCapsForRider(baseline, { potentiale: rr.potentiale, age }, bootstrap.primary.key, bootstrap.secondary.key);
  const final = typesBaseline ? computeRiderTypes(caps, typesBaseline) : bootstrap;
  const youthCaps = buildYouthCaps(rr.potentiale, bootstrap.primary.key, bootstrap.secondary.key);
  const physVals = PHYSICAL_ABILITIES.map((a) => Number(abilities[a]) || 0).sort((a, b) => b - a);
  const bestPhysical = physVals[0] ?? 0;
  const secondBestPhysical = physVals[1] ?? 0;
  const corePhysical = median(PHYSICAL_ABILITIES.map((a) => Number(abilities[a]) || 0));
  const loft = Math.max(...VISIBLE_ABILITIES.map((a) => Number(youthCaps[a]) || 0));
  return {
    id, age, potentiale: rr.potentiale,
    primaryType: final.primary.key, secondaryType: final.secondary.key,
    bootstrapPrimary: bootstrap.primary.key, bootstrapSecondary: bootstrap.secondary.key,
    abilities, caps, youthCaps, bestPhysical, secondBestPhysical, corePhysical,
    loft, ratio: loft ? bestPhysical / loft : 0,
  };
}

// Generér ét akademi-kuld og afled cohort-records for hver kandidat. genCfg (valgfri)
// sendes UÆNDRET videre til generateAcademyCandidates — KUN til kalibrerings-/gate-
// harnesses, jf. academyGenerator.js's egen dokumentation af parameteren.
export function deriveCohort({ rng, referenceYear, count, genCfg, typesBaseline, idPrefix = "cand" }) {
  const cands = generateAcademyCandidates({ rng, referenceYear, existingNames: new Set(), countOverride: count, genCfg });
  return cands.map((c, i) => buildCohortRecord({ riderRow: c.rider, id: `${idPrefix}-${i}`, referenceYear, typesBaseline }));
}

// ════════════════════════════════════════════════════════════════════════════════
// I1-I3 — de omdøbte 9/8-invarianter (design-princip 8), wrappet som gate-funktioner
// så de indgår i samme matrix som de nye T1-T4-porte. Semantikken er UÆNDRET fra
// archetypeGenerationGates.test.js' G5/G6/G7 — kun input-formen (records) er ny.
// ════════════════════════════════════════════════════════════════════════════════

// I1 (= T1-N1): current må ALDRIG løfte ability_caps over potentiale-loftet. 100 %, 0 tolerance.
export function gateI1CapsWithinPotentialLoft(records) {
  const brud = [];
  for (const r of records) {
    const maxCap = Math.max(...VISIBLE_ABILITIES.map((a) => Number(r.caps?.[a]) || 0));
    const maxLoft = Math.max(...VISIBLE_ABILITIES.map((a) => Number(r.youthCaps?.[a]) || 0));
    if (maxCap > maxLoft) brud.push({ id: r.id, potentiale: r.potentiale, maxCap, maxLoft });
  }
  return result(
    "I1/T1-N1", "caps ≤ potentiale-loft (buildYouthCaps-max), 100 %, ingen tolerance",
    brud.length === 0,
    `${brud.length}/${records.length} brud`,
    "0 brud",
    { brudEksempel: brud.slice(0, 5), antalBrud: brud.length, n: records.length },
  );
}

// I2: ingen afledt fysisk evne over ungdomsbånd-loftet (default 15).
export function gateI2YouthBandCeiling(records, { ceiling = 15 } = {}) {
  let værst = null;
  for (const r of records) {
    for (const a of PHYSICAL_ABILITIES) {
      const v = Number(r.abilities?.[a]) || 0;
      if (!værst || v > værst.v) værst = { v, ability: a, id: r.id, pot: r.potentiale };
    }
  }
  const pass = (værst?.v ?? 0) <= ceiling;
  return result(
    "I2", `ungdomsbånd: ingen afledt fysisk evne over ${ceiling}`,
    pass, `højeste ${værst?.v ?? "n/a"} (${værst?.ability}, pot ${værst?.pot})`, `≤ ${ceiling}`,
    { værst, n: records.length },
  );
}

// I3: højst maxPct % af 16-17-årige født på graduerings-niveau (default evne 12).
export function gateI3GraduationLevelTail(records, { level = 12, maxPct = 5 } = {}) {
  const unge = records.filter((r) => r.age <= 17);
  const iToppen = unge.filter((r) => r.bestPhysical >= level);
  const pct = unge.length ? (iToppen.length / unge.length) * 100 : 0;
  return result(
    "I3", `≤${maxPct} % af 16-17-årige født på graduerings-niveau ${level}`,
    pct <= maxPct, `${pct.toFixed(1)} % (${iToppen.length}/${unge.length})`, `≤ ${maxPct} %`,
    { pct, n: unge.length, over: iToppen.length },
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// Trin 1 — potentiale + lofter
// ════════════════════════════════════════════════════════════════════════════════

// T1-N2: p99(max caps) ≤ loft pr. potentiale-tier (statistisk søster til I1's 100%-invariant).
export function gateT1N2P99CapsPerTier(records) {
  const byTier = new Map();
  for (const r of records) {
    const maxCap = Math.max(...VISIBLE_ABILITIES.map((a) => Number(r.caps?.[a]) || 0));
    if (!byTier.has(r.potentiale)) byTier.set(r.potentiale, []);
    byTier.get(r.potentiale).push(maxCap);
  }
  const detaljer = [];
  let pass = true;
  for (const [tier, caps] of [...byTier.entries()].sort((a, b) => a[0] - b[0])) {
    const grænse = loftForPotential(tier);
    const p99 = percentile(caps, 99);
    const ok = p99 <= grænse;
    if (!ok) pass = false;
    detaljer.push({ tier, p99, grænse, n: caps.length, ok });
  }
  return result(
    "T1-N2", "p99(max caps) ≤ loft pr. potentiale-tier",
    pass, detaljer.map((d) => `pot${d.tier}: p99=${d.p99}/${d.grænse}${d.ok ? "" : " BRUD"}`).join("; "),
    "p99 ≤ loft, alle tiers", { detaljer },
  );
}

// T1-N3: post-remap-fordeling inden for ±tolerancePp af mål pr. gruppe (fx aldersgruppe).
// Tager {fordeling, mål} som RÅ input — er derfor uafhængig af hvordan den underliggende
// remap-kørsel producerede fordelingen (skal kunne bruges på trin 1-migrationens dry-run-diff).
export function gateT1N3PostRemapDistribution({ fordeling, mål, tolerancePp = 2 } = {}) {
  const keys = new Set([...Object.keys(fordeling || {}), ...Object.keys(mål || {})]);
  const detaljer = [];
  let pass = true;
  for (const k of keys) {
    const f = Number(fordeling?.[k]) || 0;
    const m = Number(mål?.[k]) || 0;
    const diffPp = Math.abs(f - m);
    const ok = diffPp <= tolerancePp;
    if (!ok) pass = false;
    detaljer.push({ gruppe: k, fordeling: f, mål: m, diffPp, ok });
  }
  return result(
    "T1-N3", `post-remap-fordeling inden for ±${tolerancePp}pp af mål pr. gruppe`,
    pass, detaljer.map((d) => `${d.gruppe}: ${d.diffPp.toFixed(2)}pp${d.ok ? "" : " BRUD"}`).join("; "),
    `≤ ${tolerancePp}pp afvigelse pr. gruppe`, { detaljer },
  );
}

// T1-H1: hårdt loft på antal pot ≥ threshold (default 5.5 på 1-6-skalaen, ≈ pot ≥90 på
// 1-99) pr. kuld ELLER i beholdningen — mod geometriens egen forventede hale + 3×binomial-σ.
// label skelner "flow" (pr. kuld) fra "stock" (beholdning) i matrix-outputtet; samme funktion.
export function gateT1H1PotentialeTail(potentialeValues, { label = "flow", threshold = 5.5, sigmaMult = 3, nOverride = null, pOverride = null } = {}) {
  const n = nOverride ?? potentialeValues.length;
  // pOverride: post-migrations-populationer på 1-99-skalaen skal bruge
  // continuousTailProbability99(90) = 0,201 % i stedet for den diskrete 1-6-hale.
  const p = pOverride ?? geometricTailProbability(threshold);
  const count = potentialeValues.filter((v) => Number(v) >= threshold).length;
  const expected = n * p;
  const sigma = Math.sqrt(n * p * (1 - p));
  const limit = expected + sigmaMult * sigma;
  return result(
    `T1-H1(${label})`, `potentiale-hale (${label}): antal ≥ ${threshold} ≤ forventet + ${sigmaMult}σ (P≈${(p * 100).toFixed(2)}%)`,
    count <= limit, `${count} (forventet ${expected.toFixed(2)}, σ=${sigma.toFixed(2)})`, `≤ ${limit.toFixed(2)}`,
    { n, p, count, expected, sigma, limit, threshold },
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// Trin 2 — vækstkurven
// ════════════════════════════════════════════════════════════════════════════════

// Anti-frontloading-tabellen (skelet-interpoleret + 15pp buffer, jf. OPGAVE). Parametrisk —
// dokumenteret trin-2-kalibrérbar (kan justeres når §5-skelettet låses, IKKE gatens formel).
export const ANTI_FRONTLOADING_MAX_PCT = Object.freeze([
  { age: 16, maxPct: 0.25 },
  { age: 18, maxPct: 0.40 },
  { age: 19, maxPct: 0.48 },
  { age: 20, maxPct: 0.55 },
  { age: 22, maxPct: 0.75 },
  { age: 25, maxPct: 0.95 },
  { age: 27, maxPct: 1.00 },
]);

function interpolateTable(age, table) {
  if (age <= table[0].age) return table[0].maxPct;
  for (let i = 1; i < table.length; i++) {
    const prev = table[i - 1], cur = table[i];
    if (age <= cur.age) {
      const t = (age - prev.age) / (cur.age - prev.age);
      return prev.maxPct + (cur.maxPct - prev.maxPct) * t;
    }
  }
  return table[table.length - 1].maxPct;
}

// T2-N1: pr. (årgang × potentiale-bånd) må median(best_physical/loft) ikke overstige
// alders-max. Records skal have { age, ratio } (ratio = bestPhysical/loft over EGEN evne-loft).
export function gateT2N1AntiFrontloading(records, { table = ANTI_FRONTLOADING_MAX_PCT } = {}) {
  const byAge = new Map();
  for (const r of records) {
    if (!byAge.has(r.age)) byAge.set(r.age, []);
    byAge.get(r.age).push(r.ratio);
  }
  const detaljer = [];
  let pass = true;
  for (const [age, ratios] of [...byAge.entries()].sort((a, b) => a[0] - b[0])) {
    const med = median(ratios);
    const grænse = interpolateTable(age, table);
    const ok = med <= grænse;
    if (!ok) pass = false;
    detaljer.push({ age, medianRatio: med, grænse, n: ratios.length, ok });
  }
  return result(
    "T2-N1", "anti-frontloading: median(best/loft) ≤ aldersbåndets max-%-af-loft",
    pass,
    detaljer.filter((d) => !d.ok).map((d) => `alder ${d.age}: ${(d.medianRatio * 100).toFixed(1)}% > ${(d.grænse * 100).toFixed(0)}%`).join("; ") || "alle aldre inden for grænsen",
    "se ANTI_FRONTLOADING_MAX_PCT", { detaljer },
  );
}

// §5-skelettet (FORESLÅET, best_physical ved 16/22/28 pr. potentiale). Bruges KUN af T2-M1.
export const SKELETON_ANCHORS = Object.freeze({
  1: { 16: 4, 22: 22, 28: 33 },
  2: { 16: 5, 22: 29, 28: 45 },
  3: { 16: 6, 22: 36, 28: 57 },
  4: { 16: 6, 22: 42, 28: 67 },
  5: { 16: 6, 22: 48, 28: 77 },
  6: { 16: 6, 22: 53, 28: 86 },
});

// T2-M1: median best_physical pr. (alder × potentiale) inden for ±toleranceFrac af
// skelettet VED ankerarene 16/22/28. Kun de aldre der er anker-punkter kontrolleres
// (kurveformen mellem ankrene er beslutning 4/#2698, ikke denne gates ansvar).
export function gateT2M1MedianAtAnchors(records, { skeleton = SKELETON_ANCHORS, toleranceFrac = 0.15 } = {}) {
  const detaljer = [];
  let pass = true;
  for (const potKey of Object.keys(skeleton)) {
    const pot = Number(potKey);
    for (const [ageKey, target] of Object.entries(skeleton[potKey])) {
      const age = Number(ageKey);
      const vals = records.filter((r) => Math.round(r.potentiale) === pot && r.age === age).map((r) => r.bestPhysical);
      if (!vals.length) { detaljer.push({ pot, age, target, note: "ingen data", ok: null }); continue; }
      const med = median(vals);
      const lo = target * (1 - toleranceFrac), hi = target * (1 + toleranceFrac);
      const ok = med >= lo && med <= hi;
      if (!ok) pass = false;
      detaljer.push({ pot, age, median: med, target, lo, hi, ok, n: vals.length });
    }
  }
  const relevante = detaljer.filter((d) => d.ok !== null);
  return result(
    "T2-M1", `median best_physical ved anker-alder inden for ±${toleranceFrac * 100}% af §5-skelettet`,
    pass && relevante.length > 0,
    detaljer.filter((d) => d.ok === false).map((d) => `pot${d.pot}@${d.age}: ${d.median} vs mål ${d.target} [${d.lo.toFixed(1)}-${d.hi.toFixed(1)}]`).join("; ") || (relevante.length ? "alle ankre inden for tolerance" : "INGEN DATA på nogen anker (n/a)"),
    `±${toleranceFrac * 100}%`, { detaljer },
  );
}

// T2-H1: højst maxPct % af 21-årige med nul specialiserings-gab (bedste − næstbedste == 0).
export function gateT2H1ZeroGapAt21(records, { age = 21, maxPct = 5 } = {}) {
  const at21 = records.filter((r) => r.age === age);
  const zero = at21.filter((r) => (r.bestPhysical - r.secondBestPhysical) === 0);
  const pct = at21.length ? (zero.length / at21.length) * 100 : 0;
  return result(
    "T2-H1", `≤${maxPct} % af ${age}-årige med nul specialiserings-gab`,
    at21.length > 0 && pct <= maxPct, `${pct.toFixed(1)} % (${zero.length}/${at21.length})`, `≤ ${maxPct} %`,
    { pct, zero: zero.length, n: at21.length },
  );
}

// T2-H2: højst maxPct % pr. årgang over ratioThreshold af eget loft FØR alder ageLimit.
export function gateT2H2Over85PctBeforeAge24(records, { ageLimit = 24, ratioThreshold = 0.85, maxPct = 5 } = {}) {
  const byAge = new Map();
  for (const r of records) {
    if (r.age >= ageLimit) continue;
    if (!byAge.has(r.age)) byAge.set(r.age, []);
    byAge.get(r.age).push(r);
  }
  const detaljer = [];
  let pass = byAge.size > 0;
  for (const [age, recs] of [...byAge.entries()].sort((a, b) => a[0] - b[0])) {
    const over = recs.filter((r) => r.ratio > ratioThreshold);
    const pct = (over.length / recs.length) * 100;
    const ok = pct <= maxPct;
    if (!ok) pass = false;
    detaljer.push({ age, pct, n: recs.length, over: over.length, ok });
  }
  return result(
    "T2-H2", `≤${maxPct} % pr. årgang over ${ratioThreshold * 100}% af eget loft før ${ageLimit} år`,
    pass, detaljer.filter((d) => !d.ok).map((d) => `alder ${d.age}: ${d.pct.toFixed(1)}%`).join("; ") || "alle aldre inden for grænsen",
    `≤ ${maxPct} %`, { detaljer },
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// Trin 3 — startniveau/generator
// ════════════════════════════════════════════════════════════════════════════════

// #2064 §2a-ankrene (LÅSTE) — bruges KUN af T3-M1.
export const BAND_2A_TARGETS = Object.freeze({ "16-17": [3, 6], "18-19": [8, 12], "20-21": [12, 12] });
function bandOf(age) { return age <= 17 ? "16-17" : age <= 19 ? "18-19" : "20-21"; }

// T3-M1: §2a-medianerne TOSIDET — kerne og bedste pr. aldersbånd skal ligge i [mål-1,mål+1].
// checkYouthBand2064.mjs's gamle "ok" testede kun ≤ og kaldte underkorrektion "ok" — denne
// gate fanger BEGGE fortegn.
export function gateT3M1TwoSidedBands(records, { targets = BAND_2A_TARGETS, tol = 1 } = {}) {
  const by = { "16-17": { k: [], b: [] }, "18-19": { k: [], b: [] }, "20-21": { k: [], b: [] } };
  for (const r of records) {
    const b = bandOf(r.age);
    if (!by[b]) continue;
    by[b].k.push(r.corePhysical);
    by[b].b.push(r.bestPhysical);
  }
  const detaljer = [];
  let pass = true;
  for (const [band, [mk, mb]] of Object.entries(targets)) {
    if (!by[band].k.length) { detaljer.push({ band, note: "ingen data", ok: null }); pass = false; continue; }
    const k = median(by[band].k), bb = median(by[band].b);
    const kOk = k >= mk - tol && k <= mk + tol;
    const bOk = bb >= mb - tol && bb <= mb + tol;
    const status = (k < mk - tol || bb < mb - tol) ? "UNDER MÅL" : (k > mk + tol || bb > mb + tol) ? "OVER MÅL" : "ok";
    if (!(kOk && bOk)) pass = false;
    detaljer.push({ band, kerne: k, kerneMål: mk, bedste: bb, bedsteMål: mb, status, n: by[band].k.length, ok: kOk && bOk });
  }
  return result(
    "T3-M1", `§2a-medianer tosidet [mål−${tol}, mål+${tol}] (kerne+bedste)`,
    pass, detaljer.map((d) => d.note ? `${d.band}: ${d.note}` : `${d.band}: kerne ${d.kerne}(${d.kerneMål}) bedste ${d.bedste}(${d.bedsteMål}) ${d.status}`).join("; "),
    `±${tol} om målet`, { detaljer },
  );
}

// T3-N2: voksen-generator-stier — ingen genereret evne > loftByPotential[pot]. Tager en
// VILKÅRLIG genereret population: [{ id, potentiale, generatedAbility }] ELLER
// [{ id, potentiale, abilities }] (så begge input-former fra forskellige generator-stier dækkes).
export function gateT3N2AdultPathsWithinLoft(records, { loftByPotential = YOUTH_PROGRESSION_CONFIG.loftByPotential } = {}) {
  const brud = [];
  for (const r of records) {
    const loft = loftForPotential(r.potentiale, loftByPotential);
    const maxAbility = r.generatedAbility != null
      ? Number(r.generatedAbility)
      : Math.max(...Object.values(r.abilities || {}).map(Number).filter(Number.isFinite));
    if (maxAbility > loft) brud.push({ id: r.id, potentiale: r.potentiale, maxAbility, loft });
  }
  return result(
    "T3-N2", "voksen-generator-stier: ingen genereret evne > loftByPotential[pot]",
    brud.length === 0, `${brud.length}/${records.length} brud`, "0 brud",
    { brudEksempel: brud.slice(0, 5), antalBrud: brud.length, n: records.length },
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// Trin 4 — værdi + løn
// ════════════════════════════════════════════════════════════════════════════════

// T4-N1: total market_value ±totalToleranceFrac af snapshot + hårdt enkeltrytter-loft.
// before/after: arrays af tal ELLER { value } — begge accepteres.
export function gateT4N1ValueTotalAndCap({ before = [], after = [], totalToleranceFrac = 0.05, hardCapPerRider = null } = {}) {
  const val = (x) => Number(x?.value ?? x) || 0;
  const totalBefore = before.reduce((a, b) => a + val(b), 0);
  const totalAfter = after.reduce((a, b) => a + val(b), 0);
  const diffFrac = totalBefore ? Math.abs(totalAfter - totalBefore) / totalBefore : 0;
  const totalOk = diffFrac <= totalToleranceFrac;
  const capBrud = hardCapPerRider != null ? after.filter((x) => val(x) > hardCapPerRider) : [];
  return result(
    "T4-N1", `total-værdi ±${(totalToleranceFrac * 100).toFixed(0)}% af snapshot + hårdt enkeltrytter-loft`,
    totalOk && capBrud.length === 0,
    `total-diff ${(diffFrac * 100).toFixed(2)}% (${totalBefore.toFixed(0)} → ${totalAfter.toFixed(0)}); ${capBrud.length} over loft`,
    `≤ ${(totalToleranceFrac * 100).toFixed(0)}% / enkeltloft ${hardCapPerRider ?? "n/a"}`,
    { totalBefore, totalAfter, diffFrac, capBrud: capBrud.slice(0, 5), antalCapBrud: capBrud.length },
  );
}

// T4-H1: p99 pr. aldersgruppe flytter ≤maxMovementFrac pr. sweep + løn-gates (gulv, p90
// løn/værdi-loft, max enkeltløn). beforeByAgeGroup/afterByAgeGroup: { gruppe: [tal...] }.
// salaries: [{ salary, value }].
export function gateT4H1ValueMovementAndSalary({
  beforeByAgeGroup = {}, afterByAgeGroup = {}, maxMovementFrac = 0.25,
  salaries = [], salaryFloor = 250, salaryValueP90CapFrac = null, maxSingleSalary = null,
} = {}) {
  const groups = new Set([...Object.keys(beforeByAgeGroup), ...Object.keys(afterByAgeGroup)]);
  const moveDetail = [];
  let moveOk = true;
  for (const g of groups) {
    const b = percentile(beforeByAgeGroup[g] || [], 99);
    const a = percentile(afterByAgeGroup[g] || [], 99);
    const frac = Number.isFinite(b) && b ? Math.abs(a - b) / b : 0;
    const ok = frac <= maxMovementFrac;
    if (!ok) moveOk = false;
    moveDetail.push({ group: g, p99Before: b, p99After: a, frac, ok });
  }
  const floorBrud = salaries.filter((s) => Number(s.salary) > 0 && Number(s.salary) < salaryFloor);
  const singleBrud = maxSingleSalary != null ? salaries.filter((s) => Number(s.salary) > maxSingleSalary) : [];
  let p90 = null, p90Brud = false;
  if (salaryValueP90CapFrac != null) {
    const ratios = salaries.filter((s) => Number(s.value) > 0).map((s) => Number(s.salary) / Number(s.value));
    p90 = percentile(ratios, 90);
    p90Brud = Number.isFinite(p90) && p90 > salaryValueP90CapFrac;
  }
  const pass = moveOk && floorBrud.length === 0 && singleBrud.length === 0 && !p90Brud;
  return result(
    "T4-H1", `p99-bevægelse ≤${(maxMovementFrac * 100).toFixed(0)}%/sweep + løn-gates (gulv ${salaryFloor} / p90-loft / enkeltløn-loft)`,
    pass,
    `bevægelse: ${moveDetail.map((d) => `${d.group}:${(d.frac * 100).toFixed(1)}%`).join(", ") || "n/a"}; ` +
    `gulvbrud ${floorBrud.length}; enkeltløn-brud ${singleBrud.length}; p90 ${p90 != null ? (p90 * 100).toFixed(1) + "%" : "n/a"}${p90Brud ? " BRUD" : ""}`,
    `≤${(maxMovementFrac * 100).toFixed(0)}% / gulv ${salaryFloor} / p90≤${salaryValueP90CapFrac ?? "n/a"} / enkeltløn≤${maxSingleSalary ?? "n/a"}`,
    { moveDetail, floorBrud: floorBrud.slice(0, 5), antalFloorBrud: floorBrud.length, singleBrud: singleBrud.slice(0, 5), antalSingleBrud: singleBrud.length, p90, p90Brud },
  );
}
