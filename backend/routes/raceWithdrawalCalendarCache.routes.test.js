// #6514 — kalender-svaret bærer holdets afmeldt-status og er cachet (namespace "calendar").
// Begge afmeldings-mutationer skal derfor invalidere cachen, ellers viser kortet den gamle status.
// Kildetekst-scan (api.js kan ikke køres uden live Supabase), samme mønster som raceSelectionBulk.routes.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "api.js"), "utf8");

function block(marker) {
  const start = apiSource.indexOf(marker);
  assert.ok(start >= 0, `${marker} findes`);
  const next = apiSource.indexOf("\nrouter.", start + marker.length);
  return apiSource.slice(start, next === -1 ? undefined : next);
}

test("POST /races/:raceId/withdrawal invaliderer calendar-cachen", () => {
  assert.match(block('router.post("/races/:raceId/withdrawal"'), /invalidateNamespace\("calendar"\)/);
});

test("DELETE /races/:raceId/withdrawal invaliderer calendar-cachen", () => {
  assert.match(block('router.delete("/races/:raceId/withdrawal"'), /invalidateNamespace\("calendar"\)/);
});

// Kalenderens `entered` kommer fra udtagelsen, saa hver vellykket udtagelses-skrivning
// (gem/ryd, bulk, auto-udfyld) skal ogsaa invalidere cachen (Codex P2 paa PR #6680).
for (const marker of [
  'router.put("/races/:raceId/selection"',
  'router.put("/races/selection/bulk"',
  'router.post("/races/:raceId/selection/auto"',
  'router.post("/races/distribution/regenerate"',
  'router.post("/races/distribution/clear"',
]) {
  test(`${marker} invaliderer calendar-cachen efter vellykket skrivning`, () => {
    assert.match(block(marker), /invalidateNamespace\("calendar"\)/);
  });
}
