#!/usr/bin/env node
// Genererer frontendens evne-registry + visnings-opskrifter FRA backend-kilden
// (#3665, spec §D2 vagt 3 / §4 gate R5).
//
// HVORFOR: frontend/src/lib/riderRating.js har indtil nu båret en HÅNDHOLDT kopi
// af backendens type-vægte. Den var allerede drevet da #3665 blev skrevet — målt
// 13/8: brostensrytter havde cobblestone 5 mod backendens 6, puncheur havde stadig
// climbing 1 som #3325 fjernede, og rouleur havde flat 2 mod backendens 4. Intet
// fejlede; kopien drev bare stille. Efter denne generator kan den ikke.
//
// BRUG
//   node scripts/generate-ability-registry.mjs          # skriv filerne
//   node scripts/generate-ability-registry.mjs --check  # exit 1 hvis de er stale
//
// --check er den form CI og drift-testen bruger: den genererer i hukommelsen og
// sammenligner byte for byte med det der ligger på disken.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ABILITY_REGISTRY } from "../backend/lib/abilityRegistry.js";
import { DISPLAY_RECIPES } from "../backend/lib/weights/displayRecipes.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "frontend", "src", "lib", "generated");

const BANNER = `// GENERERET FIL — REDIGÉR IKKE I HÅNDEN.
// Kilde: backend/lib/abilityRegistry.js + backend/lib/weights/displayRecipes.js
// Regenerér: node scripts/generate-ability-registry.mjs
// Drift-vagt: backend/lib/abilityRegistryGuards.test.js (CI fejler hvis stale).
`;

const json = (v) => JSON.stringify(v, null, 2);

// Linjeslutninger er ikke indhold. Uden denne normalisering ville et Windows-
// checkout med core.autocrlf=true give filerne CRLF, og drift-vagten ville fejle
// efter enhver rebase uden at en eneste vægt havde flyttet sig — samme fælde som
// #3570 ramte. .gitattributes holder filerne på LF; dette er andet lag.
export const normalizeEol = (s) => (s == null ? s : s.replace(/\r\n/g, "\n"));

function renderRegistry() {
  const byDisplay = [...ABILITY_REGISTRY].sort((a, b) => a.displayOrder - b.displayOrder);
  const categories = [];
  for (const a of byDisplay) {
    let group = categories.find((c) => c.key === a.category);
    if (!group) { group = { key: a.category, keys: [] }; categories.push(group); }
    group.keys.push(a.key);
  }
  const short = Object.fromEntries(byDisplay.map((a) => [a.key, a.shortLabel]));
  const icons = Object.fromEntries(byDisplay.map((a) => [a.key, a.icon]));
  const i18n = Object.fromEntries(byDisplay.map((a) => [a.key, a.i18nKey]));

  return `${BANNER}
export const ABILITY_CATEGORIES = Object.freeze(${json(categories)});

export const ABILITY_KEYS = Object.freeze(ABILITY_CATEGORIES.flatMap((c) => c.keys));

export const ABILITY_SHORT = Object.freeze(${json(short)});

export const ABILITY_ICONS = Object.freeze(${json(icons)});

export const ABILITY_I18N_KEYS = Object.freeze(${json(i18n)});
`;
}

function renderRecipes() {
  const recipes = DISPLAY_RECIPES.map((r) => ({ key: r.key, weights: r.weights }));
  return `${BANNER}
// Visnings-opskrifterne. Rating = vægtet snit af rollens evner, afrundet,
// klampet [0,99]. Ingen normalisering, ingen kurve, ingen populations-ankre.
export const DISPLAY_RECIPES = Object.freeze(${json(recipes)});

export const DISPLAY_RECIPE_KEYS = Object.freeze(DISPLAY_RECIPES.map((r) => r.key));

// Spejler backend ratingForRole() 1:1. Evner der mangler på rækken tæller
// hverken i tæller eller nævner, så en delvist udfyldt række ikke trækkes mod 0.
export function ratingForRole(abilities, roleKey) {
  const recipe = DISPLAY_RECIPES.find((r) => r.key === roleKey);
  if (!recipe) return null;
  let sum = 0;
  let wsum = 0;
  for (const [ability, weight] of Object.entries(recipe.weights)) {
    const v = Number(abilities?.[ability]);
    if (!Number.isFinite(v)) continue;
    sum += v * weight;
    wsum += weight;
  }
  if (wsum <= 0) return null;
  return Math.max(0, Math.min(99, Math.round(sum / wsum)));
}
`;
}

export const GENERATED_FILES = Object.freeze([
  { path: join(OUT_DIR, "abilityRegistry.js"), render: renderRegistry },
  { path: join(OUT_DIR, "displayRecipes.js"), render: renderRecipes },
]);

function main() {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const { path, render } of GENERATED_FILES) {
    const next = render();
    let current = null;
    try { current = readFileSync(path, "utf8"); } catch { /* findes ikke endnu */ }
    if (normalizeEol(current) === next) continue;
    if (check) {
      stale += 1;
      console.error(`[stale] ${path.replace(ROOT, ".")}`);
      continue;
    }
    writeFileSync(path, next, "utf8");
    console.log(`[skrevet] ${path.replace(ROOT, ".")}`);
  }
  if (check && stale > 0) {
    console.error(`\n${stale} genereret fil er ikke i sync med backend-kilden.`);
    console.error("Kør: node scripts/generate-ability-registry.mjs");
    process.exit(1);
  }
  if (check) console.log("[ok] genererede filer er i sync med backend-kilden.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
