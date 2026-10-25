// #6950 / #6110 byggetrin 7 (c): Udviklingsscore B koblet ind i motoren, bag
// flaget `development_score_v2` (slukket).
//
// Spec: docs/superpowers/specs/2026-10-23-6110-udviklingsscore-teknisk-design.md
// §3 og §6, samlet design §13 (S10, S11, S13, S14, S16, S22, S29).
//
// ═══ HVAD MODULET GOER ═══════════════════════════════════════════════════════
// 1. loadDevelopmentScoreB(): flaget + de private params. Returnerer null (dagens
//    model, bit-identisk) naar flaget er slukket, params mangler eller er ugyldige,
//    eller naar maks +1 pr. evne pr. dato (#7075) er slukket. Scoren tændes aldrig
//    uden dato-loftet, saa en hoej score aldrig kan give to point paa én dato.
// 2. developmentScoreDayForTick(): bygger developmentDay()-input af det motoren
//    allerede har (program, anlaeg, staff, facilitet, etapens profil) og returnerer
//    { score, devMult, kind } eller null (hviledag).
//
// Motoren sender resultatet som `developmentScore` ind i applyDailyTick. Dér
// erstatter devMult rytter-leddet (S22: scoren ER udviklingen), og traeneren
// ganges ikke laengere pr. evne, fordi han allerede staar i scoren (spec §3:
// niveau-kurven × rolleklasse-fart × devMult).
//
// ═══ TALENTET INDTIL GRUNDTALENTET FINDES ════════════════════════════════════
// Scoren vil have grundtalentet i ratingens skala (byggetrin 2/12, ikke bygget).
// Indtil da oversaettes `riders.potentiale` via en PRIVAT tabel i samme
// miljoe-parametre (`talentByPotentiale`, ét anker pr. helt potentiale,
// rangbevarende). Uden tabellen er params ugyldige, saa potentialet aldrig tavst
// falder ud af udviklingen. Traeningsdisciplin (S11) findes ikke som evne endnu
// og sendes som null (neutral).
//
// ═══ TAL ═════════════════════════════════════════════════════════════════════
// Alle tal er private (hard rule 17). app_config kan laeses af alle indloggede,
// saa de ligger i serverens miljoe (DEVELOPMENT_SCORE_V2_PARAMS, JSON):
//   { "score": <DevelopmentScoreParams>, "talentByPotentiale": [<6 tal>] }
// Loggen naevner aldrig tallene.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { readConditionWriterFlag } from "./trainingDateConditionFlag.js";
import { assertDevelopmentScoreParams, developmentDay } from "./developmentScore.ts";
import { raceDayProgram, RACE_DAY_FALLBACK_PROFILE } from "./raceDayYield.js";
import { raceCatchUpTickArgs } from "./raceCatchUpWiring.js";

// Samme noegle som developmentScore.ts eksporterer (testen laaser det). Den staar som
// literal her, saa flag-katalogets scanner (stageFlagCatalog.test.js) kan finde den.
export const DEVELOPMENT_SCORE_V2_FLAG_KEY = "development_score_v2";
export const DEVELOPMENT_SCORE_V2_PARAMS_ENV = "DEVELOPMENT_SCORE_V2_PARAMS";
const LOG_TAG = "[development-score-b]";

// Potentiale 1-6 (halve trin). Ét anker pr. helt trin.
const POTENTIALE_ANCHORS = 6;

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Validerer de samlede miljoe-params. Ugyldigt eller ufuldstaendigt = null
 * (fail-safe: dagens model). Returnerer en frosset kopi.
 */
export function validateDevelopmentScoreWiringParams(raw) {
  if (!raw || typeof raw !== "object") return null;
  try {
    assertDevelopmentScoreParams(raw.score);
  } catch {
    return null;
  }
  const table = raw.talentByPotentiale;
  if (!Array.isArray(table) || table.length !== POTENTIALE_ANCHORS) return null;
  for (let i = 0; i < table.length; i += 1) {
    const v = table[i];
    if (!isFiniteNumber(v) || v < 1 || v > 99) return null;
    // Rangbevarende: hoejere potentiale giver aldrig lavere talent.
    if (i > 0 && v < table[i - 1]) return null;
  }
  return Object.freeze({
    score: Object.freeze(structuredClone(raw.score)),
    talentByPotentiale: Object.freeze([...table]),
  });
}

/** Parser params fra miljoeet. Ugyldig eller manglende = null. */
export function developmentScoreParamsFromEnv(env = process.env) {
  const raw = env?.[DEVELOPMENT_SCORE_V2_PARAMS_ENV];
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    return validateDevelopmentScoreWiringParams(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Flaget. Kun "on" (eller true) taender; "beta" laeses som off (live balance-
 * aendring uden skyggedata). strict = dato-afregningens atomare sti: en fejlet
 * laesning kaster i stedet for at blive tolket som slukket.
 */
export async function isDevelopmentScoreV2Enabled(supabase, { strict = false } = {}) {
  if (strict) return readConditionWriterFlag(supabase, DEVELOPMENT_SCORE_V2_FLAG_KEY);
  return evaluateFlagStage(await readFlagStage(supabase, DEVELOPMENT_SCORE_V2_FLAG_KEY));
}

/**
 * Det motoren skal bruge i dag: params naar flaget er on, params er gyldige og
 * dato-loftet (#7075) er on. Ellers null (dagens model).
 */
export async function loadDevelopmentScoreB({
  supabase, env = process.env, log = console, strict = false, capPerDateOn = false,
}) {
  if (!(await isDevelopmentScoreV2Enabled(supabase, { strict }))) return null;
  const params = developmentScoreParamsFromEnv(env);
  if (!params) {
    log?.warn?.(`${LOG_TAG} ${DEVELOPMENT_SCORE_V2_FLAG_KEY} is on, but ${DEVELOPMENT_SCORE_V2_PARAMS_ENV} is missing or invalid - running today's model`);
    return null;
  }
  if (!capPerDateOn) {
    log?.warn?.(`${LOG_TAG} ${DEVELOPMENT_SCORE_V2_FLAG_KEY} is on, but the max one point per ability per date rule is off - running today's model`);
    return null;
  }
  return params;
}

/**
 * Grundtalentet i ratingens skala fra potentialet (1-6, halve trin), lineaert
 * mellem de private ankre. Ukendt potentiale = null (talent-leddet bliver neutralt).
 */
export function talentFromPotentiale(potentiale, table) {
  const p = Number(potentiale);
  if (potentiale == null || !Number.isFinite(p) || !Array.isArray(table) || table.length !== POTENTIALE_ANCHORS) return null;
  const x = Math.min(POTENTIALE_ANCHORS, Math.max(1, p));
  const lo = Math.floor(x);
  const hi = Math.min(POTENTIALE_ANCHORS, lo + 1);
  const t = x - lo;
  return table[lo - 1] + (table[hi - 1] - table[lo - 1]) * t;
}

// Loebsmotorens afgoerelses-kategorier (raceDayCatchup6950.js) til scorens.
const DECISION_FROM_RACE = Object.freeze({
  in_decision: "decisive",
  helper_in_final: "decisive",
  dropped_in_final: "finale",
});

/**
 * Dagens Udviklingsscore for én rytter-dag i motoren. null = hviledag eller
 * scoren er slukket (params null).
 *
 * Loebsdagen: etapens profil, gennemfoert (S16), afgoerelse og niveau (S14). Den
 * data findes ikke fra loebsmotoren endnu; motoren sender derfor kun profilen, og
 * scoren regner da en gennemfoert loebsdag uden afgoerelses- og niveau-bonus.
 */
export function developmentScoreDayForTick({
  params, riderId, dayKey, racedToday = false, program,
  primaryType = null, secondaryType = null, potentiale = null,
  staff = null, facilityTier = null, riderLevel = null,
  profileType = null, finished = true, decision = null, riderRating = null, fieldRating = null,
  baseTalent = null, trainingDiscipline = null,
}) {
  if (!params) return null;
  const talent = {
    baseTalent: isFiniteNumber(baseTalent) ? baseTalent : talentFromPotentiale(potentiale, params.talentByPotentiale),
    trainingDiscipline: isFiniteNumber(trainingDiscipline) ? trainingDiscipline : null,
  };
  const common = { riderId: String(riderId), dayKey: String(dayKey), talent, primaryType, secondaryType };
  const input = racedToday
    ? {
      ...common,
      kind: "race",
      profileType,
      stageAbilities: program?.focusAbilities ?? null,
      finished: finished !== false,
      decision: DECISION_FROM_RACE[decision] ?? null,
      riderRating,
      fieldRating,
    }
    : { ...common, kind: "training", program, staff, facilityTier, riderLevel };
  return developmentDay(input, params.score);
}

/**
 * Det ene kald motoren goer pr. tick: de ekstra applyDailyTick-argumenter fra
 * Udviklingsscore B og catch-up via loeb. Begge slukket = tomt objekt, saa
 * kaldet er bit-identisk med i dag.
 *
 * `tickArgs` er motorens faelles tick-argumenter (sharedTickArgs). Paa en
 * loebsdag bygges programmet af etapens profil, praecis som motoren selv goer.
 */
export function developmentTickArgs({
  developmentScoreB = null, raceCatchUp = null, dayKey, tickArgs, racedToday = false, profileType = null,
}) {
  if (!developmentScoreB && !raceCatchUp) return {};
  const profile = profileType ?? RACE_DAY_FALLBACK_PROFILE;
  const program = racedToday ? raceDayProgram(profile) : tickArgs.program;
  const developmentScore = developmentScoreDayForTick({
    params: developmentScoreB,
    riderId: tickArgs.riderId,
    dayKey,
    racedToday,
    program,
    primaryType: tickArgs.primaryType ?? null,
    secondaryType: tickArgs.secondaryType ?? null,
    potentiale: tickArgs.potentiale ?? null,
    staff: tickArgs.staff ?? null,
    facilityTier: tickArgs.facilityTier ?? null,
    riderLevel: tickArgs.riderLevel ?? null,
    profileType: profile,
  });
  const catchUp = raceCatchUpTickArgs({
    cfg: raceCatchUp, racedToday, developmentScoreOn: !!developmentScoreB, program,
  });
  return developmentScore ? { ...catchUp, developmentScore } : catchUp;
}
