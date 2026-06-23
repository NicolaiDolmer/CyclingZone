// Youth-cohort-generator for akademi-MVP (#1308).
//
// Genererer 3-5 ungdomskandidater pr. kuld til et holds akademi. Genbruger
// fictionalRiderGenerator's PRNG/navne-logik — ingen duplikering. Ung-
// talent har lavere stats-mean (raw) + bred potentiale-spredning.

import {
  gaussian,
  STAT_KEYS,
  weightedPick,
  makeUniqueName,
  DEFAULT_NATIONALITY_WEIGHTS,
  ARCHETYPE_BY_TYPE,
} from "./fictionalRiderGenerator.js";
import { clusterForNationality } from "./fictionalRiderNames.js";
import { NAME_CLUSTERS } from "./fictionalRiderNames.js";
import { ACADEMY } from "./academyFlag.js";

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Generér et akademi-kuld af ungdomskandidater (rører ingen DB).
 *
 * @param {object}  opts
 * @param {function} opts.rng              seeded PRNG (fra makeRng)
 * @param {number}  opts.referenceYear     beregner alder/fødselsdato mod dette år
 * @param {Set<string>} opts.existingNames foldNameNordic-sæt af eksisterende navne (muteres)
 * @param {{ dominant_nationality?: string }} [opts.identityBasis]  nation-bias
 * @returns {{ is_serious: boolean, rider: object }[]}
 */
export function generateAcademyCandidates({
  rng,
  referenceYear,
  existingNames,
  identityBasis = null,
}) {
  // ── Antal kandidater og seriøse ─────────────────────────────────────────────
  const count =
    ACADEMY.INTAKE_MIN + Math.floor(rng() * (ACADEMY.INTAKE_MAX - ACADEMY.INTAKE_MIN + 1));
  const seriousCount =
    ACADEMY.SERIOUS_MIN +
    Math.floor(rng() * (ACADEMY.SERIOUS_MAX - ACADEMY.SERIOUS_MIN + 1));

  // ── Nationalitets-vægte (med evt. bias) ─────────────────────────────────────
  let natWeights = DEFAULT_NATIONALITY_WEIGHTS;
  if (identityBasis?.dominant_nationality) {
    const dom = identityBasis.dominant_nationality;
    natWeights = DEFAULT_NATIONALITY_WEIGHTS.map((entry) =>
      entry.value === dom ? { ...entry, weight: entry.weight * 3 } : entry
    );
    // Sørg for at dominant_nationality er i listen (fx lille nation med 0-base)
    if (!natWeights.some((e) => e.value === dom)) {
      natWeights = [...natWeights, { value: dom, weight: 30 }];
    }
  }

  // ── Byg hvert kandidat-objekt ────────────────────────────────────────────────
  const candidates = [];
  for (let i = 0; i < count; i++) {
    const is_serious = i < seriousCount;

    // Nationalitet
    const nationality_code = weightedPick(rng, natWeights);
    const clusterKey = clusterForNationality(nationality_code);
    const cluster = NAME_CLUSTERS[clusterKey];

    // Navn (dedupliceret mod existingNames — muterer sættet)
    const { firstname, lastname } = makeUniqueName(rng, cluster, existingNames);

    // Alder + fødselsdato
    const age = Math.round(
      clamp(gaussian(rng, 18, 1.6), ACADEMY.MIN_AGE, ACADEMY.MAX_AGE)
    );
    const birthdate = `${referenceYear - age}-06-15`;

    // Stats: unge har lavere mean (raw talent) — clampes til [40,85]
    const statMean = is_serious ? 58 : 52;
    const stats = {};
    for (const key of STAT_KEYS) {
      stats[key] = Math.round(clamp(gaussian(rng, statMean, 6), 40, 85));
    }

    // Potentiale: 0.5-trin
    let pot;
    if (is_serious) {
      pot = 4.5 + rng() * 1.5; // 4.5–6.0
    } else {
      pot = 2.0 + rng() * 2.5; // 2.0–4.5
    }
    const potentiale = Math.round(pot * 2) / 2;

    // Krop: spred højde/vægt så physiology-seedingen ikke defaulter alle til
    // 180cm/70kg (#1478). Neutralt WorldTour-range; weight afledt af plausibel BMI.
    const height = Math.round(clamp(gaussian(rng, 180, 5), 165, 196));
    const bmi = clamp(gaussian(rng, 21.5, 1.0), 18.5, 24.5);
    const weight = Math.round(bmi * (height / 100) ** 2);

    candidates.push({
      is_serious,
      rider: {
        firstname,
        lastname,
        birthdate,
        nationality_code,
        pcm_id: null,
        is_academy: false,
        team_id: null,
        potentiale,
        height,
        weight,
        ...stats,
      },
    });
  }

  return candidates;
}

export const YOUTH_GEN_CONFIG = Object.freeze({
  // Basis-stat-niveau ved 16 år (lige over PCM-floor 50 → afledt evne ~1-7).
  baseStatAt16: 51.5,
  // Stat-løft pr. år over 16 (alders-skalering = "spol frem").
  statPerYearOver16: 1.4,
  // Signatur-løft: arketypens boostede stats løftes (skaleret ned fra voksen-niveau).
  signatureBoostScale: 0.45,
  // Spredning (lille → flad profil).
  sd: 1.2,
  // Hårde grænser så afledte evner bliver i ungdoms-båndet (stat 50 → evne 1).
  statFloor: 50,
  statCeil: 62,
});

// Generér lave, anlægs-formede, alders-skalerede stats for én ung.
// archetypeType: en af de 8 typer (vælges af kalderen via pickYouthArchetype).
export function generateYouthStats({ rng, age, archetypeType, cfg = YOUTH_GEN_CONFIG }) {
  const arch = ARCHETYPE_BY_TYPE[archetypeType];
  if (!arch) throw new Error(`generateYouthStats: ukendt arketype ${archetypeType}`);
  const ageLift = Math.max(0, (Number(age) || 16) - 16) * cfg.statPerYearOver16;
  const base = cfg.baseStatAt16 + ageLift;
  const stats = {};
  for (const key of STAT_KEYS) {
    let v = gaussian(rng, base, cfg.sd);
    if (arch.boost[key]) v += arch.boost[key] * cfg.signatureBoostScale;
    else if (arch.damp?.includes(key)) v -= 1; // let dæmpning af modsatte
    stats[key] = Math.round(clamp(v, cfg.statFloor, cfg.statCeil));
  }
  return { stats, archetypeType };
}
