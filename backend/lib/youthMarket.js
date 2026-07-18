// Ungdomsmarked (#1308 Fase B) — afviste akademi-kandidater listes som
// individuelle ungdomsauktioner (auctions.is_youth=true, ingen sælger). Vinderen
// placeres i køberens akademi (8-plads-cap håndhæves i auctionFinalization).
// #2456: usolgte ryttere SLETTES ved finalisering (forlader sporten) — fri-agent-
// butikken i akademiet (signFreeAgentYouth) er fjernet.

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
 * Den ene aktive/extended auktion en rytter må have (uniq_auctions_one_active_per_rider),
 * eller null. Bruges til idempotens i listRejectedAsYouthAuction.
 */
async function findActiveAuctionForRider(supabase, riderId) {
  const { data } = await supabase
    .from("auctions")
    .select("*")
    .eq("rider_id", riderId)
    .in("status", ["active", "extended"])
    .maybeSingle();
  return data ?? null;
}

/**
 * Opret en ungdomsauktion for en afvist akademi-kandidat.
 *
 * Ingen sælger (seller_team_id=NULL) — klubben afviste prospektet, så der er
 * ingen at betale ud til. Vinderen betaler sit bud som academy_signing (sink)
 * og får rytteren i sit akademi; ingen bud → rytteren SLETTES ved finalisering
 * (forlader sporten, #2456 — der findes ingen fri-agent-liste længere).
 *
 * Idempotent (CYCLINGZONE-14): en rytter må kun have én aktiv/extended auktion
 * (DB-niveau via uniq_auctions_one_active_per_rider). Et dobbeltklik-race på
 * afvis-knappen sender to requests der begge består intake-tjekket før nogen af
 * dem skriver — den anden insert ville ellers ramme unique-indexet (23505) og
 * boble op som en 500. Afvisningens mål ("rytteren ER listet") er allerede
 * opfyldt i det tilfælde, så vi returnerer den eksisterende auktion i stedet for
 * at fejle. Samme TOCTOU-løsning som POST /api/auctions (se
 * database/2026-05-06-auctions-unique-active-rider.sql).
 *
 * @param {object} supabase
 * @param {object} opts
 * @param {string} opts.riderId
 * @param {Date}   [opts.now=new Date()]      — injicerbar til determinisme i test
 * @param {object} [opts.auctionConfig]       — injicerbar timing-config (test)
 * @returns {Promise<object>} den oprettede (eller allerede eksisterende) auktion
 */
export async function listRejectedAsYouthAuction(supabase, { riderId, now = new Date(), auctionConfig, durationHours } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!riderId) throw new Error("listRejectedAsYouthAuction: riderId required");

  const { data: rider, error } = await supabase
    .from("riders")
    .select("id, firstname, lastname, base_value, market_value, prize_earnings_bonus, team_id")
    .eq("id", riderId)
    .maybeSingle();
  if (error) throw new Error(`listRejectedAsYouthAuction rider lookup: ${error.message}`);
  if (!rider) throw new Error(`listRejectedAsYouthAuction: rider ${riderId} not found`);

  // Hurtig vej: ligger rytteren allerede på en aktiv auktion (gentaget afvisning
  // eller dobbeltklik), så er afvisningen idempotent — returnér den i stedet for
  // at forsøge en dublet-insert der ville fejle på unique-indexet.
  const existing = await findActiveAuctionForRider(supabase, riderId);
  if (existing) return existing;

  const value = Math.max(1, calculateRiderMarketValue(rider));
  const startPrice = Math.max(1, Math.round(value * YOUTH_AUCTION_START_RATE));

  let cfg = await resolveAuctionConfig(supabase, auctionConfig);
  // #2627/ejer-ønske 18/7: udløbne intake-ryttere skal ligge LÆNGERE på markedet
  // end standard-varigheden (1 aktiv time i prod) — de har ingen ejer der venter,
  // og en længere auktion giver flere hold chancen for at byde. Override rører
  // kun varigheden; vindues-/extension-mekanikken er uændret (auktioner slutter
  // stadig aldrig om natten, jf. active-window-modellen).
  if (durationHours) cfg = { ...cfg, duration_hours: durationHours };
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
  if (insErr) {
    // TOCTOU-race: to afvisninger i sub-sekund-vindue består begge pre-tjekket og
    // når frem til insert; den anden rammer unique-indexet (23505). Behandl det
    // idempotent — hent og returnér vinderens auktion frem for at fejle.
    if (insErr.code === "23505") {
      const raced = await findActiveAuctionForRider(supabase, riderId);
      if (raced) return raced;
    }
    throw new Error(`listRejectedAsYouthAuction insert: ${insErr.message}`);
  }
  return auction;
}
