// Display-rating 0-99 for en rytter: simpelt, uvægtet snit af de 15 synlige
// CZ-evner (#1529). Frontend-pendant til backend `riderOverall`
// (backend/lib/riderValuation.js), som også arbejder på derived abilities.
//
// STAT_KEYS = de 15 evne-keys (delt config i ./abilities.js). Migreret 2026-06-19
// (#1529) fra de 14 PCM stat_*-kolonner — visningen viser nu evner. components/
// RiderFilters.jsx re-eksporterer den. ./abilities.js er ren .js uden JSX-imports,
// så `node --test` kan stadig loade denne fil. Rytter-objektet skal have evnerne
// fladet op (rider.climbing osv.) via flattenAbilities() før rating beregnes.
import { ABILITY_KEYS } from "./abilities.js";

export const STAT_KEYS = ABILITY_KEYS;

// Snit af de stats der findes på rækken (manglende/ikke-numeriske ignoreres).
// Ingen stats overhovedet → 0 (sorterer nederst, viser tomt-agtig værdi).
export function riderStatRating(rider = {}) {
  let sum = 0;
  let n = 0;
  for (const k of STAT_KEYS) {
    const raw = rider?.[k];
    if (raw == null) continue; // null/undefined = manglende stat, ikke 0 (Number(null) er 0)
    const v = Number(raw);
    if (Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  if (n === 0) return 0;
  return Math.round(Math.max(0, Math.min(99, sum / n)));
}
