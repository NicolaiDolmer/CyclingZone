// #6237 — test-hjælper: in-memory svar for de to tabeller availableBalance.js
// læser (auctions + auction_proxy_bids), så eksisterende service-mocks kan
// bære disponibel-saldo-gaten uden at gentage kæde-boilerplate.
// leading: [{ id, current_price }], proxies: [{ auction_id, max_amount, auction: { status } }]
export function isAuctionCommitmentTable(table) {
  return table === "auctions" || table === "auction_proxy_bids";
}

export function auctionCommitmentTable(table, { leading = [], proxies = [] } = {}) {
  const rows = table === "auctions" ? leading : proxies;
  const chain = {
    select() { return chain; },
    in() { return chain; },
    eq() { return chain; },
    then(resolve, reject) {
      return Promise.resolve({ data: JSON.parse(JSON.stringify(rows)), error: null }).then(resolve, reject);
    },
  };
  return chain;
}
