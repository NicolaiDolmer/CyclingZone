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

// #2064 (ejer-valg 19/7): geometrisk potentiale-fordeling — hvert halve trin er
// POTENTIALE_DECAY gange så sandsynligt som det forrige. Bunden er enorm, toppen
// er lotteri (6.0 ≈ 0,11% ≈ "årtiets talent"; jf. FM-wonderkids/virkelige akademier).
// 'Seriøs' AFLEDES nu af trækket (pot ≥ 4.5) i stedet for at styre det.
export const POTENTIALE_TIERS = Object.freeze([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6]);
export const POTENTIALE_DECAY = 0.55;
const POTENTIALE_WEIGHTS = POTENTIALE_TIERS.map((_, k) => POTENTIALE_DECAY ** k);
const POTENTIALE_WEIGHT_SUM = POTENTIALE_WEIGHTS.reduce((a, b) => a + b, 0);

export function drawPotentiale(rng) {
  let roll = rng() * POTENTIALE_WEIGHT_SUM;
  for (let k = 0; k < POTENTIALE_WEIGHTS.length; k++) {
    roll -= POTENTIALE_WEIGHTS[k];
    if (roll <= 0) return POTENTIALE_TIERS[k];
  }
  return POTENTIALE_TIERS[POTENTIALE_TIERS.length - 1];
}

// Vælg et ungdoms-anlæg (én af de 8 typer). Holdt enkelt; nation-bias rører ikke type.
const YOUTH_ARCHETYPE_POOL = ["climber", "sprinter", "tt", "puncheur", "brostensrytter", "baroudeur", "rouleur", "gc"];
function pickYouthArchetype(rng) {
  return YOUTH_ARCHETYPE_POOL[Math.floor(rng() * YOUTH_ARCHETYPE_POOL.length)];
}

/**
 * Generér et akademi-kuld af ungdomskandidater (rører ingen DB).
 *
 * @param {object}  opts
 * @param {function} opts.rng              seeded PRNG (fra makeRng)
 * @param {number}  opts.referenceYear     beregner alder/fødselsdato mod dette år
 * @param {Set<string>} opts.existingNames foldNameNordic-sæt af eksisterende navne (muteres)
 * @param {{ dominant_nationality?: string }} [opts.identityBasis]  nation-bias
 * @param {number|null} [opts.countOverride]         #2064 S0: overstyr antal (drip-kuld-størrelse)
 * @returns {{ is_serious: boolean, rider: object }[]}
 */
export function generateAcademyCandidates({
  rng,
  referenceYear,
  existingNames,
  identityBasis = null,
  countOverride = null,
}) {
  // ── Antal kandidater ─────────────────────────────────────────────────────────
  // #2064 S0: `??` sikrer at rng()-trækkene sker i NØJAGTIG samme rækkefølge som
  // før når countOverride er null (determinisme for eksisterende kaldere uændret).
  const count = countOverride ??
    (ACADEMY.INTAKE_MIN + Math.floor(rng() * (ACADEMY.INTAKE_MAX - ACADEMY.INTAKE_MIN + 1)));

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

    // Potentiale: geometrisk træk (0.5-trin, 1.0-6.0). 'Seriøs' = pot ≥ 4.5 (afledt).
    const potentiale = drawPotentiale(rng);
    const is_serious = potentiale >= 4.5;

    // Stats: lav, anlægs-formet, talent-skaleret ungdoms-profil (#1791). Anlæg vælges deterministisk;
    // de lave stats giver via fallback-derivationen lave evner i ungdoms-båndet.
    const archetypeType = pickYouthArchetype(rng);
    const { stats } = generateYouthStats({ rng, age, potentiale, archetypeType });

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
  // Pot-1 anker-niveau ved 16. SÆNKET 3 rå point 2026-07-19 (ejer-valg "−3", #2064 S0):
  // det gamle bånd 51.5-57 gav 16-17-årige med afledt bedste anlæg ~14-21 = på niveau
  // med median-SENIOREN (best 21) fra dag ét ("vinder fra start"-problemet). Nyt bånd
  // ankrer 16-årige på afledt kerne ~3 / bedste ~6 og graduerings-alder (20-21) på ~12
  // — lige under senior-medianen. Loft/peak (loftByPotential, peak 27-28) er URØRT:
  // kun rampen flytter. Empirisk verifikation: docs/superpowers/specs/
  // 2026-07-19-2064-soendags-aargangsmodel-influx-design.md §2a.
  baseStatAt16: 47.5,
  // Stat-løft pr. potentiale-trin over 1 → talent-TENDENS i starten (ikke 1:1 aflæseligt pga. startLuck).
  potStartLift: 0.5,
  // Per-rytter "start-held": ÉT seeded gaussian-træk der løfter/sænker HELE profilen, så
  // potentiale-tiers overlapper. Store talenter kan være langsomme startere; små kan starte lidt over middel.
  startLuckSd: 1.2,
  // Alders-skalering ("spol kurven frem" til faktisk alder).
  statPerYearOver16: 1.4,
  // Arketypens signatur-stats løftes (skaleret ned fra voksen-niveau).
  signatureBoostScale: 0.20,
  // Hårde grænser (−3-bånd): gulv → afledt bund ~1-3; loft → afledt top mætter ~12.
  sd: 0.8,
  statFloor: 48.5,
  statCeil: 54,
});

// Generér lave, anlægs-formede, alders- OG talent-skalerede stats for én ung, med per-rytter start-held.
export function generateYouthStats({ rng, age, potentiale, archetypeType, cfg = YOUTH_GEN_CONFIG }) {
  const arch = ARCHETYPE_BY_TYPE[archetypeType];
  if (!arch) throw new Error(`generateYouthStats: ukendt arketype ${archetypeType}`);
  const ageLift = Math.max(0, (Number(age) || 16) - 16) * cfg.statPerYearOver16;
  const potLift = (clamp(Number(potentiale) || 1, 1, 6) - 1) * cfg.potStartLift;
  const startLuck = gaussian(rng, 0, cfg.startLuckSd); // ÉT træk pr. rytter (coherent profil-shift) — BLØDGØR talent-tendensen
  const base = cfg.baseStatAt16 + ageLift + potLift + startLuck;
  const stats = {};
  for (const key of STAT_KEYS) {
    let v = gaussian(rng, base, cfg.sd);
    if (arch.boost[key]) v += arch.boost[key] * cfg.signatureBoostScale;
    else if (arch.damp?.includes(key)) v -= 1;
    stats[key] = Math.round(clamp(v, cfg.statFloor, cfg.statCeil));
  }
  return { stats, archetypeType };
}
