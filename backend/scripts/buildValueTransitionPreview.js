// #3750/#4000 · Bygger admin-forhåndsvisningen af værdi-overgangen.
//
// Ejer-ønske 21/8: værdierne og de forventede lønninger skal kunne ses og
// vurderes INDE I APPEN før apply. Scriptet beregner pr. rytter, read-only mod
// spillet, og upserter resultatet i value_transition_preview (ren
// preview-tabel, rører ingen spil-tilstand):
//
//   value_now       — rytterens værdi i dag (calculateRiderMarketValue)
//   value_damped    — v4 med k=100-dæmpning + ×1,230-normalisering, FØR c
//                     (niveau-scenarierne c × value_damped regnes i UI'et)
//   cpv_now         — current_production_value som gemt i dag
//   cpv_damped      — CPV under den dæmpede model
//   salary_now      — rider.salary (frossen kontrakt)
//   salary_expected — computeFrozenSalary(cpv_damped): forventet S3-løn hvis
//                     dæmpningen er flippet FØR søndagens genberegning
//   salary_expected_no_damp — computeFrozenSalary(cpv_now): forventet S3-løn
//                     uden dæmpning
//
// Populationen: ejede + AI, ikke test/frosset/bank, ikke retired. Akademiryttere
// er MED på BEGGE faner (ejer-krav 22/8): søndagens løn-genberegning omfatter
// dem, og de bærer ~125 mio. i værdi (mange ældre akademi-kuld har fulde
// v4-værdier, #3614) — kun friske #3972-intakes er symbolske. De flages
// is_academy=true så UI'et kan markere dem. OBS: selve korrektions-populationen
// (marketValueLevelCorrectionApply/marketValueSundaySweep) udelader stadig
// akademi — ejer-beslutning udestår (se #3750-tråden 22/8).
//
// Kør fra backend/ (dotenv/config forventer backend/.env i cwd):
//
//   node scripts/buildValueTransitionPreview.js            (skriver preview-tabellen)
//   node scripts/buildValueTransitionPreview.js --dry-run  (kun konsol-summary)
//
// Dæmpningen bygges EKSPLICIT her (buildDampenedOffsetTable) uanset
// TYPE_DAMPENING_ENABLED — det er hele pointen: forhåndsvise flippet før det
// sker. Live-værdier påvirkes ikke.

import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { predictBaseValue } from "../lib/riderValuation.js";
import { currentProductionValue } from "../lib/riderCareerNpv.js";
import { ageForSeason } from "../lib/riderProgressionEngine.js";
import { calculateRiderMarketValue } from "../lib/marketUtils.js";
import { computeFrozenSalary } from "../lib/contractSeed.js";
import {
  TYPE_DAMPENING_OFFSET_K,
  TYPE_DAMPENING_NORMALIZATION,
  buildDampenedOffsetTable,
} from "../lib/riderValuationTypeDampening.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALUATION_MODEL_PATH = join(__dirname, "../lib/riderValuationModelV4.json");
const WRITE_BATCH = 500;

export function buildExplicitlyDampenedModel(model) {
  if (!model?.fit?.offset || !model?.type_stats) {
    throw new Error("buildExplicitlyDampenedModel: model mangler fit.offset/type_stats");
  }
  return {
    ...model,
    fit: {
      ...model.fit,
      offset: buildDampenedOffsetTable(
        model.fit.offset,
        model.type_stats,
        TYPE_DAMPENING_OFFSET_K,
        TYPE_DAMPENING_NORMALIZATION
      ),
    },
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log("=== Bygger value_transition_preview (#3750/#4000) ===");
  console.log(dryRun ? "MODE: dry-run (skriver INTET)" : "MODE: skriver preview-tabellen");

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Mangler SUPABASE_URL/SUPABASE_SERVICE_KEY i backend/.env");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const model = JSON.parse(readFileSync(VALUATION_MODEL_PATH, "utf8"));
  const damped = buildExplicitlyDampenedModel(model);

  const [teams, riders, abilities, seasonRow] = await Promise.all([
    fetchAllRows(() => supabase.from("teams").select("id, is_test_account, is_frozen, is_bank").order("id")),
    fetchAllRows(() => supabase
      .from("riders")
      .select("id, team_id, birthdate, potentiale, base_value, market_value, prize_earnings_bonus, current_production_value, salary, valuation_type, primary_type, is_retired, is_academy")
      .order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
    supabase.from("seasons").select("number").eq("status", "active").maybeSingle(),
  ]);
  if (seasonRow.error) throw new Error(`seasons: ${seasonRow.error.message}`);
  const seasonNumber = seasonRow.data?.number ?? null;

  const realTeamIds = new Set(teams.filter((t) => !t.is_test_account && !t.is_frozen && !t.is_bank).map((t) => t.id));
  const abilityByRider = new Map(abilities.map((a) => [a.rider_id, a]));
  const computedAt = new Date().toISOString();

  const rows = [];
  let noAbilities = 0;
  for (const r of riders) {
    if (r.team_id == null || !realTeamIds.has(r.team_id) || r.is_retired) continue;
    const ab = abilityByRider.get(r.id);
    const valueRider = { ...r, age: ageForSeason(r.birthdate, seasonNumber) };
    const isAcademy = !!r.is_academy;
    const valueDamped = ab ? predictBaseValue(valueRider, ab, damped) : null;
    const cpvDamped = ab ? currentProductionValue(valueRider, ab, damped) : null;
    if (valueDamped == null) noAbilities++;
    const cpvNow = Number(r.current_production_value) > 0 ? Number(r.current_production_value) : null;
    rows.push({
      rider_id: r.id,
      team_id: r.team_id,
      value_now: calculateRiderMarketValue(r),
      value_damped: valueDamped == null ? null : Math.round(valueDamped),
      cpv_now: cpvNow,
      cpv_damped: cpvDamped == null ? null : Math.round(cpvDamped),
      salary_now: Number(r.salary) > 0 ? Number(r.salary) : null,
      salary_expected: cpvDamped == null ? null : computeFrozenSalary({ current_production_value: cpvDamped }),
      salary_expected_no_damp: cpvNow == null ? null : computeFrozenSalary({ current_production_value: cpvNow }),
      valuation_type: r.valuation_type ?? null,
      primary_type: r.primary_type ?? null,
      is_academy: isAcademy,
      computed_at: computedAt,
    });
  }

  const sum = (key, onlySeniors = false) => rows.reduce((acc, r) => acc + ((onlySeniors && r.is_academy) ? 0 : (Number(r[key]) || 0)), 0);
  const academyN = rows.filter((r) => r.is_academy).length;
  console.log(`Population: ${rows.length} ryttere, heraf ${academyN} akademi (${noAbilities} uden abilities → value_damped=null)`);
  console.log(`Σ værdi i dag:            ${sum("value_now").toLocaleString("da-DK")} (seniorer ${sum("value_now", true).toLocaleString("da-DK")})`);
  console.log(`Σ værdi dæmpet (før c):   ${sum("value_damped").toLocaleString("da-DK")}`);
  console.log(`Σ løn i dag:              ${sum("salary_now").toLocaleString("da-DK")}`);
  console.log(`Σ løn forventet (dæmpet): ${sum("salary_expected").toLocaleString("da-DK")}`);
  console.log(`Σ løn forventet (u. dæmpning): ${sum("salary_expected_no_damp").toLocaleString("da-DK")}`);

  if (dryRun) return;

  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const batch = rows.slice(i, i + WRITE_BATCH);
    const { error } = await supabase.from("value_transition_preview").upsert(batch, { onConflict: "rider_id" });
    if (error) throw new Error(`value_transition_preview upsert: ${error.message}`);
  }
  // Ryd rækker for ryttere der er røget ud af populationen siden sidste kørsel
  // (solgt til bank, pensioneret, akademi) — preview-tabellen skal spejle
  // populationen, ikke akkumulere historik.
  const { error: pruneErr } = await supabase
    .from("value_transition_preview")
    .delete()
    .lt("computed_at", computedAt);
  if (pruneErr) throw new Error(`value_transition_preview prune: ${pruneErr.message}`);

  console.log(`\n✅ ${rows.length} rækker skrevet til value_transition_preview (computed_at ${computedAt}).`);
}

if (process.argv[1] && process.argv[1].endsWith("buildValueTransitionPreview.js")) {
  main().catch((e) => {
    console.error("FEJL:", e);
    process.exit(1);
  });
}
