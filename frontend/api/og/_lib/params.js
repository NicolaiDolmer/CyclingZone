// #6574: parsing + validering af query-parametre til road book-billedet (/api/og/stage).
//
// HVORFOR DATA I URL'EN: race_stage_profiles har kun authenticated-select (RLS), og funktionen
// maa ikke kraeve en service-noegle. Etapens rute (afstand, hoejdemeter, stigninger) er allerede
// synlig for enhver spiller paa etapesiden, og "Del"-knappen kender den. Derfor bygger kalderen
// URL'en med buildStageOgUrl() og funktionen gengiver KUN det den faar. Alt valideres og
// begraenses her, saa en haandlavet URL hverken kan sprede lange tekster eller gaa i loop.
//
// Mappen _lib/ er bevidst: Vercel behandler filer uden underscore i api/ som endpoints.

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export const PROFILE_TYPES = Object.freeze([
  "flat", "rolling", "hilly", "cobbles", "gravel", "classic",
  "medium_mountain", "mountain", "high_mountain", "itt", "itt_hilly", "ttt",
]);
export const CATEGORIES = Object.freeze(["4", "3", "2", "1", "HC"]);

const MAX_CLIMBS = 8;
const MAX_NAME = 40;
const MAX_ROUTE = 64;

function clampNum(raw, lo, hi, fallback) {
  const n = Number(raw);
  if (raw === null || raw === undefined || raw === "" || !Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

/** Kontroltegn ud, whitespace samlet, hard cap. Ingen HTML (satori renderer tekst, ikke markup). */
export function cleanText(raw, max) {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/**
 * Stigninger som `crest~length~gradient~cat~navn`, adskilt af `;`. Ugyldige raekker droppes
 * (en korrupt raekke maa ikke vaelte billedet), og max 8 beholdes.
 */
export function parseClimbs(raw, distanceKm) {
  if (typeof raw !== "string" || !raw) return [];
  const out = [];
  for (const part of raw.split(";").slice(0, MAX_CLIMBS)) {
    const [crest, length, grad, cat, ...nameParts] = part.split("~");
    const crestKm = Number(crest);
    const lengthKm = Number(length);
    const avgGradient = Number(grad);
    if (![crestKm, lengthKm, avgGradient].every(Number.isFinite)) continue;
    if (crestKm <= 0 || lengthKm <= 0 || avgGradient <= 0) continue;
    const category = CATEGORIES.includes(String(cat).toUpperCase()) ? String(cat).toUpperCase() : "3";
    out.push({
      name: cleanText(nameParts.join("~"), MAX_NAME),
      category,
      crest_km: Math.min(crestKm, distanceKm),
      length_km: Math.min(lengthKm, 40, Math.max(0.2, crestKm)),
      avg_gradient: Math.min(avgGradient, 20),
    });
  }
  return out.sort((a, b) => a.crest_km - b.crest_km);
}

/** Mellem-sprint-km, `;`-adskilt. Maks 3. */
export function parseSprints(raw, distanceKm) {
  if (typeof raw !== "string" || !raw) return [];
  return raw.split(";")
    .map(Number)
    .filter((k) => Number.isFinite(k) && k > 0 && k < distanceKm)
    .slice(0, 3);
}

/** @param {URLSearchParams} sp */
export function parseStageParams(sp) {
  const distanceKm = clampNum(sp.get("km"), 1, 400, NaN);
  if (!Number.isFinite(distanceKm)) return { ok: false, error: "km is required (1-400)" };
  const race = cleanText(sp.get("race") ?? "", MAX_NAME);
  if (!race) return { ok: false, error: "race is required" };

  const stageCount = Math.round(clampNum(sp.get("of"), 1, 30, 1));
  const stage = Math.round(clampNum(sp.get("stage"), 1, stageCount, 1));
  const type = PROFILE_TYPES.includes(sp.get("type")) ? sp.get("type") : "hilly";
  const lang = sp.get("lang") === "da" ? "da" : "en";

  return {
    ok: true,
    value: {
      race,
      route: cleanText(sp.get("route") ?? "", MAX_ROUTE),
      stage,
      stageCount,
      type,
      lang,
      distance_km: Math.round(distanceKm * 10) / 10,
      elevation_gain_m: Math.round(clampNum(sp.get("gain"), 0, 9000, 0)),
      climbs: parseClimbs(sp.get("climbs"), distanceKm),
      sprints: parseSprints(sp.get("sprints"), distanceKm),
      // Seed til den deterministiske bølge i buildProfileSeries (samme etape → samme kurve som på siden).
      seedKey: cleanText(sp.get("seed") ?? race, 48),
    },
  };
}

/**
 * Bygger URL'en en "Del"-knap / og:image-tag skal bruge. Spejl af parseStageParams.
 * @param {string} origin fx "https://cyclingzone.org"
 * @param {{race:string, route?:string, stage:number, stageCount:number, profile_type:string,
 *   distance_km:number, elevation_gain_m:number, climbs?:object[], sprints?:{km:number,kind:string}[],
 *   seed?:string, lang?:string}} stage
 */
export function buildStageOgUrl(origin, stage) {
  const u = new URL("/api/og/stage", origin);
  const set = (k, v) => { if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v)); };
  set("race", stage.race);
  set("route", stage.route);
  set("stage", stage.stage);
  set("of", stage.stageCount);
  set("type", stage.profile_type);
  set("km", stage.distance_km);
  set("gain", stage.elevation_gain_m);
  set("seed", stage.seed);
  if (stage.lang === "da") set("lang", "da");
  const climbs = (stage.climbs ?? [])
    .map((c) => [c.crest_km, c.length_km, c.avg_gradient, c.category, String(c.name ?? "").replace(/[;~]/g, " ")].join("~"))
    .join(";");
  set("climbs", climbs);
  const sprints = (stage.sprints ?? []).filter((s) => s.kind === "intermediate").map((s) => s.km).join(";");
  set("sprints", sprints);
  return u.toString();
}
