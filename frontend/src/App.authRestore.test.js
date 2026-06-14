import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1347 — initial session-restore må ALDRIG strande appen på en evig spinner.
// App.jsx render <LoadingScreen /> så længe `session === undefined`. Tidligere
// håndterede koden kun den resolved getSession()-path; ved rejection
// (offline/network-fejl eller malformed/udløbet gemt session) forblev session
// undefined og loaderen hang for evigt. Disse tests holder catch-handleren ærlig
// (samme source-assertion-mønster som resten af page-test-suiten — ingen jsdom).

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(__dirname, "App.jsx"), "utf8");

test("App's initial getSession() har en .catch() (#1347)", () => {
  assert.match(
    appSource,
    /supabase\.auth\.getSession\(\)[\s\S]*?\.catch\(/,
    "getSession() mangler en .catch() — en rejection (offline/malformed session) efterlader session === undefined og loaderen hænger for evigt",
  );
});

test("catch-handleren sætter en terminal (ikke-undefined) session-state (#1347)", () => {
  // Loaderen vises mens session === undefined. catch SKAL sætte session til en
  // terminal værdi (null = unauthenticated) så <LoadingScreen /> forsvinder.
  const catchBlock = appSource.match(/\.catch\(\([^)]*\)\s*=>\s*\{([\s\S]*?)\}\);/);
  assert.ok(catchBlock, "kunne ikke finde catch-blokken på getSession()");
  assert.match(
    catchBlock[1],
    /setSession\(null\)/,
    "catch-blokken skal setSession(null) så appen lander i en terminal unauthenticated-state i stedet for en uendelig spinner",
  );
});

test("App render stadig LoadingScreen KUN mens session === undefined (#1347)", () => {
  // Sikrer at terminal-staten (null) faktisk slipper forbi loader-gaten.
  assert.match(
    appSource,
    /if\s*\(\s*session\s*===\s*undefined\s*\)\s*\{[\s\S]*?return\s*<LoadingScreen\s*\/>/,
    "loader-gaten skal være session === undefined; ellers ville setSession(null) ikke afslutte spinneren",
  );
});
