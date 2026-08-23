// #3371 - permutationsvalg for korte etapeløbs (5-8 etaper) rækkefølge i S3.
//
// HVORFOR EN EGEN SCORER (ikke stageOrderMetrics.js). Den fil måler SÆSON-niveau
// (mountain-finish %, delte sekvenser på tværs af hele kalenderen - se dens egen
// header). Ejer-direktivet 23/8 for #3371 er derimod et PR-LØB-niveau-krav: maks 2
// bjerg/high_mountain i træk, mindst én flat/rolling/hilly mellem to bjergblokke,
// ITT aldrig to i træk, første etape helst flat/rolling/itt. stageOrderMetrics.js
// har ingen af de begreber (den tæller kun første/sidste etape og delte sekvenser).
// Denne fil er derfor en NY, ren scorer - ingen DB/side-effekt.
//
// INTET HER RØRER EN DATABASE. Ingen import af supabase, ingen process.env.
//
// Refs #3371.

import { makeRng } from "../../lib/fictionalRiderGenerator.js";

export const MOUNTAIN_TYPES = new Set(["mountain", "high_mountain"]);
export const BREAKER_TYPES = new Set(["flat", "rolling", "hilly"]);
export const TT_TYPES = new Set(["itt", "itt_hilly"]);
export const PREFERRED_OPENERS = new Set(["flat", "rolling", "itt"]);

// FNV-1a 32-bit → heltals-seed. Samme algoritme som raceStageProfileGenerator.js's
// (ueksporterede) stableSeed - dupliceret bevidst: 8 linjer, ikke værd at skabe en
// delt afhængighed mellem lib/ (generatoren) og scripts/lib/ (dette engangsværktøj) for.
export function stableSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Tæl de tre HÅRDE brud-typer i en profile_type-sekvens, plus åbnings-præferencen
 * (soft - tælles separat, indgår ikke i `total`). Ren.
 *
 * @param {string[]} types  profile_type i etape-rækkefølge
 */
export function countViolations(types) {
  let mountainStreak = 0;
  let mountainBreak = 0;
  let ttAdjacent = 0;

  // Maks 2 bjerg i træk: hver etape ud over de første 2 i en sammenhængende
  // bjerg-blok tæller som ét brud.
  let run = 0;
  for (const t of types) {
    if (MOUNTAIN_TYPES.has(t)) {
      run++;
      if (run > 2) mountainStreak++;
    } else {
      run = 0;
    }
  }

  // Bjergblokke skal adskilles af mindst én flat/rolling/hilly: find blok-grænser
  // og tjek at der er en "breaker"-etape mellem hvert konsekutivt blok-par (en ITT
  // eller andet neutralt terræn mellem to blokke tæller IKKE som adskillelse).
  const blocks = [];
  let i = 0;
  while (i < types.length) {
    if (MOUNTAIN_TYPES.has(types[i])) {
      const start = i;
      while (i < types.length && MOUNTAIN_TYPES.has(types[i])) i++;
      blocks.push([start, i - 1]);
    } else {
      i++;
    }
  }
  for (let b = 0; b < blocks.length - 1; b++) {
    const between = types.slice(blocks[b][1] + 1, blocks[b + 1][0]);
    if (!between.some((t) => BREAKER_TYPES.has(t))) mountainBreak++;
  }

  // ITT aldrig to i træk.
  for (let j = 0; j < types.length - 1; j++) {
    if (TT_TYPES.has(types[j]) && TT_TYPES.has(types[j + 1])) ttAdjacent++;
  }

  const total = mountainStreak + mountainBreak + ttAdjacent;
  const openingOk = types.length === 0 || PREFERRED_OPENERS.has(types[0]);
  return { mountainStreak, mountainBreak, ttAdjacent, total, openingOk };
}

// Heap's algoritme - genererer ALLE permutationer af [0..n-1] som en liste af
// arrays (ikke en generator: opgavens loft er n ≤ 8 → maks 40.320 arrays, triviel
// hukommelse/CPU for et engangsscript).
function allPermutations(n) {
  const indices = Array.from({ length: n }, (_, idx) => idx);
  const result = [indices.slice()];
  const c = new Array(n).fill(0);
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      const swapWith = i % 2 === 0 ? 0 : c[i];
      [indices[swapWith], indices[i]] = [indices[i], indices[swapWith]];
      result.push(indices.slice());
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
  return result;
}

function cmpScore(a, b) {
  for (let k = 0; k < a.length; k++) {
    if (a[k] !== b[k]) return a[k] - b[k];
  }
  return 0;
}

/**
 * Vælg den permutation af `stages` (sorteret efter nuværende stage_number) der
 * minimerer, i rækkefølge: (1) hårde brud (countViolations().total), (2) samlet
 * flytning fra oprindelig position, (3) manglende åbnings-præference. Ties brydes
 * deterministisk med en seedet rng pr. `seedKey` (typisk race_id) - giver den
 * ejer-krævede sæson-variation ("bjergafslutning ok i ca. halvdelen af løbene,
 * varieret pr. seed") uden en eksplicit anti-bjergfinale-regel, som ville have
 * tvunget ALLE løb væk fra bjergfinale.
 *
 * Fuld brute force over permutationsrummet (ikke en heuristik): for n ≤ 8 er det
 * ≤ 40.320 kandidater, og brute force er den eneste måde at GARANTERE at den
 * returnerede permutation faktisk er den med færrest brud + mindst flytning
 * (kravet er formuleret som en global minimering, ikke "en god nok" rækkefølge).
 *
 * @param {Array<{profile_type:string}>} stages
 * @param {string|number} seedKey
 */
export function chooseBestOrder(stages, seedKey) {
  const n = stages.length;
  const types = stages.map((s) => s.profile_type);
  const before = countViolations(types);

  const identity = types.map((_, idx) => idx);
  if (n <= 1) {
    return { order: identity, before, after: before, displacement: 0, changed: false };
  }

  const rng = makeRng(stableSeed(String(seedKey)));
  let best = null; // { order, score:[hard, displacement, soft], tieBreak }

  for (const order of allPermutations(n)) {
    const permTypes = order.map((origIdx) => types[origIdx]);
    const v = countViolations(permTypes);
    const displacement = order.reduce((sum, origIdx, newPos) => sum + Math.abs(newPos - origIdx), 0);
    const soft = v.openingOk ? 0 : 1;
    const score = [v.total, displacement, soft];
    // Forbrug ÉN rng-værdi pr. kandidat, i FAST enumereringsrækkefølge (Heap's
    // algoritme er deterministisk) → samme seedKey giver altid samme valg.
    const tieBreak = rng();

    if (!best || cmpScore(score, best.score) < 0 || (cmpScore(score, best.score) === 0 && tieBreak > best.tieBreak)) {
      best = { order, score, tieBreak };
    }
  }

  const chosenTypes = best.order.map((origIdx) => types[origIdx]);
  const after = countViolations(chosenTypes);
  const displacement = best.order.reduce((sum, origIdx, newPos) => sum + Math.abs(newPos - origIdx), 0);
  const changed = best.order.some((origIdx, newPos) => origIdx !== newPos);

  return { order: best.order, before, after, displacement, changed };
}

export function sequenceLabel(types) {
  return types.join(">");
}
