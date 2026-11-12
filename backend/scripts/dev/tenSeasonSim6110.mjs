#!/usr/bin/env node
// #6110 byggetrin 23 (S25) · 10-SÆSONERS-SIMULERING FØR TÆNDING.
//
// 100 % READ-ONLY mod prod. Scriptet SELECT'er et øjebliksbillede af verden (eller
// læser et gemt billede med --snapshot) og simulerer det 10 sæsoner frem i
// hukommelsen. Der findes ingen kode i denne fil der kan skrive til prod: klienten
// bruges kun til SELECT'erne i loadProdSnapshot. Al output er lokale filer.
//
// Testverdenen (ejer S25, 23/10): kopi af prod, ASSISTENTEN STYRER ALLE HOLD.
//   · Alle ryttere på et hold træner hver løbsdag med assistentens standardplan
//     (resolveProgram(null, type): typens standardfokus, normal intensitet) og
//     udvikler sig (også AI-hold; D6's "AI vokser ikke" gælder ikke her, fordi
//     assistenten er træner overalt).
//   · Løbsdage: rytteren kører samme andel af sæsonens løbsdage som han målt
//     kørte i den aktive sæson (nye ryttere: medianen for deres aldersgruppe).
//     Hvilke løbsdage og hvilken profil er seedet. Løbsdagen bruger løbsdags-
//     programmet (raceDayYield.raceDayProgram) og +1-loftet pr. løbsdag.
//   · Sæsonskiftet bruger Udvikling 2.0's aldring (#6499, developRiderSeasonV2)
//     med sæsonens løbsdage som bremse, og samme pensionsregel som skiftet.
//   · Pensionerede ryttere erstattes holdvis af nye unge fra produktionens egen
//     generator (generateAcademyCandidates), så truppernes størrelse holdes.
//   · Ryttere uden hold (frie, bank/test) træner ikke; de ældes og pensioneres.
//
// VARIANTER (samme verden, samme seeds):
//   nu        dagens udvikling (applyDailyTick med træningsscore-koblingen),
//             +1 pr. evne pr. løbsdag, ingen dato-loft.
//   nu_maks1  som nu + maks +1 pr. evne pr. DATO (#7075-reglen, flag
//             ability_cap_per_date_enabled; PR #7075 er ikke merget, så reglen
//             er gengivet her i capGainsPerDate: klippet point bæres videre).
//   B@x       Udviklingsscore B-proxy (byggetrin 7 er ikke bygget endnu): dagens
//             udvikling følger én score uden ungdomsfaktor, uden form/træthed
//             (S29) og uden alders-turbo (vækstfraktionen er fast), med bredere
//             dagsstøj, + maks +1 pr. dato. x er tempo-skalaen på devMult
//             (normaliseringen i det tekniske design §3): 1 = samme gennemsnitlige
//             dagsudbytte som "nu" for startbestanden. Flere x giver en kurve, så
//             ejeren kan se hvilket tempo der rammer D1-milepælene.
//   Når developmentScore (byggetrin 7) findes, skal B-proxyen erstattes af den.
//   xp        XP-modellen (#6110, spec 2026-11-06, backend/lib/developmentXp.ts):
//             prisliste, XP pr. dag, alder, type, løbsdage og maks +1 pr. dato. Ingen
//             lofter. Tallene er private (balance-internals/6110/xp-params.mjs).
//   xp_rot    som xp, men assistenten roterer mellem rytterens sessioner.
//   xp_hard   som xp, men hård intensitet hver dag (øvre grænse).
//   xp_bonus<N>  som xp, men halvdelen af managerholdene trykker Træn nu hver dato og
//             får N % ekstra XP på træningsdage (#7801). Viser hvor stor fordelen er.
//   Private varianter (andre tal) kan lægges i XP_PRIVATE.variants.
//   Led i navnet kan kombineres (#7757), fx xp_bonus15_gulv_nocap eller xp_cal_nocap:
//     _nocap   intet dagsloft (#7739): kun prisen bremser, så #7739 kan måles.
//     _gulv    en løbsdag giver mindst en hård træningsdag med rytterens træner (ejer 7/11).
//   Dagsvariationen har hukommelse, når den private fil sætter den (sim.variationMemory).
//   Gulvet og hukommelsen kører gennem XP_ENGINE_HOOKS, indtil motoren har dem selv.
//
// KOHORTEN (--cohort, #7757, ejer 7/11): kun NYE ryttere fra generatoren, fulgt fra 16
// til 40 år på billedets hold, ved siden af målingen af den nuværende verden. De to
// faste krav måles mod kurve B i samme kørsel: ekstra købte evnepoint i kravets sæson
// (verdenen) og antal kohorte-ryttere under egen kurve B-karrieretop. Grænserne læses
// fra den private fil (sim.requirements), aldrig fra koden. X7 står i sin egen fil.
//
// GATES (--xp-gates): X1-X10 pr. XP-variant står på det private XP-kort, med kurve B
// som sammenligning. H1, H2, H3, H6 og H6b køres mod det nye sande tal, rytterens
// forventede topniveau. H4 og H5 kræver fladerne og kan ikke måles her.
//
// MÅLINGER pr. variant: D1-milepælene (andel af karrierens top ved 22 og 25,
// topalder), ratingfordeling pr. sæson, pension, talent-spredning, aldersfordeling
// i top 50 og store mod små hold (division). Alle tal er PRIVATE (hard rule 17).
//
// Kør fra backend/ (prod-billede, kun SELECT):
//   infisical run --env=prod --silent -- node scripts/dev/tenSeasonSim6110.mjs
// Genkør på gemt billede (ingen prod-kald):
//   node scripts/dev/tenSeasonSim6110.mjs --snapshot <fil>
// Flag: --seasons 10 --race-days 160 --b-scales 0.75,1,1.25 --variants nu,nu_maks1,B
//       --b-noise <bredde> --b-ref-age <alder> --render-only (kortet af koerte varianter)
//       --out-dir <mappe> (default <repo>/balance-internals/6110/s25) --limit-teams N
//       --xp-gates (gates uden for sæsonløkken: X4, X5, X8, X9 og H, efter varianterne)
//       --gate-variant <navn> (gates med en anden xp-variants tal; default xp)
//       --cohort (kohorten ved siden af verdenen) · --cohort-only · --cohort-per-team N
//       --out-dir skal ligge under balance-internals/6110 (scriptet nægter alt andet)
//
// Output (gitignoreret, må aldrig committes):
//   <out-dir>/ten-season-sim-<dato>.md    ÉT privat kort med alle tal
//   <out-dir>/ten-season-sim-<dato>.json  rå tal
//   <out-dir>/xp-gates-<dato>.md          XP-gates X1-X10 og H (kun med xp-varianter)
//   <out-dir>/xp-motorpakke-<dato>.md     de to faste krav, intet dagsloft, kohorten, X6
//   <out-dir>/x7-mentale-<dato>.md        X7 særskilt
//   <out-dir>/snapshot-<dato>.json        øjebliksbilledet (kun ved prod-kørsel)

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import {
  DAILY_TRAINING_CONFIG, applyDailyTick, dailyAbilityDelta, resolveProgram,
} from "../../lib/dailyTraining.js";
import { validateDevelopmentCurveBParams } from "../../lib/developmentCurveB.ts";
import {
  abilityRoleClass, buildCapsForRider, developRiderSeasonV2, seededUnitMixed, youthRateForPotential,
} from "../../lib/riderProgression.js";
import { abilityMeta } from "../../lib/abilityRegistry.js";
import {
  abilityXpForTick, buyPoints, validateDevelopmentXpParams, xpPerDate, xpPriceForNextPoint, xpSessionShare, xpTypeShare,
} from "../../lib/developmentXp.ts";
import { CERTAINTY_WORDS, estimatePotential, uncertaintyFor, validateParams as validateEstimateParams } from "../../lib/potentialEstimate.js";
import { raceDayRoleBaseProgram, raceDayRoleYieldMultipliers, withRaceDayRoleYield } from "../../lib/raceDayRoleYield5950.js";
import { TRAINING_CONFIG, TRAINING_FOCUSES, programAbilityWeight } from "../../lib/training.js";
import { computeTrainingScore } from "../../lib/trainingScore.js";
import { V3_RIDER_TYPE_HARD_PAIRS, applyTrainingCatalog, v3SmartDefaultFocus } from "../../lib/trainingCatalogV3.js";
import { RECOVERY_INTENSITY, dayTypeForProgram } from "../../lib/trainingDayTypes.js";
import { facilityTrainingMultiplier, staffTrainingBonus } from "../../lib/staffTrainingBonus.js";
import { riderLevelBand, normalizeLevelBands } from "../../lib/staffAbilityConstants.js";
import { deriveStaffAbilities } from "../../lib/staffAbilityDerivation.js";
import { raceDayProgram } from "../../lib/raceDayYield.js";
import { RACE_PROFILE_ABILITY_MAP } from "../../lib/dailyTraining.js";
import { TRAINING_RACE_DAY_CONFIG, raceDayBudgetDivisor } from "../../lib/trainingRaceDayTick.js";
import { generateAcademyCandidates } from "../../lib/academyGenerator.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { DISPLAY_RECIPE_KEYS, ratingForRole } from "../../lib/weights/displayRecipes.js";
import { ageForSeason, LAUNCH_REFERENCE_YEAR } from "../../lib/riderSeasonAge.js";
import { RETIREMENT_NOTICE_COLUMNS, frozenNoticeFor } from "../../lib/retirementNotice.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "../../..");

// ── Parametre (strukturelle; ingen balance-tal fra motoren gentages her) ─────────
export const SIM_DEFAULTS = Object.freeze({
  seasons: 10,
  raceDaysPerSeason: 160, // S5's kalendermål (calendarRaceDayTargets.js)
  raceDaysPerDate: TRAINING_RACE_DAY_CONFIG.raceDaysPerDate,
  abilityCapPerRaceDay: TRAINING_RACE_DAY_CONFIG.abilityGainCapPerRaceDay,
  abilityCapPerDate: 1, // #7075-reglen
  bScales: Object.freeze([0.75, 1, 1.25]),
  // B-proxy: dagsstøjens bredde. Default = dagens bredde; B's bredere støj
  // sættes med --b-noise (værdien er privat og står på kortet; den endelige
  // bredde kalibreres mod H6b i byggetrin 7). Fast vækstfraktion = fraktionen
  // ved referencealderen (--b-ref-age), så alder ikke er en turbo (D-058).
  bNoiseSpan: DAILY_TRAINING_CONFIG.noiseSpan,
  bReferenceAge: 23,
  // XP: dagsvariationens bredde. Default = dagens bredde; den endelige sættes mod H6b.
  xpVariationSpan: DAILY_TRAINING_CONFIG.noiseSpan,
  inflowAgeBand: Object.freeze({ min: 17, max: 19 }),
  // #7757: kohorten af nye ryttere (ejer 7/11). Strukturelle valg, ingen balance-tal.
  cohortPerTeam: 2,
  cohortStartAge: 16,
  cohortEndAge: 40,
  // Dagsvariationens hukommelse: 0 er dagens variation uden hukommelse. Den rigtige er privat.
  xpVariationMemory: 0,
  // #3564: den rigtige kurve B (kurveB) erstatter B-proxyen som standard; "B" kan stadig vælges.
  variants: Object.freeze(["nu", "nu_maks1", "kurveB"]),
});

// Løbsprofiler en løbsdag trækkes fra (ligeligt; kalenderens faktiske mix er ikke modelleret).
export const RACE_PROFILES = Object.freeze(Object.keys(RACE_PROFILE_ABILITY_MAP));

// #6110: XP-modellens private tal (hard rule 17, gitignoreret). Uden filen kaster en xp-variant.
export const PRIVATE_XP_PATH = ["balance-internals", "6110", "xp-params.mjs"];

// #7757: kohortens kørsler gemmes ved siden af verdenens i runs-<dato>/ med dette præfiks.
export const COHORT_PREFIX = "kohorte-";

const MENTAL_ABILITIES = new Set(VISIBLE_ABILITIES.filter((a) => abilityMeta(a)?.category === "mental"));

// ── Små rene hjælpere (eksporteret til test) ─────────────────────────────────────

export function bestRating(abilities) {
  let best = null;
  for (const role of DISPLAY_RECIPE_KEYS) {
    const r = ratingForRole(abilities, role);
    if (r !== null && (best === null || r > best)) best = r;
  }
  return best;
}

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  return quantile(s, 0.5);
}

const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

/**
 * #7075-reglen: klip et ticks gevinster så evnen højst stiger `cap` på datoen.
 * Et klippet point lægges tilbage på fremdriftsbaren (bæres til næste dato).
 * Muterer ikke input. Gengivet fra PR #7075 (ikke merget endnu).
 */
export function capGainsPerDate({ tickResult, abilities, usedGains = {}, cap = 1 }) {
  if (!tickResult?.gains) return tickResult;
  let next = null;
  for (const [ability, n] of Object.entries(tickResult.gains)) {
    const gained = Number(n) || 0;
    const allowance = Math.max(0, cap - (Number(usedGains[ability]) || 0));
    if (gained <= allowance) continue;
    next ??= {
      ...tickResult,
      abilities: { ...tickResult.abilities },
      progress: { ...tickResult.progress },
      gains: { ...tickResult.gains },
    };
    const excess = gained - allowance;
    next.abilities[ability] = Number(abilities?.[ability] ?? 0) + allowance;
    next.progress[ability] = Number(next.progress[ability] ?? 0) + excess;
    if (allowance > 0) next.gains[ability] = allowance;
    else delete next.gains[ability];
  }
  return next ?? tickResult;
}

/**
 * B-proxy-tick: samme bar-løkke og +1-loft som applyDailyTick, men rytter-leddet
 * er scorens devMult = scale × talent × støj × facilitet (ingen ungdom, ingen
 * form/træthed) og vækstfraktionen er fast (alder er ikke en turbo).
 */
export function applyTickB({
  riderId, seedKey, abilities, caps, progress, program, potentiale,
  staff, facilityTier, riderLevel, primaryType, secondaryType,
  budgetDivisor, hardDailyCap, scale, noiseSpan, referenceAge,
}) {
  const nextAbilities = { ...abilities };
  const nextProgress = { ...(progress ?? {}) };
  const gains = {};
  if (program.intensity === "rest") return { abilities: nextAbilities, progress: nextProgress, gains };
  const noise = 1 - noiseSpan + 2 * noiseSpan * seededUnitMixed(`btick:${riderId}:${seedKey}`);
  const quality = scale * youthRateForPotential(potentiale) * noise * facilityTrainingMultiplier({ facilityTier, staff });
  const ceiling = Number.isFinite(hardDailyCap) ? hardDailyCap : Infinity;
  for (const ability of VISIBLE_ABILITIES) {
    const current = Number(nextAbilities[ability] ?? 0);
    if (!Number.isFinite(current)) continue;
    const delta = dailyAbilityDelta({
      ability, current, cap: caps?.[ability], age: referenceAge, program, conditionMult: 1, noise, potentiale,
      staff, facilityTier, riderLevel, primaryType, secondaryType, budgetDivisor, riderQualityMult: quality,
    });
    if (delta <= 0) continue;
    let bar = Number(nextProgress[ability] ?? 0) + delta;
    const top = Math.min(99, caps?.[ability] ?? 99);
    let got = 0;
    while (bar >= 1 && got < ceiling && current + got < top) { bar -= 1; got += 1; }
    if (got) { gains[ability] = got; nextAbilities[ability] = current + got; }
    // Samme regel som settleProgressBar (#4750): kun et bindende dagsloft gemmer resten.
    const ceilingBound = bar >= 1 && got >= ceiling && current + got < top;
    nextProgress[ability] = ceilingBound ? bar : Math.min(bar, 0.999);
  }
  return { abilities: nextAbilities, progress: nextProgress, gains };
}

/**
 * Normaliseringen for B@1 er privat (hard rule 17, Codex P1 #7154): den ligger i
 * balance-internals/6110/s25-b-normalizer.mjs (gitignoreret) og injiceres via
 * opts.bNormalizer: (ages, referenceAge) => tal. Mangler den, kaster harnessen, så en
 * kørsel aldrig stille regner B uden den rigtige normalisering.
 */
export const PRIVATE_B_NORMALIZER_PATH = ["balance-internals", "6110", "s25-b-normalizer.mjs"];

function requireBNormalizer(opts) {
  if (typeof opts?.bNormalizer !== "function") {
    throw new Error(`B-normaliseringen mangler: læg den private fil ${PRIVATE_B_NORMALIZER_PATH.join("/")} (hard rule 17) eller injicér opts.bNormalizer`);
  }
  return opts.bNormalizer;
}

// ── XP-tick (#6110) ──────────────────────────────────────────────────────────────

/** Assistentens plan med det katalog, der er live (v3). */
export function assistantProgram(primaryType, secondaryType, { intensity = null } = {}) {
  const base = resolveProgram(null, primaryType);
  const focus = v3SmartDefaultFocus(base.focus, { primary_type: primaryType, secondary_type: secondaryType }, { v3: true });
  return applyTrainingCatalog({ focus, intensity: intensity ?? base.intensity }, { v3: true });
}

/** Rotationen: typens to hårde sessioner, en lang tur og løbslære, skiftende fra dato til dato. */
export function rotatingProgram(primaryType, secondaryType, dateIndex, { intensity = null } = {}) {
  const sessions = [...(V3_RIDER_TYPE_HARD_PAIRS[primaryType] ?? []), "endurance", "loebslaere"];
  const focus = sessions[dateIndex % sessions.length];
  return applyTrainingCatalog({ focus, intensity: intensity ?? "normal" }, { v3: true });
}

/**
 * Evnernes andel af dagens XP for ét program: session gange type. Samme fordeling som
 * abilityMult, undtagen at off-fokus kommer fra XP-params og følger intensiteten.
 */
export function xpProgramShares(program, { primaryType, secondaryType, xp, raceDay = false }) {
  const out = {};
  if (program.intensity === "rest") return out;
  const grow = TRAINING_CONFIG.focusGrowthMult;
  const intensityShare = (grow[program.intensity] ?? 1) / grow.hard;
  const focusAbilities = program.focusAbilities ?? TRAINING_FOCUSES[program.focus] ?? [];
  const noOffFocus = program.intensity === RECOVERY_INTENSITY || program.offFocus === false;
  const offFocusShare = noOffFocus ? 0 : (raceDay ? xp.raceOffFocusShare : xp.offFocusShare);
  const skillDay = dayTypeForProgram(program) === "skill";
  for (const ability of VISIBLE_ABILITIES) {
    const inFocus = focusAbilities.includes(ability);
    const session = xpSessionShare({ inFocus, intensityShare, weight: programAbilityWeight(program, ability), offFocusShare });
    if (!(session > 0)) continue;
    out[ability] = session * xpTypeShare(abilityRoleClass(primaryType, secondaryType, ability), xp, { skillDay });
  }
  return out;
}

/** Rytterens XP pr. dato på fysiske og mentale evner. Står fast gennem sæsonen. */
export function riderXpRates({ potentiale, age }, xp) {
  return { physical: xpPerDate({ potentiale, age }, xp), mental: xpPerDate({ potentiale, age, mental: true }, xp) };
}

/**
 * Ét XP-tick. Muterer ikke input. `abilityMults` er led pr. evne (træner, rolletillæg).
 * `usedGains` er datoens købte point: maks `cap` pr. evne, resten bliver på bjælken.
 */
export function applyTickXp({
  abilities, progress, shares, rates, xp, dayMult = 1, abilityMults = null, ticksPerDate = 1, usedGains = {}, cap = 1,
}) {
  const nextAbilities = { ...abilities };
  const nextProgress = { ...(progress ?? {}) };
  const gains = {};
  let earned = 0;
  for (const ability of VISIBLE_ABILITIES) {
    const level = Number(nextAbilities[ability] ?? 0);
    if (!Number.isFinite(level)) continue;
    const gained = abilityXpForTick({
      riderXp: MENTAL_ABILITIES.has(ability) ? rates.mental : rates.physical, sessionShare: shares[ability] ?? 0, typeShare: 1,
      dayMult: dayMult * (abilityMults?.[ability] ?? 1), ticksPerDate,
    });
    const bar = Number(nextProgress[ability] ?? 0);
    if (!(gained > 0) && !(bar >= 1)) continue;
    earned += gained;
    const out = buyPoints({ level, bar, xp: gained, maxPoints: cap - (usedGains[ability] ?? 0) }, xp);
    nextProgress[ability] = out.bar;
    if (out.points > 0) { gains[ability] = out.points; nextAbilities[ability] = out.level; }
  }
  return { abilities: nextAbilities, progress: nextProgress, gains, earned };
}

/** Dagsvariationen: seedet pr. (rytter, sæson, dato), neutral over tid. */
export function xpDayVariation(riderId, seasonNumber, dateIndex, span) {
  return 1 - span + 2 * span * seededUnitMixed(`xpvar:${riderId}:${seasonNumber}:${dateIndex}`);
}

// ── Motorens pakke (#6110 §4.2, §4.9, §5.2; #7757) ──────────────────────────────
// Dagsvariationen med hukommelse og løbsdags-gulvet med træner bygges i motoren
// (backend/lib/developmentXp.ts) af sporet "motor-rest" under #6110. Indtil det er
// merget, er de her lokale gengivelser bag ÉT hook. Den opfølgende commit skifter
// hookets funktioner til import fra developmentXp.ts og retter `source`; sæsonløkken
// røres ikke. `source` står på kortet og i kørslens identitet, så en lokal gengivelse
// aldrig læses som motorens egen, og to kilder aldrig havner på samme kort.

/** Startilstanden for en rytters variation med hukommelse: neutral og seedet. */
export function xpVariationStart(riderId) {
  return 2 * seededUnitMixed(`xpvar:${riderId}:s`) - 1;
}

/**
 * Ét skridt i dagsvariationen. Uden hukommelse er udfaldet præcis `xpDayVariation`, så
 * kørsler uden hukommelse er uændrede. Med hukommelse trækker gode og dårlige perioder
 * ud over flere datoer; spredningen pr. dato er den samme, og over tid er den neutral.
 */
export function localDayVariationStep({ riderId, seasonNumber, dateIndex, span, memory = 0, state = null }) {
  const u = seededUnitMixed(`xpvar:${riderId}:${seasonNumber}:${dateIndex}`);
  // Samme regning som xpDayVariation, så en kørsel uden hukommelse er bit for bit den gamle.
  if (!(memory > 0)) return { state: 2 * u - 1, mult: 1 - span + 2 * span * u };
  const prev = Number.isFinite(state) ? state : xpVariationStart(riderId);
  const next = memory * prev + Math.sqrt(1 - memory ** 2) * (2 * u - 1);
  return { state: next, mult: 1 + span * Math.max(-1, Math.min(1, next)) };
}

/**
 * Løbsdags-gulvet (ejer 7/11, G1/X8): en løbsdag giver i hver evne mindst det, en hård
 * træningsdag med rytterens træner og facilitet giver, og mere i det, etapen kræver.
 * Returnerer evnens samlede andel (session gange type gange led), klar til tick'et.
 */
export function localRaceDayFloorShares({ raceShares, raceMults = null, hardShares, staffMults = null }) {
  const out = {};
  for (const ability of new Set([...Object.keys(raceShares ?? {}), ...Object.keys(hardShares ?? {})])) {
    const race = (raceShares?.[ability] ?? 0) * (raceMults?.[ability] ?? 1);
    const hard = (hardShares?.[ability] ?? 0) * (staffMults?.[ability] ?? 1);
    const share = Math.max(race, hard);
    if (share > 0) out[ability] = share;
  }
  return out;
}

export const XP_ENGINE_HOOKS = Object.freeze({
  source: "lokal gengivelse (afventer #6110 motor-rest)",
  dayVariationStep: localDayVariationStep,
  raceDayFloorShares: localRaceDayFloorShares,
});

function engineHooks(opts) {
  return opts?.engineHooks ?? XP_ENGINE_HOOKS;
}

/** Hvert andet managerhold (seedet) trykker Træn nu. Aldrig AI-hold. */
export function isTrainNowTeam(team) {
  return !!team && !team.isAi && seededUnitMixed(`s25press:${team.id}`) < 0.5;
}

/** Seedet rolle på løbsdagen efter en privat fordeling. Uden fordeling: fri rolle. */
export function raceRoleFor(riderId, seasonNumber, gameDay, roles) {
  if (!roles?.length) return "free_role";
  let u = seededUnitMixed(`s25role:${riderId}:${seasonNumber}:${gameDay}`);
  for (const { role, share } of roles) {
    u -= share;
    if (u < 0) return role;
  }
  return roles.at(-1).role;
}

/** Seedet: kører rytteren på denne løbsdag, og hvilken profil? */
export function raceSlot(riderId, seasonNumber, gameDay, share) {
  if (!(share > 0)) return null;
  if (seededUnitMixed(`s25race:${riderId}:${seasonNumber}:${gameDay}`) >= share) return null;
  const i = Math.floor(seededUnitMixed(`s25prof:${riderId}:${seasonNumber}:${gameDay}`) * RACE_PROFILES.length);
  return RACE_PROFILES[Math.min(i, RACE_PROFILES.length - 1)];
}

export function birthdateForAge(age, seasonNumber) {
  const year = LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) - age;
  return `${year}-06-15`;
}

// ── Verden ───────────────────────────────────────────────────────────────────────

/** Bygger den muterbare verden fra et øjebliksbillede (rene data). */
export function buildWorld(snapshot) {
  const teams = new Map();
  for (const t of snapshot.teams) {
    const active = !t.is_bank && !t.is_test_account;
    teams.set(t.id, { id: t.id, division: t.division ?? null, active, isAi: !!t.is_ai,
      facilityTier: snapshot.staffByTeam?.[t.id]?.facilityTier ?? 0, staff: snapshot.staffByTeam?.[t.id]?.staff ?? null });
  }
  const abilityByRider = new Map(snapshot.abilities.map((a) => [a.rider_id, a]));
  // Belastningen er hentet for hele sæsonen: en rytter der mangler i den, kørte 0
  // løbsdage (computeSeasonLoad laver kun rækker for ryttere med resultater).
  // Mangler belastningen helt (ukendt dækning), udfyldes med medianen senere.
  const loadKnown = snapshot.load != null && typeof snapshot.load === "object";
  const load = snapshot.load ?? {};
  // seasons.race_days_* tæller kalenderdatoer; hver dato bærer raceDaysPerDate løbsdage.
  const done = (Number(snapshot.season?.race_days_completed) || 0) * TRAINING_RACE_DAY_CONFIG.raceDaysPerDate;
  const scale = done > 0 ? 1 / done : 0;
  const shareFor = (measured) => {
    if (!loadKnown || !(scale > 0)) return null;
    return Math.min(1, (Number(measured?.raceDays) || 0) * scale);
  };
  const riders = [];
  for (const r of snapshot.riders) {
    const ab = abilityByRider.get(r.id);
    if (!ab || !r.primary_type || r.potentiale == null) continue;
    const abilities = {};
    for (const k of VISIBLE_ABILITIES) if (ab[k] != null) abilities[k] = Number(ab[k]);
    const team = r.team_id != null ? teams.get(r.team_id) : null;
    const measured = load[r.id];
    riders.push({
      id: r.id, birthdate: r.birthdate, potentiale: Number(r.potentiale),
      primary_type: r.primary_type, secondary_type: r.secondary_type ?? null,
      teamId: team?.active ? team.id : null,
      division: team?.active ? team.division : null,
      abilities, progress: { ...(ab.ability_progress ?? {}) },
      // andel af løbsdagene: målt (kørte dage / kørte løbsdage i sæsonen; 0 hvis han
      // ikke kørte), eller null ved ukendt dækning (udfyldes med medianen senere)
      raceShare: shareFor(measured),
      frozenRow: { retirement_notice_season: r.retirement_notice_season ?? null,
        retirement_notice_after_season: r.retirement_notice_after_season ?? null },
      inflow: false, retired: false, trajectory: [], seasonRaceDays: 0,
    });
  }
  return { teams, riders, startSeason: Number(snapshot.season.number) };
}

/** Målt løbsandel efter alder (privat tabel: [{ maxAge, share }], stigende). */
export function raceShareForAge(age, table) {
  for (const row of table) if (age <= row.maxAge) return row.share;
  return table.at(-1).share;
}

function fillMissingRaceShares(riders, seasonNumber, table = null) {
  if (table) {
    for (const r of riders) {
      if (r.raceShare == null) r.raceShare = r.teamId == null ? 0 : raceShareForAge(ageForSeason(r.birthdate, seasonNumber), table);
    }
    return { youngMedian: raceShareForAge(18, table), oldMedian: raceShareForAge(28, table) };
  }
  const young = [];
  const old = [];
  for (const r of riders) {
    if (r.teamId == null || r.raceShare == null) continue;
    const age = ageForSeason(r.birthdate, seasonNumber);
    (age <= 21 ? young : old).push(r.raceShare);
  }
  const my = median(young) ?? 0;
  const mo = median(old) ?? 0;
  for (const r of riders) {
    if (r.raceShare != null) continue;
    r.raceShare = r.teamId == null ? 0 : (ageForSeason(r.birthdate, seasonNumber) <= 21 ? my : mo);
  }
  return { youngMedian: my, oldMedian: mo };
}

// ── Én sæson ─────────────────────────────────────────────────────────────────────

/** Spand for en evnes stigning på én dato: 1, 2 eller 3+ (ejervalg 12/11 på #6110). */
export function dateGainBucket(n) {
  return n >= 3 ? "3+" : String(n);
}

export function emptyDateGains() {
  return { all: {}, firstWeek: {}, raceDate: {}, trainingDate: {}, byAge: {}, byPotential: {}, max: 0 };
}

export function cohortAgeBand(age) {
  return age <= 18 ? "16-18" : age <= 22 ? "19-22" : age <= 28 ? "23-28" : "29+";
}

/** Hvor tit stiger en evne 1, 2 eller 3+ på samme dato, fordelt på dato-type, alder og potentiale. */
function addDateGain(h, n, { firstWeek, raced, age, potentiale }) {
  if (!(n > 0)) return;
  const b = dateGainBucket(n);
  const bump = (bucket) => { bucket[b] = (bucket[b] ?? 0) + 1; };
  bump(h.all);
  if (firstWeek) bump(h.firstWeek);
  bump(raced ? h.raceDate : h.trainingDate);
  if (Number.isFinite(age)) bump(h.byAge[cohortAgeBand(age)] ??= {});
  if (Number.isFinite(potentiale)) bump(h.byPotential[Math.floor(potentiale)] ??= {});
  if (n > h.max) h.max = n;
}

/** Tæller datoens køb: pr. evne, pr. sæson, første sæsons uger, og brud på +1-loftet. */
function trackDate(world, r, dateIndex, used, firstSeason, cap, { age = null, raced = false } = {}) {
  let total = 0;
  let mental = 0;
  for (const [ability, n] of Object.entries(used)) {
    total += n;
    if (MENTAL_ABILITIES.has(ability)) mental += n;
    world.abilityPoints[ability] = (world.abilityPoints[ability] ?? 0) + n;
    if (n > cap) world.capViolations += 1;
    if (world.dateGains) addDateGain(world.dateGains, n, { firstWeek: firstSeason && dateIndex < 7, raced, age, potentiale: r.potentiale });
  }
  r.seasonPointsBought = (r.seasonPointsBought ?? 0) + total;
  r.seasonMentalPoints = (r.seasonMentalPoints ?? 0) + mental;
  world.seasonPoints += total;
  if (firstSeason) {
    r.firstSeasonPoints = (r.firstSeasonPoints ?? 0) + total;
    world.firstSeasonByDate[dateIndex] = (world.firstSeasonByDate[dateIndex] ?? 0) + total;
    const week = Math.floor(dateIndex / 7);
    if (week < 2) (r.firstWeeks ??= [0, 0])[week] += total;
  }
}

/** Løbsandelen i sæsonen: efter alder, når billedet ikke har en målt andel. */
function seasonRaceShare(r, age, opts) {
  return opts.raceShareByAge ? raceShareForAge(age, opts.raceShareByAge) : r.raceShare;
}

/** Løbsdagens program og rolletillæg, regnet i XP-modellens forhold mellem fokus og resten. */
function xpRaceDay(profile, role, { xp, raceRoleYield }) {
  const trainingCfg = { ...TRAINING_CONFIG, offFocusMult: xp.raceOffFocusShare * TRAINING_CONFIG.focusGrowthMult.hard };
  const program = raceDayRoleBaseProgram(profile, { role, roleDrivesBaseDay: raceRoleYield?.roleDrivesBaseDay === true, trainingCfg });
  return { program, mults: raceRoleYield ? raceDayRoleYieldMultipliers({ params: raceRoleYield, profileType: profile, role, program, trainingCfg }) : null };
}

function xpRaceDayFor(profile, role, ctx, cache) {
  const key = `${profile}|${role}`;
  let hit = cache.get(key);
  if (!hit) {
    const { program, mults } = xpRaceDay(profile, role, ctx);
    hit = {
      shares: xpProgramShares(program, { ...ctx, raceDay: true }),
      mults,
    };
    cache.set(key, hit);
  }
  return hit;
}

/** Trænerens og facilitetens led pr. evne. Kun på træningsdage (S13). */
function xpStaffMults(team, riderLevel, cache) {
  const key = `${team.id}|${riderLevel}`;
  let hit = cache.get(key);
  if (!hit) {
    const facility = facilityTrainingMultiplier({ facilityTier: team.facilityTier, staff: team.staff });
    hit = Object.fromEntries(VISIBLE_ABILITIES.map((ability) => [ability,
      facility * staffTrainingBonus({ facilityTier: team.facilityTier, staff: team.staff, ability, riderLevel })]));
    cache.set(key, hit);
  }
  return hit;
}

function simulateSeasonXp(world, seasonNumber, variant, opts) {
  const xp = variant.xpParams;
  const dates = Math.ceil(opts.raceDaysPerSeason / opts.raceDaysPerDate);
  const firstSeason = seasonNumber === world.startSeason + 1;
  const staffCache = new Map();
  const shareCache = new Map();
  const raceCaches = new Map();
  const hooks = engineHooks(opts);
  // Intet dagsloft (#7739): kun prisen bremser. Med loft: maks +1 pr. evne pr. dato.
  const cap = variant.capPerDate === false ? Infinity : opts.abilityCapPerDate;
  const span = variant.variationSpan ?? opts.xpVariationSpan;
  const memory = variant.variationMemory ?? opts.xpVariationMemory ?? 0;
  const sharesFor = (program, ctx, typeKey) => {
    const key = `${typeKey}|${program.focus}|${program.intensity}`;
    let hit = shareCache.get(key);
    if (!hit) { hit = xpProgramShares(program, ctx); shareCache.set(key, hit); }
    return hit;
  };
  const programFor = (r, d, intensity) => (variant.plan === "rotate"
    ? rotatingProgram(r.primary_type, r.secondary_type, d, { intensity })
    : assistantProgram(r.primary_type, r.secondary_type, { intensity }));
  for (const r of world.riders) {
    if (r.retired) continue;
    r.seasonRaceDays = 0;
    r.seasonHardDays = 0;
    if (r.teamId == null) continue;
    const team = world.teams.get(r.teamId);
    const age = ageForSeason(r.birthdate, seasonNumber);
    const rates = riderXpRates({ potentiale: r.potentiale, age }, xp);
    const staffMults = xpStaffMults(team, riderLevelBand({ age }), staffCache);
    const raceShare = seasonRaceShare(r, age, opts);
    const bonus = variant.trainNowBonus > 0 && isTrainNowTeam(team) ? 1 + variant.trainNowBonus : 1;
    const typeKey = `${r.primary_type}|${r.secondary_type}`;
    const ctx = { primaryType: r.primary_type, secondaryType: r.secondary_type, xp, raceRoleYield: opts.raceRoleYield };
    if (!raceCaches.has(typeKey)) raceCaches.set(typeKey, new Map());
    let gameDay = 0;
    for (let d = 0; d < dates; d++) {
      const usedToday = {};
      let raced = false;
      // Hukommelsen bæres fra dato til dato og over sæsonskiftet (perioder kender ikke kalenderen).
      const step = hooks.dayVariationStep({ riderId: r.id, seasonNumber, dateIndex: d, span, memory, state: r.xpVarState });
      r.xpVarState = step.state;
      const variation = step.mult;
      const program = programFor(r, d, variant.intensity);
      const trainShares = sharesFor(program, ctx, typeKey);
      for (let slot = 0; slot < opts.raceDaysPerDate; slot++) {
        gameDay += 1;
        if (gameDay > opts.raceDaysPerSeason) break;
        const profile = raceSlot(r.id, seasonNumber, gameDay, raceShare);
        let tick;
        if (profile) {
          r.seasonRaceDays += 1;
          raced = true;
          const role = raceRoleFor(r.id, seasonNumber, gameDay, opts.raceRoles);
          const race = xpRaceDayFor(profile, role, ctx, raceCaches.get(typeKey));
          tick = variant.raceDayFloor
            ? { shares: hooks.raceDayFloorShares({ raceShares: race.shares, raceMults: race.mults,
              hardShares: sharesFor(programFor(r, d, "hard"), ctx, typeKey), staffMults }), abilityMults: null, dayMult: variation }
            : { shares: race.shares, abilityMults: race.mults, dayMult: variation };
        } else {
          if (program.intensity === "hard") r.seasonHardDays += 1;
          tick = { shares: trainShares, abilityMults: staffMults, dayMult: variation * bonus };
        }
        const res = applyTickXp({
          abilities: r.abilities, progress: r.progress, rates, xp, ...tick,
          ticksPerDate: opts.raceDaysPerDate, usedGains: usedToday, cap,
        });
        for (const [k, n] of Object.entries(res.gains)) usedToday[k] = (usedToday[k] ?? 0) + n;
        r.seasonXp = (r.seasonXp ?? 0) + res.earned;
        r.abilities = res.abilities;
        r.progress = res.progress;
      }
      trackDate(world, r, d, usedToday, firstSeason, cap, { age, raced });
    }
  }
}

function simulateSeason(world, seasonNumber, variant, opts) {
  if (variant.kind === "xp") { simulateSeasonXp(world, seasonNumber, variant, opts); return; }
  const dates = Math.ceil(opts.raceDaysPerSeason / opts.raceDaysPerDate);
  const divisor = raceDayBudgetDivisor();
  const seasonKey = `s25-${seasonNumber}`;
  const firstSeason = seasonNumber === world.startSeason + 1;
  for (const r of world.riders) {
    if (r.retired) continue;
    r.seasonRaceDays = 0;
    if (r.teamId == null) continue; // ingen træner: ingen daglig udvikling
    const team = world.teams.get(r.teamId);
    const age = ageForSeason(r.birthdate, seasonNumber);
    const riderLevel = riderLevelBand({ age });
    const program = assistantProgram(r.primary_type, r.secondary_type);
    const raceShare = seasonRaceShare(r, age, opts);
    let gameDay = 0;
    let caps = buildCapsForRider(r.abilities, { potentiale: r.potentiale, age }, r.primary_type, r.secondary_type);
    for (let d = 0; d < dates; d++) {
      const usedToday = {};
      let anyGain = false;
      let raced = false;
      for (let slot = 0; slot < opts.raceDaysPerDate; slot++) {
        gameDay += 1;
        if (gameDay > opts.raceDaysPerSeason) break;
        const profile = raceSlot(r.id, seasonNumber, gameDay, raceShare);
        if (profile) { r.seasonRaceDays += 1; raced = true; }
        // Kurve B får løbsdagens rolletillæg som i dag, når de private params er med.
        const raceArgs = profile && variant.kind === "curveB" && opts.raceRoleYield
          ? withRaceDayRoleYield({}, { params: opts.raceRoleYield, profileType: profile, role: raceRoleFor(r.id, seasonNumber, gameDay, opts.raceRoles) })
          : null;
        const tickProgram = raceArgs?.program ?? (profile ? raceDayProgram(profile) : program);
        const seedKey = `${seasonKey}#gd${gameDay}`;
        let res;
        if (variant.kind === "B") {
          res = applyTickB({
            riderId: r.id, seedKey, abilities: r.abilities, caps, progress: r.progress, program: tickProgram,
            potentiale: r.potentiale, staff: team.staff, facilityTier: team.facilityTier, riderLevel,
            primaryType: r.primary_type, secondaryType: r.secondary_type, budgetDivisor: divisor,
            hardDailyCap: opts.abilityCapPerRaceDay, scale: variant.scale * world.bNorm,
            noiseSpan: opts.bNoiseSpan, referenceAge: opts.bReferenceAge,
          });
        } else {
          res = applyDailyTick({
            riderId: r.id, dateStr: null, tickSeedKey: seedKey, age, abilities: r.abilities, caps,
            progress: r.progress, program: tickProgram, conditionMult: 1, potentiale: r.potentiale,
            hardDailyCap: opts.abilityCapPerRaceDay, staff: team.staff, facilityTier: team.facilityTier,
            riderLevel, primaryType: r.primary_type, secondaryType: r.secondary_type, budgetDivisor: divisor,
            curveB: variant.kind === "curveB" ? opts.curveB : null, // #3564: den rigtige kurve B
            abilityYieldMult: raceArgs?.abilityYieldMult ?? null,
          });
        }
        if (variant.capPerDate) {
          const uncapped = res;
          res = capGainsPerDate({ tickResult: res, abilities: r.abilities, usedGains: usedToday, cap: opts.abilityCapPerDate });
          if (res !== uncapped) {
            for (const [k, n] of Object.entries(uncapped.gains)) world.dateCap.clipped += n - (res.gains[k] ?? 0);
          }
        }
        for (const [k, n] of Object.entries(res.gains ?? {})) {
          if (n > 0) { usedToday[k] = (usedToday[k] ?? 0) + n; anyGain = true; }
        }
        r.abilities = res.abilities;
        r.progress = res.progress;
      }
      // Hvor tit ville datoen give mere end +1 i en evne (uden dato-loftet)?
      for (const n of Object.values(usedToday)) if (n > opts.abilityCapPerDate) world.dateCap.over += n - opts.abilityCapPerDate;
      trackDate(world, r, d, usedToday, firstSeason, variant.capPerDate ? opts.abilityCapPerDate : Infinity, { age, raced });
      if (anyGain) {
        caps = buildCapsForRider(r.abilities, { potentiale: r.potentiale, age }, r.primary_type, r.secondary_type);
      }
    }
  }
}

// ── Sæsonskiftet: aldring (#6499), pension, nye unge ────────────────────────────

function transition(world, endingSeason, opts, { firstTransition = false, loadOverride = null, inflow = true } = {}) {
  const newSeason = endingSeason + 1;
  const retiredByTeam = new Map();
  const out = { season: newSeason, retired: 0, retireAges: [], ratingDrops: 0, inflow: 0, agingPoints: 0 };
  for (const r of world.riders) {
    if (r.retired) continue;
    const age = ageForSeason(r.birthdate, newSeason);
    const raceDays = loadOverride ? (loadOverride.get(r.id) ?? 0) : r.seasonRaceDays;
    const frozen = firstTransition ? frozenNoticeFor(r.frozenRow, endingSeason) : null;
    const before = bestRating(r.abilities);
    const dev = developRiderSeasonV2(
      { id: r.id, primary_type: r.primary_type, potentiale: r.potentiale, age, frozenRetirementNotice: frozen },
      r.abilities, newSeason, { load: { raceDays, hardDays: r.seasonHardDays ?? 0 } },
    );
    r.abilities = { ...r.abilities, ...dev.next };
    out.agingPoints += dev.aging.totalDrop;
    const after = bestRating(r.abilities);
    if (before != null && after != null && after < before) out.ratingDrops += 1;
    if (dev.retirement.retire) {
      r.retired = true;
      r.retiredAge = age - 1;
      out.retired += 1;
      out.retireAges.push(age - 1);
      if (r.teamId != null) retiredByTeam.set(r.teamId, (retiredByTeam.get(r.teamId) ?? 0) + 1);
    }
  }
  // Nye unge: hvert hold erstatter sine pensionister (produktionens generator).
  // Kohorten (#7757) følger kun sine egne ryttere, så den får ingen erstatninger.
  for (const [teamId, n] of inflow ? retiredByTeam : []) {
    const team = world.teams.get(teamId);
    const rng = makeRng(Math.floor(seededUnitMixed(`s25inflow:${teamId}:${newSeason}`) * 2 ** 31));
    const kuld = generateAcademyCandidates({
      rng, referenceYear: LAUNCH_REFERENCE_YEAR + newSeason - 1, existingNames: new Set(),
      countOverride: n, ageBand: opts.inflowAgeBand,
    });
    kuld.forEach((c, i) => {
      const age = c.archetypeDraw?.birth?.age ?? opts.inflowAgeBand.min;
      const abilities = {};
      for (const k of VISIBLE_ABILITIES) if (c.birthAbilities?.[k] != null) abilities[k] = Number(c.birthAbilities[k]);
      world.riders.push({
        id: `s25-${teamId}-${newSeason}-${i}`, birthdate: birthdateForAge(age, newSeason),
        potentiale: Number(c.rider.potentiale), primary_type: c.archetypeDraw.primary,
        secondary_type: c.archetypeDraw.secondary ?? null, teamId, division: team?.division ?? null,
        abilities, progress: {}, raceShare: world.youngRaceShare ?? 0, frozenRow: {},
        inflow: true, inflowSeason: newSeason, retired: false, trajectory: [], seasonRaceDays: 0,
      });
      out.inflow += 1;
    });
  }
  return out;
}

// ── Målinger ─────────────────────────────────────────────────────────────────────

function seasonStats(world, seasonNumber, label) {
  const active = world.riders.filter((r) => !r.retired);
  const onTeam = active.filter((r) => r.teamId != null);
  const rated = onTeam.map((r) => ({ r, rating: bestRating(r.abilities), age: ageForSeason(r.birthdate, seasonNumber) }))
    .filter((x) => x.rating != null);
  const ratings = rated.map((x) => x.rating).sort((a, b) => a - b);
  const mean = ratings.reduce((s, x) => s + x, 0) / (ratings.length || 1);
  const sd = Math.sqrt(ratings.reduce((s, x) => s + (x - mean) ** 2, 0) / (ratings.length || 1));
  const top50 = [...rated].sort((a, b) => b.rating - a.rating).slice(0, 50);
  const top100 = [...rated].sort((a, b) => b.rating - a.rating).slice(0, 100);
  // Store mod små hold: holdets top-8 snit pr. division.
  const byTeam = new Map();
  for (const x of rated) {
    if (!byTeam.has(x.r.teamId)) byTeam.set(x.r.teamId, []);
    byTeam.get(x.r.teamId).push(x.rating);
  }
  const divTop8 = {};
  for (const [teamId, list] of byTeam) {
    const div = world.teams.get(teamId)?.division ?? "?";
    const top8 = list.sort((a, b) => b - a).slice(0, 8);
    const avg = top8.reduce((s, x) => s + x, 0) / top8.length;
    (divTop8[div] ??= []).push(avg);
  }
  const top100ByDiv = {};
  for (const x of top100) {
    const div = world.teams.get(x.r.teamId)?.division ?? "?";
    top100ByDiv[div] = (top100ByDiv[div] ?? 0) + 1;
  }
  const potBand = (p) => (p >= 5 ? "pot5+" : p >= 3.5 ? "pot3.5-4.5" : "pot<3.5");
  const byPot = {};
  for (const x of rated) (byPot[potBand(x.r.potentiale)] ??= []).push(x.rating);
  return {
    label, season: seasonNumber, activeRiders: active.length, onTeam: onTeam.length,
    rating: {
      n: ratings.length, mean: round(mean), sd: round(sd),
      p10: round(quantile(ratings, 0.1)), p50: round(quantile(ratings, 0.5)), p90: round(quantile(ratings, 0.9)),
      p99: round(quantile(ratings, 0.99)), max: ratings.at(-1) ?? null,
      ge70: ratings.filter((x) => x >= 70).length, ge80: ratings.filter((x) => x >= 80).length,
      ge85: ratings.filter((x) => x >= 85).length, ge90: ratings.filter((x) => x >= 90).length,
    },
    top50: {
      medianAge: median(top50.map((x) => x.age)), le23: top50.filter((x) => x.age <= 23).length,
      ge31: top50.filter((x) => x.age >= 31).length, cutoff: top50.at(-1)?.rating ?? null,
    },
    divisionTop8: Object.fromEntries(Object.entries(divTop8).sort().map(([d, l]) => [d, { teams: l.length, mean: round(l.reduce((s, x) => s + x, 0) / l.length) }])),
    top100ByDivision: top100ByDiv,
    meanByPotential: Object.fromEntries(Object.entries(byPot).sort().map(([k, l]) => [k, { n: l.length, mean: round(l.reduce((s, x) => s + x, 0) / l.length), p90: round(quantile(l.sort((a, b) => a - b), 0.9)) }])),
  };
}

/** Sæsonslut-rating pr. alder for hver rytter (efter dagenes udvikling, før aldringen). */
function recordTrajectories(world, seasonNumber) {
  for (const r of world.riders) {
    if (r.retired || r.teamId == null) continue;
    const rating = bestRating(r.abilities);
    if (rating != null) r.trajectory.push({ season: seasonNumber, age: ageForSeason(r.birthdate, seasonNumber), rating });
  }
}

/**
 * D1-milepælene (D-058): andel af karrierens observerede top ved 22 og 25, og
 * topalderen. Kun ryttere hvis bane dækker 22 til mindst 27 (ellers kan toppen
 * ligge uden for vinduet).
 */
export function milestoneStats(riders) {
  const band = (p) => (p >= 5 ? "pot5+" : p >= 3.5 ? "pot3.5-4.5" : "pot<3.5");
  const groups = {};
  for (const r of riders) {
    const t = r.trajectory;
    if (!t?.length) continue;
    const at = (age) => t.find((x) => x.age === age)?.rating ?? null;
    const minAge = Math.min(...t.map((x) => x.age));
    const maxAge = Math.max(...t.map((x) => x.age));
    if (minAge > 22 || maxAge < 27) continue;
    const peak = t.reduce((b, x) => (x.rating > b.rating || (x.rating === b.rating && x.age < b.age) ? x : b));
    if (!(peak.rating > 0)) continue;
    const r22 = at(22);
    const r25 = at(25);
    for (const key of ["alle", band(r.potentiale)]) {
      const g = (groups[key] ??= { n: 0, pct22: [], pct25: [], peakAge: [], peak: [] });
      g.n += 1;
      if (r22 != null) g.pct22.push((100 * r22) / peak.rating);
      if (r25 != null) g.pct25.push((100 * r25) / peak.rating);
      g.peakAge.push(peak.age);
      g.peak.push(peak.rating);
    }
  }
  const out = {};
  for (const [k, g] of Object.entries(groups)) {
    out[k] = {
      n: g.n, pct22: round(median(g.pct22)), pct25: round(median(g.pct25)),
      peakAgeMedian: median(g.peakAge),
      peakAt27to28: round((100 * g.peakAge.filter((a) => a >= 27 && a <= 28).length) / g.n),
      peakAtOrBefore24: round((100 * g.peakAge.filter((a) => a <= 24).length) / g.n),
      peakMedian: round(median(g.peak)),
    };
  }
  return out;
}

/** Stort talent: rating efter 9 sæsoner for pot ≥ 5.5 der startede ≤ 19 (Discord-pejlemærke 2/10). */
export function bigTalentAfterNine(riders, startSeason) {
  const list = [];
  for (const r of riders) {
    if (r.inflow || r.potentiale < 5.5) continue;
    const t0 = r.trajectory.find((x) => x.season === startSeason + 1);
    const t9 = r.trajectory.find((x) => x.season === startSeason + 9);
    // Codex P2 (#7154): "startede ≤ 19" måles på alderen i startbilledet (første
    // registrerede punkt er efter det første skifte, altså et år ældre).
    const startEntry = r.trajectory.find((x) => x.season === startSeason);
    const startAge = startEntry ? startEntry.age : (t0 ? t0.age - 1 : null);
    if (!t0 || !t9 || startAge == null || startAge > 19) continue;
    list.push(t9.rating);
  }
  const s = list.sort((a, b) => a - b);
  return { n: s.length, median: round(quantile(s, 0.5)), p90: round(quantile(s, 0.9)), max: s.at(-1) ?? null, ge90: s.filter((x) => x >= 90).length };
}

// ── Kørsel af én variant ─────────────────────────────────────────────────────────

export function runVariant(snapshot, variant, opts = SIM_DEFAULTS) {
  const world = buildWorld(snapshot);
  const s0 = world.startSeason;
  const shares = fillMissingRaceShares(world.riders, s0, opts.raceShareByAge ?? null);
  world.youngRaceShare = shares.youngMedian;
  world.bNorm = requireBNormalizer(opts)(world.riders.filter((r) => r.teamId != null).map((r) => ageForSeason(r.birthdate, s0)), opts.bReferenceAge);
  world.dateCap = { over: 0, clipped: 0 };
  world.abilityPoints = {};
  world.firstSeasonByDate = [];
  world.capViolations = 0;
  world.seasonPoints = 0;
  world.dateGains = emptyDateGains();
  const seasonPoints = [];
  let inSeasonRatingDrops = 0;
  for (const r of world.riders) {
    r.start = { age: ageForSeason(r.birthdate, s0), rating: bestRating(r.abilities), abilities: { ...r.abilities } };
    r.startBarsOverOne = Object.values(r.progress ?? {}).filter((x) => Number(x) >= 1).length;
  }
  const result = { variant: variant.name, start: seasonStats(world, s0, "start"), seasons: [], transitions: [] };
  // Første skifte: den aktive sæsons målte løbsdage (fremskrevet til hel sæson).
  const measuredSeasonRaceDays = (Number(snapshot.season.race_days_total) || 0) * opts.raceDaysPerDate || opts.raceDaysPerSeason;
  const firstLoad = new Map(world.riders.map((r) => [r.id, Math.round((r.raceShare ?? 0) * measuredSeasonRaceDays)]));
  result.transitions.push(transition(world, s0, opts, { firstTransition: true, loadOverride: firstLoad }));
  for (let i = 1; i <= opts.seasons; i++) {
    const season = s0 + i;
    const ratingBefore = new Map(world.riders.filter((r) => !r.retired && r.teamId != null).map((r) => [r.id, bestRating(r.abilities)]));
    world.seasonPoints = 0;
    simulateSeason(world, season, variant, opts);
    seasonPoints.push(world.seasonPoints);
    for (const r of world.riders) {
      const before = ratingBefore.get(r.id);
      if (before != null && bestRating(r.abilities) < before) inSeasonRatingDrops += 1;
    }
    recordTrajectories(world, season);
    result.seasons.push(seasonStats(world, season, `S${season} slut`));
    // De nye unge måles på samme tidspunkt som resten af slut-tallene: før det
    // sidste skifte (ellers ville pensioner, aldring og nye erstatninger tælle med).
    if (i === opts.seasons) {
      result.inflowEnd = seasonStats({ ...world, riders: world.riders.filter((r) => r.inflow) }, season, "nye unge ved slut").rating;
      result.gates = worldGateStats(world, season, { variant, seasonPoints, inSeasonRatingDrops, s0, opts });
    }
    result.transitions.push(transition(world, season, opts));
  }
  result.milestones = milestoneStats(world.riders);
  result.bigTalent = bigTalentAfterNine(world.riders, s0);
  if (result.gates) {
    result.gates.potentialPeak = potentialPeakStats(world.riders);
    result.gates.veterans = veteranStats(world.riders, s0);
  }
  result.bNorm = world.bNorm;
  result.dateCap = world.dateCap;
  result.dateGains = world.dateGains;
  result.params = { raceDaysPerSeason: opts.raceDaysPerSeason, bNoiseSpan: opts.bNoiseSpan, bReferenceAge: opts.bReferenceAge,
    curveB: variant.kind === "curveB" ? opts.curveB ?? null : null, // #3564: kortet blander aldrig to kalibreringer
    curveBRun: variant.kind === "curveB" ? curveBRunInputs(opts) : null,
    xp: variant.kind === "xp" ? variant.xpParams : null, xpRun: variant.kind === "xp" ? xpRunInputs(variant, opts) : null };
  result.fingerprint = runFingerprint(snapshot, opts);
  result.raceShares = { young: round(shares.youngMedian, 3), old: round(shares.oldMedian, 3) };
  return result;
}

// ── Kohorten (#7757, ejer 7/11): kun NYE ryttere, fulgt fra 16 til 40 år ─────────
// Startbilledets ryttere bærer den gamle models historik; en kohorte født i kørslen gør
// ikke. Hold, trænere og faciliteter er billedets, rytterne er produktionens generator.

/** Kohortens ryttere: `perTeam` nye 16-årige på hvert aktivt hold, seedet pr. hold. */
export function cohortRiders(world, seasonNumber, { perTeam = SIM_DEFAULTS.cohortPerTeam, startAge = SIM_DEFAULTS.cohortStartAge } = {}) {
  const riders = [];
  for (const team of world.teams.values()) {
    if (!team.active) continue;
    const rng = makeRng(Math.floor(seededUnitMixed(`cohort:${team.id}`) * 2 ** 31));
    const kuld = generateAcademyCandidates({
      rng, referenceYear: LAUNCH_REFERENCE_YEAR + seasonNumber - 1, existingNames: new Set(),
      countOverride: perTeam, ageBand: { min: startAge, max: startAge },
    });
    kuld.forEach((c, i) => {
      const abilities = {};
      for (const k of VISIBLE_ABILITIES) if (c.birthAbilities?.[k] != null) abilities[k] = Number(c.birthAbilities[k]);
      riders.push({
        id: `coh-${team.id}-${i}`, birthdate: birthdateForAge(startAge, seasonNumber),
        potentiale: Number(c.rider.potentiale), primary_type: c.archetypeDraw.primary,
        secondary_type: c.archetypeDraw.secondary ?? null, teamId: team.id, division: team.division,
        abilities, progress: {}, raceShare: null, frozenRow: {},
        inflow: true, cohort: true, retired: false, trajectory: [], seasonRaceDays: 0,
      });
    });
  }
  return riders;
}

/** Uden en privat løbsandel efter alder bruges billedets målte medianer (ung / ældre). */
function cohortRaceTable(snapshot, opts) {
  if (opts.raceShareByAge) return opts.raceShareByAge;
  const world = buildWorld(snapshot);
  const { youngMedian, oldMedian } = fillMissingRaceShares(world.riders, world.startSeason, null);
  return [{ maxAge: 21, share: youngMedian }, { maxAge: 999, share: oldMedian }];
}

/**
 * Kohorte-kørslen: samme sæsonløkke, samme aldring og pension som verdenen, men kun
 * kohortens ryttere og ingen erstatninger. Rytterne følges til `endAge` eller pension.
 */
export function runCohort(snapshot, variant, opts = SIM_DEFAULTS) {
  const world = buildWorld(snapshot);
  const s0 = world.startSeason;
  const startAge = opts.cohortStartAge ?? SIM_DEFAULTS.cohortStartAge;
  const endAge = opts.cohortEndAge ?? SIM_DEFAULTS.cohortEndAge;
  world.riders = cohortRiders(world, s0 + 1, { perTeam: opts.cohortPerTeam ?? SIM_DEFAULTS.cohortPerTeam, startAge });
  const runOpts = { ...opts, raceShareByAge: cohortRaceTable(snapshot, opts) };
  world.bNorm = variant.kind === "B" ? requireBNormalizer(opts)(world.riders.map(() => startAge), opts.bReferenceAge) : null;
  world.dateCap = { over: 0, clipped: 0 };
  world.abilityPoints = {};
  world.firstSeasonByDate = [];
  world.capViolations = 0;
  world.seasonPoints = 0;
  world.dateGains = emptyDateGains();
  const physical = VISIBLE_ABILITIES.filter((a) => abilityMeta(a)?.category === "physical");
  const mental = [...MENTAL_ABILITIES];
  const meanOf = (r, list) => list.reduce((s, a) => s + Number(r.abilities[a] ?? 0), 0) / (list.length || 1);
  const ages = {};
  const retiredAt = {};
  for (let i = 1; startAge + i - 1 <= endAge; i++) {
    const season = s0 + i;
    const alive = world.riders.filter((r) => !r.retired);
    if (!alive.length) break;
    for (const r of alive) { r.seasonPointsBought = 0; r.seasonMentalPoints = 0; }
    simulateSeason(world, season, variant, runOpts);
    recordTrajectories(world, season);
    const age = startAge + i - 1;
    const rated = alive.map((r) => ({ r, rating: bestRating(r.abilities) })).filter((x) => x.rating != null);
    const ratings = rated.map((x) => x.rating).sort((a, b) => a - b);
    const avg = (list) => (list.length ? round(list.reduce((s, x) => s + x, 0) / list.length, 2) : null);
    ages[age] = {
      n: alive.length,
      rating: { mean: avg(ratings), p50: round(quantile(ratings, 0.5)), p90: round(quantile(ratings, 0.9)), max: ratings.at(-1) ?? null },
      pointsMean: avg(alive.map((r) => r.seasonPointsBought ?? 0)),
      mentalPointsMean: avg(alive.map((r) => r.seasonMentalPoints ?? 0)),
      raceDaysMean: avg(alive.map((r) => r.seasonRaceDays ?? 0)),
      // X7: mentale mod fysiske evner pr. alder; taktik står for sig selv (spec §8).
      mentalMean: avg(alive.map((r) => meanOf(r, mental))),
      physicalMean: avg(alive.map((r) => meanOf(r, physical))),
      tacticsMean: avg(alive.map((r) => Number(r.abilities.tactics ?? 0))),
      mentalBest: alive.filter((r) => Math.max(...mental.map((a) => Number(r.abilities[a] ?? 0))) > Math.max(...physical.map((a) => Number(r.abilities[a] ?? 0)))).length,
    };
    const t = transition(world, season, runOpts, { inflow: false });
    if (t.retired) retiredAt[age] = t.retired;
  }
  const riderPeaks = {};
  for (const r of world.riders) {
    if (r.trajectory.length) riderPeaks[r.id] = Math.max(...r.trajectory.map((x) => x.rating));
  }
  return {
    variant: variant.name, mode: "cohort", cohortSize: world.riders.length, startAge, endAge, startSeason: s0 + 1,
    byAge: ages, retiredAt, milestones: milestoneStats(world.riders), peakByPotential: potentialPeakStats(world.riders),
    riderPeaks, dateGains: world.dateGains, abilityPoints: world.abilityPoints,
    params: { xp: variant.kind === "xp" ? variant.xpParams : null, xpRun: variant.kind === "xp" ? xpRunInputs(variant, opts) : null,
      curveB: variant.kind === "curveB" ? opts.curveB ?? null : null, curveBRun: variant.kind === "curveB" ? curveBRunInputs(opts) : null },
    fingerprint: cohortFingerprint(snapshot, opts),
  };
}

/** Kohortens identitet: billedet, sæsonens længde og kohortens form. */
export function cohortFingerprint(snapshot, opts) {
  return [runFingerprint(snapshot, opts), "kohorte", opts.cohortPerTeam ?? SIM_DEFAULTS.cohortPerTeam,
    opts.cohortStartAge ?? SIM_DEFAULTS.cohortStartAge, opts.cohortEndAge ?? SIM_DEFAULTS.cohortEndAge].join("|");
}

// ── De to faste krav (#7757): grænserne er private, målingen er her ─────────────

/**
 * Validerer de private krav. Inflation: højst en procentdel ekstra købte evnepoint i en
 * given sæson mod kurve B. Top-tab: højst et antal (eller en andel) af kohortens ryttere
 * under deres egen kurve B-karrieretop. Returnerer null uden krav; kaster ved ugyldige.
 */
export function validateRequirements(raw) {
  if (raw == null) return null;
  const inflation = raw.inflation;
  const topLoss = raw.topLoss;
  const pos = (x) => Number.isFinite(x) && x >= 0;
  if (!inflation || !Number.isInteger(inflation.season) || inflation.season < 1 || !pos(inflation.maxExtraPct)) {
    throw new Error("Private krav: inflation kræver en sæson og en største ekstra procent");
  }
  if (!topLoss || (!pos(topLoss.maxBelow) && !pos(topLoss.maxBelowPct))) {
    throw new Error("Private krav: top-tab kræver et største antal eller en største andel");
  }
  return Object.freeze({
    inflation: Object.freeze({ season: inflation.season, maxExtraPct: inflation.maxExtraPct }),
    topLoss: Object.freeze({ maxBelow: pos(topLoss.maxBelow) ? topLoss.maxBelow : null, maxBelowPct: pos(topLoss.maxBelowPct) ? topLoss.maxBelowPct : null }),
  });
}

/** Inflationen: købte evnepoint i kravets sæson mod kurve B i samme verden. */
export function inflationCheck(xpResult, curveBResult, requirements) {
  const season = requirements?.inflation?.season ?? null;
  const pts = (r) => r?.gates?.pointsPerSeason ?? [];
  const perSeason = pts(xpResult).map((p, i) => {
    const b = pts(curveBResult)[i];
    return b > 0 ? round((100 * (p - b)) / b, 2) : null;
  });
  if (season == null) return { season: null, perSeason, verdict: null, reason: "krav mangler (privat)" };
  const xp = pts(xpResult)[season - 1];
  const b = pts(curveBResult)[season - 1];
  if (xp == null || b == null) return { season, perSeason, verdict: null, reason: `kørslen når ikke sæson ${season}` };
  const extraPct = b > 0 ? round((100 * (xp - b)) / b, 2) : null;
  const limit = requirements.inflation.maxExtraPct;
  return { season, xp, curveB: b, extraPct, limit, perSeason, verdict: extraPct != null && extraPct <= limit };
}

/** Top-tabet: kohortens ryttere, hvis XP-karrieretop ligger under deres egen kurve B-top. */
export function topLossCheck(xpCohort, curveBCohort, requirements) {
  const xpPeaks = xpCohort?.riderPeaks ?? {};
  const bPeaks = curveBCohort?.riderPeaks ?? {};
  const losses = [];
  let n = 0;
  for (const [id, bPeak] of Object.entries(bPeaks)) {
    const xpPeak = xpPeaks[id];
    if (xpPeak == null) continue;
    n += 1;
    if (xpPeak < bPeak) losses.push(bPeak - xpPeak);
  }
  const below = losses.length;
  const belowPct = n ? round((100 * below) / n, 2) : null;
  const loss = statsOf(losses);
  const limit = requirements?.topLoss ?? null;
  if (!limit) return { n, below, belowPct, loss, verdict: null, reason: "krav mangler (privat)" };
  const okCount = limit.maxBelow == null || below <= limit.maxBelow;
  const okPct = limit.maxBelowPct == null || (belowPct ?? 0) <= limit.maxBelowPct;
  return { n, below, belowPct, loss, limit, verdict: n > 0 && okCount && okPct };
}

export function variantList(opts = SIM_DEFAULTS) {
  const list = [];
  for (const v of opts.variants) {
    if (v === "nu") list.push({ name: "nu", kind: "nu", capPerDate: false });
    else if (v === "nu_maks1") list.push({ name: "nu_maks1", kind: "nu", capPerDate: true });
    else if (v === "B") for (const s of opts.bScales) list.push({ name: `B@${s}`, kind: "B", capPerDate: true, scale: s });
    // #3564: kurve B (developmentCurveB.ts) med private params, + maks +1 pr. dato.
    else if (v === "kurveB") list.push({ name: "kurveB", kind: "curveB", capPerDate: true });
    else if (v.startsWith("xp")) list.push(xpVariant(v, opts));
  }
  return list;
}

/** Alt andet end XP-tallene, der flytter en XP-kørsel. To kørsler må kun på samme kort, hvis det er ens. */
export function xpRunInputs(variant, opts) {
  return { plan: variant.plan, intensity: variant.intensity, trainNowBonus: variant.trainNowBonus,
    variationSpan: variant.variationSpan ?? opts.xpVariationSpan,
    variationMemory: variant.variationMemory ?? opts.xpVariationMemory ?? 0,
    capPerDate: variant.capPerDate !== false, raceDayFloor: variant.raceDayFloor === true,
    engine: engineHooks(opts).source,
    raceRoles: opts.raceRoles ?? null, raceRoleYield: opts.raceRoleYield ?? null };
}

/** Det, der ud over kurve B's egne tal flytter en kurve B-kørsel: løbsdagens roller og rolletillæg. */
export function curveBRunInputs(opts) {
  return { raceRoles: opts.raceRoles ?? null, raceRoleYield: opts.raceRoleYield ?? null };
}

/** Kurve B må kun på kortet, hvis både kalibreringen og løbets antagelser er de samme som i denne kørsel. */
export function sameCurveBRun(result, opts) {
  if (result.variant !== "kurveB") return true;
  return JSON.stringify(result.params?.curveB ?? null) === JSON.stringify(opts.curveB ?? null)
    && JSON.stringify(result.params?.curveBRun ?? null) === JSON.stringify(curveBRunInputs(opts));
}

/**
 * Identiteten på gemte gates: alt, der flytter X8, X9 og H. Indholdet af de private
 * filer indgår, så en ny fil ugyldiggør de gemte tal. Nøglen er et hash, så tallene
 * ikke står i klar tekst i nøglen.
 */
export function xpGateKey({ fingerprint, opts, estimateParams = null, knowledge = null }) {
  const gateVariant = xpVariant(opts.xpGateVariant ?? "xp", opts);
  const inputs = [fingerprint, gateVariant.xpParams, curveBRunInputs(opts), opts.curveB ?? null,
    opts.xpVariationSpan ?? null, opts.xpAttackSpans ?? null, opts.xpAttackMemories ?? null, estimateParams, knowledge,
    // #7757: gulvet flytter X8; hukommelse og motorens kilde flytter kørslen.
    gateVariant.raceDayFloor, opts.xpVariationMemory ?? null, engineHooks(opts).source];
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}

// Led i et xp-navn, der vælger en del af motorens pakke (#7757). De kan kombineres, fx
// xp_bonus15_gulv_nocap. Resten af navnet er den private variant, tallene kommer fra.
const XP_NAME_TOKENS = Object.freeze({
  rot: { plan: "rotate" },
  hard: { intensity: "hard" },
  nocap: { capPerDate: false }, // intet dagsloft (#7739): kun prisen bremser
  gulv: { raceDayFloor: true }, // løbsdag mindst en hård dag med træner (ejer 7/11)
});

/**
 * En xp-variant: navnet vælger plan, Træn nu-bonus, dagsloft og løbsdags-gulv. Private
 * varianter lægger tal ovenpå, også under et navn med led (xp_cal_nocap bruger xp_cal).
 */
export function xpVariant(name, opts) {
  const parts = name.split("_");
  const flags = {};
  let bonusPct = null;
  const base = [];
  for (const part of parts) {
    const bonus = /^bonus(\d+)$/.exec(part);
    if (bonus && parts[0] === "xp") bonusPct = Number(bonus[1]);
    else if (XP_NAME_TOKENS[part] && part !== parts[0]) Object.assign(flags, XP_NAME_TOKENS[part]);
    else base.push(part);
  }
  const custom = opts.xpVariants?.[name] ?? opts.xpVariants?.[base.join("_")] ?? {};
  const raw = { ...(opts.xp ?? {}), ...(custom.xp ?? {}) };
  const xpParams = validateDevelopmentXpParams(raw);
  if (!xpParams) throw new Error(`XP-params mangler eller er ugyldige for ${name}: læg den private fil ${PRIVATE_XP_PATH.join("/")} (hard rule 17)`);
  const variationMemory = custom.variationMemory ?? null;
  if (variationMemory != null && !(variationMemory >= 0 && variationMemory < 1)) {
    throw new Error(`Hukommelsen i dagsvariationen skal ligge i [0, 1) for ${name}`);
  }
  return {
    name, kind: "xp", xpParams,
    capPerDate: custom.capPerDate ?? flags.capPerDate ?? true,
    raceDayFloor: custom.raceDayFloor ?? flags.raceDayFloor ?? false,
    plan: custom.plan ?? flags.plan ?? "standard",
    intensity: custom.intensity ?? flags.intensity ?? null,
    trainNowBonus: custom.trainNowBonus ?? (bonusPct != null ? bonusPct / 100 : 0),
    variationSpan: custom.variationSpan ?? null,
    variationMemory,
  };
}

// ── XP-gates (#6110 §8): tal pr. variant, ingen dom. Dommen står på kortet ──────────

const statsOf = (values) => {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  const mean = s.length ? s.reduce((sum, x) => sum + x, 0) / s.length : null;
  return { n: s.length, mean: round(mean, 2), p50: round(quantile(s, 0.5)), p90: round(quantile(s, 0.9)), max: s.at(-1) ?? null };
};

/** Kalibreringstjek: point i første sæson efter potentiale og aldersgruppe. */
function firstSeasonByAgeAndPotential(riders) {
  const out = {};
  const band = (age) => (age <= 18 ? "16-18" : age <= 25 ? "19-25" : age <= 28 ? "26-28" : age <= 31 ? "29-31" : "32+");
  for (const r of riders) {
    if (r.firstSeasonPoints == null || r.inflow) continue;
    ((out[band(r.start.age)] ??= {})[Math.floor(r.potentiale)] ??= []).push(r.firstSeasonPoints);
  }
  return Object.fromEntries(Object.entries(out).sort().map(([b, pots]) => [b,
    Object.fromEntries(Object.entries(pots).map(([p, v]) => [p, statsOf(v)]))]));
}

/** X2: karrierens top efter potentiale for ryttere, der startede unge eller kom ind. */
export function potentialPeakStats(riders) {
  const groups = {};
  for (const r of riders) {
    if (!r.trajectory?.length) continue;
    if (!r.inflow && !(r.start?.age <= 23)) continue;
    if (Math.max(...r.trajectory.map((x) => x.age)) < 27) continue;
    (groups[Math.floor(r.potentiale)] ??= []).push(Math.max(...r.trajectory.map((x) => x.rating)));
  }
  return Object.fromEntries(Object.entries(groups).sort().map(([k, v]) => [k, statsOf(v)]));
}

/** X3: stiger etablerede veteraner? Rating efter 3 og 5 sæsoner mod billedets. */
export function veteranStats(riders, s0) {
  const out = {};
  const groups = {
    "29-34 rating 50+": (r) => r.start?.age >= 29 && r.start.age <= 34 && r.start.rating >= 50,
    "29-34 alle": (r) => r.start?.age >= 29 && r.start.age <= 34 && r.start.rating != null,
  };
  for (const [name, member] of Object.entries(groups)) {
    const list = riders.filter((r) => member(r) && r.trajectory?.length);
    out[name] = {};
    for (const after of [3, 5]) {
      const deltas = list.map((r) => {
        const t = r.trajectory.find((x) => x.season === s0 + after);
        return t ? t.rating - r.start.rating : null;
      }).filter((x) => x != null);
      out[name][`efter${after}`] = { n: deltas.length, stiger: deltas.filter((d) => d > 0).length, medianDelta: median(deltas) };
    }
  }
  return out;
}

/** X7, X10, X6 og Træn nu, målt ved sidste sæsons slut. */
function worldGateStats(world, season, { variant, seasonPoints, inSeasonRatingDrops, s0, opts }) {
  const onTeam = world.riders.filter((r) => !r.retired && r.teamId != null);
  const withAge = onTeam.map((r) => ({ r, age: ageForSeason(r.birthdate, season) }));
  const perAbility = (list) => Object.fromEntries(VISIBLE_ABILITIES.map((a) => [a, statsOf(list.map((x) => Number(x.r.abilities[a])))]));
  const mental = [...MENTAL_ABILITIES];
  const physical = VISIBLE_ABILITIES.filter((a) => abilityMeta(a)?.category === "physical");
  const best = (r, list) => Math.max(...list.map((a) => Number(r.abilities[a] ?? 0)));
  const seniors = withAge.filter((x) => x.age >= 30);
  const weeks = world.riders.filter((r) => r.firstWeeks);
  const byPot = [...withAge].map((x) => ({ pot: x.r.potentiale, rating: bestRating(x.r.abilities) }))
    .filter((x) => x.rating != null).sort((a, b) => b.rating - a.rating).slice(0, 50);
  const press = { aktive: [], passive: [] };
  for (const { r } of withAge) {
    const team = world.teams.get(r.teamId);
    if (team.isAi) continue;
    const rating = bestRating(r.abilities);
    if (rating != null) press[isTrainNowTeam(team) ? "aktive" : "passive"].push(rating);
  }
  return {
    pointsPerSeason: seasonPoints,
    capViolations: world.capViolations,
    inSeasonRatingDrops,
    abilityPoints: world.abilityPoints,
    abilityEnd: { alle: perAbility(withAge), senior30: perAbility(seniors) },
    mentalOverPhysical: { seniors: seniors.length, mentalBest: seniors.filter((x) => best(x.r, mental) > best(x.r, physical)).length },
    top50ByPotential: byPot.reduce((acc, x) => { const k = Math.floor(x.pot); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}),
    firstSeason: {
      byAgeAndPotential: firstSeasonByAgeAndPotential(world.riders),
      byDate: world.firstSeasonByDate,
      barsOverOneAtStart: world.riders.reduce((s, r) => s + (r.startBarsOverOne ?? 0), 0),
      week1: statsOf(weeks.map((r) => r.firstWeeks[0])),
      week2: statsOf(weeks.map((r) => r.firstWeeks[1])),
    },
    trainNow: { aktive: statsOf(press.aktive), passive: statsOf(press.passive) },
    seasons: opts.seasons, startSeason: s0, kind: variant.kind,
  };
}

/** Forventet topniveau (§6): standardkarriere fra nuværende evner, i rytterens naturlige rolle. */
export function expectedTopRating({ id, abilities, potentiale, age, primary_type, secondary_type }, xp, { endAge = 36, datesPerSeason = 32, raceDays = 32 } = {}) {
  const program = assistantProgram(primary_type, secondary_type);
  const shares = xpProgramShares(program, { primaryType: primary_type, secondaryType: secondary_type, xp });
  let state = { ...abilities };
  const bars = {};
  let top = bestRating(state) ?? 0;
  for (let a = age; a <= endAge; a++) {
    const rates = riderXpRates({ potentiale, age: a }, xp);
    for (let d = 0; d < datesPerSeason; d++) {
      for (const ability of Object.keys(shares)) {
        const level = Number(state[ability]);
        if (!Number.isFinite(level)) continue;
        const riderXp = MENTAL_ABILITIES.has(ability) ? rates.mental : rates.physical;
        const out = buyPoints({ level, bar: bars[ability] ?? 0, xp: riderXp * shares[ability], maxPoints: 1 }, xp);
        bars[ability] = out.bar;
        state[ability] = out.level;
      }
    }
    top = Math.max(top, bestRating(state) ?? 0);
    const dev = developRiderSeasonV2({ id, primary_type, potentiale, age: a + 1 }, state, a, { load: { raceDays, hardDays: 0 } });
    state = { ...state, ...dev.next };
  }
  return top;
}

/**
 * X4: én syntetisk rytter trænet i samme session hele karrieren, 19 år og frem, med
 * sæsonfald. Alle evner står ens ved start. Svarer på, hvor langt en type kan trænes om.
 */
export function typeCareer({ primaryType, secondaryType, session, potentiale, startLevel, seasons, ability }, xp, opts) {
  const program = applyTrainingCatalog({ focus: session, intensity: "hard" }, { v3: true });
  const shares = xpProgramShares(program, { primaryType, secondaryType, xp });
  let abilities = Object.fromEntries(VISIBLE_ABILITIES.map((a) => [a, startLevel]));
  const bars = {};
  const dates = Math.ceil(opts.raceDaysPerSeason / opts.raceDaysPerDate);
  const trail = [];
  for (let i = 0; i < seasons; i++) {
    const age = 19 + i;
    const rates = riderXpRates({ potentiale, age }, xp);
    for (let d = 0; d < dates; d++) {
      for (const a of Object.keys(shares)) {
        const out = buyPoints({ level: abilities[a], bar: bars[a] ?? 0, maxPoints: 1,
          xp: (MENTAL_ABILITIES.has(a) ? rates.mental : rates.physical) * shares[a] }, xp);
        bars[a] = out.bar;
        abilities[a] = out.level;
      }
    }
    trail.push(abilities[ability]);
    const dev = developRiderSeasonV2({ id: "x4", primary_type: primaryType, potentiale, age: age + 1 }, abilities, i, { load: { raceDays: 32, hardDays: 120 } });
    abilities = { ...abilities, ...dev.next };
  }
  return { after10: trail[9] ?? null, after16: trail[15] ?? null, best: Math.max(...trail) };
}

/** X5: XP på en hel dag ved normal intensitet, mindste fokus-evne, for hver rytter på hold. */
export function dayXpFloor(world, seasonNumber, xp) {
  const totals = [];
  const focus = [];
  for (const r of world.riders) {
    if (r.teamId == null) continue;
    const age = ageForSeason(r.birthdate, seasonNumber);
    const rates = riderXpRates({ potentiale: r.potentiale, age }, xp);
    const program = assistantProgram(r.primary_type, r.secondary_type);
    const shares = xpProgramShares(program, { primaryType: r.primary_type, secondaryType: r.secondary_type, xp });
    const fa = program.focusAbilities ?? TRAINING_FOCUSES[program.focus] ?? [];
    let total = 0;
    let least = Infinity;
    for (const [a, share] of Object.entries(shares)) {
      const gained = (MENTAL_ABILITIES.has(a) ? rates.mental : rates.physical) * share;
      total += gained;
      if (fa.includes(a)) least = Math.min(least, gained);
    }
    totals.push(total);
    if (Number.isFinite(least)) focus.push(least);
  }
  const min = (list) => (list.length ? round(Math.min(...list), 2) : null);
  return { riders: totals.length, dayTotalMin: min(totals), focusAbilityMin: min(focus), underOneXpInFocus: focus.filter((x) => x < 1).length };
}

/** X8: løbsdag mod hård dag i etapens evner for samme rytter, og mod løbsdagen i dag (kurve B). */
export function raceVsTraining(world, seasonNumber, xp, opts, { sample = 1200, floor = false } = {}) {
  const hooks = engineHooks(opts);
  const ratios = { leader: [], helper: [], free: [] };
  const roles = { leader: "captain", helper: "helper", free: "free_role" };
  let underHard = 0;
  let underHardNoStaff = 0;
  let underToday = 0;
  let checks = 0;
  const divisor = raceDayBudgetDivisor();
  const staffCache = new Map();
  const riders = world.riders.filter((r) => r.teamId != null).slice(0, sample);
  for (const r of riders) {
    const age = ageForSeason(r.birthdate, seasonNumber);
    const team = world.teams.get(r.teamId);
    const riderLevel = riderLevelBand({ age });
    const staffMults = xpStaffMults(team, riderLevel, staffCache);
    const rates = riderXpRates({ potentiale: r.potentiale, age }, xp);
    const caps = opts.curveB ? buildCapsForRider(r.abilities, { potentiale: r.potentiale, age }, r.primary_type, r.secondary_type) : null;
    const ctx = { primaryType: r.primary_type, secondaryType: r.secondary_type, xp };
    // Gulvets hårde dag er rytterens egen plan på hård intensitet, som i sæsonløkken.
    const ownHard = floor ? xpProgramShares(assistantProgram(r.primary_type, r.secondary_type, { intensity: "hard" }), ctx) : null;
    for (const profile of RACE_PROFILES) {
      const focusAbilities = RACE_PROFILE_ABILITY_MAP[profile];
      const hardShares = xpProgramShares({ focus: "race_day", intensity: "hard", focusAbilities }, ctx);
      const hardBare = focusAbilities.reduce((s, a) => s + (hardShares[a] ?? 0) * (MENTAL_ABILITIES.has(a) ? rates.mental : rates.physical), 0);
      const hard = focusAbilities.reduce((s, a) => s + (hardShares[a] ?? 0) * staffMults[a] * (MENTAL_ABILITIES.has(a) ? rates.mental : rates.physical), 0);
      for (const [group, role] of Object.entries(roles)) {
        const { program, mults: roleMults } = xpRaceDay(profile, role, { xp, raceRoleYield: opts.raceRoleYield });
        const raceShares = xpProgramShares(program, { ...ctx, raceDay: true });
        // Med gulvet (#7757) er løbsdagens andel allerede mindst den hårde dags med træner.
        const shares = floor ? hooks.raceDayFloorShares({ raceShares, raceMults: roleMults, hardShares: ownHard, staffMults }) : raceShares;
        const mults = floor ? {} : (roleMults ?? {});
        const race = focusAbilities.reduce((s, a) => s + (shares[a] ?? 0) * (mults[a] ?? 1) * (MENTAL_ABILITIES.has(a) ? rates.mental : rates.physical), 0);
        if (hard > 0) ratios[group].push(race / hard);
        checks += 1;
        if (race < hard) underHard += 1;
        if (race < hardBare) underHardNoStaff += 1;
        if (caps) {
          const quality = computeTrainingScore({
            program, age: null, potentiale: r.potentiale, conditionMult: 1, noise: 1, primaryType: r.primary_type, secondaryType: r.secondary_type,
          })?.deltaQualityMult ?? 1;
          const pointsXp = focusAbilities.reduce((s, a) => s + ((shares[a] ?? 0) * (mults[a] ?? 1) * (MENTAL_ABILITIES.has(a) ? rates.mental : rates.physical) / opts.raceDaysPerDate) / xpPriceForNextPoint(r.abilities[a] ?? 0, xp), 0);
          const pointsToday = focusAbilities.reduce((s, a) => s + dailyAbilityDelta({
            ability: a, current: Number(r.abilities[a] ?? 0), cap: caps[a], age, program, conditionMult: 1, noise: 1, potentiale: r.potentiale,
            primaryType: r.primary_type, secondaryType: r.secondary_type, budgetDivisor: divisor, curveB: opts.curveB, riderQualityMult: quality,
          }) * (mults[a] ?? 1), 0);
          if (pointsXp < pointsToday) underToday += 1;
        }
      }
    }
  }
  const ratioStats = Object.fromEntries(Object.entries(ratios).map(([k, v]) => {
    const s = v.sort((a, b) => a - b);
    return [k, { n: s.length, min: round(s[0], 2), p50: round(quantile(s, 0.5), 2) }];
  }));
  return { checks, underHard, underHardNoStaff, underToday, ratio: ratioStats };
}

/** Variation med hukommelse: gode og dårlige perioder, neutral over tid, deterministisk pr. seed. */
export function variationSeries(key, dates, span, memory) {
  const out = [];
  let state = 2 * seededUnitMixed(`${key}:s`) - 1;
  for (let d = 0; d < dates; d++) {
    const fresh = 2 * seededUnitMixed(`${key}:${d}`) - 1;
    state = memory > 0 ? memory * state + Math.sqrt(1 - memory ** 2) * fresh : fresh;
    out.push(1 + span * Math.max(-1, Math.min(1, state)));
  }
  return out;
}

/** Det potentiale i tabellen, der passer bedst til det aflæste XP. Spilleren kender tabellen, hvis prisen er offentlig. */
export function nearestPotential(xpRead, steps) {
  let best = steps[0];
  for (const s of steps) if (Math.abs(Math.log(xpRead / s.xp)) < Math.abs(Math.log(xpRead / best.xp))) best = s;
  return best.potentiale;
}

/**
 * X9/H6b: en spiller kender koden og alle input undtagen nøglen og potentialet. Han
 * deler dagens XP med de kendte led, tager snittet over N datoer og slår potentialet op.
 * Fejlen måles på det sande tal og sammenlignes med holdets eget skøn efter N datoer.
 */
export function talentAttack(rows, xp, estimateParams, { dateSteps, spans, memories, potentials }) {
  const steps = potentials.map((potentiale) => ({ potentiale, xp: xpPerDate({ potentiale, age: 23 }, xp) }));
  const estimateErr = (n) => {
    const errs = rows.map((r) => {
      const e = estimatePotential({ truePot: r.truth, currentRating: 1, riderId: r.id, teamId: "hA", knowledge: { own: true, trainingDates: n, staffSpeed: 0 } }, estimateParams);
      return e.hidden ? null : Math.abs(e.value - r.truth);
    }).filter((x) => x != null);
    return errs.length ? { p50: quantile(errs.sort((a, b) => a - b), 0.5), hidden: rows.length - errs.length } : { p50: null, hidden: rows.length };
  };
  const out = { estimate: {}, attack: {} };
  for (const n of dateSteps) out.estimate[n] = estimateErr(n);
  for (const span of spans) {
    for (const memory of memories) {
      const key = `span${span}-mem${memory}`;
      out.attack[key] = {};
      for (const n of dateSteps) {
        const errs = [];
        let exact = 0;
        for (const r of rows) {
          const base = xpPerDate({ potentiale: r.potentiale, age: 23 }, xp);
          const series = variationSeries(`h6b:${r.id}`, n, span, memory);
          const read = series.reduce((s, v) => s + base * v, 0) / n;
          const guess = nearestPotential(read, steps);
          if (guess === r.potentiale) exact += 1;
          errs.push(Math.abs((r.truthByPotential[guess] ?? r.truth) - r.truth));
        }
        out.attack[key][n] = { p50: quantile(errs.sort((a, b) => a - b), 0.5), exactPct: round((100 * exact) / rows.length) };
      }
    }
  }
  return out;
}

/** H1, H2, H3 og H6 mod det nye sande tal. Samme regning som potentialEstimateHarness6110. */
export function estimateGates(rows, knowledge, params) {
  const staffSpeed = (k) => ((k.coachTier ?? 0) + (k.facilityTier ?? 0)) / 10;
  const toKnowledge = (k) => (k.own
    ? { own: true, trainingDates: k.trainingDates, staffSpeed: staffSpeed(k) }
    : { own: false, looks: k.looks, bestScoutTier: k.bestScoutTier });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const h1 = {};
  const list = [];
  for (const k of knowledge) {
    const r = byId.get(k.rider_id);
    if (!r) continue;
    const e = estimatePotential({ truePot: r.truth, currentRating: r.rating, riderId: k.rider_id, teamId: k.team_id, knowledge: toKnowledge(k) }, params);
    if (!e.hidden) list.push({ own: !!k.own, word: e.certainty, err: Math.abs(e.value - r.truth) });
  }
  for (const group of ["own", "scouted"]) {
    h1[group] = {};
    for (const word of CERTAINTY_WORDS) {
      const errs = list.filter((x) => x.own === (group === "own") && x.word === word).map((x) => x.err).sort((a, b) => a - b);
      h1[group][word] = { n: errs.length, p50: round(quantile(errs, 0.5)), p90: round(quantile(errs, 0.9)), within5: errs.length ? round((100 * errs.filter((e) => e <= 5).length) / errs.length) : null };
    }
  }
  let unstable = 0;
  const sample = rows.slice(0, 2000);
  for (const r of sample) {
    const input = { truePot: r.truth, currentRating: 1, riderId: r.id, teamId: "hA", knowledge: { own: false, looks: 1, bestScoutTier: 3 } };
    if (JSON.stringify(estimatePotential(input, params)) !== JSON.stringify(estimatePotential(input, params))) unstable += 1;
  }
  const paths = {
    scout_t1: [1, 2, 3].map((looks) => ({ own: false, looks, bestScoutTier: 1 })),
    scout_t5: [1, 2, 3].map((looks) => ({ own: false, looks, bestScoutTier: 5 })),
    own: [5, 12, 20, 40].map((trainingDates) => ({ own: true, trainingDates, staffSpeed: 0 })),
  };
  const h3 = {};
  let meanBreaks = 0;
  for (const [name, path] of Object.entries(paths)) {
    const means = path.map((knowledgeStep) => {
      const errs = sample.map((r) => {
        const e = estimatePotential({ truePot: r.truth, currentRating: 1, riderId: r.id, teamId: "hA", knowledge: knowledgeStep }, params);
        return e.hidden ? null : Math.abs(e.value - r.truth);
      }).filter((x) => x != null);
      return errs.length ? round(errs.reduce((s, x) => s + x, 0) / errs.length, 2) : null;
    });
    for (let i = 1; i < means.length; i++) if (means[i] != null && means[i - 1] != null && means[i] > means[i - 1]) meanBreaks += 1;
    h3[name] = means;
  }
  const h6 = {};
  for (const teams of [1, 3, 10]) {
    const errs = sample.map((r) => {
      let sum = 0;
      for (let t = 0; t < teams; t++) sum += estimatePotential({ truePot: r.truth, currentRating: 1, riderId: r.id, teamId: `inv${t}`, knowledge: { own: false, looks: 1, bestScoutTier: 1 } }, params).value;
      return Math.abs(sum / teams - r.truth);
    }).sort((a, b) => a - b);
    h6[`hold${teams}`] = { p50: round(quantile(errs, 0.5), 2), p90: round(quantile(errs, 0.9), 2) };
  }
  const k1 = { own: false, looks: 1, bestScoutTier: 1 };
  const k3 = { own: false, looks: 3, bestScoutTier: 1 };
  const u1 = uncertaintyFor(k1, params);
  const u3 = uncertaintyFor(k3, params);
  const attack = [];
  const single = [];
  for (const r of sample) {
    const base = { truePot: r.truth, currentRating: 1, riderId: r.id, teamId: "inv0" };
    const e1 = estimatePotential({ ...base, knowledge: k1 }, params).value;
    const e3 = estimatePotential({ ...base, knowledge: k3 }, params).value;
    attack.push(Math.abs((e1 * u3 - e3 * u1) / (u3 - u1) - r.truth));
    single.push(Math.abs(e3 - r.truth));
  }
  h6.toNiveauer = { angrebP50: round(quantile(attack.sort((a, b) => a - b), 0.5), 2), bedsteP50: round(quantile(single.sort((a, b) => a - b), 0.5), 2) };
  return { h1, h2Unstable: unstable, h3, h3MeanBreaks: meanBreaks, h6 };
}

/** Gates uden for sæsonløkken: X4, X5, X8, X9 og H. Kører på billedet, ikke på simuleringen. */
export function runXpGates(snapshot, opts, { estimateParams = null, knowledge = null, sampleRiders = 800 } = {}) {
  const gateVariant = xpVariant(opts.xpGateVariant ?? "xp", opts);
  const xp = gateVariant.xpParams;
  const world = buildWorld(snapshot);
  const season = world.startSeason;
  const types = {
    "klatrer, klatring": { primaryType: "climber", secondaryType: "puncheur", session: "vo2max_climb", ability: "climbing" },
    "ren sprinter, klatring": { primaryType: "sprinter", secondaryType: null, session: "vo2max_climb", ability: "climbing" },
    "sprinter med klatrer som sekundær, klatring": { primaryType: "sprinter", secondaryType: "climber", session: "vo2max_climb", ability: "climbing" },
    "klatrer trænet til bakker, punch": { primaryType: "climber", secondaryType: null, session: "vo2max_punch", ability: "punch" },
    "puncheur, punch": { primaryType: "puncheur", secondaryType: null, session: "vo2max_punch", ability: "punch" },
  };
  const out = { x4: {}, x5: dayXpFloor(world, season, xp), x8: raceVsTraining(world, season, xp, opts, { floor: gateVariant.raceDayFloor }) };
  for (const potentiale of [6, 4]) {
    for (const [name, spec] of Object.entries(types)) {
      out.x4[`${name}, pot ${potentiale}`] = typeCareer({ ...spec, potentiale, startLevel: 20, seasons: 16 }, xp, opts);
    }
  }
  if (!estimateParams) return out;
  validateEstimateParams(estimateParams);
  const potentials = xp.potentialXp.length ? [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6] : [];
  const onTeam = world.riders.filter((r) => r.teamId != null);
  const career = { datesPerSeason: Math.ceil(opts.raceDaysPerSeason / opts.raceDaysPerDate) };
  const asInput = (r, potentiale) => ({ id: r.id, abilities: r.abilities, potentiale, age: ageForSeason(r.birthdate, season), primary_type: r.primary_type, secondary_type: r.secondary_type });
  const rows = onTeam.map((r) => ({ id: r.id, potentiale: r.potentiale, rating: bestRating(r.abilities), truth: expectedTopRating(asInput(r, r.potentiale), xp, career) }));
  out.truth = {
    riders: rows.length,
    aboveRatingAtStart: rows.filter((r) => r.truth > (r.rating ?? 0)).length,
    byPotential: Object.fromEntries(potentials.map((p) => [p, statsOf(rows.filter((r) => r.potentiale === p).map((r) => r.truth))])),
  };
  if (knowledge) out.h = estimateGates(rows, knowledge, estimateParams);
  const step = Math.max(1, Math.floor(rows.length / sampleRiders));
  const sample = rows.filter((_, i) => i % step === 0).slice(0, sampleRiders).map((row) => {
    const r = onTeam.find((x) => x.id === row.id);
    return { ...row, truthByPotential: Object.fromEntries(potentials.map((p) => [p, expectedTopRating(asInput(r, p), xp, career)])) };
  });
  out.x9 = talentAttack(sample, xp, estimateParams, {
    dateSteps: [5, 12, 20, 40], spans: opts.xpAttackSpans ?? [DAILY_TRAINING_CONFIG.noiseSpan], memories: opts.xpAttackMemories ?? [0], potentials,
  });
  return out;
}

// ── Prod-billede (KUN SELECT) ────────────────────────────────────────────────────

async function loadProdSnapshot() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler (kør via infisical run --env=prod), eller brug --snapshot");
  }
  const { createClient } = await import("@supabase/supabase-js");
  const { fetchAllRows } = await import("../../lib/supabasePagination.js");
  const { loadSeasonDevelopmentLoad } = await import("../../lib/seasonDevelopmentLoad.js");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: season, error: seasonErr } = await sb
    .from("seasons").select("id, number, race_days_total, race_days_completed")
    .eq("status", "active").order("number", { ascending: false }).limit(1).maybeSingle();
  if (seasonErr || !season) throw new Error(`aktiv sæson: ${seasonErr?.message ?? "ingen"}`);

  const [riders, abilities, teams, facilities, staffRows, load] = await Promise.all([
    fetchAllRows(() => sb.from("riders")
      .select(`id, birthdate, potentiale, primary_type, secondary_type, team_id, is_academy, ${RETIREMENT_NOTICE_COLUMNS}`)
      .eq("is_retired", false).order("id")),
    fetchAllRows(() => sb.from("rider_derived_abilities")
      .select(`rider_id, ${VISIBLE_ABILITIES.join(", ")}, ability_progress`).order("rider_id")),
    fetchAllRows(() => sb.from("teams").select("id, is_ai, is_bank, is_frozen, is_test_account, division").order("id")),
    fetchAllRows(() => sb.from("team_facilities").select("id, team_id, track, tier").eq("track", "training").order("id")),
    fetchAllRows(() => sb.from("team_staff").select("id, team_id, name, role, tier, status")
      .eq("role", "training").eq("status", "active").order("id")),
    loadSeasonDevelopmentLoad({ supabase: sb, seasonId: season.id }),
  ]);
  const staffIds = staffRows.map((s) => s.id);
  const staffAbilities = [];
  for (let i = 0; i < staffIds.length; i += 200) {
    const { data, error } = await sb.from("staff_derived_abilities")
      .select("staff_id, overall, dimensions, levels").in("staff_id", staffIds.slice(i, i + 200));
    if (error) throw new Error(`staff_derived_abilities: ${error.message}`);
    staffAbilities.push(...(data ?? []));
  }
  // Samme valg som trainingStaffContext.loadTrainingStaffContext: facilitetens tier,
  // og den STÆRKESTE aktive træner (højeste overall).
  const abilityByStaff = new Map(staffAbilities.map((a) => [a.staff_id, a]));
  const staffByTeam = {};
  for (const f of facilities) (staffByTeam[f.team_id] ??= { facilityTier: 0, staff: null }).facilityTier = f.tier ?? 0;
  const profilesByTeam = new Map();
  for (const s of staffRows) {
    const p = abilityByStaff.get(s.id) ?? deriveStaffAbilities({ role: s.role, tier: s.tier, name: s.name });
    if (!profilesByTeam.has(s.team_id)) profilesByTeam.set(s.team_id, []);
    profilesByTeam.get(s.team_id).push(p);
  }
  for (const [teamId, profiles] of profilesByTeam) {
    const ab = profiles.reduce((best, p) => ((p.overall ?? 0) > (best.overall ?? 0) ? p : best));
    (staffByTeam[teamId] ??= { facilityTier: 0, staff: null }).staff = {
      overall: ab.overall, dimensions: ab.dimensions ?? {}, levels: normalizeLevelBands(ab.levels ?? {}),
    };
  }
  return {
    takenAt: new Date().toISOString(), season, riders, abilities, teams, staffByTeam,
    load: Object.fromEntries([...load.byRider].map(([id, l]) => [id, { raceDays: l.raceDays, hardDays: l.hardDays }])),
  };
}

// ── Kortet (privat) ──────────────────────────────────────────────────────────────

function renderCard(snapshot, results, opts, date) {
  const L = [];
  const v = results.map((r) => r.variant);
  L.push(`# S25 · 10-sæsoners-simulering før tænding (${date}) · PRIVAT (hard rule 17)`);
  L.push("");
  L.push(`Øjebliksbillede: aktiv sæson ${snapshot.season.number}, taget ${snapshot.takenAt}. Simuleret: S${Number(snapshot.season.number) + 1} til S${Number(snapshot.season.number) + opts.seasons}, ${opts.raceDaysPerSeason} løbsdage pr. sæson (${opts.raceDaysPerDate} pr. dato). Assistenten styrer alle hold. Aldring = Udvikling 2.0 (#6499).`);
  L.push(`Varianter: ${v.join(" · ")}. B-normalisering (B@1): ${round(results.find((r) => r.variant.startsWith("B"))?.bNorm ?? NaN, 3) ?? "-"}. Løbsdags-andel uden måling (ung/ældre): ${results[0].raceShares.young} / ${results[0].raceShares.old}.`);
  for (const r of results.filter((x) => x.variant.startsWith("B") && x.params)) {
    L.push(`${r.variant}: dagsstøj ±${r.params.bNoiseSpan}, fast vækstfraktion fra alder ${r.params.bReferenceAge}.`);
  }
  L.push("");
  L.push("## Overblik");
  L.push("");
  L.push("| Variant | % ved 22 | % ved 25 | Topalder | Max-rating slut | P99 slut | Top 50 ≤ 23 år slut | Pensioneret i alt | Nye unge i alt |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const m = r.milestones.alle ?? {};
    const end = r.seasons.at(-1);
    const sum = (k) => r.transitions.reduce((s, t) => s + (t[k] ?? 0), 0);
    L.push(`| ${r.variant} | ${m.pct22 ?? "-"} | ${m.pct25 ?? "-"} | ${m.peakAgeMedian ?? "-"} | ${end?.rating.max ?? "-"} | ${end?.rating.p99 ?? "-"} | ${end?.top50.le23 ?? "-"} | ${sum("retired")} | ${sum("inflow")} |`);
  }
  L.push("");
  L.push("## D1-milepæle (målene står i D-058, spec 2026-10-03-udvikling-2-design.md)");
  L.push("Median af rytterens rating ved alderen i % af hans observerede karrieretop. Kun ryttere hvis bane dækker 22 til mindst 27.");
  L.push("");
  L.push("| Variant | Gruppe | N | % ved 22 | % ved 25 | Topalder (median) | Top 27-28 (%) | Top ≤ 24 (%) | Top-rating (median) |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    for (const [g, m] of Object.entries(r.milestones).sort()) {
      L.push(`| ${r.variant} | ${g} | ${m.n} | ${m.pct22} | ${m.pct25} | ${m.peakAgeMedian} | ${m.peakAt27to28} | ${m.peakAtOrBefore24} | ${m.peakMedian} |`);
    }
  }
  L.push("");
  L.push("## Stort talent efter 9 sæsoner (pot ≥ 5,5, startede ≤ 19; jeppeks Discord-pejlemærke 2/10)");
  L.push("");
  L.push("| Variant | N | Median | P90 | Max | ≥ 90 |");
  L.push("|---|---|---|---|---|---|");
  for (const r of results) L.push(`| ${r.variant} | ${r.bigTalent.n} | ${r.bigTalent.median} | ${r.bigTalent.p90} | ${r.bigTalent.max} | ${r.bigTalent.ge90} |`);
  L.push("");
  L.push("## Ratingfordeling pr. sæson (ryttere på hold, bedste rolle)");
  L.push("");
  L.push("| Variant | Tidspunkt | N | Snit | SD | P10 | P50 | P90 | P99 | Max | ≥70 | ≥80 | ≥85 | ≥90 |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    for (const s of [r.start, ...r.seasons]) {
      const x = s.rating;
      L.push(`| ${r.variant} | ${s.label} | ${x.n} | ${x.mean} | ${x.sd} | ${x.p10} | ${x.p50} | ${x.p90} | ${x.p99} | ${x.max} | ${x.ge70} | ${x.ge80} | ${x.ge85} | ${x.ge90} |`);
    }
  }
  L.push("");
  L.push("## Top 50: alder");
  L.push("");
  L.push("| Variant | Tidspunkt | Median-alder | ≤ 23 år | ≥ 31 år | Rating nr. 50 |");
  L.push("|---|---|---|---|---|---|");
  for (const r of results) for (const s of [r.start, ...r.seasons]) L.push(`| ${r.variant} | ${s.label} | ${s.top50.medianAge} | ${s.top50.le23} | ${s.top50.ge31} | ${s.top50.cutoff} |`);
  L.push("");
  L.push("## Pension, nye unge og aldring pr. skifte");
  L.push("");
  L.push("| Variant | Til sæson | Pensioneret | Pensionsalder (median) | Nye unge | Aldrings-point i alt | Synligt ratingfald (ryttere) |");
  L.push("|---|---|---|---|---|---|---|");
  for (const r of results) for (const t of r.transitions) L.push(`| ${r.variant} | S${t.season} | ${t.retired} | ${median(t.retireAges)} | ${t.inflow} | ${t.agingPoints} | ${t.ratingDrops} |`);
  L.push("");
  L.push("## Talent-spredning: snit og P90 pr. potentiale-bånd");
  L.push("");
  L.push("| Variant | Tidspunkt | Bånd | N | Snit | P90 |");
  L.push("|---|---|---|---|---|---|");
  for (const r of results) for (const s of [r.start, r.seasons.at(4), r.seasons.at(-1)].filter(Boolean)) {
    for (const [b, m] of Object.entries(s.meanByPotential)) L.push(`| ${r.variant} | ${s.label} | ${b} | ${m.n} | ${m.mean} | ${m.p90} |`);
  }
  L.push("");
  L.push("## Store mod små hold: holdets top-8-snit pr. division, og top 100 fordelt på division");
  L.push("");
  L.push("| Variant | Tidspunkt | Top-8-snit pr. division (hold) | Top 100 pr. division |");
  L.push("|---|---|---|---|");
  for (const r of results) for (const s of [r.start, r.seasons.at(4), r.seasons.at(-1)].filter(Boolean)) {
    const d = Object.entries(s.divisionTop8).map(([k, m]) => `D${k}: ${m.mean} (${m.teams})`).join(" · ");
    const t = Object.entries(s.top100ByDivision).sort().map(([k, n]) => `D${k}: ${n}`).join(" · ");
    L.push(`| ${r.variant} | ${s.label} | ${d} | ${t} |`);
  }
  L.push("");
  L.push("## Maks +1 pr. dato (#7075): hvor tit binder det?");
  L.push("Uden loft: evne-point ud over +1 på samme dato (summeret over 10 sæsoner). Med loft: point skubbet til en senere dato.");
  L.push("");
  L.push("| Variant | Point over +1 pr. dato (uden loft) | Point skubbet af loftet |");
  L.push("|---|---|---|");
  for (const r of results) L.push(`| ${r.variant} | ${r.dateCap?.over ?? "-"} | ${r.dateCap?.clipped ?? "-"} |`);
  L.push("");
  L.push("## Nye unge (kom ind via generatoren) ved slut");
  L.push("");
  L.push("| Variant | N | Snit | P50 | P90 | Max |");
  L.push("|---|---|---|---|---|---|");
  for (const r of results) L.push(`| ${r.variant} | ${r.inflowEnd.n} | ${r.inflowEnd.mean} | ${r.inflowEnd.p50} | ${r.inflowEnd.p90} | ${r.inflowEnd.max} |`);
  L.push("");
  L.push("## Hvad simuleringen IKKE dækker");
  L.push("- Ingen løbsmotor: løbsdage er seedede ud fra målt andel; profil-mixet er ligeligt, ikke kalenderens.");
  L.push("- Form og træthed er neutrale (conditionMult 1); ingen skader; assistenten træner normal intensitet hver dag (0 hårde dage i aldrings-bremsen).");
  L.push("- Ingen transfers, kontrakter, akademi-gradueringer eller oprykning; trupperne holdes ved at hvert hold erstatter sine pensionister med generatorens unge.");
  L.push("- B er en proxy (byggetrin 7 er ikke bygget): ingen ny niveau-kurve (D1), ingen belastningsevne for de helt unge, ingen løbsdags-score (S14). Udskiftes når developmentScore findes.");
  L.push("- kurveB er den rigtige kurve (#3564, developmentCurveB.ts, private params) gennem applyDailyTick; træningsscoren er dagens (Udviklingsscore B er ikke med).");
  L.push("- Det bløde loft pr. evne (byggetrin 14) og fart pr. klasse (15) er ikke med; lofterne er dagens buildCapsForRider. Assistenten bruger katalog v3.");
  L.push("- #7075-reglen er gengivet i scriptet (PR'en er ikke merget).");
  return L.join("\n") + "\n";
}

const fmtStats = (s) => (s?.n ? `${s.p50} / ${s.p90} / ${s.max} (${s.n})` : "-");

/** Det private XP-kort: tal pr. gate, med kurve B ved siden af. Dommen skrives af den, der læser kortet. */
export function renderXpGates(snapshot, results, gates, opts, date) {
  const L = [];
  const shown = results.filter((r) => r.gates);
  const xpRuns = shown.filter((r) => r.gates.kind === "xp");
  L.push(`# #6110 XP-gates (${date}) · PRIVAT (hard rule 17)`);
  L.push("");
  L.push(`Billede: sæson ${snapshot.season.number}, ${snapshot.takenAt}. ${opts.seasons} sæsoner, ${opts.raceDaysPerSeason} løbsdage pr. sæson. Assistenten styrer alle hold. Dagsvariation ±${opts.xpVariationSpan}.`);
  L.push("");
  L.push("## X1 Milepæle (mål: ca. 60 % ved 22, ca. 85 % ved 25, top 27-28)");
  L.push("");
  L.push("| Variant | Gruppe | N | % ved 22 | % ved 25 | Topalder | Top 27-28 (%) | Top ≤ 24 (%) | Top-rating |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of shown) for (const [g, m] of Object.entries(r.milestones).sort()) L.push(`| ${r.variant} | ${g} | ${m.n} | ${m.pct22} | ${m.pct25} | ${m.peakAgeMedian} | ${m.peakAt27to28} | ${m.peakAtOrBefore24} | ${m.peakMedian} |`);
  L.push("");
  L.push("## X2 Niveau: karrierens top efter potentiale (p50 / p90 / max (n)), top 50 ved slut");
  L.push("");
  const pots = [1, 2, 3, 4, 5, 6];
  L.push(`| Variant | ${pots.map((p) => `Pot ${p}`).join(" | ")} | Top 50 efter pot |`);
  L.push(`|---|${pots.map(() => "---").join("|")}|---|`);
  for (const r of shown) L.push(`| ${r.variant} | ${pots.map((p) => fmtStats(r.gates.potentialPeak[p])).join(" | ")} | ${Object.entries(r.gates.top50ByPotential).map(([k, n]) => `${k}: ${n}`).join(" · ")} |`);
  L.push("");
  L.push("## X3 Veteraner: stiger de?");
  L.push("");
  L.push("| Variant | Gruppe | Efter 3: stiger / n, median | Efter 5: stiger / n, median |");
  L.push("|---|---|---|---|");
  for (const r of shown) for (const [g, v] of Object.entries(r.gates.veterans)) L.push(`| ${r.variant} | ${g} | ${v.efter3.stiger} / ${v.efter3.n}, ${v.efter3.medianDelta} | ${v.efter5.stiger} / ${v.efter5.n}, ${v.efter5.medianDelta} |`);
  L.push("");
  if (gates?.x4) {
    L.push("## X4 Type: syntetisk 19-årig, alle evner 20, samme session hver dag, med sæsonfald");
    L.push("");
    L.push("| Rytter | Efter 10 sæsoner | Efter 16 | Bedst |");
    L.push("|---|---|---|---|");
    for (const [k, v] of Object.entries(gates.x4)) L.push(`| ${k} | ${v.after10} | ${v.after16} | ${v.best} |`);
    L.push("");
  }
  if (gates?.x5) {
    L.push("## X5 Aldrig nul (hel dag ved normal intensitet)");
    L.push("");
    L.push(`Ryttere ${gates.x5.riders}. Mindste XP på en dag i alt: ${gates.x5.dayTotalMin}. Mindste XP på en fokus-evne: ${gates.x5.focusAbilityMin}. Fokus-evner under 1 XP: ${gates.x5.underOneXpInFocus}.`);
    L.push("");
  }
  L.push("## X6 Tændingen: første sæson");
  L.push("");
  L.push("| Variant | Ratingfald i sæsonen | Brud på +1 pr. dato | Barer over 1 ved start | Point uge 1 (p50 / p90 / max) | Point uge 2 |");
  L.push("|---|---|---|---|---|---|");
  for (const r of shown) {
    const g = r.gates;
    L.push(`| ${r.variant} | ${g.inSeasonRatingDrops} | ${g.capViolations} | ${g.firstSeason.barsOverOneAtStart} | ${fmtStats(g.firstSeason.week1)} | ${fmtStats(g.firstSeason.week2)} |`);
  }
  L.push("");
  L.push("## X7 Mentale evner ved slut (ryttere 30+, p50 / p90 / max)");
  L.push("");
  const mental = [...MENTAL_ABILITIES];
  const physical = ["climbing", "sprint", "tempo", "endurance"];
  L.push(`| Variant | ${[...mental, ...physical].join(" | ")} | Mental bedst af 30+ |`);
  L.push(`|---|${[...mental, ...physical].map(() => "---").join("|")}|---|`);
  for (const r of shown) {
    const e = r.gates.abilityEnd.senior30;
    L.push(`| ${r.variant} | ${[...mental, ...physical].map((a) => fmtStats(e[a])).join(" | ")} | ${r.gates.mentalOverPhysical.mentalBest} / ${r.gates.mentalOverPhysical.seniors} |`);
  }
  L.push("");
  L.push("## X8 Løb");
  L.push("");
  if (gates?.x8) {
    const x = gates.x8;
    L.push(`G1/G2: ${x.checks} rytter-løbsdage. Løbsdag under hård dag i etapens evner: ${x.underHard} med rytterens træner og facilitet, ${x.underHardNoStaff} uden. Under løbsdagen i dag (kurve B, point pr. dag): ${x.underToday}.`);
    L.push("");
    L.push("| Rolle | Forhold løb / hård dag: min | Median |");
    L.push("|---|---|---|");
    for (const [k, v] of Object.entries(x.ratio)) L.push(`| ${k} | ${v.min} | ${v.p50} |`);
    L.push("");
  }
  L.push("G6: point pr. sæson (alle ryttere på hold).");
  L.push("");
  L.push("| Variant | Point pr. sæson |");
  L.push("|---|---|");
  for (const r of shown) L.push(`| ${r.variant} | ${r.gates.pointsPerSeason.join(" · ")} |`);
  L.push("");
  L.push("G8 paritet: tick'et er en ren funktion af sit input (test i tenSeasonSim6110.test.mjs). Ugeprognosen findes ikke i XP endnu.");
  L.push("");
  if (gates?.x9) {
    L.push("## X9 Talentet (H6b): spilleren kender koden, ikke nøglen");
    L.push("");
    L.push("Fejl på det sande tal (p50) efter N datoer. Holdets eget skøn står øverst. Kravet er, at angrebet ikke er mere præcist end skønnet.");
    L.push("");
    const ns = Object.keys(gates.x9.estimate);
    L.push(`| Kilde | ${ns.map((n) => `${n} datoer`).join(" | ")} |`);
    L.push(`|---|${ns.map(() => "---").join("|")}|`);
    L.push(`| Skøn | ${ns.map((n) => gates.x9.estimate[n].p50 ?? "skjult").join(" | ")} |`);
    for (const [k, v] of Object.entries(gates.x9.attack)) L.push(`| ${k} | ${ns.map((n) => `${v[n].p50} (${v[n].exactPct} % præcis)`).join(" | ")} |`);
    L.push("");
  }
  L.push("## X10 Fokus: point pr. evne over hele kørslen");
  L.push("");
  L.push(`| Variant | ${VISIBLE_ABILITIES.join(" | ")} |`);
  L.push(`|---|${VISIBLE_ABILITIES.map(() => "---").join("|")}|`);
  for (const r of shown) L.push(`| ${r.variant} | ${VISIBLE_ABILITIES.map((a) => r.gates.abilityPoints[a] ?? 0).join(" | ")} |`);
  L.push("");
  if (xpRuns.some((r) => r.variant.includes("bonus"))) {
    L.push("## Træn nu (#7801): halvdelen af managerholdene trykker hver dato");
    L.push("");
    L.push("Holdene er delt tilfældigt, så de to grupper ikke starter ens. Fordelen er derfor forskellen mellem grupperne minus samme forskel i xp uden bonus.");
    L.push("");
    L.push("| Variant | Trykker: snit, p50 / p90 / max | Trykker ikke | Fordel i ratingsnit ved slut |");
    L.push("|---|---|---|---|");
    const base = xpRuns.find((r) => r.variant === "xp")?.gates.trainNow;
    const gap = (t) => (t.aktive.mean ?? 0) - (t.passive.mean ?? 0);
    for (const r of xpRuns.filter((x) => x.variant === "xp" || x.variant.includes("bonus"))) {
      const t = r.gates.trainNow;
      L.push(`| ${r.variant} | ${t.aktive.mean}, ${fmtStats(t.aktive)} | ${t.passive.mean}, ${fmtStats(t.passive)} | ${base ? round(gap(t) - gap(base), 2) : "-"} |`);
    }
    L.push("");
  }
  L.push("## Kalibrering: point i første sæson efter alder og potentiale (p50 / p90 / max (n))");
  L.push("");
  L.push("| Variant | Alder | Pot 1 | Pot 2 | Pot 3 | Pot 4 | Pot 5 | Pot 6 |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const r of shown) {
    for (const [band, byPot] of Object.entries(r.gates.firstSeason.byAgeAndPotential)) L.push(`| ${r.variant} | ${band} | ${pots.map((p) => fmtStats(byPot[p])).join(" | ")} |`);
  }
  L.push("");
  if (gates?.truth) {
    L.push("## Det nye sande tal (§6): forventet topniveau");
    L.push("");
    L.push(`Ryttere ${gates.truth.riders}, over nuværende rating ${gates.truth.aboveRatingAtStart}.`);
    L.push("");
    L.push("| Potentiale | p50 / p90 / max (n) |");
    L.push("|---|---|");
    for (const [k, v] of Object.entries(gates.truth.byPotential).sort(([a], [b]) => Number(a) - Number(b))) L.push(`| ${k} | ${fmtStats(v)} |`);
    L.push("");
  }
  if (gates?.h) {
    const h = gates.h;
    L.push("## H1, H2, H3, H6 mod det nye sande tal");
    L.push("");
    L.push("| Gruppe | Ord | n | p50 | p90 | Inden for ±5 (%) |");
    L.push("|---|---|---|---|---|---|");
    for (const [g, words] of Object.entries(h.h1)) for (const [w, v] of Object.entries(words)) L.push(`| ${g} | ${w} | ${v.n} | ${v.p50} | ${v.p90} | ${v.within5} |`);
    L.push("");
    L.push(`H2: ${h.h2Unstable} ustabile. H3: ${Object.entries(h.h3).map(([k, v]) => `${k} ${v.join(" > ")}`).join(" · ")}; ${h.h3MeanBreaks} brud.`);
    L.push(`H6: ${Object.entries(h.h6).filter(([k]) => k.startsWith("hold")).map(([k, v]) => `${k} ${v.p50}/${v.p90}`).join(" · ")}. To niveauer: angreb ${h.h6.toNiveauer.angrebP50} mod bedste enkelt-skøn ${h.h6.toNiveauer.bedsteP50}.`);
    L.push("H4 og H5 kræver fladerne (trin 4-6) og er ikke målt.");
    L.push("");
  }
  L.push("## Hvad dette IKKE dækker");
  L.push("- Ingen løbsmotor, form, skader, transfers eller akademi. Rollerne på løbsdagen er en antagelse (privat fordeling), ikke målt.");
  L.push("- Løbsandelen er målt efter alder, ikke pr. rytter, når billedet er fra før sæsonens første løb.");
  L.push("- Assistenten træner normal intensitet. xp_hard er den øvre grænse, ikke en rigtig manager.");
  L.push("- Træn nu: at halvdelen af holdene trykker hver dato er en scene, ikke målt adfærd.");
  return L.join("\n") + "\n";
}

const verdictText = (c) => (c.verdict === true ? "holder" : c.verdict === false ? "holder IKKE" : c.reason ?? "-");
const histText = (h) => (h ? ["1", "2", "3+"].map((b) => `${b}: ${h[b] ?? 0}`).join(" · ") : "-");

/**
 * Kortet for kørslen på motorens pakke (#7757): de to faste krav, intet dagsloft,
 * kohorten af nye ryttere og X6's første uge. PRIVAT, alle tal står her og kun her.
 */
export function renderMotorpakke(snapshot, results, cohorts, opts, date) {
  const L = [];
  const curveB = results.find((r) => r.variant === "kurveB") ?? null;
  const cohortB = cohorts.find((r) => r.variant === "kurveB") ?? null;
  const xpNames = [...new Set([...results, ...cohorts].map((r) => r.variant).filter((v) => v.startsWith("xp")))].sort();
  const req = opts.requirements ?? null;
  L.push(`# #6110/#7757 Kørslen på motorens pakke (${date}) · PRIVAT (hard rule 17)`);
  L.push("");
  L.push(`Billede: sæson ${snapshot.season.number}, ${snapshot.takenAt}. Verden: ${opts.seasons} sæsoner. Kohorte: ${opts.cohortPerTeam ?? SIM_DEFAULTS.cohortPerTeam} nye ryttere pr. aktivt hold fra ${opts.cohortStartAge ?? SIM_DEFAULTS.cohortStartAge} til ${opts.cohortEndAge ?? SIM_DEFAULTS.cohortEndAge} år, ingen erstatninger.`);
  L.push(`Motorens funktioner: ${engineHooks(opts).source}. Dagsvariation ±${opts.xpVariationSpan}, hukommelse ${opts.xpVariationMemory ?? 0}.`);
  L.push("");
  L.push("## De to faste krav");
  L.push("");
  L.push(req
    ? `Inflation: højst ${req.inflation.maxExtraPct} % ekstra købte evnepoint i sæson ${req.inflation.season} mod kurve B. Top-tab: højst ${req.topLoss.maxBelow ?? "-"} ryttere${req.topLoss.maxBelowPct != null ? ` / ${req.topLoss.maxBelowPct} %` : ""} af kohorten under egen kurve B-karrieretop.`
    : "Grænserne mangler i den private fil (sim.requirements). Målingerne står, dommen gør ikke.");
  L.push("");
  L.push("| Variant | Inflation: XP / kurve B (ekstra %) | Inflation | Top-tab: under / n (%) | Tab p50 / p90 / max | Top-tab |");
  L.push("|---|---|---|---|---|---|");
  for (const name of xpNames) {
    const world = results.find((r) => r.variant === name);
    const coh = cohorts.find((r) => r.variant === name);
    const inf = world && curveB ? inflationCheck(world, curveB, req) : null;
    const top = coh && cohortB ? topLossCheck(coh, cohortB, req) : null;
    const infText = inf?.xp != null ? `${inf.xp} / ${inf.curveB} (${inf.extraPct})` : "-";
    const topText = top ? `${top.below} / ${top.n} (${top.belowPct})` : "-";
    L.push(`| ${name} | ${infText} | ${inf ? verdictText(inf) : "kurve B mangler i verdenen"} | ${topText} | ${top ? fmtStats(top.loss) : "-"} | ${top ? verdictText(top) : "kurve B mangler i kohorten"} |`);
  }
  L.push("");
  if (curveB) {
    L.push("### Ekstra købte evnepoint mod kurve B pr. sæson (%)");
    L.push("");
    for (const name of xpNames) {
      const world = results.find((r) => r.variant === name);
      if (world) L.push(`- ${name}: ${inflationCheck(world, curveB, req).perSeason.join(" · ")}`);
    }
    L.push("");
  }
  L.push("## Intet dagsloft (#7739): stigning pr. evne pr. dato (ejervalg 12/11: normalt 1, sjældent 2, aldrig 3+)");
  L.push("");
  L.push("| Variant | Kilde | Alle | Første uge | Løbsdato | Træningsdato | Største |");
  L.push("|---|---|---|---|---|---|---|");
  const histRows = [...results.map((r) => ["verden", r]), ...cohorts.map((r) => ["kohorte", r])].filter(([, r]) => r.dateGains);
  for (const [src, r] of histRows) {
    const h = r.dateGains;
    L.push(`| ${r.variant} | ${src} | ${histText(h.all)} | ${histText(h.firstWeek)} | ${histText(h.raceDate)} | ${histText(h.trainingDate)} | ${h.max} |`);
  }
  L.push("");
  L.push("| Variant | Kilde | Alder | 1 / 2 / 3+ |");
  L.push("|---|---|---|---|");
  for (const [src, r] of histRows) for (const [band, h] of Object.entries(r.dateGains.byAge).sort()) L.push(`| ${r.variant} | ${src} | ${band} | ${histText(h)} |`);
  L.push("");
  L.push("| Variant | Kilde | Potentiale | 1 / 2 / 3+ |");
  L.push("|---|---|---|---|");
  for (const [src, r] of histRows) for (const [pot, h] of Object.entries(r.dateGains.byPotential).sort()) L.push(`| ${r.variant} | ${src} | ${pot} | ${histText(h)} |`);
  L.push("");
  L.push("## X6 første uge i verdenen (point pr. rytter, p50 / p90 / max (n))");
  L.push("");
  L.push("| Variant | Uge 1 | Uge 2 | Brud på dagsloftet |");
  L.push("|---|---|---|---|");
  for (const r of results.filter((x) => x.gates)) L.push(`| ${r.variant} | ${fmtStats(r.gates.firstSeason.week1)} | ${fmtStats(r.gates.firstSeason.week2)} | ${r.gates.capViolations} |`);
  L.push("");
  if (cohorts.length) {
    L.push("## Kohorten: X1 milepæle (mål ca. 60 % ved 22, ca. 85 % ved 25, top 27-28)");
    L.push("");
    L.push("| Variant | Gruppe | N | % ved 22 | % ved 25 | Topalder | Top 27-28 (%) | Top ≤ 24 (%) | Top-rating |");
    L.push("|---|---|---|---|---|---|---|---|---|");
    for (const r of cohorts) for (const [g, m] of Object.entries(r.milestones).sort()) L.push(`| ${r.variant} | ${g} | ${m.n} | ${m.pct22} | ${m.pct25} | ${m.peakAgeMedian} | ${m.peakAt27to28} | ${m.peakAtOrBefore24} | ${m.peakMedian} |`);
    L.push("");
    L.push("## Kohorten: karrieretop efter potentiale (p50 / p90 / max (n))");
    L.push("");
    const pots = [1, 2, 3, 4, 5, 6];
    L.push(`| Variant | ${pots.map((p) => `Pot ${p}`).join(" | ")} |`);
    L.push(`|---|${pots.map(() => "---").join("|")}|`);
    for (const r of cohorts) L.push(`| ${r.variant} | ${pots.map((p) => fmtStats(r.peakByPotential[p])).join(" | ")} |`);
    L.push("");
    L.push("## Kohorten pr. alder (hoppet ved 19 til 20 år skal ses)");
    L.push("");
    L.push("| Variant | Alder | N | Rating snit | P50 | P90 | Max | Købte point | Løbsdage | Pensioneret efter sæsonen |");
    L.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const r of cohorts) {
      for (const [age, a] of Object.entries(r.byAge).sort(([x], [y]) => Number(x) - Number(y))) {
        L.push(`| ${r.variant} | ${age} | ${a.n} | ${a.rating.mean} | ${a.rating.p50} | ${a.rating.p90} | ${a.rating.max} | ${a.pointsMean} | ${a.raceDaysMean} | ${r.retiredAt[age] ?? 0} |`);
      }
    }
    L.push("");
  }
  L.push("## Hvad dette IKKE dækker");
  L.push("- Ingen løbsmotor, form, skader, transfers eller akademi. Rollerne på løbsdagen er en antagelse.");
  L.push("- Kohorten er produktionens generator på billedets hold; den møder ingen konkurrence om pladser og bliver ikke solgt.");
  L.push(`- Motorens funktioner: ${engineHooks(opts).source}. Er kilden lokal, er tallene en gengivelse, ikke motorens egen kode.`);
  L.push("- Kurve B er sammenligningen i begge krav; varianter uden kurve B i samme kørsel får ingen dom.");
  return L.join("\n") + "\n";
}

/** X7 særskilt (spec §8): mentale evner mod fysiske i verdenen og i kohorten. Taktik for sig. */
export function renderX7(snapshot, results, cohorts, opts, date) {
  const L = [];
  const mental = [...MENTAL_ABILITIES];
  const physical = VISIBLE_ABILITIES.filter((a) => abilityMeta(a)?.category === "physical");
  L.push(`# #6110 X7 Mentale evner (${date}) · PRIVAT (hard rule 17)`);
  L.push("");
  L.push(`Billede: sæson ${snapshot.season.number}, ${snapshot.takenAt}. Krav: mentale evner vokser længere end de fysiske, men ingen mental evne løber fra dem. Taktik vurderes særskilt.`);
  L.push("");
  L.push("## Verdenen ved slut: ryttere 30+ (p50 / p90 / max (n))");
  L.push("");
  L.push(`| Variant | ${[...mental, ...physical].join(" | ")} | Mental bedst af 30+ |`);
  L.push(`|---|${[...mental, ...physical].map(() => "---").join("|")}|---|`);
  for (const r of results.filter((x) => x.gates)) {
    const e = r.gates.abilityEnd.senior30;
    L.push(`| ${r.variant} | ${[...mental, ...physical].map((a) => fmtStats(e[a])).join(" | ")} | ${r.gates.mentalOverPhysical.mentalBest} / ${r.gates.mentalOverPhysical.seniors} |`);
  }
  L.push("");
  L.push("## Verdenen: købte point pr. evne over hele kørslen");
  L.push("");
  L.push(`| Variant | ${[...mental, ...physical].join(" | ")} |`);
  L.push(`|---|${[...mental, ...physical].map(() => "---").join("|")}|`);
  for (const r of results.filter((x) => x.gates)) L.push(`| ${r.variant} | ${[...mental, ...physical].map((a) => r.gates.abilityPoints[a] ?? 0).join(" | ")} |`);
  L.push("");
  if (cohorts.length) {
    L.push("## Kohorten pr. alder: snit af mentale og fysiske evner, taktik for sig");
    L.push("");
    L.push("| Variant | Alder | N | Mentale (snit) | Fysiske (snit) | Taktik | Mentale point | Alle point | Mental bedst |");
    L.push("|---|---|---|---|---|---|---|---|---|");
    for (const r of cohorts) {
      for (const [age, a] of Object.entries(r.byAge).sort(([x], [y]) => Number(x) - Number(y))) {
        L.push(`| ${r.variant} | ${age} | ${a.n} | ${a.mentalMean} | ${a.physicalMean} | ${a.tacticsMean} | ${a.mentalPointsMean} | ${a.pointsMean} | ${a.mentalBest} |`);
      }
    }
    L.push("");
  }
  return L.join("\n") + "\n";
}

/** Output må kun lande i den private mappe (balance-internals/6110, gitignoreret). */
export function assertPrivateOutDir(dir) {
  const parts = resolve(dir).split(/[\\/]+/).map((p) => p.toLowerCase());
  const i = parts.indexOf("balance-internals");
  if (i < 0 || parts[i + 1] !== "6110") {
    throw new Error(`--out-dir skal ligge under balance-internals/6110 (privat, hard rule 17): ${dir}`);
  }
  return resolve(dir);
}

function parseArgs(argv) {
  const opts = { ...SIM_DEFAULTS };
  const get = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (get("--seasons")) opts.seasons = Number(get("--seasons"));
  if (get("--race-days")) opts.raceDaysPerSeason = Number(get("--race-days"));
  if (get("--b-scales")) opts.bScales = get("--b-scales").split(",").map(Number).filter(Number.isFinite);
  if (get("--variants")) opts.variants = get("--variants").split(",");
  if (get("--b-noise")) opts.bNoiseSpan = Number(get("--b-noise"));
  if (get("--b-ref-age")) opts.bReferenceAge = Number(get("--b-ref-age"));
  if (get("--gate-variant")) opts.xpGateVariant = get("--gate-variant");
  if (get("--cohort-per-team")) opts.cohortPerTeam = Number(get("--cohort-per-team"));
  const cohortOnly = argv.includes("--cohort-only");
  return {
    opts, snapshotPath: get("--snapshot"), outDir: get("--out-dir"), limitTeams: Number(get("--limit-teams")) || null,
    cohort: cohortOnly || argv.includes("--cohort"), world: !cohortOnly,
  };
}

/** Til hurtige prøvekørsler: kun de første N aktive hold (og deres ryttere). */
export function limitSnapshotTeams(snapshot, n) {
  const keep = new Set(snapshot.teams.filter((t) => !t.is_bank && !t.is_test_account).slice(0, n).map((t) => t.id));
  const riders = snapshot.riders.filter((r) => keep.has(r.team_id));
  const ids = new Set(riders.map((r) => r.id));
  return { ...snapshot, teams: snapshot.teams.filter((t) => keep.has(t.id)), riders, abilities: snapshot.abilities.filter((a) => ids.has(a.rider_id)) };
}

async function main() {
  const { opts, snapshotPath, outDir: outArg, limitTeams, cohort, world: runWorld } = parseArgs(process.argv.slice(2));
  const date = new Date().toISOString().slice(0, 10);
  const outDir = assertPrivateOutDir(outArg ? resolve(outArg) : join(REPO, "balance-internals", "6110", "s25"));
  mkdirSync(outDir, { recursive: true });
  let snapshot;
  if (snapshotPath) {
    snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  } else {
    snapshot = await loadProdSnapshot();
    writeFileSync(join(outDir, `snapshot-${date}.json`), JSON.stringify(snapshot) + "\n");
    console.log(`[s25] øjebliksbillede gemt privat: ${join(outDir, `snapshot-${date}.json`)}`);
  }
  if (limitTeams) snapshot = limitSnapshotTeams(snapshot, limitTeams);
  // Hard rule 17: B-normaliseringen hentes fra den private fil (gitignoreret).
  const privateNorm = await import(pathToFileURL(join(REPO, ...PRIVATE_B_NORMALIZER_PATH)).href).catch(() => null);
  if (typeof privateNorm?.bNormalizer === "function") opts.bNormalizer = privateNorm.bNormalizer;
  // #3564: kurve B's private params (developmentCurveBHarness3564.loadPrivateParams).
  if (opts.variants.includes("kurveB")) opts.curveB = (await import("./developmentCurveBHarness3564.mjs").then((m) => m.loadPrivateParams())).curveB;
  // #6110: XP-modellens private tal og kørslens målte antagelser.
  const wantsXp = opts.variants.some((v) => v.startsWith("xp")) || process.argv.includes("--xp-gates");
  const privateXp = wantsXp || opts.variants.includes("kurveB")
    ? await import(pathToFileURL(join(REPO, ...PRIVATE_XP_PATH)).href).then((m) => m.XP_PRIVATE).catch(() => null)
    : null;
  if (privateXp) applyPrivateXp(opts, privateXp);
  // Uden B-proxy i kørslen bruges normaliseringen ikke; den private fil er så ikke nødvendig.
  if (!opts.bNormalizer && !variantList(opts).some((v) => v.kind === "B")) opts.bNormalizer = () => null;
  // Hver variant gemmes for sig i runs-<dato>/, og kortet bygges af ALLE varianter
  // dér. Så kan varianterne køres i hver sin proces (ca. 8 min pr. stk.) og ende
  // på ét kort.
  const suffix = limitTeams ? `-hold${limitTeams}` : "";
  const runsDir = join(outDir, `runs-${date}${suffix}`);
  mkdirSync(runsDir, { recursive: true });
  for (const variant of process.argv.includes("--render-only") ? [] : variantList(opts)) {
    if (runWorld) {
      const t0 = Date.now();
      const result = runVariant(snapshot, variant, opts);
      writeFileSync(join(runsDir, `${variant.name}.json`), JSON.stringify(result, null, 2) + "\n");
      console.log(`[s25] ${variant.name} færdig (${Math.round((Date.now() - t0) / 1000)} s)`);
    }
    // #7757: kohorten af nye ryttere ved siden af verdenen.
    if (cohort) {
      const t0 = Date.now();
      writeFileSync(join(runsDir, `${COHORT_PREFIX}${variant.name}.json`), JSON.stringify(runCohort(snapshot, variant, opts), null, 2) + "\n");
      console.log(`[s25] kohorte ${variant.name} færdig (${Math.round((Date.now() - t0) / 1000)} s)`);
    }
  }
  // Kun kørsler på samme billede og samme sæson-parametre kommer på samme kort.
  const fingerprint = runFingerprint(snapshot, opts);
  const files = readdirSync(runsDir).filter((f) => f.endsWith(".json"));
  const all = files.filter((f) => !f.startsWith(COHORT_PREFIX)).map((f) => JSON.parse(readFileSync(join(runsDir, f), "utf8")));
  const cohortFiles = files.filter((f) => f.startsWith(COHORT_PREFIX)).map((f) => JSON.parse(readFileSync(join(runsDir, f), "utf8")));
  // Samme regel for XP: en kørsel med gamle tal kommer aldrig på kortet sammen med nye.
  const sameXp = (r) => {
    if (!r.variant.startsWith("xp")) return true;
    const variant = xpVariant(r.variant, opts);
    return JSON.stringify(r.params?.xp ?? null) === JSON.stringify(variant.xpParams)
      && JSON.stringify(r.params?.xpRun ?? null) === JSON.stringify(xpRunInputs(variant, opts));
  };
  const fits = (r) => r.fingerprint === fingerprint && sameCurveBRun(r, opts) && sameXp(r);
  const results = orderResults(all.filter(fits));
  const skipped = all.filter((r) => !fits(r)).map((r) => r.variant);
  if (skipped.length) console.warn(`[s25] springer varianter over fra et andet billede eller andre parametre: ${skipped.join(", ")}`);
  writeFileSync(join(outDir, `ten-season-sim-${date}${suffix}.md`), renderCard(snapshot, results, opts, date));
  writeFileSync(join(outDir, `ten-season-sim-${date}${suffix}.json`), JSON.stringify({ date, opts, results }, null, 2) + "\n");
  console.log(`[s25] privat kort (${results.length} varianter): ${join(outDir, `ten-season-sim-${date}${suffix}.md`)}`);
  // #7757: de to faste krav, intet dagsloft, kohorten og X7 særskilt. Kun samme kohorte og samme tal.
  const cohortPrint = cohortFingerprint(snapshot, opts);
  const cohorts = orderResults(cohortFiles.filter((r) => r.fingerprint === cohortPrint && sameCurveBRun(r, opts) && sameXp(r)));
  if (cohorts.length || opts.requirements) {
    writeFileSync(join(outDir, `xp-motorpakke-${date}${suffix}.md`), renderMotorpakke(snapshot, results, cohorts, opts, date));
    writeFileSync(join(outDir, `x7-mentale-${date}${suffix}.md`), renderX7(snapshot, results, cohorts, opts, date));
    console.log(`[s25] privat motorpakke-kort og X7: ${join(outDir, `xp-motorpakke-${date}${suffix}.md`)}`);
  }
  if (wantsXp) {
    const gateTag = opts.xpGateVariant ? `-${opts.xpGateVariant}` : "";
    const gatesFile = join(outDir, `xp-gates-${date}${suffix}${gateTag}.json`);
    // Gemte gates bruges kun, hvis de er regnet på samme billede og samme input.
    const readPrivate = (path) => (path ? JSON.parse(readFileSync(join(REPO, path), "utf8")) : null);
    const estimateParams = readPrivate(opts.estimateParamsPath);
    const knowledge = readPrivate(opts.knowledgePath);
    const gateKey = xpGateKey({ fingerprint, opts, estimateParams, knowledge });
    const stored = existsSync(gatesFile) ? JSON.parse(readFileSync(gatesFile, "utf8")) : null;
    let gates = stored?.gateKey === gateKey ? stored : null;
    if (process.argv.includes("--xp-gates")) {
      const t0 = Date.now();
      gates = { gateKey, ...runXpGates(snapshot, opts, { estimateParams, knowledge }) };
      writeFileSync(gatesFile, JSON.stringify(gates, null, 2) + "\n");
      console.log(`[s25] gates uden for sæsonløkken færdig (${Math.round((Date.now() - t0) / 1000)} s)`);
    }
    writeFileSync(join(outDir, `xp-gates-${date}${suffix}${gateTag}.md`), renderXpGates(snapshot, results, gates, opts, date));
    console.log(`[s25] privat XP-kort: ${join(outDir, `xp-gates-${date}${suffix}${gateTag}.md`)}`);
  }
}

/** Lægger de private tal på kørslens opts. Kører kun lokalt, tallene kommer aldrig i repoet. */
export function applyPrivateXp(opts, priv) {
  opts.xp = priv.xp;
  opts.xpVariants = priv.variants ?? {};
  opts.xpVariationSpan = priv.sim?.variationSpan ?? opts.xpVariationSpan;
  const memory = priv.sim?.variationMemory ?? opts.xpVariationMemory ?? 0;
  if (!(memory >= 0 && memory < 1)) throw new Error("Private params: hukommelsen i dagsvariationen skal ligge i [0, 1)");
  opts.xpVariationMemory = memory;
  // #7757: de to faste krav. Grænserne står kun i den private fil.
  opts.requirements = validateRequirements(priv.sim?.requirements ?? null);
  opts.xpAttackSpans = priv.sim?.attackSpans ?? null;
  opts.xpAttackMemories = priv.sim?.attackMemories ?? null;
  opts.raceShareByAge = priv.sim?.raceShareByAge ?? null;
  opts.raceRoles = priv.sim?.raceRoles ?? null;
  opts.raceRoleYield = priv.sim?.raceRoleYield ?? null;
  opts.estimateParamsPath = priv.sim?.estimateParamsPath ?? null;
  opts.knowledgePath = priv.sim?.knowledgePath ?? null;
  if (priv.sim?.curveBLive) {
    const live = validateDevelopmentCurveBParams(priv.sim.curveBLive);
    if (!live) throw new Error("Private kurve B-params til sammenligningen er ugyldige");
    opts.curveB = live;
  }
  return opts;
}

/**
 * Fingeraftryk for en kørsel: samme billede og samme sæson-parametre. B's egne
 * parametre (støj, referencealder) står pr. variant i `params` og på kortet.
 */
export function runFingerprint(snapshot, opts) {
  return [snapshot?.takenAt ?? "?", snapshot?.season?.number ?? "?", snapshot?.riders?.length ?? 0,
    opts.seasons, opts.raceDaysPerSeason, opts.raceDaysPerDate,
    ...(opts.raceShareByAge ? [JSON.stringify(opts.raceShareByAge)] : [])].join("|");
}

/** Fast rækkefølge på kortet: nu, nu_maks1, B efter stigende skala, kurve B, derefter XP efter navn. */
export function orderResults(results) {
  const rank = (name) => (name === "nu" ? -2 : name === "nu_maks1" ? -1 : name === "kurveB" ? 100 : name.startsWith("xp") ? 101 : Number(name.split("@")[1]) || 0);
  return [...results].sort((a, b) => rank(a.variant) - rank(b.variant) || a.variant.localeCompare(b.variant));
}

const isMain = process.argv[1]
  && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isMain) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
