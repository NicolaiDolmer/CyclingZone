// Delt klassifikator-vægt-afledt signatur-profil (#3458 fase 2, PR2).
//
// EKSTRAHERET MØNSTER (ikke import — se nedenfor for hvorfor) fra PR1's
// academyGenerator.js (`signatureProfile`/`blendArchetypeSignature`, merged #3500):
// boost/damp-magnitude for hver stat er PROPORTIONAL med klassifikatorens EGEN
// vægt (riderTypes.js RIDER_TYPES, importeret READ-ONLY, ALDRIG muteret her) i
// stedet for en hånd-tunet flad tabel. Den evne der ADSKILLER en type fra dens
// nærmeste konkurrent (fx climber's climbing, vægt 3 — IKKE delt med puncheur)
// får dermed automatisk et større løft end en DELT evne (tempo/punch, vægt 1-2,
// delt med puncheur/gc) — separationen matcher PRÆCIS det klassifikatoren selv
// belønner. Se academyGenerator.js's YOUTH_GEN_CONFIG-kommentar for de 3
// mellemliggende designs (flad boost pr. type, ensartet magnitude) der blev
// afprøvet og forkastet FØR dette mønster blev fundet.
//
// BEVIDST IKKE en refaktorering af academyGenerator.js til at importere herfra:
// PR1 er merged + verificeret (G1 95,6%) — at koble den til et delt modul ville
// kræve re-verifikation af HELE dens scorecard for nul funktionel gevinst (samme
// tal, samme kode, blot en anden fil). Dette modul er i stedet den GENEREL­I­SEREDE
// udgave (cfg-parameteriseret magnitude/gc-ratio i stedet for academygeneratorens
// hardkodede konstanter) som PR2's NYE stier (marked/AI-fill/starter/launch i
// fictionalRiderGenerator.js) importerer — "genbrug mønstret", ikke "importér
// akademiets fil".
//
// Ren + DB-fri: ingen fs, ingen Math.random, ingen sideeffekter.

import { RIDER_TYPES } from "./riderTypes.js";

// Evne → PCM-stat-nøgle (samme mapping som academyGenerator.js — evnerne
// type-formlerne kan referere, mod de 14 legacy PCM-stat-kolonner).
export const ABILITY_TO_STAT = Object.freeze({
  climbing: "stat_bj", time_trial: "stat_tt", flat: "stat_fl", tempo: "stat_kb",
  sprint: "stat_sp", acceleration: "stat_acc", punch: "stat_bk", endurance: "stat_udh",
  recovery: "stat_res", durability: "stat_mod", descending: "stat_ned",
  cobblestone: "stat_bro", aggression: "stat_ftr",
});

const RIDER_TYPE_WEIGHTS_BY_KEY = Object.freeze(
  Object.fromEntries(RIDER_TYPES.map((t) => [t.key, t.weights])),
);

/**
 * { boost: { stat_key: vægt (>0) }, damp: { stat_key: |vægt| (fra <0) } } for ÉN
 * arketype, afledt af riderTypes.js' EGNE klassifikator-vægte.
 *
 * cfg.gcTimeTrialBoostRatio/gcClimbingBoostRatio (default 1 = ingen justering):
 * gc er det ENESTE anlæg hvis to TOP-vægtede evner (climbing OG time_trial, begge
 * vægt 3) er en RIVAL-typs (tt) HELE signatur alene — et symmetrisk boost mætter
 * derfor time_trial lige så højt som en REN tt-profil, hvilket vinder "som-var-han-
 * tt"-normaliseringen (G3) fra gc. Se academyGenerator.js's kommentar ved
 * GC_TIME_TRIAL_BOOST_RATIO for den fulde udledning (samme fund, genbrugt her som
 * en cfg-parameter i stedet for en hardkodet konstant).
 */
export function signatureProfile(archetypeKey, cfg = {}) {
  const { gcTimeTrialBoostRatio = 1, gcClimbingBoostRatio = 1 } = cfg;
  const weights = RIDER_TYPE_WEIGHTS_BY_KEY[archetypeKey];
  if (!weights) throw new Error(`signatureProfile: ukendt arketype ${archetypeKey}`);
  const boost = {};
  const damp = {};
  for (const [ability, w] of Object.entries(weights)) {
    const statKey = ABILITY_TO_STAT[ability];
    if (!statKey) continue; // evner uden en PCM-kilde (ingen i dag) — spring over
    if (w > 0) boost[statKey] = w;
    else if (w < 0) damp[statKey] = -w;
  }
  if (archetypeKey === "gc") {
    boost[ABILITY_TO_STAT.time_trial] *= gcTimeTrialBoostRatio;
    boost[ABILITY_TO_STAT.climbing] *= gcClimbingBoostRatio;
  }
  return { boost, damp };
}

/**
 * Bland to arketypers signatur til ÉN syntetisk profil til en hybrid-rytter.
 * boost = gennemsnit af de to vægte (union af nøgler, manglende = 0) — begge
 * anlæg bidrager, ingen forsvinder. damp = KUN de FÆLLES svagheder (snit, ikke
 * union) — en hybrid skal ikke dæmpes på en evne der er den ENE arketypes
 * signatur (fx en climber+puncheur-hybrid må ikke dæmpe punch).
 */
export function blendArchetypeSignature(primaryKey, secondaryKey, cfg = {}) {
  const a = signatureProfile(primaryKey, cfg);
  const b = signatureProfile(secondaryKey, cfg);
  const boost = {};
  for (const key of new Set([...Object.keys(a.boost), ...Object.keys(b.boost)])) {
    boost[key] = ((a.boost[key] ?? 0) + (b.boost[key] ?? 0)) / 2;
  }
  const damp = {};
  for (const key of Object.keys(a.damp)) {
    if (key in b.damp) damp[key] = (a.damp[key] + b.damp[key]) / 2;
  }
  return { boost, damp };
}

// Største magnitude i en boost- eller damp-map (0 hvis tom). Bruges af callere
// til at NORMALISERE magnitude tier-uafhængigt: typens EGEN top-vægtede evne
// mætter sit hovedrum (frac 1.0) uanset hvor højt/lavt tier-basen ligger, mens
// lavere-vægtede DELTE evner kun får en forholdsmæssig mindre andel af det SAMME
// hovedrum — en tier-invariant udgave af akademiets flade "vægt × konstant".
export function signatureMagnitudeScale(map) {
  const vals = Object.values(map);
  return vals.length ? Math.max(...vals) : 0;
}
