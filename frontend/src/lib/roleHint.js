// frontend/src/lib/roleHint.js
// Race Hub S5 (Lag 3 taktik): rene helpers til rolle-tildelings-UI. Ingen React.
//
// To ansvarsområder:
//  1. roleHint(role, bucket) — profil-bevidst rolle-hint: hvilke i18n-nøgler en
//     RoleCard skal slå op (titel pr. rolle + terræn-specifik beskrivelse).
//  2. hunterBreakawayStrength(profileType, finaleType) — oversætter "Jæger"-rollens
//     reelle motor-mekanik (BREAKAWAY_BONUS i raceSimulator) til et læsbart
//     styrke-ord (high/medium/low/none) som UI'et kan farve + forklare.
//
// BREAKAWAY_STRENGTH SPEJLER backend/lib/raceSimulator.js BREAKAWAY_BONUS (kopieret,
// IKKE importeret — frontend må ikke trække backend ind). Tærskel-mappingen er
// bevidst grov (4 bånd) så et lille tal-skift i motoren ikke forvirrer spilleren;
// roleHint.test.js drift-guard'er værdierne mod backend (samme mønster som
// stageTerrain.js terrainBucket-mirror).

import { TERRAIN_BUCKETS, terrainBucket } from "./stageTerrain.js";

// De fire taktik-roller en rytter kan tildeles (matcher RaceColumn ROLE_OPTIONS +
// race_entries.race_role: captain/sprint_captain/hunter/helper, hvor "rider" = helper).
export const ROLE_KEYS = ["captain", "sprint_captain", "hunter", "rider"];
const ROLE_SET = new Set(ROLE_KEYS);

// Bonus-skalar → læsbart styrke-bånd. Tærskler valgt så de spejler BREAKAWAY_BONUS-
// fordelingen: ≥0.30 (flad/bakke/bjerg-finaler hvor udbrud reelt holder) = high,
// ≥0.15 (rolling/dæmpede finaler) = medium, >0 (summit/marginale) = low, 0 = none.
export function strengthFromBonus(bonus) {
  const b = Number(bonus);
  if (!Number.isFinite(b) || b <= 0) return "none";
  if (b >= 0.30) return "high";
  if (b >= 0.15) return "medium";
  return "low";
}

// Spejl af raceSimulator.BREAKAWAY_BONUS, men hvert tal forud-mappet til sit
// styrke-bånd (så UI'et ikke selv kender de magiske tal). Profiler der ikke
// optræder her (itt/ttt/classic + ukendte) → ingen udbruds-mekanik → "none".
export const BREAKAWAY_STRENGTH = Object.freeze({
  flat:          Object.freeze({ bunch_sprint: "high",   reduced_sprint: "high",   _default: "high" }),
  rolling:       Object.freeze({ breakaway: "medium",    reduced_sprint: "medium", bunch_sprint: "medium", _default: "medium" }),
  hilly:         Object.freeze({ punch: "high",          reduced_sprint: "high",   breakaway: "high",  _default: "high" }),
  mountain:      Object.freeze({ descent: "high",        breakaway: "high",        long_climb: "low",  _default: "high" }),
  high_mountain: Object.freeze({ descent: "high",        long_climb: "low",        _default: "low" }),
  cobbles:       Object.freeze({ reduced_sprint: "high", breakaway: "high",        _default: "medium" }),
});

// Udbruds-styrke for en (profil, finale): spejler breakawayMaxBonus-opslaget.
// Manglende finale → profilens _default. Ukendt profil → "none" (itt/ttt/classic
// + ukendte har intet udbrud i motoren).
export function hunterBreakawayStrength(profileType, finaleType) {
  const p = BREAKAWAY_STRENGTH[profileType];
  if (!p) return "none";
  if (finaleType != null && finaleType in p) return p[finaleType];
  return p._default;
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
