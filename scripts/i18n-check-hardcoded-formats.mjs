#!/usr/bin/env node
// i18n format-guard, Refs #6785 (sprogfundamentet foer fr/es/nl).
//
// Tal, valuta, datoer og klokkeslaet skal formateres efter spillerens aktive
// sprog via Intl (frontend/src/lib/intl.js og lib/intlLocale.ts). Et fast
// "da-DK" eller en haandskrevet "toFixed(1)%" giver en fransk, spansk eller
// hollandsk spiller dansk eller engelsk skriftbillede.
//
// Fem moenstre, talt som linjer pr. fil i spillervendt frontend-kode:
//
//   locale-literal  Fast Intl-locale ("da-DK", "en-GB", "en-US", "de-DE" ...)
//                   som argument til toLocale*String / Intl.* eller i en
//                   da/en-ternary. Brug intlLocale(language) eller formatNumber/
//                   formatDate/formatCurrency fra lib/intl.js.
//   locale-default  toLocale*String() uden argument: arver browserens sprog i
//                   stedet for appens.
//   thousands-regex Haandskrevet tusindtalsseparator ((?=(\d{3})+ ...).
//   decimal-comma   toFixed(n).replace(".", ","): haandskrevet decimalkomma.
//   percent-toFixed toFixed(n) lige foer et %-tegn: haandskrevet procent.
//
// BASELINE-RATCHET: kendte fund ligger i scripts/i18n-hardcoded-formats-baseline.json
// (antal linjer pr. fil). Guarden fejler KUN naar en fil faar flere fund end
// baselinen, eller en ny fil dukker op. Rettelser fejler aldrig; de rapporteres
// som "stale baseline" og strammes med:
//
//   node scripts/i18n-check-hardcoded-formats.mjs --update-baseline
//
// Baselinen maa kun skrumpe. Nye fund fixes, de lægges ikke i baselinen.
//
// UNDTAGET (bevidst politik, ikke gaeld):
//   - tests, preview-seed, og admin-flader (dansk by design, samme politik som
//     i18n-check-leaks.mjs: ingen spiller ser dem).
//   - lib/intl.js og lib/intlLocale.ts: de to filer er DER locale-valget bor.
//   - en-CA og sv-SE: bruges kun som "YYYY-MM-DD"/ISO-trick til tidszone-noegler
//     (aldrig til visning), og er ens i alle sprog.
//
// Brug:
//   node scripts/i18n-check-hardcoded-formats.mjs                    # check (CI)
//   node scripts/i18n-check-hardcoded-formats.mjs --update-baseline  # regenerer baseline

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC_DIR = join(ROOT, "frontend", "src");
const BASELINE_PATH = join(ROOT, "scripts", "i18n-hardcoded-formats-baseline.json");

// Filer hvor locale-valget bor. Alt andet skal gaa gennem dem.
export const FORMATTER_FILES = new Set([
  "frontend/src/lib/intl.js",
  "frontend/src/lib/intlLocale.ts",
]);

// Locales der kun bruges til at faa ISO-formen "YYYY-MM-DD" ud af Intl i en
// given tidszone. De vises aldrig for en spiller.
export const ISO_TRICK_LOCALES = new Set(["en-CA", "sv-SE"]);

const SCAN_EXT = /\.(jsx?|tsx?|mjs)$/;
const TEST_FILE = /\.(test|shots|spec)\.(jsx?|tsx?|mjs)$/;

// En sti er admin/preview naar et mappenavn er admin/preview, eller filnavnet
// begynder paa Admin/admin. (AdminEconomyTab.jsx, pages/admin/*, components/admin/*)
export function isExemptPath(rel) {
  const parts = rel.split("/");
  const file = parts[parts.length - 1];
  if (parts.slice(0, -1).some((p) => p === "admin" || p === "preview")) return true;
  if (/^[Aa]dmin/.test(file)) return true;
  if (/Admin[A-Z.]/.test(file)) return true;
  return false;
}

export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const LOCALE_TAG = String.raw`[a-z]{2,3}-[A-Z]{2}`;
const INTL_CALL = /(?:toLocale(?:String|DateString|TimeString)|Intl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|PluralRules|ListFormat|DisplayNames))\(/;

const TERNARY_OR_FALLBACK = new RegExp(
  String.raw`(?:\?\s*|\|\||\?\?)\s*["'\x60]${LOCALE_TAG}["'\x60]`,
);

// Linjer hvor toFixed bygger SVG-geometri (koordinater, stier, punktlister).
const GEOMETRY_LINE = new RegExp(
  [
    String.raw`\b(?:x|y|cx|cy|x1|x2|y1|y2|r|width|height)=\{`,
    String.raw`\bpoints\b`,
    String.raw`[ML]\$\{`,
    String.raw`\.join\(" "\)`,
    String.raw`\b(?:xAt|yAt|xProj|ptsOf|radiusFor|xFirst|xLast|toPath)\b`,
    String.raw`\bMath\.(?:cos|sin)\b`,
    String.raw`toFixed\(\d\)\},\$\{`,
    String.raw`\bconst (?:xFirst|xLast)\b`,
    // `+(i * step).toFixed(3)`: afrunding til tal, ikke visning.
    String.raw`[\s,(=]\+\([^()]*\)\.toFixed`,
    // Sti-streng i skabelon: `L100,${...}`.
    String.raw`\x60[ML]\d`,
    String.raw`\b(?:x|y):\s*\(?[A-Za-z0-9_ +*.\-()]*toFixed`,
  ].join("|"),
);

// Hver regel faar en kodelinje (kommentarer fjernet) og svarer med en navngiven
// forklaring, eller null.
export const RULES = [
  {
    id: "locale-literal",
    test(line) {
      // 1) Region-locale-literal ("da-DK") i et Intl-/toLocale-kald, i en
      //    ternary (`? "da-DK" :`) eller som fallback (`|| "da-DK"`). Selve
      //    sprogkoden som konstant ("en-XA") og prosa i data er ikke formatering.
      const usesLocale = INTL_CALL.test(line) || TERNARY_OR_FALLBACK.test(line);
      for (const m of usesLocale ? line.matchAll(new RegExp(String.raw`["'\x60](${LOCALE_TAG})["'\x60]`, "g")) : []) {
        if (!ISO_TRICK_LOCALES.has(m[1])) return `fast locale "${m[1]}"`;
      }
      // 2) Bar sprogkode som foerste argument ("da", "en") til en Intl-/toLocale-kald.
      const bare = line.match(new RegExp(String.raw`${INTL_CALL.source}\s*["'\x60]([a-z]{2,3})["'\x60]`));
      if (bare) return `fast sprogkode "${bare[1]}"`;
      return null;
    },
  },
  {
    id: "locale-default",
    test(line) {
      return /\btoLocale(?:String|DateString|TimeString)\(\s*\)/.test(line)
        ? "toLocale*String() uden locale arver browserens sprog"
        : null;
    },
  },
  {
    id: "thousands-regex",
    test(line) {
      return /\(\?=\(\\d\{3\}\)/.test(line) ? "haandskrevet tusindtalsseparator" : null;
    },
  },
  {
    id: "decimal-comma",
    test(line) {
      return /toFixed\([^)]*\)\s*\.replace\(\s*(?:"\."|'\.'|\/\\\.\/g?)\s*,\s*["'],["']/.test(line)
        ? "toFixed(...).replace('.', ',') er en haandskrevet decimalkomma"
        : null;
    },
  },
  {
    id: "percent-toFixed",
    test(line) {
      return /toFixed\(\s*\d*\s*\)\s*\}?\s*(?:\+\s*)?["'\x60]?\s*%/.test(line)
        ? "toFixed(...) efterfulgt af % er haandskrevet procent"
        : null;
    },
  },
  {
    id: "display-toFixed",
    test(line) {
      // toFixed giver altid decimalpunktum. Til SVG-geometri er det rigtigt
      // (koordinater er ikke sprog), saa kun linjer der ikke ligner geometri
      // taeller: tekst, t()-parametre, labels. Heuristik, ikke bevis; derfor
      // staar de eksisterende fund i baselinen og kan kun blive faerre.
      if (!/\.toFixed\(/.test(line)) return null;
      if (GEOMETRY_LINE.test(line)) return null;
      return "toFixed(...) giver altid decimalpunktum, brug formatNumber med minimumFractionDigits";
    },
  },
];

// Returnerer [{ line, rule, why, text }] for en kildefil.
export function scanSource(src, rel = "") {
  if (FORMATTER_FILES.has(rel)) return [];
  const findings = [];
  const lines = stripComments(src).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (!text.trim()) continue;
    for (const rule of RULES) {
      const why = rule.test(text);
      if (why) {
        findings.push({ line: i + 1, rule: rule.id, why, text: text.trim().slice(0, 140) });
        break; // en linje taeller kun een gang, som i leak-guarden
      }
    }
  }
  return findings;
}

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === "node_modules") continue;
      walk(p, out);
    } else if (SCAN_EXT.test(f) && !TEST_FILE.test(f)) {
      out.push(p);
    }
  }
  return out;
}

// { "frontend/src/..": [findings] } kun for filer med fund.
export function scanFrontend(srcDir = SRC_DIR, root = ROOT) {
  const result = {};
  for (const file of walk(srcDir)) {
    const rel = relative(root, file).replaceAll("\\", "/");
    if (isExemptPath(rel)) continue;
    const findings = scanSource(readFileSync(file, "utf8"), rel);
    if (findings.length) result[rel] = findings;
  }
  return result;
}

export function countsOf(findingsByFile) {
  return Object.fromEntries(
    Object.entries(findingsByFile)
      .map(([file, list]) => [file, list.length])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

// Ratchet: tael maa ikke vokse pr. fil, og en fil uden baseline-entry tillader 0.
export function compareAgainstBaseline(counts, baselineFiles) {
  const grown = [];
  const stale = [];
  for (const [file, count] of Object.entries(counts)) {
    const allowed = baselineFiles[file] ?? 0;
    if (count > allowed) grown.push({ file, count, allowed });
  }
  for (const [file, allowed] of Object.entries(baselineFiles)) {
    const current = counts[file] ?? 0;
    if (current < allowed) stale.push({ file, current, allowed });
  }
  return { grown, stale };
}

export function totalOf(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function buildBaseline(counts) {
  return {
    $comment:
      "Kendte hardcodede format-fund (ratchet, maa kun skrumpe). Genereret af scripts/i18n-check-hardcoded-formats.mjs --update-baseline. Refs #6785. Nye fund maa IKKE tilfoejes her: fix dem via lib/intl.js eller lib/intlLocale.ts.",
    total: totalOf(counts),
    files: counts,
  };
}

function main() {
  const updateBaseline = process.argv.includes("--update-baseline");
  const findingsByFile = scanFrontend();
  const counts = countsOf(findingsByFile);

  if (updateBaseline) {
    const baseline = buildBaseline(counts);
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(
      `Baseline skrevet til scripts/i18n-hardcoded-formats-baseline.json (${Object.keys(counts).length} filer, ${baseline.total} fund).`,
    );
    return;
  }

  let baseline = { total: 0, files: {} };
  if (existsSync(BASELINE_PATH)) baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const baselineFiles = baseline.files || {};

  const { grown, stale } = compareAgainstBaseline(counts, baselineFiles);
  const total = totalOf(counts);

  if (stale.length) {
    console.log(
      `\n${stale.length} baseline-entr${stale.length === 1 ? "y" : "ies"} er helt eller delvist rettet. Stram ratchet'en i en dedikeret commit:`,
    );
    for (const s of stale) console.log(`   - ${s.file}: ${s.current}/${s.allowed} tilbage`);
    console.log("   -> node scripts/i18n-check-hardcoded-formats.mjs --update-baseline");
  }

  if (grown.length) {
    console.error(`\nNYE hardcodede format-fund i ${grown.length} fil(er) (baseline maa kun skrumpe):`);
    for (const g of grown) {
      console.error(`\n   ${g.file}: ${g.count} fund, baseline tillader ${g.allowed}`);
      for (const f of findingsByFile[g.file]) {
        console.error(`     linje ${f.line} [${f.rule}] ${f.why}\n       ${f.text}`);
      }
    }
    console.error(`
Fix:
  - Tal/valuta/dato: formatNumber, formatCurrency, formatDate, formatDateTime fra lib/intl.js.
  - Intl-locale til en lokal formatter: intlLocale(language) fra lib/intlLocale.ts.
  - Fast 24-timers klokkeslaet i spillets tidszone: formatClock24(date, timeZone).
  - Admin-flade? Admin-filer (admin/-mapper, Admin*-filnavne) er undtaget.
Baselinen maa IKKE udvides (ratchet, Refs #6785).`);
    process.exit(1);
  }

  const baselineTotal = totalOf(baselineFiles);
  console.log(
    `i18n format-guard: ingen nye hardcodede formater (${total} kendte fund i ${Object.keys(counts).length} filer, baseline ${baselineTotal}).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

