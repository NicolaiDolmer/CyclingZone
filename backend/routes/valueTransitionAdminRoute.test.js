// #3750/#4000 — kildetekst-guard: admin-forhåndsvisningen af værdi-overgangen
// SKAL være admin-gated. Samme mønster som feedback.routes.test.js (scanner
// route-headeren i api.js i stedet for at boote hele Express-appen).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "api.js"), "utf8");

test("GET /admin/value-transition er registreret med requireAdmin", () => {
  const m = src.match(/router\.get\("\/admin\/value-transition",([^)]*)/);
  assert.ok(m, "ruten /admin/value-transition findes i api.js");
  assert.match(m[1], /requireAdmin/);
});

test("ruten er read-only: ingen POST/PUT/DELETE på /admin/value-transition", () => {
  assert.doesNotMatch(src, /router\.(post|put|delete)\("\/admin\/value-transition/);
});
