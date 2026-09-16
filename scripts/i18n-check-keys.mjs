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


// #5289: parity cannot catch a lookup absent from EVERY language. Expand the
// finite local string maps used in translation template lookups and check the
// resulting keys against the actual namespace in every locale. No eval and no
// duplicated role list. This deliberately covers local literal maps, not
// arbitrary JS expressions, imported maps or multiple hook namespaces per file.
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:[jt]sx?|mjs)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [full] : [];
  });
}

let mappedKeyCount = 0;
for (const file of sourceFiles(join(ROOT, 'frontend', 'src'))) {
  const src = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const namespaces = new Set([...src.matchAll(/useTranslation\(\s*["']([\w-]+)["']/g)].map((m) => m[1]));
  const maps = new Map();
  for (const match of src.matchAll(/\bconst\s+(\w+)\s*=\s*\{([^{}]*)\}/g)) {
    const entries = match[2].split(',').map((v) => v.trim()).filter(Boolean);
    const values = entries.map((entry) => entry.match(/^(?:\w+|["'][^"']+["'])\s*:\s*["']([^"']+)["']$/)?.[1]);
    if (values.length && values.every((value) => value !== undefined)) maps.set(match[1], values);
  }
  const calls = /\bt\(\s*\x60([^\x60$]*)\$\{(\w+)\[[^\]]+\](?:\s*\?\?\s*["']([^"']+)["'])?\}([^\x60$]*)\x60/g;
  for (const call of src.matchAll(calls)) {
    const values = maps.get(call[2]);
    if (!values) continue;
    const colon = call[1].indexOf(':');
    const ns = colon >= 0 ? call[1].slice(0, colon) : namespaces.size === 1 ? [...namespaces][0] : null;
    if (!ns) continue;
    const prefix = colon >= 0 ? call[1].slice(colon + 1) : call[1];
    const suffixes = new Set([...values, ...(call[3] ? [call[3]] : [])]);
    for (const suffix of suffixes) {
      const key = prefix + suffix + call[4];
      mappedKeyCount++;
      for (const lng of lngs) {
        let value;
        try { value = valueAtPath(loadJSON(lng, ns), key); } catch { /* reported as a missing lookup below */ }
        if (typeof value !== 'string' || !value.trim() || value === PLACEHOLDER) {
          issues.push('[' + lng + '/' + ns + '] mapped key "' + key + '" missing or untranslated (' + relative(ROOT, file) + ')');
          errorCount++;
        }
      }
    }
  }
}
console.log('[i18n-check] Checked ' + mappedKeyCount + ' mapped source keys in every language');

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
