#!/usr/bin/env node
// scripts/lint-ui-slop.mjs
// ============================================================
// UI anti-drift forward-guard — #671 Plan 3 (spec DEL-C C1) · udvidet #1578 WP0.
//
// REGEL (dokumenteret her som single source of truth):
//   Ny UI bruger ui/-primitiver + design-tokens. INGEN raa hex-farver i
//   frontend/src (kun index.css token-definitioner), INGEN slop-tells
//   (rounded-xl/2xl/3xl, glow `shadow-[0_0...]`, backdrop-blur, blob-blur
//   `blur-2xl/3xl`), INGEN raa Tailwind-palette-farver (`bg-red-500` etc. —
//   brug cz-*-tokens), INGEN emoji som ikon i JSX ELLER i locale-vaerdier
//   (brug ui/icons/).
//
// FIRE kategorier ratchet'es per fil i scripts/ui-slop-baseline.json:
//   hex    — raa #rrggbb i frontend/src (WP2)
//   slop   — rounded-xl/2xl/3xl, glow, backdrop-blur, blob-blur (WP0 = denne)
//   colour — raa Tailwind-palette-utility (bg/text/border-{farve}-{shade}) (WP2)
//   emoji  — Extended_Pictographic i frontend/src JSX *og* i locale-JSON (WP1)
//
// FORWARD-GUARD, ikke retroaktivt brud: de eksisterende callsites + al
// nuvaerende emoji/raa-farve er WP1/WP2's job. Kendte overtraedelser ligger i
// scripts/ui-slop-baseline.json (per-fil/per-kategori count-ratchet — maa kun
// skrumpe). Guarden fejler KUN paa NYE overtraedelser (flere i en fil end
// baseline, eller en ny fil). Praecis samme form som i18n-check-leaks.mjs.
//
// WP0 (#1578) laaste radius/blur/font i tailwind.config.js + rensede de 147
// rounded-xl/2xl-callsites; colour+emoji er bevidst KUN baseline-grandfathered
// her (ingen rens) saa WP1/WP2 kan ratchet'e dem ned i egne PR'er.
//
// Brug:
//   node scripts/lint-ui-slop.mjs                    # check (CI + pre-commit)
//   node scripts/lint-ui-slop.mjs --update-baseline  # regenerér baseline
//
// Evt. fil-sti-args fra lint-staged ignoreres — scannen er altid fuld-repo
// (frontend/src + frontend/public/locales) saa resultatet er deterministisk
// uanset hvad der er staged.
//
// Refs #671, #1578.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "scripts", "ui-slop-baseline.json");
const SRC_DIR = join(ROOT, "frontend", "src");
// #1578 WP0: locale-JSON er ogsaa player-facing — emoji der i copy er samme
// slop som emoji-som-ikon i JSX. Scannes for emoji (kun den kategori).
const LOCALES_DIR = join(ROOT, "frontend", "public", "locales");

// index.css er token-definitions-filen: raa hex er LEGITIMT der (det er hele
// pointen — tokens defineres ét sted). Helt undtaget fra scannen.
export const EXEMPT_FILES = new Set([
  "frontend/src/index.css",
  // Patch notes-historik er indhold, ikke UI-kode: body-tekst kan citere hex/emoji
  // fra tidligere ændringer ("fjernede gold-glow", emoji nævnt i en gammel note).
  "frontend/src/data/patchNotes.js",
]);

// --- Detektorer (rene funktioner paa kildestrenge) ------------------------

// Raa hex: #RGB / #RGBA / #RRGGBB / #RRGGBBAA, ikke efterfulgt af endnu et
// hex-tegn (saa #ffff0 / #section ikke fejl-matcher). Vi fanger token'et og
// filtrerer i isHexColor: et rent-decimalt #1234 (1-4 cifre) er en
// issue-reference (Refs #1357), IKKE en farve — kun cifre-med-bogstav ELLER
// 6/8-cifrede tokens er farver (issue-numre naar ikke 6 cifre).
const HEX_TOKEN_RE = /#([0-9a-fA-F]{3,8})(?![0-9a-fA-F])/g;

function isHexColor(digits) {
  const len = digits.length;
  if (len !== 3 && len !== 4 && len !== 6 && len !== 8) return false; // 5/7 = ugyldig
  if (/[a-fA-F]/.test(digits)) return true; // indeholder hex-bogstav -> farve
  return len === 6 || len === 8; // rent-decimalt: kun 6/8 cifre er en farve
}

// Slop-tells (navngivne saa fejlbeskeden er handlingsbar).
export const SLOP_PATTERNS = [
  ["rounded-xl", /\brounded-xl\b/g],
  ["rounded-2xl", /\brounded-2xl\b/g],
  ["rounded-3xl", /\brounded-3xl\b/g],
  ["glow-shadow", /shadow-\[0_0/g],
  ["backdrop-blur", /\bbackdrop-blur\b/g],
  ["blob-blur", /\bblur-(?:2xl|3xl)\b/g],
];

// Emoji-som-ikon: Extended_Pictographic minus tekst-symboler (©®™) der teknisk
// er pictographic men legitime i copy.
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const EMOJI_TEXT_EXEMPT = new Set(["©", "®", "™"]); // © ® ™

// Raa Tailwind-palette-farve (#1578 WP0, ratchet ned i WP2): en utility-prefix
// (bg/text/border/ring/from/to/via/fill/stroke/divide/outline/decoration/
// placeholder/accent/caret/shadow) + en stock-palette-farve + numerisk shade,
// fx `bg-red-500`, `text-slate-400`, `border-emerald-300/50`. Brand-tokens
// (cz-*) og de uskyldige `black`/`white` (tager ingen shade) matcher IKKE.
// Design-systemet bruger cz-success/danger/warning/info i stedet.
const TW_COLOR_PREFIX =
  "bg|text|border|ring|ring-offset|from|to|via|fill|stroke|divide|outline|decoration|placeholder|accent|caret|shadow";
const TW_PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const TW_COLOR_RE = new RegExp(
  `\\b(?:${TW_COLOR_PREFIX})-(?:${TW_PALETTE})-[0-9]{2,3}\\b`,
  "g"
);

export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

export function countHex(src) {
  const clean = stripComments(src);
  let n = 0;
  let m;
  HEX_TOKEN_RE.lastIndex = 0;
  while ((m = HEX_TOKEN_RE.exec(clean)) !== null) {
    if (isHexColor(m[1])) n++;
  }
  return n;
}

export function countSlop(src) {
  const clean = stripComments(src);
  let n = 0;
  for (const [, re] of SLOP_PATTERNS) n += (clean.match(re) ?? []).length;
  return n;
}

export function countEmoji(src) {
  const matches = stripComments(src).match(EMOJI_RE) ?? [];
  return matches.filter((ch) => !EMOJI_TEXT_EXEMPT.has(ch)).length;
}

export function countColor(src) {
  TW_COLOR_RE.lastIndex = 0;
  return (stripComments(src).match(TW_COLOR_RE) ?? []).length;
}

export function scanSource(src) {
  return {
    hex: countHex(src),
    slop: countSlop(src),
    colour: countColor(src),
    emoji: countEmoji(src),
  };
}

// --- Fuld-repo-scan (frontend/src) ----------------------------------------

function walk(dir, match, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      walk(p, match, out);
    } else if (match(f)) {
      out.push(p);
    }
  }
  return out;
}

const matchSource = (f) => /\.(jsx?|css)$/.test(f) && !/\.test\.(jsx?|mjs)$/.test(f);
const matchLocale = (f) => /\.json$/.test(f);

// Returnér { "<rel-sti>": {hex, slop, colour, emoji} } for filer med >0 i mindst
// én kategori. frontend/src scannes for alle fire; locale-JSON kun for emoji
// (raa-farve/radius giver ikke mening i copy).
export function scanRepo() {
  const counts = {};
  for (const file of walk(SRC_DIR, matchSource)) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (EXEMPT_FILES.has(rel)) continue;
    const r = scanSource(readFileSync(file, "utf8"));
    if (r.hex || r.slop || r.colour || r.emoji) counts[rel] = r;
  }
  for (const file of walk(LOCALES_DIR, matchLocale)) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (EXEMPT_FILES.has(rel)) continue;
    const emoji = countEmoji(readFileSync(file, "utf8"));
    if (emoji) counts[rel] = { hex: 0, slop: 0, colour: 0, emoji };
  }
  return counts;
}

// --- Baseline-ratchet (kun stigninger fejler) -----------------------------

const CATS = ["hex", "slop", "colour", "emoji"];
const ZERO = { hex: 0, slop: 0, colour: 0, emoji: 0 };

export function compareAgainstBaseline(findings, baseline) {
  const base = baseline.files || {};
  const newViolations = [];
  const stale = [];

  for (const [file, counts] of Object.entries(findings)) {
    const allowed = base[file] || ZERO;
    for (const cat of CATS) {
      const cur = counts[cat] || 0;
      const max = allowed[cat] || 0;
      if (cur > max) {
        newViolations.push(`${file} — ${cat}: ${cur} (baseline tillader ${max}, +${cur - max} ny(e))`);
      }
    }
  }
  for (const [file, allowed] of Object.entries(base)) {
    const cur = findings[file] || ZERO;
    for (const cat of CATS) {
      if ((cur[cat] || 0) < (allowed[cat] || 0)) {
        stale.push(`${file} — ${cat}: ${cur[cat] || 0}/${allowed[cat] || 0} tilbage (baseline kan strammes)`);
      }
    }
  }
  return { newViolations, stale };
}

function buildBaseline(findings) {
  const files = {};
  for (const file of Object.keys(findings).sort()) files[file] = findings[file];
  return {
    $comment:
      "Kendte UI-anti-drift-overtraedelser (ratchet — maa kun skrumpe). Kategorier: hex/slop/colour/emoji. Genereret af scripts/lint-ui-slop.mjs --update-baseline. Refs #671 Plan 3, #1578 WP0. Nye overtraedelser maa IKKE tilfoejes her — brug ui/-primitiver + tokens, eller (legitimt) udvid EXEMPT_FILES i scriptet med begrundelse. WP1 skrumper emoji, WP2 skrumper colour/hex.",
    files,
  };
}

// --- Main -----------------------------------------------------------------

function main() {
  const updateBaseline = process.argv.includes("--update-baseline");
  const findings = scanRepo();

  if (updateBaseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify(buildBaseline(findings), null, 2) + "\n");
    const total = Object.values(findings).reduce(
      (s, c) => s + c.hex + c.slop + (c.colour || 0) + c.emoji,
      0
    );
    console.log(`✅ Baseline skrevet til scripts/ui-slop-baseline.json (${Object.keys(findings).length} filer, ${total} overtraedelser).`);
    return;
  }

  let baseline = { files: {} };
  if (existsSync(BASELINE_PATH)) baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

  const { newViolations, stale } = compareAgainstBaseline(findings, baseline);

  if (stale.length) {
    console.log(`ℹ️  ${stale.length} baseline-entr${stale.length === 1 ? "y" : "ies"} skrumpet (fixet) — stram ratchet'en i en dedikeret commit:`);
    for (const s of stale.slice(0, 12)) console.log(`   - ${s}`);
    console.log("   → node scripts/lint-ui-slop.mjs --update-baseline");
  }

  if (newViolations.length) {
    console.error(`\n❌ ${newViolations.length} NY(E) UI-anti-drift-overtraedelse(r) (ikke i baseline):`);
    for (const v of newViolations) console.error(`   - ${v}`);
    console.error(`
Fix:
  - Raa hex   → brug en design-token (cz-*-farve / CSS-var i index.css), ikke #rrggbb.
  - Slop-tell → brug rounded-cz/rounded-cz-pill + hairline-border + shadow-overlay;
                ingen rounded-xl/2xl/3xl, glow (shadow-[0_0...]), backdrop-blur, blur-2xl/3xl.
  - Colour    → brug cz-*-token (cz-success/danger/warning/info/accent), ikke raa
                Tailwind-palette (bg-red-500, text-slate-400, …).
  - Emoji     → brug et ui/icons/-ikon i stedet for emoji-tegn (gaelder ogsaa locale-copy).
  - Legitim undtagelse? → udvid EXEMPT_FILES i scripts/lint-ui-slop.mjs med begrundelse.
Baseline maa IKKE udvides med nye overtraedelser (ratchet, Refs #671, #1578).`);
    process.exit(1);
  }

  const knownFiles = Object.keys(baseline.files || {}).length;
  console.log(`\n✅ UI anti-drift-guard: ingen nye overtraedelser (${knownFiles} kendte baseline-filer).`);
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) main();
