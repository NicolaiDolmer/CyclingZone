#!/usr/bin/env node
// i18n namespace-inline guard — Refs #470.
//
// Verificér at hvert namespace brugt af `useTranslation(...)` på authenticated
// pages er INLINET som resource i frontend/src/i18n/index.js. Hvis ikke,
// fejler med exit-code 1 — namespacet ville ellers lazy-loades via HttpBackend
// efter first paint, og med `useSuspense: false` render komponenten med raw
// keys ("dashboard:stats.balance") indtil HTTP-load er færdig.
//
// Det er nøjagtigt symptomet brugeren ramte 2026-05-17 på Dashboard
// (dashboard + banners ns ikke inlinet) — se
// `.claude/learnings/2026-05-17-i18n-namespace-inline-missing.md`.
//
// Brug:
//   node scripts/i18n-check-namespace-inline.mjs
//
// CI: .github/workflows/i18n-check.yml

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC_DIR = join(ROOT, "frontend", "src");
const I18N_INDEX = join(SRC_DIR, "i18n", "index.js");

// Namespaces vi ikke kræver inlined — typisk fordi de KUN bruges af pages
// der naturligt allerede har en loading-state (admin-tools bag spinner) eller
// af komponenter der ikke render på first paint. Tilføj med begrundelse.
const INLINE_EXEMPT = new Set([
  // Tom indtil videre. Hvis du tilføjer: skriv hvorfor + hvilken side.
]);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, files);
    } else if (/\.(jsx?|tsx?)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function extractUsedNamespaces(srcFiles) {
  // Patterns vi fanger:
  //   1. useTranslation("x")             — string literal, single ns
  //   2. useTranslation(["x", "y"])      — array of literals (multi-ns)
  //   3. t("ns:key") / t(`ns:${k}`)      — direkte namespace-prefix i kald
  //   4. <Trans i18nKey="ns:key">        — komponent-form (ikke brugt p.t. men fremtidssikring)
  //   5. i18next.t("ns:key")             — direkte instance-kald (ikke brugt p.t.)
  //
  // Patterns vi IKKE fanger (med vilje):
  //   • useTranslation(dynamicVar)       — dynamisk namespace fra prop/state.
  //     Hvis vi tilføjer dette i fremtiden: log warning så guarden ikke tier stille.
  //   • t("noNs") med default-ns fallback — bug-klassen kræver eksplicit ns:prefix
  //     ELLER useTranslation-deklaration, så denne sti er allerede dækket.
  const singleRe = /useTranslation\(\s*["']([\w-]+)["']\s*[,)]/g;
  const arrayRe = /useTranslation\(\s*\[([^\]]+)\]/g;
  const dynamicRe = /useTranslation\(\s*[a-zA-Z_$][\w$]*\s*[,)]/g;
  const tNsKeyRe = /\bt\(\s*[`"']([\w-]+):[^`"']+[`"']/g;
  const transRe = /<Trans\s[^>]*\bi18nKey\s*=\s*["'`]([\w-]+):/g;
  const i18nextTRe = /\b(?:i18next|i18n)\.t\(\s*[`"']([\w-]+):/g;

  const used = new Map(); // namespace -> Set of files
  const dynamicWarnings = [];

  for (const file of srcFiles) {
    const src = readFileSync(file, "utf8");
    const rel = relative(ROOT, file).replace(/\\/g, "/");

    let m;
    while ((m = singleRe.exec(src))) {
      addUsage(used, m[1], rel);
    }
    while ((m = arrayRe.exec(src))) {
      const inner = m[1];
      const nsMatches = [...inner.matchAll(/["']([\w-]+)["']/g)];
      for (const nm of nsMatches) addUsage(used, nm[1], rel);
    }
    while ((m = tNsKeyRe.exec(src))) {
      addUsage(used, m[1], rel);
    }
    while ((m = transRe.exec(src))) {
      addUsage(used, m[1], rel);
    }
    while ((m = i18nextTRe.exec(src))) {
      addUsage(used, m[1], rel);
    }
    while ((m = dynamicRe.exec(src))) {
      dynamicWarnings.push(rel);
    }
  }
  return { used, dynamicWarnings };
}

function addUsage(map, ns, file) {
  if (!map.has(ns)) map.set(ns, new Set());
  map.get(ns).add(file);
}

function extractInlinedNamespaces() {
  const src = readFileSync(I18N_INDEX, "utf8");
  // Find resources-blokken og udtræk keys per sprog. Vi tager unionen og
  // tjekker derefter at hver brugt namespace findes for MINDST ét sprog
  // (cross-language coverage er allerede dækket af i18n-check-keys.mjs).
  const resourcesMatch = src.match(/resources\s*:\s*\{([\s\S]*?)\n\s*\}/);
  if (!resourcesMatch) {
    throw new Error(`Could not locate 'resources:' block in ${relative(ROOT, I18N_INDEX)}`);
  }
  const block = resourcesMatch[1];
  // Hver linje ser ud som: `da: { common: commonDa, auth: authDa, ... }`
  const inlined = new Set();
  const lineRe = /\{([^}]+)\}/g;
  let m;
  while ((m = lineRe.exec(block))) {
    const props = m[1].split(",");
    for (const p of props) {
      const colon = p.indexOf(":");
      if (colon < 0) continue;
      const key = p.slice(0, colon).trim();
      if (/^[\w-]+$/.test(key)) inlined.add(key);
    }
  }
  return inlined;
}

const srcFiles = walk(SRC_DIR);
const { used, dynamicWarnings } = extractUsedNamespaces(srcFiles);
const inlined = extractInlinedNamespaces();

let errorCount = 0;
const missing = [];

for (const [ns, files] of used) {
  if (INLINE_EXEMPT.has(ns)) continue;
  if (!inlined.has(ns)) {
    errorCount += 1;
    missing.push({ ns, files: [...files].slice(0, 5), total: files.size });
  }
}

// Dynamic namespace = guarden kan ikke se den. Log warning så det er
// synligt at filer slipper gennem statisk analyse. Failer ikke buildet —
// runtime-fejl vil stadig manifestere som raw key i UI.
if (dynamicWarnings.length > 0) {
  console.warn(`⚠ ${dynamicWarnings.length} fil(er) bruger dynamic useTranslation(var) — guarden kan ikke verificere namespace-inline statisk:`);
  for (const f of dynamicWarnings) console.warn(`    - ${f}`);
}

if (errorCount === 0) {
  const usedList = [...used.keys()].sort().join(", ");
  console.log(`✓ i18n namespace-inline OK — alle ${used.size} brugte namespaces er inlinet (${usedList})`);
  process.exit(0);
}

console.error(`✗ i18n namespace-inline FAILED — ${errorCount} namespace(s) brugt men ikke inlinet:\n`);
for (const { ns, files, total } of missing) {
  console.error(`  • "${ns}" brugt i ${total} fil(er):`);
  for (const f of files) console.error(`      - ${f}`);
  if (total > files.length) console.error(`      - (+${total - files.length} flere)`);
}
console.error(`\nFix: importér ${missing.map(x => `${x.ns}.json`).join(" + ")} i ${relative(ROOT, I18N_INDEX).replace(/\\/g, "/")}`);
console.error(`     og tilføj til \`resources.da\` + \`resources.en\`.`);
console.error(`\nHvorfor: med \`useSuspense: false\` render komponenten FØR HttpBackend henter`);
console.error(`         lazy namespace → t() returnerer raw key i UI'et på first paint.`);
process.exit(1);
