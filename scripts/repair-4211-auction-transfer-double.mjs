#!/usr/bin/env node
// #4211 datareparation: ryttere der staar baade paa aktiv auktion og paa
// transferlisten (invariant no_double_market_listing).
//
// Kodefixet (backend/lib/auctionTransferListPause.js) saetter fremover
// transferlisten paa pause ved auktionsstart og afgoer den ved auktionsslut.
// Dette script rydder de raekker der opstod foer fixet:
//
//   1. Dobbeltlistning: rytteren har en aktiv auktion (active/extended) OG en
//      open/negotiating transfer_listing. Listingen saettes til 'paused', saa den
//      kommer tilbage, hvis auktionen ender uden salg (samme mekanik som nye
//      auktioner).
//   2. Forladt pause: en 'paused' listing hvis rytter IKKE har en aktiv auktion
//      (fx en finalisering der fejlede i genoptag-trinnet). Den afgoeres med
//      samme regel som ved auktionsslut: 'open' igen hos saelgeren, ellers
//      'withdrawn'.
//
// Brug:
//   infisical run --env=prod -- node scripts/repair-4211-auction-transfer-double.mjs            (dry-run, default)
//   infisical run --env=prod -- node scripts/repair-4211-auction-transfer-double.mjs --apply    (kraever ejer-go)
//
// Dry-run er DEFAULT og skriver intet. --apply er ejer-gated: ejeren ser dry-run-
// listen foerst. --apply kraever at migrationen
// database/2026-11-03-4211-auction-transfer-list-pause.sql er applied ('paused'
// er ellers ikke en lovlig status, og opdateringen fejler hoejlydt paa CHECK).
// Idempotent: opdateringerne rammer kun raekker der stadig har den forventede status.

import { pathToFileURL } from "node:url";

import {
  PAUSABLE_LISTING_STATUSES,
  PAUSED_LISTING_STATUS,
  pauseTransferListingsForAuction,
  resumePausedTransferListings,
} from "../backend/lib/auctionTransferListPause.js";

const ACTIVE_AUCTION_STATUSES = ["active", "extended"];

/**
 * PURE: find dobbeltlistninger og forladte pauser.
 * @param {{ activeAuctions: Array<{rider_id:string}>, listings: Array<{id:string,rider_id:string,status:string}> }} args
 * @returns {{ doubleListed: Array<{id:string,rider_id:string,status:string}>, orphanPaused: Array<{id:string,rider_id:string,status:string}> }}
 */
export function classifyListings({ activeAuctions, listings }) {
  const onAuction = new Set((activeAuctions ?? []).map((a) => a.rider_id));
  const doubleListed = [];
  const orphanPaused = [];
  for (const l of listings ?? []) {
    if (PAUSABLE_LISTING_STATUSES.includes(l.status) && onAuction.has(l.rider_id)) doubleListed.push(l);
    else if (l.status === PAUSED_LISTING_STATUS && !onAuction.has(l.rider_id)) orphanPaused.push(l);
  }
  return { doubleListed, orphanPaused };
}

async function fetchAll(supabase, table, select, apply) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(select).range(from, from + 999);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export async function run({ supabase, apply = false, log = console.log } = {}) {
  const activeAuctions = await fetchAll(
    supabase, "auctions", "rider_id",
    (q) => q.in("status", ACTIVE_AUCTION_STATUSES),
  );
  const listings = await fetchAll(
    supabase, "transfer_listings", "id, rider_id, seller_team_id, status",
    (q) => q.in("status", [...PAUSABLE_LISTING_STATUSES, PAUSED_LISTING_STATUS]),
  );
  const { doubleListed, orphanPaused } = classifyListings({ activeAuctions, listings });
  const doubleTeams = new Set(doubleListed.map((l) => l.seller_team_id));
  log(`active auctions: ${activeAuctions.length}, open/negotiating/paused listings: ${listings.length}`);
  log(`double-listed (auction + transfer list): ${doubleListed.length} listing(s), ${doubleTeams.size} team(s)`);
  for (const l of doubleListed) log(`  pause   listing ${l.id} rider ${l.rider_id} status ${l.status}`);
  log(`orphaned paused (no active auction): ${orphanPaused.length}`);
  for (const l of orphanPaused) log(`  resolve listing ${l.id} rider ${l.rider_id}`);

  if (!apply) {
    log("dry-run: nothing written. Re-run with --apply after owner go (migration must be applied first).");
    return { doubleListed, orphanPaused, paused: 0, resumed: 0, withdrawn: 0 };
  }

  let paused = 0;
  for (const riderId of new Set(doubleListed.map((l) => l.rider_id))) {
    paused += (await pauseTransferListingsForAuction(supabase, { riderId })).paused;
  }
  const resolved = await resumePausedTransferListings(supabase, {
    riderIds: orphanPaused.map((l) => l.rider_id),
  });
  log(`paused: ${paused}, resumed: ${resolved.resumed.length}, withdrawn: ${resolved.withdrawn.length}`);
  return {
    doubleListed,
    orphanPaused,
    paused,
    resumed: resolved.resumed.length,
    withdrawn: resolved.withdrawn.length,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required (run via infisical).");
    process.exit(2);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  await run({ supabase, apply: process.argv.includes("--apply") });
}
