// #6237 — EN fælles "disponibel saldo"-gate for faste køb (scouting, anlæg,
// staff-ansættelse, fratrædelsesgodtgørelse).
//
// Disponibel saldo = rå saldo minus worst-case auktions-forpligtelse (førende
// bud + proxy-lofter, #44/#3508). Tidligere tjekkede disse købsstier kun den rå
// saldo, så en manager kunne bruge penge der var låst i auktionsbud — og dermed
// ikke kunne betale for sin auktionsgevinst. Auktionernes egen regelfunktion
// (auctionRules.computeWorstCaseCommitment / computeAvailableBalance) genbruges
// uændret; denne fil tilføjer kun I/O-opslaget og én fælles fejlform.
import { computeAvailableBalance, computeWorstCaseCommitment } from "./auctionRules.js";

export const INSUFFICIENT_AVAILABLE_BALANCE = "insufficient_available_balance";

// Money path => KAST ved læsefejl (#2997): en tavs fejl ville tolke "kunne ikke
// læse buddene" som "ingen bud" og dermed åbne for overforbrug.
export async function fetchAuctionCommitment(supabaseClient, teamId) {
  if (!teamId) return 0;
  const [leadingRes, proxiesRes] = await Promise.all([
    supabaseClient
      .from("auctions")
      .select("id, current_price")
      .in("status", ["active", "extended"])
      .eq("current_bidder_id", teamId),
    supabaseClient
      .from("auction_proxy_bids")
      .select("auction_id, max_amount, auction:auction_id(status)")
      .eq("team_id", teamId),
  ]);
  if (leadingRes?.error) {
    throw new Error(`availableBalance: could not load leading auctions for ${teamId}: ${leadingRes.error.message}`);
  }
  if (proxiesRes?.error) {
    throw new Error(`availableBalance: could not load proxy bids for ${teamId}: ${proxiesRes.error.message}`);
  }

  const leadingAuctions = leadingRes?.data || [];
  const allMyProxies = (proxiesRes?.data || [])
    .filter((row) => ["active", "extended"].includes(row.auction?.status))
    .map((row) => ({ auction_id: row.auction_id, max_amount: row.max_amount }));
  return computeWorstCaseCommitment({ leadingAuctions, allMyProxies });
}

// Ren regel: null = OK. Rå saldo for lav => "insufficient_funds" (uændret
// eksisterende kode). Rå saldo nok, men låst i bud => "insufficient_available_balance"
// med det låste beløb, så UI'et kan sige det præcist.
export function getAvailableSpendIssue({ balance, commitment, cost } = {}) {
  const rawBalance = Number(balance) || 0;
  const spend = Number(cost) || 0;
  if (rawBalance < spend) return { error: "insufficient_funds" };
  const available = computeAvailableBalance({ teamBalance: rawBalance, commitment });
  if (spend > available) {
    return {
      error: INSUFFICIENT_AVAILABLE_BALANCE,
      locked: Math.min(Number(commitment) || 0, rawBalance),
      available,
    };
  }
  return null;
}

// I/O-wrapper: slår forpligtelsen op og anvender reglen. Køb uden pris (0) kan
// aldrig være låst, så vi springer opslaget over.
export async function checkAvailableSpend(supabaseClient, { teamId, balance, cost }) {
  if (!(Number(cost) > 0)) return null;
  if ((Number(balance) || 0) < Number(cost)) return { error: "insufficient_funds" };
  const commitment = await fetchAuctionCommitment(supabaseClient, teamId);
  return getAvailableSpendIssue({ balance, commitment, cost });
}
