#!/usr/bin/env node
// #4075: read-only materialize-dry-run mod prod med FULD apply-paritet (profil-
// generering + #3327/#3347-dæknings-eval) — det plan-baserede regen-dry-run dækker
// ikke coverage-gaten (lærdom 21/8: apply blev afvist på tier 2-cobbles efter et
// grønt plan-dry-run). Kør denne FØR regen-apply.
//   cd backend && infisical run --env=prod -- node scripts/dev/dryRunMaterializeCoverage4075.mjs
import { createClient } from "@supabase/supabase-js";
import { materializeTierCalendars } from "../../lib/tierCalendarMaterializer.js";
import { prodCalendarFrom } from "./lib/devCalendarArgs.mjs";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { data: seasons } = await supabase.from("seasons").select("id, number, status, start_date").eq("number", 3);
const season = seasons?.[0];
if (!season || season.status !== "upcoming") { console.error("STOP: sæson 3 ikke 'upcoming'"); process.exit(1); }
// #4239: --first-day kan overstyres; `now` fryses IKKE, fordi scriptet dry-runner mod
// en live saeson og anti-blitz-guarden skal vaere i kraft (27/6-blitzen).
const { from } = prodCalendarFrom();
const summary = await materializeTierCalendars({ supabase, seasonId: season.id, seasonStartDate: season.start_date, from, dryRun: true });
let bad = 0;
for (const t of summary.tiers) {
  const v = t.calendarViolations ?? [];
  const cov = t.coverageStats?.familyStages ?? t.coverageStats ?? null;
  console.log(`tier ${t.tier}: quotaHit=${t.quotaHit} shortfall=${t.shortfall} tomme=${t.emptyDays} violations=${v.length}`);
  if (v.length) { bad += v.length; for (const x of v) console.log("  VIOLATION:", x); }
  if (cov) console.log("  coverage:", JSON.stringify(cov));
}
console.log(bad === 0 ? "\nALLE TIERS RENE — klar til apply." : `\n${bad} violations — apply vil blive afvist.`);
process.exit(bad === 0 ? 0 : 1);
