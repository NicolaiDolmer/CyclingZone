// frontend/src/lib/roleHint.js
// Race Hub S5 (Lag 3 taktik): rene helpers til rolle-tildelings-UI. Ingen React.
//
//  1. roleHint(role, bucket) — profil-bevidst rolle-hint: hvilke i18n-nøgler en
//     RoleCard skal slå op (titel pr. rolle + terræn-specifik beskrivelse).
//  2. stageHasBreakaway(profileType) — om etapen overhovedet har et morgenudbrud.
//
// #6912 (designbord S7, variant A): den faste udbruds-styrke-tabel (et spejl af den
// gamle motors udbrudsbonus) er fjernet. Den kom ikke fra motoren for netop det løb
// og felt, og den viste fx "Low" på en bjergetape hvor udbruddet tog de første
// pladser. UI'et siger nu kun det motoren kan stå inde for: om der er et udbrud.

import { TERRAIN_BUCKETS, terrainBucket } from "./stageTerrain.js";

// De fire taktik-roller en rytter kan tildeles (matcher RaceColumn ROLE_OPTIONS +
// race_entries.race_role: captain/sprint_captain/hunter/helper, hvor "rider" = helper).
export const ROLE_KEYS = ["captain", "sprint_captain", "hunter", "rider"];
// #2376: v3-listen — samme fire + free_role. Kun vist når race_engine_v3_scoring er ON
// (raceRoles.js VALID_RACE_ROLES kender rollen backend-side allerede; UI-eksponeringen
// er det der er v3-gated her). Rækkefølgen sætter grid-positionen i RoleCard-udvalget.
export const ROLE_KEYS_V3 = ["captain", "sprint_captain", "hunter", "free_role", "rider"];
const ROLE_SET = new Set(ROLE_KEYS_V3);

// Linjeløb med morgenudbrud i motoren: alle profiler undtagen enkeltstart og
// holdtidskørsel (itt/itt_hilly/ttt).
const BREAKAWAY_PROFILES = new Set([
  "flat", "rolling", "hilly", "medium_mountain", "mountain", "high_mountain", "cobbles", "gravel", "classic",
]);

// Har etapen et morgenudbrud? Enkeltstart, holdtidskørsel, ukendt eller manglende
// profil → false.
export function stageHasBreakaway(profileType) {
  return BREAKAWAY_PROFILES.has(profileType);
}

// Overgang (#6912): RaceSelectionPanel (ejet af et andet spor) kalder stadig denne og
// sender værdien til RiderFitInsight, som ignorerer den. Slettes sammen med det kald.
/**
 * #6912 S7 A: tallet fra den faste tabel er fjernet. Signaturen beholdes, saa kaldere
 * (RaceSelectionPanel, ejet af #7239) ikke skal aendres endnu; argumenterne ignoreres.
 * @param {unknown} [_profileType]
 * @param {unknown} [_finaleType]
 * @returns {null}
 */
export function hunterBreakawayStrength(_profileType, _finaleType) {
  return null;
}

// Profil-bevidst rolle-hint: i18n-nøgle-suffikser en RoleCard slår op. titleKey er
// rolle-bestemt; descKey kobler rollen til terrænet (hvorfor rollen passer her).
// Ukendt rolle → null (intet kort). Ukendt/null bucket → flat (defensiv default,
// matcher terrainBucket).
export function roleHint(role, bucket) {
  if (!ROLE_SET.has(role)) return null;
  const b = TERRAIN_BUCKETS.includes(bucket) ? bucket : terrainBucket(bucket);
  return {
    titleKey: `racehub.roleCard.${role}.title`,
    descKey: `racehub.roleCard.${role}.hint.${b}`,
  };
}
