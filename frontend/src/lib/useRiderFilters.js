/**
 * useRiderFilters — shared hook for filtering and sorting riders
 */
import { useState, useMemo } from "react";
import { DEFAULT_FILTERS, STAT_KEYS } from "../components/RiderFilters";

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
    let result = [...riders];

    if (filters.q) {
      const q = filters.q.toLowerCase();
      result = result.filter(r => `${r.firstname} ${r.lastname}`.toLowerCase().includes(q));
    }

    if (filters.min_uci) result = result.filter(r => (r.uci_points || 0) * 4000 >= parseInt(filters.min_uci));
    if (filters.max_uci) result = result.filter(r => (r.uci_points || 0) * 4000 <= parseInt(filters.max_uci));
    if (filters.min_salary) result = result.filter(r => (r.salary || 0) >= parseInt(filters.min_salary));
    if (filters.max_salary) result = result.filter(r => (r.salary || 0) <= parseInt(filters.max_salary));

    if (filters.min_age || filters.max_age) {
      result = result.filter(r => {
        if (!r.birthdate) return true;
        const age = CURRENT_YEAR - new Date(r.birthdate).getFullYear();
        if (filters.min_age && age < parseInt(filters.min_age)) return false;
        if (filters.max_age && age > parseInt(filters.max_age)) return false;
        return true;
      });
    }

    if (filters.u25) result = result.filter(r => r.is_u25);
    if (filters.u23) result = result.filter(r => {
      if (!r.birthdate) return false;
      return CURRENT_YEAR - new Date(r.birthdate).getFullYear() <= 23;
    });

    if (filters.free_agent) result = result.filter(r => !r.team_id);
    if (filters.team_id) result = result.filter(r => r.team_id === filters.team_id);

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
      let aVal, bVal;
      if (filters.sort === "birthdate") {
        aVal = a.birthdate ? new Date(a.birthdate).getFullYear() : 1970;
        bVal = b.birthdate ? new Date(b.birthdate).getFullYear() : 1970;
      } else {
        aVal = a[filters.sort] || 0;
        bVal = b[filters.sort] || 0;
      }
      return filters.sort_dir === "desc" ? bVal - aVal : aVal - bVal;
    });

    return result;
  }, [riders, filters]);

  return { filters, onChange, onReset, filtered };
}

export function buildSupabaseQuery(query, filters) {
  if (filters.q) query = query.or(`firstname.ilike.%${filters.q}%,lastname.ilike.%${filters.q}%`);
  if (filters.min_uci) query = query.gte("uci_points", Math.ceil(parseInt(filters.min_uci) / 4000));
  if (filters.max_uci) query = query.lte("uci_points", Math.floor(parseInt(filters.max_uci) / 4000));
  if (filters.min_salary) query = query.gte("salary", parseInt(filters.min_salary));
  if (filters.max_salary) query = query.lte("salary", parseInt(filters.max_salary));
  if (filters.u25) query = query.eq("is_u25", true);
  if (filters.free_agent) query = query.is("team_id", null);
  if (filters.team_id) query = query.eq("team_id", filters.team_id);

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
  } else {
    const sortAsc = filters.sort === "birthdate"
      ? filters.sort_dir === "desc"
      : filters.sort_dir === "asc";
    query = query.order(filters.sort, { ascending: sortAsc, nullsFirst: false });
  }

  return query;
}
