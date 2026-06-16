// Navngivne rytter-mix-presets for dev-tooling (#1420 race:cockpit).
//
// Et preset transformerer default-kompositionen til et { tierFractions?,
// tierTypeWeights? }-objekt, som spredes direkte ind i generateFictionalRiders.
// default/random rører INTET (= modul-konstanterne) → uændret adfærd.
// Værdi-pyramiden bevares overalt undtagen elite-dense, hvor flading er pointen.
//
//   resolveMix("climb-heavy") → { tierTypeWeights: {...} }
//   generateFictionalRiders({ seed, count, referenceYear, ...resolveMix(name) })

import { DEFAULT_TIER_TYPE_WEIGHTS } from "./fictionalRiderGenerator.js";

// Multiplicér udvalgte arketype-vægte på tværs af alle tiers (kun hvor typen
// allerede findes i tieren → realismen bevares: ingen leadout i superstar-tieren).
function multiplyWeights(multipliers) {
  const out = {};
  for (const [tier, weights] of Object.entries(DEFAULT_TIER_TYPE_WEIGHTS)) {
    out[tier] = { ...weights };
    for (const [type, factor] of Object.entries(multipliers)) {
      if (out[tier][type] != null) out[tier][type] *= factor;
    }
  }
  return out;
}

// Flad alle vægte i hver tier til lige (1) — bevarer per-tier type-sættet, så
// pyramidens realisme holder, men ingen disciplin dominerer mixet.
function flattenWeights() {
  const out = {};
  for (const [tier, weights] of Object.entries(DEFAULT_TIER_TYPE_WEIGHTS)) {
    out[tier] = {};
    for (const type of Object.keys(weights)) out[tier][type] = 1;
  }
  return out;
}

export const MIX_PRESETS = {
  default: {
    label: "Default — kalibreret launch-population (uændret)",
    resolve: () => ({}),
  },
  random: {
    label: "Random — = default; variér -Seed for et friskt felt",
    resolve: () => ({}),
  },
  "sprint-heavy": {
    label: "Sprint-heavy — flere sprintere + leadouts (dybe flade/sprint-felter)",
    resolve: () => ({ tierTypeWeights: multiplyWeights({ sprinter: 3, leadout: 2 }) }),
  },
  "climb-heavy": {
    label: "Climb-heavy — flere klatrere/GC/baroudeurs (dybe bjerg-felter)",
    resolve: () => ({ tierTypeWeights: multiplyWeights({ climber: 2, gc: 2, baroudeur: 1.5 }) }),
  },
  "elite-dense": {
    label: "Elite-dense — mange flere top-ryttere (pyramide fladet bevidst)",
    resolve: () => ({ tierFractions: { superstar: 0.06, star: 0.16, solid: 0.35 } }),
  },
  balanced: {
    label: "Balanced — hver disciplin lige repræsenteret pr. tier",
    resolve: () => ({ tierTypeWeights: flattenWeights() }),
  },
};

export const MIX_PRESET_NAMES = Object.keys(MIX_PRESETS);

/**
 * Slå et preset op og returnér dets komposition-override (spredbart ind i
 * generateFictionalRiders). Kaster ved ukendt navn — med listen over gyldige.
 * @param {string} name
 * @returns {{ tierFractions?: object, tierTypeWeights?: object }}
 */
export function resolveMix(name) {
  const preset = MIX_PRESETS[name];
  if (!preset) {
    throw new Error(`Ukendt mix-preset "${name}". Gyldige: ${MIX_PRESET_NAMES.join(", ")}`);
  }
  return preset.resolve();
}
