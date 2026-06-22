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

export const LISTING_SORT_OPTIONS = ["newest", "price_asc", "price_desc", "age_asc", "age_desc"];

// Fødselsår = alders-proxy. Ældre rytter = lavere år = højere alder. Manglende
// fødselsdato (eller manglende rytter) sorteres yderst i hver ende.
function birthYear(listing) {
  const bd = listing?.rider?.birthdate;
  return bd ? new Date(bd).getFullYear() : null;
}

export function sortListings(listings, sort = "newest") {
  const arr = [...(listings || [])];
  switch (sort) {
    case "price_asc":
      return arr.sort((a, b) => (a.asking_price || 0) - (b.asking_price || 0));
    case "price_desc":
      return arr.sort((a, b) => (b.asking_price || 0) - (a.asking_price || 0));
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
