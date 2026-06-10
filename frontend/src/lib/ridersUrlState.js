/**
 * ridersUrlState — encode/decode rider-filter state til URL + sessionStorage.
 *
 * Issue #8: filtre i rytterdatabasen nulstilledes når man navigerede ind på en
 * rytter og tilbage, fordi RidersPage unmountede. Vi persisterer nu i URL
 * (primær — bookmarkable/shareable) og falder tilbage på sessionStorage hvis
 * URL er tom (fx ved navigation tilbage via topmenu).
 *
 * Defaults injiceres af kalderen så denne fil ikke afhænger af RiderFilters.jsx
 * (test-isolering — node:test parser ikke JSX).
 */

export const RIDERS_FILTERS_SESSION_KEY = "riders.filters.v1";

// #1101 cutover: interne nøglenavne fra uci_points-æraen er omdøbt (sort
// "uci_points" → "value", filter min_uci/max_uci → min_value/max_value).
// Gamle URL'er (bookmarks/delte links) og sessionStorage-blobs accepteres
// stadig ved parse, men de gamle navne skrives aldrig længere.
// Map (ikke objekt-literal) så nøgler som "__proto__" ikke rammer prototypen.
const LEGACY_KEY_MAP = new Map([
  ["min_uci", "min_value"],
  ["max_uci", "max_value"],
]);
const LEGACY_SORT_VALUE = "uci_points";

function normalizeLegacyEntry(key, value) {
  const mappedKey = LEGACY_KEY_MAP.get(key) ?? key;
  const mappedValue = mappedKey === "sort" && value === LEGACY_SORT_VALUE ? "value" : value;
  return [mappedKey, mappedValue];
}

function isDefaultValue(value, defaultVal) {
  if (defaultVal === undefined) return true;
  if (value == null || value === "") {
    return defaultVal === "" || defaultVal == null;
  }
  return String(value) === String(defaultVal);
}

export function filtersToSearchParams(filters, defaults) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (isDefaultValue(value, defaults[key])) continue;
    if (typeof value === "boolean") {
      params.set(key, "1");
    } else {
      params.set(key, String(value));
    }
  }
  return params;
}

export function searchParamsToFilters(searchParams, defaults) {
  const result = { ...defaults };
  for (const [rawKey, rawValue] of searchParams.entries()) {
    const [key, raw] = normalizeLegacyEntry(rawKey, rawValue);
    if (!(key in defaults)) continue;
    const defaultVal = defaults[key];
    if (typeof defaultVal === "boolean") {
      result[key] = raw === "1" || raw === "true";
    } else if (typeof defaultVal === "number") {
      const n = parseInt(raw);
      result[key] = Number.isFinite(n) ? n : defaultVal;
    } else {
      result[key] = raw;
    }
  }
  return result;
}

export function saveFiltersToSession(filters) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(RIDERS_FILTERS_SESSION_KEY, JSON.stringify(filters));
  } catch {
    // sessionStorage kan være utilgængelig (privat-tilstand, quota osv.) — best-effort
  }
}

export function loadFiltersFromSession(defaults) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RIDERS_FILTERS_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    // Object.fromEntries (define-semantik) så et legacy "__proto__"-felt i
    // blob'en ikke kan ramme prototypen via [[Set]].
    const normalized = Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => normalizeLegacyEntry(key, value)),
    );
    return { ...defaults, ...normalized };
  } catch {
    return null;
  }
}

export function initialFiltersFromUrlOrSession(searchParams, defaults) {
  if (searchParams && Array.from(searchParams.keys()).length > 0) {
    return searchParamsToFilters(searchParams, defaults);
  }
  const stored = loadFiltersFromSession(defaults);
  if (stored) return stored;
  return { ...defaults };
}
