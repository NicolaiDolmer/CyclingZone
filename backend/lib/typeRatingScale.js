// typeRatingScale.js — kalibreret, sammenlignelig type-rating-skala (#3458 Fase 1,
// Del B "skala-ærlighed"). REN funktion, ingen DB.
//
// Problem (spec docs/superpowers/specs/2026-08-06-ryttertype-fundament-v2-design.md
// §Del B, målt på #3372): de rå 1-99 type-ratings (scoutingReport.ratingFromAbilities)
// er IKKE sammenlignelige på tværs af de 8 ryttertyper — baroudeur/gc-formlerne giver
// strukturelt højere tal for næsten alle ryttere end fx sprinter/brostensrytter. "84"
// i baroudeur betyder noget helt andet end "84" i gc.
//
// Løsning (ejer-beslutning 6/8): en ABSOLUT, FROSSEN kalibrering af modellen — ikke et
// levende, befolknings-relativt lag. calibratedTypeRating omsætter en rå rating til den
// samme absolutte 1-99-skala i alle 8 typer, ud fra en kalibreringskurve fundet ÉN GANG
// (backend/lib/typeRatingCalibration.json). "84" betyder herefter det samme niveau
// uanset type, og en rytters tal flytter sig IKKE bare fordi resten af populationen
// ændrer sig — kun en fremtidig, bevidst rekalibrering (design-gated, Fase 2 når type-
// formlernes vægte efterses) kan flytte kurven.
//
// INGEN ændring af ability_caps, primary_type/secondary_type, potentiale eller
// klassifikatoren (riderTypes.js) — dette er UDELUKKENDE visningslaget. Se #3458
// Del C ("ingen tredje rystelse"): eksisterende ryttere rører intet andet end det
// VISTE tal.
//
// Kalibreringskurven (./typeRatingCalibration.json) er genereret af
// scripts/buildTypeRatingCalibration.js (read-only mod prod, LIVE ability_caps, aktiv
// population, ejede+AI) og derefter FROSSET — den regenereres ikke automatisk/ugentligt.
// Committes så visningen er deterministisk og stabil over tid (samme rå rating giver
// samme kalibrerede tal, uanset hvornår rytteren scoutes).
//
// Fail-safe (bevidst, #3458): mangler kalibreringskurven (fil ikke fundet/korrupt)
// eller typen findes ikke i den → returnér den RÅ værdi uændret (klampet [1,99]) —
// visningen må aldrig knække — og log én Sentry-warning pr. unik årsag (ikke pr. kald)
// så drift opdages uden at spamme.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Sentry from "@sentry/node";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CALIBRATION_PATH = join(__dirname, "typeRatingCalibration.json");

const clampInt = (n, lo, hi) => Math.round(Math.max(lo, Math.min(hi, n)));

const warned = new Set();
function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  try {
    Sentry.captureMessage(message, "warning");
  } catch {
    // best-effort: a Sentry transport failure must never break the rating
    // display — the fail-safe (raw value passthrough) already covers the
    // actual data problem this warning was reporting.
  }
}

let cachedCalibration; // undefined = ikke forsøgt endnu; null = forsøgt og fejlet
function loadDefaultCalibration() {
  if (cachedCalibration !== undefined) return cachedCalibration;
  try {
    cachedCalibration = JSON.parse(readFileSync(CALIBRATION_PATH, "utf8"));
  } catch (err) {
    // best-effort: missing/corrupt calibration data degrades to raw ratings
    // (fail-safe below) instead of throwing — reported once via warnOnce.
    cachedCalibration = null;
    warnOnce(`typeRatingScale: failed to read calibration data (${CALIBRATION_PATH}): ${err.message}`);
  }
  return cachedCalibration;
}

// Test-only: nulstil den in-process cache af standard-kalibreringen.
export function _resetCalibrationCacheForTests() {
  cachedCalibration = undefined;
}

// Lineær interpolation i en SORTERET, monotont stigende kalibreringskurve (indeks =
// position 0..100 på den absolutte skala, dvs. 101 punkter — se
// buildTypeRatingCalibration.js). raw uden for kurvens range clamper til 1 hhv. 99
// (aldrig ekstrapoleret).
function interpolateCalibratedRating(curve, raw) {
  const n = curve.length;
  if (raw <= curve[0]) return 1;
  if (raw >= curve[n - 1]) return 99;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (curve[mid] <= raw) lo = mid; else hi = mid;
  }
  const c0 = curve[lo], c1 = curve[hi];
  const frac = c1 === c0 ? 0 : (raw - c0) / (c1 - c0);
  return clampInt(lo + frac, 1, 99);
}

// calibratedTypeRating(typeKey, rawRating[, calibration]) → 1-99, på den fælles,
// sammenlignelige skala.
//   typeKey     : en af RIDER_TYPE_KEYS (backend/lib/riderTypes.js)
//   rawRating   : rå 1-99-rating (fx scoutingReport.ratingFromAbilities-output)
//   calibration : injicerbar til tests — default: den committede
//                 typeRatingCalibration.json (frossen konstant)
export function calibratedTypeRating(typeKey, rawRating, calibration = loadDefaultCalibration()) {
  const raw = Number(rawRating);
  if (!Number.isFinite(raw)) return rawRating;
  if (!calibration || typeof calibration !== "object") {
    warnOnce("typeRatingScale: calibration data is missing — showing raw type ratings unchanged.");
    return clampInt(raw, 1, 99);
  }
  const entry = calibration.types?.[typeKey];
  const curve = entry?.curve;
  if (!Array.isArray(curve) || curve.length < 2 || curve.some((v) => !Number.isFinite(v))) {
    warnOnce(`typeRatingScale: missing calibration curve for type "${typeKey}" — showing raw value unchanged.`);
    return clampInt(raw, 1, 99);
  }
  return interpolateCalibratedRating(curve, raw);
}

// Transformerer buildTypeCeilingBands-output ({key, now, ceilLo, ceilHi}[]) til den
// kalibrerede skala — SAMME kalibrering bruges til now OG begge bånd-ender pr. type,
// ellers bliver visningen selvmodsigende (#3458 PR-krav). Monoton transform →
// invarianten ceilLo>=now og ceilHi>=ceilLo er bevaret efter transform.
export function calibratedBands(bands, calibration = loadDefaultCalibration()) {
  return (Array.isArray(bands) ? bands : []).map((b) => ({
    ...b,
    now: calibratedTypeRating(b.key, b.now, calibration),
    ceilLo: calibratedTypeRating(b.key, b.ceilLo, calibration),
    ceilHi: calibratedTypeRating(b.key, b.ceilHi, calibration),
  }));
}
