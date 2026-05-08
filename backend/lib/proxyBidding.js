import {
  computeWorstCaseCommitment,
  getMinimumAuctionBid,
} from "./auctionRules.js";
import { checkBidExtension, isAuctionExpired } from "./auctionEngine.js";

const MAX_PROXY_ITERATIONS = 30;

// #44: gate auto-bid mod current balance. Hvis en proxy ville pushe vinderen i
// negativ tilgængelig balance (fx pga. salary-deduction eller anden auktion
// finaliseret efter proxy blev sat), behandles proxy som udmattet. Worst-case
// commitment ekskluderer denne auktion — autoBidAmount tæller separat.
async function canAffordAutoBid(supabase, teamId, autoBidAmount, currentAuctionId) {
  const { data: team } = await supabase
    .from("teams")
    .select("balance")
    .eq("id", teamId)
    .single();
  if (!team) return false;

  const [leadingRes, proxiesRes] = await Promise.all([
    supabase
      .from("auctions")
      .select("id, current_price")
      .in("status", ["active", "extended"])
      .eq("current_bidder_id", teamId),
    supabase
      .from("auction_proxy_bids")
      .select("auction_id, max_amount, auction:auction_id(status)")
      .eq("team_id", teamId),
  ]);

  const leadingAuctions = (leadingRes.data || []).filter(
    (row) => row.id !== currentAuctionId,
  );
  const allMyProxies = (proxiesRes.data || [])
    .filter((row) => ["active", "extended"].includes(row.auction?.status))
    .filter((row) => row.auction_id !== currentAuctionId)
    .map((row) => ({ auction_id: row.auction_id, max_amount: row.max_amount }));

  const otherCommitment = computeWorstCaseCommitment({ leadingAuctions, allMyProxies });
  return (Number(team.balance) || 0) >= otherCommitment + autoBidAmount;
}

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
  // #44: balance-check er injectable så tests kan stube den uden at mock'e
  // teams/auctions/auction_proxy_bids-tabellerne i fuld bredde. Default = real
  // DB-aware impl.
  canAffordAutoBidFn = canAffordAutoBid,
}) {
  // #44: teams hvis auto-bid blev rejected pga. utilstrækkelig balance i denne
  // resolveProxyBids-kørsel. Eksluderes fra challengers så vi ikke looper uendeligt
  // på samme proxy. Forbliver in-memory — proxy-record slettes ikke (manageren kan
  // selv sætte en lavere proxy senere hvis de ønsker).
  const balanceRejectedTeams = new Set();

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
      .filter(
        (p) =>
          p.team_id !== currentWinner &&
          p.max_amount >= minBid &&
          !balanceRejectedTeams.has(p.team_id),
      )
      .sort((a, b) => b.max_amount - a.max_amount);

    if (challengers.length === 0) break;

    const topChallenger = challengers[0];
    const winnerProxy = allProxies.find(p => p.team_id === currentWinner);

    // #183: slet stale winner-proxy fra DB så UI ikke vildleder manageren med
    // "Autobud loft 60K" når proxyen aldrig fyrer (effectiveWinnerProxy ignorerer
    // den). Silent failure-mode pre-fix.
    if (winnerProxy && winnerProxy.max_amount < currentPrice) {
      await supabase
        .from("auction_proxy_bids")
        .delete()
        .eq("auction_id", auctionId)
        .eq("team_id", currentWinner);
    }

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

    // #44: gate auto-bid mod autoBidder's available balance. Hvis de ikke har
    // råd (fx pga. salary-deduction siden proxy blev sat), behandles deres proxy
    // som udmattet i denne run — næste iteration finder næste challenger.
    const canAfford = await canAffordAutoBidFn(supabase, autoBidder, autoBidAmount, auctionId);
    if (!canAfford) {
      balanceRejectedTeams.add(autoBidder);
      // Notify ejeren af den afviste proxy. Brug auction_proxy_outbid uanset om de
      // var winner eller challenger — meningen er "dit autobud er stoppet".
      const riderName = `${auction.rider.firstname} ${auction.rider.lastname}`;
      if (notifyTeamOwner) {
        await notifyTeamOwner(
          autoBidder,
          "auction_proxy_outbid",
          "Dit autobud er stoppet",
          `Dit autobud på ${riderName} stoppede pga. utilstrækkelig balance — sørg for at have penge på kontoen for at byde igen`,
          auctionId,
        ).catch((e) => console.error("[proxy-balance-reject] notif failed", { auctionId, e }));
      }
      // Ingen bid-insert; loop fortsætter med næste challenger.
      continue;
    }

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

    // #183: maybeSingle() returnerer { data: null } i stedet for error ved 0 rækker.
    // Slettet team midt i auktion (RLS-issue) ville pre-fix få .single() til at
    // returnere error → ydre try/catch swallow'ede den, men resterende iterationer mistedes.
    const { data: bidderTeam } = await supabase
      .from("teams")
      .select("name")
      .eq("id", autoBidder)
      .maybeSingle();
    const bidderName = bidderTeam?.name || "Autobud";

    if (notifyTeamOwner) {
      if (exhaustedTeam) {
        // Proxy was beaten by a higher max
        await notifyTeamOwner(
          exhaustedTeam,
          "auction_proxy_outbid",
          "Dit autobud er stoppet",
          `Dit autobud på ${riderName} nåede sit max-loft og er overbudt af ${bidderName}`,
          auctionId
        ).catch((e) => console.error("[proxy-notif] failed", { auctionId, e }));
      } else if (autoBidder !== currentWinner && currentWinner) {
        // Challenger took over, current winner had no proxy (normal outbid via proxy)
        await notifyTeamOwner(
          currentWinner,
          "auction_outbid",
          "Du er blevet overbudt!",
          `${bidderName}'s autobud overbød dig på ${riderName}`,
          auctionId
        ).catch((e) => console.error("[proxy-notif] failed", { auctionId, e }));
      }

      // Notify seller (only if real human selling own rider — mirrors manual bid flow)
      if (auction.rider?.team_id && auction.rider.team_id === auction.seller_team_id && auction.seller_team_id !== autoBidder) {
        await notifyTeamOwner(
          auction.seller_team_id,
          "bid_received",
          "Nyt bud modtaget",
          `${bidderName}'s autobud bød ${autoBidAmount.toLocaleString("da-DK")} CZ$ på ${riderName}`,
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
