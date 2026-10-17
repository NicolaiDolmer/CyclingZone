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
//   - en-CA og sv-SE (case-ufoelsomt): bruges kun som "YYYY-MM-DD"/ISO-trick til
//     tidszone-noegler (aldrig til visning), og er ens i alle sprog. Kun naar
//     kaldet giver en fuld numerisk dato-noegle: rene tidsformatere (timeStyle,
//     hour/minute uden dato), delvise datoer og tekstuelle dele fanges (#6797).
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

// Kanonisk form af en locale-tag: sprog med smaa, region med store bogstaver
// ("en-gb" og "EN-GB" bliver begge til "en-GB"). #6797: Intl accepterer alle
// skrivemaader, saa guarden maa ikke afhaenge af at kilden staar kanonisk.
export function canonicalLocaleTag(tag) {
  const [lang, region] = String(tag).split("-");
  return region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase();
}

// Dato-felter og tids-felter i en options-literal. Kun literalen i selve kaldet
// kan ses; en options-variabel (`DateTimeFormat("en-CA", opts)`) kan guarden
// ikke laese og behandles som standard-datoform.
const DATE_FIELD = /\b(?:year|month|day)\s*:/;
const TIME_FIELD = /\b(?:hour|minute|second|fractionalSecondDigits)\s*:/;
const NUMERIC_FIELD = (name) =>
  new RegExp(String.raw`\b${name}\s*:\s*["'\x60](?:numeric|2-digit)["'\x60]`);

// #6785 + #6797 (Codex): "en-CA"/"sv-SE" er kun et ISO-noegle-trick (YYYY-MM-DD),
// naar kaldet er et DATO-kald der giver en fuld numerisk dato-noegle.
// Maanedsnavne, ugedage, klokkeslaet-tekst, rene tidsformatere (timeStyle eller
// hour/minute uden dato), delvise datoer (kun aar, kun dag ...) og talformatering
// med disse locales er visning og fanges.
export function isIsoKeyUse(line) {
  if (/\bNumberFormat\(|\btoLocaleTimeString\(/.test(line)) return false;
  // toLocaleString er kun et dato-trick, naar kaldet baerer tidszone/dato-felter
  // (sv-SE + timeZone giver "YYYY-MM-DD HH:mm:ss"); uden dem er det talformatering.
  const isDateCall = /\btoLocaleDateString\(|\bDateTimeFormat\(/.test(line)
    || (/\btoLocaleString\(/.test(line) && /[{,]\s*(?:timeZone|year|hour)\b/.test(line));
  if (!isDateCall) return false;
  if (/\b(?:month|weekday|era|dayPeriod|timeZoneName)\s*:\s*["'\x60](?:long|short|narrow)["'\x60]/.test(line)) return false;
  if (/\bdateStyle\s*:\s*["'\x60](?:full|long|medium)["'\x60]/.test(line)) return false;
  // timeStyle er altid klokkeslaet-visning, ogsaa sammen med dateStyle.
  if (/\btimeStyle\s*:/.test(line)) return false;
  const hasDate = DATE_FIELD.test(line);
  // hour/minute/second uden dato-felter giver et rent klokkeslaet.
  if (TIME_FIELD.test(line) && !hasDate) return false;
  // Eksplicitte dato-felter: hele noeglen (aar + maaned + dag) skal vaere numerisk.
  // Uden dato-felter er standardformen allerede den fulde numeriske dato.
  if (hasDate && !["year", "month", "day"].every((f) => NUMERIC_FIELD(f).test(line))) return false;
  return true;
}

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

// #6797: region/sprog kan staa i vilkaarlig case ("en-gb", "EN-GB"); Intl
// accepterer dem alle.
const LOCALE_TAG = String.raw`[a-zA-Z]{2,3}-[a-zA-Z]{2}`;
const INTL_CALL = /(?:toLocale(?:String|DateString|TimeString)|Intl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|PluralRules|ListFormat|DisplayNames))\(/;

// Teksten fra en Intl-/toLocale-kalds aabne parentes til den matchende lukkende
// (maks. 1500 tegn, streng-literaler springes over). Giver ISO-tjekket hele
// kaldet inkl. options paa efterfoelgende linjer. Ikke afsluttet -> null.
export function callSpan(code, callStart, openParenIdx) {
  let depth = 0;
  let quote = null;
  const limit = Math.min(code.length, openParenIdx + 1500);
  for (let i = openParenIdx; i < limit; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return code.slice(callStart, i + 1);
  }
  return null;
}

// Kaldet (inkl. options, ogsaa over flere linjer) som en locale-literal paa
// position `literalIdx` i `code` er argument til: det naermeste Intl-/toLocale-
// kald foer literalen paa samme linje. Ingen -> null (ternary/fallback).
function enclosingCall(code, lineStart, literalIdx) {
  const lineEnd = code.indexOf("\n", lineStart);
  const head = code.slice(lineStart, literalIdx);
  let last = null;
  for (const m of head.matchAll(new RegExp(INTL_CALL.source, "g"))) last = m;
  if (!last) return null;
  const callStart = lineStart + last.index;
  const open = callStart + last[0].length - 1;
  const span = callSpan(code, callStart, open);
  if (span === null) return code.slice(callStart, lineEnd === -1 ? code.length : lineEnd);
  // Et allerede lukket kald, som literalen ikke hoerer til: brug hele linjen.
  return callStart + span.length > literalIdx ? span : null;
}

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
    test(line, ctx) {
      // 1) Region-locale-literal ("da-DK") i et Intl-/toLocale-kald, i en
      //    ternary (`? "da-DK" :`) eller som fallback (`|| "da-DK"`). Selve
      //    sprogkoden som konstant ("en-XA") og prosa i data er ikke formatering.
      const usesLocale = INTL_CALL.test(line) || TERNARY_OR_FALLBACK.test(line);
      for (const m of usesLocale ? line.matchAll(new RegExp(String.raw`["'\x60](${LOCALE_TAG})["'\x60]`, "g")) : []) {
        // Kaldet inkl. options paa efterfoelgende linjer (#6797); uden kontekst
        // eller uden omsluttende kald (ternary/fallback) ses kun linjen.
        let call = null;
        if (ctx) {
          const literalIdx = ctx.lineStart + m.index;
          call = enclosingCall(ctx.code, ctx.lineStart, literalIdx);
        }
        // Normaliseres foer ISO-tjekket: "en-ca" er det samme trick som "en-CA".
        if (!(ISO_TRICK_LOCALES.has(canonicalLocaleTag(m[1])) && isIsoKeyUse(call ?? line))) return `fast locale "${m[1]}"`;
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
  const code = stripComments(src.replace(/\r\n/g, "\n"));
  const lines = code.split("\n");
  let lineStart = 0;
  for (let i = 0; i < lines.length; lineStart += lines[i].length + 1, i++) {
    const text = lines[i];
    if (!text.trim()) continue;
    for (const rule of RULES) {
      const why = rule.test(text, { code, lineStart });
      if (why) {
        findings.push({ line: i + 1, rule: rule.id, why, text: text.trim().slice(0, 140) });
        break; // en linje taeller kun een gang, som i leak-guarden
      }
    }
  }
  // Flerlinjede kald: `new Intl.NumberFormat(\n  "da-DK",\n)`. Linjerne ses
  // hver for sig ovenfor og rammer ikke; her ses kaldet og literalen sammen.
  const multiline = new RegExp(
    String.raw`(${INTL_CALL.source})\s*\n\s*["'\x60]([a-zA-Z]{2,3}(?:-[a-zA-Z]{2})?)["'\x60]`,
    "g",
  );
  for (const m of code.matchAll(multiline)) {
    // Hele kaldet (options kan staa paa senere linjer), ikke kun frem til literalen.
    const call = callSpan(code, m.index, m.index + m[1].length - 1) ?? m[0];
    if (ISO_TRICK_LOCALES.has(canonicalLocaleTag(m[2])) && isIsoKeyUse(call)) continue;
    const line = code.slice(0, m.index).split("\n").length;
    if (findings.some((f) => f.line === line)) continue;
    findings.push({
      line,
      rule: "locale-literal",
      why: `fast locale "${m[2]}" paa naeste linje`,
      text: lines[line - 1].trim().slice(0, 140),
    });
  }
  return findings.sort((a, b) => a.line - b.line);
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

// #6785 (Codex): fingeraftryk pr. fund (regel + normaliseret linje, ikke
// linjenummer), saa et nyt fund i en fil med kendte fund opdages, selvom
// antallet er uaendret.
export function fingerprintOf(finding) {
  return `${finding.rule}|${String(finding.text ?? "").replace(/\s+/g, " ").trim()}`;
}

export function fingerprintsOf(findingsByFile) {
  return Object.fromEntries(
    Object.entries(findingsByFile)
      .map(([file, list]) => [file, list.map(fingerprintOf).sort()])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

// Multisaet-sammenligning: et fingeraftryk der optraeder flere gange end i
// baselinen er nyt. Baseline-vaerdier der stadig er tal (gammelt format)
// sammenlignes paa antal.
export function compareFingerprints(findingsByFile, baselineFiles) {
  const grown = [];
  const stale = [];
  const files = new Set([...Object.keys(findingsByFile), ...Object.keys(baselineFiles)]);
  for (const file of [...files].sort()) {
    const current = (findingsByFile[file] || []).map(fingerprintOf);
    const base = baselineFiles[file];
    if (typeof base === "number" || base == null) {
      const allowed = base ?? 0;
      if (current.length > allowed) grown.push({ file, count: current.length, allowed, fresh: current });
      else if (current.length < allowed) stale.push({ file, current: current.length, allowed });
      continue;
    }
    const left = new Map();
    for (const fp of base) left.set(fp, (left.get(fp) || 0) + 1);
    const fresh = [];
    for (const fp of current) {
      const n = left.get(fp) || 0;
      if (n > 0) left.set(fp, n - 1);
      else fresh.push(fp);
    }
    const remaining = [...left.values()].reduce((a, b) => a + b, 0);
    if (fresh.length) grown.push({ file, count: current.length, allowed: base.length, fresh });
    else if (remaining > 0) stale.push({ file, current: current.length, allowed: base.length });
  }
  return { grown, stale };
}

export function totalOf(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function buildBaseline(findingsByFile) {
  const fingerprints = fingerprintsOf(findingsByFile);
  return {
    $comment:
      "Kendte hardcodede format-fund (ratchet, maa kun skrumpe). Genereret af scripts/i18n-check-hardcoded-formats.mjs --update-baseline. Refs #6785. Nye fund maa IKKE tilfoejes her: fix dem via lib/intl.js eller lib/intlLocale.ts.",
    total: Object.values(fingerprints).reduce((n, list) => n + list.length, 0),
    files: fingerprints,
  };
}

function main() {
  const updateBaseline = process.argv.includes("--update-baseline");
  const findingsByFile = scanFrontend();
  const counts = countsOf(findingsByFile);

  if (updateBaseline) {
    const baseline = buildBaseline(findingsByFile);
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(
      `Baseline skrevet til scripts/i18n-hardcoded-formats-baseline.json (${Object.keys(counts).length} filer, ${baseline.total} fund).`,
    );
    return;
  }

  let baseline = { total: 0, files: {} };
  if (existsSync(BASELINE_PATH)) baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const baselineFiles = baseline.files || {};

  const { grown, stale } = compareFingerprints(findingsByFile, baselineFiles);
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
      console.error(`\n   ${g.file}: ${g.count} fund, baseline tillader ${g.allowed} (nye: ${g.fresh.length})`);
      const freshSet = new Set(g.fresh);
      for (const f of findingsByFile[g.file].filter((x) => freshSet.has(fingerprintOf(x)))) {
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

  const baselineTotal = Object.values(baselineFiles).reduce((n, v) => n + (typeof v === "number" ? v : v.length), 0);
  console.log(
    `i18n format-guard: ingen nye hardcodede formater (${total} kendte fund i ${Object.keys(counts).length} filer, baseline ${baselineTotal}).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

