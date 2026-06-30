// Sortering af transferlistens market-listings (#1185).
//
// RiderFilters/useClientRiderFilters styrer kun HVILKE listings der vises
// (rytter-niveau filtrering) — rækkefølgen ignoreres bevidst der, fordi
// asking_price/created_at bor på LISTINGEN, ikke rytteren. Denne helper
// sorterer på listing-niveau og er ren (muterer ikke input).
//
// #1755: alders-sort tilføjet (rytter-niveau). Transferlisten kunne tidligere
// KUN sorteres på listing-attributter (pris/dato) — universel-sortering-sweepet
// kræver at alder kan sorteres alle steder ryttere listes. Alderen bor på
// listing.rider.birthdate, så den læses derfra; listings uden rytter falder bagest.
//
// #2031: evne-sort + markedsværdi-sort tilføjet. De 15 CZ-evner er fladtgjort op
// på listing.rider[<abilityKey>] ved load (flattenAbilities i TransfersPage), så
// fx listing.rider.climbing er et tal direkte. Evne-sort følger riderSort-
// konventionen: numerisk, højest først. Listings uden rytter/evne falder bagest.

import { ABILITY_KEYS } from "./abilities.js";
import { getRiderMarketValue } from "./marketValues.js";

// Evne-sort-nøgler: én pr. evne, formen "ability_<key>" (højest først). Afledt af
// ABILITY_KEYS (SSOT), så listen aldrig kan divergere fra de viste evne-kolonner.
export const ABILITY_SORT_KEYS = ABILITY_KEYS.map((k) => `ability_${k}`);

export const LISTING_SORT_OPTIONS = [
  "newest",
  "price_asc",
  "price_desc",
  "value_desc",
  "value_asc",
  "age_asc",
  "age_desc",
  ...ABILITY_SORT_KEYS,
];

// Fødselsår = alders-proxy. Ældre rytter = lavere år = højere alder. Manglende
// fødselsdato (eller manglende rytter) sorteres yderst i hver ende.
function birthYear(listing) {
  const bd = listing?.rider?.birthdate;
  return bd ? new Date(bd).getFullYear() : null;
}

// Numerisk evne-værdi på den fladtgjorte rytter. Manglende rytter/evne → null,
// så kalderen kan skubbe den bagest uanset sorteringsretning.
function abilityValue(listing, abilityKey) {
  const v = listing?.rider?.[abilityKey];
  return typeof v === "number" ? v : null;
}

export function sortListings(listings, sort = "newest") {
  const arr = [...(listings || [])];

  // Evne-sort: "ability_<key>" → numerisk, højest først, ukendt bagest.
  if (typeof sort === "string" && sort.startsWith("ability_")) {
    const abilityKey = sort.slice("ability_".length);
    if (ABILITY_KEYS.includes(abilityKey)) {
      return arr.sort(
        (a, b) => (abilityValue(b, abilityKey) ?? -Infinity) - (abilityValue(a, abilityKey) ?? -Infinity)
      );
    }
    // Ukendt evne-nøgle → fald tilbage til newest nedenfor.
  }

  switch (sort) {
    case "price_asc":
      return arr.sort((a, b) => (a.asking_price || 0) - (b.asking_price || 0));
    case "price_desc":
      return arr.sort((a, b) => (b.asking_price || 0) - (a.asking_price || 0));
    case "value_desc":
      // Højeste markedsværdi først. Rytterens market_value (fallback i marketValues).
      return arr.sort((a, b) => getRiderMarketValue(b.rider) - getRiderMarketValue(a.rider));
    case "value_asc":
      return arr.sort((a, b) => getRiderMarketValue(a.rider) - getRiderMarketValue(b.rider));
    case "age_asc":
      // Yngst først = højeste fødselsår først. Ukendt alder bagest.
      return arr.sort((a, b) => (birthYear(b) ?? -Infinity) - (birthYear(a) ?? -Infinity));
    case "age_desc":
      // Ældst først = laveste fødselsår først. Ukendt alder bagest.
      return arr.sort((a, b) => (birthYear(a) ?? Infinity) - (birthYear(b) ?? Infinity));
    case "newest":
    default:
      // API'et leverer allerede created_at desc, men sortér eksplicit så
      // toggling tilbage til "newest" altid genskaber rækkefølgen.
      return arr.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }
}
