/**
 * useRiderFilters — shared hook for filtering and sorting riders
 * Works both client-side (for small lists) and server-side (for RidersPage)
 */
import { useState, useMemo } from "react";
import { DEFAULT_FILTERS } from "../components/RiderFilters";

const CURRENT_YEAR = new Date().getFullYear();

const STAT_FILTER_KEYS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl","stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];

/**
 * Client-side filter + sort for an array of riders already in memory.
 * Use this on TeamPage, WatchlistPage, AuctionsPage, TransfersPage etc.
 */
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

    // Name search
    if (filters.q) {
      const q = filters.q.toLowerCase();
      result = result.filter(r =>
        `${r.firstname} ${r.lastname}`.toLowerCase().includes(q)
      );
    }

    // UCI range
    if (filters.min_uci) result = result.filter(r => (r.uci_points || 0) >= parseInt(filters.min_uci));
    if (filters.max_uci) result = result.filter(r => (r.uci_points || 0) <= parseInt(filters.max_uci));

    // Age range — calculate from birthdate
    if (filters.min_age || filters.max_age) {
      result = result.filter(r => {
        if (!r.birthdate) return true;
        const age = CURRENT_YEAR - new Date(r.birthdate).getFullYear();
        if (filters.min_age && age < parseInt(filters.min_age)) return false;
        if (filters.max_age && age > parseInt(filters.max_age)) return false;
        return true;
      });
    }

    // U25 / U23
    if (filters.u25) result = result.filter(r => r.is_u25);
    if (filters.u23) result = result.filter(r => {
      if (!r.birthdate) return false;
      return CURRENT_YEAR - new Date(r.birthdate).getFullYear() <= 23;
    });

    // Free agent
    if (filters.free_agent) result = result.filter(r => !r.team_id);

    // Team filter
    if (filters.team_id) result = result.filter(r => r.team_id === filters.team_id);

    // Stat min filters (only apply when value differs from default 50)
    for (const key of STAT_FILTER_KEYS) {
      const minKey = `${key}_min`;
      const val = parseInt(filters[minKey]);
      if (!isNaN(val) && val !== 50 && val > 0) {
        result = result.filter(r => (r[key] || 0) >= val);
      }
    }

    // Sort
    result.sort((a, b) => {
      let aVal, bVal;
      if (filters.sort === "birthdate") {
        aVal = a.birthdate ? new Date(a.birthdate).getFullYear() : 1970;
        bVal = b.birthdate ? new Date(b.birthdate).getFullYear() : 1970;
        // Youngest first = highest birth year first when desc
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

/**
 * Build Supabase query params from filters — for server-side filtering (RidersPage)
 */
export function buildSupabaseQuery(query, filters) {
  if (filters.q) query = query.or(`firstname.ilike.%${filters.q}%,lastname.ilike.%${filters.q}%`);
  if (filters.min_uci) query = query.gte("uci_points", parseInt(filters.min_uci));
  if (filters.max_uci) query = query.lte("uci_points", parseInt(filters.max_uci));
  if (filters.u25) query = query.eq("is_u25", true);
  if (filters.free_agent) query = query.is("team_id", null);
  if (filters.team_id) query = query.eq("team_id", filters.team_id);

  // Age filter via birthdate
  if (filters.min_age) {
    const maxBirth = new Date(`${CURRENT_YEAR - parseInt(filters.min_age)}-12-31`).toISOString().split("T")[0];
    query = query.lte("birthdate", maxBirth);
  }
  if (filters.max_age) {
    const minBirth = new Date(`${CURRENT_YEAR - parseInt(filters.max_age)}-01-01`).toISOString().split("T")[0];
    query = query.gte("birthdate", minBirth);
  }
  // U23
  if (filters.u23) {
    const minBirth = new Date(`${CURRENT_YEAR - 23}-01-01`).toISOString().split("T")[0];
    query = query.gte("birthdate", minBirth);
  }

  // Stat min filters (only apply when value differs from default 50)
  for (const key of STAT_FILTER_KEYS) {
    const minKey = `${key}_min`;
    const val = parseInt(filters[minKey]);
    if (!isNaN(val) && val !== 50 && val > 0) query = query.gte(key, val);
  }

  // Sort
  const sortAsc = filters.sort === "birthdate"
    ? filters.sort_dir === "desc" // youngest first = descending birthdate
    : filters.sort_dir === "asc";

  query = query.order(filters.sort, { ascending: sortAsc, nullsFirst: false });
  return query;
}
