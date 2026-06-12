#!/usr/bin/env node
// i18n leak-guard — Refs #1068 (#678 follow-up).
//
// Fanger de to leak-mønstre som key-coverage IKKE ser (#678 fandt 52 EN-mode
// leaks mens i18n-check-keys var grøn):
//
//   A. DA-tekst der overlever i EN-locale-VÆRDIER
//      (frontend/public/locales/en/*.json):
//      - værdi indeholder æ/ø/å                                → HARD FAIL
//      - værdi indeholder utvetydige danske stopord            → HARD FAIL
//      - værdi === da-værdien for samme nøgle OG er natursprog → ADVISORY
//        (kun info — 42 nuværende identiske værdier er ALLE legitime delte
//        termer: race-navne, brand-termer, "Hall of Fame" osv. En hard gate
//        her ville vælte legitime locale-PR'er.)
//
//   B. Hardcodede danske strenge i player-facing kode:
//      - frontend/src/** (minus lib/ + components/, som i18n-check-lib-strings
//        allerede dækker): enhver ikke-kommentar-linje med æ/ø/å — fanger både
//        string-literals OG JSX-tekstnoder/props.
//      - backend/routes/** + backend/lib/**: danske string-literals på linjer
//        med error/message/.json(/throw/reason-kontekst (API-svar der
//        renderes ordret i UI'et — { error: "<dansk>" }-mønstret fra #1053).
//
// BASELINE-RATCHET (kritisk for parallelle i18n-fix-bølger):
//   Kendte leaks ligger i scripts/i18n-leaks-baseline.json. Guarden fejler KUN
//   på NYE leaks (nye locale-nøgler / filer med flere leak-linjer end
//   baseline). Fixes der FJERNER leaks fejler aldrig — de rapporteres som
//   "stale baseline" med opfordring til at stramme via:
//
//     node scripts/i18n-check-leaks.mjs --update-baseline
//
//   Stram baselinen i en dedikeret commit/PR når kendte leaks er konverteret.
//   Baselinen er en ratchet: den må kun skrumpe.
//
// ALLOWLIST: legitimt-danske værdier/filer tilføjes med begrundelse i
// LOCALE_ALLOWLIST / EXEMPT_DIRS / EXEMPT_FILES nedenfor — IKKE i baselinen
// (baseline = teknisk gæld der skal væk; allowlist = bevidst policy).
//
// Brug:
//   node scripts/i18n-check-leaks.mjs                    # check (CI + pre-commit)
//   node scripts/i18n-check-leaks.mjs --update-baseline  # regenerér baseline
//
// Evt. ekstra args (fil-stier fra lint-staged) ignoreres — scannen er altid
// fuld-repo så resultatet er deterministisk uanset hvilke filer der er staged.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "scripts", "i18n-leaks-baseline.json");
const EN_DIR = join(ROOT, "frontend", "public", "locales", "en");
const DA_DIR = join(ROOT, "frontend", "public", "locales", "da");

export const DANISH_CHARS = /[æøåÆØÅ]/;

// Utvetydigt danske ord der IKKE er engelske ord. Bevidst udeladt pga.
// EN-homografer: "hold" (Hold to confirm), "tag" (HTML tag), "gem" (jewel),
// "op" (co-op), "ny" (NY = New York), "alle"/"ingen" (kan være navne).
export const DANISH_STOPWORDS = new RegExp(
  "\\b(" +
    [
      "og", "ikke", "din", "dit", "dine", "eller", "hvis", "skal",
      "denne", "dette", "disse", "bliver", "blev", "allerede", "endnu",
      "rytter", "ryttere", "holdet", "siden", "udgave", "mangler", "vises",
      "fjern", "luk", "hent", "indtast", "opret", "slet", "annuller",
      "gentag", "afvis", "godkend", "ugyldig", "ukendt", "lykkedes",
      "mislykkedes", "oprettet", "slettet", "sendt",
    ].join("|") +
    ")\\b",
  "i"
);

// Locale-nøgler ("<fil>.json::<flad.nøgle>") der LEGITIMT må ramme detektor A.
// Tilføj med begrundelse. (Tom pt. — æ/ø/å- og stopords-detektorerne har nul
// hits på main efter #678 Track 1-4.)
export const LOCALE_ALLOWLIST = new Map([
  // ["common.json::some.key", "Begrundelse"],
]);

// Kode-mapper/filer der LEGITIMT indeholder dansk (samme policy som
// i18n-check-lib-strings/page-untranslated — admin-flader er ikke
// player-facing; dual-page privacy og PatchNotes-data er bevidst dansk).
export const EXEMPT_DIRS = [
  "frontend/src/pages/admin", // Admin-only tabs bag admin-guard — ikke player-facing.
];
export const EXEMPT_FILES = new Map([
  ["frontend/src/pages/AdminSprintMetricsPage.jsx", "Admin-only intern metrics-side."],
  ["frontend/src/pages/AdminWaitlistPage.jsx", "Admin-only waitlist-værktøj."],
  ["frontend/src/pages/PatchNotesPage.jsx", "Patch notes er bilingual i-side data (EN+DA pr. entry) — DA-strenge er by design."],
  ["frontend/src/pages/PrivacyPolicyPage.jsx", "DA-udgaven i dual-page-mønster (PrivacyPolicyPageEn.jsx er EN)."],
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// Natursprog-heuristik for identisk-EN/DA-detektoren: ≥2 "rigtige" ord efter
// at ICU-placeholders ({{var}}/{var}) er strippet.
export function isNaturalLanguage(value) {
  const stripped = value.replace(/\{\{?[^}]*\}?\}/g, " ");
  const words = stripped.split(/\s+/).filter((w) => /[a-zA-ZæøåÆØÅ]{2,}/.test(w));
  return words.length >= 2;
}

function walk(dir, out = [], skipDirs = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const rel = relative(ROOT, p).replaceAll("\\", "/");
    if (statSync(p).isDirectory()) {
      if (!skipDirs.includes(rel)) walk(p, out, skipDirs);
    } else if (/\.(jsx?|mjs)$/.test(f) && !/\.test\.(jsx?|mjs)$/.test(f)) {
      out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Detektor A — DA-i-EN-locale-værdier
// ---------------------------------------------------------------------------

export function scanLocales({ enDir = EN_DIR, daDir = DA_DIR } = {}) {
  const leaks = []; // { id, kind, value } — hard-fail-kandidater
  const advisories = []; // identiske EN/DA-natursprogsværdier — kun info
  for (const file of readdirSync(enDir).filter((f) => f.endsWith(".json"))) {
    const en = flatten(JSON.parse(readFileSync(join(enDir, file), "utf8")));
    let da = {};
    const daPath = join(daDir, file);
    if (existsSync(daPath)) {
      da = flatten(JSON.parse(readFileSync(daPath, "utf8")));
    }
    for (const [key, value] of Object.entries(en)) {
      const id = `${file}::${key}`;
      if (LOCALE_ALLOWLIST.has(id)) continue;
      if (DANISH_CHARS.test(value)) {
        leaks.push({ id, kind: "æ/ø/å", value });
      } else if (DANISH_STOPWORDS.test(value)) {
        leaks.push({ id, kind: `stopord "${value.match(DANISH_STOPWORDS)[1]}"`, value });
      } else if (da[key] !== undefined && da[key] === value && isNaturalLanguage(value)) {
        advisories.push({ id, value });
      }
    }
  }
  return { leaks, advisories };
}

// ---------------------------------------------------------------------------
// Detektor B1 — hardcodet dansk i frontend-kode (minus lib/ + components/)
// ---------------------------------------------------------------------------

export function countDanishLines(src) {
  let count = 0;
  for (const line of stripComments(src).split("\n")) {
    if (DANISH_CHARS.test(line)) count++;
  }
  return count;
}

function scanFrontend() {
  const skipDirs = ["frontend/src/lib", "frontend/src/components"]; // i18n-check-lib-strings' domæne
  const files = walk(join(ROOT, "frontend", "src"), [], skipDirs);
  const counts = {};
  for (const file of files) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (EXEMPT_DIRS.some((d) => rel.startsWith(d + "/"))) continue;
    if (EXEMPT_FILES.has(rel)) continue;
    const n = countDanishLines(readFileSync(file, "utf8"));
    if (n > 0) counts[rel] = n;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Detektor B2 — danske API-svar-strenge i backend/routes + backend/lib
// ---------------------------------------------------------------------------

const BACKEND_CONTEXT = /\berror\b|\bmessage\b|\.json\(|throw |\breason\b/i;

export function countBackendDanishLines(src) {
  let count = 0;
  for (const line of stripComments(src).split("\n")) {
    if (!BACKEND_CONTEXT.test(line)) continue;
    const strings = line.match(/"[^"]*"|'[^']*'|`[^`]*`/g) || [];
    if (strings.some((s) => DANISH_CHARS.test(s))) count++;
  }
  return count;
}

function scanBackend() {
  const counts = {};
  for (const dir of ["backend/routes", "backend/lib"]) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      const n = countBackendDanishLines(readFileSync(file, "utf8"));
      if (n > 0) counts[rel] = n;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Baseline-sammenligning (ratchet)
// ---------------------------------------------------------------------------

export function compareAgainstBaseline(findings, baseline) {
  const newLeaks = [];
  const stale = [];

  const baselineLocale = new Set(baseline.locale || []);
  for (const leak of findings.locale.leaks) {
    if (!baselineLocale.has(leak.id)) {
      newLeaks.push(`locale: ${leak.id} [${leak.kind}] = ${JSON.stringify(leak.value.slice(0, 70))}`);
    }
  }
  for (const id of baselineLocale) {
    if (!findings.locale.leaks.some((l) => l.id === id)) {
      stale.push(`locale: ${id} (fixet — kan fjernes fra baseline)`);
    }
  }

  for (const [scope, label] of [["frontend", "frontend"], ["backend", "backend"]]) {
    const base = baseline[scope] || {};
    for (const [file, count] of Object.entries(findings[scope])) {
      const allowed = base[file] ?? 0;
      if (count > allowed) {
        newLeaks.push(`${label}: ${file} — ${count} leak-linje(r), baseline tillader ${allowed} (+${count - allowed} ny(e))`);
      }
    }
    for (const [file, allowed] of Object.entries(base)) {
      const current = findings[scope][file] ?? 0;
      if (current < allowed) {
        stale.push(`${label}: ${file} — ${current}/${allowed} tilbage (baseline kan strammes)`);
      }
    }
  }

  return { newLeaks, stale };
}

function buildBaseline(findings) {
  return {
    $comment:
      "Kendte i18n-leaks (ratchet — må kun skrumpe). Genereret af scripts/i18n-check-leaks.mjs --update-baseline. Refs #1068/#678. Nye leaks må IKKE tilføjes her — fix dem, eller brug allowlist/EXEMPT i scriptet hvis de er legitimt danske.",
    locale: findings.locale.leaks.map((l) => l.id).sort(),
    frontend: Object.fromEntries(Object.entries(findings.frontend).sort(([a], [b]) => a.localeCompare(b))),
    backend: Object.fromEntries(Object.entries(findings.backend).sort(([a], [b]) => a.localeCompare(b))),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const updateBaseline = process.argv.includes("--update-baseline");

  const findings = {
    locale: scanLocales(),
    frontend: scanFrontend(),
    backend: scanBackend(),
  };

  if (updateBaseline) {
    const baseline = buildBaseline(findings);
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    const n =
      baseline.locale.length +
      Object.keys(baseline.frontend).length +
      Object.keys(baseline.backend).length;
    console.log(`✅ Baseline skrevet til scripts/i18n-leaks-baseline.json (${n} entries).`);
    return;
  }

  let baseline = { locale: [], frontend: {}, backend: {} };
  if (existsSync(BASELINE_PATH)) {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  }

  const { newLeaks, stale } = compareAgainstBaseline(findings, baseline);

  if (findings.locale.advisories.length) {
    console.log(
      `ℹ️  ${findings.locale.advisories.length} identiske EN/DA-natursprogsværdier (advisory — typisk legitime delte termer; tjek manuelt ved nye):`
    );
    for (const a of findings.locale.advisories.slice(0, 8)) {
      console.log(`   - ${a.id} = ${JSON.stringify(a.value.slice(0, 60))}`);
    }
    if (findings.locale.advisories.length > 8) {
      console.log(`   … (+${findings.locale.advisories.length - 8} flere)`);
    }
  }

  if (stale.length) {
    console.log(`\nℹ️  ${stale.length} baseline-entr${stale.length === 1 ? "y" : "ies"} er helt/delvist fixet — stram ratchet'en i en dedikeret commit:`);
    for (const s of stale) console.log(`   - ${s}`);
    console.log("   → node scripts/i18n-check-leaks.mjs --update-baseline");
  }

  if (newLeaks.length) {
    console.error(`\n❌ ${newLeaks.length} NY(E) i18n-leak(s) (ikke i baseline):`);
    for (const l of newLeaks) console.error(`   - ${l}`);
    console.error(`
Fix:
  - EN-locale-værdi: oversæt værdien til engelsk (EN-first, DA-second).
  - Frontend-kode: keyificér via useTranslation/t() + en/da-locale-filer.
  - Backend-fejl: brug { error, errorCode, errorParams }-kontrakten (#1053) +
    resolveApiError i frontend i stedet for rå danske strenge.
  - Legitimt dansk (admin/juridisk/brand)? → tilføj til LOCALE_ALLOWLIST /
    EXEMPT i scripts/i18n-check-leaks.mjs med begrundelse.
Baseline må IKKE udvides med nye leaks (ratchet, Refs #1068).`);
    process.exit(1);
  }

  const knownCount =
    (baseline.locale || []).length +
    Object.keys(baseline.frontend || {}).length +
    Object.keys(baseline.backend || {}).length;
  console.log(
    `\n✅ i18n leak-guard: ingen nye leaks (${knownCount} kendte baseline-entries, ${findings.locale.advisories.length} advisories).`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
