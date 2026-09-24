// #5686 — kildetekst-guard for værdi-forhåndsvisningen: ruten SKAL være
// EJER-gated (requireOwner), read-only (ingen POST/PUT/DELETE), validere
// query-parametrene FØR beregningen og hente sine tal fra adminValuePreview.js
// (samme sti som søndagskørslen), ikke en formel i api.js. Samme mønster som
// valueTransitionAdminRoute.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "api.js"), "utf8");

function routeBlock() {
  const start = src.indexOf('router.get("/admin/value-preview"');
  assert.ok(start >= 0, "ruten /admin/value-preview findes i api.js");
  const end = src.indexOf("\n});", start);
  return src.slice(start, end);
}

test("GET /admin/value-preview er registreret med requireOwner (ejer-only)", () => {
  const m = src.match(/router\.get\("\/admin\/value-preview",([^)]*)/);
  assert.ok(m);
  assert.match(m[1], /requireOwner/);
  assert.doesNotMatch(m[1], /requireAdmin\b/, "requireAdmin alene er ikke nok (andre konti har admin-rollen)");
});

test("ruten er read-only: ingen POST/PUT/PATCH/DELETE på /admin/value-preview", () => {
  assert.doesNotMatch(src, /router\.(post|put|patch|delete)\("\/admin\/value-preview/);
});

test("ruten validerer to/step og svarer 400 før der regnes", () => {
  const block = routeBlock();
  assert.match(block, /parseValuePreviewQuery\(req\.query\)/);
  assert.match(block, /status\(400\)/);
  assert.ok(block.indexOf("status(400)") < block.indexOf("getPreview("), "valideringen kommer før beregningen");
});

test("tallene kommer fra adminValuePreview.js, ikke en formel i ruten", () => {
  assert.match(src, /import \{ createValuePreviewService, parseValuePreviewQuery \} from "\.\.\/lib\/adminValuePreview\.js"/);
  const block = routeBlock();
  assert.match(block, /valuePreviewService\.getPreview\(supabase, \{ to: parsed\.to, step: parsed\.step \}\)/);
  assert.doesNotMatch(block, /recomputeRiderValue|predictBaseValue|\.update\(|\.insert\(|\.upsert\(/);
});

test("lib'en importerer produktionens recomputeRiderValue og skriver intet", () => {
  const lib = readFileSync(join(__dirname, "../lib/adminValuePreview.js"), "utf8");
  assert.match(lib, /import \{ recomputeRiderValue \} from "\.\/riderValueRefresh\.js"/);
  assert.match(lib, /VALUATION_MODEL_IDS/);
  // (Map#delete(key) er cache-oprydning; supabase's .delete() tager ingen argumenter.)
  assert.doesNotMatch(lib, /\.(update|insert|upsert|rpc)\(|\.delete\(\)/, "ingen skrivning fra forhåndsvisningen");
  assert.doesNotMatch(lib, /["']v[0-9]["']/, "ingen hårdkodede model-nøgler");
});
