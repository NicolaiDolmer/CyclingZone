// Disk-IO regressions-guard (2026-06-29): /api/presence skrev tidligere last_seen
// ved HVERT heartbeat-kald → 281k UPDATEs + WAL + dead tuples, en væsentlig kilde
// til disk-IO-budget-forbrug. Fixet ruter gennem touch_user_presence-RPC der kun
// skriver hvis stemplet er >60s gammelt.
// Kontrakt-test i samme stil som orFilterParamGuard.test.js: læser kilden og
// beviser at den throttlede sti står, og at det ubetingede UPDATE ikke er tilbage.

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
  const end = apiSource.indexOf("router.", start);
  return apiSource.slice(start, end === -1 ? start + 800 : end);
}

test("/presence kalder den throttlede touch_user_presence-RPC", () => {
  const block = routeBlock("/presence");
  assert.match(
    block,
    /supabase\.rpc\(\s*["']touch_user_presence["']/,
    "/presence skal route gennem touch_user_presence-RPC (60s-throttle)",
  );
});

test("/presence laver ikke et ubetinget last_seen-UPDATE længere", () => {
  const block = routeBlock("/presence");
  assert.doesNotMatch(
    block,
    /\.update\(\s*\{\s*last_seen/,
    "ubetinget .update({ last_seen ... }) i /presence genintroducerer write-amplification",
  );
});
