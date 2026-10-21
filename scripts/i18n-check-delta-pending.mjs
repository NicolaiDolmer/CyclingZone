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
// Kun sprog registreret i frontend/src/i18n/languages.js er maalsprog. En
// uregistreret locale-mappe er work in progress og springes over (meldt som
// info), praecis som i18n-check-keys.mjs og i18n-check-key-parity.mjs (#6806).
//
// Brug:
//   node scripts/i18n-check-delta-pending.mjs [--root <dir>]
//
// CI: .github/workflows/i18n-check.yml, jobbet `delta-pending` (blokerende).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PSEUDO_LANG, registeredLanguages } from "./i18n-check-key-parity.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

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

/**
 * Hvilke locale-mapper er maalsprog? Kun sprog registreret i
 * frontend/src/i18n/languages.js. En uregistreret mappe er work in progress
 * (samme filter som i18n-check-keys.mjs og i18n-check-key-parity.mjs, #6806):
 * den maa ikke blokere delta-pending eller check:i18n, men meldes som info.
 *
 * @param {string[]} dirs  locale-mapper paa disk
 * @param {Iterable<string>} registered  koder fra languages.js
 * @returns {{ targets: string[], skipped: string[] }}
 */
export function selectTargetLngs(dirs, registered) {
  const reg = new Set(registered);
  const candidates = dirs.filter((l) => l !== SOURCE_LNG && !IGNORED_LNGS.has(l) && l !== PSEUDO_LANG);
  return {
    targets: candidates.filter((l) => reg.has(l)),
    skipped: candidates.filter((l) => !reg.has(l)),
  };
}

function listLngs(localesDir) {
  return readdirSync(localesDir).filter((name) => {
    try {
      return statSync(join(localesDir, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

function listNamespaces(localesDir, lng) {
  return readdirSync(join(localesDir, lng))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function loadJSON(localesDir, lng, ns) {
  return JSON.parse(readFileSync(join(localesDir, lng, `${ns}.json`), "utf8"));
}

/**
 * Koer hele guarden mod et repo-root. Returnerer i stedet for at exit'e, saa
 * testen kan koere den mod en midlertidig mappe.
 *
 * @param {{ root?: string }} [opts]
 * @returns {{ ok: boolean, fatal?: string, failures: string[], info: string[],
 *             pendingTotal: number, targets: string[], skipped: string[], namespaces: string[] }}
 */
export function runDeltaPending({ root = ROOT } = {}) {
  const localesDir = join(root, "frontend", "public", "locales");
  const out = { ok: true, failures: [], info: [], pendingTotal: 0, targets: [], skipped: [], namespaces: [] };

  const lngs = listLngs(localesDir);
  if (!lngs.includes(SOURCE_LNG)) {
    out.ok = false;
    out.fatal = `[i18n-delta-pending] kildesproget "${SOURCE_LNG}" findes ikke i ${relative(root, localesDir)}`;
    return out;
  }

  const registered = registeredLanguages(
    readFileSync(join(root, "frontend", "src", "i18n", "languages.js"), "utf8"),
  );
  const { targets, skipped } = selectTargetLngs(lngs, registered);
  out.targets = targets;
  out.skipped = skipped;
  if (skipped.length > 0) {
    out.info.push(
      `i18n delta-pending: springer uregistrerede locale-mapper over (work in progress): ${skipped.join(", ")}`,
    );
  }
  if (targets.length === 0) return out;

  const namespaces = listNamespaces(localesDir, SOURCE_LNG);
  out.namespaces = namespaces;

  for (const lng of targets) {
    for (const ns of namespaces) {
      let sourceData;
      try {
        sourceData = loadJSON(localesDir, SOURCE_LNG, ns);
      } catch (err) {
        out.failures.push(`[${SOURCE_LNG}/${ns}] kunne ikke læses: ${err.message}`);
        continue;
      }

      let targetData = null;
      try {
        targetData = loadJSON(localesDir, lng, ns);
      } catch (err) {
        // Manglende fil = hele namespacet er uoversat. Ugyldig JSON er en anden
        // fejlklasse og skal sige hvad den er, ikke drukne i en nøgle-liste.
        if (err.code !== "ENOENT") {
          out.failures.push(`[${lng}/${ns}] ugyldig JSON: ${err.message}`);
          continue;
        }
      }

      const pending = findPendingKeys(sourceData, targetData);
      if (pending.length === 0) continue;

      out.pendingTotal += pending.length;
      const sample = pending.slice(0, 10).map((k) => `    · ${k}`).join("\n");
      const more = pending.length > 10 ? `\n    … og ${pending.length - 10} mere` : "";
      out.failures.push(`${formatPendingMessage(lng, ns, pending)}\n${sample}${more}`);
    }
  }

  out.ok = out.failures.length === 0;
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf("--root");
  const root = rootIdx >= 0 ? resolve(args[rootIdx + 1]) : ROOT;
  const r = runDeltaPending({ root });

  if (r.fatal) {
    console.error(r.fatal);
    process.exit(1);
  }
  for (const line of r.info) console.log(line);

  if (r.targets.length === 0) {
    console.log("✓ i18n delta-pending OK — ingen registrerede målsprog ud over kildesproget, intet at oversætte");
    process.exit(0);
  }

  if (r.ok) {
    console.log(
      `✓ i18n delta-pending OK — ${SOURCE_LNG} → ${r.targets.join(", ")} fuldt oversat (${r.namespaces.length} namespaces)`,
    );
    process.exit(0);
  }

  for (const msg of r.failures) console.error(msg);
  console.error(`\n✗ i18n delta-pending FAILED — ${r.pendingTotal} uoversatte noegler`);
  process.exit(1);
}

// Samme main-guard som de øvrige i18n-guards: kør kun når filen er ENTRYPOINT,
// så testen kan importere de pure funktioner uden at scriptet exit'er processen.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
