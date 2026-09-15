// #4983 — kontrakt-vagt for hooket bag den synlige udtagelses-påmindelse.
//
// Hooket selv kan ikke køres her: repoet har bevidst ingen jsdom/React-loader
// (samme grund som App.authRestore.test.js), og hooket kalder både supabase og
// fetch. Testen læser derfor KILDEN, præcis som dashboardUxPakke.routes.test.js
// gør for api.js. Den vogter de to egenskaber to CodeRabbit-fund på PR #5108
// handlede om — og som begge er usynlige i en almindelig gennemlæsning:
//
//   1. cache-nøglen SKAL være bundet til den indloggede manager. Ellers kan et
//      svar der stadig er undervejs når manager A logger ud lande på den faste
//      nøgle bagefter, og manager B ser A's løb indtil TTL'en (60 s) løber ud.
//   2. der SKAL findes en vej til at bede begge forbrugere (Layout og
//      PlanningHubPage) om friske tal efter profilens til/fra — ellers står den
//      gamle nav-markering i op til 5 minutter.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(new URL("./useSelectionReminder.ts", import.meta.url), "utf8");

test("cache-nøglen er scopet til den autentificerede manager", () => {
  assert.match(
    SOURCE,
    /const cacheKey = `\$\{SHARED_KEYS\.selectionReminder\}:\$\{session\.user\.id\}`/,
    "nøglen skal indeholde user-id'et",
  );
  assert.doesNotMatch(
    SOURCE,
    /sharedRequestCache\.(get|invalidate)\(\s*SHARED_KEYS\.selectionReminder\b/,
    "den faste nøgle må ikke bruges nogen steder — hverken til get eller invalidate",
  );
});

test("ProfilePage kan bede begge forbrugere om friske tal", () => {
  assert.match(SOURCE, /export function refreshSelectionReminder\(\)/);
  assert.match(SOURCE, /refreshListeners\.add\(listener\)/, "hver mount skal abonnere");
  assert.match(SOURCE, /refreshListeners\.delete\(listener\)/, "og afmelde sig ved unmount");
});

test("kun ÉN af de to forbrugere invaliderer cachen pr. refresh", () => {
  // Ellers ville forbruger nr. 2 smide forbruger nr. 1's in-flight-kald væk og
  // fyre et kald mere — modsat hele pointen med sharedRequestCache (#5089).
  assert.match(SOURCE, /if \(force \|\| pendingRefresh\) \{\s*\n\s*pendingRefresh = false;/);
});

test("kun det SENESTE kald må skrive state", () => {
  // invalidate() fjerner kun det cachede løfte — et interval-tick der allerede
  // er sendt løber videre og ville ellers skrive gamle tal oven i et nyere svar
  // (eller, på sin fejl-gren, rydde det).
  assert.match(SOURCE, /const generation = \+\+loadGeneration\.current/);
  assert.equal(
    (SOURCE.match(/if \(isCurrent\(\)\)/g) ?? []).length, 4,
    "alle fire state-skrivninger (no-session, svar, fejl, setLoaded) skal være vagtet",
  );
});

test("ProfilePage kalder refreshSelectionReminder efter en vellykket PATCH", () => {
  const profile = readFileSync(new URL("../pages/ProfilePage.jsx", import.meta.url), "utf8");
  const start = profile.indexOf("async function toggleSelectionReminder");
  assert.ok(start > -1, "toggleSelectionReminder skal findes");
  const handler = profile.slice(start, profile.indexOf("\n  }", start));
  assert.match(handler, /refreshSelectionReminder\(\)/);
  assert.match(handler, /res\.status === 503/, "503 er 'prøv igen om lidt', ikke en fejl at rapportere");
});
