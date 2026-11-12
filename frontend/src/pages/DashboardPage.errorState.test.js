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

// #2230: load failure behavior is covered in 5312-dashboard-offline-error.spec.js.

test("#3510 fejlet load renderer den kanoniske ErrorState med retry, ikke et tomt dashboard", () => {
  assert.match(
    source,
    /if \(error\) return \(/,
    "der skal være et eksplicit error-early-return, ligesom loading-checket",
  );
  // #5312: titlen er nu betinget — "naaede aldrig serveren" skal sige noget
  // ANDET end "kunne ikke indlaese dashboardet", fordi de to fejl kraever hver
  // sin handling af spilleren. Komponenten er stadig den kanoniske ErrorState,
  // og loadError er stadig faldbagsteksten; det er hele pointen med guarden.
  // #5322: klassifikatoren er nu isNetworkError, som daekker BEGGE former
  // fejlen kan have — en kastet exception (Supabase-opslagene) OG apiFetch's
  // resultat, der efter #5322 ikke laengere kaster ved en transportfejl.
  assert.match(
    source,
    /<ErrorState[\s\S]{0,300}?title=\{isNetworkError\(error\) \? t\("dashboard:offlineError"\) : t\("dashboard:loadError"\)\}/,
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

test("#5322 et 'naaede aldrig serveren'-resultat loeftes til sidens fejlflade, ikke stille til null", () => {
  // apiFetch kaster ikke laengere ved en transportfejl (#5322). Uden dette
  // loeft ville de to BLOKERENDE kald falde ned i deres `res.ok`-gren, og
  // spilleren ville se et halvtomt dashboard i stedet for "kan ikke naa
  // serveren" — praecis den tilstand #5312 handlede om.
  assert.match(
    source,
    /function failOnUnreachable\(res\) \{\s*if \(res\.networkError\) throw res;\s*return res;\s*\}/,
    "der skal findes en helper der kaster apiFetch-resultatet videre ved networkError",
  );
  assert.match(
    source,
    /apiFetch\(`\$\{API\}\/api\/board\/status`[\s\S]{0,200}?\.then\(failOnUnreachable\)/,
    "board/status (blokerende) skal loefte et netvaerks-resultat til fejlfladen",
  );
  // #2230: my-offers is independent; failure must not replace the whole page.

});

test("#3510 recentResults + riderRanking defaulter til null (ikke []), så post-paint-fetch kan skelnes fra bekræftet tom", () => {
  assert.match(
    source,
    /const \[recentResults, setRecentResults\] = useState\([^;\n]*\(null\)\);/,
    "recentResults skal default til null (loading), ikke [] (empty)",
  );
  assert.match(
    source,
    /const \[riderRanking, setRiderRanking\] = useState\([^;\n]*\(null\)\);/,
    "riderRanking skal default til null (loading), ikke [] (empty)",
  );
});

// #2230: placeholder/content geometry is tested in dashboard-stable-loading.spec.ts.

test("#3510 ErrorState/Button er importeret fra den kanoniske ui-barrel", () => {
  const uiImportMatch = source.match(/import \{([\s\S]*?)\} from "\.\.\/components\/ui";/);
  assert.ok(uiImportMatch, "skal have et import { ... } from \"../components/ui\"");
  const imported = uiImportMatch[1];
  for (const name of ["Button", "ErrorState"]) {
    assert.match(
      imported,
      new RegExp(`\\b${name}\\b`),
      `skal importere ${name} fra ../components/ui, ikke opfinde ny markup`,
    );
  }
});

test("locale keys referenced by the new dashboard error surface exist in both en + da (key-parity)", () => {
  const en = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "locales", "en", "dashboard.json"), "utf8"));
  const da = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "locales", "da", "dashboard.json"), "utf8"));
  assert.ok(en.loadError, "en dashboard.json mangler loadError");
  assert.ok(en.retry, "en dashboard.json mangler retry");
  assert.ok(da.loadError, "da dashboard.json mangler loadError");
  assert.ok(da.retry, "da dashboard.json mangler retry");
  // #5312 — den separate "kan ikke naa serveren"-tekst skal findes i BEGGE
  // sprog, ellers falder den ene ned i raa-noegle-visning paa fejlfladen.
  assert.ok(en.offlineError, "en dashboard.json mangler offlineError");
  assert.ok(da.offlineError, "da dashboard.json mangler offlineError");
  // #2849 — no em-dash in player-facing copy (tone-check-em-dash.mjs gate).
  assert.doesNotMatch(en.loadError, /—/);
  assert.doesNotMatch(da.loadError, /—/);
  assert.doesNotMatch(en.offlineError, /—/);
  assert.doesNotMatch(da.offlineError, /—/);
});
