// frontend/src/lib/lineupInsight.js
// Race Hub S4: rene helpers til opstilling-rute-match. Ingen React.

// Effektivt fit for en rytter på en valgt etape: per-etape når tilgængelig,
// ellers løb-snit. null når intet fit findes (graceful degrade).
export function effectiveStageFit(rider, stageIndex) {
  if (stageIndex != null && Array.isArray(rider?.stageSuitability)) {
    const v = rider.stageSuitability[stageIndex];
    if (Number.isFinite(v)) return v;
  }
  return Number.isFinite(rider?.suitability) ? rider.suitability : null;
}

// id på den valgte rytter med højest effektivt fit (best-fit-nudge). Tiebreak id asc.
export function bestFitRiderId(riders, selectedIds, stageIndex) {
  let best = null, bestScore = -Infinity;
  for (const r of riders) {
    if (!selectedIds.includes(r.id)) continue;
    const f = effectiveStageFit(r, stageIndex);
    if (f == null) continue;
    if (f > bestScore || (f === bestScore && best != null && String(r.id) < String(best))) {
      best = r.id; bestScore = f;
    }
  }
  return best;
}
