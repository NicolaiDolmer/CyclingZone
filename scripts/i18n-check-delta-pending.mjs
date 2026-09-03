#!/usr/bin/env node
// i18n delta-pending guard — Refs #4733.
//
// ── Hvad denne guard er, og hvorfor den ikke er i18n-check-keys.mjs ──────────
//
// `i18n-check-keys.mjs` er den GENERELLE symmetri-tjek: den sammenligner alle
// sprog mod hinanden i BEGGE retninger og accepterer bevidst `__MISSING__` som
// work-in-progress-placeholder.
//
// Denne guard er noget andet: den er den spillervendte besked-guard for ÉN
// retning — EN (sandheden) → alle øvrige sprog. En nøgle der findes i `en` men
// mangler (eller står som `__MISSING__`) i fx `da` betyder at en spiller på det
// sprog ser en rå nøgle eller EN-fallback i UI'et. Den tilstand må ikke nå main,
// og fejlbeskeden skal fortælle præcis hvad man gør ved det — ikke bare hvilke
// nøgler der er skæve.
//
// Derfor duplikeres symmetri-tjekket IKKE her:
//   · nøgler der kun findes i et ANDET sprog (og ikke i `en`) er key-coverage's
//     bord — det er en oprydningssag, ikke en manglende oversættelse.
//   · `__MISSING__` er tilladt (info) i key-coverage, men er en FEJL her: en
//     placeholder er præcis "ikke oversat endnu".
//
// Retningen er hele pointen på #4733: når et nyt sprog koster ~0 at vedligeholde,
// skal enhver feature-PR der tilføjer EN-strenge også levere oversættelserne —
// ellers vokser gælden pr. sprog i stedet for at gå mod nul.
//
// Brug:
//   node scripts/i18n-check-delta-pending.mjs
//
// CI: .github/workflows/i18n-check.yml, jobbet `delta-pending` (blokerende).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const LOCALES_DIR = join(ROOT, "frontend", "public", "locales");

export const SOURCE_LNG = "en";
export const PLACEHOLDER = "__MISSING__";

// `en-XA` er pseudo-locale: den genereres på runtime i frontend/src/i18n/index.js
// og har ingen filer på disk. Skulle den nogensinde få en mappe, må den aldrig
// tælle som et sprog der skal oversættes.
export const IGNORED_LNGS = new Set(["en-XA"]);

/**
 * Fladgør et locale-objekt til dot-paths → værdi.
 * Arrays behandles som blad-værdier (de er hele help-tabeller, ikke nøgle-træer).
 *
 * @param {unknown} obj
 * @param {string} [prefix]
 * @returns {Map<string, unknown>}
 */
export function flattenEntries(obj, prefix = "") {
  const out = new Map();
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      for (const [ck, cv] of flattenEntries(v, key)) out.set(ck, cv);
    } else {
      out.set(key, v);
    }
  }
  return out;
}

/**
 * Pure kerne: hvilke EN-nøgler er endnu ikke oversat i målsproget?
 *
 * Manglende = nøglen findes slet ikke, ELLER værdien er `__MISSING__`.
 * Nøgler der kun findes i målsproget ignoreres bevidst (key-coverage's bord).
 *
 * @param {object} sourceData  parset `en/<ns>.json`
 * @param {object|null} targetData  parset `<lng>/<ns>.json` (null = filen mangler)
 * @returns {string[]} sorterede dot-paths
 */
export function findPendingKeys(sourceData, targetData) {
  const source = flattenEntries(sourceData);
  const target = flattenEntries(targetData ?? {});
  const pending = [];
  for (const key of source.keys()) {
    if (!target.has(key) || target.get(key) === PLACEHOLDER) pending.push(key);
  }
  return pending.sort();
}

/**
 * Den ENE fejlbesked guarden findes for. Ordlyden er kontrakt — den peger på
 * kommandoen der løser problemet, ikke bare på symptomet.
 *
 * @param {string} lng
 * @param {string} ns
 * @param {string[]} keys
 * @returns {string}
 */
export function formatPendingMessage(lng, ns, keys) {
  return (
    `Manglende oversaettelser: ${keys.length} noegler i ${lng}/${ns}. ` +
    "Koer `infisical run --env=dev -- npm run i18n:translate` " +
    "(scripts/i18n-translate-delta.mjs, PR1 paa #4733) eller udfyld manuelt."
  );
}

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
  return readdirSync(join(LOCALES_DIR, lng))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function loadJSON(lng, ns) {
  return JSON.parse(readFileSync(join(LOCALES_DIR, lng, `${ns}.json`), "utf8"));
}

function main() {
  const lngs = listLngs();
  if (!lngs.includes(SOURCE_LNG)) {
    console.error(
      `[i18n-delta-pending] kildesproget "${SOURCE_LNG}" findes ikke i ${relative(ROOT, LOCALES_DIR)}`,
    );
    process.exit(1);
  }

  const targets = lngs.filter((l) => l !== SOURCE_LNG && !IGNORED_LNGS.has(l));
  if (targets.length === 0) {
    console.log("✓ i18n delta-pending OK — kun kildesproget findes, intet at oversætte");
    process.exit(0);
  }

  const namespaces = listNamespaces(SOURCE_LNG);
  const failures = [];
  let pendingTotal = 0;

  for (const lng of targets) {
    for (const ns of namespaces) {
      let sourceData;
      try {
        sourceData = loadJSON(SOURCE_LNG, ns);
      } catch (err) {
        failures.push(`[${SOURCE_LNG}/${ns}] kunne ikke læses: ${err.message}`);
        continue;
      }

      let targetData = null;
      try {
        targetData = loadJSON(lng, ns);
      } catch (err) {
        // Manglende fil = hele namespacet er uoversat. Ugyldig JSON er en anden
        // fejlklasse og skal sige hvad den er, ikke drukne i en nøgle-liste.
        if (err.code !== "ENOENT") {
          failures.push(`[${lng}/${ns}] ugyldig JSON: ${err.message}`);
          continue;
        }
      }

      const pending = findPendingKeys(sourceData, targetData);
      if (pending.length === 0) continue;

      pendingTotal += pending.length;
      const sample = pending.slice(0, 10).map((k) => `    · ${k}`).join("\n");
      const more = pending.length > 10 ? `\n    … og ${pending.length - 10} mere` : "";
      failures.push(`${formatPendingMessage(lng, ns, pending)}\n${sample}${more}`);
    }
  }

  if (failures.length === 0) {
    console.log(
      `✓ i18n delta-pending OK — ${SOURCE_LNG} → ${targets.join(", ")} fuldt oversat (${namespaces.length} namespaces)`,
    );
    process.exit(0);
  }

  for (const msg of failures) console.error(msg);
  console.error(`\n✗ i18n delta-pending FAILED — ${pendingTotal} uoversatte noegler`);
  process.exit(1);
}

// Samme main-guard som de øvrige i18n-guards: kør kun når filen er ENTRYPOINT,
// så testen kan importere de pure funktioner uden at scriptet exit'er processen.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
