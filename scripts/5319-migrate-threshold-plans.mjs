#!/usr/bin/env node
// #5319 · Træningskatalog v3, ejer-valg 2A (29/10): gemte `threshold`-planer for
// enkeltstarts- og klassementsryttere flyttes til `itt_long`; resten bliver.
//
// Hvorfor: i v3 træner Tærskel tempo + udholdenhed og ikke længere enkeltstart.
// En enkeltstarts- eller klassementsrytter der står på Tærskel, ville vågne op
// til at træne noget andet end i går. "Bevar evnerne" (samme regel som 14/8).
//
// Hvad der flyttes (kun rytterens EGNE rækker):
//   · training_plans.focus = 'threshold'           → 'itt_long'
//   · training_week_plans (rider_id sat): ugedagens session og slots 'threshold' → 'itt_long'
// Holdrækker (rider_id IS NULL) og træningsgrupper gælder flere ryttere og bliver.
// Rytteren tæller som enkeltstart/klassement når primær- ELLER sekundærtypen er
// tt eller gc (spec §5: time_trial-rolleklassen ≥ tempo-klassen).
//
// Brug:
//   node scripts/5319-migrate-threshold-plans.mjs            # dry-run (default): kun tal
//   node scripts/5319-migrate-threshold-plans.mjs --apply    # skriver; kræver flaget "on" (ikke beta)
//   --log <fil>   hvor den omvendte map skrives ved --apply (rollback)
// Idempotent: en flyttet række står på itt_long og matcher ikke igen.
// Kræver SUPABASE_URL + SUPABASE_SERVICE_KEY. Apply er et separat ejer-go.

import process from "node:process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const FROM_SESSION = "threshold";
export const TO_SESSION = "itt_long";
export const MIGRATED_TYPES = Object.freeze(["tt", "gc"]);
const WEEKDAYS = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

export function isTimeTrialOrGcRider(rider) {
  return !!rider && (MIGRATED_TYPES.includes(rider.primary_type) || MIGRATED_TYPES.includes(rider.secondary_type));
}

// Ny days-struktur med threshold → itt_long i rytterens celler, eller null hvis
// intet ændres. Intensiteten er "hard" i begge, så den står urørt.
export function migrateWeekDays(days) {
  if (!days || typeof days !== "object" || Array.isArray(days)) return null;
  let changed = 0;
  const next = {};
  for (const [weekday, entry] of Object.entries(days)) {
    if (!entry || typeof entry !== "object" || !WEEKDAYS.includes(weekday)) { next[weekday] = entry; continue; }
    const out = { ...entry };
    if (out.session === FROM_SESSION) { out.session = TO_SESSION; changed++; }
    if (Array.isArray(out.slots)) {
      out.slots = out.slots.map((s) => {
        if (s !== FROM_SESSION) return s;
        changed++;
        return TO_SESSION;
      });
    }
    next[weekday] = out;
  }
  return changed > 0 ? { days: next, changedCells: changed } : null;
}

// Ren planlægning: hvad SKAL flyttes. Ingen DB.
export function planThresholdMigration({ plans = [], weekPlans = [], ridersById = new Map() }) {
  const planUpdates = [];
  const weekUpdates = [];
  const riders = new Set();
  for (const row of plans) {
    if (row?.focus !== FROM_SESSION) continue;
    if (!isTimeTrialOrGcRider(ridersById.get(row.rider_id))) continue;
    planUpdates.push({ id: row.id, rider_id: row.rider_id, from: FROM_SESSION, to: TO_SESSION });
    riders.add(row.rider_id);
  }
  for (const row of weekPlans) {
    if (row?.rider_id == null) continue;
    if (!isTimeTrialOrGcRider(ridersById.get(row.rider_id))) continue;
    const migrated = migrateWeekDays(row.days);
    if (!migrated) continue;
    weekUpdates.push({
      id: row.id, rider_id: row.rider_id, updated_at: row.updated_at ?? null,
      before: row.days, days: migrated.days, changedCells: migrated.changedCells,
    });
    riders.add(row.rider_id);
  }
  return {
    planUpdates,
    weekUpdates,
    summary: {
      plans: planUpdates.length,
      weekPlans: weekUpdates.length,
      weekCells: weekUpdates.reduce((n, u) => n + u.changedCells, 0),
      riders: riders.size,
    },
  };
}

export function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const logIdx = argv.indexOf("--log");
  const log = logIdx >= 0 ? argv[logIdx + 1] ?? null : null;
  return { apply, dryRun: !apply, log };
}

async function fetchAll(query, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) return out;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL + SUPABASE_SERVICE_KEY mangler.");
    process.exit(2);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const plans = await fetchAll(() => db.from("training_plans").select("id, rider_id, focus").eq("focus", FROM_SESSION).order("id"));
  const weekPlans = await fetchAll(() => db.from("training_week_plans").select("id, rider_id, days, updated_at").not("rider_id", "is", null).order("id"));
  const riderIds = [...new Set([...plans, ...weekPlans].map((r) => r.rider_id).filter(Boolean))];
  const ridersById = new Map();
  for (let i = 0; i < riderIds.length; i += 200) {
    const { data, error } = await db.from("riders").select("id, primary_type, secondary_type").in("id", riderIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) ridersById.set(r.id, r);
  }

  const result = planThresholdMigration({ plans, weekPlans, ridersById });
  console.log(`[5319] ${args.dryRun ? "DRY-RUN" : "APPLY"} threshold -> itt_long (tt/gc):`);
  console.log(`  training_plans:      ${result.summary.plans}`);
  console.log(`  training_week_plans: ${result.summary.weekPlans} (${result.summary.weekCells} celler)`);
  console.log(`  ryttere berørt:      ${result.summary.riders}`);
  if (args.dryRun) {
    console.log("  Intet skrevet. Kør med --apply efter ejer-go.");
    return;
  }

  const { data: flagRow, error: flagError } = await db.from("app_config").select("value").eq("key", "training_catalog_v3").maybeSingle();
  if (flagError) throw new Error(flagError.message);
  // Kun "on": i beta træner kun beta-holds motor v3, så itt_long ville ikke
  // træne fokus-evner hos alle andre hold.
  if (!["on", true].includes(flagRow?.value)) {
    console.error("training_catalog_v3 er ikke on for alle: itt_long ville ikke træne noget hos andre hold. Tænd flaget først.");
    process.exit(3);
  }
  const logPath = args.log ?? `5319-threshold-migration-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(logPath, JSON.stringify({ planUpdates: result.planUpdates, weekUpdates: result.weekUpdates.map(({ id, rider_id, before }) => ({ id, rider_id, before })) }, null, 2));
  console.log(`  Omvendt map (rollback) skrevet til ${logPath}`);
  const now = new Date().toISOString();
  for (const u of result.planUpdates) {
    const { error } = await db.from("training_plans").update({ focus: TO_SESSION, updated_at: now }).eq("id", u.id).eq("focus", FROM_SESSION);
    if (error) throw new Error(`training_plans ${u.id}: ${error.message}`);
  }
  // Optimistisk lås: kun rækker der er uændrede siden læsningen skrives. En
  // række spilleren har rettet i mellemtiden springes over (kør scriptet igen).
  let conflicts = 0;
  for (const u of result.weekUpdates) {
    let query = db.from("training_week_plans").update({ days: u.days, updated_at: now }).eq("id", u.id);
    query = u.updated_at == null ? query.is("updated_at", null) : query.eq("updated_at", u.updated_at);
    const { data, error } = await query.select("id");
    if (error) throw new Error(`training_week_plans ${u.id}: ${error.message}`);
    if (!data || data.length !== 1) conflicts++;
  }
  console.log(`  Færdig. Ugeplaner sprunget over pga. samtidig ændring: ${conflicts} (kør scriptet igen).`);
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
