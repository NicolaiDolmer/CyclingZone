// Ryttertyper (#49 / #92) — eneste sandhedskilde for klassifikationsformlerne.
//
// En ryttertype udledes deterministisk af de 14 legacy stats (stat_fl…stat_ftr).
// Hver stat normaliseres FØRST til en z-score mod populationens middel/spredning
// (baseline), og #49's vægte anvendes så på z-scoren. Type = RELATIV styrke mod
// feltet, ikke absolut niveau.
//
// Hvorfor z-score og ikke rå vægtet sum: verificeret mod alle 8.989 ryttere gav
// rå #49-formler en degenereret fordeling (33%+ "sprinter", gc/goat døde), fordi
// en absolut score belønner de stats der globalt er højest. Z-score spreder
// fordelingen realistisk. Samme princip som rider_derived_abilities
// (abilityDerivation.js percentil-skalering). Se docs/decisions.
//
// FASE 1 bevidst på legacy stats (ikke rider_derived_abilities): vi får et
// fungerende system nu og holder bagefter gammel type op mod den nye ability-
// model, så hjemmelavede ryttere får realistiske evner (#1105, separat fase).
//
// Baseline gives som PARAMETER (ren funktion — ingen fs/JSON-import her), præcis
// som riderValuation.js tager modellen ind. Produktion: backfillRiderTypes.js
// loader backend/lib/riderTypesBaseline.json (fittet af fitRiderTypesBaseline.js)
// og persisterer primary_type/secondary_type på riders. Frontend LÆSER bare de
// kolonner — den genberegner ikke (ingen formel-dublet på tværs af front/back).
//
// Forkortelse → DB-felt: Fl=stat_fl, Bj=stat_bj, Kb=stat_kb, Bk=stat_bk,
// Tt=stat_tt, Prl=stat_prl, Bro=stat_bro, Sp=stat_sp, Acc=stat_acc,
// Ned=stat_ned, Udh=stat_udh, Mod=stat_mod, Res=stat_res, Ftr=stat_ftr.

export const STAT_KEYS = Object.freeze([
  "stat_fl", "stat_bj", "stat_kb", "stat_bk", "stat_tt", "stat_prl",
  "stat_bro", "stat_sp", "stat_acc", "stat_ned", "stat_udh", "stat_mod",
  "stat_res", "stat_ftr",
]);

// Rækkefølgen er TIE-BREAK-prioritet: ved lige score vinder den tidligste type.
// Mere markante/specialiserede typer står først.
export const RIDER_TYPES = Object.freeze([
  { key: "sprinter",   weights: { stat_acc: 3, stat_sp: 2, stat_fl: 1, stat_mod: 1 } },
  { key: "leadout",    weights: { stat_sp: 3, stat_acc: 2, stat_fl: 1, stat_mod: 1 } },
  { key: "climber",    weights: { stat_bj: 3, stat_kb: 2, stat_bk: 1, stat_udh: 1 } },
  { key: "puncheur",   weights: { stat_bk: 3, stat_kb: 2, stat_fl: 2, stat_mod: 2, stat_bj: 1, stat_udh: 1 } },
  { key: "tt",         weights: { stat_tt: 3, stat_prl: 2 } },
  { key: "classics",   weights: { stat_bro: 3, stat_fl: 2, stat_udh: 2, stat_bk: 1 } },
  { key: "gc",         weights: { stat_bj: 3, stat_res: 3, stat_tt: 2, stat_kb: 2, stat_fl: 1, stat_mod: 1, stat_udh: 1, stat_prl: 1, stat_bk: 1 } },
  { key: "goat",       weights: { stat_fl: 3, stat_bj: 3, stat_udh: 3, stat_kb: 2, stat_bk: 2 } },
  { key: "allrounder", weights: { stat_udh: 2, stat_fl: 1, stat_tt: 1, stat_bk: 1, stat_kb: 1 } },
  { key: "rouleur",    weights: { stat_fl: 2, stat_udh: 1 } },
  { key: "baroudeur",  weights: { stat_ftr: 3, stat_fl: 2, stat_bk: 1, stat_udh: 1, stat_res: 1, stat_mod: 1, stat_sp: 1, stat_ned: 1 } },
  { key: "domestique", weights: { stat_udh: 2, stat_res: 2, stat_mod: 2, stat_fl: 1 } },
]);

export const RIDER_TYPE_KEYS = Object.freeze(RIDER_TYPES.map((t) => t.key));

// Neutral baseline (mean 0, std 1 pr. stat) = ingen z-transformation (rå stats).
// Kun en fallback; produktion SKAL give den fittede baseline.
export const NEUTRAL_BASELINE = Object.freeze({
  mean: Object.freeze(Object.fromEntries(STAT_KEYS.map((s) => [s, 0]))),
  std: Object.freeze(Object.fromEntries(STAT_KEYS.map((s) => [s, 1]))),
});

// z-score for én stat mod baseline. Manglende/ikke-numerisk stat → 0 (= mean).
function statZ(rider, stat, baseline) {
  const v = Number(rider?.[stat]);
  if (!Number.isFinite(v)) return 0;
  const mean = baseline?.mean?.[stat] ?? 0;
  const std = baseline?.std?.[stat] || 1;
  return (v - mean) / std;
}

// Vægtet gennemsnit af z-scores for én types stats. Skala er z (~ -3..+3);
// kun den RELATIVE rangering mellem typer betyder noget for klassifikationen.
export function scoreRiderType(rider = {}, weights = {}, baseline = NEUTRAL_BASELINE) {
  let weighted = 0;
  let weightSum = 0;
  for (const [stat, w] of Object.entries(weights)) {
    weighted += statZ(rider, stat, baseline) * w;
    weightSum += w;
  }
  if (weightSum === 0) return 0;
  return weighted / weightSum;
}

// Beregn primær + sekundær type for en rytter (top-2 altid).
// Returnerer { primary: {key, score}, secondary: {key, score} }.
// Deterministisk: ved lige score afgøres rækkefølgen af RIDER_TYPES-ordenen
// (stabil sortering), så samme stats + baseline → samme klassifikation hver gang.
export function computeRiderTypes(rider = {}, baseline = NEUTRAL_BASELINE) {
  const scored = RIDER_TYPES.map((t) => ({ key: t.key, score: scoreRiderType(rider, t.weights, baseline) }));
  // Stabil sort (Node garanterer): lige scores beholder RIDER_TYPES-rækkefølgen.
  scored.sort((a, b) => b.score - a.score);
  return { primary: scored[0], secondary: scored[1] };
}
