// #3750/#4000 — kildetekst-guard: forhåndsvisningen af værdi-overgangen SKAL
// være EJER-gated (requireOwner = requireAdmin + OWNER_USER_IDS), ikke kun
// admin-gated (22/8: en ven har admin-rollen). Samme mønster som
// feedback.routes.test.js (scanner route-headeren i api.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "api.js"), "utf8");

test("GET /admin/value-transition er registreret med requireOwner (ejer-only)", () => {
  const m = src.match(/router\.get\("\/admin\/value-transition",([^)]*)/);
  assert.ok(m, "ruten /admin/value-transition findes i api.js");
  assert.match(m[1], /requireOwner/);
});

test("requireOwner bygger oven på requireAdmin og nægter med 'Owner only'", () => {
  const m = src.match(/async function requireOwner\(req, res, next\) \{([\s\S]*?)\n\}/);
  assert.ok(m, "requireOwner er defineret");
  assert.match(m[1], /requireAdmin\(req, res/);
  assert.match(m[1], /isOwnerUser\(req\.user\?\.id\)/);
  assert.match(m[1], /Owner only/);
});

test("GET /admin/owner-check er admin-gated og svarer kun med isOwner", () => {
  const m = src.match(/router\.get\("\/admin\/owner-check",([^)]*)/);
  assert.ok(m, "ruten /admin/owner-check findes i api.js");
  assert.match(m[1], /requireAdmin/);
});

test("ruten er read-only: ingen POST/PUT/DELETE på /admin/value-transition", () => {
  assert.doesNotMatch(src, /router\.(post|put|delete)\("\/admin\/value-transition/);
});
