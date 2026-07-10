import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #2244 Slice C follow-up: POST /api/riders/names — batch-opslag af rytternavne
// til Scouting-centralen (op til ~100 ids i ét kald i stedet for N enkelt-GETs).
// Samme statiske source-contract-stil som riderActionsRoutes.test.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(method, routePath) {
  const marker = `router.${method}("${routePath}"`;
  const start = apiSource.indexOf(marker);
  assert.notEqual(start, -1, `route ${method.toUpperCase()} ${routePath} findes ikke i api.js`);
  const end = apiSource.indexOf("\nrouter.", start + marker.length);
  return apiSource.slice(start, end === -1 ? start + 3000 : end);
}

test("POST /riders/names findes med requireAuth", () => {
  const block = routeBlock("post", "/riders/names");
  assert.match(block, /requireAuth/, "batch-navne-route skal bruge requireAuth");
});

test("POST /riders/names selecter KUN id og name — potentiale forlader aldrig serveren", () => {
  const block = routeBlock("post", "/riders/names");
  assert.match(block, /\.select\("id, name"\)/, "batch-navne-route må kun selecte id + name");
  assert.doesNotMatch(block, /potentiale/, "potentiale må ikke optræde i batch-navne-routen");
});

test("POST /riders/names capper antal ids og UUID-validerer input", () => {
  const block = routeBlock("post", "/riders/names");
  assert.match(block, /ids\.length > 200/, "batch-navne-route skal cappe antal ids");
  assert.match(block, /UUID_RE\.test/, "batch-navne-route skal UUID-validere ids før .in()");
});
