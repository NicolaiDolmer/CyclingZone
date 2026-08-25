#!/usr/bin/env node
// i18n namespace-inline guard — Refs #470.
//
// Verificér at hvert namespace brugt af `useTranslation(...)` på authenticated
// pages er INLINET som resource i frontend/src/i18n/index.js. Hvis ikke,
// fejler med exit-code 1 — namespacet ville ellers lazy-loades via HttpBackend
// efter first paint, og med `useSuspense: false` render komponenten med raw
// keys ("dashboard:stats.balance") indtil HTTP-load er færdig.
//
// Det er nøjagtigt symptomet brugeren ramte 2026-05-17 på Dashboard
// (dashboard + banners ns ikke inlinet) — se
// `.claude/learnings/2026-05-17-i18n-namespace-inline-missing.md`.
//
// Brug:
//   node scripts/i18n-check-namespace-inline.mjs
//
// CI: .github/workflows/i18n-check.yml

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC_DIR = join(ROOT, "frontend", "src");
const I18N_INDEX = join(SRC_DIR, "i18n", "index.js");

// Namespaces vi ikke kræver inlined — typisk fordi de KUN bruges af pages
// der naturligt allerede har en loading-state (admin-tools bag spinner) eller
// af komponenter der ikke render på first paint. Tilføj med begrundelse.
const INLINE_EXEMPT = new Set([
  // #2849 bølge 4: sjældent besøgte content-sider hvor namespacet lazy-loades
  // via HttpBackend og SELVE SIDEN gater render på useTranslation's `ready`-flag
  // bag PageLoader (ingen raw keys på first paint — kravet er opfyldt af gaten,
  // ikke af inlining). help.json alene var 121 KB raw pr. sprog (~29% af
  // index-chunkens rå vægt) — splittet er bundle-budgettets strukturelle fix.
  // Tilføjer du et namespace her, SKAL forbruger-siden have en ready-gate.
  "help", // kun HelpPage.jsx — ready-gate + PageLoader
  "rules", // kun RulesPage.jsx — ready-gate + PageLoader
  "patchnotes", // kun PatchNotesPage.jsx — ready indgår i eksisterende PageLoader-gate

  // #3697: rod-årsagen bag 26 budget-hævninger. Alle namespaces herunder har
  // deres ENESTE forbrugere bag en lazy route (React.lazy i App.jsx) hvor
  // fladen gater render på `ready` bag PageLoader/skeleton. locale-JSON'en
  // ligger allerede statisk i dist/locales/, så det her fjerner ren JS-vægt
  // fra language-chunken uden at lægge ny payload på brugeren.
  // Tilføjer du et namespace her, SKAL forbruger-fladen have en ready-gate —
  // ellers renderer den rå nøgler på first paint (useSuspense: false).
  "board", // BoardPage (ready-gate) + DashboardPage (kort-niveau ready-gate)
  "founder", // FounderSupporterPage — ready-gate + PageLoader
  "planner", // SeasonPlannerPage (tab i PlanningHubPage) — ready-gate
  "profile", // ProfilePage — ready-gate
  "achievements", // ManagerProfilePage — ready-gate
  "seasonEnd", // SeasonEndPage + SeasonExperiencePreviewPage — ready-gate
  "scouting", // ScoutingCentralPage — ready-gate
  "roadmap", // RoadmapPage — ready-gate
  "admin", // RacePointsAdminSection (AdminDataTab) — ready-gate
  "notifications", // NotificationsPage — ready-gate
  "activity", // ActivityPage (tab i NotificationsPage) — ready-gate
  "forum", // ForumPage + ForumPostPage — ready-gate
  "results", // ResultaterPage — ready-gate
  "calendar", // CalendarPage (tab i PlanningHubPage) — ready-gate
  "pro", // ProUpgradePage — ready-gate
  "watchlist", // WatchlistPage — ready-gate
  "staffOverview", // StaffOverviewPage (tab i KlubPage) — ready-gate
  "standings",

  // #4231: backendMessages var det tungeste tilbagevaerende inlinede namespace
  // (56 KB raw da+en, ~15 KB gzipped). Backend sender {code, params}; frontend
  // renderer via renderBackendMessage. Alle fem forbrugere er nu gated:
  //   FinancePage + BoardPage + NotificationsPage  -> <I18nReadyGate> i App.jsx
  //   FinanceForecastBadge paa dashboardet         -> kort-niveau gate,
  //                                                   fallback=null (intet badge
  //                                                   frem for en spinner)
  //   SeasonFinanceReportPanel                     -> kun inde i FinancePage
  "backendMessages", // RankingsHubPage + StandingsPage (tab) — ready-gate
]);

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

function extractUsedNamespaces(srcFiles) {
  // Patterns vi fanger:
  //   1. useTranslation("x")             — string literal, single ns
  //   2. useTranslation(["x", "y"])      — array of literals (multi-ns)
  //   3. t("ns:key") / t(`ns:${k}`)      — direkte namespace-prefix i kald
  //   4. <Trans i18nKey="ns:key">        — komponent-form (ikke brugt p.t. men fremtidssikring)
  //   5. i18next.t("ns:key")             — direkte instance-kald (ikke brugt p.t.)
  //
  // Patterns vi IKKE fanger (med vilje):
  //   • useTranslation(dynamicVar)       — dynamisk namespace fra prop/state.
  //     Hvis vi tilføjer dette i fremtiden: log warning så guarden ikke tier stille.
  //   • t("noNs") med default-ns fallback — bug-klassen kræver eksplicit ns:prefix
  //     ELLER useTranslation-deklaration, så denne sti er allerede dækket.
  const singleRe = /useTranslation\(\s*["']([\w-]+)["']\s*[,)]/g;
  const arrayRe = /useTranslation\(\s*\[([^\]]+)\]/g;
  const dynamicRe = /useTranslation\(\s*[a-zA-Z_$][\w$]*\s*[,)]/g;
  const tNsKeyRe = /\bt\(\s*[`"']([\w-]+):[^`"']+[`"']/g;
  const transRe = /<Trans\s[^>]*\bi18nKey\s*=\s*["'`]([\w-]+):/g;
  const i18nextTRe = /\b(?:i18next|i18n)\.t\(\s*[`"']([\w-]+):/g;

  const used = new Map(); // namespace -> Set of files
  const dynamicWarnings = [];

  for (const file of srcFiles) {
    const src = readFileSync(file, "utf8");
    const rel = relative(ROOT, file).replace(/\\/g, "/");

    let m;
    while ((m = singleRe.exec(src))) {
      addUsage(used, m[1], rel);
    }
    while ((m = arrayRe.exec(src))) {
      const inner = m[1];
      const nsMatches = [...inner.matchAll(/["']([\w-]+)["']/g)];
      for (const nm of nsMatches) addUsage(used, nm[1], rel);
    }
    while ((m = tNsKeyRe.exec(src))) {
      addUsage(used, m[1], rel);
    }
    while ((m = transRe.exec(src))) {
      addUsage(used, m[1], rel);
    }
    while ((m = i18nextTRe.exec(src))) {
      addUsage(used, m[1], rel);
    }
    while ((m = dynamicRe.exec(src))) {
      dynamicWarnings.push(rel);
    }
  }
  return { used, dynamicWarnings };
}

function addUsage(map, ns, file) {
  if (!map.has(ns)) map.set(ns, new Set());
  map.get(ns).add(file);
}

function extractInlinedNamespaces() {
  const src = readFileSync(I18N_INDEX, "utf8");
  // Find resources-blokken og udtræk keys per sprog. Vi tager unionen og
  // tjekker derefter at hver brugt namespace findes for MINDST ét sprog
  // (cross-language coverage er allerede dækket af i18n-check-keys.mjs).
  const resourcesMatch = src.match(/resources\s*:\s*\{([\s\S]*?)\n\s*\}/);
  if (!resourcesMatch) {
    throw new Error(`Could not locate 'resources:' block in ${relative(ROOT, I18N_INDEX)}`);
  }
  const block = resourcesMatch[1];
  // Hver linje ser ud som: `da: { common: commonDa, auth: authDa, ... }`
  const inlined = new Set();
  const lineRe = /\{([^}]+)\}/g;
  let m;
  while ((m = lineRe.exec(block))) {
    const props = m[1].split(",");
    for (const p of props) {
      const colon = p.indexOf(":");
      if (colon < 0) continue;
      const key = p.slice(0, colon).trim();
      if (/^[\w-]+$/.test(key)) inlined.add(key);
    }
  }
  return inlined;
}

const srcFiles = walk(SRC_DIR);
const { used, dynamicWarnings } = extractUsedNamespaces(srcFiles);
const inlined = extractInlinedNamespaces();

let errorCount = 0;
const missing = [];

for (const [ns, files] of used) {
  if (INLINE_EXEMPT.has(ns)) continue;
  if (!inlined.has(ns)) {
    errorCount += 1;
    missing.push({ ns, files: [...files].slice(0, 5), total: files.size });
  }
}

// #3697 forward-guard: et exempt namespace UDEN ready-gate er præcis den bug
// exemptionen påstår er umulig (raw keys på first paint). Kræv derfor at hvert
// exempt namespace har mindst én gate i src/ — enten
//   <I18nReadyGate ns="x">          (route-/tab-niveau, components/I18nReadyGate.jsx)
// eller den ældre in-page-form
//   const { t, ready } = useTranslation("x")   /   useTranslation("x").ready
// Uden denne kontrol ville "tilføj til INLINE_EXEMPT" være en tavs måde at
// genindføre #470 på.
const gateless = [];
for (const ns of INLINE_EXEMPT) {
  if (!used.has(ns)) continue; // ubrugt namespace kan ikke flashe
  const gateRe = new RegExp(
    `<I18nReadyGate[^>]*\\bns\\s*=\\s*["'\`]${ns}["'\`]` +
      `|\\{[^{}]*\\bready\\b[^{}]*\\}\\s*=\\s*useTranslation\\(\\s*(?:\\[[^\\]]*)?["'\`]${ns}["'\`]`
  );
  const hasGate = [...used.get(ns)].some((rel) =>
    gateRe.test(readFileSync(join(ROOT, rel), "utf8"))
  ) || srcFiles.some((f) => gateRe.test(readFileSync(f, "utf8")));
  if (!hasGate) gateless.push(ns);
}

if (gateless.length > 0) {
  errorCount += gateless.length;
  console.error(
    `✗ i18n ready-gate FAILED — ${gateless.length} exempt namespace(s) uden ready-gate: ${gateless.join(", ")}\n` +
      `  Et INLINE_EXEMPT-namespace lazy-loades via HttpBackend. Uden en gate\n` +
      `  render fladen rå nøgler på first paint (useSuspense: false, #470).\n` +
      `  Fix: wrap forbrugeren i <I18nReadyGate ns="…"> (frontend/src/components/I18nReadyGate.jsx)\n` +
      `  ELLER gate in-page på \`const { t, ready } = useTranslation("…")\`.\n`
  );
}

// Dynamic namespace = guarden kan ikke se den. Log warning så det er
// synligt at filer slipper gennem statisk analyse. Failer ikke buildet —
// runtime-fejl vil stadig manifestere som raw key i UI.
if (dynamicWarnings.length > 0) {
  console.warn(`⚠ ${dynamicWarnings.length} fil(er) bruger dynamic useTranslation(var) — guarden kan ikke verificere namespace-inline statisk:`);
  for (const f of dynamicWarnings) console.warn(`    - ${f}`);
}

if (errorCount === 0) {
  const inlineCount = used.size - [...used.keys()].filter((ns) => INLINE_EXEMPT.has(ns)).length;
  const gated = [...used.keys()].filter((ns) => INLINE_EXEMPT.has(ns)).sort();
  console.log(`✓ i18n namespace-inline OK — ${inlineCount} namespaces inlinet, ${gated.length} lazy bag ready-gate (${gated.join(", ")})`);
  process.exit(0);
}

if (missing.length === 0) process.exit(1);

console.error(`✗ i18n namespace-inline FAILED — ${missing.length} namespace(s) brugt men ikke inlinet:\n`);
for (const { ns, files, total } of missing) {
  console.error(`  • "${ns}" brugt i ${total} fil(er):`);
  for (const f of files) console.error(`      - ${f}`);
  if (total > files.length) console.error(`      - (+${total - files.length} flere)`);
}
console.error(`\nFix: importér ${missing.map(x => `${x.ns}.json`).join(" + ")} i ${relative(ROOT, I18N_INDEX).replace(/\\/g, "/")}`);
console.error(`     og tilføj til \`resources.da\` + \`resources.en\`.`);
console.error(`\nHvorfor: med \`useSuspense: false\` render komponenten FØR HttpBackend henter`);
console.error(`         lazy namespace → t() returnerer raw key i UI'et på first paint.`);
process.exit(1);
