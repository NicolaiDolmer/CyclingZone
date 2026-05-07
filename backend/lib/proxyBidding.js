import { getMinimumAuctionBid } from "./auctionRules.js";
import { checkBidExtension, isAuctionExpired } from "./auctionEngine.js";

const MAX_PROXY_ITERATIONS = 30;

// Runs after each bid. Finds competing proxy bids and places automatic
// counter-bids until no proxy can challenge or the auction expires.
//
// Algorithm:
//   Each iteration finds challengers (proxies from non-winning teams that can bid).
//   If winner has a proxy that beats the top challenger → winner counters just above
//     challenger's max; loop ends (challenger exhausted).
//   If challenger's max beats winner's proxy → challenger takes over at
//     getMinimumAuctionBid(winner.max); previous winner gets "auction_proxy_outbid".
//   If winner has no proxy → challenger bids at minimum; loop continues for more challengers.
export async function resolveProxyBids({
  supabase,
  auctionId,
  bidTime,
  bidCfg,
  notifyTeamOwner,
}) {
  for (let i = 0; i < MAX_PROXY_ITERATIONS; i++) {
    const { data: auction } = await supabase
      .from("auctions")
      .select("*, rider:rider_id(firstname, lastname)")
      .eq("id", auctionId)
      .single();

    if (!auction || !["active", "extended"].includes(auction.status)) break;
    if (isAuctionExpired(auction.calculated_end)) break;

    const currentPrice = auction.current_price;
    const currentWinner = auction.current_bidder_id;
    const minBid = getMinimumAuctionBid(currentPrice);

    const { data: proxies } = await supabase
      .from("auction_proxy_bids")
      .select("*")
      .eq("auction_id", auctionId);

    const allProxies = proxies || [];
    const challengers = allProxies
      .filter(p => p.team_id !== currentWinner && p.max_amount >= minBid)
      .sort((a, b) => b.max_amount - a.max_amount);

    if (challengers.length === 0) break;

    const topChallenger = challengers[0];
    const winnerProxy = allProxies.find(p => p.team_id === currentWinner);

    let autoBidAmount;
    let autoBidder;
    let exhaustedTeam = null;

    if (winnerProxy && winnerProxy.max_amount >= getMinimumAuctionBid(topChallenger.max_amount)) {
      // Winner's proxy beats top challenger's max — bid just above challenger's max
      autoBidAmount = Math.min(
        winnerProxy.max_amount,
        getMinimumAuctionBid(topChallenger.max_amount)
      );
      autoBidder = currentWinner;
    } else if (winnerProxy) {
      // Challenger's max beats winner's max
      autoBidAmount = Math.min(
        topChallenger.max_amount,
        getMinimumAuctionBid(winnerProxy.max_amount)
      );
      autoBidder = topChallenger.team_id;
      exhaustedTeam = currentWinner;
    } else {
      // Winner has no proxy — challenger bids at minimum
      autoBidAmount = Math.min(topChallenger.max_amount, minBid);
      autoBidder = topChallenger.team_id;
    }

    if (autoBidAmount <= currentPrice || autoBidAmount < minBid) break;

    const { shouldExtend, newEnd } = checkBidExtension(bidTime, auction.calculated_end, bidCfg);

    await supabase.from("auction_bids").insert({
      auction_id: auctionId,
      team_id: autoBidder,
      amount: autoBidAmount,
      bid_time: bidTime.toISOString(),
      triggered_extension: shouldExtend,
      is_proxy: true,
    });

    const updates = {
      current_price: autoBidAmount,
      current_bidder_id: autoBidder,
    };
    if (shouldExtend) {
      updates.calculated_end = newEnd.toISOString();
      updates.status = "extended";
      updates.extension_count = (auction.extension_count || 0) + 1;
    }
    await supabase.from("auctions").update(updates).eq("id", auctionId);

    const riderName = `${auction.rider.firstname} ${auction.rider.lastname}`;

    if (notifyTeamOwner) {
      if (exhaustedTeam) {
        // Proxy was beaten by a higher max
        await notifyTeamOwner(
          exhaustedTeam,
          "auction_proxy_outbid",
          "Din auto-by er stoppet",
          `Din auto-by på ${riderName} nåede sit max-loft og er overbudt`,
          auctionId
        ).catch(() => {});
      } else if (autoBidder !== currentWinner && currentWinner) {
        // Challenger took over, current winner had no proxy (normal outbid via proxy)
        await notifyTeamOwner(
          currentWinner,
          "auction_outbid",
          "Du er blevet overbudt!",
          `Du er overbudt på ${riderName}`,
          auctionId
        ).catch(() => {});
      }
    }

    // Winner countered challenger successfully — no more iterations needed
    if (autoBidder === currentWinner) break;
  }
}
