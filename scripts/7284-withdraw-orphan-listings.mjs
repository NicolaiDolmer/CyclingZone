#!/usr/bin/env node
// #7284 datareparation: luk transfer_listings der stadig er aabne for ryttere
// der ikke laengere staar paa saelgerens hold.
//
// Baggrund: akademi-fyring og to release-grene i academyGraduation.js lukkede aldrig
// rytterens aabne transfer_listing. Kodefixet lukker nye tilfaelde; dette script
// rydder de eksisterende raekker.
//
// Et "forladt" listing er: status open/negotiating, og rytteren er IKKE paa
// listingens saelger-hold (riders.team_id er null eller et andet hold end
// seller_team_id). Raekken saettes til 'withdrawn' (samme som contractExpiryRelease).
//
// Brug:
//   infisical run --env=prod -- node scripts/7284-withdraw-orphan-listings.mjs            (dry-run, default)
//   infisical run --env=prod -- node scripts/7284-withdraw-orphan-listings.mjs --apply    (kraever ejer-go)
//
// Dry-run er DEFAULT og skriver intet. --apply er ejer-gated: ejeren ser dry-run-listen
// foerst. Idempotent: update rammer kun raekker der stadig er open/negotiating.

import { pathToFileURL } from "node:url";

const OPEN_STATUSES = ["open", "negotiating"];

/**
 * PURE: hvilke aabne listings er forladt? Rytteren staar ikke paa saelgerholdet.
 * @param {Array<{id:string,rider_id:string,seller_team_id:string|null,status:string}>} listings
 * @param {Map<string,{team_id:string|null}>|Record<string,{team_id:string|null}>} ridersById
 */
const WRITE_CHUNK_SIZE = 100;

export function findOrphanListings(listings, ridersById) {
  const get = (id) => (ridersById instanceof Map ? ridersById.get(id) : ridersById?.[id]);
  return (listings ?? []).filter((l) => {
    if (!OPEN_STATUSES.includes(l.status)) return false;
    const rider = get(l.rider_id);
    if (!rider) return false; // ukendt rytter: roer ikke
    return (rider.team_id ?? null) !== (l.seller_team_id ?? null);
  });
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
  const listings = await fetchAll(
    supabase, "transfer_listings", "id, rider_id, seller_team_id, status",
    (q) => q.in("status", OPEN_STATUSES),
  );
  const riderIds = [...new Set(listings.map((l) => l.rider_id))];
  const ridersById = new Map();
  for (let i = 0; i < riderIds.length; i += 200) {
    const { data, error } = await supabase.from("riders").select("id, team_id").in("id", riderIds.slice(i, i + 200));
    if (error) throw new Error(`riders: ${error.message}`);
    for (const r of data ?? []) ridersById.set(r.id, r);
  }
  const orphans = findOrphanListings(listings, ridersById);
  log(`open/negotiating listings: ${listings.length}, orphaned: ${orphans.length}`);
  for (const o of orphans) log(`  listing ${o.id} rider ${o.rider_id} status ${o.status}`);

  if (!apply) {
    log("dry-run: nothing written. Re-run with --apply after owner go.");
    return { orphans, applied: 0 };
  }
  if (orphans.length === 0) return { orphans, applied: 0 };
  // Skriv i bundter som laesningerne: en lang .in()-liste fejler i gatewayen (supabasePagination.js).
  const ids = orphans.map((o) => o.id);
  let applied = 0;
  for (let i = 0; i < ids.length; i += WRITE_CHUNK_SIZE) {
    const { data, error } = await supabase
      .from("transfer_listings")
      .update({ status: "withdrawn" })
      .in("id", ids.slice(i, i + WRITE_CHUNK_SIZE))
      .in("status", OPEN_STATUSES)
      .select("id");
    if (error) throw new Error(`update (efter ${applied} withdrawn): ${error.message}`);
    applied += (data ?? []).length;
  }
  log(`withdrawn: ${applied}`);
  return { orphans, applied };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required (run via infisical).");
    process.exit(2);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  await run({ supabase, apply: process.argv.includes("--apply") });
}
