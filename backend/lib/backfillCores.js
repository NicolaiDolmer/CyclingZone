// Importérbare backfill-kerner (#1103) — ekstraheret fra de tre CLI-scripts
// (backfillRacePhysiology.js, backfillRiderTypes.js, backfillRiderBaseValue.js)
// så relaunch-orchestratoren og CLI'erne deler ÉN implementering.
//
// Hver kerne modtager en `supabase`-klient (bygger ikke sin egen), respekterer
// `dryRun` (ingen writes), logger via en injicerbar `log`, og returnerer en summary.
// Beregningslogikken er uændret — kun env/createClient/process.exit-skallen flyttede
// ud i CLI-wrapperne.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "./supabasePagination.js";
import { STAT_KEYS } from "./fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "./physiologySeeding.js";
import { deriveAbilities } from "./abilityDerivation.js";
import { computeRiderTypes, RIDER_TYPE_KEYS, ABILITY_KEYS } from "./riderTypes.js";
import { predictBaseValue } from "./riderValuation.js";
import { calculateRiderMarketValue } from "./marketUtils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPSERT_BATCH = 500;
const WRITE_CONCURRENCY = 25;

const TYPES_BASELINE_PATH = join(__dirname, "./riderTypesBaseline.json");
const VALUATION_MODEL_PATH = join(__dirname, "./riderValuationModel.json");

const noop = () => {};

// ── Logging-hjælpere (flyttet fra CLI-scripterne så diagnostik bevares via `log`) ──
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
const pct = (sortedAsc, p) =>
  sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))];
function spread(values) {
  const s = [...values].sort((a, b) => a - b);
  const avg = (s.reduce((a, b) => a + b, 0) / (s.length || 1)).toFixed(1);
  return `min ${s[0]} · median ${s[Math.floor(s.length / 2)]} · max ${s[s.length - 1]} · avg ${avg}`;
}

async function upsertBatched(supabase, table, rows, onConflict) {
  let n = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`${table} upsert fejlede ved ${i}: ${error.message}`);
    n += batch.length;
  }
  return n;
}

async function updateRidersConcurrent(supabase, updates) {
  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_CONCURRENCY) {
    const batch = updates.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(
      batch.map(({ id, ...patch }) =>
        supabase.from("riders").update(patch).eq("id", id).then(({ error }) => {
          if (error) throw new Error(`update ${id}: ${error.message}`);
        })
      )
    );
    written += batch.length;
  }
  return written;
}

// ── Physiology + udledte abilities (fra backfillRacePhysiology.js) ────────────
export async function runPhysiologyBackfill(supabase, { dryRun = true, physiologyOnly = false, now, log = noop } = {}) {
  const stamp = now || new Date().toISOString();
  const select = ["id", "height", "weight", "birthdate", "potentiale", ...STAT_KEYS].join(", ");
  const riders = await fetchAllRows(() =>
    supabase.from("riders").select(select).order("id", { ascending: true }));
  log(`physiology: ${riders.length} ryttere`);

  const profiles = riders.map((r) => ({ ...seedPhysiologyFromLegacy(r), updated_at: stamp }));
  log(`  ftp_wkg: ${spread(profiles.map((p) => p.ftp_wkg))}`);
  let abilities = [];
  if (!physiologyOnly) {
    abilities = profiles.map((p, i) => ({ ...deriveAbilities(p, riders[i]), generated_at: stamp }));
    log(`  climbing: ${spread(abilities.map((a) => a.climbing))}`);
    log(`  sprint:   ${spread(abilities.map((a) => a.sprint))}`);
  }

  if (dryRun) {
    return { riders: riders.length, profiles: profiles.length, abilities: abilities.length, written: 0 };
  }
  const written = await upsertBatched(supabase, "rider_physiology_profiles", profiles, "rider_id");
  if (!physiologyOnly) await upsertBatched(supabase, "rider_derived_abilities", abilities, "rider_id");
  return { riders: riders.length, profiles: profiles.length, abilities: abilities.length, written };
}

// ── Ryttertyper (fra backfillRiderTypes.js) ───────────────────────────────────
export async function runRiderTypesBackfill(supabase, { dryRun = true, baseline, log = noop } = {}) {
  const model = baseline || JSON.parse(readFileSync(TYPES_BASELINE_PATH, "utf8"));
  // Inner-join til riders for at matche UI-filteret (kun aktive, ikke-retired).
  const rows = await fetchAllRows(() =>
    supabase
      .from("rider_derived_abilities")
      .select(`rider_id, ${ABILITY_KEYS.join(", ")}, riders!inner(is_retired)`)
      .eq("riders.is_retired", false)
      .order("rider_id"));
  log(`types: ${rows.length} ryttere (aktive, med abilities)`);

  const dist = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, 0]));
  const updates = rows.map((r) => {
    const { primary, secondary } = computeRiderTypes(r, model);
    dist[primary.key] = (dist[primary.key] || 0) + 1;
    return { id: r.rider_id, primary_type: primary.key, secondary_type: secondary.key };
  });
  for (const k of RIDER_TYPE_KEYS) {
    const n = dist[k];
    log(`  ${k.padEnd(15)} ${String(n).padStart(5)} (${((n / (rows.length || 1)) * 100).toFixed(1).padStart(5)}%)`);
  }

  if (dryRun) return { riders: rows.length, written: 0 };
  const written = await updateRidersConcurrent(supabase, updates);
  return { riders: rows.length, written };
}

// ── base_value SHADOW (fra backfillRiderBaseValue.js) ─────────────────────────
export async function runBaseValueBackfill(supabase, { dryRun = true, model, log = noop } = {}) {
  const m = model || JSON.parse(readFileSync(VALUATION_MODEL_PATH, "utf8"));
  const [riders, abilities] = await Promise.all([
    fetchAllRows(() => supabase.from("riders").select("id, primary_type, base_value, market_value, prize_earnings_bonus").order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const abilityByRider = new Map(abilities.map((a) => [a.rider_id, a]));

  const updates = [];
  let noAbilities = 0;
  const oldVals = [];
  const newVals = [];
  for (const r of riders) {
    const bv = predictBaseValue(r, abilityByRider.get(r.id), m);
    if (bv == null) { noAbilities++; continue; }
    updates.push({ id: r.id, base_value: bv });
    oldVals.push(calculateRiderMarketValue(r));
    newVals.push(bv);
  }
  oldVals.sort((a, b) => a - b);
  newVals.sort((a, b) => a - b);
  log(`base_value: ${riders.length} ryttere · værdisat ${updates.length} · uden abilities ${noAbilities}`);
  if (updates.length > 0) {
    log("Fordeling (CZ$):           p10        median        p90          max");
    log(`  GAMMEL (uci): ${fmt(pct(oldVals, 0.1)).padStart(12)} ${fmt(pct(oldVals, 0.5)).padStart(12)} ${fmt(pct(oldVals, 0.9)).padStart(12)} ${fmt(oldVals[oldVals.length - 1]).padStart(12)}`);
    log(`  NY  (base):   ${fmt(pct(newVals, 0.1)).padStart(12)} ${fmt(pct(newVals, 0.5)).padStart(12)} ${fmt(pct(newVals, 0.9)).padStart(12)} ${fmt(newVals[newVals.length - 1]).padStart(12)}`);
  }

  if (dryRun) return { riders: riders.length, valued: updates.length, noAbilities, written: 0 };
  const written = await updateRidersConcurrent(supabase, updates);
  return { riders: riders.length, valued: updates.length, noAbilities, written };
}
