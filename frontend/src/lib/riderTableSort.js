import { getRiderMarketValue } from "./marketValues.js";
import { compareNationality } from "./countryUtils.js";

/**
 * riderTableSort — delt sorteringslogik for rytter-tabeller uden fuld
 * filter-pipeline (fx TeamProfilePage's trup-tabel).
 *
 * #1092: Værdi-kolonnen VISER getRiderMarketValue(r) — sortering skal bruge
 * præcis samme udledte værdi, ikke en rå kolonne. "Mit Hold" gør det allerede
 * rigtigt via useRiderFilters (sort === "value" → getRiderMarketValue); før
 * #1101-cutover sorterede TeamProfilePage på den frosne uci_points og gav
 * forkert rækkefølge. Generisk `r[key] || 0` må ikke bruges til værdi-kolonnen.
 */
export function sortRidersForTable(riders, { key, dir } = {}) {
  return [...riders].sort((a, b) => {
    if (key === "firstname") {
      const an = `${a.lastname} ${a.firstname}`.toLowerCase();
      const bn = `${b.lastname} ${b.firstname}`.toLowerCase();
      return dir === "desc" ? bn.localeCompare(an) : an.localeCompare(bn);
    }
    // Nation sorteres på den viste IOC-kode, ikke rå ISO2 (#802).
    if (key === "nationality_code") {
      const cmp = compareNationality(a.nationality_code, b.nationality_code);
      return dir === "desc" ? -cmp : cmp;
    }
    // #1755: ryttertype alfabetisk på primær type (samme fælde som nationality_code
    // — strenge i den numeriske gren nedenfor ville give NaN). Type-løse i hver ende.
    if (key === "primary_type") {
      const cmp = (a.primary_type || "").localeCompare(b.primary_type || "");
      return dir === "desc" ? -cmp : cmp;
    }
    let av, bv;
    if (key === "market_value") {
      av = getRiderMarketValue(a);
      bv = getRiderMarketValue(b);
    } else if (key === "birthdate") {
      // #1755: alders-sort = på fødselsår (ældre rytter = lavere år = højere alder).
      // Manglende fødselsdato falder i ældste ende (1970) som i useRiderFilters.
      av = a.birthdate ? new Date(a.birthdate).getFullYear() : 1970;
      bv = b.birthdate ? new Date(b.birthdate).getFullYear() : 1970;
    } else {
      av = a[key] || 0;
      bv = b[key] || 0;
    }
    return dir === "desc" ? bv - av : av - bv;
  });
}
