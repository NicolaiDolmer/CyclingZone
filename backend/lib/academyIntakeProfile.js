// backend/lib/academyIntakeProfile.js
// #6666 (ejer-beslutninger 15/10, punkt 4-5; D-039): akademiets PROFIL.
//
// Manageren angiver en ønsket profil for akademiet (nationalitet/region og
// ryttertype). Ugens kuld trækkes med OVERVÆGT mod profilen, aldrig udelukkende,
// og driveren er AKADEMI-faciliteten (team_facilities.track = 'academy'), ikke
// scouten og ikke penge. Model 1 (vokser med faciliteten):
//
//   niveau 0  ingen profil
//   niveau 1  nationalitet/region
//   niveau 2  + ryttertype
//   niveau 3  stærkere overvægt
//   niveau 4  + én ekstra (2. nationalitet/region ELLER 2. ryttertype)
//   niveau 5  stærkest overvægt (aldrig 100 %)
//
// Flere kandidater pr. niveau. POTENTIALEFORDELINGEN ER ENS på alle niveauer:
// profilen flytter kun nationalitet og anlæg, aldrig potentiale-trækket
// (generateAcademyCandidates' drawPotentiale er urørt).
//
// Punkt 5: profilen kan ændres når som helst, men virker først efter
// PROFILE_DELAY_DAYS. Hver ændring er en ny række i academy_intake_profiles med
// effective_from = nu + forsinkelsen; den aktive profil er den nyeste række hvis
// effective_from er passeret. Ingen række overskrives, så historikken er gratis.
//
// Tallene herunder (kandidater og overvægt pr. niveau) er START-KANDIDATER og
// kalibreres privat (balance-internals/6666/).
import { DEFAULT_NATIONALITY_WEIGHTS } from "./fictionalRiderGenerator.js";
import { DEFAULT_DISTRIBUTION, ARCHETYPE_TYPES } from "./archetypeDistribution.js";
import { MAX_FACILITY_TIER } from "./facilityConstants.js";

export const PROFILE_DELAY_DAYS = 14;
const DAY_MS = 86_400_000;

// Model 1. `origins`/`types` = hvor mange felter niveauet låser op; `extra` =
// niveau 4's ene ekstra felt, som manageren selv lægger på nationalitet ELLER type.
// `share` = andelen af hvert træk der tages fra profilen (resten fra den normale
// fordeling, så profilen aldrig bliver 100 %).
export const PROFILE_TIERS = Object.freeze({
  0: Object.freeze({ candidates: 2, origins: 0, types: 0, extra: 0, share: 0 }),
  1: Object.freeze({ candidates: 2, origins: 1, types: 0, extra: 0, share: 0.35 }),
  2: Object.freeze({ candidates: 3, origins: 1, types: 1, extra: 0, share: 0.35 }),
  3: Object.freeze({ candidates: 3, origins: 1, types: 1, extra: 0, share: 0.5 }),
  4: Object.freeze({ candidates: 4, origins: 1, types: 1, extra: 1, share: 0.5 }),
  5: Object.freeze({ candidates: 4, origins: 1, types: 1, extra: 1, share: 0.65 }),
});

// Kun nationer kuldet faktisk kan trække (navne-klynger + vægte findes).
export const PROFILE_NATIONS = Object.freeze(DEFAULT_NATIONALITY_WEIGHTS.map((e) => e.value));

// Regioner = grupper af kuld-nationer. Nøglen er stabil (i18n + DB); medlemmerne
// er altid en delmængde af PROFILE_NATIONS (testet).
export const PROFILE_REGIONS = Object.freeze({
  nordic: Object.freeze(["DK", "NO", "SE"]),
  benelux: Object.freeze(["BE", "NL"]),
  iberia: Object.freeze(["ES", "PT"]),
  german_speaking: Object.freeze(["DE", "AT", "CH"]),
  central_europe: Object.freeze(["CZ", "PL", "SI"]),
  english_speaking: Object.freeze(["GB", "US", "CA", "AU", "NZ"]),
  latin_america: Object.freeze(["CO", "AR", "BR"]),
  east_asia: Object.freeze(["CN", "JP", "KR"]),
  africa: Object.freeze(["DZ", "MA", "ER", "RW"]),
});

const REGION_PREFIX = "region:";

export function clampTier(tier) {
  const n = Math.floor(Number(tier) || 0);
  return Math.max(0, Math.min(MAX_FACILITY_TIER, n));
}

export function tierRules(tier) {
  return PROFILE_TIERS[clampTier(tier)];
}

/** Antal kandidater i ugens kuld for et akademi-niveau. */
export function candidatesForTier(tier) {
  return tierRules(tier).candidates;
}

/** Er `origin` en gyldig profil-oprindelse ("DK" eller "region:nordic")? */
export function isValidOrigin(origin) {
  if (typeof origin !== "string") return false;
  if (origin.startsWith(REGION_PREFIX)) return Object.hasOwn(PROFILE_REGIONS, origin.slice(REGION_PREFIX.length));
  return PROFILE_NATIONS.includes(origin);
}

/** Nationerne en oprindelse dækker. */
export function nationsForOrigin(origin) {
  if (!isValidOrigin(origin)) return [];
  if (origin.startsWith(REGION_PREFIX)) return [...PROFILE_REGIONS[origin.slice(REGION_PREFIX.length)]];
  return [origin];
}

function uniqueStrings(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter((v) => typeof v === "string" && v.length > 0))];
}

/**
 * Valider en ønsket profil mod akademiets niveau. Returnerer
 * `{ ok: true, profile: { origins, types } }` eller `{ ok: false, error }`.
 * En tom profil (ingen felter) er altid gyldig: den rydder profilen.
 */
export function validateProfileInput(input, tier) {
  const rules = tierRules(tier);
  const origins = uniqueStrings(input?.origins);
  const types = uniqueStrings(input?.types);
  if (origins.some((o) => !isValidOrigin(o))) return { ok: false, error: "invalid_origin" };
  if (types.some((t) => !ARCHETYPE_TYPES.includes(t))) return { ok: false, error: "invalid_type" };
  if (rules.origins === 0 && (origins.length > 0 || types.length > 0)) return { ok: false, error: "profile_locked" };
  if (types.length > 0 && rules.types === 0) return { ok: false, error: "type_locked" };
  const extraOrigins = Math.max(0, origins.length - rules.origins);
  const extraTypes = Math.max(0, types.length - rules.types);
  if (extraOrigins + extraTypes > rules.extra) return { ok: false, error: "too_many_fields" };
  return { ok: true, profile: { origins, types } };
}

/**
 * Del et holds profil-rækker (nyeste sidst eller først, rækkefølgen er ligegyldig)
 * i den AKTIVE profil og en evt. VENTENDE ændring.
 */
export function resolveProfileRows(rows, now = new Date()) {
  const nowMs = new Date(now).getTime();
  const sorted = [...(rows ?? [])]
    .filter((r) => r && r.effective_from)
    .sort((a, b) => new Date(a.effective_from).getTime() - new Date(b.effective_from).getTime()
      || new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime());
  let active = null;
  let pending = null;
  for (const row of sorted) {
    if (new Date(row.effective_from).getTime() <= nowMs) active = row;
    else pending = row; // senest planlagte ændring vinder
  }
  const shape = (row) => (row ? {
    origins: uniqueStrings(row.origins),
    types: uniqueStrings(row.rider_types),
    effectiveFrom: row.effective_from,
  } : null);
  return { active: shape(active), pending: shape(pending) };
}

/**
 * Begræns en (aktiv) profil til det akademiet KAN i dag. Er faciliteten
 * nedgraderet efter profilen blev sat, falder de felter der ikke længere er
 * låst op væk, i stedet for at profilen holder op med at virke helt.
 */
export function clampProfileToTier(profile, tier) {
  if (!profile) return null;
  const rules = tierRules(tier);
  if (rules.origins === 0) return null;
  let origins = profile.origins.slice(0, rules.origins);
  let types = rules.types > 0 ? profile.types.slice(0, rules.types) : [];
  if (rules.extra > 0) {
    if (profile.origins.length > origins.length) origins = profile.origins.slice(0, rules.origins + rules.extra);
    else if (rules.types > 0 && profile.types.length > types.length) types = profile.types.slice(0, rules.types + rules.extra);
  }
  if (origins.length === 0 && types.length === 0) return null;
  return { origins, types };
}

/**
 * Generator-parametre for ugens kuld. Blandingen (1 − share)·normal + share·profil
 * gør at profilen ALDRIG er 100 %: kandidater uden for profilen forekommer altid.
 * Returnerer null når der intet er at overvægte (uændret generator-adfærd).
 */
export function buildProfileGeneratorOptions(profile, tier) {
  const clamped = clampProfileToTier(profile, tier);
  const share = tierRules(tier).share;
  if (!clamped || share <= 0) return null;
  const out = {};

  const profileNations = [...new Set(clamped.origins.flatMap(nationsForOrigin))];
  if (profileNations.length > 0) {
    const baseTotal = DEFAULT_NATIONALITY_WEIGHTS.reduce((s, e) => s + e.weight, 0);
    const inProfile = DEFAULT_NATIONALITY_WEIGHTS.filter((e) => profileNations.includes(e.value));
    const profileTotal = inProfile.reduce((s, e) => s + e.weight, 0);
    out.nationalityWeights = DEFAULT_NATIONALITY_WEIGHTS.map((e) => ({
      value: e.value,
      weight: (1 - share) * (e.weight / baseTotal)
        + (profileNations.includes(e.value) && profileTotal > 0 ? share * (e.weight / profileTotal) : 0),
    }));
  }

  if (clamped.types.length > 0) {
    const baseTotal = ARCHETYPE_TYPES.reduce((s, t) => s + (DEFAULT_DISTRIBUTION[t] ?? 0), 0);
    const each = share / clamped.types.length;
    const dist = {};
    for (const t of ARCHETYPE_TYPES) {
      dist[t] = (1 - share) * ((DEFAULT_DISTRIBUTION[t] ?? 0) / baseTotal) + (clamped.types.includes(t) ? each : 0);
    }
    out.primaryArchetypeDistribution = dist;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** Holdets akademi-facilitetsniveau (0 når intet er købt). */
export async function loadAcademyFacilityTier(supabase, teamId) {
  const { data, error } = await supabase
    .from("team_facilities").select("tier").eq("team_id", teamId).eq("track", "academy").maybeSingle();
  if (error) throw new Error(`academy-profile facility lookup: ${error.message}`);
  return clampTier(data?.tier ?? 0);
}

async function loadProfileRows(supabase, teamId) {
  const { data, error } = await supabase
    .from("academy_intake_profiles")
    .select("origins, rider_types, effective_from, created_at")
    .eq("team_id", teamId)
    .order("effective_from", { ascending: false })
    .limit(10);
  if (error) throw new Error(`academy-profile lookup: ${error.message}`);
  return data ?? [];
}

/**
 * Profil-tilstanden til GET /api/academy/me og til ugens hentning.
 * @returns {Promise<{tier:number, rules:object, active:object|null, pending:object|null, effective:object|null}>}
 */
export async function loadAcademyProfileState(supabase, { teamId, now = new Date() }) {
  const [tier, rows] = await Promise.all([
    loadAcademyFacilityTier(supabase, teamId),
    loadProfileRows(supabase, teamId),
  ]);
  const { active, pending } = resolveProfileRows(rows, now);
  return { tier, rules: tierRules(tier), active, pending, effective: clampProfileToTier(active, tier) };
}

/**
 * Gem en ny ønsket profil. Den virker først efter PROFILE_DELAY_DAYS; en
 * tidligere ventende ændring erstattes (den nyeste planlagte vinder).
 */
export async function saveAcademyProfile(supabase, { teamId, input, now = new Date() }) {
  if (!teamId) throw new Error("teamId required");
  const tier = await loadAcademyFacilityTier(supabase, teamId);
  const checked = validateProfileInput(input, tier);
  if (!checked.ok) return checked;
  const effectiveFrom = new Date(new Date(now).getTime() + PROFILE_DELAY_DAYS * DAY_MS).toISOString();
  // En ventende ændring der endnu ikke er trådt i kraft, er stadig kun et ønske:
  // ryd den, så der aldrig står to planlagte profiler.
  const { error: delErr } = await supabase
    .from("academy_intake_profiles").delete().eq("team_id", teamId).gt("effective_from", new Date(now).toISOString());
  if (delErr) throw new Error(`academy-profile clear pending: ${delErr.message}`);
  const { error } = await supabase.from("academy_intake_profiles").insert({
    team_id: teamId,
    origins: checked.profile.origins,
    rider_types: checked.profile.types,
    effective_from: effectiveFrom,
  });
  if (error) throw new Error(`academy-profile save: ${error.message}`);
  return { ok: true, profile: checked.profile, effectiveFrom };
}

/** Valgmulighederne UI'et må vise (ingen tal, kun nøgler). */
export function profileOptions() {
  return {
    nations: [...PROFILE_NATIONS],
    regions: Object.keys(PROFILE_REGIONS),
    types: [...ARCHETYPE_TYPES],
    delayDays: PROFILE_DELAY_DAYS,
  };
}
