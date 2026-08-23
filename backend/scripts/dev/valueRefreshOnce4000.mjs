// #4000/#3449 · Engangs-kørsel af søndags-værdi-refreshen (cutover 23/8, "Vej B").
//
// Hvorfor: løn-genberegningen (salaryRecompute3645.mjs) læser LAGRET
// current_production_value. Lagret CPV dæmpes først når progressionen kører
// INDE i sæson-transitionen, EFTER season_payroll har trukket S3-lønnen. Ejer-
// beslutning 23/8 aften: rytter-tallene genberegnes én gang FØR lønnen, så
// S3-kontrakterne fryses på dæmpet CPV. Dette script kører PRÆCIS den kode der
// kører hver søndag kl. 22 (refreshChangedRiderValues, riderValueRefresh.js) —
// ingen egen formel. Skriver base_value (model m. c + dæmpning), CPV (dæmpet)
// og type for de ryttere hvor noget afviger.
//
// Kør fra backend/ (dry-run er default, 100 % read-only):
//   infisical run --env=prod --silent -- node scripts/dev/valueRefreshOnce4000.mjs
//   CONFIRM_VALUE_REFRESH=yes infisical run --env=prod --silent -- node scripts/dev/valueRefreshOnce4000.mjs --apply
//
// Dry-run rapporterer: scannet/ændret, Σ base_value + Σ CPV før/efter, medianer
// pr. valuation_type (CPV før/efter + forventet løn = CPV × 0,35), 10 største
// CPV-fald. Apply kræver BÅDE flag OG env-var (samme to-bekræftelses-mønster som
// cutover3645-værktøjet) og kører post-verify: en ny dry-run skal give 0 ændrede.

import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { fetchAllRows } from "../../lib/supabasePagination.js";
import { ABILITY_KEYS } from "../../lib/riderTypes.js";
import { ageForSeason } from "../../lib/riderSeasonAge.js";
import { applyTypeDampening, TYPE_DAMPENING_ENABLED } from "../../lib/riderValuationTypeDampening.js";
import { levelCorrectionFactor } from "../../lib/riderCareerNpv.js";
import { selectChangedValueUpdates, refreshChangedRiderValues } from "../../lib/riderValueRefresh.js";
import { SALARY_RATE_PRODUCTION } from "../../lib/economyConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = join(__dirname, "../../lib");
const APPLY = process.argv.includes("--apply");
const CONFIRMED = process.env.CONFIRM_VALUE_REFRESH === "yes";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const projectRef = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\./) || [])[1] || "ukendt";

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("da-DK");
const median = (arr) => {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

async function loadAndPlan() {
  const baseline = JSON.parse(readFileSync(join(LIB, "riderTypesBaseline.json"), "utf8"));
  const youthBaseline = JSON.parse(readFileSync(join(LIB, "riderTypesBaselineYouth.json"), "utf8"));
  const model = applyTypeDampening(JSON.parse(readFileSync(join(LIB, "riderValuationModelV4.json"), "utf8")));

  const argSeason = (process.argv.find((a) => a.startsWith("--season-number=")) || "").split("=")[1];
  let seasonNumber = Number(argSeason) || null;
  if (!seasonNumber) {
    const { data: season, error: seasonErr } = await sb.from("seasons").select("number").eq("status", "active").maybeSingle();
    if (seasonErr) throw new Error(`season lookup: ${seasonErr.message}`);
    seasonNumber = season?.number ?? null;
  }
  if (!seasonNumber) {
    const { data: lastDone } = await sb.from("seasons").select("number").eq("status", "completed").order("number", { ascending: false }).limit(1).maybeSingle();
    seasonNumber = lastDone?.number ?? 1;
  }

  const riders = await fetchAllRows(() => sb.from("riders")
    .select("id, firstname, lastname, team_id, is_retired, primary_type, secondary_type, valuation_type, base_value, current_production_value, birthdate, potentiale, archetype_draw")
    .order("id"));
  for (const r of riders) r.age = ageForSeason(r.birthdate, seasonNumber);
  const ids = new Set(riders.map((r) => r.id));
  const abilities = await fetchAllRows(() => sb.from("rider_derived_abilities")
    .select(`rider_id, ability_caps, ${ABILITY_KEYS.join(", ")}`).order("rider_id"));
  const abilityByRider = new Map(abilities.filter((a) => ids.has(a.rider_id)).map((a) => [a.rider_id, a]));
  const capsByRider = new Map(abilities.filter((a) => ids.has(a.rider_id)).map((a) => [a.rider_id, a.ability_caps]));

  const updates = selectChangedValueUpdates(riders, abilityByRider, baseline, model, capsByRider, youthBaseline);
  return { riders, updates, seasonNumber, model };
}

function report({ riders, updates, seasonNumber, model }) {
  const byId = new Map(riders.map((r) => [r.id, r]));
  console.log(`Aktiv sæson (alder-anker): ${seasonNumber}`);
  console.log(`Model: TYPE_DAMPENING_ENABLED=${TYPE_DAMPENING_ENABLED} · level_correction=${levelCorrectionFactor(model)}`);
  console.log(`Scannet: ${fmt(riders.length)} · ændres: ${fmt(updates.length)}`);

  let bvBefore = 0, bvAfter = 0, cpvBefore = 0, cpvAfter = 0, typeChanges = 0;
  const byType = new Map();
  const drops = [];
  for (const u of updates) {
    const r = byId.get(u.id);
    bvBefore += Number(r.base_value) || 0;
    bvAfter += Number(u.base_value) || 0;
    cpvBefore += Number(r.current_production_value) || 0;
    cpvAfter += Number(u.current_production_value) || 0;
    if (u.primary_type !== r.primary_type || u.secondary_type !== r.secondary_type) typeChanges++;
    const vt = r.valuation_type ?? r.primary_type ?? "?";
    if (!byType.has(vt)) byType.set(vt, { n: 0, cpvB: [], cpvA: [], bvB: [], bvA: [] });
    const t = byType.get(vt);
    t.n++;
    t.cpvB.push(Number(r.current_production_value)); t.cpvA.push(Number(u.current_production_value));
    t.bvB.push(Number(r.base_value)); t.bvA.push(Number(u.base_value));
    if (r.team_id && !r.is_retired) {
      drops.push({ name: `${r.firstname} ${r.lastname}`.trim(), vt, cpvB: Number(r.current_production_value), cpvA: Number(u.current_production_value), bvB: Number(r.base_value), bvA: Number(u.base_value) });
    }
  }
  console.log(`Σ base_value (ændrede): ${fmt(bvBefore)} → ${fmt(bvAfter)} (${((bvAfter / bvBefore - 1) * 100).toFixed(1)} %)`);
  console.log(`Σ CPV (ændrede):        ${fmt(cpvBefore)} → ${fmt(cpvAfter)} (${((cpvAfter / cpvBefore - 1) * 100).toFixed(1)} %)`);
  console.log(`Type-ændringer (primary/secondary): ${fmt(typeChanges)}`);
  console.log("\nPr. valuation_type (medianer, kun ændrede ryttere; løn = CPV × " + SALARY_RATE_PRODUCTION + "):");
  console.log("  type            n     CPV før → efter        løn før → efter      base_value før → efter");
  for (const [vt, t] of [...byType.entries()].sort((a, b) => median(b[1].cpvA) - median(a[1].cpvA))) {
    const cb = median(t.cpvB), ca = median(t.cpvA);
    console.log(`  ${vt.padEnd(14)} ${String(t.n).padStart(5)}  ${fmt(cb).padStart(8)} → ${fmt(ca).padStart(8)}   ${fmt(cb * SALARY_RATE_PRODUCTION).padStart(7)} → ${fmt(ca * SALARY_RATE_PRODUCTION).padStart(7)}   ${fmt(median(t.bvB)).padStart(10)} → ${fmt(median(t.bvA)).padStart(10)}`);
  }
  drops.sort((a, b) => (b.cpvB - b.cpvA) - (a.cpvB - a.cpvA));
  console.log("\n10 største CPV-fald (ryttere på hold):");
  for (const d of drops.slice(0, 10)) {
    console.log(`  ${d.name.padEnd(26)} ${d.vt.padEnd(14)} CPV ${fmt(d.cpvB)} → ${fmt(d.cpvA)} · værdi ${fmt(d.bvB)} → ${fmt(d.bvA)}`);
  }
}

async function main() {
  console.log("=== Engangs-værdi-refresh (#4000/#3449, cutover 23/8 Vej B) ===");
  console.log(`Database: ${projectRef}`);
  console.log(`MODE: ${APPLY ? "APPLY" : "dry-run (skriver INTET)"}`);
  if (APPLY && !CONFIRMED) {
    console.error("❌ --apply kræver CONFIRM_VALUE_REFRESH=yes i miljøet");
    process.exit(1);
  }
  if (APPLY && !TYPE_DAMPENING_ENABLED) {
    console.error("❌ TYPE_DAMPENING_ENABLED er false i denne checkout — apply ville skrive u-dæmpede tal. Stop.");
    process.exit(1);
  }

  const plan = await loadAndPlan();
  report(plan);

  if (!APPLY) {
    console.log("\nDRY-RUN slut — intet skrevet.");
    return;
  }

  console.log("\n→ Skriver via refreshChangedRiderValues (samme kode som søndags-sweepen)…");
  const t0 = Date.now();
  const res = await refreshChangedRiderValues(sb, { log: (m) => console.log(`  ${m}`), seasonNumber: plan.seasonNumber });
  console.log(`  skrevet: ${fmt(res.written)} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  console.log("→ Post-verify: ny plan skal være tom…");
  const after = await loadAndPlan();
  if (after.updates.length === 0) {
    console.log(`  ✅ 0 ændrede ved genkørsel (${fmt(after.riders.length)} scannet)`);
  } else {
    console.error(`  ❌ ${after.updates.length} ryttere afviger stadig — undersøg før næste skridt`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
