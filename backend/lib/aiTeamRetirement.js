// #4753: pool retirement preserves team, rider, offer and race history.
// Service-only retire_ai_pool_team rechecks obligations and pool budget under
// locks; reservation, watchlist notifications and retirement are atomic.
// Existing live deals finish; terminal offers are preserved and never block.
// Disabled automatic retirement pauses instead of reverting to hard deletion.
// SSOT: docs/TRANSFER_MARKET_RULES.md and docs/GAME_INVARIANTS.md.

import { fetchAllRows } from "./supabasePagination.js";
// Spejler ACTIVE_MARKET_STATUSES (transferExecution.js) og openStatuses
// (marketUtils.withdrawOpenTransferDealsForRiders). Ét begreb om "tilbuddet lever".
export const LIVE_OFFER_STATUSES = ["pending", "countered", "awaiting_confirmation"];

// Rytter-id-chunk for .in()-lister. Samme 100 som hård-slet-stien brugte: en lang
// in-liste sprænger gateway'ens URL-grænse (~16 KB, ramte 26/7 ved 24 hold).
const RIDER_CHUNK = 100;

/**
 * Har holdet LEVENDE transfer-tilbud (som køber-modpart på en af dets ryttere, eller
 * som sælger)? Kun disse udskyder en nedlæggelse — døde tilbud er irrelevante når
 * intet slettes.
 *
 * Bevidst IKKE en variant af teamHasBlockingTransferOffers (aiTeamGenerator.js):
 * dén funktion svarer på "kan denne række hård-slettes?" og skal blive ved med at
 * gøre præcis det så længe hård-slet-stien findes bag flaget. Denne svarer på et
 * andet spørgsmål — "er en spiller midt i noget med dette hold?".
 *
 * @param {object} supabase
 * @param {string} teamId
 * @returns {Promise<boolean>}
 */
export async function teamHasLiveTransferOffers(supabase, teamId) {
  const { data: asSeller, error: sellerErr } = await supabase
    .from("transfer_offers")
    .select("id")
    .eq("seller_team_id", teamId)
    .in("status", LIVE_OFFER_STATUSES)
    .limit(1);
  if (sellerErr) throw new Error(`AI-retire (live transfer_offers seller for ${teamId}): ${sellerErr.message}`);
  if ((asSeller || []).length > 0) return true;

  const riderIds = await fetchTeamRiderIds(supabase, teamId);
  if (!riderIds.length) return false;

  for (let i = 0; i < riderIds.length; i += RIDER_CHUNK) {
    const chunk = riderIds.slice(i, i + RIDER_CHUNK);
    const { data: offers, error: offerErr } = await supabase
      .from("transfer_offers")
      .select("id")
      .in("rider_id", chunk)
      .in("status", LIVE_OFFER_STATUSES)
      .limit(1);
    if (offerErr) throw new Error(`AI-retire (live transfer_offers riders for ${teamId}): ${offerErr.message}`);
    if ((offers || []).length > 0) return true;
  }
  return false;
}

// Pagineret: en trunkeret liste ville misse præcis den rytter der betyder noget
// (samme disciplin som #2389/#4233).
async function fetchTeamRiderIds(supabase, teamId) {
  const rows = await fetchAllRows(() => supabase
    .from("riders")
    .select("id, firstname, lastname")
    .eq("team_id", teamId)
    .order("id", { ascending: true }));
  return (rows || []).map((r) => r.id);
}

/** Atomic, service-only retirement; SQL rechecks obligations and the pool budget. */
export async function retireAiTeam(supabase, teamId, { now = new Date() } = {}) {
  const { data, error } = await supabase.rpc('retire_ai_pool_team', {
    p_team_id: teamId, p_now: now.toISOString(),
  });
  if (error) throw new Error('AI-retire (' + teamId + '): ' + error.message);
  if (typeof data?.retired !== 'boolean' || !Number.isInteger(data.ridersRetired)) {
    throw new Error('AI-retire (' + teamId + '): invalid transaction result');
  }
  return data;
}
