// #4211 (ejer-regel 3/11): en auktion saetter rytterens transferliste paa pause.
//
// Ejerens ord: "Saettes en rytter paa auktion, fjernes den automatisk fra
// transferlisten imens. Naar auktionen er slut uden salg, er rytteren tilbage
// paa transferlisten. Mens en rytter er paa auktion, kan den ikke saettes paa
// transferlisten."
//
// Mekanik:
//   - Start af auktion: rytterens open/negotiating transfer_listings saettes til
//     status 'paused' (pauseTransferListingsForAuction). Raekken bevares med
//     pris og saelger, saa den kan komme tilbage uaendret.
//   - Slut paa auktion (finalizeAuctionById + admin-annullering): de pausede
//     raekker afgoeres (resumePausedTransferListings). Er rytteren stadig paa
//     saelgerens hold, uden ventende overgang og ikke pensioneret, gaar
//     listingen tilbage til 'open'. Ellers (solgt, flyttet, pensioneret)
//     saettes den til 'withdrawn': den kan aldrig handles igen.
//   - Ny listing mens auktionen koerer afvises i POST /transfers
//     (errorCode rider_on_auction_listing).
//
// 'paused' er en ny vaerdi i transfer_listings.status (migration
// database/2026-11-03-4211-auction-transfer-list-pause.sql). Alle markeds-
// laesninger filtrerer paa open/negotiating, saa en pauset listing er usynlig
// paa markedet og i invariant-tjekket no_double_market_listing uden flere
// aendringer.
//
// Fejl-semantik: pause/genoptag koerer EFTER at auktionen er oprettet/lukket.
// En fejl her maa aldrig vaelte selve auktionen (pengene og budene er det
// vigtige), saa kaldstederne bruger safe-varianterne, der logger til Sentry.
// Genoptag er idempotent og kan koeres igen af reparationsscriptet
// (scripts/repair-4211-auction-transfer-double.mjs).

import { captureException } from "./sentry.js";

export const PAUSED_LISTING_STATUS = "paused";
export const PAUSABLE_LISTING_STATUSES = Object.freeze(["open", "negotiating"]);
const ACTIVE_AUCTION_STATUSES = ["active", "extended"];
// 23505 = unique_violation (uniq_transfer_listings_one_active_per_rider): der
// findes allerede en aktiv listing paa rytteren, saa den pausede kan ikke
// genaabnes ved siden af.
const UNIQUE_VIOLATION = "23505";

function uniqueIds(ids) {
  return [...new Set((ids || []).filter(Boolean))];
}

/**
 * PURE: hvad sker der med en pauset listing, naar rytterens auktion er slut?
 * @param {{ listing: { seller_team_id: string|null }, rider: { team_id?: string|null, pending_team_id?: string|null, is_retired?: boolean }|null|undefined, riderOnActiveAuction: boolean }} args
 * @returns {"keep_paused"|"resume"|"withdraw"}
 */
export function getPausedListingDecision({ listing, rider, riderOnActiveAuction }) {
  if (riderOnActiveAuction) return "keep_paused";
  if (!rider) return "withdraw";
  if (rider.is_retired) return "withdraw";
  if (rider.pending_team_id) return "withdraw";
  if (!listing?.seller_team_id) return "withdraw";
  if ((rider.team_id ?? null) !== listing.seller_team_id) return "withdraw";
  return "resume";
}

/**
 * PURE: POST /transfers-guarden. En rytter paa aktiv auktion kan ikke listes.
 * @param {{ riderId: string, activeAuctionRiderIds: string[] }} args
 * @returns {{ code: "rider_on_auction_listing" }|null}
 */
export function getListingOnAuctionIssue({ riderId, activeAuctionRiderIds }) {
  if (!riderId) return null;
  return (activeAuctionRiderIds || []).includes(riderId)
    ? { code: "rider_on_auction_listing" }
    : null;
}

/**
 * Saet rytterens aktive transfer_listings paa pause. Idempotent.
 * @param {any} supabase
 * @param {{ riderId: string }} args
 * @returns {Promise<{ paused: number }>}
 */
export async function pauseTransferListingsForAuction(supabase, { riderId }) {
  if (!riderId) return { paused: 0 };
  const { data, error } = await supabase
    .from("transfer_listings")
    .update({ status: PAUSED_LISTING_STATUS })
    .eq("rider_id", riderId)
    .in("status", PAUSABLE_LISTING_STATUSES)
    .select("id");
  if (error) throw new Error(`pause transfer_listings (${riderId}): ${error.message}`);
  return { paused: (data || []).length };
}

async function setPausedListingStatus(supabase, listingId, status) {
  const { data, error } = await supabase
    .from("transfer_listings")
    .update({ status })
    .eq("id", listingId)
    .eq("status", PAUSED_LISTING_STATUS)
    .select("id");
  return { changed: (data || []).length, error };
}

/**
 * Afgoer pausede listings for ryttere hvis auktion er slut. Idempotent: roerer
 * kun raekker der stadig er 'paused', og lader dem staa saa laenge rytteren
 * har en aktiv auktion.
 * @param {any} supabase
 * @param {{ riderIds: string[] }} args
 * @returns {Promise<{ resumed: string[], withdrawn: string[], kept: string[] }>}
 */
export async function resumePausedTransferListings(supabase, { riderIds }) {
  const result = { resumed: [], withdrawn: [], kept: [] };
  const ids = uniqueIds(riderIds);
  if (ids.length === 0) return result;

  const { data: paused, error: pausedError } = await supabase
    .from("transfer_listings")
    .select("id, rider_id, seller_team_id, status")
    .in("rider_id", ids)
    .eq("status", PAUSED_LISTING_STATUS);
  if (pausedError) throw new Error(`read paused transfer_listings: ${pausedError.message}`);
  if (!paused || paused.length === 0) return result;

  const pausedRiderIds = uniqueIds(paused.map((l) => l.rider_id));
  const [{ data: auctions, error: auctionError }, { data: riders, error: riderError }] = await Promise.all([
    supabase
      .from("auctions")
      .select("rider_id")
      .in("rider_id", pausedRiderIds)
      .in("status", ACTIVE_AUCTION_STATUSES),
    supabase
      .from("riders")
      .select("id, team_id, pending_team_id, is_retired")
      .in("id", pausedRiderIds),
  ]);
  if (auctionError) throw new Error(`read active auctions: ${auctionError.message}`);
  if (riderError) throw new Error(`read riders: ${riderError.message}`);

  const onAuction = new Set((auctions || []).map((a) => a.rider_id));
  const riderById = new Map((riders || []).map((r) => [r.id, r]));

  for (const listing of paused) {
    const decision = getPausedListingDecision({
      listing,
      rider: riderById.get(listing.rider_id),
      riderOnActiveAuction: onAuction.has(listing.rider_id),
    });
    if (decision === "keep_paused") {
      result.kept.push(listing.id);
      continue;
    }
    if (decision === "resume") {
      const { changed, error } = await setPausedListingStatus(supabase, listing.id, "open");
      if (!error) {
        if (changed) result.resumed.push(listing.id);
        continue;
      }
      if (error.code !== UNIQUE_VIOLATION) {
        throw new Error(`resume transfer_listing ${listing.id}: ${error.message}`);
      }
      // En anden aktiv listing staar allerede paa rytteren: den pausede lukkes.
    }
    const { changed, error } = await setPausedListingStatus(supabase, listing.id, "withdrawn");
    if (error) throw new Error(`withdraw paused transfer_listing ${listing.id}: ${error.message}`);
    if (changed) result.withdrawn.push(listing.id);
  }
  return result;
}

/**
 * Best-effort: afgoer pausede listings for rytteren bag en given auktion
 * (admin-annullering, hvor kalderen kun kender auktions-id'et).
 * @param {any} supabase
 * @param {string} auctionId
 */
export async function safeResumePausedListingsForAuctionId(supabase, auctionId) {
  try {
    if (!auctionId) return { resumed: [], withdrawn: [], kept: [] };
    const { data, error } = await supabase
      .from("auctions")
      .select("rider_id")
      .eq("id", auctionId)
      .maybeSingle();
    if (error) throw new Error(`read auction ${auctionId}: ${error.message}`);
    return await resumePausedTransferListings(supabase, { riderIds: [data?.rider_id] });
  } catch (err) {
    captureException(err, { tags: { area: "auction_transfer_list_pause", step: "resume_by_auction" } });
    return { resumed: [], withdrawn: [], kept: [], error: err.message };
  }
}

/**
 * Best-effort-variant til POST /auctions: auktionen er allerede oprettet.
 * @param {any} supabase
 * @param {{ riderId: string }} args
 */
export async function safePauseTransferListingsForAuction(supabase, { riderId }) {
  try {
    return await pauseTransferListingsForAuction(supabase, { riderId });
  } catch (err) {
    captureException(err, { tags: { area: "auction_transfer_list_pause", step: "pause" } });
    return { paused: 0, error: err.message };
  }
}

/**
 * Best-effort-variant til finalisering/annullering: auktionen er allerede lukket.
 * @param {any} supabase
 * @param {{ riderIds: string[] }} args
 */
export async function safeResumePausedTransferListings(supabase, { riderIds }) {
  try {
    return await resumePausedTransferListings(supabase, { riderIds });
  } catch (err) {
    captureException(err, { tags: { area: "auction_transfer_list_pause", step: "resume" } });
    return { resumed: [], withdrawn: [], kept: [], error: err.message };
  }
}
