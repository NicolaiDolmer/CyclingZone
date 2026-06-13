// Ungdomsmarked (#1308 Fase B) — afviste akademi-kandidater listes som
// individuelle ungdomsauktioner (auctions.is_youth=true, ingen sælger). Vinderen
// placeres i køberens akademi (8-plads-cap håndhæves i auctionFinalization).
// Usolgte ryttere forbliver unge free agents (team_id=NULL). Direct-sign af en
// free-agent-ungdom til minimumsløn = signFreeAgentYouth (Task 13).

import { calculateAuctionEnd, DEFAULT_AUCTION_CONFIG } from "./auctionEngine.js";
import { calculateRiderMarketValue } from "./marketUtils.js";

// Startpris for en ungdomsauktion = lav andel af markedsværdi. Afviste prospekter
// skal være billige at samle op, men ikke gratis. Gulv 1.
export const YOUTH_AUCTION_START_RATE = 0.25;

/**
 * Slå auktions-timing-config op (samme kilde som api.js' getAuctionConfig).
 * Kan injiceres i tests via opts.auctionConfig for at undgå tabel-mock.
 */
async function resolveAuctionConfig(supabase, auctionConfig) {
  if (auctionConfig) return auctionConfig;
  const { data } = await supabase
    .from("auction_timing_config")
    .select("*")
    .eq("id", 1)
    .single();
  return data || DEFAULT_AUCTION_CONFIG;
}

/**
 * Opret en ungdomsauktion for en afvist akademi-kandidat.
 *
 * Ingen sælger (seller_team_id=NULL) — klubben afviste prospektet, så der er
 * ingen at betale ud til. Vinderen betaler sit bud som academy_signing (sink)
 * og får rytteren i sit akademi; ingen bud → rytteren forbliver fri ungdom.
 *
 * @param {object} supabase
 * @param {object} opts
 * @param {string} opts.riderId
 * @param {Date}   [opts.now=new Date()]      — injicerbar til determinisme i test
 * @param {object} [opts.auctionConfig]       — injicerbar timing-config (test)
 * @returns {Promise<object>} den oprettede auktion
 */
export async function listRejectedAsYouthAuction(supabase, { riderId, now = new Date(), auctionConfig } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!riderId) throw new Error("listRejectedAsYouthAuction: riderId required");

  const { data: rider, error } = await supabase
    .from("riders")
    .select("id, firstname, lastname, base_value, market_value, prize_earnings_bonus, team_id")
    .eq("id", riderId)
    .maybeSingle();
  if (error) throw new Error(`listRejectedAsYouthAuction rider lookup: ${error.message}`);
  if (!rider) throw new Error(`listRejectedAsYouthAuction: rider ${riderId} not found`);

  const value = Math.max(1, calculateRiderMarketValue(rider));
  const startPrice = Math.max(1, Math.round(value * YOUTH_AUCTION_START_RATE));

  const cfg = await resolveAuctionConfig(supabase, auctionConfig);
  const calculatedEnd = calculateAuctionEnd(now, cfg);

  const { data: auction, error: insErr } = await supabase
    .from("auctions")
    .insert({
      rider_id: riderId,
      seller_team_id: null,
      starting_price: startPrice,
      current_price: startPrice,
      current_bidder_id: null,
      min_increment: 1,
      calculated_end: calculatedEnd.toISOString(),
      is_youth: true,
    })
    .select()
    .single();
  if (insErr) throw new Error(`listRejectedAsYouthAuction insert: ${insErr.message}`);
  return auction;
}
