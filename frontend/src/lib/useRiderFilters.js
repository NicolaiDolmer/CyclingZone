/**
 * useRiderFilters — shared hook for filtering and sorting riders
 */
import { useState, useMemo } from "react";
import { DEFAULT_FILTERS, STAT_KEYS } from "../components/RiderFilters";
import { getRiderMarketValue } from "./marketValues";
import { getRiderAge } from "./riderAge";
import { compareNationality } from "./countryUtils";

const CURRENT_YEAR = new Date().getFullYear();

const STAT_MIN_DEFAULT = 50;
const STAT_MAX_DEFAULT = 85;

export function useClientRiderFilters(riders = []) {
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });

  function onChange(key, value) {
    setFilters(f => ({ ...f, [key]: value }));
  }

  function onReset() {
    setFilters({ ...DEFAULT_FILTERS });
  }

  const filtered = useMemo(() => {
    let result = riders.filter(r => !r.is_retired);

    if (filters.q) {
      const q = filters.q.toLowerCase();
      result = result.filter(r => `${r.firstname} ${r.lastname}`.toLowerCase().includes(q));
    }

    if (filters.min_value) result = result.filter(r => getRiderMarketValue(r) >= parseInt(filters.min_value));
    if (filters.max_value) result = result.filter(r => getRiderMarketValue(r) <= parseInt(filters.max_value));
    if (filters.min_salary) result = result.filter(r => (r.salary || 0) >= parseInt(filters.min_salary));
    if (filters.max_salary) result = result.filter(r => (r.salary || 0) <= parseInt(filters.max_salary));

    if (filters.min_age || filters.max_age) {
      result = result.filter(r => {
        const age = getRiderAge(r.birthdate);
        if (age == null) return true;
        if (filters.min_age && age < parseInt(filters.min_age)) return false;
        if (filters.max_age && age > parseInt(filters.max_age)) return false;
        return true;
      });
    }

    if (filters.u25) result = result.filter(r => r.is_u25);
    if (filters.u23) result = result.filter(r => {
      const age = getRiderAge(r.birthdate);
      return age != null && age <= 23;
    });

    if (filters.free_agent) result = result.filter(r => !r.team_id);
    if (filters.team_id) result = result.filter(r => r.team_id === filters.team_id);
    if (filters.nationality_code) result = result.filter(r => r.nationality_code === filters.nationality_code);

    // Ryttertype (#49): match primær ELLER sekundær — som top-2-visningen.
    if (filters.rider_type) {
      result = result.filter(r => r.primary_type === filters.rider_type || r.secondary_type === filters.rider_type);
    }

    // #1162: potentiale-min/max-filtre er fjernet — den rå potentiale findes ikke
    // i klienten længere (server-side skjult; kun scoutede estimater vises).

    // Stat range filters — only apply when range differs from default (50–85)
    for (const key of STAT_KEYS) {
      const minVal = parseInt(filters[`${key}_min`]) ?? STAT_MIN_DEFAULT;
      const maxVal = parseInt(filters[`${key}_max`]) ?? STAT_MAX_DEFAULT;
      if (minVal > STAT_MIN_DEFAULT || maxVal < STAT_MAX_DEFAULT) {
        result = result.filter(r => {
          const v = r[key] || 0;
          return v >= minVal && v <= maxVal;
        });
      }
    }

    // Sort
    result.sort((a, b) => {
      if (filters.sort === "firstname") {
        const aName = `${a.lastname} ${a.firstname}`.toLowerCase();
        const bName = `${b.lastname} ${b.firstname}`.toLowerCase();
        return filters.sort_dir === "desc" ? bName.localeCompare(aName) : aName.localeCompare(bName);
      }
      // Nation sorteres på den viste IOC-kode (#802) — den generiske numeriske
      // gren ville give NaN på strenge og dermed ustabil rækkefølge.
      if (filters.sort === "nationality_code") {
        const cmp = compareNationality(a.nationality_code, b.nationality_code);
        return filters.sort_dir === "desc" ? -cmp : cmp;
      }
      let aVal, bVal;
      if (filters.sort === "birthdate") {
        aVal = a.birthdate ? new Date(a.birthdate).getFullYear() : 1970;
        bVal = b.birthdate ? new Date(b.birthdate).getFullYear() : 1970;
      } else if (filters.sort === "value") {
        aVal = getRiderMarketValue(a);
        bVal = getRiderMarketValue(b);
      } else {
        aVal = a[filters.sort] || 0;
        bVal = b[filters.sort] || 0;
      }
      return filters.sort_dir === "desc" ? bVal - aVal : aVal - bVal;
    });

    return result;
  }, [riders, filters]);

  const nationalities = useMemo(() => {
    const seen = new Set();
    for (const r of riders) {
      if (r.nationality_code) seen.add(r.nationality_code);
    }
    return [...seen].sort();
  }, [riders]);

  return { filters, onChange, onReset, filtered, nationalities };
}

export function buildSupabaseQuery(query, filters) {
  query = query.eq("is_retired", false);
  if (filters.q) query = query.or(`firstname.ilike.%${filters.q}%,lastname.ilike.%${filters.q}%`);
  if (filters.min_value) query = query.gte("market_value", parseInt(filters.min_value));
  if (filters.max_value) query = query.lte("market_value", parseInt(filters.max_value));
  if (filters.min_salary) query = query.gte("salary", parseInt(filters.min_salary));
  if (filters.max_salary) query = query.lte("salary", parseInt(filters.max_salary));
  if (filters.u25) query = query.eq("is_u25", true);
  if (filters.free_agent) query = query.is("team_id", null);
  if (filters.team_id) query = query.eq("team_id", filters.team_id);
  if (filters.nationality_code) query = query.eq("nationality_code", filters.nationality_code);

  // Ryttertype (#49): match primær ELLER sekundær. Egen .or() AND'es med øvrige
  // filtre (inkl. navne-.or() ovenfor) af PostgREST. rider_type er en kontrolleret
  // nøgle (RIDER_TYPE_KEYS), så ingen injection i or-strengen.
  if (filters.rider_type) {
    query = query.or(`primary_type.eq.${filters.rider_type},secondary_type.eq.${filters.rider_type}`);
  }

  // #1162: INGEN filter/order på potentiale — kolonnen er ikke klient-læsbar
  // (column privilege), og et server-filter på den ville være en oracle-lækage.

  if (filters.min_age) {
    const maxBirth = new Date(`${CURRENT_YEAR - parseInt(filters.min_age)}-12-31`).toISOString().split("T")[0];
    query = query.lte("birthdate", maxBirth);
  }
  if (filters.max_age) {
    const minBirth = new Date(`${CURRENT_YEAR - parseInt(filters.max_age)}-01-01`).toISOString().split("T")[0];
    query = query.gte("birthdate", minBirth);
  }
  if (filters.u23) {
    const minBirth = new Date(`${CURRENT_YEAR - 23}-01-01`).toISOString().split("T")[0];
    query = query.gte("birthdate", minBirth);
  }

  // Stat range filters
  for (const key of STAT_KEYS) {
    const minVal = parseInt(filters[`${key}_min`]) ?? STAT_MIN_DEFAULT;
    const maxVal = parseInt(filters[`${key}_max`]) ?? STAT_MAX_DEFAULT;
    if (minVal > STAT_MIN_DEFAULT) query = query.gte(key, minVal);
    if (maxVal < STAT_MAX_DEFAULT) query = query.lte(key, maxVal);
  }

  // Sort
  if (filters.sort === "firstname") {
    const asc = filters.sort_dir === "asc";
    query = query.order("lastname", { ascending: asc, nullsFirst: false });
  } else if (filters.sort === "value" || filters.sort === "potentiale" || filters.sort === "_scoutMid") {
    // potentiale/_scoutMid: stale URL/sessionStorage kan stadig bære den gamle
    // sort-nøgle — kolonnen er ikke klient-læsbar (#1162), så ORDER BY ville
    // fejle hele kaldet. Fald tilbage til værdi-sortering.
    query = query.order("market_value", { ascending: filters.sort_dir === "asc", nullsFirst: false });
  } else {
    const sortAsc = filters.sort === "birthdate"
      ? filters.sort_dir === "desc"
      : filters.sort_dir === "asc";
    query = query.order(filters.sort, { ascending: sortAsc, nullsFirst: false });
  }

  return query;
}
