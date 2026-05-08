// #196: Realtime UX-helpers for /auctions — toast/pulse/sidebar-feed/ticker.
// Holdt som pure functions så kanal-handleren i AuctionsPage forbliver tynd
// og logikken testes uden DOM eller Supabase-mocks.

/**
 * True hvis et auction UPDATE betyder at MIG blev overbudt.
 * Kun true når current_bidder_id skifter FRA mig TIL en anden manager —
 * ikke når jeg byder selv (mig→mig), ikke når mit eget proxy auto-eskalerer
 * (mig→mig), og ikke når auktionen nulstilles (mig→null).
 */
export function isOverbidEvent(prev, next, myTeamId) {
  if (!prev || !next || !myTeamId) return false;
  return (
    prev.current_bidder_id === myTeamId &&
    next.current_bidder_id !== myTeamId &&
    next.current_bidder_id != null
  );
}

/**
 * True hvis pris-cellen skal pulse — dvs. current_price faktisk ændrede sig.
 * Bruges af AuctionsPage til at trigge en 1.5s flash-animation.
 */
export function shouldFlashPrice(prev, next) {
  if (!prev || !next) return false;
  return prev.current_price !== next.current_price;
}

/**
 * Filtrerer bud-events til kun de auktioner brugeren faktisk deltager i —
 * dvs. har afgivet manuelt bud på ELLER har et aktivt proxy på.
 * Sidebar-feed viser kun "din side af bordet" så strategien forbliver privat.
 */
export function filterBidEventsForFeed(events, myParticipatingAuctionIds) {
  const allow = myParticipatingAuctionIds instanceof Set
    ? myParticipatingAuctionIds
    : new Set(myParticipatingAuctionIds);
  return events.filter(e => allow.has(e.auction_id));
}

/**
 * Returnerer Set af auction-id'er hvor brugeren har manuel bid eller aktiv proxy.
 * Modtager auctions-array hvor hver auction kan have myHighestBid/myProxyMax sat.
 */
export function getMyParticipatingAuctionIds(auctions) {
  const ids = new Set();
  for (const a of auctions) {
    if (a?.myHighestBid != null || a?.myProxyMax != null) ids.add(a.id);
  }
  return ids;
}

/**
 * Beholder kun bud-events nyere end now - windowMs.
 * Bruges af aggregat-tickeren ("X nye bud i sidste 30s") og holder
 * sidebar-feed bounded så hukommelsen ikke vokser ubegrænset.
 */
export function pruneStaleBidEvents(events, now, windowMs) {
  const cutoff = now - windowMs;
  return events.filter(e => e.ts > cutoff);
}
