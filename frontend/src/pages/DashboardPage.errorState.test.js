import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3510 — dashboardet manglede en error-state ved fejlet load: loadAll() fangede
// fejl med console.error alene og faldt igennem til finally { setLoading(false) },
// så en fejlet indlæsning viste et fuldt TOMT dashboard uden fejlbesked. Desuden
// defaultede "Seneste resultater" + "Rytter-rangliste" (post-first-paint-moduler)
// til [] i stedet for null, så de viste et falsk empty-state i round-trip-vinduet
// ved hvert load (false-empty flash) — MyLatestResultCard gør allerede denne
// null-vs-[]-distinktion korrekt (se dens datakontrakt-kommentar).
//
// Kildekode-struktur-guard (samme mønster som DashboardPage.onboardingConsolidation.test.js
// / DashboardPage.goldCtaPriority.test.js) — repoet kører node --test uden DOM-renderer.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "DashboardPage.jsx"), "utf8");

test("#3510 loadAll() sætter error-state i stedet for kun at console.error'e fejlen", () => {
  assert.match(
    source,
    /const \[error, setError\] = useState\(null\);/,
    "skal deklarere et error-state til loadAll-fejl",
  );
  assert.match(
    source,
    /async function loadAll\(\) \{\s*setError\(null\);/,
    "loadAll skal nulstille error-state ved hvert (re)load, inkl. retry",
  );
  assert.match(
    source,
    /catch \(e\) \{\s*console\.error\("Dashboard load failed:", e\);\s*setError\(e\);/,
    "catch-blokken skal sætte error-state, ikke kun logge",
  );
});

test("#3510 fejlet load renderer den kanoniske ErrorState med retry, ikke et tomt dashboard", () => {
  assert.match(
    source,
    /if \(error\) return \(/,
    "der skal være et eksplicit error-early-return, ligesom loading-checket",
  );
  assert.match(
    source,
    /<ErrorState[\s\S]{0,200}?title=\{t\("dashboard:loadError"\)\}/,
    "ErrorState skal bruge den kanoniske komponent (docs/design/PAGE_TEMPLATES.md), ikke ny markup",
  );
  assert.match(
    source,
    /onClick=\{\(\) => \{ setLoading\(true\); loadAll\(\); \}\}/,
    "retry-knappen skal genkalde loadAll (samme mønster som StandingsPage/#2175)",
  );
  // Retry er ALTID secondary, aldrig gold (PAGE_TEMPLATES.md §Canonical states).
  assert.match(
    source,
    /<Button size="sm" variant="secondary" onClick=\{\(\) => \{ setLoading\(true\); loadAll\(\); \}\}>\{t\("dashboard:retry"\)\}<\/Button>/,
    "retry-knappen skal være secondary sm, aldrig gold",
  );
});

test("#3510 recentResults + riderRanking defaulter til null (ikke []), så post-paint-fetch kan skelnes fra bekræftet tom", () => {
  assert.match(
    source,
    /const \[recentResults, setRecentResults\] = useState\(null\);/,
    "recentResults skal default til null (loading), ikke [] (empty)",
  );
  assert.match(
    source,
    /const \[riderRanking, setRiderRanking\] = useState\(null\);/,
    "riderRanking skal default til null (loading), ikke [] (empty)",
  );
});

function blockBetween(str, startMarker, endMarker) {
  const start = str.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = str.indexOf(endMarker, start);
  assert.ok(end >= 0, `end marker not found: ${endMarker}`);
  return str.slice(start, end);
}

test("#3510 begge post-paint-moduler renderer skeleton for null og empty-state kun for bekræftet []", () => {
  const recentResultsBlock = blockBetween(
    source, "recentResults === null ? (", ") : recentResults.length === 0 ? (",
  );
  assert.match(
    recentResultsBlock,
    /<SkeletonLines lines=\{3\} \/>/,
    "recentResults === null skal vise SkeletonLines, ikke empty-state",
  );

  const riderRankingBlock = blockBetween(
    source, "riderRanking === null ? (", ") : riderRanking.length === 0 ? (",
  );
  assert.match(
    riderRankingBlock,
    /<SkeletonLines lines=\{3\} \/>/,
    "riderRanking === null skal vise SkeletonLines, ikke empty-state",
  );
});

test("#3510 en fejlet/ikke-ok post-paint-fetch falder eksplicit tilbage til [] (undgår evig skeleton)", () => {
  assert.match(
    source,
    /setRecentResults\(r\.ok \? \(await r\.json\(\)\)\.races \|\| \[\] : \[\]\);/,
    "recentResults skal sættes til [] når responsen ikke er ok",
  );
  assert.match(
    source,
    /catch \{ if \(!cancelled\) setRecentResults\(\[\]\); \}/,
    "netværksfejl skal også falde tilbage til [] for recentResults",
  );
  assert.match(
    source,
    /setRiderRanking\(r\.ok \? \(await r\.json\(\)\)\.riders \|\| \[\] : \[\]\);/,
    "riderRanking skal sættes til [] når responsen ikke er ok",
  );
  assert.match(
    source,
    /catch \{ if \(!cancelled\) setRiderRanking\(\[\]\); \}/,
    "netværksfejl skal også falde tilbage til [] for riderRanking",
  );
});

test("#3510 ErrorState/Button/SkeletonLines er importeret fra den kanoniske ui-barrel", () => {
  assert.match(
    source,
    /import \{\s*Card, AlertTriangleIcon, XIcon, ArrowDownIcon, ChevronRightIcon, PageLoader,\s*PageHeader, Section, SectionHeader, SectionAction, Button, ErrorState, SkeletonLines,\s*\} from "\.\.\/components\/ui";/,
    "skal importere Button/ErrorState/SkeletonLines fra ../components/ui, ikke opfinde ny markup",
  );
});

test("locale keys referenced by the new dashboard error surface exist in both en + da (key-parity)", () => {
  const en = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "locales", "en", "dashboard.json"), "utf8"));
  const da = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "locales", "da", "dashboard.json"), "utf8"));
  assert.ok(en.loadError, "en dashboard.json mangler loadError");
  assert.ok(en.retry, "en dashboard.json mangler retry");
  assert.ok(da.loadError, "da dashboard.json mangler loadError");
  assert.ok(da.retry, "da dashboard.json mangler retry");
  // #2849 — no em-dash in player-facing copy (tone-check-em-dash.mjs gate).
  assert.doesNotMatch(en.loadError, /—/);
  assert.doesNotMatch(da.loadError, /—/);
});
