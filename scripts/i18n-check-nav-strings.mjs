#!/usr/bin/env node
// i18n hardcoded-nav-label guard — Refs #689.
//
// Fanger den bug-klasse hvor en navigations-/sidebar-/layout-komponent har
// `label: "Indbakke"` (string-literal) i stedet for `label: t("nav.item.notifications")`.
// MobileQuickNav.jsx havde præcis dette mønster i ~6 mdr uden detection — viste
// "Indbakke"/"Marked"/"Ryttere"/"Mit Hold" på EN-locale (mobil bottom-nav på prod
// 2026-05-26). Desktop sidebar var korrekt fordi den blev migrated til i18n
// først, men den parallelle mobile-struktur blev glemt.
//
// Scan-scope: filer hvis navn matcher Nav/Sidebar-mønstret, ELLER importerer
// NavLink fra react-router-dom (= sandsynligvis nav-komponent).
// Detection: `label:\s*["']<non-empty>["']` — hardkodede label-strings i objekter.
//
// Brug:
//   node scripts/i18n-check-nav-strings.mjs
//
// CI: .github/workflows/i18n-check.yml

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC_DIR = join(ROOT, "frontend", "src");

// Filnavne der ALTID scannes (navigation-pattern komponenter). Tilføj her hvis
// du opretter en ny nav/sidebar/layout-komponent.
const ALWAYS_SCAN = new Set([
  "MobileQuickNav.jsx",
  "Layout.jsx",
]);

// File-name patterns (regex): matcher → fil scannes.
const SCAN_NAME_PATTERNS = [
  /Nav\.(jsx|tsx)$/i,        // *Nav.jsx (Layout-undtaget håndteres af ALWAYS_SCAN)
  /Sidebar\.(jsx|tsx)$/i,    // *Sidebar.jsx
  /Topbar\.(jsx|tsx)$/i,     // fremtidssikring
];

// Label-værdier vi accepterer som hardcoded — typisk ikke-oversatte konstanter
// (brand-navne, tekniske strings). Tilføj med begrundelse hvis nødvendigt.
const ALLOWED_LITERAL_LABELS = new Set([
  // Tom indtil videre.
]);

function shouldScan(filePath) {
  const name = basename(filePath);
  if (ALWAYS_SCAN.has(name)) return true;
  if (SCAN_NAME_PATTERNS.some(re => re.test(name))) return true;
  return false;
}

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

// Detection regex:
//   • Matcher `label: "<text>"` eller `label: '<text>'` (i objekt-literals)
//   • Ekskluderer template-literals (`label: \`...\``) — de tillader interpolation
//     og er sjældent ren static-string-bug
//   • Ekskluderer expression-form (`label: t(...)`, `label: variable`) — kun
//     ren string-literal flag'es
const LABEL_LITERAL_RE = /\blabel\s*:\s*(["'])([^"'\n]+)\1/g;

const srcFiles = walk(SRC_DIR);
const violations = [];

for (const file of srcFiles) {
  if (!shouldScan(file)) continue;
  const src = readFileSync(file, "utf8");
  const rel = relative(ROOT, file).replace(/\\/g, "/");

  let m;
  LABEL_LITERAL_RE.lastIndex = 0;
  while ((m = LABEL_LITERAL_RE.exec(src))) {
    const literal = m[2];
    if (ALLOWED_LITERAL_LABELS.has(literal)) continue;
    // Beregn linjenummer for præcis fejl-rapport
    const upTo = src.slice(0, m.index);
    const line = upTo.split("\n").length;
    violations.push({ file: rel, line, literal });
  }
}

if (violations.length === 0) {
  console.log(`✓ i18n nav-strings OK — ingen hardkodede label-strings i nav/sidebar/layout-komponenter`);
  process.exit(0);
}

console.error(`✗ i18n nav-strings FAILED — ${violations.length} hardkoded label-string(s) fundet:\n`);
for (const { file, line, literal } of violations) {
  console.error(`  ${file}:${line}  →  label: "${literal}"`);
}
console.error(`\nFix: erstat med \`label: t("nav.item.<key>")\` eller \`labelKey: "nav.item.<key>"\`-pattern.`);
console.error(`     Brug eksisterende keys i frontend/public/locales/{en,da}/common.json (nav.item.*, nav.group.*).`);
console.error(`     Hvis labelen IKKE bør oversættes (brand-navn etc.), tilføj til ALLOWED_LITERAL_LABELS øverst i scriptet.`);
process.exit(1);
