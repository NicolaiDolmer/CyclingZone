// #3508: delt beregning af "disponibel saldo" (rå team.balance minus beløb
// bundet i førende auktionsbud + proxy-max). FinancePage ejede oprindeligt
// denne beregning alene (#44) — Dashboard-headeren viste i stedet rå
// team.balance, hvilket kunne vise et tal 100k+ højere end det manageren
// reelt kunne disponere over (prod-eksempel: 316.004 CZ$ rå mod ~191.000
// CZ$ bundet). Begge sider skal bruge PRÆCIS samme beregning her, så
// tallene aldrig kan drifte fra hinanden (jf. .claude/learnings-mønstret:
// dashboardet må aldrig genopfinde en beregning en kildeside ejer).
//
// "Reserveret" = worst-case commitment for igangværende auktioner:
//   - Fører holdet budet: MAX(nuværende pris, egen proxy-max) — hvis nogen
//     overbyder, kan proxyen automatisk gå helt op til proxy-maxet.
//   - Holdet fører ikke, men har en aktiv proxy: proxy-maxet (holdet kan
//     blive udløst helt op til det beløb).

/**
 * @param {Array<{id: string, current_price?: number}>} leadingAuctions
 *   Auktioner (status active/extended) hvor holdet er current_bidder_id.
 * @param {Array<{auction_id: string, max_amount?: number, auction?: {status?: string}}>} proxyBids
 *   Holdets proxy-bud, joinet med auktionens status.
 * @returns {number} Samlet beløb bundet i bud (aldrig negativt).
 */
export function computeReservedBalance(leadingAuctions = [], proxyBids = []) {
  const leadingMap = new Map();
  for (const a of leadingAuctions || []) leadingMap.set(a.id, a.current_price || 0);

  const proxyMap = new Map();
  for (const p of proxyBids || []) {
    if (["active", "extended"].includes(p.auction?.status)) {
      proxyMap.set(p.auction_id, p.max_amount || 0);
    }
  }

  let reserved = 0;
  const seen = new Set();
  for (const [auctionId, currentPrice] of leadingMap) {
    reserved += Math.max(currentPrice, proxyMap.get(auctionId) || 0);
    seen.add(auctionId);
  }
  for (const [auctionId, proxyMax] of proxyMap) {
    if (!seen.has(auctionId)) reserved += proxyMax;
  }
  return reserved;
}

/**
 * @param {number} balance Rå team.balance.
 * @param {number} reserved computeReservedBalance(...)-resultat.
 * @returns {number} Disponibel saldo, aldrig negativ.
 */
export function computeAvailableBalance(balance, reserved) {
  return Math.max(0, (balance || 0) - (reserved || 0));
}

/**
 * Henter holdets leading-auktioner + proxy-bud og beregner reserveret
 * beløb. Samme to queries som FinancePage har brugt siden #44 — genbruges
 * nu også af Dashboard-headeren så begge sider forbliver synkrone uden at
 * skulle huske at holde to query-implementeringer i sync.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} teamId
 * @returns {Promise<number>}
 */
export async function fetchReservedBalance(supabase, teamId) {
  const [leadingRes, proxiesRes] = await Promise.all([
    supabase.from("auctions")
      .select("id, current_price")
      .in("status", ["active", "extended"])
      .eq("current_bidder_id", teamId),
    supabase.from("auction_proxy_bids")
      .select("auction_id, max_amount, auction:auction_id(status)")
      .eq("team_id", teamId),
  ]);
  return computeReservedBalance(leadingRes.data || [], proxiesRes.data || []);
}
