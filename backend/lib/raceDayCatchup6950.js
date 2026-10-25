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
// HVAD MODULET ER: rene funktioner, ingen DB, ingen flag-laesning. Motoren
// (dailyTrainingEngine.js, loebs-grenen med raceDayProgram) kalder dem gennem
// raceCatchUpWiring.js bag flaget race_day_catchup_enabled (slukket).
//
// KOBLINGEN HAR TO DELE, og de maa kun taendes SAMMEN:
//   1. raceDayCatchupTickOverrides(): staff og facilityTier ud af loebsdagen (S13).
//   2. raceDayCatchupAbilityMultiplier(): loebets ekstra, KUN i etapens
//      profil-evner (S14: "ekstra udbytte i etapens evner"). Off-fokus-evnerne
//      faar basis uaendret. Leddet er applyDailyTick's `abilityYieldMult` (pr.
//      evne, ganget paa delta'en uden for traeningsscore-koblingen, del 2-spec §5).
// Del 1 alene giver et rigt hold mindre ud af loebsdagen end i dag og bryder G2.
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

const CONFIG_KEYS = Object.freeze([
  "supplement",
  "levelBonusMax",
  "decisionBonusMax",
  "droppedInFinalShare",
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
 *   droppedInFinalShare  andel af afgoerelses-bonussen for "faldt fra i
 *                     finalen" (ejerens "mellem"), strengt mellem 0 og 1
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
  if (!(cfg.droppedInFinalShare > 0 && cfg.droppedInFinalShare < 1)) {
    throw new Error("race-day catch-up: config.droppedInFinalShare must be strictly between 0 and 1");
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
    // Number(null) og Number("") er 0: en manglende rating maa ikke traekke feltet ned.
    .filter((v) => v != null && v !== "")
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

/**
 * Afgoerelses-bonussens andel (0-1). Ejerens ord (S14): med i afgoerelsen = fuld,
 * hjaelpere der arbejder i finalen "taeller med" = fuld, faldet fra i finalen =
 * "mellem" (andelen er privat konfiguration). Ukendt kategori → 0 (fail-safe).
 */
export function decisionBonusShare(decision, cfg) {
  const c = assertCatchupConfig(cfg);
  if (decision === RACE_DAY_DECISION.IN_DECISION || decision === RACE_DAY_DECISION.HELPER_IN_FINAL) return 1;
  if (decision === RACE_DAY_DECISION.DROPPED_IN_FINAL) return c.droppedInFinalShare;
  return 0;
}

/**
 * Loebets ekstra som multiplikator (>= 1, aldrig under basis). Den bygges af et fast
 * tillaeg, en bonus for passende svaerhed og en bonus for at vaere med i afgoerelsen.
 * Den praecise sammensaetning og alle vaegte er privat (hard rule 17, balance-internals/).
 *
 * Gaelder KUN etapens profil-evner (se raceDayCatchupAbilityMultiplier).
 * Udgaaet rytter (finished === false, S16): 1 = kun basis.
 * Pengene indgaar ikke (S13): samme input giver samme multiplikator for alle hold.
 */
export function raceDayCatchupMultiplier({ riderLevel, fieldLevel, decision = RACE_DAY_DECISION.NONE, finished = true, cfg }) {
  const c = assertCatchupConfig(cfg);
  if (finished === false) return 1;
  return 1
    + c.supplement
    + c.levelBonusMax * levelBonusShare({ riderLevel, fieldLevel, cfg: c })
    + c.decisionBonusMax * decisionBonusShare(decision, c);
}

/**
 * Multiplikatoren for én evne: loebets ekstra i etapens profil-evner
 * (program.focusAbilities fra raceDayProgram), 1 for alle andre evner.
 */
export function raceDayCatchupAbilityMultiplier({ ability, focusAbilities, ...args }) {
  const focus = Array.isArray(focusAbilities) ? focusAbilities : [];
  if (!focus.includes(ability)) {
    assertCatchupConfig(args.cfg);
    return 1;
  }
  return raceDayCatchupMultiplier(args);
}

/**
 * Pengedelen af koblingen (S13): staff og facilityTier ud af loebsdagen.
 * Maa KUN bruges sammen med raceDayCatchupAbilityMultiplier (se docblokken
 * oeverst); alene giver den et rigt hold mindre end i dag (G2).
 */
export function raceDayCatchupTickOverrides() {
  return Object.freeze({ staff: null, facilityTier: null });
}
