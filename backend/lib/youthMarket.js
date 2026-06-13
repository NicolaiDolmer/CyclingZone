// Ungdomsmarked (#1308 Fase B) — afviste akademi-kandidater listes som
// individuelle ungdomsauktioner (auctions.is_youth=true, ingen sælger). Vinderen
// placeres i køberens akademi (8-plads-cap håndhæves i auctionFinalization).
// Usolgte ryttere forbliver unge free agents (team_id=NULL). Direct-sign af en
// free-agent-ungdom til minimumsløn = signFreeAgentYouth (Task 13).

import { calculateAuctionEnd, DEFAULT_AUCTION_CONFIG } from "./auctionEngine.js";
import { calculateRiderMarketValue } from "./marketUtils.js";
import { getTeamAcademyCount } from "./academyIntake.js";
import { ACADEMY, isAcademyAge } from "./academyFlag.js";

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

/**
 * Direct-sign en fri ungdoms-free-agent ind i holdets akademi til minimumsløn.
 *
 * En usolgt ungdomsauktion efterlader rytteren som fri ungdom (team_id=NULL);
 * denne rute lader et hold optage ham direkte. Ingen signing-fee (gratis fra
 * free-agent-pool) — kun den løbende minimumsløn (= SALARY_RATE × markedsværdi)
 * og akademi-drift belaster økonomien. 8-plads-cap gælder.
 *
 * Rækkefølge-garanti: al validering (free-agent + alder + cap) sker FØR write.
 *
 * @param {object} supabase
 * @param {object} opts
 * @param {string} opts.teamId
 * @param {string} opts.riderId
 * @param {number} opts.seasonNumber  — aktiv sæsons nummer (contract_end_season)
 * @param {Date}   [opts.now=new Date()]
 * @returns {Promise<{riderId, salary, contractEndSeason}>}
 * @throws {Error} 'not_free_agent' | 'not_academy_age' | 'academy_full'
 */
export async function signFreeAgentYouth(supabase, { teamId, riderId, seasonNumber, now = new Date() } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!teamId || !riderId) throw new Error("signFreeAgentYouth: teamId + riderId required");

  const { data: rider, error } = await supabase
    .from("riders")
    .select("id, team_id, is_academy, birthdate, base_value, market_value, prize_earnings_bonus")
    .eq("id", riderId)
    .maybeSingle();
  if (error) throw new Error(`signFreeAgentYouth rider lookup: ${error.message}`);
  if (!rider) throw new Error(`signFreeAgentYouth: rider ${riderId} not found`);

  // Skal være en fri rytter (ingen ejer, ikke allerede akademi).
  if (rider.team_id || rider.is_academy) throw new Error("not_free_agent");

  // Må IKKE være tilbudt i et intake-kuld (tilhører et bestemt holds intake) eller
  // ligge på en aktiv ungdomsauktion (ellers bypasser man auktionen og henter en
  // rytter andre byder på, gratis til minimumsløn). Begge har team_id=NULL +
  // is_academy=false, så de passerer free-agent-grundkriterierne uden disse tjek.
  const { data: offeredIntake } = await supabase
    .from("academy_intake")
    .select("id")
    .eq("rider_id", riderId)
    .eq("status", "offered")
    .maybeSingle();
  if (offeredIntake) throw new Error("not_free_agent");

  const { data: activeAuction } = await supabase
    .from("auctions")
    .select("id")
    .eq("rider_id", riderId)
    .in("status", ["active", "extended"])
    .maybeSingle();
  if (activeAuction) throw new Error("not_free_agent");

  // Skal være i akademi-alder (16-21).
  const age = rider.birthdate ? now.getFullYear() - new Date(rider.birthdate).getFullYear() : null;
  if (!isAcademyAge(age)) throw new Error("not_academy_age");

  // 8-plads akademi-cap.
  const count = await getTeamAcademyCount(supabase, teamId);
  if (count >= ACADEMY.SLOTS) throw new Error("academy_full");

  const value = Math.max(1, calculateRiderMarketValue(rider));
  const salary = Math.max(1, Math.round(value * ACADEMY.SALARY_RATE));
  const contractEndSeason = seasonNumber + ACADEMY.CONTRACT_LENGTH - 1;

  const { error: upErr } = await supabase
    .from("riders")
    .update({
      is_academy: true,
      team_id: teamId,
      acquired_at: now.toISOString(),
      salary,
      contract_length: ACADEMY.CONTRACT_LENGTH,
      contract_end_season: contractEndSeason,
    })
    .eq("id", riderId);
  if (upErr) throw new Error(`signFreeAgentYouth update: ${upErr.message}`);

  return { riderId, salary, contractEndSeason };
}
