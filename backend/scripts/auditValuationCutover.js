#!/usr/bin/env node
// Cutover-audit for #1101 slice 2: beviser at økonomien konsistent kører på
// base_value. Fejler (exit 1) ved: (a) aktive ryttere med base_value NULL/0,
// (b) market_value/salary der ikke matcher de nye GENERATED-formler,
// (c) runtime-fallback-formlen (calculateRiderMarketValue) der divergerer fra DB
//     (market_value strippes før kaldet så fallback-grenen faktisk udøves, #1198),
// (d) market_value ≤ 0 for aktive ryttere, (e) 0 aktive ryttere (vakuøs audit),
// (f) med --expect-fictional: aktive ryttere med pcm_id (post-relaunch-krav #1105).
// Read-only. Kør efter migration + efter enhver re-backfill.
// Audit-kernen er ren og mutation-testet: lib/valuationCutoverAudit.js (#1198).
//
//   node scripts/auditValuationCutover.js [--expect-fictional]

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { auditValuationRows } from "../lib/valuationCutoverAudit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const EXPECT_FICTIONAL = process.argv.includes("--expect-fictional");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const fmt = (n) => Math.round(n).toLocaleString("da-DK");

const riders = await fetchAllRows(() => supabase
  .from("riders")
  .select("id, firstname, lastname, base_value, prize_earnings_bonus, market_value, salary, is_retired, pcm_id")
  .order("id"));

const { failures, active } = auditValuationRows(riders, { expectFictional: EXPECT_FICTIONAL });

const vals = active.map((r) => r.market_value).sort((a, b) => a - b);
const pct = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
console.log(`Cutover-audit: ${riders.length} ryttere (${active.length} aktive)${EXPECT_FICTIONAL ? " · --expect-fictional" : ""}`);
if (vals.length > 0) {
  console.log(`market_value: p10 ${fmt(pct(0.1))} · median ${fmt(pct(0.5))} · p90 ${fmt(pct(0.9))} · max ${fmt(vals[vals.length - 1])}`);
  console.log("Top 8 (aktive):");
  for (const r of [...active].sort((a, b) => b.market_value - a.market_value).slice(0, 8)) {
    console.log(`  ${`${r.firstname} ${r.lastname}`.padEnd(24)} ${r.pcm_id == null ? "fiktiv  " : "virkelig"} ${fmt(r.market_value).padStart(15)}`);
  }
}

if (failures.length > 0) {
  console.error("\n❌ CUTOVER-AUDIT FEJLEDE:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✅ Cutover-audit grøn: økonomien kører konsistent på base_value.");
