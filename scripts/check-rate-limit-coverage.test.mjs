// scripts/check-rate-limit-coverage.test.mjs
// Tests for the rate-limit-coverage forward-guard. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { scan, stripCommentsKeepStrings, compareAgainstBaseline } from "./check-rate-limit-coverage.mjs";

test("flags a requireAuth GET route with no inline limiter and no covering mount", () => {
  const src = `router.get("/riders", requireAuth, async (req, res) => {\n  res.json({});\n});`;
  const f = scan(src, "api.js");
  assert.equal(f.length, 1);
  assert.equal(f[0].method, "GET");
  assert.equal(f[0].path, "/riders");
  assert.deepEqual(f[0].middlewares, ["requireAuth"]);
});

test("flags a requireAuth POST route with no inline limiter (write routes are in scope too)", () => {
  const src = `router.post("/riders/names", requireAuth, async (req, res) => {\n  res.json({});\n});`;
  const f = scan(src, "api.js");
  assert.equal(f.length, 1);
  assert.equal(f[0].method, "POST");
});

test("does NOT flag a route with an inline <x>Limiter middleware", () => {
  const src = `router.post("/transfers", requireAuth, marketWriteLimiter, async (req, res) => {\n});`;
  assert.equal(scan(src, "api.js").length, 0);
});

test("does NOT flag a requireAdmin route under a rate-limited router.use(...) mount", () => {
  const src = [
    'router.use("/admin", adminApiLimiter);',
    'router.get("/admin/metrics", requireAdmin, async (req, res) => {',
    "});",
  ].join("\n");
  assert.equal(scan(src, "api.js").length, 0);
});

test("DOES flag a requireAdmin route NOT under any rate-limited mount", () => {
  const src = [
    'router.use("/admin", adminApiLimiter);',
    'router.get("/reports/summary", requireAdmin, async (req, res) => {',
    "});",
  ].join("\n");
  const f = scan(src, "api.js");
  assert.equal(f.length, 1);
  assert.equal(f[0].path, "/reports/summary");
});

test("mount coverage respects path boundaries (does not match a false-prefix path)", () => {
  const src = [
    'router.use("/admin", adminApiLimiter);',
    'router.get("/admin2/x", requireAuth, async (req, res) => {',
    "});",
  ].join("\n");
  const f = scan(src, "api.js");
  assert.equal(f.length, 1, "/admin2 must NOT be treated as covered by an /admin mount");
});

test("mount coverage matches the mount path itself, not just deeper sub-paths", () => {
  const src = [
    'router.use("/admin", adminApiLimiter);',
    'router.get("/admin", requireAdmin, async (req, res) => {',
    "});",
  ].join("\n");
  assert.equal(scan(src, "api.js").length, 0);
});

test("does NOT flag public (non-auth-gated) routes", () => {
  const src = `router.get("/health", async (req, res) => {\n  res.json({ ok: true });\n});`;
  assert.equal(scan(src, "api.js").length, 0);
});

test("does NOT flag a route already covered by a direct rateLimit() mount variable name ending in Limiter", () => {
  const src = [
    'router.use("/collect", collectLimiter);',
    'router.post("/collect/extra", requireAuth, async (req, res) => {',
    "});",
  ].join("\n");
  assert.equal(scan(src, "api.js").length, 0);
});

test("handles CRLF line endings (Windows checkout) without losing findings", () => {
  const src = 'router.get("/riders", requireAuth, async (req, res) => {\r\n  res.json({});\r\n});\r\n';
  const f = scan(src, "api.js");
  assert.equal(f.length, 1, "CRLF must not defeat the ROUTE_RE tail match");
  assert.equal(f[0].path, "/riders");
});

test("extracts multiple middlewares in order and detects requireAdmin among several", () => {
  const src = `router.post("/admin/x", someMw, requireAdmin, adminWriteLimiter, async (req, res) => {\n});`;
  assert.equal(scan(src, "api.js").length, 0, "adminWriteLimiter inline should cover it");
});

test("stripCommentsKeepStrings blanks a // comment but preserves the route path string", () => {
  const src = '// router.get("/should-not-count", requireAuth, async (req, res) => {});';
  const stripped = stripCommentsKeepStrings(src);
  assert.ok(!/router\.get/.test(stripped), "line comment must be blanked");
});

test("a commented-out route registration is not flagged", () => {
  const src = '// router.get("/should-not-count", requireAuth, async (req, res) => {});';
  assert.equal(scan(src, "api.js").length, 0);
});

test("compareAgainstBaseline: reports new violations only when count exceeds baseline", () => {
  const findings = [
    { file: "backend/routes/api.js", line: 1, method: "GET", path: "/a" },
    { file: "backend/routes/api.js", line: 2, method: "GET", path: "/b" },
  ];
  const baseline = { files: { "backend/routes/api.js": 1 } };
  const { newViolations } = compareAgainstBaseline(findings, baseline);
  assert.equal(newViolations.length, 1);
  assert.match(newViolations[0], /\+1 ny/);
});

test("compareAgainstBaseline: no new violations when count is at or below baseline", () => {
  const findings = [{ file: "backend/routes/api.js", line: 1, method: "GET", path: "/a" }];
  const baseline = { files: { "backend/routes/api.js": 5 } };
  const { newViolations, stale } = compareAgainstBaseline(findings, baseline);
  assert.equal(newViolations.length, 0);
  assert.equal(stale.length, 1, "should report the baseline as stale/shrinkable");
});

test("compareAgainstBaseline: a brand-new file with findings and no baseline entry is a new violation", () => {
  const findings = [{ file: "backend/routes/other.js", line: 1, method: "GET", path: "/a" }];
  const baseline = { files: {} };
  const { newViolations } = compareAgainstBaseline(findings, baseline);
  assert.equal(newViolations.length, 1);
});
