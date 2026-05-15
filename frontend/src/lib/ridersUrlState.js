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
  for (const [key, raw] of searchParams.entries()) {
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
    return { ...defaults, ...parsed };
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
