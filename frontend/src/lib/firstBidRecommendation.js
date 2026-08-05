// #3007: 68 rigtige hold har aldrig lagt et bud. Den største gruppe blandt dem
// der overhovedet vender tilbage er "åbnede /auctions, men bød aldrig" — ikke
// discoverability af siden, men hvad der sker NÅR de er der: en tabel med 20+
// auktioner uden noget "start her"-signal. Denne funktion peger på ÉN konkret,
// lav-friktion auktion i stedet for at kræve at manageren selv skal
// gennemskue budregler, prisniveau og tid-tilbage samtidig — færre skridt,
// ikke endnu en tooltip. Ren funktion: testes uden DOM/browser.
//
// Heuristik (bevidst simpel — "et let første bud", ikke "det bedste køb"):
//   1. Ryttere manageren ikke allerede fører eller sælger selv.
//   2. Mindst MIN_TIME_LEFT_MS tilbage, så der er tid til at læse og beslutte
//      sig — en ny manager skal ikke risikere at auktionen lukker under ham.
//   3. Billigste nuværende bud først (laveste beløb = laveste commitment for
//      et første forsøg), sekundært den der lukker snarest.
import { getAuctionLeaderId, isManagerSeller } from "./auctionLogic.js";

export const FIRST_BID_MIN_TIME_LEFT_MS = 5 * 60 * 1000; // 5 min

export function pickFirstBidRecommendation(auctions, { myTeamId, now = new Date() } = {}) {
  const nowMs = new Date(now).getTime();
  const candidates = (auctions || []).filter(a => {
    if (!a?.rider) return false;
    if (a.status === "completed") return false;
    if (isManagerSeller(a, myTeamId)) return false;
    if (getAuctionLeaderId(a) === myTeamId) return false;
    const end = a.calculated_end ? new Date(a.calculated_end).getTime() : null;
    if (end !== null && end - nowMs < FIRST_BID_MIN_TIME_LEFT_MS) return false;
    return true;
  });
  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const priceDiff = (a.current_price || 0) - (b.current_price || 0);
    if (priceDiff !== 0) return priceDiff;
    const aEnd = a.calculated_end ? new Date(a.calculated_end).getTime() : Infinity;
    const bEnd = b.calculated_end ? new Date(b.calculated_end).getTime() : Infinity;
    return aEnd - bEnd;
  });
  return candidates[0];
}
