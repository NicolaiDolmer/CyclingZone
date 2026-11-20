// #6110 Udvikling 2.0, model G3a (spec 2026-11-20-6110-potentiale-p-og-udvikling-g3a-design.md
// §3, §4, §6.3): kroppens aldring i procent ved sæsonskiftet + varigt slid.
//
// To ting bor her, fordi både sæsonskiftet og XP-sporet skal læse dem fra samme kilde:
//
//   1. AldringENS FORM i talfilen (development_xp_params.aging, kun under XP).
//      To kurver, én for de fysiske evner + brosten og én for teknik og de mentale
//      evner. Hver kurve giver den andel af evnen, der tabes pr. sæson ved kroppens
//      alder i den nye sæson, lineært mellem punkterne. Punkter frem for trin: satsen
//      glider med alderen og har ingen hårde spring. Selve tallene er private
//      (hard rule 17) og står kun i talfilen; her er kun reglerne for, hvad en
//      gyldig kurve er.
//
//   2. SLIDDET. Det, aldringen har taget fra en evne, gemmes varigt pr. rytter pr. evne
//      (public.rider_wear, database/2026-11-20-6110-rider-wear.sql). XP-sporet trækker
//      sliddet fra rytterens mål, så faldet ikke kan trænes tilbage. Uden slid ville
//      en rytter træne aldringen tilbage hver sæson, og ingen blev nogensinde dårligere.
//      Sliddet sænker kun målet; det sænker aldrig en synlig evne. Evnerne falder kun
//      ved sæsonskiftet (riderProgression.developRiderSeasonV2).
//
// Ren modul-logik bortset fra loadRiderWear (én SELECT). Ingen import fra
// riderProgression.js, så den kan importere herfra uden en ring.

import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { fetchAllRows } from "./supabasePagination.js";

export const RIDER_WEAR_TABLE = "rider_wear";
// Nøglen i apply_rider_development's evne-patch, som RPC'en skriver til rider_wear i
// samme transaktion som evnerne (atomisk pr. rytter, #2361).
export const ABILITY_WEAR_PATCH_KEY = "ability_wear";

// ── 1) Aldringens form i talfilen ────────────────────────────────────────────

export const XP_AGING_PERCENT_KEYS = Object.freeze(["physical", "mental"]);

// Sikkerhedsskinner, ikke balancetal. En sæson tager aldrig mere end en fjerdedel af en
// evne, og kurven kan ikke starte uden for en rytters karriere.
const MAX_RATE_PER_SEASON = 0.25;
const MIN_CURVE_AGE = 18;
const MAX_CURVE_AGE = 50;
// Spec §4 (offentlig gate): plateauet dækker mindst 28-30, så intet tabes ved en
// sæson-alder til og med 30. Satsen kan først være over nul fra 31.
export const AGING_PLATEAU_THROUGH_AGE = 30;

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const onlyKeys = (obj, allowed) => Object.keys(obj).every((k) => allowed.includes(k));

/** Er `raw` talfilens G3a-form (kurver), og ikke kandidat B's trin-form? */
export function isXpAgingPercentShape(raw) {
  return !!raw && typeof raw === "object" && !Array.isArray(raw)
    && XP_AGING_PERCENT_KEYS.some((k) => k in raw);
}

/** Andelen ved alderen `age`: lineært mellem punkterne, fladt uden for dem. */
export function agingRateAt(curve, age) {
  const a = Number(age);
  if (!Array.isArray(curve) || curve.length === 0 || !Number.isFinite(a)) return 0;
  if (a <= curve[0].at) return curve[0].value;
  for (let i = 1; i < curve.length; i++) {
    const b = curve[i];
    if (a === b.at) return b.value;
    if (a < b.at) {
      const p = curve[i - 1];
      return p.value + ((b.value - p.value) * (a - p.at)) / (b.at - p.at);
    }
  }
  return curve[curve.length - 1].value;
}

function validRateCurve(raw) {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out = [];
  for (const p of raw) {
    if (!p || typeof p !== "object" || !onlyKeys(p, ["at", "value"])) return null;
    if (!isNum(p.at) || p.at < MIN_CURVE_AGE || p.at > MAX_CURVE_AGE) return null;
    if (!isNum(p.value) || p.value < 0 || p.value > MAX_RATE_PER_SEASON) return null;
    const prev = out[out.length - 1];
    // Alderen stiger, og satsen bliver aldrig mindre med alderen.
    if (prev && (!(p.at > prev.at) || p.value < prev.value)) return null;
    out.push(Object.freeze({ at: p.at, value: p.value }));
  }
  // Før kurvens første punkt tabes intet, og plateauet (spec §4) tager intet.
  if (out[0].value !== 0) return null;
  if (agingRateAt(out, AGING_PLATEAU_THROUGH_AGE) !== 0) return null;
  return Object.freeze(out);
}

/**
 * Validerer talfilens G3a-aldring. Samme tre udfald som de andre valgfrie dele af
 * XP-params: udeladt = undefined (dagens aldring), sat men ugyldig = null (hele
 * talfilen afvises, fail-safe), ellers en frossen kopi.
 *
 * Kontrakt med XP-sporet (#8520, developmentXp.ts): talfilens validator kalder denne
 * for `aging` i G3a-form, så reglerne kun står ét sted.
 */
export function validateXpAgingPercent(raw) {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!onlyKeys(raw, XP_AGING_PERCENT_KEYS)) return null;
  const physical = validRateCurve(raw.physical);
  const mental = validRateCurve(raw.mental);
  if (!physical || !mental) return null;
  // En aldring uden fald er ingen aldring.
  if (!physical.some((p) => p.value > 0)) return null;
  // Teknik og de mentale evner taber mindre og senere end kroppen: ved ingen alder
  // må deres sats være over de fysiske evners.
  for (const { at } of [...physical, ...mental]) {
    if (agingRateAt(mental, at) > agingRateAt(physical, at)) return null;
  }
  return Object.freeze({ physical, mental });
}

// ── 2) Sliddet ────────────────────────────────────────────────────────────────

const EMPTY_WEAR = Object.freeze({});

/** Kun synlige evner med et positivt helt antal point. Alt andet ignoreres. */
export function sanitizeWear(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_WEAR;
  const out = {};
  for (const ability of VISIBLE_ABILITIES) {
    const v = Math.round(Number(raw[ability]));
    if (Number.isFinite(v) && v > 0) out[ability] = v;
  }
  return Object.keys(out).length ? Object.freeze(out) : EMPTY_WEAR;
}

/**
 * Lægger en sæsons aldring til sliddet. `drops` er de point, aldringen tog pr. evne
 * (kun positive tæller). Sliddet kan kun vokse.
 */
export function addWear(wear, drops) {
  const base = sanitizeWear(wear);
  const out = { ...base };
  for (const ability of VISIBLE_ABILITIES) {
    const d = Math.round(Number(drops?.[ability]));
    if (Number.isFinite(d) && d > 0) out[ability] = (out[ability] ?? 0) + d;
  }
  return sanitizeWear(out);
}

/** Point aldringen har taget fra evnen, i alt. 0 når intet er gemt. */
export function wearForAbility(wear, ability) {
  return sanitizeWear(wear)[ability] ?? 0;
}

/**
 * Målet for en evne efter sliddet: det XP-sporet (#8520) træner hen imod. Aldrig
 * under 0. Sænker kun målet, aldrig evnens nuværende værdi.
 */
export function targetAfterWear(target, wear, ability) {
  const t = Number(target);
  if (!Number.isFinite(t)) return t;
  return Math.max(0, t - wearForAbility(wear, ability));
}

// .in()-listen holdes kort, så URL'en aldrig nærmer sig loftet (#3030).
export const RIDER_WEAR_ID_CHUNK = 200;

/**
 * Læsefunktionen for XP-sporet (#8520) og sæsonskiftet: sliddet pr. rytter.
 * Uden `riderIds` hentes alle rækker. Ryttere uden række har intet slid og står ikke i
 * mappen (brug wearForAbility(map.get(id), ...), som giver 0).
 *
 * Kaster ved en databasefejl, også når tabellen mangler: en kalder, der ikke kan se
 * sliddet, må ikke regne som om det var nul (så kunne faldet trænes tilbage).
 *
 * @returns {Promise<Map<string, Readonly<Record<string, number>>>>}
 */
export async function loadRiderWear({ supabase, riderIds = null }) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const byRider = new Map();
  const add = (rows) => {
    for (const row of rows ?? []) {
      const wear = sanitizeWear(row?.wear);
      if (row?.rider_id && Object.keys(wear).length) byRider.set(row.rider_id, wear);
    }
  };
  try {
    if (riderIds == null) {
      add(await fetchAllRows(() => supabase.from(RIDER_WEAR_TABLE).select("rider_id, wear").order("rider_id")));
      return byRider;
    }
    const ids = [...new Set([...riderIds].filter(Boolean))];
    for (let i = 0; i < ids.length; i += RIDER_WEAR_ID_CHUNK) {
      const chunk = ids.slice(i, i + RIDER_WEAR_ID_CHUNK);
      const { data, error } = await supabase.from(RIDER_WEAR_TABLE).select("rider_id, wear").in("rider_id", chunk);
      if (error) throw error;
      add(data);
    }
    return byRider;
  } catch (err) {
    throw new Error(`riderWear: read failed: ${err?.message ?? err}`, { cause: err });
  }
}
