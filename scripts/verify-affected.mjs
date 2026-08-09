#!/usr/bin/env node
// scripts/verify-affected.mjs
// ============================================================
// Lagdelt verifikationsregel (ejer-godkendt 8/8, #3556): små UI-diffs kan
// verificeres med målrettede e2e-specs lokalt — CI's required checks bærer
// den fulde suite alligevel. Større/risikable diffs kræver stadig fuld
// lokal suite FØR push (samme begrundelse som CLAUDE.md §Start punkt 4:
// en CI-miss koster en fuld CI-runde, ~15-20 min).
//
// Dette script er RÅDGIVENDE, ikke en gate: det klassificerer den aktuelle
// diff i én af to tiers og printer en konkret anbefaling. Exit-kode er altid
// 0 (medmindre selve klassificeringen fejler pga. git-fejl).
//
// TIER FULL (fuld lokal suite krævet) hvis diffen rører:
//   - backend/**
//   - frontend/src/lib/** eller frontend/src/hooks/** (delt logik)
//   - delte komponenter: frontend/src/components/{ui,rider,race}/**
//   - i18n locale-filer (frontend/public/locales/**/*.json) — projektet
//     bruger i18next-icu, så al locale-tekst er ICU-formatteret; enhver
//     locale-ændring behandles simpelt som en "ICU-ændring".
//   - frontend/playwright.config.js
//   - package.json / package-lock.json (alle niveauer)
//   - frontend vite-config
//   - eller mere end 6 kildefiler i alt (docs/billeder/binære filer tæller
//     ikke med — se isCountableSourceFile)
//
// TIER AFFECTED (målrettede specs lokalt, fuld suite i CI) ellers: specs
// udledes ved (a) filnavne der matcher side-/komponentnavnet (fx
// TrainingPage → training*.spec.js) og (b) specs hvis INDHOLD matcher
// komponentens route (udledt af frontend/src/App.jsx — fanger tilfælde
// hvor spec-filnavnet ikke matcher komponentnavnet, fx RankingsHubPage →
// rute "standings" → standings-*.spec.js). core-smoke.spec.js er ALTID med.
//
// Brug:
//   node scripts/verify-affected.mjs
//
// Tests: node --test scripts/verify-affected.test.mjs
//
// Refs #3556.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const APP_JSX_PATH = join(ROOT, "frontend", "src", "App.jsx");
const E2E_DIR = join(ROOT, "frontend", "tests", "e2e");
const CORE_SMOKE = "core-smoke.spec.js";

// --------------------------------------------------------------
// Git — hent ændrede filer (committed diff mod origin/main + uncommitted).
// --------------------------------------------------------------

function runGit(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

// Pure: slå flere rå git-outputs sammen til én sorteret, dedupliceret,
// posix-normaliseret filliste.
export function normalizeAndUnion(rawOutputs) {
  const set = new Set();
  for (const raw of rawOutputs) {
    if (!raw) continue;
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      set.add(trimmed.replaceAll("\\", "/"));
    }
  }
  return [...set].sort();
}

export function getChangedFiles() {
  const outputs = [];
  const warnings = [];

  try {
    outputs.push(runGit(["diff", "--name-only", "origin/main...HEAD"]));
  } catch (error) {
    warnings.push(`kunne ikke diffe mod origin/main...HEAD (${error.message.split("\n")[0]}) — kør 'git fetch origin' først.`);
  }

  try {
    outputs.push(runGit(["diff", "--name-only", "HEAD"]));
  } catch (error) {
    warnings.push(`kunne ikke læse uncommitted diff (${error.message.split("\n")[0]}).`);
  }

  try {
    outputs.push(runGit(["ls-files", "--others", "--exclude-standard"]));
  } catch (error) {
    warnings.push(`kunne ikke læse untracked filer (${error.message.split("\n")[0]}).`);
  }

  return { files: normalizeAndUnion(outputs), warnings };
}

// --------------------------------------------------------------
// Tier-klassificering (pure).
// --------------------------------------------------------------

const NON_SOURCE_RE = /\.(md|png|jpe?g|gif|svg|ico|pdf|webp|mp4|mov|zip)$/i;

// Filer der ikke tæller med i ">6 kildefiler i alt"-tærsklen (docs/billeder).
export function isCountableSourceFile(file) {
  return !NON_SOURCE_RE.test(file);
}

export const FULL_TIER_RULES = [
  {
    id: "backend",
    label: "backend/** rørt",
    test: (f) => f.startsWith("backend/"),
  },
  {
    id: "frontend-lib",
    label: "frontend/src/lib/** rørt (delt logik)",
    test: (f) => f.startsWith("frontend/src/lib/"),
  },
  {
    id: "frontend-hooks",
    label: "frontend/src/hooks/** rørt (delt logik)",
    test: (f) => f.startsWith("frontend/src/hooks/"),
  },
  {
    id: "shared-components",
    label: "delt komponent rørt (components/ui, components/rider eller components/race)",
    test: (f) =>
      f.startsWith("frontend/src/components/ui/") ||
      f.startsWith("frontend/src/components/rider/") ||
      f.startsWith("frontend/src/components/race/"),
  },
  {
    id: "i18n-icu",
    label: "i18n locale-fil rørt (i18next-icu — al locale-tekst er ICU)",
    test: (f) => f.startsWith("frontend/public/locales/") && f.endsWith(".json"),
  },
  {
    id: "playwright-config",
    label: "frontend/playwright.config.js rørt",
    test: (f) => f === "frontend/playwright.config.js",
  },
  {
    id: "package-manifest",
    label: "package.json/package-lock.json rørt",
    test: (f) => /(^|\/)package(-lock)?\.json$/.test(f),
  },
  {
    id: "vite-config",
    label: "frontend vite-config rørt",
    test: (f) => /^frontend\/vite\.config\.(js|ts|mjs)$/.test(f),
  },
];

export const SOURCE_FILE_COUNT_THRESHOLD = 6;

// Pure: klassificér en filliste i TIER FULL eller TIER AFFECTED.
export function classifyTier(files) {
  const matches = [];
  for (const rule of FULL_TIER_RULES) {
    const hits = files.filter(rule.test);
    if (hits.length) matches.push({ id: rule.id, label: rule.label, files: hits });
  }

  const countable = files.filter(isCountableSourceFile);
  const overThreshold = countable.length > SOURCE_FILE_COUNT_THRESHOLD;

  const reasons = matches.map((m) => `${m.label}: ${m.files.join(", ")}`);
  if (overThreshold) {
    reasons.push(`>${SOURCE_FILE_COUNT_THRESHOLD} kildefiler i alt rørt (${countable.length} tæller med, docs/billeder undtaget)`);
  }

  if (matches.length || overThreshold) {
    return { tier: "FULL", reasons, matches, overThreshold, countableCount: countable.length };
  }
  return { tier: "AFFECTED", reasons: [], matches: [], overThreshold: false, countableCount: countable.length };
}

// --------------------------------------------------------------
// TIER AFFECTED — spec-udledning (pure, tager injicerede inputs så
// funktionen kan unit-testes uden filsystem/git).
// --------------------------------------------------------------

const PAGE_DIR = "frontend/src/pages/";
const COMPONENTS_DIR = "frontend/src/components/";
const RELEVANT_FILE_RE = /\.(jsx|test\.js)$/;
const SPEC_EXT_RE = /\.(spec\.js|shots\.mjs)$/;

function toKebabCase(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

// Pure: "TrainingPage" -> "training", "RaceDetailPage" -> "race-detail",
// "AuctionBidWarModal" -> "auction-bid-war-modal" (ingen kendt suffiks at strippe).
export function componentSlug(componentName) {
  let slug = toKebabCase(componentName);
  if (slug.endsWith("-page")) slug = slug.slice(0, -"-page".length);
  return slug;
}

// Pure: udled PascalCase-komponentnavnet fra en filsti
// ("frontend/src/pages/TrainingPage.raceDay.test.js" -> "TrainingPage").
export function extractComponentName(filePath) {
  const base = filePath.split("/").pop();
  return base.split(".")[0];
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Pure: parse frontend/src/App.jsx's <Route path="..." element={<Component />} />
// linjer til Map<componentName, staticRouteSlug>. Navigate-redirects ignoreres
// (de peger ikke på en side-komponent). Kun det sidste STATISKE (ikke ":param")
// stisegment bruges som grep-nøgle — simpel heuristik, ikke en fuld router-parser.
export function parseRouteMap(appJsxSource) {
  const routeMap = new Map();
  const ROUTE_RE = /<Route\s+path="([^"]*)"\s+element=\{<(\w+)/g;
  let match;
  while ((match = ROUTE_RE.exec(appJsxSource))) {
    const [, path, componentName] = match;
    if (componentName === "Navigate") continue;
    const staticSegments = path.split("/").filter((seg) => seg && !seg.startsWith(":"));
    const slug = staticSegments.length ? staticSegments[staticSegments.length - 1] : null;
    if (slug && !routeMap.has(componentName)) routeMap.set(componentName, slug);
  }
  return routeMap;
}

function stripSpecExt(specFile) {
  return specFile.replace(SPEC_EXT_RE, "");
}

function addMatch(matches, specFile, reason) {
  if (!matches.has(specFile)) matches.set(specFile, []);
  matches.get(specFile).push(reason);
}

// Pure: udled berørte e2e-specs for TIER AFFECTED.
// Returnerer Map<specFileName, reasons[]>. Inkluderer ALTID core-smoke.spec.js.
export function deriveAffectedSpecs(files, { specFileNames, specContents, routeMap }) {
  const matches = new Map();

  const relevantFiles = files.filter(
    (f) => (f.startsWith(PAGE_DIR) || f.startsWith(COMPONENTS_DIR)) && RELEVANT_FILE_RE.test(f)
  );

  for (const file of relevantFiles) {
    const componentName = extractComponentName(file);
    const slug = componentSlug(componentName);

    // (a) filnavn matcher side-/komponentnavnet.
    for (const specFile of specFileNames) {
      const specBase = stripSpecExt(specFile);
      if (specBase === slug || specBase.startsWith(`${slug}-`)) {
        addMatch(matches, specFile, `filnavn matcher "${slug}" (fra ${file})`);
      }
    }

    // (b) spec-indhold grep-matcher komponentens route.
    const routeLeaf = routeMap.get(componentName);
    if (routeLeaf) {
      const routeRe = new RegExp(`['"/]${escapeRegExp(routeLeaf)}(['"?/]|$)`);
      for (const specFile of specFileNames) {
        const content = specContents.get(specFile);
        if (content && routeRe.test(content)) {
          addMatch(matches, specFile, `indhold matcher rute "/${routeLeaf}" (fra ${file}, komponent ${componentName})`);
        }
      }
    }
  }

  if (!matches.has(CORE_SMOKE)) {
    addMatch(matches, CORE_SMOKE, "altid inkluderet som minimum");
  }

  return matches;
}

// --------------------------------------------------------------
// main — orkestrerer git + filsystem, printer rapport. Advisory: exit 0.
// --------------------------------------------------------------

function readE2eSpecFiles() {
  if (!existsSync(E2E_DIR)) return { specFileNames: [], specContents: new Map() };
  const specFileNames = readdirSync(E2E_DIR).filter((f) => SPEC_EXT_RE.test(f));
  const specContents = new Map();
  for (const f of specFileNames) {
    specContents.set(f, readFileSync(join(E2E_DIR, f), "utf8"));
  }
  return { specFileNames, specContents };
}

function readRouteMap() {
  if (!existsSync(APP_JSX_PATH)) return new Map();
  return parseRouteMap(readFileSync(APP_JSX_PATH, "utf8"));
}

function printFullTierReport(result) {
  console.log("\n=== TIER FULL — fuld lokal suite anbefales før push ===\n");
  console.log("Begrundelse:");
  for (const reason of result.reasons) console.log(`  - ${reason}`);
  console.log(`
Anbefalede kommandoer:
  pwsh -File scripts/verify-local.ps1     # backend-tests + frontend-tests (node --test) + frontend-build
  npm run test:e2e --prefix frontend      # fuld e2e-suite, alle 3 projekter lokalt (desktop-chromium, mobile-chromium, mobile-webkit)
  pwsh -File scripts/preflight-pr.ps1     # i18n/lint/guards

CI's required checks kører også den fulde suite, men denne diffklasse har
historisk kostet ekstra CI-runder ved kun at blive fanget der (~15-20 min pr. miss).`);
}

function printAffectedTierReport(matches, warnings) {
  const specFiles = [...matches.keys()].sort();
  console.log("\n=== TIER AFFECTED — målrettede specs lokalt er nok; CI's required checks bærer den fulde suite ===\n");
  console.log("Berørte specs:");
  for (const specFile of specFiles) {
    console.log(`  - ${specFile}`);
    for (const reason of matches.get(specFile)) console.log(`      · ${reason}`);
  }
  console.log(`
Anbefalet kommando (kør fra frontend/):
  npx playwright test ${specFiles.join(" ")} --project=desktop-chromium --project=mobile-chromium --project=mobile-webkit

Husk: dette er et lokalt hurtig-tjek. CI's required checks kører hele
suiten uanset — TIER AFFECTED erstatter IKKE det, det sparer dig for at
vente på en fuld lokal run for en lille, isoleret UI-diff.`);
  if (warnings.length) {
    console.log("\nAdvarsler:");
    for (const w of warnings) console.log(`  - ${w}`);
  }
}

function main() {
  const { files, warnings } = getChangedFiles();

  if (warnings.length) {
    console.log("Advarsler under git-opslag:");
    for (const w of warnings) console.log(`  - ${w}`);
  }

  if (files.length === 0) {
    console.log("\nIngen ændrede filer fundet (hverken committed vs origin/main eller uncommitted). Intet at anbefale.");
    process.exit(0);
  }

  console.log(`\nÆndrede filer (${files.length}):`);
  for (const f of files) console.log(`  - ${f}`);

  const result = classifyTier(files);

  if (result.tier === "FULL") {
    printFullTierReport(result);
  } else {
    const { specFileNames, specContents } = readE2eSpecFiles();
    const routeMap = readRouteMap();
    const matches = deriveAffectedSpecs(files, { specFileNames, specContents, routeMap });
    printAffectedTierReport(matches, warnings);
  }

  // Rådgivende script — klassificeringen er ikke en gate.
  process.exit(0);
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) main();
