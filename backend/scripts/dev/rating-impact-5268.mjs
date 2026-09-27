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
import { normalizeShares, softBest } from "../../lib/valuationTypefree/abilityProduction.js";
import {
  VARIANTS, loadRows, referencePlan, applyVariant, readOnlyFetch,
} from "../dry-run-5268-mental-abilities.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_DIR = resolve(__dirname, "../../lib");
const TYPE_BASELINE = JSON.parse(readFileSync(join(LIB_DIR, "riderTypesBaseline.json"), "utf8"));
const V6_MODEL = JSON.parse(readFileSync(join(LIB_DIR, "riderValuationModelV6Typefree.json"), "utf8"));

function usage() {
  return [
    "Usage: node backend/scripts/dev/rating-impact-5268.mjs [--recipe=<private-json>] [--out-dir=<dir>] [--allow-human-drops]",
    "",
    "Read-only. Measures V1/V2/V3 visible rating impact, primary-type diagnostics,",
    "and v6 typefree output impact. A recipe JSON must stay in balance-internals/.",
  ].join("\n");
}

export function parseArgs(args) {
  const out = { recipePath: null, outDir: null, allowHumanDrops: false, help: false };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--allow-human-drops") out.allowHumanDrops = true;
    else if (arg.startsWith("--recipe=")) out.recipePath = arg.slice("--recipe=".length);
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

function loadCandidateRecipes(path) {
  if (!path) return null;
  const full = assertPrivatePath(path, "--recipe");
  const parsed = JSON.parse(readFileSync(full, "utf8"));
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
    all: { n: 0, down: 0, buckets: {} },
    human: { n: 0, down: 0, buckets: {} },
    maxDrop: 0,
    baroBefore: 0,
    examples: [],
    primaryChanged: 0,
    v6OutputDelta: [],
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

function evaluateVariant(applied, humanTeams, teamOf, candidateRecipes) {
  const stat = makeStats();
  for (const e of applied) {
    const beforeAbilities = e.abilities;
    const afterAbilities = { ...e.abilities, ...e.next };
    const before = best(beforeAbilities);
    const after = best(afterAbilities, candidateRecipes);
    const drop = before.value - after.value;
    const isHuman = humanTeams.has(teamOf.get(e.riderId));
    if (before.role === "baroudeur") stat.baroBefore += 1;
    for (const g of isHuman ? ["all", "human"] : ["all"]) addDrop(stat, g, drop);
    if (drop > stat.maxDrop) stat.maxDrop = drop;
    if (drop > 0 && isHuman && stat.examples.length < 10) {
      stat.examples.push({
        alias: `Human rider ${stat.examples.length + 1}`,
        age: e.age,
        before,
        after,
        drop,
      });
    }
    const primaryBefore = computeRiderTypes(beforeAbilities, TYPE_BASELINE).primary.key;
    const primaryAfter = computeRiderTypes(afterAbilities, TYPE_BASELINE).primary.key;
    if (primaryBefore !== primaryAfter) stat.primaryChanged += 1;
    stat.v6OutputDelta.push(typefreeOutput(afterAbilities, candidateRecipes) - typefreeOutput(beforeAbilities));
  }
  return stat;
}

function renderConsole(out, recipeLoaded) {
  const lines = [];
  lines.push(recipeLoaded
    ? "Candidate recipe loaded from private balance-internals file."
    : "No candidate recipe loaded; rating is measured against the current public display recipes.");
  for (const [variant, s] of Object.entries(out)) {
    const bAll = s.all.buckets;
    const bHuman = s.human.buckets;
    lines.push("");
    lines.push(`### ${variant.toUpperCase()}`);
    lines.push(`Best role = baroudeur before: ${s.baroBefore}`);
    lines.push(`All riders: ${s.all.n} · visible rating drops: ${s.all.down} · 1-2: ${bAll["1-2"] || 0} · 3-5: ${bAll["3-5"] || 0} · 6-10: ${bAll["6-10"] || 0} · 11+: ${bAll["11+"] || 0}`);
    lines.push(`Human teams: ${s.human.n} · visible rating drops: ${s.human.down} · 1-2: ${bHuman["1-2"] || 0} · 3-5: ${bHuman["3-5"] || 0} · 6-10: ${bHuman["6-10"] || 0} · 11+: ${bHuman["11+"] || 0}`);
    lines.push(`Largest drop: ${s.maxDrop}`);
    lines.push(`Primary-type diagnostic changes: ${s.primaryChanged}`);
    lines.push(`v6 output delta: median ${percentile(s.v6OutputDelta, 0.5)?.toFixed(2)} · p10 ${percentile(s.v6OutputDelta, 0.1)?.toFixed(2)} · p90 ${percentile(s.v6OutputDelta, 0.9)?.toFixed(2)}`);
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
    const width = Math.max(6, Math.min(620, s.human.down * 0.14));
    return [
      `<text x="24" y="${y}" font-size="18" font-family="Arial">${variant.toUpperCase()}</text>`,
      `<rect x="96" y="${y - 18}" width="${width}" height="24" fill="${s.human.down ? "#c2410c" : "#15803d"}" />`,
      `<text x="${112 + width}" y="${y}" font-size="14" font-family="Arial">human visible drops: ${s.human.down}, max drop: ${s.maxDrop}</text>`,
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
  const teamOf = new Map(rows.map(({ rider }) => [rider.id, rider.team_id]));
  const teams = await fetchAllRows(() => supabase.from("teams").select("id, is_ai, is_bank").order("id"));
  const human = new Set(teams.filter((t) => !t.is_ai && !t.is_bank).map((t) => t.id));
  const plan = referencePlan(rows);

  const out = {};
  for (const v of VARIANTS) out[v] = evaluateVariant(applyVariant(plan, v), human, teamOf, candidateRecipes);
  console.log(renderConsole(out, Boolean(candidateRecipes)));
  if (args.outDir) writeArtifacts(args.outDir, out);
  if (out.v3.human.down > 0 && !args.allowHumanDrops) {
    throw new Error(`Zero-drop gate failed: V3 still has ${out.v3.human.down} visible rating drop(s) on human teams`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1]).replace(/\\/g, "/")}`).href) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
