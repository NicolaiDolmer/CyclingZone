// #7246 (del 2) · Backfill af manglende kontraktvarsler for en sæson.
//
// Før #7246 stoppede sæsonskift-emitteren ved PostgREST's 1.000-loft, så ~45 %
// af de udløbende ryttere på menneskehold aldrig fik "Contract expiring". Emitteren
// kan IKKE bare køres igen: notifyUser dedup'er kun inden for 24 t, så de allerede
// varslede ville få dubletter. Scriptet sender derfor KUN til (manager, rytter),
// der endnu ikke har en contract_expiring-række for netop denne sæson.
//
// Usage:
//   node backend/scripts/backfill-7246-contract-warnings.js --season=5          # dry-run (default), READ-ONLY
//   node backend/scripts/backfill-7246-contract-warnings.js --season=5 --live   # sender (ejer-go med tal først)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role)
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import {
  CONTRACT_EXPIRING_TYPE,
  buildContractExpiringNotification,
  fetchOwnedExpiringRiders,
  notifyUser,
} from "../lib/notificationService.js";
import { SUPABASE_IN_CHUNK_SIZE, fetchAllRows } from "../lib/supabasePagination.js";

const keyOf = (userId, riderId) => `${userId}|${riderId}`;

/** Ren plan: hvilke (manager, rytter) mangler et varsel for sæsonen. */
export function planContractWarningBackfill({ owned, existingKeys }) {
  const eligible = (owned || []).filter((r) => r.user_id && r.id);
  const missing = eligible.filter((r) => !existingKeys.has(keyOf(r.user_id, r.id)));
  const managers = new Set(missing.map((r) => r.user_id));
  return { eligible: eligible.length, alreadyWarned: eligible.length - missing.length, missing, managers: managers.size };
}

async function loadExistingKeys({ supabase, riderIds, seasonNumber }) {
  const keys = new Set();
  const suffix = `end of season ${seasonNumber}.`;
  for (let i = 0; i < riderIds.length; i += SUPABASE_IN_CHUNK_SIZE) {
    const chunk = riderIds.slice(i, i + SUPABASE_IN_CHUNK_SIZE);
    const rows = await fetchAllRows(() => supabase
      .from("notifications")
      .select("id, user_id, related_id, message")
      .eq("type", CONTRACT_EXPIRING_TYPE)
      .in("related_id", chunk)
      .order("id"));
    for (const n of rows) if (String(n.message || "").endsWith(suffix)) keys.add(keyOf(n.user_id, n.related_id));
  }
  return keys;
}

export async function runContractWarningBackfill({ supabase, seasonNumber, live = false, notify = notifyUser, log = console.log }) {
  const owned = await fetchOwnedExpiringRiders({ supabase, seasonNumber });
  const existingKeys = await loadExistingKeys({ supabase, riderIds: owned.map((r) => r.id), seasonNumber });
  const plan = planContractWarningBackfill({ owned, existingKeys });
  log(`Sæson ${seasonNumber}: ${plan.eligible} udløbende ryttere på menneskehold · ${plan.alreadyWarned} har varsel · ${plan.missing.length} mangler (${plan.managers} managere)`);
  if (!live) {
    log("DRY-RUN: intet sendt. Kør med --live efter ejer-go.");
    return { ...plan, sent: 0, failed: 0 };
  }
  let sent = 0;
  let failed = 0;
  for (const rider of plan.missing) {
    const riderName = `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim();
    try {
      const res = await notify({ supabase, userId: rider.user_id, ...buildContractExpiringNotification({ riderName, riderId: rider.id, seasonNumber }) });
      if (res?.delivered) sent += 1;
    } catch (err) {
      failed += 1;
      log(`  ❌ rytter ${rider.id}: ${err?.message || err}`);
    }
  }
  log(`LIVE: ${sent} sendt, ${failed} fejlede.`);
  return { ...plan, sent, failed };
}

async function main() {
  const args = process.argv.slice(2);
  const season = Number((args.find((a) => a.startsWith("--season=")) || "").split("=")[1]);
  const live = args.includes("--live");
  if (!Number.isInteger(season) || season < 1) throw new Error("Angiv --season=<n>");
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  await runContractWarningBackfill({ supabase, seasonNumber: season, live });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error(err?.message || err); process.exit(1); });
}
