import { cancelActiveAuctionsForRider } from "./auctionCancellation.js";
import { notifyAndClearWatchlistForRiders } from "./notificationService.js";

const NOOP = async () => {};

// #3594: den manglende "oprydnings-sti" for defekte ryttere. 9/8-hændelsen
// slettede fire akademi-ryttere direkte i databasen mens de havde aktive
// auktioner — cascade fjernede auctions/auction_bids sammen med rytteren, så
// ingen budgiver fik en `auction_cancelled`-notifikation (#3594, ramte
// @knud_r_flink + mindst 2 andre, 9/8). Denne funktion er den ene, delte sti
// enhver fremtidig admin-oprydning af en defekt rytter skal bruge — ALDRIG
// et direkte `DELETE FROM riders` igen:
//
//   1) annullér rytterens aktive/udvidede auktioner via
//      cancelAuctionByAdmin (cancelActiveAuctionsForRider) — notificerer
//      hver budgiver + sælger og frigiver bud, SAMME logik som en almindelig
//      admin-annullering (POST /api/admin/auctions/:id/cancel)
//   2) GUARD: lykkes annulleringen ikke for én eneste auktion, stoppes HELE
//      sletningen her — rytteren slettes ALDRIG med en uannulleret aktiv
//      auktion hængende (ejerens eksplicitte ønske i #3594)
//   3) ryd rider_watchlist + "har forladt spillet"-besked (#2524-mønsteret,
//      notifyAndClearWatchlistForRiders — samme funktion som de øvrige
//      kendte rytter-sletningsstier i aiTeamGenerator.js/auctionFinalization.js)
//   4) slet selve rytter-rækken, log til activity_feed til sidst
//
// `notifyTeamOwner` er obligatorisk (videreformidles til cancelAuctionByAdmin).
// `logActivity` er injicérbar for test/no-op i miljøer uden activity_feed.
export async function deleteRiderWithCleanup({
  supabase,
  riderId,
  adminUserId,
  notifyTeamOwner,
  logActivity = NOOP,
  now = new Date(),
}) {
  if (!riderId) {
    return { ok: false, code: "missing_rider_id" };
  }

  const { data: rider, error: riderError } = await supabase
    .from("riders")
    .select("id, firstname, lastname")
    .eq("id", riderId)
    .maybeSingle();
  if (riderError) throw riderError;

  if (!rider) {
    return { ok: false, code: "not_found", rider_id: riderId };
  }

  const riderName = `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim() || "Unknown rider";

  const cancelResults = await cancelActiveAuctionsForRider({
    supabase,
    riderId,
    adminUserId,
    notifyTeamOwner,
    logActivity,
    now,
  });

  // Guard (#3594 ønske 3): en auktion der ikke kunne annulleres blokerer
  // sletningen — rytteren må ikke forsvinde med en aktiv auktion stående.
  const failedCancel = cancelResults.find((result) => !result.ok);
  if (failedCancel) {
    return {
      ok: false,
      code: "auction_cancel_failed",
      rider_id: riderId,
      rider_name: riderName,
      detail: failedCancel,
    };
  }

  const { error: deleteError } = await supabase.from("riders").delete().eq("id", riderId);
  if (deleteError) throw deleteError;

  const watchlist = await notifyAndClearWatchlistForRiders({
    supabase,
    riders: [rider],
  });

  const cancelledAuctionCount = cancelResults.filter((result) => result.ok).length;

  await logActivity("rider_deleted_with_cleanup", {
    rider_id: rider.id,
    rider_name: riderName,
    meta: {
      admin_user_id: adminUserId,
      cancelled_auctions: cancelledAuctionCount,
    },
  });

  return {
    ok: true,
    code: "deleted",
    rider_id: rider.id,
    rider_name: riderName,
    cancelled_auctions: cancelledAuctionCount,
    watchlist,
  };
}
