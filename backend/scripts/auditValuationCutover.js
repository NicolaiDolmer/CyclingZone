#!/usr/bin/env node
// Cutover-audit for #1101 slice 2: beviser at økonomien konsistent kører på
// base_value. Fejler (exit 1) ved: (a) aktive ryttere med base_value NULL/0,
// (b) market_value/salary der ikke matcher de nye GENERATED-formler,
// (c) runtime-formlen (calculateRiderMarketValue) der divergerer fra DB.
// Read-only. Kør efter migration + efter enhver re-backfill.
//
//   node scripts/auditValuationCutover.js

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { calculateRiderMarketValue, RIDER_BASE_VALUE_FALLBACK } from "../lib/marketUtils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

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

const active = riders.filter((r) => !r.is_retired);
const failures = [];

const badBase = active.filter((r) => !(Number(r.base_value) > 0));
if (badBase.length > 0) {
  failures.push(`${badBase.length} aktive ryttere med base_value NULL/0 (fx ${badBase.slice(0, 3).map((r) => `${r.firstname} ${r.lastname}`).join(", ")})`);
}

let mvMismatch = 0, salMismatch = 0, runtimeMismatch = 0;
for (const r of riders) {
  const base = Number(r.base_value) > 0 ? Number(r.base_value) : RIDER_BASE_VALUE_FALLBACK;
  const expectMv = base + (Number(r.prize_earnings_bonus) || 0);
  const expectSal = Math.max(1, Math.round(expectMv * 0.10));
  if (r.market_value !== expectMv) mvMismatch++;
  if (r.salary !== expectSal) salMismatch++;
  if (calculateRiderMarketValue(r) !== r.market_value) runtimeMismatch++;
}
if (mvMismatch) failures.push(`${mvMismatch} ryttere hvor market_value ≠ COALESCE(base_value,${RIDER_BASE_VALUE_FALLBACK}) + bonus (kører den gamle uci-formel stadig?)`);
if (salMismatch) failures.push(`${salMismatch} ryttere hvor salary ≠ max(1, round(10% af market_value))`);
if (runtimeMismatch) failures.push(`${runtimeMismatch} ryttere hvor runtime-formlen divergerer fra DB`);

const vals = active.map((r) => r.market_value).sort((a, b) => a - b);
const pct = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
console.log(`Cutover-audit: ${riders.length} ryttere (${active.length} aktive)`);
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
