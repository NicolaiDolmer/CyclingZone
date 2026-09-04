#!/usr/bin/env node
// Generér backendens locale-bundle fra frontend/public/locales — Refs #4734.
//
// HVORFOR en generator og ikke bare fs.readFileSync("frontend/public/locales/...")
// i backend-runtime: Railways root directory for backend-servicen er /backend
// (dokumenteret i backend/railway.deployConfig.test.js: "Railways root directory
// er /backend, saa intet herunder er overhovedet med i build-konteksten").
// frontend/public/locales findes derfor IKKE paa disk naar serveren koerer i prod.
// Foer #4734 loeste backend det ved at KOPIERE strenge i haanden
// (backend/lib/raceNarrativeNotification.js: "kopieret ORDRET fra
// frontend/public/locales/en/races.json") — en kopi der stille driver.
//
// Denne generator laver samme kopi, men maskinelt og med en drift-gate:
//   node scripts/build-backend-locales.mjs            # skriv bundlen
//   node scripts/build-backend-locales.mjs --check    # fejl hvis den er stale
//
// Kun namespacet `backendMessages` bundles: det er det eneste namespace backend
// rendrer selv (in-app-notifikationers EN-fallback + Discord-DM i modtagerens
// sprog). Alt andet rendres af frontend, som laeser locale-JSON direkte.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = join(ROOT, "frontend", "public", "locales");
const OUT_FILE = join(ROOT, "backend", "lib", "locales", "backendMessages.generated.json");

// Sprog der bundles. Holdes bevidst lig med SUPPORTED_LANGS i
// frontend/src/i18n/languages.js (#4733) minus pseudo-locale en-XA, som kun
// bruges til layout-test i browseren og aldrig til en notifikation.
export const BUNDLED_LANGUAGES = ["en", "da"];
export const BUNDLED_NAMESPACE = "backendMessages";

/** Flad {a:{b:"x"}} ud til {"a.b":"x"} — samme noeglesyntaks som i18next bruger. */
export function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, path, out);
    } else if (typeof value === "string") {
      out[path] = value;
    }
  }
  return out;
}

export function buildBundle({ localesDir = LOCALES_DIR } = {}) {
  const bundle = {};
  for (const lng of BUNDLED_LANGUAGES) {
    const file = join(localesDir, lng, `${BUNDLED_NAMESPACE}.json`);
    const json = JSON.parse(readFileSync(file, "utf8"));
    bundle[lng] = flatten(json);
  }
  return bundle;
}

function serialize(bundle) {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

function main() {
  const check = process.argv.includes("--check");
  const bundle = buildBundle();
  const next = serialize(bundle);
  const keyCount = Object.keys(bundle.en || {}).length;

  if (check) {
    if (!existsSync(OUT_FILE)) {
      console.error("❌ backend/lib/locales/backendMessages.generated.json mangler.");
      console.error("   Koer: node scripts/build-backend-locales.mjs");
      process.exit(1);
    }
    const current = readFileSync(OUT_FILE, "utf8");
    if (current !== next) {
      console.error("❌ Backendens locale-bundle er stale i forhold til frontend/public/locales.");
      console.error("   Koer: node scripts/build-backend-locales.mjs && git add backend/lib/locales/backendMessages.generated.json");
      process.exit(1);
    }
    console.log(`✅ backend locale-bundle i sync (${keyCount} noegler x ${BUNDLED_LANGUAGES.length} sprog)`);
    return;
  }

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, next, "utf8");
  console.log(`✅ skrev backend/lib/locales/backendMessages.generated.json (${keyCount} noegler x ${BUNDLED_LANGUAGES.length} sprog)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
