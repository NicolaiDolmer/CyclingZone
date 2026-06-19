import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dirname, "../server.js"), "utf8");
const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");

test("admin season routes live only in the api router", () => {
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/admin\/import-results"/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/admin\/seasons\/:id\/start"/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/admin\/seasons\/:id\/end"/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/admin\/seasons\/:id\/rebuild-standings"/);

  assert.match(apiSource, /router\.post\(\s*"\/admin\/seasons\/:id\/start"/);
  assert.match(apiSource, /router\.post\(\s*"\/admin\/seasons\/:id\/end"/);
  assert.match(apiSource, /router\.post\(\s*"\/admin\/seasons\/:id\/rebuild-standings"/);
});

// #1180 pkt 3+4 / #1179 / #1207 (2026-06-12): manuel resultatimport (Excel + Sheets),
// dyn_cyclist-stats-sync og UCI-sheets-sync er pensioneret efter relaunch til fiktive
// ryttere med egen race-motor. PCM-importen (/admin/import-results-pcm) er den eneste
// bevidst bevarede import-fallback (epic #1105). Forward-guard: ruterne må ikke genopstå.
test("pensionerede import-/sync-routes må ikke genopstå (#1179/#1207)", () => {
  assert.doesNotMatch(apiSource, /router\.post\(\s*"\/admin\/import-results"\s*,/);
  assert.doesNotMatch(apiSource, /"\/admin\/import-results-sheets"/);
  assert.doesNotMatch(apiSource, /"\/admin\/sync-dyn-cyclist"/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/admin\/sync-uci"/);
  assert.doesNotMatch(apiSource, /"\/admin\/sync-uci"/);

  // PCM-fallback skal bestå indtil #1021 (fuld motor) er modnet post-launch.
  assert.match(apiSource, /router\.post\(\s*"\/admin\/import-results-pcm"/);
});

// Security-hardening (2026-06-20, security-audit): forward-guard mod en fremtidig
// regression hvor en /admin/*-rute registreres uden requireAdmin (fx kun requireAuth
// eller helt ugated). Enumererer ALLE /admin/*-route-registreringer i api.js og
// kræver at requireAdmin står som middleware i hver registrerings-header. Audit'en
// (2026-06-20) bekræftede at alle ~87 admin-ruter ER gated — testen skal være grøn.
test("alle /admin/*-ruter har requireAdmin-middleware (#security-audit forward-guard)", () => {
  // Match både single-line (router.post("/admin/x", requireAdmin, ...)) og multi-line
  // (router.post(\n  "/admin/x",\n  requireAdmin,\n ...)) registreringer. Vi fanger
  // selve router.<verb>(-kaldet og kigger på alt frem til handler-funktionen.
  const ROUTE_RE = /router\.(get|post|put|patch|delete)\(\s*(["'])(\/admin\/[^"']*)\2([\s\S]*?)(?:async\s*\(|\(req)/g;

  const adminRoutes = [];
  let m;
  while ((m = ROUTE_RE.exec(apiSource)) !== null) {
    const [, verb, , routePath, middlewareSegment] = m;
    adminRoutes.push({ verb, routePath, middlewareSegment });
  }

  // Sanity: vi forventer et betydeligt antal admin-ruter. Falder dette til ~0 er
  // regex'en (ikke koden) brudt — fang det eksplicit frem for en falsk grøn test.
  assert.ok(
    adminRoutes.length >= 80,
    `forventede mange /admin/*-ruter, fandt kun ${adminRoutes.length} — regex sandsynligvis brudt`,
  );

  const ungated = adminRoutes.filter(
    (r) => !/\brequireAdmin\b/.test(r.middlewareSegment),
  );
  assert.deepEqual(
    ungated.map((r) => `${r.verb.toUpperCase()} ${r.routePath}`),
    [],
    "fandt /admin/*-rute(r) uden requireAdmin-middleware",
  );
});
