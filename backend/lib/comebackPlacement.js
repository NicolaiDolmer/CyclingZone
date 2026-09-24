// #5643 (epik #4592, spor A4) · Comeback efter Global Rank: hvor lander et
// parkeret hold, der melder sig tilbage midt i en sæson?
//
// Ejer-beslutning 24/9 (#4592): placering efter Global Rank, holdet overtager en
// AI-plads, og er der ingen AI-plads i divisionen, går det én division ned, helt
// til bunden. Spec: docs/drafts/spec-s4-struktur-2026-09-24.md afsnit A4.
//
// REN: ingen DB, ingen I/O. comebackService.js henter data og kalder herind, så
// reglerne kan testes uden mocks af Supabase.

import { isSeniorSquadRow } from "./squads.js";

// Bunden af pyramiden. Et comeback falder aldrig længere ned end hertil.
export const COMEBACK_BOTTOM_TIER = 4;

// Kumuleret pladsantal pr. division i pyramiden 1/2/4 puljer á 24 hold (ejer 24/9):
// D1 = 24, D1+D2 = 72, D1+D2+D3 = 168. Samme grænser som ejer-beslutningen citerer.
// Rækkefølgen er vigtig: første grænse holdets rang ligger inden for, vinder.
export const COMEBACK_RANK_CEILINGS = Object.freeze([
  Object.freeze({ tier: 1, maxRank: 24 }),
  Object.freeze({ tier: 2, maxRank: 72 }),
  Object.freeze({ tier: 3, maxRank: 168 }),
]);

/**
 * Division for en Global Rank. Ukendt rang (null, 0, negativ, ikke et tal) → bunden.
 * @param {number|null|undefined} rank
 * @returns {number} tier 1-4
 */
export function tierForGlobalRank(rank) {
  const r = Number(rank);
  if (rank == null || !Number.isFinite(r) || r < 1) return COMEBACK_BOTTOM_TIER;
  for (const { tier, maxRank } of COMEBACK_RANK_CEILINGS) {
    if (r <= maxRank) return tier;
  }
  return COMEBACK_BOTTOM_TIER;
}

/**
 * Den rang comebacket placeres efter.
 *
 * `global_rank_mv.global_rank` er NULL, når holdet ikke har en stilling i de seneste
 * to sæsoner. Arkitekt-valg i spec'en: rangér så på `global_points` blandt alle
 * menneskehold (`humansAbove` = antal menneskehold med flere point). Har holdet ingen
 * point, er der intet at rangere på, og det går til bunden (returnerer null).
 *
 * @param {{ globalRank?: number|null, globalPoints?: number|null, humansAbove?: number|null }} args
 * @returns {number|null}
 */
export function resolveComebackRank({ globalRank = null, globalPoints = null, humansAbove = null } = {}) {
  const rank = Number(globalRank);
  if (globalRank != null && Number.isFinite(rank) && rank >= 1) return rank;
  const points = Number(globalPoints);
  if (globalPoints == null || !Number.isFinite(points) || points <= 0) return null;
  const above = Number(humansAbove);
  return (Number.isFinite(above) && above > 0 ? Math.floor(above) : 0) + 1;
}

// En pulje der er pensioneret (league_divisions.retired_at, spor A2) tager ingen nye
// hold. Kolonnen findes måske ikke endnu (A2's migration); en manglende værdi = aktiv.
function isActivePool(pool) {
  return pool != null && pool.retired_at == null && isSeniorSquadRow(pool);
}

// En "AI-plads" = et AI-hold der ikke er banken, ikke er pensioneret og ikke allerede
// er reserveret til fjernelse af en tidligere placering (pending_removal_at). Et
// reserveret AI-hold er en plads der allerede er lovet væk.
function isFreeAiSlot(team) {
  return team?.is_ai === true
    && team.is_bank !== true
    && team.retired_at == null
    && team.pending_removal_at == null;
}

// Et hold der optager en plads (samme definition som choosePoolForNewTeam, #4183):
// alt der ikke er banken og ikke er markeret til fjernelse.
function occupiesSlot(team) {
  return team?.is_bank !== true && team?.pending_removal_at == null;
}

function countByPool(teams, predicate) {
  const counts = new Map();
  for (const team of teams || []) {
    if (team?.league_division_id == null || !predicate(team)) continue;
    const key = String(team.league_division_id);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function byPoolIndex(a, b) {
  return (Number(a.pool_index) || 0) - (Number(b.pool_index) || 0);
}

/**
 * Puljen et comeback lander i.
 *
 * Fra `tier` og nedad til bunden: første division med en aktiv seniorpulje, der har
 * mindst én fri AI-plads. Inden for divisionen vinder puljen med flest AI-pladser, og
 * ved lighed den laveste `pool_index` (A før B). Holdet overtager altså en AI-plads.
 *
 * Findes der slet ingen AI-plads (bør ikke ske: D4 fyldes altid med AI, spor A2), lander
 * holdet i den mindst fyldte aktive pulje i bunden, hellere end at blive afvist. Er der
 * heller ingen pulje i bunden, returneres null (kalderen svarer med en fejl).
 *
 * @param {{ tier: number, pools: object[], teams: object[] }} args
 *   pools: league_divisions-rækker ({ id, tier, pool_index, retired_at?, squad? })
 *   teams: holdrækker ({ league_division_id, is_ai, is_bank, retired_at, pending_removal_at })
 * @returns {{ poolId: any, tier: number, poolIndex: number|null, label: string|null,
 *             aiSlots: number, reason: "ai_slot"|"bottom_fallback" }|null}
 */
export function pickComebackPool({ tier, pools = [], teams = [] } = {}) {
  const startTier = Math.min(Math.max(Math.trunc(Number(tier)) || COMEBACK_BOTTOM_TIER, 1), COMEBACK_BOTTOM_TIER);
  const activePools = (pools || []).filter(isActivePool);
  const aiSlots = countByPool(teams, isFreeAiSlot);

  for (let t = startTier; t <= COMEBACK_BOTTOM_TIER; t += 1) {
    const candidates = activePools
      .filter((pool) => Number(pool.tier) === t)
      .map((pool) => ({ pool, slots: aiSlots.get(String(pool.id)) || 0 }))
      .filter((c) => c.slots > 0)
      .sort((a, b) => (b.slots - a.slots) || byPoolIndex(a.pool, b.pool));
    if (candidates.length > 0) {
      const { pool, slots } = candidates[0];
      return toPlacement(pool, slots, "ai_slot");
    }
  }

  const occupancy = countByPool(teams, occupiesSlot);
  const bottom = activePools
    .filter((pool) => Number(pool.tier) === COMEBACK_BOTTOM_TIER)
    .sort((a, b) => ((occupancy.get(String(a.id)) || 0) - (occupancy.get(String(b.id)) || 0)) || byPoolIndex(a, b));
  if (bottom.length === 0) return null;
  return toPlacement(bottom[0], 0, "bottom_fallback");
}

function toPlacement(pool, slots, reason) {
  return {
    poolId: pool.id,
    tier: Number(pool.tier),
    poolIndex: pool.pool_index == null ? null : Number(pool.pool_index),
    label: pool.label ?? null,
    aiSlots: slots,
    reason,
  };
}
