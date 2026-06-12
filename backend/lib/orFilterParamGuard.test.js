// Security-audit 2026-06-12: ruter der sender raw URL-params ind i PostgREST
// .or()-filterstrenge skal UUID-validere parametret FØR query-bygning.
// Uden guard kan en crafted :id (fx "x,id.gt.00000000-0000-0000-0000-000000000000")
// injicere ekstra or-betingelser og enumerere på tværs af ryttere/hold.
// Kontrakt-test i samme stil som adminRouteOwnership.test.js: læser kilden og
// beviser at guarden står foran de sårbare ruter.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");

function routeBlock(routePath) {
  const start = apiSource.indexOf(`"${routePath}"`);
  assert.notEqual(start, -1, `route ${routePath} findes ikke i api.js`);
  // Blokken frem til næste route-registrering er rigeligt til at indeholde guarden.
  const end = apiSource.indexOf("router.", start);
  return apiSource.slice(start, end === -1 ? start + 800 : end);
}

test("riders/:id/history UUID-validerer param før .or()-interpolation", () => {
  const block = routeBlock("/riders/:id/history");
  assert.match(block, /UUID_RE\.test\(req\.params\.id\)/);
});

test("teams/:id/transfer-history UUID-validerer param før .or()-interpolation", () => {
  const block = routeBlock("/teams/:id/transfer-history");
  assert.match(block, /UUID_RE\.test\(req\.params\.id\)/);
});

test("UUID_RE-guarden er defineret i api.js og matcher kun rigtige UUID'er", () => {
  const m = apiSource.match(/const UUID_RE = (\/.*\/i);/);
  assert.ok(m, "UUID_RE-definition mangler i api.js");
  // Rekonstruér regex-literal fra kildekontrakten (strip "/" + "/i").
  const re = new RegExp(m[1].slice(1, -2), "i");
  assert.ok(re.test("123e4567-e89b-12d3-a456-426614174000"));
  assert.ok(!re.test("x,id.gt.00000000-0000-0000-0000-000000000000"));
  assert.ok(!re.test("123e4567-e89b-12d3-a456-426614174000,status.eq.pending"));
  assert.ok(!re.test(""));
});
