#!/usr/bin/env node
// ENGANGS: annullér Hui Feng-auktionen før S1→S2-transitionen (drejebog 5b —
// rytteren er 40 ved S2 = garanteret pension; køb ville være spildte penge).
// Spejler admin-rutens kald af cancelAuctionByAdmin (routes/api.js:7259) 1:1.
//   railway run --service CyclingZone -- node scripts/cancelAuction-feng-2026-07-26.mjs --execute

import { createClient } from "@supabase/supabase-js";
import { cancelAuctionByAdmin } from "../lib/auctionCancellation.js";
import { notifyTeamOwner as notifyTeamOwnerShared } from "../lib/notificationService.js";

const AUCTION_ID = "fcbcff88-a7c8-4c9f-9e01-596782d98bd7"; // Hui Feng, ender 19:47 UTC
const ADMIN_USER_ID = "0e7bb9f1-31be-429e-a9db-2b6a1ac27997"; // ejer (admin)
const EXECUTE = process.argv.includes("--execute");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

if (!EXECUTE) {
  const { data } = await supabase.from("auctions").select("id, status, rider_id, calculated_end").eq("id", AUCTION_ID).single();
  console.log("DRY-RUN — auktion:", JSON.stringify(data));
  process.exit(0);
}

const result = await cancelAuctionByAdmin({
  supabase,
  auctionId: AUCTION_ID,
  adminUserId: ADMIN_USER_ID,
  notifyTeamOwner: async (teamId, type, title, message, relatedId = null, metadata = null) => {
    await notifyTeamOwnerShared({ supabase, teamId, type, title, message, relatedId, metadata });
  },
  logActivity: async (type, data = {}) => {
    try {
      await supabase.from("activity_feed").insert({
        type,
        team_id: data.team_id || null, team_name: data.team_name || null,
        rider_id: data.rider_id || null, rider_name: data.rider_name || null,
        amount: data.amount || null, meta: data.meta || {},
      });
    } catch { /* silent — spejler api.js logActivity */ }
  },
});
console.log("✅ Annulleret:", JSON.stringify(result));
