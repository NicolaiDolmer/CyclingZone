// Sortering af transferlistens market-listings (#1185).
//
// RiderFilters/useClientRiderFilters styrer kun HVILKE listings der vises
// (rytter-niveau filtrering) — rækkefølgen ignoreres bevidst der, fordi
// asking_price/created_at bor på LISTINGEN, ikke rytteren. Denne helper
// sorterer på listing-niveau og er ren (muterer ikke input).

export const LISTING_SORT_OPTIONS = ["newest", "price_asc", "price_desc"];

export function sortListings(listings, sort = "newest") {
  const arr = [...(listings || [])];
  switch (sort) {
    case "price_asc":
      return arr.sort((a, b) => (a.asking_price || 0) - (b.asking_price || 0));
    case "price_desc":
      return arr.sort((a, b) => (b.asking_price || 0) - (a.asking_price || 0));
    case "newest":
    default:
      // API'et leverer allerede created_at desc, men sortér eksplicit så
      // toggling tilbage til "newest" altid genskaber rækkefølgen.
      return arr.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }
}
