import { ensureNoError, expectMaybeSingle, expectMutation } from "./marketUtils.js";
import { ADMIN_ACTION_TYPE } from "./economyConstants.js";

const NOOP = async () => {};
const CANCELLABLE_STATUSES = ["active", "extended"];

export async function cancelAuctionByAdmin({
  supabase,
  auctionId,
  adminUserId,
  notifyTeamOwner,
  logActivity = NOOP,
  now = new Date(),
}) {
  const auction = await expectMaybeSingle(
    supabase
      .from("auctions")
      .select("*, rider:rider_id(id, firstname, lastname, team_id, ai_team_id)")
      .eq("id", auctionId)
  );

  if (!auction) {
    return { ok: false, code: "not_found", auction_id: auctionId };
  }

  if (!CANCELLABLE_STATUSES.includes(auction.status)) {
    return { ok: false, code: "not_cancellable", status: auction.status, auction_id: auctionId };
  }

  // Atomar status-skift sikrer race mod parallel finalizer.
  const { data: cancelledRows, error: cancelError } = await supabase
    .from("auctions")
    .update({
      status: "cancelled",
      cancelled_at: now.toISOString(),
      cancelled_by_user_id: adminUserId,
      actual_end: now.toISOString(),
    })
    .eq("id", auctionId)
    .in("status", CANCELLABLE_STATUSES)
    .select("id");

  ensureNoError(cancelError);

  if (!cancelledRows || cancelledRows.length === 0) {
    // Finalizer vandt løbet mellem read og write.
    return { ok: false, code: "race_lost", auction_id: auctionId };
  }

  // Defensiv: ryd pending_team_id hvis tidligere fejlfinalize satte det.
  if (auction.rider?.id) {
    await expectMutation(
      supabase.from("riders").update({ pending_team_id: null }).eq("id", auction.rider.id)
    );
  }

  // Saml unikke bidders fra auction_bids.
  const { data: bidRows, error: bidError } = await supabase
    .from("auction_bids")
    .select("team_id")
    .eq("auction_id", auctionId);
  ensureNoError(bidError);

  const bidderTeamIds = Array.from(
    new Set((bidRows || []).map(b => b.team_id).filter(Boolean))
  );

  const riderName = auction.rider
    ? `${auction.rider.firstname} ${auction.rider.lastname}`
    : "ukendt rytter";

  const bidderMessage = `Auktionen på ${riderName} er annulleret af en admin. Dit bud er frigivet og din balance er igen disponibel.`;

  for (const teamId of bidderTeamIds) {
    try {
      await notifyTeamOwner(
        teamId,
        "auction_cancelled",
        "Auktion annulleret",
        bidderMessage,
        auctionId
      );
    } catch (_e) { /* best-effort — block ikke andre notifikationer */ }
  }

  // Notificér sælger (hvis sat og ikke allerede budgivet).
  if (auction.seller_team_id && !bidderTeamIds.includes(auction.seller_team_id)) {
    try {
      await notifyTeamOwner(
        auction.seller_team_id,
        "auction_cancelled",
        "Auktion annulleret",
        `Din auktion på ${riderName} er annulleret af en admin.`,
        auctionId
      );
    } catch (_e) { /* best-effort */ }
  }

  await logActivity("auction_cancelled", {
    rider_id: auction.rider?.id || null,
    rider_name: riderName,
    meta: { auction_id: auctionId, admin_user_id: adminUserId, bidder_count: bidderTeamIds.length },
  });

  await expectMutation(
    supabase.from("admin_log").insert({
      admin_user_id: adminUserId,
      action_type: ADMIN_ACTION_TYPE.AUCTION_CANCEL,
      description: `Auktion annulleret: ${riderName} (${bidderTeamIds.length} bud frigivet)`,
      target_team_id: auction.seller_team_id || null,
      target_rider_id: auction.rider?.id || null,
      meta: { auction_id: auctionId, current_price: auction.current_price, bidder_count: bidderTeamIds.length },
    })
  );

  return {
    ok: true,
    code: "cancelled",
    auction_id: auctionId,
    bidder_count: bidderTeamIds.length,
    rider_name: riderName,
  };
}
