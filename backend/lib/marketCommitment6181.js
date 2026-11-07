// #6181 + #2176 · Pengelaas PR 5: backend-siden af M3
// (database/2026-11-07-6181-m3-market-commitment.sql).
//
// Ejer-beslutning 5 (7/11): en vinder maa aldrig mangle penge eller plads ved
// auktionens slut. Selve laasen ligger i databasen: tre triggere tjekker penge og
// plads under holdlaasen (samme noegle som increment_balance_with_audit), naar et
// bud, et autobud eller en auktion med en startbyder skrives. Denne fil:
//
//   1. laeser kontakten market_commitment_6181 (kun "on"/true taender),
//   2. oversaetter triggerens fejl ("market_gate_6181:<kode>") til de fejlkoder,
//      ruterne allerede bruger (ingen ny spillertekst),
//   3. giver proxy-cascaden et for-tjek af penge OG plads (samme SQL-regel som
//      triggeren), saa et autobud uden plads stoppes paent i stedet for at
//      vaelte cascaden,
//   4. lader transfer-bekraeftelsen taelle koeberens foerende auktioner som
//      pladser og saelgerens ryttere paa auktion som udgaaende (gulvet),
//   5. goer POST /auctions' startbud til et krav om penge (worst case, ogsaa
//      autobud uden foering) og plads, ikke kun en advarsel.
//
// Kontakten slukket = bit-identisk: hver funktion her returnerer null/false eller
// lader tilstanden vaere uroert, foer den laver et eneste opslag ud over selve
// kontakten. Triggerfejl kan kun opstaa, naar kontakten er taendt i databasen.
import { readFlagStage } from "./featureStage.js";
import { fetchAuctionCommitment } from "./availableBalance.js";
import { getMinimumAuctionBid } from "./auctionRules.ts";
import { MAX_SQUAD_SIZE } from "./marketUtils.js";

export const MARKET_COMMITMENT_FLAG = "market_commitment_6181";
export const MARKET_GATE_PREFIX = "market_gate_6181:";
const ACTIVE = ["active", "extended"];

export function isMarketCommitmentValueOn(value) {
  return value === true || value === "on";
}

// Laeses friskt: databasens triggere laeser samme raekke ved hvert bud, og
// backenden maa ikke koere med en anden tilstand end databasen i et minut.
export async function isMarketCommitment6181On(supabase) {
  return isMarketCommitmentValueOn(await readFlagStage(supabase, MARKET_COMMITMENT_FLAG, { fresh: true }));
}

/** Triggerens kode ("insufficient_available_balance" | "squad_full" | "price_changed"), ellers null. */
export function marketGateCode(error) {
  if (!error || error.code !== "P0001") return null;
  const msg = String(error.message || "");
  const at = msg.indexOf(MARKET_GATE_PREFIX);
  if (at < 0) return null;
  const code = msg.slice(at + MARKET_GATE_PREFIX.length).trim().split(/\s/)[0];
  return code || null;
}

// Disponibelt beloeb til fejlbeskeden: saldo minus forpligtelsen uden denne auktion.
async function availableExcluding(supabase, teamId, auctionId) {
  const [teamRes, commitRes] = await Promise.all([
    supabase.from("teams").select("balance").eq("id", teamId).maybeSingle(),
    supabase.rpc("team_market_commitment", { p_team_id: teamId, p_exclude_auction_id: auctionId ?? null }),
  ]);
  if (teamRes?.error || commitRes?.error) {
    console.error("[marketCommitment6181] could not read available balance for message", {
      teamId,
      error: teamRes?.error?.message || commitRes?.error?.message,
    });
    return 0;
  }
  return Math.max(0, (Number(teamRes?.data?.balance) || 0) - (Number(commitRes?.data) || 0));
}

const SQUAD_FULL_BODY = () => ({
  error: `Your squad is full (${MAX_SQUAD_SIZE} riders). Sell a rider before you bid on a new one.`,
  errorCode: "squad_full_bid",
  errorParams: { maxRiders: MAX_SQUAD_SIZE },
});

/**
 * Oversaet en triggerfejl til et HTTP-svar med en eksisterende fejlkode.
 * Returnerer null, hvis fejlen ikke kommer fra M3-gaten.
 *
 * @param {any} supabase
 * @param {any} error  fejlen fra insert/upsert
 * @param {{ kind: "bid" | "proxy" | "start", teamId: string, auctionId?: string | null }} ctx
 * @returns {Promise<{ status: number, body: Record<string, unknown> } | null>}
 */
export async function marketGateResponse6181(supabase, error, { kind, teamId, auctionId = null }) {
  const code = marketGateCode(error);
  if (!code) return null;

  if (code === "squad_full") return { status: 400, body: SQUAD_FULL_BODY() };

  if (code === "price_changed" && auctionId) {
    const { data: fresh, error: freshError } = await supabase.from("auctions").select("current_price, current_bidder_id").eq("id", auctionId).maybeSingle();
    if (freshError) console.error("[marketCommitment6181] could not read price for 409", { auctionId, error: freshError.message });
    return {
      status: 409,
      body: {
        error: "price_changed",
        currentPrice: fresh?.current_price ?? null,
        minimumBid: fresh ? getMinimumAuctionBid(fresh.current_price, { hasActiveBid: Boolean(fresh.current_bidder_id) }) : null,
      },
    };
  }

  if (kind === "start") {
    return {
      status: 400,
      body: { error: "The starting bid exceeds your available balance, including active auction leads", errorCode: "start_bid_exceeds_balance" },
    };
  }

  const available = await availableExcluding(supabase, teamId, auctionId);
  if (kind === "proxy") {
    return {
      status: 400,
      body: {
        error: `You have ${available.toLocaleString("da-DK")} CZ$ left after your existing bids and auto-bids`,
        errorCode: "insufficient_balance_after_proxy",
        errorParams: { available },
      },
    };
  }
  return {
    status: 400,
    body: {
      error: `You have ${available.toLocaleString("da-DK")} CZ$ left after your existing bids`,
      errorCode: "insufficient_balance_after_bids",
      errorParams: { available },
    },
  };
}

/**
 * Bud-ruten, taendt: triggeren har allerede sat pris og foerer under laasen.
 * Den gamle ubetingede opdatering kunne overskrive et hoejere bud, der landede
 * imellem; her opdateres kun, hvis prisen stadig er lavere (fx hvis kontakten
 * blev slaaet til i databasen mellem buddet og dette kald).
 */
export async function syncBidLeader6181(supabase, { auctionId, amount, teamId }) {
  const { error } = await supabase
    .from("auctions")
    .update({ current_price: amount, current_bidder_id: teamId })
    .eq("id", auctionId)
    .lt("current_price", amount);
  if (error) console.error("[marketCommitment6181] leader sync failed", { auctionId, error: error.message });
}

/**
 * For-tjek til proxy-cascaden (canAffordAutoBidFn): penge OG plads med samme
 * SQL-regel som triggeren. Selve skrivningen er stadig gated af triggeren; dette
 * tjek goer bare, at et autobud uden plads behandles som udtoemt i stedet for at
 * vaelte cascaden. Pengesti: en laesefejl kastes (#2997).
 */
export async function canAffordAutoBid6181(supabase, teamId, autoBidAmount, auctionId) {
  const [auctionRes, proxyRes] = await Promise.all([
    supabase.from("auctions").select("current_bidder_id, is_youth").eq("id", auctionId).maybeSingle(),
    supabase.from("auction_proxy_bids").select("max_amount").eq("auction_id", auctionId).eq("team_id", teamId).maybeSingle(),
  ]);
  if (auctionRes?.error) throw new Error(`canAffordAutoBid6181: could not load auction ${auctionId}: ${auctionRes.error.message}`);
  if (proxyRes?.error) throw new Error(`canAffordAutoBid6181: could not load proxy for ${teamId}: ${proxyRes.error.message}`);
  const auction = auctionRes?.data;
  if (!auction) return false;
  const amount = Math.max(Number(autoBidAmount) || 0, Number(proxyRes?.data?.max_amount) || 0);
  const { data: issue, error } = await supabase.rpc("market_bid_issue_6181", {
    p_team_id: teamId,
    p_auction_id: auctionId,
    p_amount: amount,
    p_seat: !auction.is_youth && auction.current_bidder_id !== teamId,
  });
  if (error) throw new Error(`canAffordAutoBid6181: market_bid_issue_6181 failed for ${teamId}: ${error.message}`);
  return issue == null;
}

/**
 * Ren regel: juster to markedstilstande (getTeamMarketState) med markedets
 * forpligtelser. Koeberens foerende auktioner er pladser, han allerede har lovet
 * vaek; saelgerens egne ryttere paa auktion er paa vej ud (gulvet). Muterer kun
 * future_count, som alle trup-tjek laeser.
 */
export function applyMarketSeatCounts({ buyerState = null, sellerState = null, buyerLeading = 0, sellerOutgoing = 0 } = {}) {
  if (buyerState && buyerLeading > 0) {
    buyerState.future_count = (buyerState.future_count ?? buyerState.total_count ?? 0) + buyerLeading;
    buyerState.market_leading_count = buyerLeading;
  }
  if (sellerState && sellerOutgoing > 0) {
    sellerState.future_count = (sellerState.future_count ?? sellerState.total_count ?? 0) - sellerOutgoing;
    sellerState.market_outgoing_auction_count = sellerOutgoing;
  }
}

async function countLeadingAuctions(supabase, teamId) {
  const { count, error } = await supabase
    .from("auctions")
    .select("id", { count: "exact", head: true })
    .in("status", ACTIVE)
    .eq("current_bidder_id", teamId);
  if (error) throw new Error(`marketCommitment6181: could not count leading auctions for ${teamId}: ${error.message}`);
  return count || 0;
}

async function countOutgoingAuctions(supabase, teamId, excludeRiderId) {
  const { data, error } = await supabase.rpc("team_outgoing_auction_count", {
    p_team_id: teamId,
    p_exclude_rider_id: excludeRiderId ?? null,
  });
  if (error) throw new Error(`marketCommitment6181: could not count outgoing auctions for ${teamId}: ${error.message}`);
  return Number(data) || 0;
}

/**
 * Transfer-bekraeftelse (executeTransferOffer): taendt => koeberens foerende
 * auktioner og saelgerens ryttere paa auktion indgaar i trup-tjekkene.
 * Slukket => ingen opslag, ingen mutation.
 */
export async function applyTransferMarketCommitment6181(supabase, { buyerState, sellerState, riderId = null }) {
  if (!(await isMarketCommitment6181On(supabase))) return false;
  const [buyerLeading, sellerOutgoing] = await Promise.all([
    buyerState?.id ? countLeadingAuctions(supabase, buyerState.id) : 0,
    sellerState?.id ? countOutgoingAuctions(supabase, sellerState.id, riderId) : 0,
  ]);
  applyMarketSeatCounts({ buyerState, sellerState, buyerLeading, sellerOutgoing });
  return true;
}

/**
 * Saelgers gulv (POST /auctions paa egen rytter, frigivelse): taendt => holdets
 * andre ryttere paa auktion taeller som udgaaende. Slukket => uroert.
 */
export async function applySellerOutgoingAuctions6181(supabase, sellerState, excludeRiderId = null) {
  if (!sellerState?.id || !(await isMarketCommitment6181On(supabase))) return false;
  const sellerOutgoing = await countOutgoingAuctions(supabase, sellerState.id, excludeRiderId);
  applyMarketSeatCounts({ sellerState, sellerOutgoing });
  return true;
}

/**
 * Ren regel for POST /auctions' startbyder: worst case-forpligtelse (ogsaa
 * autobud uden foering) + startprisen skal kunne betales, og der skal vaere en
 * plads (future_count + foerende auktioner + 1 <= loftet). null = ok.
 */
export function getAuctionStartCommitmentIssue({ balance, commitment, price, seatsInUse, maxRiders = MAX_SQUAD_SIZE }) {
  if ((Number(balance) || 0) - (Number(commitment) || 0) < (Number(price) || 0)) {
    return { code: "start_bid_exceeds_balance" };
  }
  if ((Number(seatsInUse) || 0) + 1 > maxRiders) {
    return { code: "squad_full_bid", maxRiders };
  }
  return null;
}

/**
 * POST /auctions: taendt => startbyderen skal have penge og plads (ellers et
 * HTTP-svar med de eksisterende fejlkoder). Slukket => null uden opslag, og
 * ruten koerer sit gamle tjek uaendret.
 *
 * @returns {Promise<{ status: number, body: Record<string, unknown> } | null>}
 */
export async function auctionStartCommitmentResponse6181(supabase, { teamId, teamState, price }) {
  if (!teamId || !(await isMarketCommitment6181On(supabase))) return null;
  const [commitment, leading] = await Promise.all([
    fetchAuctionCommitment(supabase, teamId),
    countLeadingAuctions(supabase, teamId),
  ]);
  const issue = getAuctionStartCommitmentIssue({
    balance: teamState?.balance,
    commitment,
    price,
    seatsInUse: (teamState?.future_count ?? teamState?.total_count ?? 0) + leading,
  });
  if (!issue) return null;
  if (issue.code === "squad_full_bid") return { status: 400, body: SQUAD_FULL_BODY() };
  return {
    status: 400,
    body: { error: "The starting bid exceeds your available balance, including active auction leads", errorCode: "start_bid_exceeds_balance" },
  };
}
