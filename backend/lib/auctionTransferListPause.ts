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
//   - Auktions-cronen afgoer forladte pauser (reconcileOrphanPausedListings).
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
export const PAUSABLE_LISTING_STATUSES: readonly string[] = Object.freeze(["open", "negotiating"]);
const ACTIVE_AUCTION_STATUSES = ["active", "extended"];
// 23505 = unique_violation (uniq_transfer_listings_one_active_per_rider): der
// findes allerede en aktiv listing paa rytteren, saa den pausede kan ikke
// genaabnes ved siden af.
const UNIQUE_VIOLATION = "23505";

// Supabase-klienten er utypet i backend (samme konvention som resten af kernen).
type Db = any;

export type PausedListingDecision = "keep_paused" | "resume" | "withdraw";

export interface ListingRow {
  id: string;
  rider_id: string;
  seller_team_id: string | null;
  status: string;
}

export interface RiderState {
  id?: string;
  team_id?: string | null;
  pending_team_id?: string | null;
  is_retired?: boolean | null;
}

export interface ResumeResult {
  resumed: string[];
  withdrawn: string[];
  kept: string[];
  error?: string;
}

function uniqueIds(ids: ReadonlyArray<string | null | undefined> | null | undefined): string[] {
  return [...new Set((ids || []).filter((id): id is string => Boolean(id)))];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** PURE: hvad sker der med en pauset listing, naar rytterens auktion er slut? */
export function getPausedListingDecision({
  listing,
  rider,
  riderOnActiveAuction,
}: {
  listing: { seller_team_id: string | null } | null | undefined;
  rider: RiderState | null | undefined;
  riderOnActiveAuction: boolean;
}): PausedListingDecision {
  if (riderOnActiveAuction) return "keep_paused";
  if (!rider) return "withdraw";
  if (rider.is_retired) return "withdraw";
  if (rider.pending_team_id) return "withdraw";
  if (!listing?.seller_team_id) return "withdraw";
  if ((rider.team_id ?? null) !== listing.seller_team_id) return "withdraw";
  return "resume";
}

/** PURE: POST /transfers-guarden. En rytter paa aktiv auktion kan ikke listes. */
export function getListingOnAuctionIssue({
  riderId,
  activeAuctionRiderIds,
}: {
  riderId: string | null | undefined;
  activeAuctionRiderIds: readonly string[] | null | undefined;
}): { code: "rider_on_auction_listing" } | null {
  if (!riderId) return null;
  return (activeAuctionRiderIds || []).includes(riderId)
    ? { code: "rider_on_auction_listing" }
    : null;
}

/** Saet rytterens aktive transfer_listings paa pause. Idempotent. */
export async function pauseTransferListingsForAuction(
  supabase: Db,
  { riderId }: { riderId: string | null | undefined },
): Promise<{ paused: number }> {
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

async function setPausedListingStatus(
  supabase: Db,
  listingId: string,
  status: string,
): Promise<{ changed: number; error: { code?: string; message: string } | null }> {
  const { data, error } = await supabase
    .from("transfer_listings")
    .update({ status })
    .eq("id", listingId)
    .eq("status", PAUSED_LISTING_STATUS)
    .select("id");
  return { changed: (data || []).length, error: error ?? null };
}

async function fetchActiveAuctionRiderIds(supabase: Db, riderIds: string[]): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("auctions")
    .select("rider_id")
    .in("rider_id", riderIds)
    .in("status", ACTIVE_AUCTION_STATUSES);
  if (error) throw new Error(`read active auctions: ${error.message}`);
  return new Set(((data || []) as Array<{ rider_id: string }>).map((a) => a.rider_id));
}

/**
 * Afgoer pausede listings for ryttere hvis auktion er slut. Idempotent: roerer
 * kun raekker der stadig er 'paused', og lader dem staa saa laenge rytteren
 * har en aktiv auktion.
 */
export async function resumePausedTransferListings(
  supabase: Db,
  { riderIds }: { riderIds: ReadonlyArray<string | null | undefined> },
): Promise<ResumeResult> {
  const result: ResumeResult = { resumed: [], withdrawn: [], kept: [] };
  const ids = uniqueIds(riderIds);
  if (ids.length === 0) return result;

  const { data: pausedData, error: pausedError } = await supabase
    .from("transfer_listings")
    .select("id, rider_id, seller_team_id, status")
    .in("rider_id", ids)
    .eq("status", PAUSED_LISTING_STATUS);
  if (pausedError) throw new Error(`read paused transfer_listings: ${pausedError.message}`);
  const paused = (pausedData || []) as ListingRow[];
  if (paused.length === 0) return result;

  const pausedRiderIds = uniqueIds(paused.map((l) => l.rider_id));
  const [onAuction, { data: riders, error: riderError }] = await Promise.all([
    fetchActiveAuctionRiderIds(supabase, pausedRiderIds),
    supabase
      .from("riders")
      .select("id, team_id, pending_team_id, is_retired")
      .in("id", pausedRiderIds), // pagination-safe: bundet af de pausede listings' rytter-id'er
  ]);
  if (riderError) throw new Error(`read riders: ${riderError.message}`);

  const riderById = new Map(((riders || []) as RiderState[]).map((r) => [r.id, r]));

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
    // Opus-review P3: en enkelt raekke der fejler (fx en trigger) maa ikke
    // blokere alle pauser bag den, ellers rammer cronen samme raekke hvert minut.
    try {
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
    } catch (err) {
      captureException(err, { tags: { area: "auction_transfer_list_pause", step: "resume_listing" } });
      result.error = result.error ?? errorMessage(err);
    }
  }

  // Efter-tjek (Codex P2): en ny auktion kan vaere startet mellem opslaget
  // ovenfor og genaabningen. Dens pause saa en allerede pauset listing og gjorde
  // intet, saa listingen pauses igen her. POST /auctions indsaetter auktionen
  // FOER pausen, saa enten ser dette tjek auktionen, eller pausen ser 'open'.
  if (result.resumed.length > 0) {
    const resumedRiderIds = uniqueIds(
      paused.filter((l) => result.resumed.includes(l.id)).map((l) => l.rider_id),
    );
    const lateAuctions = await fetchActiveAuctionRiderIds(supabase, resumedRiderIds);
    for (const riderId of lateAuctions) {
      await pauseTransferListingsForAuction(supabase, { riderId });
      const repaused = paused.filter((l) => l.rider_id === riderId).map((l) => l.id);
      result.resumed = result.resumed.filter((id) => !repaused.includes(id));
      result.kept.push(...repaused);
    }
  }
  return result;
}

/**
 * Oprydning af forladte pauser: 'paused' listings hvis rytter ikke laengere har
 * en aktiv auktion (fx en finalisering hvor genoptag-trinnet fejlede). Koeres af
 * auktions-cronen efter finaliseringen (Codex P2). Partial index
 * idx_transfer_listings_paused holder opslaget billigt.
 */
export async function reconcileOrphanPausedListings(
  supabase: Db,
  { limit = 200 }: { limit?: number } = {},
): Promise<ResumeResult> {
  // Codex P2: pausede listings for stadig aktive auktioner bliver staaende, saa et
  // fast vindue paa de foerste `limit` raekker kunne skygge for en foraeldreloes
  // pause bag dem for evigt. Bladr derfor (stabil id-orden) forbi aktive
  // auktioner, til `limit` foraeldreloese ryttere er fundet eller listen er slut.
  const orphans: string[] = [];
  for (let from = 0; orphans.length < limit; from += limit) {
    const { data, error } = await supabase
      .from("transfer_listings")
      .select("id, rider_id")
      .eq("status", PAUSED_LISTING_STATUS)
      .order("id", { ascending: true })
      .range(from, from + limit - 1);
    if (error) throw new Error(`read paused transfer_listings: ${error.message}`);
    const rows = (data || []) as Array<{ id: string; rider_id: string }>;
    const riderIds = uniqueIds(rows.map((l) => l.rider_id));
    if (riderIds.length === 0) break;
    const active = await fetchActiveAuctionRiderIds(supabase, riderIds);
    for (const riderId of riderIds) {
      if (!active.has(riderId) && !orphans.includes(riderId)) orphans.push(riderId);
    }
    if (rows.length < limit) break;
  }
  return resumePausedTransferListings(supabase, { riderIds: orphans.slice(0, limit) });
}

/**
 * Best-effort: afgoer pausede listings for rytteren bag en given auktion
 * (admin-annullering, hvor kalderen kun kender auktions-id'et).
 */
export async function safeResumePausedListingsForAuctionId(
  supabase: Db,
  auctionId: string | null | undefined,
): Promise<ResumeResult> {
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
    return { resumed: [], withdrawn: [], kept: [], error: errorMessage(err) };
  }
}

/** Best-effort-variant til POST /auctions: auktionen er allerede oprettet. */
export async function safePauseTransferListingsForAuction(
  supabase: Db,
  { riderId }: { riderId: string | null | undefined },
): Promise<{ paused: number; error?: string }> {
  try {
    return await pauseTransferListingsForAuction(supabase, { riderId });
  } catch (err) {
    captureException(err, { tags: { area: "auction_transfer_list_pause", step: "pause" } });
    return { paused: 0, error: errorMessage(err) };
  }
}

/** Best-effort-variant til finalisering/annullering: auktionen er allerede lukket. */
export async function safeResumePausedTransferListings(
  supabase: Db,
  { riderIds }: { riderIds: ReadonlyArray<string | null | undefined> },
): Promise<ResumeResult> {
  try {
    return await resumePausedTransferListings(supabase, { riderIds });
  } catch (err) {
    captureException(err, { tags: { area: "auction_transfer_list_pause", step: "resume" } });
    return { resumed: [], withdrawn: [], kept: [], error: errorMessage(err) };
  }
}

/** Best-effort-variant til auktions-cronen. */
export async function safeReconcileOrphanPausedListings(supabase: Db): Promise<ResumeResult> {
  try {
    return await reconcileOrphanPausedListings(supabase);
  } catch (err) {
    captureException(err, { tags: { area: "auction_transfer_list_pause", step: "reconcile" } });
    return { resumed: [], withdrawn: [], kept: [], error: errorMessage(err) };
  }
}
