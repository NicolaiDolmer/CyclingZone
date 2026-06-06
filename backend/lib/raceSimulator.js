// Race Engine light-motor (#1102), slice 2 — deterministisk single-stage simulator.
//
// Ren funktion: scorer rider_derived_abilities mod en etapes demand_vector +
// bounded seeded variation → rangering + per-rytter tids-gab for den etape.
// Ingen DB/fs. raceRunner.js aggregerer på tværs af etaper (GC + trøjer) og
// broer til den UÆNDREDE applyRaceResults.
//
// Kontrakt (FROSSEN — #1021 fylder seams ud INDE i loopet, ændrer IKKE signaturen,
// så light → fuld er et dybde-løft, ikke en omskrivning):
//   simulateStage({ entrants, stageProfile, seed }) → { seed, ranked }
//
// Score-model (slice 2 "lean kerne + seams", ejer-besluttet 2026-06-07, F2=A):
//   finalScore = terrain + noise + form(0) − fatigue(0) + team(0)
//     terrain = Σ ability[k]/99 · demand[k]      (k ∈ de 10 abilities)
//     noise   = gaussian(rng, 0, demand.randomness · NOISE_SD_SCALE)
//   form/fatigue/team er ÆGTE seam-funktioner der returnerer neutralt i v1 og
//   bærer præcis den signatur den fulde fysiologiske motor (#1021) fylder ud.
//
// Determinisme: makeRng (mulberry32) + Box-Muller (gaussian), begge genbrugt fra
//   fictionalRiderGenerator.js (issue-krav). Entrants scores i STABIL rider_id-
//   orden, så rng-sekvensen er uafhængig af input-rækkefølge. Samme seed + input
//   → samme rang. Stabil tiebreaker (rider_id) ved score-lighed. Ingen Math.random/Date.

import { makeRng, gaussian } from "./fictionalRiderGenerator.js";

export const ENGINE_VERSION = 1;

// rider_derived_abilities-kolonnerne = terræn-scoringens dimensioner. Skal matche
// ABILITY_DIMENSIONS i raceStageProfileGenerator.js (demand_vector-nøgler ⊆ disse
// ∪ {randomness}). 'randomness' er IKKE en ability — den skalerer kun støjen.
export const ABILITY_KEYS = Object.freeze([
  "climbing", "time_trial", "sprint", "punch", "endurance",
  "cobble_classics", "acceleration", "recovery", "tactics", "positioning",
]);

const ABILITY_MAX = 99;

// Støjens standardafvigelse = demand.randomness · NOISE_SD_SCALE. Terræn-scoren
// ligger i [0, 1], så denne skalar afgør hvor ofte stjerner slås (tunes via
// distributions-testene → acceptance: "stjerner vinder oftest, men ikke 100%").
// ÉT sted at tune varians-niveauet for hele motoren.
export const NOISE_SD_SCALE = 0.20;

// Per-terræn tids-gab-model (F3, ejer-besluttet 2026-06-07): omsætter score-deficit
// (bag etapevinderen) til sekunder. bunch = deficit under tærsklen → samme tid
// (peloton); spread = sekunder pr. score-point over tærsklen. Flade etaper
// neutraliseres (felt-finish, gab≈0), bjerg/ITT åbner ægte gab → GC afgøres i
// bjergene. Display-only (gc-RANK driver points); tunbar ÉT sted.
const GAP_MODEL = Object.freeze({
  flat:          { bunch: 0.06, spread: 40 },
  rolling:       { bunch: 0.04, spread: 90 },
  hilly:         { bunch: 0.02, spread: 200 },
  mountain:      { bunch: 0.0,  spread: 600 },
  high_mountain: { bunch: 0.0,  spread: 800 },
  itt:           { bunch: 0.0,  spread: 700 },
  ttt:           { bunch: 0.0,  spread: 500 },
  cobbles:       { bunch: 0.02, spread: 250 },
  classic:       { bunch: 0.02, spread: 220 },
});
const GAP_MODEL_DEFAULT = Object.freeze({ bunch: 0.03, spread: 150 });
const MAX_STAGE_GAP_SECONDS = 1800; // sikkerhedsloft (30 min)

// ── Seams til #1021 (returnerer neutralt i light-motoren) ─────────────────────
// Signaturerne er bevidst rige nok til at den fulde motor kan fylde dem ud uden
// at ændre simulateStage's kontrakt: light → fuld = depth INDE i loopet.
//   form    — seeded dagsform pr. rytter/etape.
//   fatigue — akkumuleret træthed over et etapeløb (kræver cross-stage state → runner).
//   team    — leadout/beskyttelse/holdstyrke.
function formComponent(/* entrant, stageProfile, rng */) { return 0; }
function fatigueComponent(/* entrant, stageProfile */) { return 0; }
function teamComponent(/* entrant, stageProfile, teamContext */) { return 0; }

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// FNV-1a 32-bit → heltals-seed fra en streng. Eksporteret så raceRunner udleder
// en stabil per-etape-seed (`${race.id}:${stage_number}`). Deterministisk.
export function stableSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// terrain = Σ ability[k]/99 · demand[k]. demand-nøgler der ikke er abilities
// (dvs. 'randomness') ignoreres her. Manglende ability → 0 (defensivt).
export function terrainScore(abilities, demandVector) {
  let s = 0;
  for (const k of ABILITY_KEYS) {
    const w = demandVector[k];
    if (!w) continue;
    const a = Number(abilities?.[k]) || 0;
    s += (a / ABILITY_MAX) * w;
  }
  return s;
}

function gapFor(profileType, deficit) {
  const m = GAP_MODEL[profileType] || GAP_MODEL_DEFAULT;
  if (deficit <= m.bunch) return 0;
  return Math.round(clamp((deficit - m.bunch) * m.spread, 0, MAX_STAGE_GAP_SECONDS));
}

/**
 * Simulér ÉN etape. Ren funktion — ingen DB, ingen Math.random/Date.
 * @param {{entrants:Array, stageProfile:object, seed:number}} args
 *   entrants: [{ rider_id, team_id?, abilities:{climbing,...positioning} }]
 *   stageProfile: { profile_type, demand_vector, stage_number? }
 *   seed: heltal (udledes typisk af raceRunner via stableSeed)
 * @returns {{ seed:number, ranked:Array }}
 *   ranked: [{ rider_id, team_id, rank, finalScore, stageGap, components }]
 *   sorteret bedst→dårligst; rank 1..N; stageGap = sekunder bag etapevinderen (≥0).
 */
export function simulateStage({ entrants = [], stageProfile, seed } = {}) {
  if (!stageProfile?.demand_vector) throw new Error("stageProfile.demand_vector kræves");
  if (!Number.isInteger(seed)) throw new Error("seed (heltal) kræves");

  const demand = stageProfile.demand_vector;
  const profileType = stageProfile.profile_type;
  const noiseSd = (Number(demand.randomness) || 0) * NOISE_SD_SCALE;

  // Stabil scoringsrækkefølge → rng-sekvens uafhængig af input-orden.
  const ordered = [...entrants].sort((a, b) =>
    String(a.rider_id).localeCompare(String(b.rider_id))
  );
  const rng = makeRng(seed >>> 0);

  const scored = ordered.map((e) => {
    const terrain = terrainScore(e.abilities, demand);
    const noise = noiseSd > 0 ? gaussian(rng, 0, noiseSd) : 0;
    const form = formComponent(e, stageProfile, rng);
    const fatigue = fatigueComponent(e, stageProfile);
    const team = teamComponent(e, stageProfile);
    const finalScore = terrain + noise + form - fatigue + team;
    return {
      rider_id: e.rider_id,
      team_id: e.team_id ?? null,
      finalScore,
      components: { terrain, noise, form, fatigue, team },
    };
  });

  // Rangering: bedste score først; stabil tiebreaker = rider_id.
  scored.sort((a, b) =>
    b.finalScore - a.finalScore ||
    String(a.rider_id).localeCompare(String(b.rider_id))
  );

  const winnerScore = scored.length ? scored[0].finalScore : 0;
  const ranked = scored.map((r, i) => ({
    rider_id: r.rider_id,
    team_id: r.team_id,
    rank: i + 1,
    finalScore: r.finalScore,
    stageGap: gapFor(profileType, winnerScore - r.finalScore),
    components: r.components,
  }));

  return { seed: seed >>> 0, ranked };
}
