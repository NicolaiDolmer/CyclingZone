// #2700 · Sæsonskifte-risiko-varsel (kontraktudløb + pensionsrisiko, #2744/#2748).
// Lovet offentligt i Discord 18/7 — skal ud FØR sæsonskiftet (27/7 09:00 UTC).
//
//   node scripts/notifySeasonTransitionRisk.js          # DRY-RUN (default — ingen writes)
//   node scripts/notifySeasonTransitionRisk.js --live   # APPLY (sender notifikationerne)
//
// KØR ALDRIG --live mod prod uden ejer-godkendelse. Ejeren/orkestratoren kører
// --live selv, EFTER at have inspiceret dry-run-outputtet (antal modtagere +
// eksempelbesked) og bekræftet at det matcher forventningen.
//
// Idempotent: notifyUser dedup'er på (type, title, message, related_id=null)
// inden for 24t (RECENT_DUPLICATE_WINDOW_MS, notificationService.js) — en
// gentagen --live-kørsel samme dag spammer ikke.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { emitSeasonTransitionRiskNotice } from "../lib/seasonTransitionNotice.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function fetchActiveSeasonNumber(supabase) {
  const { data } = await supabase
    .from("seasons")
    .select("number")
    .eq("status", "active")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.number ?? 1;
}

if (process.argv[1] && process.argv[1].endsWith("notifySeasonTransitionRisk.js")) {
  dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
  const dryRun = !process.argv.includes("--live"); // default: dry-run
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("FEJL: Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log(`=== Sæsonskifte-risiko-varsel ${dryRun ? "(DRY-RUN)" : "(LIVE)"} (#2700) ===`);
  fetchActiveSeasonNumber(supabase)
    .then((activeSeasonNumber) => {
      console.log(`Aktiv sæson: ${activeSeasonNumber}`);
      return emitSeasonTransitionRiskNotice({ supabase, activeSeasonNumber, dryRun });
    })
    .then((stats) => {
      console.log("OK:", JSON.stringify({
        dryRun: stats.dryRun,
        teamsAffected: stats.teamsAffected,
        totalExpiring: stats.totalExpiring,
        totalRetirementRisk: stats.totalRetirementRisk,
        delivered: stats.delivered,
        deduped: stats.deduped,
        failed: stats.failed,
      }, null, 2));
      if (stats.sample?.length) {
        console.log("\nEksempel-beskeder (op til 3):");
        for (const s of stats.sample) {
          console.log(`  [${s.teamName}] expiring=${s.expiringCount} retirementRisk=${s.retirementRiskCount}`);
          console.log(`    ${s.title}`);
          console.log(`    ${s.message}`);
        }
      }
      process.exit(0);
    })
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
