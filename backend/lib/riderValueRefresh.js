// #1364 — base_value følger udviklede evner (Model 1, objektiv rating).
// recomputeRiderValue: ren kæde (typer → base_value), samme som relaunch-backfill
// + fictionalPopulationPreview. refreshChangedRiderValues: genberegn alle, skriv
// kun de ændrede (ingen daglig churn). base_value afrundes (INTEGER-kolonne).
//
// #2594 CUTOVER: modellen er nu v4 (karriere-NPV, riderValuationModelV4.json).
// v4 kræver alder + potentiale (fremskriver karrieren), så sweepen henter
// birthdate/potentiale og en aktiv sæson. Sweepen skriver desuden
// current_production_value (sæson-0-leddet) — løn-basen (#2428 løn-decoupling).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "./supabasePagination.js";
import { computeRiderTypes, ABILITY_KEYS } from "./riderTypes.js";
import { predictBaseValue } from "./riderValuation.js";
import { currentProductionValue } from "./riderCareerNpv.js";
import { ageForSeason } from "./riderProgressionEngine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TYPES_BASELINE_PATH = join(__dirname, "./riderTypesBaseline.json");
const VALUATION_MODEL_PATH = join(__dirname, "./riderValuationModelV4.json");
const noop = () => {};
const WRITE_CONCURRENCY = 25;

// riderRow skal bære age + potentiale (v4-krav); mangler age → begge værdier null
// (rytteren springes over i sweepen — samme kontrakt som manglende abilities).
export function recomputeRiderValue(riderRow, abilities, baseline, model) {
  const { primary, secondary } = computeRiderTypes(abilities, baseline);
  const withType = { ...riderRow, primary_type: primary.key, secondary_type: secondary.key };
  const raw = predictBaseValue(withType, abilities, model);
  const cpv = currentProductionValue(withType, abilities, model);
  return {
    primary_type: primary.key,
    secondary_type: secondary.key,
    base_value: raw == null ? null : Math.round(raw),
    current_production_value: cpv == null ? null : Math.round(cpv),
  };
}

// Ren diff: returnér KUN ryttere hvor base_value, current_production_value eller
// type ændrede sig.
export function selectChangedValueUpdates(riders, abilityByRider, baseline, model) {
  const updates = [];
  for (const r of riders) {
    const ab = abilityByRider.get(r.id);
    if (!ab) continue; // ingen abilities → spring over (kan ikke værdisættes)
    const next = recomputeRiderValue(r, ab, baseline, model);
    if (next.base_value == null) continue;
    const changed =
      next.base_value !== r.base_value ||
      next.current_production_value !== (r.current_production_value ?? null) ||
      next.primary_type !== r.primary_type ||
      next.secondary_type !== r.secondary_type;
    if (changed) {
      updates.push({
        id: r.id,
        primary_type: next.primary_type,
        secondary_type: next.secondary_type,
        base_value: next.base_value,
        current_production_value: next.current_production_value,
      });
    }
  }
  return updates;
}

async function writeUpdates(supabase, updates) {
  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_CONCURRENCY) {
    const batch = updates.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(
      batch.map(({ id, ...patch }) =>
        supabase.from("riders").update(patch).eq("id", id).then(({ error }) => {
          if (error) throw new Error(`riders update ${id}: ${error.message}`);
        })
      )
    );
    written += batch.length;
  }
  return written;
}

// Genberegn type+base_value+current_production_value for (evt. ét holds) ryttere;
// skriv kun de ændrede. baseline/model defaulter fra de committede JSON-filer
// (som runBaseValueBackfill).
export async function refreshChangedRiderValues(supabase, { baseline, model, log = noop, teamId } = {}) {
  const bl = baseline || JSON.parse(readFileSync(TYPES_BASELINE_PATH, "utf8"));
  const m = model || JSON.parse(readFileSync(VALUATION_MODEL_PATH, "utf8"));

  // v4-alder forankres i den aktive sæson (samme ageForSeason som progression).
  const { data: season, error: seasonErr } = await supabase
    .from("seasons").select("number").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(`value-refresh season lookup: ${seasonErr.message}`);
  const seasonNumber = season?.number ?? 1;

  const riderQuery = () => {
    let q = supabase.from("riders")
      .select("id, primary_type, secondary_type, base_value, current_production_value, birthdate, potentiale")
      .order("id");
    if (teamId) q = q.eq("team_id", teamId);
    return q;
  };
  const riders = await fetchAllRows(riderQuery);
  for (const r of riders) r.age = ageForSeason(r.birthdate, seasonNumber);
  const riderIds = new Set(riders.map((r) => r.id));
  const abilities = await fetchAllRows(() =>
    supabase.from("rider_derived_abilities").select(`rider_id, ${ABILITY_KEYS.join(", ")}`).order("rider_id"));
  const abilityByRider = new Map(abilities.filter((a) => riderIds.has(a.rider_id)).map((a) => [a.rider_id, a]));

  const updates = selectChangedValueUpdates(riders, abilityByRider, bl, m);
  log(`value-refresh${teamId ? ` (team ${teamId})` : ""}: ${riders.length} scannet · ${updates.length} ændret`);
  const written = await writeUpdates(supabase, updates);
  return { scanned: riders.length, changed: updates.length, written };
}
