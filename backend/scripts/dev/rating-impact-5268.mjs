// #5268 — READ-ONLY rating/value impact harness for the mental ability move.
//
// Public code deliberately does not commit a new display recipe. To evaluate a
// teamwork/leadership candidate, pass a private JSON file under balance-internals:
//
//   infisical run --env=prod -- node backend/scripts/dev/rating-impact-5268.mjs --recipe=balance-internals/5268-rating-neutral-recipe.json --out-dir=balance-internals/5268-rating-neutral-v3
//
// The script writes only local files when --out-dir is provided. Supabase access
// is read-only at the transport layer.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../../lib/supabasePagination.js";
import { DISPLAY_RECIPES, DISPLAY_RECIPE_KEYS, roleOutputRaw, ratingForRole } from "../../lib/weights/displayRecipes.js";
import { computeRiderTypes } from "../../lib/riderTypes.js";
import { recomputeRiderValue } from "../../lib/riderValueRefresh.js";
import { loadValuationModelByIdWithMarket, loadValuationModelById } from "../../lib/riderValuationModelSelect.js";
import { ageForSeason } from "../../lib/riderProgressionEngine.js";
import { normalizeShares, softBest } from "../../lib/valuationTypefree/abilityProduction.js";
import {
  VARIANTS, loadRows, referencePlan, applyVariant, readOnlyFetch,
} from "../dry-run-5268-mental-abilities.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_DIR = resolve(__dirname, "../../lib");
const TYPE_BASELINE = JSON.parse(readFileSync(join(LIB_DIR, "riderTypesBaseline.json"), "utf8"));
const YOUTH_BASELINE = JSON.parse(readFileSync(join(LIB_DIR, "riderTypesBaselineYouth.json"), "utf8"));
const V6_MODEL = JSON.parse(readFileSync(join(LIB_DIR, "riderValuationModelV6Typefree.json"), "utf8"));

function usage() {
  return [
    "Usage: node backend/scripts/dev/rating-impact-5268.mjs [--recipe=<private-json>] [--search=<private-json>] [--out-dir=<dir>] [--allow-human-drops]",
    "",
    "Read-only. Measures V1/V2/V3 in both live display modes and separates",
    "ability-only, recipe-only and combined effects. A recipe JSON stays private.",
  ].join("\n");
}

export function parseArgs(args) {
  const out = { recipePath: null, searchPath: null, outDir: null, allowHumanDrops: false, help: false };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--allow-human-drops") out.allowHumanDrops = true;
    else if (arg.startsWith("--recipe=")) out.recipePath = arg.slice("--recipe=".length);
    else if (arg.startsWith("--search=")) out.searchPath = arg.slice("--search=".length);
    else if (arg.startsWith("--out-dir=")) out.outDir = arg.slice("--out-dir=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function assertPrivatePath(path, label) {
  if (!path) return null;
  const full = resolve(process.cwd(), path);
  const marker = resolve(process.cwd(), "balance-internals");
  if (full !== marker && !full.startsWith(`${marker}\\`) && !full.startsWith(`${marker}/`)) {
    throw new Error(`${label} must be under balance-internals/ to keep precise balance measurements private`);
  }
  return full;
}

function resolveCandidateRecipes(parsed) {
  const recipes = Array.isArray(parsed) ? parsed : parsed.recipes;
  if (!Array.isArray(recipes)) throw new Error("--recipe JSON must be an array or { recipes: [...] }");
  const byKey = new Map(DISPLAY_RECIPES.map((r) => [r.key, r]));
  for (const recipe of recipes) {
    if (!DISPLAY_RECIPE_KEYS.includes(recipe?.key)) throw new Error(`Unknown recipe key: ${recipe?.key}`);
    if (!recipe.weights || typeof recipe.weights !== "object") throw new Error(`Recipe ${recipe.key} is missing weights`);
    byKey.set(recipe.key, { key: recipe.key, weights: Object.freeze({ ...recipe.weights }) });
  }
  return DISPLAY_RECIPE_KEYS.map((key) => byKey.get(key));
}

function loadCandidateRecipes(path) {
  return path ? resolveCandidateRecipes(JSON.parse(readFileSync(assertPrivatePath(path, "--recipe"), "utf8"))) : null;
}

function recipeRaw(abilities, recipe) {
  let sum = 0;
  let wsum = 0;
  for (const [ability, weight] of Object.entries(recipe.weights)) {
    const raw = abilities?.[ability];
    if (raw === null || raw === undefined || raw === "") continue;
    const v = Number(raw);
    const w = Number(weight);
    if (Number.isFinite(v) && Number.isFinite(w) && w > 0) {
      sum += v * w;
      wsum += w;
    }
  }
  return wsum > 0 ? sum / wsum : null;
}

function ratingWithRecipes(abilities, roleKey, recipes) {
  if (!recipes) return ratingForRole(abilities, roleKey);
  const recipe = recipes.find((r) => r.key === roleKey);
  const raw = recipe ? recipeRaw(abilities, recipe) : roleOutputRaw(abilities, roleKey);
  return raw === null ? null : Math.max(0, Math.min(99, Math.round(raw)));
}

function best(abilities, recipes = null) {
  let role = null;
  let value = -1;
  for (const key of DISPLAY_RECIPE_KEYS) {
    const v = ratingWithRecipes(abilities, key, recipes);
    if (v != null && v > value) { value = v; role = key; }
  }
  return { role, value };
}

function typefreeOutput(abilities, recipes = null) {
  const prod = V6_MODEL.production ?? {};
  const shares = normalizeShares(prod.shares);
  const ratings = DISPLAY_RECIPE_KEYS.map((key) => {
    if (!recipes) return roleOutputRaw(abilities, key) ?? 0;
    const recipe = recipes.find((r) => r.key === key);
    return recipeRaw(abilities, recipe) ?? 0;
  });
  return softBest(ratings, shares, prod.beta);
}

function bucket(drop) {
  if (drop <= 0) return "0";
  if (drop <= 2) return "1-2";
  if (drop <= 5) return "3-5";
  if (drop <= 10) return "6-10";
  return "11+";
}

function makeStats() {
  return {
    scenarios: Object.fromEntries(["abilityOnly", "recipeOnly", "combined"].map((scenario) => [scenario,
      Object.fromEntries(["primary", "best"].map((mode) => [mode, {
        all: { n: 0, down: 0, buckets: {} }, human: { n: 0, down: 0, buckets: {} }, maxDrop: 0,
      }]))])),
    baroBefore: 0,
    examples: [],
    diagnosticTypeChanges: 0,
    actualTypeChanges: 0,
    appendOnlyImpossible: { primary: 0, best: 0 },
    v6OutputDelta: [],
    value: Object.fromEntries(["v4", "v6"].map((model) => [model, {
      n: 0, baseChanged: 0, cpvChanged: 0, baseDelta: [], cpvDelta: [],
    }])),
  };
}

function addDrop(stat, group, drop) {
  stat[group].n += 1;
  if (drop > 0) stat[group].down += 1;
  const b = bucket(drop);
  stat[group].buckets[b] = (stat[group].buckets[b] || 0) + 1;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))))];
}

export function evaluateVariant(applied, humanTeams, riderById, candidateRecipes, valueContext = null) {
  const stat = makeStats();
  for (const e of applied) {
    const beforeAbilities = e.abilities;
    const afterAbilities = { ...e.abilities, ...e.next };
    const before = best(beforeAbilities);
    const rider = riderById.get(e.riderId);
    const primary = rider?.primary_type;
    const isHuman = humanTeams.has(rider?.team_id);
    if (before.role === "baroudeur") stat.baroBefore += 1;
    if (isHuman) {
      // Necessary upper bound for ANY nonnegative append-only mental weights:
      // a weighted average cannot exceed its largest input. Existing weights
      // stay intact and there is no rider-specific floor or aggression rewrite.
      const mental = [afterAbilities.teamwork, afterAbilities.leadership]
        .filter((x) => Number.isFinite(Number(x))).map(Number);
      const maxMental = mental.length ? Math.max(...mental) : -Infinity;
      const primaryRaw = DISPLAY_RECIPES.find((r) => r.key === primary);
      const primaryUpper = primaryRaw == null ? null
        : Math.round(Math.max(recipeRaw(afterAbilities, primaryRaw), maxMental));
      if (primaryUpper != null && primaryUpper < ratingWithRecipes(beforeAbilities, primary, null)) {
        stat.appendOnlyImpossible.primary += 1;
      }
      const bestUpper = Math.round(Math.max(
        maxMental, ...DISPLAY_RECIPES.map((r) => recipeRaw(afterAbilities, r) ?? -Infinity),
      ));
      if (bestUpper < before.value) stat.appendOnlyImpossible.best += 1;
    }
    for (const [scenario, abilities, recipes] of [
      ["abilityOnly", afterAbilities, null],
      ["recipeOnly", beforeAbilities, candidateRecipes],
      ["combined", afterAbilities, candidateRecipes],
    ]) {
      for (const mode of ["primary", "best"]) {
        const prior = mode === "best" ? before.value : ratingWithRecipes(beforeAbilities, primary, null);
        const next = mode === "best" ? best(abilities, recipes).value : ratingWithRecipes(abilities, primary, recipes);
        if (prior == null || next == null || prior < 0 || next < 0) continue;
        const drop = prior - next;
        const s = stat.scenarios[scenario][mode];
        for (const g of isHuman ? ["all", "human"] : ["all"]) addDrop(s, g, drop);
        s.maxDrop = Math.max(s.maxDrop, drop);
        if (scenario === "combined" && drop > 0 && isHuman && stat.examples.length < 10) {
          stat.examples.push({ alias: `Human rider ${stat.examples.length + 1}`, mode, age: e.age, prior, next, drop });
        }
      }
    }
    const primaryBefore = computeRiderTypes(beforeAbilities, TYPE_BASELINE).primary.key;
    const primaryAfter = computeRiderTypes(afterAbilities, TYPE_BASELINE).primary.key;
    if (primaryBefore !== primaryAfter) stat.diagnosticTypeChanges += 1;
    stat.v6OutputDelta.push(typefreeOutput(afterAbilities, candidateRecipes) - typefreeOutput(beforeAbilities));
    if (valueContext && rider) {
      const opts = { youthBaseline: YOUTH_BASELINE, productionModel: valueContext.v4,
        phaseStep: valueContext.phaseStep, typeAbilities: valueContext.capsByRider.get(e.riderId) };
      for (const modelId of ["v4", "v6"]) {
        const model = valueContext[modelId];
        const prior = recomputeRiderValue(rider, beforeAbilities, TYPE_BASELINE, model, opts);
        const next = recomputeRiderValue(rider, afterAbilities, TYPE_BASELINE, model, opts);
        if (modelId === "v4" && prior.primary_type !== next.primary_type) stat.actualTypeChanges += 1;
        const v = stat.value[modelId];
        if (prior.base_value != null && next.base_value != null) {
          v.n += 1;
          v.baseChanged += Number(prior.base_value !== next.base_value);
          v.baseDelta.push(next.base_value - prior.base_value);
          v.cpvChanged += Number(prior.current_production_value !== next.current_production_value);
          v.cpvDelta.push(next.current_production_value - prior.current_production_value);
        }
      }
    }
  }
  return stat;
}

function renderConsole(out, recipeLoaded) {
  const lines = [];
  lines.push(recipeLoaded
    ? "Candidate recipe loaded from private balance-internals file."
    : "No candidate recipe loaded; rating is measured against the current public display recipes.");
  for (const [variant, s] of Object.entries(out)) {
    lines.push("");
    lines.push(`### ${variant.toUpperCase()}`);
    lines.push(`Best role = baroudeur before: ${s.baroBefore}`);
    for (const [scenario, modes] of Object.entries(s.scenarios)) for (const [mode, result] of Object.entries(modes)) {
      lines.push(`${scenario}/${mode}: human ${result.human.down}/${result.human.n} drops; all ${result.all.down}/${result.all.n}; max ${result.maxDrop}`);
    }
    lines.push(`Type changes: diagnostic live-ability reclassification ${s.diagnosticTypeChanges}; actual refresh with persisted archetype/caps ${s.actualTypeChanges}`);
    lines.push(`Append-only nonnegative recipe impossibility lower bound on human riders: primary ${s.appendOnlyImpossible.primary}; best ${s.appendOnlyImpossible.best}`);
    lines.push(`v6 softBest output delta (not money): median ${percentile(s.v6OutputDelta, 0.5)?.toFixed(2)}`);
    for (const [modelId, v] of Object.entries(s.value)) {
      lines.push(`${modelId} real model: n ${v.n}; base changed ${v.baseChanged}; CPV changed ${v.cpvChanged}; base median delta ${percentile(v.baseDelta, 0.5)}; CPV median delta ${percentile(v.cpvDelta, 0.5)}`);
    }
  }
  lines.push("");
  lines.push("READ-ONLY: no database writes were attempted.");
  return lines.join("\n");
}

function writeArtifacts(outDir, out) {
  const full = assertPrivatePath(outDir, "--out-dir");
  mkdirSync(full, { recursive: true });
  writeFileSync(join(full, "rating-impact-5268-v3.json"), `${JSON.stringify(out, null, 2)}\n`);
  const rows = Object.entries(out).map(([variant, s], i) => {
    const y = 72 + i * 58;
    const count = s.scenarios.combined.best.human.down;
    const width = Math.max(6, Math.min(620, count * 0.14));
    return [
      `<text x="24" y="${y}" font-size="18" font-family="Arial">${variant.toUpperCase()}</text>`,
      `<rect x="96" y="${y - 18}" width="${width}" height="24" fill="${count ? "#c2410c" : "#15803d"}" />`,
      `<text x="${112 + width}" y="${y}" font-size="14" font-family="Arial">human best-role drops: ${count}; primary: ${s.scenarios.combined.primary.human.down}</text>`,
    ].join("");
  }).join("");
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="290" viewBox="0 0 900 290">`,
    `<rect width="900" height="290" fill="#f8fafc" />`,
    `<text x="24" y="34" font-size="22" font-family="Arial" font-weight="700">#5268 V1/V2/V3 visible rating dry run</text>`,
    `<text x="24" y="54" font-size="13" font-family="Arial">Private annotated artifact. Public PR text must stay qualitative.</text>`,
    rows,
    `</svg>`,
  ].join("");
  writeFileSync(join(full, "rating-impact-5268-v1-v2-v3.svg"), svg);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const candidateRecipes = loadCandidateRecipes(args.recipePath);
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Run through Infisical (infisical run --env=prod -- ...)");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: readOnlyFetch },
  });

  const { rows } = await loadRows(supabase);
  const valueRiders = await fetchAllRows(() => supabase.from("riders")
    .select("id, team_id, primary_type, secondary_type, valuation_type, birthdate, potentiale, archetype_draw")
    .eq("is_retired", false).order("id"));
  const { data: activeSeason, error: seasonError } = await supabase.from("seasons")
    .select("number").eq("status", "active").maybeSingle();
  if (seasonError) throw seasonError;
  let seasonNumber = activeSeason?.number;
  if (!seasonNumber) {
    const { data: completed, error } = await supabase.from("seasons").select("number")
      .eq("status", "completed").order("number", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    seasonNumber = completed?.number ?? 1;
  }
  const riderById = new Map(valueRiders.map((r) => [r.id, { ...r, age: ageForSeason(r.birthdate, seasonNumber) }]));
  const teams = await fetchAllRows(() => supabase.from("teams").select("id, is_ai, is_bank").order("id"));
  const human = new Set(teams.filter((t) => !t.is_ai && !t.is_bank).map((t) => t.id));
  const plan = referencePlan(rows);
  if (args.searchPath) {
    if (!args.outDir) throw new Error("--search requires private --out-dir");
    const search = JSON.parse(readFileSync(assertPrivatePath(args.searchPath, "--search"), "utf8"));
    if (!Array.isArray(search.candidates) || !search.candidates.length) throw new Error("--search expects { candidates: [...] }");
    const appliedV3 = applyVariant(plan, "v3");
    const results = search.candidates.map(({ name, recipes, globalAddedWeights }) => {
      const resolved = globalAddedWeights
        ? DISPLAY_RECIPES.map((r) => ({ key: r.key, weights: { ...r.weights, ...globalAddedWeights } }))
        : recipes;
      const stat = evaluateVariant(appliedV3, human, riderById, resolveCandidateRecipes({ recipes: resolved }));
      return { name, primary: stat.scenarios.combined.primary, best: stat.scenarios.combined.best };
    });
    const dir = assertPrivatePath(args.outDir, "--out-dir");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "candidate-search.json"), `${JSON.stringify(results, null, 2)}\n`);
    console.log(results.map((r) => `${r.name}: primary ${r.primary.human.down}, best ${r.best.human.down}`).join("\n"));
    console.log("READ-ONLY: candidate search wrote only private local evidence.");
    return;
  }
  const valueContext = {
    v4: loadValuationModelById("v4"),
    v6: await loadValuationModelByIdWithMarket(supabase, "v6"),
    capsByRider: new Map(rows.map(({ rider, abilities }) => [rider.id, abilities.ability_caps])),
  };
  valueContext.phaseStep = valueContext.v6.current_phase_step;

  const out = {};
  for (const v of VARIANTS) out[v] = evaluateVariant(applyVariant(plan, v), human, riderById, candidateRecipes, valueContext);
  console.log(renderConsole(out, Boolean(candidateRecipes)));
  if (args.outDir) writeArtifacts(args.outDir, out);
  const primaryDrops = out.v3.scenarios.combined.primary.human.down;
  const bestDrops = out.v3.scenarios.combined.best.human.down;
  if ((primaryDrops > 0 || bestDrops > 0) && !args.allowHumanDrops) {
    throw new Error(`Zero-drop gate failed: V3 has human visible rating drops in primary (${primaryDrops}) or best-role (${bestDrops}) mode`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1]).replace(/\\/g, "/")}`).href) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
