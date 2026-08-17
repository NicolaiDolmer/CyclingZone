// riderColumnSort — ren rytter-sort-komparator/merge-logik.
//
// #803-mønster (se salaryFilter.js's tilsvarende kommentar): udskilt fra
// useRiderFilters.js, som transitivt (via RiderFilters-komponenten) trækker
// JSX/React ind. Vite/esbuild tilgiver extensionless imports i den kæde, men
// Node's ESM-loader (node --test, CI) gør ikke — et forsøg på at importere
// useRiderFilters.js direkte fra en node --test-fil fejler derfor med
// ERR_MODULE_NOT_FOUND. Denne fil har KUN rene imports (marketValues.js,
// countryUtils.js) og kan importeres frit fra tests.
import { getRiderMarketValue, getRiderSalary } from "./marketValues.js";
import { compareNationality } from "./countryUtils.js";

// #2403: delt rytter-sort-komparator for KLIENT-sortering (auktioner, transfer-
// markedets riderFilters-instans, eget hold, watchlist — alle driver via
// useClientRiderFilters i useRiderFilters.js). Server-sortering (fetchRidersPage/
// RidersPage) har sin egen sti — se mergeSalarySortedIds nedenfor.
export function compareRidersByFilter(a, b, filters) {
  if (filters.sort === "firstname") {
    const aName = `${a.lastname} ${a.firstname}`.toLowerCase();
    const bName = `${b.lastname} ${b.firstname}`.toLowerCase();
    // #1950: pin to 'en' so the client-side name sort matches the server
    // path (applyRiderColumnSort → Postgres .order('lastname'), literal
    // 'aa'). Bare localeCompare() resolves to da-DK in a Danish browser and
    // treats 'aa' as 'å', so the server-vs-client split disagreed on order.
    return filters.sort_dir === "desc" ? bName.localeCompare(aName, "en") : aName.localeCompare(bName, "en");
  }
  // Nation sorteres på den viste IOC-kode (#802) — den generiske numeriske
  // gren nedenfor ville give NaN på strenge og dermed ustabil rækkefølge.
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
  } else if (filters.sort === "salary") {
    // #2403: sortér på den VISTE løn (getRiderSalary: frossen kontrakt-løn hvis
    // sat, ellers estimatet current_production_value × global sats) — ikke den
    // rå salary-kolonne. Den generiske gren nedenfor (`a[filters.sort] || 0`)
    // gav 0 for enhver rytter med salary NULL (free agents m.fl.), som dermed
    // klumpede i bunden uanset deres faktisk viste (estimerede) løn.
    aVal = getRiderSalary(a);
    bVal = getRiderSalary(b);
  } else {
    aVal = a[filters.sort] || 0;
    bVal = b[filters.sort] || 0;
  }
  return filters.sort_dir === "desc" ? bVal - aVal : aVal - bVal;
}

// #2403: rytter-DB'ens rå `salary`-kolonne matcher ikke altid den VISTE løn
// (getRiderSalary: frossen kontrakt-løn hvis sat, ellers current_production_value
// × global sats — marketValues.js). PostgREST kan ikke ORDER BY et COALESCE-
// udtryk, så løn-sortering diverteres i fetchRidersPage (useRiderFilters.js) FØR
// applyRiderColumnSort til en to-grens fetch+merge (samme mønster som løn-
// FILTERET, buildSalaryFilterOr, #1827): hent ID + sammenligningsværdi
// letvægts fra begge grene (salary IS NOT NULL / IS NULL), flet dem til én
// global rækkefølge HER med den ÆGTE getRiderSalary-formel, og udsnit siden
// derfra. Ingen generated kolonne/migration nødvendig.
export function mergeSalarySortedIds(withSalaryRows = [], withoutSalaryRows = [], ascending = false) {
  const effectiveValue = (row, hasFrozenSalary) => hasFrozenSalary
    ? Number(row.salary)
    : getRiderSalary({ current_production_value: row.current_production_value });

  const merged = [
    ...withSalaryRows.map(r => ({ id: r.id, value: effectiveValue(r, true) })),
    ...withoutSalaryRows.map(r => ({ id: r.id, value: effectiveValue(r, false) })),
  ];
  merged.sort((a, b) => {
    if (a.value !== b.value) return ascending ? a.value - b.value : b.value - a.value;
    // Stabil tie-break (fx flere free agents med samme estimat-gulv) så
    // rækkefølgen er deterministisk på tværs af sider.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return merged.map(m => m.id);
}
