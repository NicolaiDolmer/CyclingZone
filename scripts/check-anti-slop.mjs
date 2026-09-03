#!/usr/bin/env node
// scripts/check-anti-slop.mjs
// ============================================================
// CI-vagter mod slop, del 2: #4626 (slice 4 af designsystem-epic'et #4622).
//
// docs/design/TASTE.md §3 (forbudslisten) er ejer-godkendt 2/9 2026 og siger
// eksplicit: "det der kan greppes SKAL greppes." Dette script daekker de FIRE
// navngivne regler fra forbudslisten som scripts/lint-ui-slop.mjs IKKE fanger
// i dag:
//
//   arrow    : unicode-pile/piktogrammer brugt som ikoner (→ ← ↔ ↑ ↓ ↩ ↪ ‹ › « »)
//              i JSX/JS OG i locale-copy. #3422: pile er `Symbol, Math` i
//              Unicode, ikke `Extended_Pictographic`, saa de slipper 100%
//              forbi lint-ui-slop's emoji-kategori, som kun matcher pictographic.
//   smallpx  : `text-[Npx]` under 12px. PAGE_TEMPLATES.md: kun `text-2xs`
//              (11px) og `text-3xs` (10px) er de gyldige mikro-steps; en
//              arbitraer bracket-vaerdi under 12px er altid en opfindelse.
//   shadow   : `shadow-*`-klasser og raa `box-shadow`/`boxShadow`-styles.
//              Sanktioneret undtagelse: `shadow-overlay` (tailwind.config.js
//              `boxShadow.overlay`), den ENE tilladte overlay-elevation for
//              modal/popover/toast/tooltip (se frontend/src/components/ui/
//              modalStyles.js, toastStyles.js, tooltipStyles.js, menuStyles.js).
//              `shadow-none` er ogsaa tilladt (fjerner skygge, modsat problemet).
//              Semantikken sidder i selve token-navnet, saa scriptet behoever
//              ingen fil-sti-baseret "er dette en modal"-gaetning: en fil der
//              (korrekt) kun bruger shadow-overlay giver 0 fund, uanset om
//              overlayen er en selvstaendig komponent (Modal.jsx) eller inline
//              markup i en side (BoardPage.jsx's inline-modal, TeamPage.jsx's
//              inline-toast); begge bruger shadow-overlay og fanges IKKE.
//   gradient : `bg-gradient-to-*` (Tailwind) og raa `linear-/radial-/conic-
//              gradient(...)`. Scoped til den FAKTISKE CSS/Tailwind-mekanisme,
//              IKKE det blotte ord "gradient", som i denne kodebase for det
//              meste betyder cykel-stigningsprocent (avg_gradient,
//              gradientBand i lib/stageRouteProfile.js, i18n-noeglen
//              detail.route.waypoint.gradient), altsaa PRAECIS den slags
//              aegte cykel-data TASTE P2 vil have MERE af. Et naivt
//              `grep gradient` ville flage den forkerte ting.
//
// Rounded-2xl/rounded-xl, emoji-i-player-facing-filer og raa hex-farver i JSX
// staar OGSAA i TASTE §3, men er ALLEREDE daekket af lint-ui-slop.mjs'
// eksisterende slop/emoji/hex-kategorier (samme fil-saet: frontend/src +
// frontend/public/locales, samme ratchet-mekanik). Se PR-beskrivelsen for
// maalt udbredelse. De duplikeres bevidst IKKE her.
//
// Samme moenster som lint-ui-slop.mjs og check-eslint-disable-count.mjs: en
// per-fil/per-kategori baseline i scripts/anti-slop-baseline.json der KUN maa
// skrumpe (ratchet). Guarden fejler KUN paa NYE overtraedelser (flere i en
// fil end baseline tillader, eller en ny fil).
//
// Brug:
//   node scripts/check-anti-slop.mjs                  # check (CI)
//   node scripts/check-anti-slop.mjs --update-baseline # regenerér baseline
//
// Exit codes:
//   0: ingen nye overtraedelser
//   1: nye overtraedelser ud over baseline
//
// Refs #4626, #3422, #4332 (ratchet-moenstret), #4330 (guard-job).

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EXEMPT_FILES, stripComments } from "./lint-ui-slop.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "scripts", "anti-slop-baseline.json");
const SRC_DIR = join(ROOT, "frontend", "src");
const LOCALES_DIR = join(ROOT, "frontend", "public", "locales");

// --- Detektorer (rene funktioner paa kildestrenge) ------------------------

// Unicode-pile brugt som ikon-erstatning (TASTE §3: "→ ← ↔ ↑ ↓ › «"). Daekker
// Unicode Arrows-blokkens hoved-retninger + hook-varianter (#3422's forslag
// `[←-↕↩↪↔]`) samt de to vinkel-anfoerselstegn-par TASTE navngiver som
// chevron-erstatning (‹ › « »), samme misbrug, symmetrisk retning.
// Indholds-pile i en forklarende saetning ("60-100% → sponsor x1,10") matcher
// SAMME regex som knap-chrome ("Forhandl ny plan →"): en ren regex kan ikke
// skelne de to (#3422 punkt 3: locale-siden "skal laeses igennem, ikke
// find-erstattes"). Ratchet'en loeser det praktisk: begge typer fryses i
// baseline, kun VAEKST fejler, hvilket er praecis det #3422 maalte som
// problemet ("+59 paa 12 dage", ikke det eksisterende antal).
const ARROW_RE = /[←-↕↩↪‹›«»]/gu;

// `text-[Npx]` hvor N < 12. Fortolker tallet numerisk (i stedet for en
// cifferklasse-hack) saa `text-[9px]`, `text-[11.5px]` og `text-[8px]`
// alle regnes korrekt, og `text-[12px]`/`text-[13px]` ikke fejl-matcher.
// text-2xs/text-3xs bruger IKKE bracket-syntaks og kan derfor aldrig matche.
const SMALL_PX_RE = /\btext-\[(\d+(?:\.\d+)?)px\]/g;

// Tailwind shadow-* utility (bar `shadow`, `shadow-sm/md/lg/xl/2xl/inner`,
// `shadow-{farve}-{trin}`, arbitraer `shadow-[...]`) + raa CSS/JS-stil.
// `shadow-overlay` og `shadow-none` er de to legitime undtagelser (se
// header-kommentaren ovenfor).
const SHADOW_CLASS_RE = /\bshadow(-[\w[\]/.,%()-]+)?\b/g;
const SHADOW_STYLE_RE = /\bbox-shadow\s*:|\bboxShadow\s*:/g;
const SHADOW_ALLOWED = new Set(["shadow-overlay", "shadow-none"]);

// Tailwind-gradient-utility ELLER en faktisk CSS-gradient-funktion. Bevidst
// IKKE det blotte ord "gradient" (se header-kommentar: kolliderer med
// cykel-stigningsprocent-copy i denne kodebase).
const GRADIENT_RE = /\bbg-gradient-to-[a-z]+\b|\b(?:linear|radial|conic)-gradient\s*\(/g;

export function countArrow(src) {
  const matches = stripComments(src).match(ARROW_RE);
  return matches ? matches.length : 0;
}

export function countSmallPx(src) {
  const clean = stripComments(src);
  let n = 0;
  let m;
  SMALL_PX_RE.lastIndex = 0;
  while ((m = SMALL_PX_RE.exec(clean)) !== null) {
    if (parseFloat(m[1]) < 12) n++;
  }
  return n;
}

export function countShadow(src) {
  const clean = stripComments(src);
  let n = 0;
  let m;

  // Raa CSS/JS-stil-deklarationer ("box-shadow:"/"boxShadow:") taelles foerst,
  SHADOW_STYLE_RE.lastIndex = 0;
  while ((m = SHADOW_STYLE_RE.exec(clean)) !== null) n++;

  // og fjernes derefter, saa klasse-scannet nedenfor ikke dobbelt-taeller
  // "shadow"-halen af "box-shadow:" som endnu et separat Tailwind-klasse-fund
  // (bindestregen foran "shadow" er en aegte \b-graense, saa uden dette ville
  // "box-shadow:" taelle som BAADE en style-deklaration OG en bar `shadow`-klasse).
  const withoutStyleDecls = clean.replace(SHADOW_STYLE_RE, "");

  SHADOW_CLASS_RE.lastIndex = 0;
  while ((m = SHADOW_CLASS_RE.exec(withoutStyleDecls)) !== null) {
    if (!SHADOW_ALLOWED.has(m[0])) n++;
  }
  return n;
}

export function countGradient(src) {
  const clean = stripComments(src);
  const matches = clean.match(GRADIENT_RE);
  return matches ? matches.length : 0;
}

export function scanSource(src) {
  return {
    arrow: countArrow(src),
    smallpx: countSmallPx(src),
    shadow: countShadow(src),
    gradient: countGradient(src),
  };
}

// --- Fuld-repo-scan ---------------------------------------------------------

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

// Returnér { "<rel-sti>": {arrow, smallpx, shadow, gradient} } for filer med
// >0 i mindst én kategori. frontend/src scannes for alle fire; locale-JSON
// kun for arrow (smallpx/shadow/gradient er Tailwind-/CSS-mekanik og giver
// ikke mening i oversat copy).
export function scanRepo() {
  const counts = {};
  for (const file of walk(SRC_DIR, matchSource)) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (EXEMPT_FILES.has(rel)) continue;
    const r = scanSource(readFileSync(file, "utf8"));
    if (r.arrow || r.smallpx || r.shadow || r.gradient) counts[rel] = r;
  }
  for (const file of walk(LOCALES_DIR, matchLocale)) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (EXEMPT_FILES.has(rel)) continue;
    const arrow = countArrow(readFileSync(file, "utf8"));
    if (arrow) counts[rel] = { arrow, smallpx: 0, shadow: 0, gradient: 0 };
  }
  return counts;
}

// --- Baseline-ratchet (kun stigninger fejler) -------------------------------

const CATS = ["arrow", "smallpx", "shadow", "gradient"];
const ZERO = { arrow: 0, smallpx: 0, shadow: 0, gradient: 0 };

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
        newViolations.push(`${file}, ${cat}: ${cur} (baseline tillader ${max}, +${cur - max} ny(e))`);
      }
    }
  }
  for (const [file, allowed] of Object.entries(base)) {
    const cur = findings[file] || ZERO;
    for (const cat of CATS) {
      if ((cur[cat] || 0) < (allowed[cat] || 0)) {
        stale.push(`${file}, ${cat}: ${cur[cat] || 0}/${allowed[cat] || 0} tilbage (baseline kan strammes)`);
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
      "Kendte anti-slop-overtraedelser (ratchet, maa kun skrumpe). Kategorier: arrow/smallpx/shadow/gradient. Genereret af scripts/check-anti-slop.mjs --update-baseline. Refs #4626, #3422. Nye overtraedelser maa IKKE tilfoejes her: brug stroke-ikoner (ikke pile), text-2xs/text-3xs (ikke arbitraer px), shadow-overlay (ikke andre shadow-*), eller (legitimt) udvid EXEMPT_FILES i lint-ui-slop.mjs med begrundelse (delt med denne guard).",
    files,
  };
}

// --- Main --------------------------------------------------------------

function main() {
  const updateBaseline = process.argv.includes("--update-baseline");
  const findings = scanRepo();

  if (updateBaseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify(buildBaseline(findings), null, 2) + "\n");
    const total = Object.values(findings).reduce(
      (s, c) => s + c.arrow + c.smallpx + c.shadow + c.gradient,
      0
    );
    console.log(`Baseline skrevet til scripts/anti-slop-baseline.json (${Object.keys(findings).length} filer, ${total} overtraedelser).`);
    return;
  }

  let baseline = { files: {} };
  if (existsSync(BASELINE_PATH)) baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

  const { newViolations, stale } = compareAgainstBaseline(findings, baseline);

  if (stale.length) {
    console.log(`${stale.length} baseline-entr${stale.length === 1 ? "y" : "ies"} skrumpet (fixet). Stram ratchet'en i en dedikeret commit:`);
    for (const s of stale.slice(0, 12)) console.log(`   - ${s}`);
    console.log("   -> node scripts/check-anti-slop.mjs --update-baseline");
  }

  if (newViolations.length) {
    console.error(`\n${newViolations.length} NY(E) anti-slop-overtraedelse(r) (ikke i baseline):`);
    for (const v of newViolations) console.error(`   - ${v}`);
    console.error(`
Fix:
  - Pil (arrow)     -> brug et stroke-ikon (ChevronRightIcon/ChevronLeftIcon/
                       ArrowUpIcon/ArrowDownIcon/ExternalLinkIcon), aldrig
                       unicode-pile-tegn som ikon-erstatning.
  - Lille px (smallpx) -> brug text-2xs (11px) eller text-3xs (10px), aldrig
                       en arbitraer text-[Npx] under 12px.
  - Skygge (shadow) -> brug shadow-overlay (den ENE sanktionerede overlay-
                       elevation), ingen andre shadow-*-klasser eller raa
                       box-shadow/boxShadow-styles.
  - Gradient        -> ingen bg-gradient-to-* eller linear-/radial-/conic-
                       gradient(); flad farve/token i stedet.
  - Legitim undtagelse? -> udvid EXEMPT_FILES i scripts/lint-ui-slop.mjs
                       (delt med denne guard) med begrundelse.
Baseline maa IKKE udvides med nye overtraedelser (ratchet, Refs #4626).`);
    process.exit(1);
  }

  const knownFiles = Object.keys(baseline.files || {}).length;
  console.log(`\nanti-slop-guard: ingen nye overtraedelser (${knownFiles} kendte baseline-filer).`);
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) main();
