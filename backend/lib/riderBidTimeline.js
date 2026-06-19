// Bygger live bud-timeline for én rytter — hentet via
// GET /api/riders/:id/bid-timeline. Bruges på rytter-profil til at vise
// auktionens bud-historik mens den kører, og kun final-bud når den er afsluttet.
//
// Privacy-kontrakt (vision-låst 2026-05-08, issue #195; udvidet 2026-05-12, issue #315):
//   - proxy_max / max_amount må ALDRIG eksponeres (poker-vision: skjul strategi)
//   - Aktiv/extended auktion: { team_id, team_name, amount, bid_time, is_proxy } per bud
//   - Afsluttet auktion: KUN { final_bid, winner_team_id, winner_name, seller_team_id, seller_name, completed_at }
//   - team_id-felter er public (samme synlighed som team_name) — bruges af frontend til at linke holdnavn → /teams/:id
//
// Privacy-invariant håndhæves via PUBLIC_KEYS-whitelist + runtime-assertion på
// returnerede objekter. Fremtidig kode kan ikke uforvarende lække proxy-loft.

export const TIMELINE_BID_KEYS = ["team_id", "team_name", "amount", "bid_time", "is_proxy"];
export const COMPLETED_KEYS = [
  "final_bid",
  "winner_team_id",
  "winner_name",
  "seller_team_id",
  "seller_name",
  "completed_at",
];
const FORBIDDEN_KEYS = ["proxy_max", "max_amount", "max_bid", "auto_bid_max"];

function assertNoForbiddenKeys(obj, label) {
  for (const key of FORBIDDEN_KEYS) {
    if (key in obj) {
      throw new Error(`riderBidTimeline privacy violation: "${key}" must never appear in ${label}`);
    }
  }
}

function pickTimelineBid(bid) {
  return {
    team_id: bid.team?.id ?? null,
    team_name: bid.team?.name ?? null,
    amount: bid.amount,
    bid_time: bid.bid_time,
    is_proxy: bid.is_proxy === true,
  };
}

export async function buildRiderBidTimeline(supabase, riderId) {
  // Find seneste auktion for rytter — prioritér aktiv/extended; ellers seneste completed.
  const { data: liveAuction } = await supabase
    .from("auctions")
    .select("id, status, current_price, calculated_end, actual_end, seller:seller_team_id(id, name), winner:current_bidder_id(id, name)")
    .eq("rider_id", riderId)
    .in("status", ["active", "extended"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let auction = liveAuction;

  if (!auction) {
    const { data: completedAuction } = await supabase
      .from("auctions")
      .select("id, status, current_price, calculated_end, actual_end, seller:seller_team_id(id, name), winner:current_bidder_id(id, name)")
      .eq("rider_id", riderId)
      .eq("status", "completed")
      .order("actual_end", { ascending: false })
      .limit(1)
      .maybeSingle();
    auction = completedAuction;
  }

  if (!auction) {
    return { auction_id: null, status: null };
  }

  if (auction.status === "completed") {
    const payload = {
      auction_id: auction.id,
      status: "completed",
      final_bid: auction.current_price,
      winner_team_id: auction.winner?.id ?? null,
      winner_name: auction.winner?.name ?? null,
      seller_team_id: auction.seller?.id ?? null,
      seller_name: auction.seller?.name ?? null,
      completed_at: auction.actual_end,
    };
    assertNoForbiddenKeys(payload, "completed-auction payload");
    return payload;
  }

  // Aktiv eller extended → hent bud-timeline
  const { data: bids } = await supabase
    .from("auction_bids")
    .select("amount, bid_time, is_proxy, team:team_id(id, name)")
    .eq("auction_id", auction.id)
    .order("bid_time", { ascending: true })
    // #249: stabil tie-break når flere bud deler ét bid_time (et manuelt bud og de
    // proxy/cascade-bud det udløser får samme timestamp). amount stigende her →
    // frontend reverser timelinen til visning → højeste bud øverst ved tie.
    .order("amount", { ascending: true });

  const timeline = (bids || []).map(pickTimelineBid);
  for (const entry of timeline) {
    assertNoForbiddenKeys(entry, "active-auction bid entry");
  }

  const payload = {
    auction_id: auction.id,
    status: auction.status,
    current_price: auction.current_price,
    calculated_end: auction.calculated_end,
    bid_timeline: timeline,
  };
  assertNoForbiddenKeys(payload, "active-auction payload");
  return payload;
}
