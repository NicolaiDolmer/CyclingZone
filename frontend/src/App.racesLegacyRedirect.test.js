import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3298: /races?tab=calendar landede på Holdudtagelse (default-fanen i
// Planlægnings-hubben) i stedet for Kalenderen, fordi RacesLegacyRedirect
// smed ?tab=calendar væk og kun sendte til /planning. Denne test holder
// RacesLegacyRedirect's fire legacy-mål ærlige (kilde-regex, samme mønster
// som App.adminSplatRedirect.test.js — komponenten er ikke eksporteret, og
// App.jsx trækker for mange side-effekt-tunge imports ind til at være en
// fornuftig unit-test-import).

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(__dirname, "App.jsx"), "utf8");

function racesLegacyRedirectBody() {
  const match = appSource.match(/function RacesLegacyRedirect\(\) \{[\s\S]*?\n\}/);
  assert.ok(match, "kunne ikke finde RacesLegacyRedirect i App.jsx");
  return match[0];
}

test("#3298 RacesLegacyRedirect: /races?tab=calendar bevarer fanen (-> /planning?tab=calendar)", () => {
  const body = racesLegacyRedirectBody();
  assert.match(
    body,
    /if \(tab === "calendar"\) return <Navigate to="\/planning\?tab=calendar" replace \/>;/,
    'calendar-grenen skal pege på /planning?tab=calendar, ellers falder brugeren til default-fanen "selection" (Holdudtagelse).',
  );
});

test("RacesLegacyRedirect: verdens-katalog og pointtabel bevares", () => {
  const body = racesLegacyRedirectBody();
  assert.match(body, /if \(tab === "world" \|\| tab === "library"\) return <Navigate to="\/resultater\?tab=archive" replace \/>;/);
  assert.match(body, /if \(tab === "points"\) return <Navigate to="\/resultater\?tab=points" replace \/>;/);
});

test("RacesLegacyRedirect: ukendt/manglende ?tab= falder til /resultater (default-fanen)", () => {
  const body = racesLegacyRedirectBody();
  assert.match(body, /return <Navigate to="\/resultater" replace \/>;\s*\}$/);
});
