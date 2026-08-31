// Engangs-ops: annuller 1-CZ-udsalget fra de to fair-play-hold (ét hold pr.
// person, forum-tråd b3664834). Spilleren satte 57 ryttere til salg fra 1 CZ$
// ud fra en antagelse om at BEGGE hold blev lukket. Ejeren har besluttet at
// han beholder ét hold, så udsalget skal stoppes før auktionerne lukker
// 2026-09-02 22:30 dansk tid.
//
// Kører den RIGTIGE admin-sti (cancelAuctionByAdmin) i stedet for rå SQL, så
// budgivere og sælger får notifikation, activity_feed og admin_log skrives, og
// riders.pending_team_id ryddes. Idempotent: allerede annullerede auktioner
// rapporteres som "not_cancellable" og springes over.
//
// Brug:
//   infisical run --env=prod -- node scripts/ops/cancel-fairplay-auctions.mjs
//   infisical run --env=prod -- node scripts/ops/cancel-fairplay-auctions.mjs --apply

import { createClient } from "@supabase/supabase-js";
import { cancelAuctionByAdmin } from "../../backend/lib/auctionCancellation.js";
import { notifyTeamOwner as notifyTeamOwnerShared } from "../../backend/lib/notificationService.js";

const APPLY = process.argv.includes("--apply");

const SELLER_TEAM_IDS = [
  "e5a97dd5-c9b2-431d-8a03-7cb2d074468b", // 24/7 Aspire-Light Velo Team (Div 1)
  "ae1257e5-4ed2-45fb-93b8-743cbe9270d8", // Metro-L3 (Div 2)
];
// ndmh32@hotmail.com — ejerens admin-konto (236 admin_log-handlinger siden
// projektstart mod 5 fra den anden admin-konto). OWNER_USER_IDS ligger kun i
// Railway, ikke Infisical, så ownerGate kan ikke bruges som tjek herfra.
const ADMIN_USER_ID = "0e7bb9f1-31be-429e-a9db-2b6a1ac27997";
const CANCELLABLE = ["active", "extended"];

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Samme wrapper-signatur som routes/api.js bruger.
async function notifyTeamOwner(teamId, type, title, message, relatedId = null, metadata = null) {
  await notifyTeamOwnerShared({ supabase, teamId, type, title, message, relatedId, metadata });
}

async function logActivity(type, data = {}) {
  try {
    await supabase.from("activity_feed").insert({
      type,
      team_id: data.team_id || null,
      team_name: data.team_name || null,
      rider_id: data.rider_id || null,
      rider_name: data.rider_name || null,
      amount: data.amount || null,
      meta: data.meta || {},
    });
  } catch { /* silent — samme kontrakt som api.js */ }
}

function fail(msg) {
  console.error(`FEJL: ${msg}`);
  process.exit(1);
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    fail("SUPABASE_URL/SUPABASE_SERVICE_KEY mangler — kør via `infisical run --env=prod --`.");
  }

  const { data: rows, error } = await supabase
    .from("auctions")
    .select("id, status, starting_price, current_price, seller_team_id, rider:rider_id(firstname, lastname)")
    .in("seller_team_id", SELLER_TEAM_IDS)
    .in("status", CANCELLABLE);

  if (error) fail(`kunne ikke hente auktioner: ${error.message}`);

  const overOnePrice = rows.filter(r => r.starting_price !== 1);
  if (overOnePrice.length > 0) {
    fail(`${overOnePrice.length} auktion(er) har startpris != 1 — sættet er ikke det forventede udsalg. Stopper.`);
  }

  console.log(`Fundet ${rows.length} annullerbare auktioner (forventet 57).`);
  for (const teamId of SELLER_TEAM_IDS) {
    console.log(`  ${teamId}: ${rows.filter(r => r.seller_team_id === teamId).length}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — intet ændret. Kør med --apply for at annullere.");
    for (const r of rows) {
      console.log(`  ${r.id}  ${r.rider?.firstname} ${r.rider?.lastname}  (pris ${r.current_price})`);
    }
    return;
  }

  const results = { cancelled: [], skipped: [], failed: [] };
  let notifiedBidders = 0;

  for (const r of rows) {
    let res;
    try {
      res = await cancelAuctionByAdmin({
        supabase,
        auctionId: r.id,
        adminUserId: ADMIN_USER_ID,
        notifyTeamOwner,
        logActivity,
        now: new Date(),
      });
    } catch (err) {
      results.failed.push({ id: r.id, error: err.message });
      console.error(`  FEJL ${r.id}: ${err.message}`);
      continue;
    }

    if (res.ok) {
      results.cancelled.push(res.auction_id);
      notifiedBidders += res.bidder_count || 0;
      console.log(`  OK   ${r.id}  ${res.rider_name}  (${res.bidder_count} budgivere notificeret)`);
    } else {
      results.skipped.push({ id: r.id, code: res.code });
      console.log(`  SKIP ${r.id}  (${res.code})`);
    }
  }

  console.log("\n--- Resultat ---");
  console.log(`Annulleret: ${results.cancelled.length}`);
  console.log(`Sprunget over: ${results.skipped.length}`);
  console.log(`Fejlet: ${results.failed.length}`);
  console.log(`Budgiver-notifikationer i alt: ${notifiedBidders}`);

  if (results.failed.length > 0) process.exit(1);
}

main().catch(err => fail(err.stack || err.message));
