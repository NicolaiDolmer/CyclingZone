#!/usr/bin/env node
// i18n key-coverage guard — Refs #410.
//
// Verificér at alle locale-filer i frontend/public/locales/<lng>/<ns>.json
// har samme nøgle-sæt på tværs af sprog. Fail med exit-code 1 hvis en nøgle
// findes i ét sprog men mangler i et andet (eller omvendt). Placeholder
// `__MISSING__` (case-sensitive) tillades som work-in-progress.
//
// Brug:
//   node scripts/i18n-check-keys.mjs
//
// CI: .github/workflows/i18n-check.yml (advisory i Fase 1, promote til
// required ved Fase 5 per #414).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const LOCALES_DIR = join(ROOT, "frontend", "public", "locales");
const PLACEHOLDER = "__MISSING__";

function listLngs() {
  return readdirSync(LOCALES_DIR).filter((name) => {
    try {
      return statSync(join(LOCALES_DIR, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

function listNamespaces(lng) {
  const dir = join(LOCALES_DIR, lng);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function loadJSON(lng, ns) {
  const path = join(LOCALES_DIR, lng, `${ns}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function flattenKeys(obj, prefix = "") {
  const out = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      for (const child of flattenKeys(v, key)) out.add(child);
    } else {
      out.add(key);
    }
  }
  return out;
}

function valueAtPath(obj, dotPath) {
  return dotPath.split(".").reduce((acc, p) => (acc == null ? acc : acc[p]), obj);
}

const lngs = listLngs();
if (lngs.length === 0) {
  console.error("[i18n-check] No locale directories found at", relative(ROOT, LOCALES_DIR));
  process.exit(1);
}

const allNamespaces = new Set();
for (const lng of lngs) {
  for (const ns of listNamespaces(lng)) allNamespaces.add(ns);
}

let errorCount = 0;
const issues = [];

for (const ns of allNamespaces) {
  const perLngKeys = new Map();
  for (const lng of lngs) {
    let data;
    try {
      data = loadJSON(lng, ns);
    } catch (err) {
      issues.push(`[${lng}/${ns}] file missing or invalid JSON: ${err.message}`);
      errorCount += 1;
      continue;
    }
    perLngKeys.set(lng, { keys: flattenKeys(data), data });
  }

  if (perLngKeys.size < 2) continue;

  const allKeys = new Set();
  for (const { keys } of perLngKeys.values()) {
    for (const k of keys) allKeys.add(k);
  }

  for (const key of allKeys) {
    const missingIn = [];
    const placeholderIn = [];
    for (const [lng, { keys, data }] of perLngKeys) {
      if (!keys.has(key)) {
        missingIn.push(lng);
      } else if (valueAtPath(data, key) === PLACEHOLDER) {
        placeholderIn.push(lng);
      }
    }
    if (missingIn.length > 0) {
      issues.push(`[${ns}] key "${key}" missing in: ${missingIn.join(", ")}`);
      errorCount += 1;
    }
    if (placeholderIn.length > 0) {
      // Placeholder is allowed but printed as info (not an error)
      issues.push(`  ℹ  [${ns}] key "${key}" is ${PLACEHOLDER} in: ${placeholderIn.join(", ")} (allowed)`);
    }
  }
}

if (issues.length === 0) {
  console.log(`✓ i18n key-coverage OK — ${lngs.length} languages × ${allNamespaces.size} namespaces`);
  process.exit(0);
}

for (const msg of issues) console.log(msg);

if (errorCount > 0) {
  console.error(`\n✗ i18n key-coverage FAILED — ${errorCount} issue(s)`);
  process.exit(1);
}

console.log(`✓ i18n key-coverage OK (with ${issues.length} placeholder note(s))`);
process.exit(0);
