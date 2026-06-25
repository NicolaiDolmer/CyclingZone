// backend/lib/raceTerrain.js
// Race Hub S3: terræn-buckets. De 9 stage-profiltyper (race_stage_profiles CHECK)
// mappes til 5 strategi-buckets som kaptajn-prioriteter er rangordnet pr. (L3).
// Pure — ingen DB. Genbruges senere i S4/S5 (terræn-DNA, rolle-hints).

export const TERRAIN_BUCKETS = Object.freeze(["flat", "hilly", "mountain", "cobbles", "itt"]);

const PROFILE_TO_BUCKET = Object.freeze({
  flat: "flat", rolling: "flat",
  hilly: "hilly", classic: "hilly",
  mountain: "mountain", high_mountain: "mountain",
  cobbles: "cobbles",
  itt: "itt", ttt: "itt",
});

// Ukendt/null → "flat" (defensiv: et løb uden kendt profil behandles som fladt).
export function terrainBucket(profileType) {
  return PROFILE_TO_BUCKET[profileType] ?? "flat";
}

const FLAT_PROFILES = new Set(["flat", "rolling"]);

// Ét løbs repræsentative bucket = dominerende bucket over GC-etaperne (ikke-flade
// hvis nogen findes, ellers alle — spejler raceAutopick.gcStages). Tie → laveste
// TERRAIN_BUCKETS-index (stabil/deterministisk). Tom → "flat".
export function raceTerrainBucket(stages) {
  if (!stages?.length) return "flat";
  const nonFlat = stages.filter((s) => !FLAT_PROFILES.has(s.profile_type));
  const relevant = nonFlat.length ? nonFlat : stages;
  const counts = new Map();
  for (const s of relevant) {
    const b = terrainBucket(s.profile_type);
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  let best = "flat";
  let bestCount = -1;
  for (const b of TERRAIN_BUCKETS) {
    const c = counts.get(b) || 0;
    if (c > bestCount) { best = b; bestCount = c; }
  }
  return best;
}
