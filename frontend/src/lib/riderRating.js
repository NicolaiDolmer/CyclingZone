// Display-rating 0-99 for en rytter: simpelt, uvægtet snit af de 14 synlige
// stat_*-kolonner (Refs #1009). Frontend-pendant til backend `riderOverall`
// (backend/lib/riderValuation.js), som arbejder på derived abilities — denne
// her bruger de stats spilleren faktisk kan se i rytter-tabellerne, indtil
// 1-100-evnesystemet (#1101) overtager.
//
// STAT_KEYS er kanonisk her (ren .js uden JSX-imports, så `node --test` kan
// loade filen). components/RiderFilters.jsx re-eksporterer den.
export const STAT_KEYS = [
  "stat_fl", "stat_bj", "stat_kb", "stat_bk", "stat_tt", "stat_prl",
  "stat_bro", "stat_sp", "stat_acc", "stat_ned", "stat_udh", "stat_mod",
  "stat_res", "stat_ftr",
];

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
