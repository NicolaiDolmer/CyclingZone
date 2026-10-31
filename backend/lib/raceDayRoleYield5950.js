// #5950 / #6110 · Loebsdag = haard dag + tillaeg i etapens evner, vaegtet efter rolle.
//
// Ejer-beslutning 3/10 (#5950), D2 + D3 (11/10, #6110), S17 + S21 (23/10) og privat
// baand 31/10:
//   1. Basis = en HAARD dag paa etapens profil-evner (RACE_PROFILE_ABILITY_MAP), koert
//      gennem den samme applyDailyTick som en traeningsdag. Ingen ny formel.
//   2. Oven i basis kommer et TILLAEG. Alle roller faar det samme tillaeg i alt
//      (D3 variant A: ingen straf for at hjaelpe holdet); rollen afgoer kun HVOR det
//      lander:
//        · kaptajn, sprintkaptajn, delt kaptajn, jaeger: mest i etapens afgoerende
//          evne (flad = spurt, bjerg = klatring ...), resten i de oevrige profil-evner
//          plus lederskab (kaptajner) eller aggression (jaegeren)
//        · hjaelper, luksushjaelper: mest i de baerende hjaelpe-evner (holdarbejde,
//          tempo, udholdenhed ...), lidt i etapens profil-evner
//        · fri rolle (og ukendt rolle): halvt som kaptajn, halvt som hjaelper (S17)
//   3. Maks +1 pr. evne pr. loebsdag er uaendret (kaldstedet sender stadig
//      hardDailyCap). Gaelder senior, U23 og junior ens.
//
// TALLENE ER PRIVATE (hard rule 17). Tillaeggets stoerrelse og fordelingen mellem
// "mest" og "resten" ligger i den lukkede tabel private_config under
// `race_day_role_yield_params` (reserve: miljoe-variablen RACE_DAY_ROLE_YIELD_PARAMS).
// Flag on + manglende eller ugyldige params = dagens model, med en vaerdi-fri
// advarsel. Flag off = intet opslag, og motoren er bit-identisk med i dag.
//
// TILLAEGGET ER ADDITIVT I "HAARD-DAGS-ENHEDER": evnen faar sin basis-andel (fokus
// eller off-fokus som paa en haard dag) PLUS bonus x vaegt x haard-dagens fokus-
// multiplikator. Det udtrykkes som en multiplikator pr. evne (abilityYieldMult), saa
// basis-programmet og traeningsscoren er praecis en haard dags.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { readConditionWriterFlag } from "./trainingDateConditionFlag.js";
import { readPrivateConfigEntry } from "./privateConfig.ts";
import { abilityMult, RACE_PROFILE_ABILITY_MAP } from "./dailyTraining.js";
import { TRAINING_CONFIG } from "./training.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { raceDayFocusAbilities, RACE_DAY_FALLBACK_PROFILE, RACE_DAY_FOCUS } from "./raceDayYield.js";

export const RACE_DAY_ROLE_YIELD_FLAG_KEY = "race_day_role_yield_enabled";
export const RACE_DAY_ROLE_YIELD_PARAMS_KEY = "race_day_role_yield_params";
export const RACE_DAY_ROLE_YIELD_PARAMS_ENV = "RACE_DAY_ROLE_YIELD_PARAMS";
const LOG_TAG = "[race-day-role-yield]";

// Basis-intensiteten (ejer 3/10: "hård dag").
export const RACE_DAY_ROLE_BASE_INTENSITY = "hard";

// Rollegrupper. Ukendt eller manglende rolle = fri (balanceret).
export const ROLE_GROUP = Object.freeze({
  captain: "leader",
  sprint_captain: "leader",
  co_captain: "leader",
  hunter: "hunter",
  helper: "helper",
  luxury_helper: "helper",
  free_role: "free",
});

/** Rollens gruppe (leader | hunter | helper | free). */
export function raceDayRoleGroup(role) {
  return ROLE_GROUP[role] ?? "free";
}

// Etapens afgoerende evne pr. profil (den kaptajnen og jaegeren faar mest i).
export const DECISIVE_ABILITY_BY_PROFILE = Object.freeze({
  flat: "sprint",
  rolling: "punch",
  hilly: "punch",
  classic: "punch",
  cobbles: "cobblestone",
  gravel: "cobblestone",
  mountain: "climbing",
  high_mountain: "climbing",
  itt: "time_trial",
  itt_hilly: "time_trial",
  ttt: "time_trial",
});

// De baerende hjaelpe-evner pr. profil (hjaelperen faar mest i dem). Holdarbejde er
// altid med (S21: holdarbejde udvikles gennem loeb som hjaelper).
export const HELPER_ABILITIES_BY_PROFILE = Object.freeze({
  flat: Object.freeze(["teamwork", "tempo", "flat"]),
  rolling: Object.freeze(["teamwork", "tempo", "endurance"]),
  hilly: Object.freeze(["teamwork", "tempo", "endurance"]),
  classic: Object.freeze(["teamwork", "positioning", "endurance"]),
  cobbles: Object.freeze(["teamwork", "positioning", "durability"]),
  gravel: Object.freeze(["teamwork", "endurance", "durability"]),
  mountain: Object.freeze(["teamwork", "tempo", "endurance"]),
  high_mountain: Object.freeze(["teamwork", "tempo", "endurance"]),
  itt: Object.freeze(["teamwork", "tempo", "endurance"]),
  itt_hilly: Object.freeze(["teamwork", "tempo", "endurance"]),
  ttt: Object.freeze(["teamwork", "time_trial", "tempo"]),
});

function knownProfile(profileType) {
  return Object.hasOwn(RACE_PROFILE_ABILITY_MAP, profileType ?? "") ? profileType : RACE_DAY_FALLBACK_PROFILE;
}

function uniq(list) {
  return [...new Set(list)].filter((a) => VISIBLE_ABILITIES.includes(a));
}

/**
 * Hvor rollens tillaeg lander: `lead` (mest) og `support` (resten), disjunkte.
 * @returns {{ lead: string[], support: string[] }}
 */
export function raceDayRoleAbilityGroups(profileType, group) {
  const profile = knownProfile(profileType);
  const profileAbilities = [...raceDayFocusAbilities(profile)];
  if (group === "helper") {
    const lead = uniq(HELPER_ABILITIES_BY_PROFILE[profile] ?? HELPER_ABILITIES_BY_PROFILE[RACE_DAY_FALLBACK_PROFILE]);
    return { lead, support: uniq(profileAbilities.filter((a) => !lead.includes(a))) };
  }
  const decisive = DECISIVE_ABILITY_BY_PROFILE[profile] ?? profileAbilities[0];
  const lead = uniq([decisive]);
  const extra = group === "hunter" ? "aggression" : "leadership";
  return { lead, support: uniq([...profileAbilities, extra].filter((a) => !lead.includes(a))) };
}

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Validerer de private params. Ugyldigt = null (fail-safe: dagens model).
 *   stageBonus  tillaegget i haard-dags-enheder pr. profil-evne (>= 0)
 *   leadShare   andelen af rollens tillaeg der lander i `lead`-evnerne (0-1]
 */
export function validateRaceDayRoleYieldParams(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { stageBonus, leadShare } = raw;
  if (!isFiniteNumber(stageBonus) || stageBonus < 0 || stageBonus > 5) return null;
  if (!isFiniteNumber(leadShare) || leadShare <= 0 || leadShare > 1) return null;
  return Object.freeze({ stageBonus, leadShare });
}

/** Parser params fra miljoeet (reserve). Ugyldig eller manglende = null. */
export function raceDayRoleYieldParamsFromEnv(env = process.env) {
  const raw = env?.[RACE_DAY_ROLE_YIELD_PARAMS_ENV];
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    return validateRaceDayRoleYieldParams(JSON.parse(raw));
  } catch { // best-effort: ugyldig JSON = null = dagens model (fail-safe), loaderen advarer
    return null;
  }
}

function parseParamsOrThrow(raw) {
  const params = validateRaceDayRoleYieldParams(raw);
  if (!params) throw new Error("opfylder ikke validateRaceDayRoleYieldParams");
  return params;
}

/**
 * Flaget. Kun "on" (eller true) taender; "beta" laeses som off (live balance-
 * aendring uden skyggedata). strict = dato-afregningens atomare sti: en fejlet
 * laesning kaster i stedet for at blive tolket som slukket.
 */
export async function isRaceDayRoleYieldEnabled(supabase, { strict = false } = {}) {
  if (strict) return readConditionWriterFlag(supabase, RACE_DAY_ROLE_YIELD_FLAG_KEY);
  return evaluateFlagStage(await readFlagStage(supabase, RACE_DAY_ROLE_YIELD_FLAG_KEY));
}

/**
 * Det motoren skal bruge i dag: params naar flaget er on og params er gyldige,
 * ellers null (dagens model, bit-identisk). Logger aldrig tallene.
 */
export async function loadRaceDayRoleYield({ supabase, env = process.env, log = console, strict = false } = {}) {
  if (!(await isRaceDayRoleYieldEnabled(supabase, { strict }))) return null;
  const entry = await readPrivateConfigEntry(supabase, RACE_DAY_ROLE_YIELD_PARAMS_KEY, {
    schema: parseParamsOrThrow, strict, log,
  });
  let params = entry.status === "ok" ? entry.value : null;
  if (!params && entry.status !== "invalid") params = raceDayRoleYieldParamsFromEnv(env);
  if (!params) {
    log?.warn?.(`${LOG_TAG} ${RACE_DAY_ROLE_YIELD_FLAG_KEY} is on, but ${RACE_DAY_ROLE_YIELD_PARAMS_KEY} is missing or invalid - running today's model`);
  }
  return params;
}

/** Loebsdagens basis-program: en haard dag paa etapens profil-evner. */
export function raceDayRoleBaseProgram(profileType) {
  return Object.freeze({
    focus: RACE_DAY_FOCUS,
    intensity: RACE_DAY_ROLE_BASE_INTENSITY,
    focusAbilities: raceDayFocusAbilities(knownProfile(profileType)),
  });
}

/**
 * Tillaeggets vaegt pr. evne for en gruppe. Summen er altid antallet af etapens
 * profil-evner, saa alle roller faar samme tillaeg i alt (D3 variant A).
 * @returns {Record<string, number>}
 */
export function raceDayRoleBonusWeights(profileType, role, leadShare) {
  const profile = knownProfile(profileType);
  const budget = raceDayFocusAbilities(profile).length;
  const groupWeights = (group) => {
    const { lead, support } = raceDayRoleAbilityGroups(profile, group);
    const out = {};
    const leadPart = support.length ? leadShare : 1;
    for (const a of lead) out[a] = (out[a] ?? 0) + (budget * leadPart) / lead.length;
    for (const a of support) out[a] = (out[a] ?? 0) + (budget * (1 - leadPart)) / support.length;
    return out;
  };
  const group = raceDayRoleGroup(role);
  if (group !== "free") return groupWeights(group);
  // S17: fri rolle = halvt som kaptajn, halvt som hjaelper.
  const a = groupWeights("leader");
  const b = groupWeights("helper");
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = ((a[k] ?? 0) + (b[k] ?? 0)) / 2;
  return out;
}

/**
 * Multiplikatoren pr. evne paa basis-dagens delta, saa evnen faar basis + bonus x
 * vaegt x haard-dagens fokus-multiplikator (additivt i haard-dags-enheder).
 * @returns {Record<string, number>}
 */
export function raceDayRoleYieldMultipliers({ params, profileType, role, program = raceDayRoleBaseProgram(profileType), trainingCfg = TRAINING_CONFIG }) {
  if (!params) return {};
  const hardFocus = Number(trainingCfg.focusGrowthMult?.[RACE_DAY_ROLE_BASE_INTENSITY]);
  if (!Number.isFinite(hardFocus) || hardFocus <= 0) return {};
  const weights = raceDayRoleBonusWeights(profileType, role, params.leadShare);
  const out = {};
  for (const [ability, w] of Object.entries(weights)) {
    const baseMult = abilityMult(ability, program, trainingCfg);
    if (!(baseMult > 0) || !(w > 0)) continue;
    const mult = 1 + (params.stageBonus * w * hardFocus) / baseMult;
    if (mult !== 1) out[ability] = mult;
  }
  return out;
}

/**
 * Det ene kald motoren goer paa en loebsdag. Slukket (params null) = de ekstra
 * argumenter uaendret, saa kaldet er bit-identisk med i dag. Taendt = haard-dags-
 * programmet og rolle-tillaegget; et eksisterende abilityYieldMult (catch-up via
 * loeb) ganges sammen med rolle-tillaegget.
 */
export function withRaceDayRoleYield(extraTickArgs, { params = null, profileType = null, role = null } = {}) {
  if (!params) return extraTickArgs;
  const program = raceDayRoleBaseProgram(profileType);
  const roleMult = raceDayRoleYieldMultipliers({ params, profileType, role, program });
  const prior = extraTickArgs?.abilityYieldMult ?? null;
  const abilityYieldMult = { ...roleMult };
  for (const [ability, m] of Object.entries(prior ?? {})) {
    if (!(m > 0)) continue;
    abilityYieldMult[ability] = (abilityYieldMult[ability] ?? 1) * m;
  }
  return { ...extraTickArgs, program, abilityYieldMult };
}

/**
 * Ren sammenkobling: rytter -> hans rolle paa dagens etape. Etape-raekken
 * (race_stage_roles.race_role) vinder over basisrollen (race_entries.race_role),
 * samme fallback-kaede som loebsmotoren (raceStageRoles.resolveStageEntrant).
 * @param {Map<string, {raceId: string, stageNumber: number}>} stageByRider
 * @returns {Map<string, string>}
 */
export function raceDayRoleByRider(stageByRider, entryRows = [], stageRoleRows = []) {
  const out = new Map();
  for (const row of entryRows ?? []) {
    const stage = stageByRider?.get(row?.rider_id);
    if (!stage || !row.race_role || stage.raceId !== row.race_id) continue;
    out.set(row.rider_id, row.race_role);
  }
  for (const row of stageRoleRows ?? []) {
    const stage = stageByRider?.get(row?.rider_id);
    if (!stage || !row.race_role) continue;
    if (stage.raceId !== row.race_id || Number(stage.stageNumber) !== Number(row.stage_number)) continue;
    out.set(row.rider_id, row.race_role);
  }
  return out;
}

/**
 * Hent rollen pr. rytter for dagens etaper. BERIGELSE, ikke en regel-gate: en fejl
 * logges og giver et tomt kort (= fri rolle for alle, et balanceret tillaeg), saa
 * udbyttet aldrig bygger paa en halv kilde.
 */
export async function loadRaceDayRoleByRider({ supabase, stageByRider, log = console }) {
  const riderIds = [...(stageByRider?.keys() ?? [])];
  const raceIds = [...new Set([...(stageByRider?.values() ?? [])].map((s) => s.raceId).filter(Boolean))];
  if (!riderIds.length || !raceIds.length) return new Map();
  // pagination-safe: ét holds koerte ryttere x dagens loeb, UNIQUE (race_id, rider_id) - langt under 1000 raekker
  const entries = await supabase
    .from("race_entries")
    .select("race_id, rider_id, race_role")
    .in("race_id", raceIds)
    .in("rider_id", riderIds);
  if (entries.error) {
    log?.warn?.(`  ${LOG_TAG} race role lookup failed: ${entries.error.message ?? entries.error} - free role for all (fail-safe)`);
    return new Map();
  }
  const roles = await supabase
    .from("race_stage_roles")
    .select("race_id, stage_number, rider_id, race_role")
    .in("race_id", raceIds)
    .in("rider_id", riderIds);
  if (roles.error) {
    log?.warn?.(`  ${LOG_TAG} stage role lookup failed: ${roles.error.message ?? roles.error} - free role for all (fail-safe)`);
    return new Map();
  }
  return raceDayRoleByRider(stageByRider, entries.data ?? [], roles.data ?? []);
}
