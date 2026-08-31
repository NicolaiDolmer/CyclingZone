import {
  computeWorstCaseCommitment,
  getMinimumAuctionBid,
} from "./auctionRules.js";
import { isAuctionExpired, isLateBidTriggerError } from "./auctionEngine.js";
import { captureException } from "./sentry.js";

// #2389 A2: in-app "du er overbudt"-notifikationer fejlede før kun til console —
// spillere mistede beskeden uden at nogen så det i Sentry. Fælles fail-handler
// (fire-and-forget bevares; notifikation må aldrig vælte budet).
const onProxyNotifFailed = (auctionId) => (e) => {
  console.error("[proxy-notif] failed", { auctionId, e });
  captureException(e, { tags: { flow: "auction", stage: "proxy-notif" }, auctionId });
};

// #230: annullering af en proxy-række ER frigivelsen af den reserverede saldo —
// commitment beregnes direkte fra auction_proxy_bids (computeWorstCaseCommitment
// i auctionRules.js), så overlever rækken, forbliver pengene låst. supabase-js
// kaster ikke: et fejlet delete returnerer bare { error }. Sluger vi den, sender
// vi bagefter en besked om at reservationen er frigivet, mens rækken stadig
// ligger der — en direkte usand besked til manageren, værre end den bug vi
// fixer. Derfor: bind fejlen, rapportér til Sentry, og returnér false så
// kalderen kan lade være med at love noget der ikke skete. Auktionen selv
// vælter ikke — cascaden skal køre videre for de øvrige budgivere.
async function cancelProxyRow(supabase, auctionId, teamId) {
  const { error } = await supabase
    .from("auction_proxy_bids")
    .delete()
    .eq("auction_id", auctionId)
    .eq("team_id", teamId);
  if (error) {
    console.error("[proxy-cancel] delete failed", { auctionId, teamId, error });
    captureException(error, {
      tags: { flow: "auction", stage: "proxy-cancel" },
      auctionId,
      teamId,
    });
    return false;
  }
  return true;
}

const MAX_PROXY_ITERATIONS = 30;

// #44: gate auto-bid mod current balance. Hvis en proxy ville pushe vinderen i
// negativ tilgængelig balance (fx pga. salary-deduction eller anden auktion
// finaliseret efter proxy blev sat), behandles proxy som udmattet. Worst-case
// commitment ekskluderer denne auktion — autoBidAmount tæller separat.
async function canAffordAutoBid(supabase, teamId, autoBidAmount, currentAuctionId) {
  // #2997: en tabt læsefejl her blev til `!team` → return false → manageren
  // tabte auktionen fordi hans autobud blev behandlet som udmattet, uden en
  // eneste linje nogen steder. Det er en pengesti: kast, så cascaden fejler
  // højlydt (api.js fanger og logger) i stedet for at afgøre auktionen forkert.
  // PGRST116 (holdet findes ikke) er stadig den legitime false-sti.
  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("balance")
    .eq("id", teamId)
    .single();
  if (teamError && teamError.code !== "PGRST116") {
    throw new Error(`canAffordAutoBid: could not load balance for team ${teamId}: ${teamError.message}`);
  }
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
// #257: Cascade does NOT apply auction extensions. The caller (POST /bid,
// PATCH /proxy) inspects the FINAL leader after the cascade has settled and
// applies extension via applyLeaderShiftExtension only when leader actually
// changed. Cascade bids therefore land with triggered_extension: false.
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
//
// #1091 tie-break: ved identisk bud vinder den hidtidige fører med autobud.
//   Hvis den nye vinders bud lander PRÆCIS på previousLeader's proxy-loft, matcher
//   proxyen buddet (samme beløb) og føringen går tilbage uden prisstigning. En
//   udfordrer skal OVERGÅ førerens loft for at overtage — ikke bare matche det.
//   Kalderen sender previousLeader (lederen FØR det udløsende bud-event).
//
// Note: bidCfg is no longer used inside the cascade (extension lives in the
// caller per #257), but we keep the parameter so callers don't need to change
// signature.
export async function resolveProxyBids({
  supabase,
  auctionId,
  bidTime,
  // eslint-disable-next-line no-unused-vars -- kept for caller compat (#257)
  bidCfg,
  notifyTeamOwner,
  notifyOutbidDM,
  // #1091: lederen før det udløsende bud — nødvendig for tie-break til fordel
  // for den hidtidige fører. null/udeladt = ingen tie-break (bagudkompat).
  previousLeader = null,
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

  // #230: teams der allerede har fået en annullerings-notifikation i denne
  // kørsel — delete er idempotent, men notifikationen må ikke gentages.
  const cancelNotified = new Set();

  // #1740: cascaden ejer ALLE "du er overbudt"-notifikationer (auction_outbid +
  // auction_proxy_outbid). Vi samler de teams den allerede har notificeret, så
  // kalderen (POST /bid, PATCH /proxy) IKKE sender en falsk overbudt-besked til en
  // fører hvis autobud genvinder føringen i denne cascade. Kalderen tjekker
  // outbidNotified + finalLeaderId i returværdien.
  const outbidNotified = new Set();
  // Wrap notifyTeamOwner så vi registrerer hvilke teams der fik en overbudt-notif.
  const trackedNotify = notifyTeamOwner
    ? (teamId, type, ...rest) => {
        if (type === "auction_outbid" || type === "auction_proxy_outbid") {
          outbidNotified.add(teamId);
        }
        return notifyTeamOwner(teamId, type, ...rest);
      }
    : notifyTeamOwner;

  for (let i = 0; i < MAX_PROXY_ITERATIONS; i++) {
    // #2997: begge læsninger er cascadens fundament. En tabt fejl på auktionen
    // blev til `break` (cascaden stopper halvvejs, prisen står forkert), og en
    // tabt fejl på proxy-rækkerne blev til en TOM proxy-liste (alle autobud
    // ignoreres → forkert vinder). Pengesti: kast.
    const { data: auction, error: auctionError } = await supabase
      .from("auctions")
      .select("*, rider:rider_id(firstname, lastname, team_id)")
      .eq("id", auctionId)
      .single();
    if (auctionError && auctionError.code !== "PGRST116") {
      throw new Error(`resolveProxyBids: could not load auction ${auctionId}: ${auctionError.message}`);
    }

    if (!auction || !["active", "extended"].includes(auction.status)) break;
    if (isAuctionExpired(auction.calculated_end)) break;

    const currentPrice = auction.current_price;
    const currentWinner = auction.current_bidder_id;
    const minBid = getMinimumAuctionBid(currentPrice);

    const { data: proxies, error: proxiesError } = await supabase
      .from("auction_proxy_bids")
      .select("*")
      .eq("auction_id", auctionId);
    if (proxiesError) {
      throw new Error(`resolveProxyBids: could not load proxy bids for auction ${auctionId}: ${proxiesError.message}`);
    }

    const allProxies = proxies || [];

    // #1091: tie-break til fordel for den hidtidige fører med autobud. Hvis den
    // nuværende vinders bud lander PRÆCIS på previousLeader's proxy-loft, matcher
    // proxyen buddet (samme beløb, is_proxy) og føringen går tilbage til den
    // hidtidige fører — prisen er uændret. Fyrer max én gang pr. cascade-run:
    // efter match er currentWinner === previousLeader, og et evt. counter-bid fra
    // den fortrængte byders egen proxy hæver prisen over loftet, så betingelsen
    // ikke kan gen-fyre.
    const tieBreakProxy =
      previousLeader && currentWinner && currentWinner !== previousLeader
        ? allProxies.find(
            (p) =>
              p.team_id === previousLeader &&
              Number(p.max_amount) === Number(currentPrice) &&
              !balanceRejectedTeams.has(p.team_id),
          )
        : null;

    if (tieBreakProxy) {
      const riderName = `${auction.rider.firstname} ${auction.rider.lastname}`;

      // #44-paritet: samme balance-gate som almindelige auto-bids — proxyen kan
      // være sat før en salary-deduction el.lign.
      const canAffordTie = await canAffordAutoBidFn(supabase, previousLeader, currentPrice, auctionId);
      if (!canAffordTie) {
        balanceRejectedTeams.add(previousLeader);
        if (notifyTeamOwner) {
          await trackedNotify(
            previousLeader,
            "auction_proxy_outbid",
            "Dit autobud er stoppet",
            `Dit autobud på ${riderName} stoppede pga. utilstrækkelig balance — sørg for at have penge på kontoen for at byde igen`,
            auctionId,
            { riderId: auction.rider_id },
          ).catch(onProxyNotifFailed(auctionId));
        }
        continue;
      }

      // #269-paritet: late-bid-trigger kan afvise insert'en hvis auktionen
      // udløb/blev finaliseret mellem iterationerne.
      const { error: tieInsertError } = await supabase.from("auction_bids").insert({
        auction_id: auctionId,
        team_id: previousLeader,
        amount: currentPrice,
        bid_time: bidTime.toISOString(),
        triggered_extension: false,
        is_proxy: true,
      });
      if (tieInsertError) {
        if (isLateBidTriggerError(tieInsertError)) break;
        throw tieInsertError;
      }

      // Kun føringen flyttes tilbage — current_price er allerede beløbet.
      await supabase.from("auctions").update({
        current_bidder_id: previousLeader,
      }).eq("id", auctionId);

      if (notifyTeamOwner) {
        // #2997: rent kosmetisk berigelse (holdnavn i beskeden). Rapportér, men
        // fald tilbage til "Autobud" — en manglende label må aldrig vælte en
        // cascade der allerede har flyttet føringen i databasen.
        const { data: leaderTeam, error: leaderTeamError } = await supabase
          .from("teams")
          .select("name")
          .eq("id", previousLeader)
          .maybeSingle();
        if (leaderTeamError) {
          captureException(leaderTeamError, {
            tags: { flow: "auction", stage: "proxy-team-name" },
            auctionId,
            teamId: previousLeader,
          });
        }
        const leaderName = leaderTeam?.name || "Autobud";
        await trackedNotify(
          currentWinner,
          "auction_outbid",
          "Du er blevet overbudt!",
          `${leaderName}'s autobud matchede dit bud på ${riderName} og beholder føringen ved identisk bud`,
          auctionId,
          { riderId: auction.rider_id },
        ).catch(onProxyNotifFailed(auctionId));
      }
      // Ingen sælger-notif her: prisen steg ikke, og sælgeren fik allerede
      // bid_received for det udløsende bud på samme beløb.

      // Fortsæt cascaden — den fortrængte byders egen proxy (hvis højere end
      // loftet) kan stadig counter-byde i næste iteration.
      continue;
    }

    // #230: ryd døde proxies — rækker hvis loft er under minimumsbuddet kan
    // aldrig fyre igen (prisen falder aldrig), men tæller stadig med i ejerens
    // worst-case-commitment og låser dermed reserveret saldo på ubestemt tid.
    // Undtagelse: previousLeader's loft PRÆCIS på currentPrice er #1091-tie-break-
    // kandidaten og må ikke ryddes (den fyrer i tie-break-grenen ovenfor).
    const deadProxies = allProxies.filter(
      (p) =>
        p.team_id !== currentWinner &&
        p.max_amount < minBid &&
        !(
          previousLeader &&
          p.team_id === previousLeader &&
          Number(p.max_amount) === Number(currentPrice)
        ),
    );
    for (const dead of deadProxies) {
      // Fejler sletningen, er saldoen IKKE frigivet — så spring beskeden over
      // i stedet for at love manageren noget der ikke skete. Rækken bliver
      // liggende (status quo ante) og ryddes ved næste cascade-kørsel.
      const cancelled = await cancelProxyRow(supabase, auctionId, dead.team_id);
      if (!cancelled) continue;
      if (cancelNotified.has(dead.team_id)) continue;
      cancelNotified.add(dead.team_id);
      if (notifyTeamOwner) {
        const riderName = `${auction.rider.firstname} ${auction.rider.lastname}`;
        await trackedNotify(
          dead.team_id,
          "auction_proxy_outbid",
          "Autobud annulleret",
          `Prisen på ${riderName} har passeret dit autobud-loft på ${dead.max_amount} CZ$ — autobuddet er annulleret og din reserverede saldo frigivet`,
          auctionId,
          {
            riderId: auction.rider_id,
            titleCode: "notif.autoBidCancelled.title",
            titleParams: {},
            messageCode: "notif.autoBidCancelled.message",
            messageParams: { riderName, maxAmount: dead.max_amount },
          },
        ).catch(onProxyNotifFailed(auctionId));
      }
    }

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
        await trackedNotify(
          autoBidder,
          "auction_proxy_outbid",
          "Dit autobud er stoppet",
          `Dit autobud på ${riderName} stoppede pga. utilstrækkelig balance — sørg for at have penge på kontoen for at byde igen`,
          auctionId,
          { riderId: auction.rider_id },
        ).catch(onProxyNotifFailed(auctionId));
      }
      // Ingen bid-insert; loop fortsætter med næste challenger.
      continue;
    }

    // #257: cascade bids land with triggered_extension: false. The caller
    // applies extension once after cascade settles, only if leader changed.
    // #269: hvis reject_late_auction_bid-triggeren afviser cascade-buddet
    // (auction'en er expired/inaktiv siden caller'ens fetch), break loop'et —
    // ingen yderligere cascade-iterationer er meningsfulde.
    const { error: cascadeInsertError } = await supabase.from("auction_bids").insert({
      auction_id: auctionId,
      team_id: autoBidder,
      amount: autoBidAmount,
      bid_time: bidTime.toISOString(),
      triggered_extension: false,
      is_proxy: true,
    });
    if (cascadeInsertError) {
      if (isLateBidTriggerError(cascadeInsertError)) break;
      throw cascadeInsertError;
    }

    await supabase.from("auctions").update({
      current_price: autoBidAmount,
      current_bidder_id: autoBidder,
    }).eq("id", auctionId);

    // #230 (ejer-valg A, 11/6): når en proxy er slået over sit loft, annulleres
    // rækken straks så reservationen (worst-case-commitment) frigives — før fixet
    // blev den liggende og låste saldo indtil manageren selv slettede den.
    // Lykkedes sletningen ikke, er reservationen ikke frigivet — beskeden
    // nedenfor skal så ikke påstå det (se exhaustedCancelled).
    const exhaustedCancelled = exhaustedTeam
      ? await cancelProxyRow(supabase, auctionId, exhaustedTeam)
      : false;

    const riderName = `${auction.rider.firstname} ${auction.rider.lastname}`;

    // #183: maybeSingle() returnerer { data: null } i stedet for error ved 0 rækker.
    // Slettet team midt i auktion (RLS-issue) ville pre-fix få .single() til at
    // returnere error → ydre try/catch swallow'ede den, men resterende iterationer mistedes.
    // #2997: samme kosmetiske berigelse som leaderTeam ovenfor — rapportér og
    // behold "Autobud"-fallbacken; #183-beslutningen om at cascaden IKKE må
    // vælte på et manglende holdnavn står ved magt.
    const { data: bidderTeam, error: bidderTeamError } = await supabase
      .from("teams")
      .select("name")
      .eq("id", autoBidder)
      .maybeSingle();
    if (bidderTeamError) {
      captureException(bidderTeamError, {
        tags: { flow: "auction", stage: "proxy-team-name" },
        auctionId,
        teamId: autoBidder,
      });
    }
    const bidderName = bidderTeam?.name || "Autobud";

    if (notifyTeamOwner) {
      if (exhaustedTeam) {
        // Proxy was beaten by a higher max — #230: rækken er annulleret ovenfor,
        // så beskeden fortæller også at reservationen er frigivet. Fejlede
        // sletningen (exhaustedCancelled=false), ligger rækken der stadig og
        // saldoen er stadig reserveret — så siger vi kun at buddet er overbudt.
        await trackedNotify(
          exhaustedTeam,
          "auction_proxy_outbid",
          "Dit autobud er stoppet",
          exhaustedCancelled
            ? `Dit autobud på ${riderName} nåede sit max-loft og er overbudt af ${bidderName} — autobuddet er annulleret og din reserverede saldo frigivet`
            : `Dit autobud på ${riderName} nåede sit max-loft og er overbudt af ${bidderName}`,
          auctionId,
          {
            riderId: auction.rider_id,
            titleCode: "notif.autoBidExhausted.title",
            titleParams: {},
            messageCode: exhaustedCancelled
              ? "notif.autoBidExhausted.message"
              : "notif.autoBidExhausted.messageNotCancelled",
            messageParams: { riderName, bidderName },
          }
        ).catch(onProxyNotifFailed(auctionId));
      } else if (autoBidder !== currentWinner && currentWinner) {
        // Challenger took over, current winner had no proxy (normal outbid via proxy)
        await trackedNotify(
          currentWinner,
          "auction_outbid",
          "Du er blevet overbudt!",
          `${bidderName}'s autobud overbød dig på ${riderName}`,
          auctionId,
          { riderId: auction.rider_id }
        ).catch(onProxyNotifFailed(auctionId));
      }

      // Notify seller (only if real human selling own rider — mirrors manual bid flow)
      if (auction.rider?.team_id && auction.rider.team_id === auction.seller_team_id && auction.seller_team_id !== autoBidder) {
        await trackedNotify(
          auction.seller_team_id,
          "bid_received",
          "New bid received",
          `${bidderName}'s autobid placed ${autoBidAmount} CZ$ on ${riderName}`,
          auctionId,
          {
            riderId: auction.rider_id,
            titleCode: "notif.autoBidPlaced.title",
            titleParams: {},
            messageCode: "notif.autoBidPlaced.message",
            messageParams: {
              bidderName,
              amount: autoBidAmount,
              riderName,
            },
          }
        ).catch(onProxyNotifFailed(auctionId));
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
      }).catch(onProxyNotifFailed(auctionId));
    }

    // Winner countered challenger successfully — no more iterations needed
    if (autoBidder === currentWinner) break;
  }

  // #1740: returnér hvem der fører efter cascaden + hvilke teams cascaden allerede
  // har sendt en overbudt-notif til. Kalderen bruger dette til at undgå en FALSK
  // overbudt-besked til en fører hvis autobud genvandt føringen i denne cascade.
  // #2997: en tabt fejl her giver finalLeaderId=null, og så genindfører vi
  // præcis den falske overbudt-besked #1740 fjernede. Kontraktsti for kalderen
  // (api.js læser finalLeaderId direkte): kast frem for at returnere et tomt
  // svar der ligner et gyldigt "ingen fører".
  const { data: settled, error: settledError } = await supabase
    .from("auctions")
    .select("current_bidder_id")
    .eq("id", auctionId)
    .single();
  if (settledError && settledError.code !== "PGRST116") {
    throw new Error(`resolveProxyBids: could not read final leader for auction ${auctionId}: ${settledError.message}`);
  }
  return {
    finalLeaderId: settled?.current_bidder_id ?? null,
    outbidNotified,
  };
}
