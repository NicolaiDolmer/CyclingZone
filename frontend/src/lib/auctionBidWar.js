// #3401 · Post-hammerslag budkrig-reveal — rene hjælpefunktioner udtrukket fra
// AuctionBidWarModal.jsx så kronologi-/vinder-logikken har direkte testdækning
// uden at skulle rendere React. Arbejder KUN på auction_bids-rækker (team_id,
// amount, bid_time) — rører aldrig auction_proxy_bids (fair-play-grænsen,
// se AuctionBidWarModal.jsx's doc-comment).

export function sortBidsChronologically(bids) {
  return [...(bids || [])].sort(
    (a, b) => new Date(a.bid_time).getTime() - new Date(b.bid_time).getTime()
  );
}

// Det vindende bud er det SIDSTE i kronologisk rækkefølge. winnerId (auktionens
// current_bidder_id) bruges som ekstra bekræftelse når den er kendt; er den
// ikke sendt med, falder funktionen tilbage til "sidste bud i rækken" (samme
// konklusion i praksis, da auction_bids kun indeholder realiserede bud og det
// sidste ALTID er det der vandt for en afsluttet auktion).
export function isWinningBid({ bid, index, orderedBids, winnerId }) {
  if (!bid || !orderedBids?.length) return false;
  if (index !== orderedBids.length - 1) return false;
  if (!winnerId) return true;
  return bid.team_id === winnerId;
}
