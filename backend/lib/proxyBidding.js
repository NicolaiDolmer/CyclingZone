import { getMinimumAuctionBid } from "./auctionRules.js";
import { checkBidExtension, isAuctionExpired } from "./auctionEngine.js";

const MAX_PROXY_ITERATIONS = 30;

// Runs after each bid. Finds competing proxy bids and places automatic
// counter-bids until no proxy can challenge or the auction expires.
//
// Algorithm:
//   Each iteration finds challengers (proxies from non-winning teams that can bid).
//   Stale winner-proxy (max < currentPrice efter eget manuelt bid) behandles som
//     "ingen proxy" — eliminerer #171 hvor en stale proxy ville få challenger til at
//     "bide" på et beløb under aktuel pris og dermed bryde loopet uden counter-bid.
//   If winner has a proxy that beats the top challenger → winner counters just above
//     challenger's max; loop ends (challenger exhausted).
//   If challenger's max beats winner's proxy → challenger takes over at
//     max(winnerProxy.max + 1, minBid); previous winner gets "auction_proxy_outbid".
//   If winner has no proxy → challenger bids at minimum; loop continues for more challengers.
export async function resolveProxyBids({
  supabase,
  auctionId,
  bidTime,
  bidCfg,
  notifyTeamOwner,
  notifyOutbidDM,
}) {
  for (let i = 0; i < MAX_PROXY_ITERATIONS; i++) {
    const { data: auction } = await supabase
      .from("auctions")
      .select("*, rider:rider_id(firstname, lastname, team_id)")
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

    // Stale-proxy guard (#171): hvis winner manuelt bød over eget proxy-loft,
    // er winnerProxy.max < currentPrice og repræsenterer ikke længere winners
    // reelle vilje. Behandl som "ingen proxy" så challenger byder minBid i
    // stedet for et beløb under currentPrice (som ville trigge break på line 78).
    const effectiveWinnerProxy =
      winnerProxy && winnerProxy.max_amount >= currentPrice ? winnerProxy : null;

    if (effectiveWinnerProxy && effectiveWinnerProxy.max_amount >= getMinimumAuctionBid(topChallenger.max_amount)) {
      // Winner's proxy beats top challenger's max — bid just above challenger's max
      autoBidAmount = Math.min(
        effectiveWinnerProxy.max_amount,
        getMinimumAuctionBid(topChallenger.max_amount)
      );
      autoBidder = currentWinner;
    } else if (effectiveWinnerProxy) {
      // Challenger's max beats winner's proxy — challenger overtager.
      // Klamp til >= minBid så vi aldrig insert'er et bid under aktuel pris.
      autoBidAmount = Math.min(
        topChallenger.max_amount,
        Math.max(getMinimumAuctionBid(effectiveWinnerProxy.max_amount), minBid)
      );
      autoBidder = topChallenger.team_id;
      exhaustedTeam = currentWinner;
    } else {
      // Winner har ingen aktiv proxy (eller den er stale efter manuelt bid over loftet)
      // — challenger byder minimum. Hvis winner havde stale proxy, får ejeren
      // standard auction_outbid-notif (deres manuelle bid var det der ledte —
      // proxy'en var allerede udtømt af dem selv).
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

    const { data: bidderTeam } = await supabase
      .from("teams")
      .select("name")
      .eq("id", autoBidder)
      .single();
    const bidderName = bidderTeam?.name || "Auto-by";

    if (notifyTeamOwner) {
      if (exhaustedTeam) {
        // Proxy was beaten by a higher max
        await notifyTeamOwner(
          exhaustedTeam,
          "auction_proxy_outbid",
          "Din auto-by er stoppet",
          `Din auto-by på ${riderName} nåede sit max-loft og er overbudt af ${bidderName}`,
          auctionId
        ).catch((e) => console.error("[proxy-notif] failed", { auctionId, e }));
      } else if (autoBidder !== currentWinner && currentWinner) {
        // Challenger took over, current winner had no proxy (normal outbid via proxy)
        await notifyTeamOwner(
          currentWinner,
          "auction_outbid",
          "Du er blevet overbudt!",
          `${bidderName}'s auto-by overbød dig på ${riderName}`,
          auctionId
        ).catch((e) => console.error("[proxy-notif] failed", { auctionId, e }));
      }

      // Notify seller (only if real human selling own rider — mirrors manual bid flow)
      if (auction.rider?.team_id && auction.rider.team_id === auction.seller_team_id && auction.seller_team_id !== autoBidder) {
        await notifyTeamOwner(
          auction.seller_team_id,
          "bid_received",
          "Nyt bud modtaget",
          `${bidderName}'s auto-by bød ${autoBidAmount.toLocaleString("da-DK")} CZ$ på ${riderName}`,
          auctionId
        ).catch((e) => console.error("[proxy-notif] failed", { auctionId, e }));
      }
    }

    // Discord DM only when bidder is fully exhausted — mid-cascade DMs would spam
    // managers whose proxy steps up but is still leading. In-app notif (above) still fires.
    if (notifyOutbidDM && exhaustedTeam) {
      notifyOutbidDM({
        riderName,
        newBid: autoBidAmount,
        bidderName,
        teamId: exhaustedTeam,
        isAuto: true,
        exhausted: true,
      }).catch((e) => console.error("[proxy-notif] failed", { auctionId, e }));
    }

    // Winner countered challenger successfully — no more iterations needed
    if (autoBidder === currentWinner) break;
  }
}
