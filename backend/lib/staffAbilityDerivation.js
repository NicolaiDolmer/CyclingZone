// Deterministisk staff-evne-generering (#2216 A4). Ingen I/O — ren funktion.
//
// Spejler to eksisterende mønstre:
//   1) mulberry32(hashString(...))-PRNG fra staffCandidates.js — reproducérbarhed er kontrakten
//      (samme (role,tier,name) → samme profil på refresh, ingen Math.random).
//   2) kontrast-skew fra abilityDerivation.js applyContrast(): skub hver akse væk fra profilens
//      EGEN median (out = median + k·(raw − median)), floor-clamp, så mindst én specialisering
//      rager op i stedet for en flad "god-til-alt"-profil.
//
// En staff-profil = { role, tier, overall, dimensions, levels, roleSkills }:
//   - training-rollen: fulde coaching-DIMENSIONER (physical/mental/technical) + niveau-affiniteter
//     (u23/senior — #2529: youth+junior kollapset til ét u23-bånd). roleSkills tom.
//   - øvrige roller: rolle-relevante roleSkills-akser (+ niveau-affiniteter hvor relevant).
//     dimensions tom (kun training coacher rytter-evne-dimensioner).
import { TIER_OVERALL_BAND, LEVEL_BANDS } from "./staffAbilityConstants.js";

// ── PRNG (spejler staffCandidates.js) ────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Kontrast-parametre (spejler abilityDerivation.CONTRAST): k>1 forstærker afstand fra
// akse-medianen; floor forhindrer at den svageste akse clampes til karikatur.
const CONTRAST = Object.freeze({ k: 1.55, floor: 8 });

// Rolle-akser: hvilke roleSkills-akser hver ikke-training-rolle har (§1 rolle-skew).
const ROLE_SKILL_AXES = Object.freeze({
  training: [],
  scouting: ["evaluation", "reach"],
  medical: ["recovery", "injuryPrevention"],
  academy: ["intake", "growth"],
  commercial: ["negotiation", "marketing"],
});

// Median af en talrække (bruges som kontrast-basis, som ownPhysicalMedian i abilityDerivation).
function medianOf(values) {
  const vals = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!vals.length) return 50;
  const mid = vals.length >> 1;
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

// Skub en talrække væk fra dens egen median (in-place-ækvivalent, returnerer ny map).
// Spejler applyContrast: out = round(median + k·(raw − median)), clamp [floor, 99].
function applyContrast(map, keys, { k = CONTRAST.k, floor = CONTRAST.floor } = {}) {
  const median = medianOf(keys.map((key) => map[key]));
  for (const key of keys) {
    const raw = map[key];
    if (!Number.isFinite(raw)) continue;
    map[key] = clamp(Math.round(median + k * (raw - median)), floor, 99);
  }
  return map;
}

// Træk et rå-tal inden for tier-båndet [lo,hi] via PRNG (basis-overall).
function drawInBand(rand, band) {
  return Math.round(band.lo + rand() * (band.hi - band.lo));
}

// Symmetrisk jitter ∈ [−spread, +spread] omkring en basis via PRNG (mean ≈ 0 over gruppen).
// Akserne trækkes omkring baseOverall, IKKE bredt i båndet, så overall forbliver bånd-forankret.
function jitter(rand, spread) {
  return Math.round((rand() * 2 - 1) * spread);
}

// Deterministisk "specialisering": spred gruppens HØJEST- og LAVEST-trukne akse fra hinanden
// (garanteret standout uanset seed). Spejler den additive arketype-skew i abilityDerivation,
// som kontrasten derefter forstærker væk fra medianen. Bidirektionel (løft top, dæmp bund) så
// et loft-clamp på top-aksen (99) ikke selv udsletter spredningen. Løftet er PRNG-drevet.
const SPEC_BOOST = Object.freeze({ min: 8, max: 16 });
function applySpecialization(rand, map, keys) {
  if (keys.length < 2) return;
  const boost = SPEC_BOOST.min + Math.round(rand() * (SPEC_BOOST.max - SPEC_BOOST.min));
  let top = keys[0], bottom = keys[0];
  for (const key of keys) {
    if (map[key] > map[top]) top = key;
    if (map[key] < map[bottom]) bottom = key;
  }
  map[top] = clamp(map[top] + boost, 1, 99);
  if (bottom !== top) map[bottom] = clamp(map[bottom] - boost, 1, 99);
}

/**
 * Deterministisk staff-evne-profil fra (role, tier, name).
 * @returns {{role:string, tier:number, overall:number,
 *            dimensions:Object, levels:Object, roleSkills:Object}}
 */
export function deriveStaffAbilities({ role, tier, name }) {
  const band = TIER_OVERALL_BAND[tier] ?? TIER_OVERALL_BAND[1];
  const rand = mulberry32(hashString(`${role}:${tier}:${name}`));

  const isTraining = role === "training";
  const dimensions = {};
  const levels = {};
  const roleSkills = {};

  // ── Bånd-forankret basis: overall trækkes i tier-båndet og er profilens "sande kvalitet". ─
  // Akserne skæver omkring basen (symmetrisk jitter), så gruppe-gennemsnittet ≈ base og
  // overall dermed forbliver i båndet uanset specialiserings-løft/kontrast.
  const overall = clamp(drawInBand(rand, band), 1, 99);
  const JITTER = 9; // rå spredning omkring basen før specialisering/kontrast

  // ── Rå-tal pr. akse: base + jitter ─────────────────────────────────────────
  if (isTraining) {
    for (const d of ["physical", "mental", "technical"]) dimensions[d] = clamp(overall + jitter(rand, JITTER), 1, 99);
  } else {
    for (const axis of ROLE_SKILL_AXES[role] ?? []) roleSkills[axis] = clamp(overall + jitter(rand, JITTER), 1, 99);
  }
  // Niveau-affiniteter: relevante for alle roller (en scout/akademi-chef har også alders-fokus).
  for (const l of LEVEL_BANDS) levels[l] = clamp(overall + jitter(rand, JITTER), 1, 99);

  // ── Specialisering + kontrast: løft højest-trukne akse, skub gruppen væk fra medianen → standout ─
  const primaryKeys = isTraining ? ["physical", "mental", "technical"] : (ROLE_SKILL_AXES[role] ?? []);
  const primaryMap = isTraining ? dimensions : roleSkills;
  applySpecialization(rand, primaryMap, primaryKeys);
  applySpecialization(rand, levels, LEVEL_BANDS);
  if (primaryKeys.length >= 2) applyContrast(primaryMap, primaryKeys);
  applyContrast(levels, LEVEL_BANDS);

  return { role, tier, overall, dimensions, levels, roleSkills };
}

// Bekvems-accessor (bruges af effekt-modellen i Task 6). Ren pass-through.
export function staffOverall(profile) {
  return profile?.overall ?? null;
}

// Etiket på den højest-scorende SKILL-akse (dimensions/roleSkills) — UI'ets
// "top-specialisering" (fx en trænings-chefs stærkeste coaching-dimension).
// #2695: `levels` (u23/senior niveau-affinitet = alders-FOKUS, ikke en skill)
// er BEVIDST udelukket her. Før #2529's 3→2-bånd-kollaps var levels spredt
// over 3 akser, så en enkelt niveau-affinitet sjældent slog en skill-dimension
// i denne sammenligning; med kun 2 bånd polariserer applySpecialization ALTID
// fuldt (den ene bånd boostes, den anden trækkes ned — ingen "midter"-akse til
// at dæmpe det), så et niveau-bånd nu ofte vinder rå-tal-sammenligningen og
// producerer en meningsløs headline som "Best at senior" (Discord-rapport,
// #2695). Niveau-affiniteten vises stadig, i sin egen kolonne (staffColumnsFor)
// — den skal bare aldrig kunne KAPRE skill-specialiserings-headline'en.
// Deterministisk: ved uafgjort vinder første akse i objekt-rækkefølgen
// (dimensions → roleSkills), som er stabil på refresh.
export function topSpecialization(profile) {
  if (!profile) return null;
  const axes = { ...profile.dimensions, ...profile.roleSkills };
  let bestKey = null;
  let bestVal = -Infinity;
  for (const [key, val] of Object.entries(axes)) {
    if (val > bestVal) { bestVal = val; bestKey = key; }
  }
  return bestKey;
}
