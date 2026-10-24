// #6950 valg A · Catch-up via loeb for smaa hold (Udvikling 2.0 del 2, epic #6110).
//
// Ejer-valg 20/10 (#6950 A): "loeft bunden via loeb". Smaa hold faar fuldt udbytte
// af loeb paa deres eget niveau ("passende svaerhed", D-018). Ingen nye penge,
// toppen roeres ikke.
//
// Ejer-svar 23/10 (samlet spec §13, docs/superpowers/specs/
// 2026-10-23-6110-potentiale-et-tal-samlet-design.md):
//   S13  Facilitet og traener forbedrer KUN traeningsdage, aldrig loebsdagen.
//        Loebsdagens udvikling er ens for alle hold (catch-up-kanalen).
//        Gate G2: ingen rytter faar mindre ud af en loebsdag end i dag.
//   S14  "Laer af afgoerelsen": ekstra udbytte for ryttere med i afgoerelsen,
//        mellem for dem der faldt fra i finalen; hjaelpere der arbejder i
//        finalen taeller med. Plus en BRED bonus omkring eget niveau og et lidt
//        staerkere felt, aldrig under fuldt udbytte, ingen bonus ved et alt for
//        haardt felt.
//   S16  Udgaaet rytter: kun basis, ikke loebets ekstra.
//
// HVAD MODULET ER: rene funktioner, ingen DB, ingen flag-laesning, ingen kaldere
// endnu. Motoren (dailyTrainingEngine.js, loebs-grenen med raceDayProgram) faar
// en tynd kobling bag et slukket flag i en senere PR, naar flag-kataloget og
// #7075 er merget (se PR-body). Koblingen er tiltaenkt saadan:
//
//   applyDailyTick({ ...sharedTickArgs, program: raceDayProgram(...),
//     hardDailyCap, ...raceDayCatchupTickOverrides({ riderLevel, fieldLevel,
//     decision, finished, cfg }) })
//
// HVORFOR academyRateMult: det er applyDailyTick's eneste "ekstra led, default
// 1.0"-multiplikator, ganget SIDST i begge grene af dailyAbilityDelta. Saa
// loebets ekstra bliver en ren skalering af samme kaede (fremdrifts-bar,
// carry-over og +1-loftet arves uaendret), uden en kopi af formlen.
//
// TAL (hard rule 17): konfigurationen har INGEN standardvaerdier i repoet.
// Stoerrelserne kalibreres i del 2-harnessen (G1-G8) og leveres fra den private
// runtime-kilde (#6998) eller harnessen. Uden gyldig konfiguration kaster
// funktionerne, saa en halvt sat konfiguration aldrig kan ramme spillere.

/** Afgoerelses-kategorier fra loebsmotoren (S14). Ukendt/null = ikke i finalen. */
export const RACE_DAY_DECISION = Object.freeze({
  IN_DECISION: "in_decision",
  HELPER_IN_FINAL: "helper_in_final",
  DROPPED_IN_FINAL: "dropped_in_final",
  NONE: "none",
});

// Andel af afgoerelses-bonussen pr. kategori. Ikke balance-tal men ejerens ord:
// "med i afgoerelsen" = fuld, "hjaelpere der arbejder i finalen taeller med" =
// fuld, "mellem for dem der faldt fra i finalen" = halv.
const DECISION_SHARE = Object.freeze({
  [RACE_DAY_DECISION.IN_DECISION]: 1,
  [RACE_DAY_DECISION.HELPER_IN_FINAL]: 1,
  [RACE_DAY_DECISION.DROPPED_IN_FINAL]: 0.5,
  [RACE_DAY_DECISION.NONE]: 0,
});

const CONFIG_KEYS = Object.freeze([
  "supplement",
  "levelBonusMax",
  "decisionBonusMax",
  "easyEdge",
  "plateauStart",
  "plateauEnd",
  "hardEdge",
]);

/**
 * Validerer en catch-up-konfiguration og returnerer en frosset kopi.
 *
 * Felter (alle tal, skala = ratingens skala for niveau-graenserne):
 *   supplement        loebets ekstra oven paa basis (>= 0), ens for alle hold
 *   levelBonusMax     niveau-bonussens top (>= 0)
 *   decisionBonusMax  afgoerelses-bonussens top (>= 0)
 *   easyEdge < plateauStart <= plateauEnd < hardEdge
 *                     afstand felt minus rytter; bonus 0 under easyEdge og over
 *                     hardEdge, fuld mellem plateauStart og plateauEnd
 */
export function assertCatchupConfig(cfg) {
  if (!cfg || typeof cfg !== "object") throw new Error("race-day catch-up: config missing");
  for (const key of CONFIG_KEYS) {
    if (!Number.isFinite(cfg[key])) throw new Error(`race-day catch-up: config.${key} must be a finite number`);
  }
  for (const key of ["supplement", "levelBonusMax", "decisionBonusMax"]) {
    if (cfg[key] < 0) throw new Error(`race-day catch-up: config.${key} must be >= 0`);
  }
  if (!(cfg.easyEdge < cfg.plateauStart && cfg.plateauStart <= cfg.plateauEnd && cfg.plateauEnd < cfg.hardEdge)) {
    throw new Error("race-day catch-up: zone must satisfy easyEdge < plateauStart <= plateauEnd < hardEdge");
  }
  const frozen = {};
  for (const key of CONFIG_KEYS) frozen[key] = cfg[key];
  return Object.freeze(frozen);
}

/**
 * Feltets niveau = medianen af starternes niveau (alle startere, ogsaa AI).
 * Ikke-endelige vaerdier ignoreres. Tomt felt → null (ingen niveau-bonus).
 */
export function fieldLevelMedian(levels) {
  const values = (Array.isArray(levels) ? levels : [])
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

// Glidende overgang 0 → 1 (smoothstep). Ingen trappe ind og ud af zonen.
function smoothstep(edge0, edge1, x) {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const t = (x - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}

/**
 * Niveau-bonussens andel (0-1) for afstanden felt minus rytter.
 * Bred bule omkring eget niveau og et lidt staerkere felt: stiger glidende fra
 * easyEdge til plateauStart, fuld paa plateauet, falder glidende til 0 ved
 * hardEdge. Alt for let og alt for haardt felt giver 0 (G7: ingen gevinst ved at
 * sende en svag rytter i et alt for staerkt felt). Ukendt niveau → 0.
 */
export function levelBonusShare({ riderLevel, fieldLevel, cfg }) {
  const c = assertCatchupConfig(cfg);
  const rider = Number(riderLevel);
  const field = Number(fieldLevel);
  if (riderLevel == null || fieldLevel == null || !Number.isFinite(rider) || !Number.isFinite(field)) return 0;
  const gap = field - rider;
  if (gap <= c.easyEdge || gap >= c.hardEdge) return 0;
  if (gap < c.plateauStart) return smoothstep(c.easyEdge, c.plateauStart, gap);
  if (gap <= c.plateauEnd) return 1;
  return 1 - smoothstep(c.plateauEnd, c.hardEdge, gap);
}

/** Afgoerelses-bonussens andel (0-1). Ukendt kategori → 0 (fail-safe). */
export function decisionBonusShare(decision) {
  return DECISION_SHARE[decision] ?? 0;
}

/**
 * Loebsdagens samlede multiplikator oven paa basis (>= 1, aldrig under basis).
 *
 *   1 + supplement + levelBonusMax * niveau-andel + decisionBonusMax * afgoerelses-andel
 *
 * Udgaaet rytter (finished === false, S16): 1 = kun basis.
 * Pengene indgaar ikke (S13): samme input giver samme multiplikator for alle hold.
 */
export function raceDayCatchupMultiplier({ riderLevel, fieldLevel, decision = RACE_DAY_DECISION.NONE, finished = true, cfg }) {
  const c = assertCatchupConfig(cfg);
  if (finished === false) return 1;
  return 1
    + c.supplement
    + c.levelBonusMax * levelBonusShare({ riderLevel, fieldLevel, cfg: c })
    + c.decisionBonusMax * decisionBonusShare(decision);
}

/**
 * Overrides til applyDailyTick paa en loebsdag med catch-up taendt.
 * staff og facilityTier nulstilles (S13: pengene loefter kun traeningsdage);
 * academyRateMult baerer loebets ekstra (se docblokken oeverst).
 */
export function raceDayCatchupTickOverrides(args) {
  return Object.freeze({
    staff: null,
    facilityTier: null,
    academyRateMult: raceDayCatchupMultiplier(args),
  });
}
