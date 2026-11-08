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
//        · fri rolle (og ukendt rolle): en blanding af kaptajnens og hjaelperens (S17)
//   3. Maks +1 pr. evne pr. loebsdag er uaendret (kaldstedet sender stadig
//      hardDailyCap). Gaelder senior, U23 og junior ens.
//
// TALLENE OG DEN PRAECISE MODEL ER PRIVATE (hard rule 17). Tillaeggets stoerrelse og
// fordelingen ligger i den lukkede tabel private_config under
// `race_day_role_yield_params` (kun dér, ingen miljoe-reserve, #5950 foer taending);
// den matematiske beskrivelse ligger i balance-internals/5950 (OneDrive, ikke repoet).
// Flag on + manglende eller ugyldige params = dagens model, med en vaerdi-fri
// advarsel. Flag off = intet opslag, og motoren er bit-identisk med i dag.
//
// Tillaegget laegges oven paa haard-dagen som en multiplikator pr. evne
// (abilityYieldMult), saa basis-programmet og traeningsscoren er praecis en haard dags.
//
// #5950 loesning A (ejer 3/11), bag sin EGEN underkontakt race_day_role_base_day_enabled
// (default off, laeses kun naar hovedflaget er on og params er gyldige): rollen styrer
// ogsaa BASIS-dagen, ikke kun tillaegget.
//   · kaptajn/jaeger: uaendret (haard dag paa etapens profil-evner)
//   · hjaelper: haard dag paa de baerende hjaelpe-evner (HELPER_ABILITIES_BY_PROFILE);
//     etapens afgoerende evne faar hverken basis eller tillaeg (en hjaelper paa en
//     sprintetape udvikler ikke spurt), medmindre den selv er en hjaelpe-evne (holdtempo)
//   · fri rolle: en blanding af de to basis-dage
// Basis-dagens samlede vaegt er den samme for alle roller (ingen straf for at hjaelpe).
// Underkontakt off = ingen aendring overhovedet, bit-identisk med hovedflagets model.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { readConditionWriterFlag } from "./trainingDateConditionFlag.js";
import { readPrivateConfigEntry } from "./privateConfig.ts";
export { validateRaceDayRoleYieldParams } from "./raceDayRoleYieldParams.js";
import { abilityMult, RACE_PROFILE_ABILITY_MAP } from "./dailyTraining.js";
import { TRAINING_CONFIG } from "./training.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { raceDayFocusAbilities, RACE_DAY_FALLBACK_PROFILE, RACE_DAY_FOCUS } from "./raceDayYield.js";
import { resolveStageEntrants } from "./raceStageRoles.js";

export const RACE_DAY_ROLE_YIELD_FLAG_KEY = "race_day_role_yield_enabled";
export const RACE_DAY_ROLE_YIELD_PARAMS_KEY = "race_day_role_yield_params";
// #5950 A: underkontakten "rollen styrer ogsaa basis-dagen".
export const RACE_DAY_ROLE_BASE_DAY_FLAG_KEY = "race_day_role_base_day_enabled";
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

function helperAbilities(profile) {
  return uniq(HELPER_ABILITIES_BY_PROFILE[profile] ?? HELPER_ABILITIES_BY_PROFILE[RACE_DAY_FALLBACK_PROFILE]);
}

/**
 * Hvor rollens tillaeg lander: `lead` (mest) og `support` (resten), disjunkte.
 * roleDrivesBaseDay (#5950 A): hjaelperens support mister etapens afgoerende evne
 * (medmindre den er en hjaelpe-evne), saa hjaelperen ikke udvikler den.
 * @returns {{ lead: string[], support: string[] }}
 */
export function raceDayRoleAbilityGroups(profileType, group, { roleDrivesBaseDay = false } = {}) {
  const profile = knownProfile(profileType);
  const profileAbilities = [...raceDayFocusAbilities(profile)];
  if (group === "helper") {
    const lead = helperAbilities(profile);
    const decisive = DECISIVE_ABILITY_BY_PROFILE[profile];
    const support = profileAbilities.filter((a) => !lead.includes(a) && !(roleDrivesBaseDay && a === decisive));
    return { lead, support: uniq(support) };
  }
  const decisive = DECISIVE_ABILITY_BY_PROFILE[profile] ?? profileAbilities[0];
  const lead = uniq([decisive]);
  const extra = group === "hunter" ? "aggression" : "leadership";
  return { lead, support: uniq([...profileAbilities, extra].filter((a) => !lead.includes(a))) };
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
 * #5950 A: underkontakten "rollen styrer ogsaa basis-dagen". Samme regler som
 * hovedflaget: kun "on" taender, beta = off, strict kaster ved en fejlet laesning.
 */
export async function isRaceDayRoleBaseDayEnabled(supabase, { strict = false } = {}) {
  if (strict) return readConditionWriterFlag(supabase, RACE_DAY_ROLE_BASE_DAY_FLAG_KEY);
  return evaluateFlagStage(await readFlagStage(supabase, RACE_DAY_ROLE_BASE_DAY_FLAG_KEY));
}

/**
 * Det motoren skal bruge i dag: params naar flaget er on og params er gyldige,
 * ellers null (dagens model, bit-identisk). Logger aldrig tallene.
 *
 * strict (dato-afregningens atomare sti) gaelder KUN laesningerne: en fejlet
 * flag- eller databaselaesning kaster. En ugyldig params-raekke er en
 * konfigurationsfejl, ikke en laesefejl: den giver altid advarsel + dagens model,
 * ogsaa i strict, saa den aldrig stopper den almindelige traeningsafregning.
 */
export async function loadRaceDayRoleYield({ supabase, log = console, strict = false } = {}) {
  if (!(await isRaceDayRoleYieldEnabled(supabase, { strict }))) return null;
  const entry = await readPrivateConfigEntry(supabase, RACE_DAY_ROLE_YIELD_PARAMS_KEY, {
    strict: false, log,
  });
  if (entry.status === "error" && strict) {
    throw new Error(`${LOG_TAG} ${RACE_DAY_ROLE_YIELD_PARAMS_KEY} read failed (strict) - refusing to settle, retry on next sweep`);
  }
  const params = entry.status === "ok" ? entry.value : null;
  if (!params) {
    log?.warn?.(`${LOG_TAG} ${RACE_DAY_ROLE_YIELD_FLAG_KEY} is on, but ${RACE_DAY_ROLE_YIELD_PARAMS_KEY} is missing or invalid - running today's model`);
    return null;
  }
  // #5950 A: underkontakten laeses kun her (hovedflag on + gyldige params). Off =
  // params uaendret (samme objekt), saa alt nedstroems er bit-identisk.
  if (!(await isRaceDayRoleBaseDayEnabled(supabase, { strict }))) return params;
  return Object.freeze({ ...params, roleDrivesBaseDay: true });
}

/** Samme betingelse for "Score B on" som applyDailyTick (devMult endelig og ikke negativ). */
function scoreBDrivesTick(developmentScore) {
  const devMult = developmentScore?.devMult;
  return Number.isFinite(devMult) && devMult >= 0;
}

/**
 * Off-fokus-vaekst i enheder af en fokus-evnes vaekst (vaegt 1), PRAECIS som
 * applyDailyTick regner i den aktive tilstand:
 *   · Score B off: fokus = haard-multiplikatoren, off-fokus = offFocusMult.
 *   · Score B on: fokus-evner normaliseres (haard-multiplikatoren gaar ud) og ganges
 *     med devMult; off-fokus beholder offFocusMult og ganges med offFocusDevMult
 *     (eller devMult, naar den mangler).
 */
export function raceDayBaseOffRatio(trainingCfg = TRAINING_CONFIG, developmentScore = null) {
  const off = Number(trainingCfg.offFocusMult);
  if (!(Number.isFinite(off) && off >= 0)) return 0;
  if (scoreBDrivesTick(developmentScore)) {
    const devMult = developmentScore.devMult;
    const offDev = Number.isFinite(developmentScore.offFocusDevMult) && developmentScore.offFocusDevMult >= 0
      ? developmentScore.offFocusDevMult : devMult;
    // devMult 0: fokus giver intet, vaegtene kan ikke flytte noget (bevar ratio 0).
    return devMult > 0 ? (off * offDev) / devMult : 0;
  }
  const hard = Number(trainingCfg.focusGrowthMult?.[RACE_DAY_ROLE_BASE_INTENSITY]);
  return Number.isFinite(hard) && hard > 0 ? off / hard : 0;
}

/**
 * Loebsdagens basis-program: en haard dag paa etapens profil-evner.
 *
 * roleDrivesBaseDay (#5950 A, underkontakt): rollen styrer basis-dagens evner.
 * Kaptajn/jaeger = uaendret; hjaelper = hjaelpe-evnerne; fri rolle = gennemsnittet
 * af de to, evne for evne. Hjaelperens vaegte (focusWeights) skaleres, saa basis-
 * dagen i alt (fokus + off-fokus over alle evner) er kaptajnens, ogsaa naar antallet
 * af fokus-evner er et andet end profilens; fri rolle arver det af gennemsnittet.
 *
 * developmentScore: tick'ets Udviklingsscore B (samme objekt som applyDailyTick faar).
 * Under Score B vaegtes fokus og off-fokus anderledes (se raceDayBaseOffRatio), og
 * vaegtene skal udledes af de koefficienter tick'et faktisk bruger.
 */
export function raceDayRoleBaseProgram(profileType, {
  role = null, roleDrivesBaseDay = false, trainingCfg = TRAINING_CONFIG, developmentScore = null,
} = {}) {
  const profile = knownProfile(profileType);
  const profileAbilities = raceDayFocusAbilities(profile);
  const group = raceDayRoleGroup(role);
  if (!roleDrivesBaseDay || group === "leader" || group === "hunter") {
    return Object.freeze({
      focus: RACE_DAY_FOCUS,
      intensity: RACE_DAY_ROLE_BASE_INTENSITY,
      focusAbilities: profileAbilities,
    });
  }
  const budget = profileAbilities.length;
  const helper = helperAbilities(profile);
  // En fokus-evne faar haard-vaeksten I STEDET FOR off-fokus-vaeksten (vaegten er i
  // enheder af haard-vaeksten). Har hjaelperen flere (faerre) fokus-evner end
  // profilen, mister (vinder) han derfor off-fokus-vaekst; vaegten giver den tilbage,
  // saa totalen er kaptajnens.
  const offRatio = raceDayBaseOffRatio(trainingCfg, developmentScore);
  const helperWeight = (budget + offRatio * (helper.length - budget)) / helper.length;
  let weights = Object.fromEntries(helper.map((a) => [a, helperWeight]));
  if (group === "free") {
    // S17: fri rolle = gennemsnittet af kaptajnens og hjaelperens HELE basis-dag,
    // evne for evne (en evne kun den ene traener, faar off-fokus fra den anden).
    const captainUnit = (a) => (profileAbilities.includes(a) ? 1 : offRatio);
    const helperUnit = (a) => (helper.includes(a) ? helperWeight : offRatio);
    weights = {};
    for (const a of new Set([...profileAbilities, ...helper])) weights[a] = (captainUnit(a) + helperUnit(a)) / 2;
  }
  return Object.freeze({
    focus: RACE_DAY_FOCUS,
    intensity: RACE_DAY_ROLE_BASE_INTENSITY,
    focusAbilities: Object.freeze(Object.keys(weights)),
    focusWeights: Object.freeze(weights),
  });
}

/**
 * Tillaeggets vaegt pr. evne for en gruppe. Summen er den samme for alle roller,
 * saa alle roller faar samme tillaeg i alt (D3 variant A).
 * @returns {Record<string, number>}
 */
export function raceDayRoleBonusWeights(profileType, role, leadShare, { roleDrivesBaseDay = false } = {}) {
  const profile = knownProfile(profileType);
  const budget = raceDayFocusAbilities(profile).length;
  const groupWeights = (group) => {
    const { lead, support } = raceDayRoleAbilityGroups(profile, group, { roleDrivesBaseDay });
    const out = {};
    const leadPart = support.length ? leadShare : 1;
    for (const a of lead) out[a] = (out[a] ?? 0) + (budget * leadPart) / lead.length;
    for (const a of support) out[a] = (out[a] ?? 0) + (budget * (1 - leadPart)) / support.length;
    return out;
  };
  const group = raceDayRoleGroup(role);
  if (group !== "free") return groupWeights(group);
  // S17: fri rolle = en blanding af kaptajnens og hjaelperens fordeling.
  const a = groupWeights("leader");
  const b = groupWeights("helper");
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = ((a[k] ?? 0) + (b[k] ?? 0)) / 2;
  return out;
}

/**
 * Multiplikatoren pr. evne paa basis-dagens delta, saa rollens tillaeg laegges oven
 * paa haard-dagen. Den praecise model: balance-internals/5950 (privat).
 *
 * #7584: tillaegget regnes pr. evne i tick'ets faktiske enhed. Under Score B normaliserer
 * applyDailyTick kun fokus-evnerne, saa off-fokus-evnerne (lederskab, aggression, en
 * hjaelpers stoette-evner) skal regnes ud fra samme forhold som basis-dagen
 * (raceDayBaseOffRatio). Ellers faar de et andet tillaeg end vaegten siger, og roller med
 * off-fokus-evner faar mere i alt end D3 variant A tillader. Score B off = uaendret regning.
 * @returns {Record<string, number>}
 */
export function raceDayRoleYieldMultipliers({
  params, profileType, role,
  trainingCfg = TRAINING_CONFIG, developmentScore = null,
  program = raceDayRoleBaseProgram(profileType, { role, roleDrivesBaseDay: params?.roleDrivesBaseDay === true, trainingCfg, developmentScore }),
}) {
  if (!params) return {};
  const hardFocus = Number(trainingCfg.focusGrowthMult?.[RACE_DAY_ROLE_BASE_INTENSITY]);
  if (!Number.isFinite(hardFocus) || hardFocus <= 0) return {};
  const weights = raceDayRoleBonusWeights(profileType, role, params.leadShare, { roleDrivesBaseDay: params.roleDrivesBaseDay === true });
  const scoreBOffRatio = scoreBDrivesTick(developmentScore) ? raceDayBaseOffRatio(trainingCfg, developmentScore) : null;
  const out = {};
  for (const [ability, w] of Object.entries(weights)) {
    const baseMult = abilityMult(ability, program, trainingCfg);
    if (!(baseMult > 0) || !(w > 0)) continue;
    const scoreBOffFocus = scoreBOffRatio !== null && !program.focusAbilities.includes(ability);
    // Forhold 0 under Score B: basis-dagen giver intet at gange paa, saa ingen multiplikator.
    if (scoreBOffFocus && !(scoreBOffRatio > 0)) continue;
    const mult = scoreBOffFocus
      ? 1 + (params.stageBonus * w) / scoreBOffRatio
      : 1 + (params.stageBonus * w * hardFocus) / baseMult;
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
  const developmentScore = extraTickArgs?.developmentScore ?? null;
  const program = raceDayRoleBaseProgram(profileType, {
    role, roleDrivesBaseDay: params.roleDrivesBaseDay === true, developmentScore,
  });
  const roleMult = raceDayRoleYieldMultipliers({ params, profileType, role, program, developmentScore });
  const prior = extraTickArgs?.abilityYieldMult ?? null;
  const abilityYieldMult = { ...roleMult };
  for (const [ability, m] of Object.entries(prior ?? {})) {
    if (!(m > 0)) continue;
    abilityYieldMult[ability] = (abilityYieldMult[ability] ?? 1) * m;
  }
  return { ...extraTickArgs, program, abilityYieldMult };
}

/**
 * Ren sammenkobling: rytter -> hans rolle paa dagens etape, afgjort PRAECIS som
 * loebsmotoren goer (raceStageRoles.resolveStageEntrants): etape-raekken
 * (race_stage_roles.race_role) vinder over basisrollen (race_entries.race_role), og
 * har to ryttere paa samme hold samme eksklusive rolle, beholder én den og resten
 * koerer som hjaelper. Grupperet pr. (loeb, etape), saa hver etape afgoeres for sig.
 * @param {Map<string, {raceId: string, stageNumber: number}>} stageByRider
 * @returns {Map<string, string>}
 */
export function raceDayRoleByRider(stageByRider, entryRows = [], stageRoleRows = []) {
  const stageKey = (raceId, stageNumber) => `${raceId}:${Number(stageNumber)}`;
  const entrantsByStage = new Map();
  for (const row of entryRows ?? []) {
    const stage = stageByRider?.get(row?.rider_id);
    if (!stage || stage.raceId !== row.race_id) continue;
    const key = stageKey(stage.raceId, stage.stageNumber);
    if (!entrantsByStage.has(key)) entrantsByStage.set(key, []);
    entrantsByStage.get(key).push({ rider_id: row.rider_id, team_id: row.team_id ?? null, race_role: row.race_role ?? null });
  }
  const overridesByStage = new Map();
  for (const row of stageRoleRows ?? []) {
    const stage = stageByRider?.get(row?.rider_id);
    if (!stage || !row.race_role) continue;
    if (stage.raceId !== row.race_id || Number(stage.stageNumber) !== Number(row.stage_number)) continue;
    const key = stageKey(stage.raceId, stage.stageNumber);
    if (!overridesByStage.has(key)) overridesByStage.set(key, new Map());
    overridesByStage.get(key).set(row.rider_id, { race_role: row.race_role, effort: "normal" });
    // En override uden basis-raekke (bør ikke ske) taeller stadig som etapens rolle.
    if (!entrantsByStage.get(key)?.some((e) => e.rider_id === row.rider_id)) {
      if (!entrantsByStage.has(key)) entrantsByStage.set(key, []);
      entrantsByStage.get(key).push({ rider_id: row.rider_id, team_id: null, race_role: null });
    }
  }
  const out = new Map();
  for (const [key, entrants] of entrantsByStage) {
    const { entrants: resolved } = resolveStageEntrants(entrants, overridesByStage.get(key));
    for (const e of resolved) if (e.race_role) out.set(e.rider_id, e.race_role);
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
    .select("race_id, rider_id, team_id, race_role")
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
