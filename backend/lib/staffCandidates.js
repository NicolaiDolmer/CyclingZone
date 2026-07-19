// Deterministisk staff-kandidat-generering. Seed = teamId+season+role → stabil på refresh.
// Navne: fornavn×efternavn-kombinatorik, samme kilde/stil som rytter-generatoren
// (fictionalRiderNames.NAME_CLUSTERS — region/sprog-clusters, ingen ægte personer).
//
// #2657 (opfølgning på #2643): en FAST liste — uanset størrelse — har et hårdt loft,
// og hvert hold trækker uafhængigt fra samme pulje (deterministisk pr. (teamId,
// season, role)), så birthday-paradox gør cross-team-navnesammenfald uundgåelige
// når trækket ≥ pulje-størrelsen (40→150 i #2658 var stadig kun en større fast
// liste). Kombinatorik fjerner loftet: NAME_CLUSTERS' ~17 clusters × ~18 fornavne ×
// ~20-29 efternavne giver flere tusinde kombinationer, mod prod-skala (60-200
// staff) et par-procent forventet kollisionsrate i stedet for 75-78%. Clusteret
// vælges FØR fornavn/efternavn så et par altid er kulturelt konsistent (samme stil
// som rytter-generatoren) — staff har ingen egen nationalitets-kolonne endnu, så
// clusteret her er en navne-STIL, ikke bundet til en faktisk hold-/rytter-nationalitet.
// Allerede ansatte team_staff-rækker beholder deres eksisterende navn i DB uændret
// (se database/2026-07-19-staff-name-dedup-backfill.sql for oprydning af dubletter).
import { staffSalaryFor } from "./facilityConstants.js";
import { deriveStaffAbilities, topSpecialization } from "./staffAbilityDerivation.js";
import { NAME_CLUSTERS } from "./fictionalRiderNames.js";

const CLUSTER_KEYS = Object.freeze(Object.keys(NAME_CLUSTERS));

// Kombinatorisk kombinationsrum (diagnostik/tests): sum af |first|×|last| pr. cluster.
export const STAFF_NAME_COMBINATION_COUNT = CLUSTER_KEYS.reduce(
  (sum, key) => sum + NAME_CLUSTERS[key].first.length * NAME_CLUSTERS[key].last.length,
  0,
);

function pickStaffName(rand) {
  const clusterKey = CLUSTER_KEYS[Math.floor(rand() * CLUSTER_KEYS.length)];
  const cluster = NAME_CLUSTERS[clusterKey];
  const first = cluster.first[Math.floor(rand() * cluster.first.length)];
  const last = cluster.last[Math.floor(rand() * cluster.last.length)];
  return `${first} ${last}`;
}

// mulberry32 — lille deterministisk PRNG (ingen Math.random: reproducérbarhed er kontrakten).
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

export function generateStaffCandidates({ teamId, seasonNumber, role, facilityTier }) {
  const rand = mulberry32(hashString(`${teamId}:${seasonNumber}:${role}`));
  // facilityTier 0 giver stadig tier-1-kandidater (teaser i UI); selve ansættelsen blokeres af validateHire (staff-tier > facilitets-tier).
  const maxTier = Math.max(1, Math.min(5, facilityTier));
  const candidates = [];
  const usedNames = new Set();
  while (candidates.length < 3) {
    const name = pickStaffName(rand);
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    const tier = 1 + Math.floor(rand() * maxTier);
    // #2216 A4: berig med afledt overall + top-specialisering til UI-visning/
    // -sammenligning. Deterministisk (samme (role,tier,name) → samme profil).
    const profile = deriveStaffAbilities({ role, tier, name });
    candidates.push({
      name, role, tier,
      // #2216 A4 (Q1): rating-drevet løn — staffSalaryFor(overall) i stedet for den flade
      // tier-tabel, så lønnen bider proportionalt med kandidatens faktiske kvalitet.
      // Deterministisk (overall er deterministisk af (role,tier,name)).
      salary: staffSalaryFor(profile.overall),
      overall: profile.overall,
      topSpecialization: topSpecialization(profile),
    });
  }
  return candidates;
}
