// #3559 — Balance-drift-vagtens læse-lag.
//
// BalanceDriftWatchSection læste `data.days.length` (og senere
// `data.breaches.length` + `data.bands[key]`) direkte på svaret fra
// GET /api/admin/balance-drift. Svarede endpointet med en uventet shape —
// fejl-objekt, tom body, ældre deploy uden feltet — kastede renderingen en
// TypeError og tog hele admin-sektionen med sig.
//
// Alt der kan crashe på et ufuldstændigt svar bor derfor her: shape-
// normalisering + de to formattere der kalder metoder på værdier fra
// serveren. Ren .js (ikke .jsx) så repoets `node --test` kan importere og
// eksekvere netop de kodestier uden en DOM-renderer — samme mønster som
// components/admin/shared/seasonEndedToast.js.

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// En dag kan kun renderes hvis den har en streng-dato: header-cellen kalder
// `date.slice(5)` og bruger den som React-key.
function isRenderableDay(day) {
  return isPlainObject(day) && typeof day.date === "string" && day.date.length > 0;
}

const RATIO_KEYS = new Set([
  "favoriteWinRate",
  "favoritePodiumRate",
  "share4PlusSameTeamTop10",
  "maxRiderWinRate",
]);

const PERCENT_KEYS = new Set(["dnfRatePct", "jourSansSharePct", "breakawayWinSharePct"]);

/**
 * Normalisér svaret fra GET /api/admin/balance-drift til en shape der altid
 * kan renderes.
 *
 * `ok` skelner et ubrugeligt svar (ingen days-liste → fejl-state) fra et
 * lovligt tomt svar (tom days-liste → empty-state). `days`, `breaches` og
 * `bands` er altid til stede og af den rigtige type, uanset input.
 */
export function normalizeBalanceDrift(raw) {
  const source = isPlainObject(raw) ? raw : null;
  const ok = Array.isArray(source?.days);

  return {
    ok,
    days: ok ? source.days.filter(isRenderableDay) : [],
    breaches: Array.isArray(source?.breaches) ? source.breaches.filter(isPlainObject) : [],
    bands: isPlainObject(source?.bands) ? source.bands : {},
  };
}

/** Formatér en målt værdi. Alt der ikke er et endeligt tal vises som "—". */
export function formatValue(key, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (RATIO_KEYS.has(key)) return `${(value * 100).toFixed(1)}%`;
  if (PERCENT_KEYS.has(key)) return `${value.toFixed(2)}%`;
  return value.toFixed(1);
}

/** Formatér et bånd. Et manglende bånd (ukendt metrik) vises som "—". */
export function formatBand(band) {
  if (!isPlainObject(band)) return "—";
  if (band.reportOnly) return "rapport-only";
  if (band.min != null && band.max != null) return `${band.min}–${band.max}`;
  if (band.max != null) return `≤${band.max}`;
  if (band.min != null) return `≥${band.min}`;
  return "—";
}
