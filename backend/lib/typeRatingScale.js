// typeRatingScale.js — percentil-normaliseret visning af type-ratings (#3458 Fase 1,
// Del B "skala-ærlighed"). REN funktion, ingen DB.
//
// Problem (spec docs/superpowers/specs/2026-08-06-ryttertype-fundament-v2-design.md
// §Del B, målt på #3372): de rå 1-99 type-ratings (scoutingReport.ratingFromAbilities)
// er IKKE sammenlignelige på tværs af de 8 ryttertyper — baroudeur/gc-formlerne giver
// strukturelt højere tal for næsten alle ryttere end fx sprinter/brostensrytter. "84"
// i baroudeur betyder noget helt andet end "84" i gc. typeRatingPercentile omsætter en
// rå rating til DENS PERCENTIL i typens egen population: "84" betyder herefter "bedre
// end 84% af feltet i den rolle", ens i alle 8 roller.
//
// INGEN ændring af ability_caps, primary_type/secondary_type, potentiale eller
// klassifikatoren (riderTypes.js) — dette er UDELUKKENDE visningslaget. Se #3458
// Del C ("ingen tredje rystelse"): eksisterende ryttere rører intet andet end det
// VISTE tal.
//
// Kvantil-tabellen (./typeRatingQuantiles.json) genereres af
// scripts/buildTypeRatingQuantiles.js (read-only mod prod, LIVE ability_caps, aktiv
// population, ejede+AI). Design for ugentlig genberegning (spec §Del B — kan senere
// hooks ind i søndags-sweepen fra #3448); committes så visningen er DETERMINISTISK
// mellem genberegninger (samme rå rating giver samme percentil hele ugen).
//
// Fail-safe (bevidst, #3458): mangler tabellen (fil ikke fundet/korrupt) eller typen
// findes ikke i den → returnér den RÅ værdi uændret (klampet [1,99]) — visningen må
// aldrig knække — og log én Sentry-warning pr. unik årsag (ikke pr. kald) så drift
// opdages uden at spamme.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Sentry from "@sentry/node";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TABLE_PATH = join(__dirname, "typeRatingQuantiles.json");

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

let cachedTable; // undefined = ikke forsøgt endnu; null = forsøgt og fejlet
function loadDefaultTable() {
  if (cachedTable !== undefined) return cachedTable;
  try {
    cachedTable = JSON.parse(readFileSync(TABLE_PATH, "utf8"));
  } catch (err) {
    // best-effort: missing/corrupt quantile table degrades to raw ratings
    // (fail-safe below) instead of throwing — reported once via warnOnce.
    cachedTable = null;
    warnOnce(`typeRatingScale: failed to read quantile table (${TABLE_PATH}): ${err.message}`);
  }
  return cachedTable;
}

// Test-only: nulstil den in-process cache af standard-tabellen.
export function _resetDefaultTableCacheForTests() {
  cachedTable = undefined;
}

// Lineær interpolation i en SORTERET, monotont stigende kvantil-array (indeks =
// percentil 0..100, dvs. 101 punkter — se buildTypeRatingQuantiles.js). raw ude af
// range clamper til 1 hhv. 99 (aldrig ekstrapoleret).
function interpolatePercentile(quantiles, raw) {
  const n = quantiles.length;
  if (raw <= quantiles[0]) return 1;
  if (raw >= quantiles[n - 1]) return 99;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (quantiles[mid] <= raw) lo = mid; else hi = mid;
  }
  const q0 = quantiles[lo], q1 = quantiles[hi];
  const frac = q1 === q0 ? 0 : (raw - q0) / (q1 - q0);
  return clampInt(lo + frac, 1, 99);
}

// typeRatingPercentile(typeKey, rawRating[, table]) → 1-99.
//   typeKey   : en af RIDER_TYPE_KEYS (backend/lib/riderTypes.js)
//   rawRating : rå 1-99-rating (fx scoutingReport.ratingFromAbilities-output)
//   table     : injicerbar til tests — default: den committede typeRatingQuantiles.json
export function typeRatingPercentile(typeKey, rawRating, table = loadDefaultTable()) {
  const raw = Number(rawRating);
  if (!Number.isFinite(raw)) return rawRating;
  if (!table || typeof table !== "object") {
    warnOnce("typeRatingScale: quantile table is missing — showing raw type ratings unchanged.");
    return clampInt(raw, 1, 99);
  }
  const entry = table.types?.[typeKey];
  const quantiles = entry?.quantiles;
  if (!Array.isArray(quantiles) || quantiles.length < 2 || quantiles.some((v) => !Number.isFinite(v))) {
    warnOnce(`typeRatingScale: missing quantile data for type "${typeKey}" — showing raw value unchanged.`);
    return clampInt(raw, 1, 99);
  }
  return interpolatePercentile(quantiles, raw);
}

// Transformerer buildTypeCeilingBands-output ({key, now, ceilLo, ceilHi}[]) til
// percentil-skala — SAMME tabel bruges til now OG begge bånd-ender pr. type, ellers
// bliver visningen selvmodsigende (#3458 PR-krav). Monoton transform → invarianten
// ceilLo>=now og ceilHi>=ceilLo er bevaret efter transform.
export function percentileBands(bands, table = loadDefaultTable()) {
  return (Array.isArray(bands) ? bands : []).map((b) => ({
    ...b,
    now: typeRatingPercentile(b.key, b.now, table),
    ceilLo: typeRatingPercentile(b.key, b.ceilLo, table),
    ceilHi: typeRatingPercentile(b.key, b.ceilHi, table),
  }));
}
