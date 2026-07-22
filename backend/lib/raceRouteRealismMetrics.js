// backend/lib/raceRouteRealismMetrics.js
// Sub-1 (#2769) scorecard: mål en (regenereret) kalender mod WT-realisme + #2755-tier-bånd.
// Ren funktion — ingen DB. Input = allerede-genererede etaper (profile_type/finale_type/rute).
// GATEN: raceRouteRealismScorecard.js regenererer S2 in-memory og kalder scoreTier pr. tier.

const MOUNTAIN = new Set(["mountain", "high_mountain"]);
const isSummit = (s) => s.finale_type === "long_climb" && MOUNTAIN.has(s.profile_type);

// #2755-mål pr. tier. null = intet krav.
export const TIER_TARGETS = Object.freeze({
  1: { summit_min: null, mdown_max_pct: null, itt_min: null, cobbles_min: null },
  2: { summit_min: null, mdown_max_pct: null, itt_min: null, cobbles_min: null },
  3: { summit_min: 8, mdown_max_pct: 55, itt_min: 1, cobbles_min: 1 },
  4: { summit_min: 4, mdown_max_pct: 60, itt_min: 1, cobbles_min: 1 },
});

// WT-realisme-bånd (spec §6), pr. etape-type. [min,max] km.
export const WT_DISTANCE_BANDS = Object.freeze({
  flat: [150, 200], rolling: [150, 190], hilly: [160, 210],
  mountain: [140, 190], high_mountain: [140, 190],
  cobbles: [150, 170], classic: [200, 260], itt: [15, 40], ttt: [25, 45],
});

// Flad-ud alle etaper i en race-liste. En stage_race har `stages` som array; en single ligeså.
function allStages(races) {
  const out = [];
  for (const r of races) for (const s of (Array.isArray(r.stages) ? r.stages : [])) out.push({ ...s, _race_type: r.race_type });
  return out;
}

/**
 * Scorer én tier mod #2755-målene.
 * @param {number} tier
 * @param {Array<{race_type:string, stages:Array<{profile_type,finale_type,distance_km,sectors}>}>} races
 * @returns {{tier,summit_finishes,mountain_stages,mdown_pct,standalone_itt,cobbles_in_stagerace,pass,failures,distanceOutliers}}
 */
export function scoreTier(tier, races) {
  const stages = allStages(races);
  const mountainStages = stages.filter((s) => MOUNTAIN.has(s.profile_type));
  const mdown = mountainStages.filter((s) => s.finale_type === "descent");
  const summit = stages.filter(isSummit).length;
  const standaloneItt = races.filter((r) => r.race_type === "single" && (r.stages || []).some((s) => s.profile_type === "itt")).length;
  const cobblesInStageRace = races.filter((r) => r.race_type === "stage_race" && (r.stages || []).some((s) => s.profile_type === "cobbles")).length;
  const mdownPct = mountainStages.length ? Math.round((mdown.length / mountainStages.length) * 100) : 0;

  const distanceOutliers = stages.filter((s) => {
    const band = WT_DISTANCE_BANDS[s.profile_type];
    return band && (s.distance_km < band[0] || s.distance_km > band[1]);
  }).length;

  const t = TIER_TARGETS[tier] ?? {};
  const failures = [];
  if (t.summit_min != null && summit < t.summit_min) failures.push(`summit ${summit} < ${t.summit_min}`);
  if (t.mdown_max_pct != null && mdownPct > t.mdown_max_pct) failures.push(`M-Down ${mdownPct}% > ${t.mdown_max_pct}%`);
  if (t.itt_min != null && standaloneItt < t.itt_min) failures.push(`fritstående ITT ${standaloneItt} < ${t.itt_min}`);
  if (t.cobbles_min != null && cobblesInStageRace < t.cobbles_min) failures.push(`brosten-i-etapeløb ${cobblesInStageRace} < ${t.cobbles_min}`);

  return {
    tier, summit_finishes: summit, mountain_stages: mountainStages.length, mdown_pct: mdownPct,
    standalone_itt: standaloneItt, cobbles_in_stagerace: cobblesInStageRace,
    distanceOutliers, pass: failures.length === 0, failures,
  };
}

// GT-realisme (spec §6): tjek et 21-etapers løb. total-km-bånd + kategoriserede stigninger.
export function scoreGrandTour(stages) {
  const totalKm = stages.reduce((s, x) => s + (x.distance_km || 0), 0);
  const categorizedClimbs = stages.reduce((s, x) => s + ((x.climbs || []).length), 0);
  const hcClimbs = stages.reduce((s, x) => s + (x.climbs || []).filter((c) => c.category === "HC").length, 0);
  const failures = [];
  if (totalKm < 3200 || totalKm > 3500) failures.push(`total ${totalKm} km udenfor 3200–3500`);
  if (categorizedClimbs < 25) failures.push(`kategoriserede stigninger ${categorizedClimbs} < 25`);
  if (hcClimbs < 3 || hcClimbs > 8) failures.push(`HC-stigninger ${hcClimbs} udenfor 3–8`);
  return { totalKm, categorizedClimbs, hcClimbs, pass: failures.length === 0, failures };
}
