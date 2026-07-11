// auctionHistorySort — whitelist for server-side kolonne-sort på auktions-
// historikken (#2293). AuctionHistoryPage queryer Supabase direkte fra
// klienten (intet backend-endpoint for historik findes), så whitelisten
// lever her og bruges til at bygge .order()-kaldene i loadAuctions().
//
// Kun DIREKTE kolonner på `auctions`-tabellen er sorterbare server-side, og
// kun dem hvor rækkefølgen reelt varierer. Nation/Rytter/Sælger/Vinder er
// joined/afledt data, Bud er en client-side aggregation af auction_bids pr.
// synlig side (#256), og Status er altid "completed" på historik-fanen (se
// .eq("status","completed") i AuctionHistoryPage) — ingen af dem giver en
// meningsfuld server-side sort uden en anden datamodel (RPC/view), så de er
// bevidst udeladt af whitelisten (se docs/NOW.md / issue #2293).
export const ALLOWED_AUCTION_HISTORY_SORT_KEYS = ["actual_end", "current_price"];

export const DEFAULT_AUCTION_HISTORY_SORT = { sort: "actual_end", dir: "desc" };

/**
 * Ren whitelist-funktion: ukendt/manglende sort-nøgle eller ugyldig retning
 * falder tilbage til default (actual_end desc). Samme mønster som backend
 * /api/riders' allowedSort-array (backend/routes/api.js).
 * @param {string|null|undefined} sort
 * @param {string|null|undefined} dir
 * @returns {{ sort: string, dir: "asc"|"desc" }}
 */
export function resolveAuctionHistorySort(sort, dir) {
  const safeSort = ALLOWED_AUCTION_HISTORY_SORT_KEYS.includes(sort)
    ? sort
    : DEFAULT_AUCTION_HISTORY_SORT.sort;
  const safeDir = dir === "asc" || dir === "desc" ? dir : DEFAULT_AUCTION_HISTORY_SORT.dir;
  return { sort: safeSort, dir: safeDir };
}
