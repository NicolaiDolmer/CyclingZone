// Read-only backfill plan. No apply path, mutations or model selection.
// Run from backend: infisical run --env=prod --silent -- node scripts/dev/bestRoleBackfill5443.mjs
// --compare-stored requires the schema migration; default works before migration.
// --out=relative-file.json stores private rider IDs under balance-internals only.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bestRoleForAbilities } from "../../lib/riderValueRefresh.js";
import { DISPLAY_RECIPE_ABILITIES } from "../../lib/weights/displayRecipes.js";
import { fetchAllRows } from "../../lib/supabasePagination.js";

export async function planBestRoleBackfill(supabase, { compareStored = false } = {}) {
  // schema-columns-ok: optional fields require 2026-09-22-5443-best-role-data.sql.
  const columns = compareStored ? "id, best_role, best_role_rating" : "id";
  const riders = await fetchAllRows(() => supabase.from("riders").select(columns).order("id"));
  const rows = await fetchAllRows(() => supabase.from("rider_derived_abilities")
    .select(`rider_id, ${DISPLAY_RECIPE_ABILITIES.join(", ")}`).order("rider_id"));
  const byId = new Map(rows.map((row) => [row.rider_id, row]));
  const updates = [];
  let missing = 0;
  for (const rider of riders) {
    const next = bestRoleForAbilities(byId.get(rider.id));
    if (next.best_role === null) missing += 1;
    if (compareStored && next.best_role === (rider.best_role ?? null)
      && next.best_role_rating === (rider.best_role_rating ?? null)) continue;
    if (!compareStored && next.best_role === null) continue;
    updates.push({ id: rider.id, ...next });
  }
  return { dryRun: true, written: 0, scanned: riders.length, missing, planned: updates.length, compareStored, updates };
}

export function parseArgs(args) {
  const options = { compareStored: false, out: null };
  for (const arg of args) {
    if (arg === "--compare-stored") options.compareStored = true;
    else if (arg.startsWith("--out=") && arg.length > 6) options.out = arg.slice(6);
    else throw new Error(`Unsupported argument: ${arg}. This script is read-only.`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const privateRoot = fileURLToPath(new URL("../../../balance-internals/", import.meta.url));
  const output = options.out ? resolve(privateRoot, options.out) : null;
  if (output) {
    const rel = relative(privateRoot, output);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Output must be inside balance-internals");
  }
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY missing");
  const result = await planBestRoleBackfill(createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY), options);
  if (output) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  }
  const { updates: _updates, ...summary } = result;
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
