/**
 * useRiderFilters — shared hook for filtering and sorting riders
 */
import { useState, useMemo } from "react";
import { DEFAULT_FILTERS, STAT_KEYS } from "../components/RiderFilters";
import { getRiderMarketValue, getRiderSalary } from "./marketValues";
import { buildSalaryFilterOr } from "./salaryFilter.js";
import { getRiderAge, isU23 } from "./riderAge";
import { compareNationality } from "./countryUtils";
import { applyNameSearch } from "./riderNameSearch";
import {
  ABILITY_KEYS, ABILITY_SELECT, ABILITY_SELECT_INNER, ABILITY_TABLE, flattenAbilities,
} from "./abilities";

const CURRENT_YEAR = new Date().getFullYear();

// Evner spænder 1-99 (mod PCM's klumpede 50-85). Et evne-filter er kun "aktivt"
// når en grænse afviger fra fuld skala.
const STAT_MIN_DEFAULT = 0;
const STAT_MAX_DEFAULT = 99;

const ABILITY_SET = new Set(ABILITY_KEYS);

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
    // #1827: filtrér på den VISTE løn (getRiderSalary) — frossen løn hvis sat,
    // ellers estimatet. Et rå `r.salary`-filter droppede free agents (salary NULL).
    if (filters.min_salary) result = result.filter(r => getRiderSalary(r) >= parseInt(filters.min_salary));
    if (filters.max_salary) result = result.filter(r => getRiderSalary(r) <= parseInt(filters.max_salary));

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
    // U23 = samme grænse som u23-badge (isU23: alder < 23, dvs. ≤22 år) — delt
    // helper så filter + badge aldrig divergerer. En 23-årig bærer u25-badge og
    // må derfor IKKE matche U23-filteret (#42).
    if (filters.u23) result = result.filter(r => isU23(r.birthdate));

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
      // Ryttertype (#1482) sorteres alfabetisk på den primære type — samme fælde
      // som nationality_code: strenge i den numeriske gren nedenfor ville give NaN.
      // Ryttere uden type ("") samles i hver sin ende afhængigt af retning.
      if (filters.sort === "primary_type") {
        const cmp = (a.primary_type || "").localeCompare(b.primary_type || "");
        return filters.sort_dir === "desc" ? -cmp : cmp;
      }
      // Hold (#1755): team_id er en UUID-streng → den numeriske gren nedenfor
      // ville give NaN og en død "Hold"-header. Sortér på holdnavn via team-
      // relationen (hentet som team:team_id(id,name)); frie ryttere (intet hold)
      // samles i hver sin ende afhængigt af retning.
      if (filters.sort === "team_id") {
        const cmp = (a.team?.name || "").localeCompare(b.team?.name || "");
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

function anyAbilityFilterActive(filters) {
  return ABILITY_KEYS.some((key) => {
    const minVal = parseInt(filters[`${key}_min`]);
    const maxVal = parseInt(filters[`${key}_max`]);
    return (Number.isFinite(minVal) && minVal > STAT_MIN_DEFAULT)
      || (Number.isFinite(maxVal) && maxVal < STAT_MAX_DEFAULT);
  });
}

// Riders-kolonne-filtre. prefix=""/ref=null når vi driver fra riders; prefix="riders."
// + ref="riders" når riders er embedded (drevet fra rider_derived_abilities ved evne-sort).
function applyRiderColumnFilters(query, filters, { prefix = "", ref = null } = {}) {
  const col = (c) => `${prefix}${c}`;
  query = query.eq(col("is_retired"), false);
  query = applyNameSearch(query, filters.q, ref ? { referencedTable: ref } : undefined); // #47 token-set
  if (filters.min_value) query = query.gte(col("market_value"), parseInt(filters.min_value));
  if (filters.max_value) query = query.lte(col("market_value"), parseInt(filters.max_value));

  // #1827: løn-filteret gælder den VISTE løn = COALESCE(salary, market_value*RATE).
  // Rå `salary.gte/lte` droppede stille alle NULL-løn-ryttere (alle free agents +
  // 716 kontraktløse seniorer i prod) → "fri agent + max-løn" gav næsten 0 hits.
  const salaryOr = buildSalaryFilterOr(filters);
  if (salaryOr) {
    query = ref ? query.or(salaryOr, { referencedTable: ref }) : query.or(salaryOr);
  }

  if (filters.u25) query = query.eq(col("is_u25"), true);
  if (filters.free_agent) query = query.is(col("team_id"), null);
  if (filters.team_id) query = query.eq(col("team_id"), filters.team_id);
  if (filters.nationality_code) query = query.eq(col("nationality_code"), filters.nationality_code);

  // Ryttertype (#49): primær ELLER sekundær. Kontrolleret nøgle (RIDER_TYPE_KEYS) → ingen injection.
  if (filters.rider_type) {
    const orStr = `primary_type.eq.${filters.rider_type},secondary_type.eq.${filters.rider_type}`;
    query = ref ? query.or(orStr, { referencedTable: ref }) : query.or(orStr);
  }

  // #1162: INGEN filter/order på potentiale — ikke klient-læsbar (oracle-lækage).

  if (filters.min_age) {
    const maxBirth = new Date(`${CURRENT_YEAR - parseInt(filters.min_age)}-12-31`).toISOString().split("T")[0];
    query = query.lte(col("birthdate"), maxBirth);
  }
  if (filters.max_age) {
    const minBirth = new Date(`${CURRENT_YEAR - parseInt(filters.max_age)}-01-01`).toISOString().split("T")[0];
    query = query.gte(col("birthdate"), minBirth);
  }
  if (filters.u23) {
    // Match u23-badge-grænsen (riderAge.js: alder < 23, dvs. ≤22 år). Yngste
    // 23-årige er født CURRENT_YEAR-23 og bærer u25-badge — de skal ekskluderes,
    // så nedre fødselsår-grænse er CURRENT_YEAR-22 (≤22 år), ikke -23 (#42).
    const minBirth = new Date(`${CURRENT_YEAR - 22}-01-01`).toISOString().split("T")[0];
    query = query.gte(col("birthdate"), minBirth);
  }
  return query;
}

// Evne-range-filtre. prefix="" når abilities er top-level (drevet fra rider_derived_abilities);
// prefix="rider_derived_abilities." når abilities er embedded (drevet fra riders — kræver !inner).
function applyAbilityFilters(query, filters, { prefix = "" } = {}) {
  for (const key of ABILITY_KEYS) {
    const minVal = parseInt(filters[`${key}_min`]);
    const maxVal = parseInt(filters[`${key}_max`]);
    if (Number.isFinite(minVal) && minVal > STAT_MIN_DEFAULT) query = query.gte(`${prefix}${key}`, minVal);
    if (Number.isFinite(maxVal) && maxVal < STAT_MAX_DEFAULT) query = query.lte(`${prefix}${key}`, maxVal);
  }
  return query;
}

function applyRiderColumnSort(query, filters) {
  if (filters.sort === "firstname") {
    return query.order("lastname", { ascending: filters.sort_dir === "asc", nullsFirst: false });
  }
  if (filters.sort === "value" || filters.sort === "potentiale" || filters.sort === "_scoutMid") {
    // potentiale/_scoutMid: stale URL/sessionStorage kan bære den gamle sort-nøgle —
    // ikke klient-læsbar (#1162). Fald tilbage til værdi-sortering.
    return query.order("market_value", { ascending: filters.sort_dir === "asc", nullsFirst: false });
  }
  const sortAsc = filters.sort === "birthdate" ? filters.sort_dir === "desc" : filters.sort_dir === "asc";
  return query.order(filters.sort, { ascending: sortAsc, nullsFirst: false });
}

// Henter én side af rytter-DB'en (server-pagineret). Sortering på en EVNE-kolonne
// driver fra rider_derived_abilities (native order — PostgREST kan IKKE re-ordne
// parent-rækker via et embedded to-one; verificeret 2026-06-19) med riders som
// !inner-embed og riders-filtrene anvendt embedded. Al anden sortering driver fra
// riders med abilities embedded (!inner kun når et evne-filter er aktivt, ellers
// left join så evne-løse ryttere stadig vises). Evnerne flades op på rytter-objektet
// (rider.climbing osv.) så render + klient-sort virker uændret.
export async function fetchRidersPage(supabase, { filters, page, pageSize = 50, riderSelect }) {
  const from = (page - 1) * pageSize;
  const to = page * pageSize - 1;

  if (ABILITY_SET.has(filters.sort)) {
    let q = supabase
      .from(ABILITY_TABLE)
      .select(`${ABILITY_KEYS.join(", ")}, riders!inner(${riderSelect})`, { count: "exact" })
      .range(from, to);
    q = applyRiderColumnFilters(q, filters, { prefix: "riders.", ref: "riders" });
    q = applyAbilityFilters(q, filters, { prefix: "" });
    q = q.order(filters.sort, { ascending: filters.sort_dir === "asc", nullsFirst: false });
    const { data, count, error } = await q;
    if (error) throw error;
    const rows = (data || []).map((row) => {
      const abil = {};
      for (const k of ABILITY_KEYS) abil[k] = row[k];
      return { ...(row.riders || {}), ...abil, abilities: abil };
    });
    return { rows, count: count || 0 };
  }

  const abilSelect = anyAbilityFilterActive(filters) ? ABILITY_SELECT_INNER : ABILITY_SELECT;
  let q = supabase
    .from("riders")
    .select(`${riderSelect}, ${abilSelect}`, { count: "exact" })
    .range(from, to);
  q = applyRiderColumnFilters(q, filters, { prefix: "" });
  q = applyAbilityFilters(q, filters, { prefix: `${ABILITY_TABLE}.` });
  q = applyRiderColumnSort(q, filters);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data || []).map(flattenAbilities), count: count || 0 };
}
