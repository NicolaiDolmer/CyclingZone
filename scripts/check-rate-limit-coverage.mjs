#!/usr/bin/env node
// scripts/check-rate-limit-coverage.mjs
// ============================================================
// Forward-guard: every auth-gated route (requireAuth or requireAdmin) must be
// rate-limit-covered — either an inline `<name>Limiter` middleware on the
// route itself, or a `router.use(<prefix>, <name>Limiter)` mount whose prefix
// the route's path falls under.
//
// Origin (#530): the issue originally flagged workflow-permissions AND
// rate-limit-coverage as one issue. The workflow-permissions half is already
// fixed (dbf1fe2fb, 11ae8a578) — this script is the remaining half.
//
// Verified zero-point (2026-08-30, this PR's audit): `backend/routes/api.js`
// has NO global rate limiter across the whole API. Two mounts exist:
//   - `router.use("/admin", adminApiLimiter)` — a coarse 600/min DoS guard
//     covering EVERY /admin/* route (GET included), on top of the tighter
//     per-route `adminWriteLimiter` etc. on writes.
//   - `router.use("/collect", collectLimiter)`-shaped IP-keyed guard on the
//     single anonymous telemetry route.
// Every OTHER `requireAuth`-gated route (the ~76 non-admin GET routes) has
// ZERO rate-limit coverage — no global limiter, no per-route limiter. THAT is
// the real, uncovered gap this guard targets — not the 39 admin GET routes,
// which the issue's original "115 GET routes, none covered" count missed
// because it didn't account for the /admin router.use() mount.
//
// Convention this guard relies on (see backend/lib/rateLimiters.js): every
// rate-limiting middleware in this codebase is named `<something>Limiter`
// (bidLimiter, marketWriteLimiter, adminWriteLimiter, adminApiLimiter,
// collectLimiter, …). A route is "covered" if:
//   1. one of its own middleware arguments matches /Limiter$/, OR
//   2. its path falls under a `router.use(<prefix>, <xLimiter>)` mount
//      (exact prefix match or prefix + "/").
//
// Scope: only ROUTE REGISTRATIONS gated by `requireAuth` or `requireAdmin`
// are checked (public/unauthenticated routes are out of scope — they either
// have their own direct rateLimit() call, per the CodeQL-visibility comment
// in api.js, or are deliberately unauthenticated reads). This is a FORWARD
// guard shape (ratchet with baseline), not a retroactive fix — the ~76
// currently-uncovered GET routes are NOT rate-limited by this PR; they are
// grandfathered into the baseline so NEW uncovered routes fail CI while the
// existing backlog is fixed incrementally in follow-up PRs.
//
// Line-based, not full-AST: every route registration in this codebase is
// written as a single line (`router.<method>("path", mw1, mw2, async (req,
// res) => {`), verified by grep across api.js before writing this guard. A
// route header that is reflowed across multiple lines will NOT be seen by
// this scan — acceptable given the established single-line convention, but
// worth knowing if that convention ever drifts.
//
// Usage:
//   node scripts/check-rate-limit-coverage.mjs                 # default dirs
//   node scripts/check-rate-limit-coverage.mjs path/to/file.js # explicit files
//   node scripts/check-rate-limit-coverage.mjs --update-baseline
//   npm run lint:rate-limit-coverage
//
// Exit codes:
//   0 — no NEW violations (baseline-covered findings are allowed)
//   1 — at least one NEW uncovered auth-gated route (not in baseline)
//   2 — internal error
//
// Refs #530.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DIRS = ["backend/routes"];
const SCAN_EXTS = new Set([".js", ".mjs", ".cjs"]);
const TEST_FILE_RE = /\.test\.[cm]?js$/;
const BASELINE_PATH = "scripts/rate-limit-coverage-baseline.json";
const AUTH_MIDDLEWARE = new Set(["requireAuth", "requireAdmin"]);
const LIMITER_RE = /Limiter$/;
const HTTP_METHODS = "get|post|put|patch|delete";

// Blank // line-comments and /* *​/ block-comments while PRESERVING string
// literals (route paths and mount prefixes ARE string literals) and newlines
// (so line numbers stay accurate). Same approach as lint-pagination-guard.mjs
// (each guard stays standalone per repo convention).
export function stripCommentsKeepStrings(src) {
  const n = src.length;
  let out = "";
  let i = 0;
  let state = 0; // 0 code · 1 line-comment · 2 block-comment · 3 '..' · 4 ".." · 5 `..`
  while (i < n) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (state === 0) {
      if (c2 === "//") { state = 1; out += "  "; i += 2; continue; }
      if (c2 === "/*") { state = 2; out += "  "; i += 2; continue; }
      if (c === "'") { state = 3; out += c; i++; continue; }
      if (c === '"') { state = 4; out += c; i++; continue; }
      if (c === "`") { state = 5; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 1) {
      if (c === "\n") { state = 0; out += "\n"; } else out += " ";
      i++; continue;
    }
    if (state === 2) {
      if (c2 === "*/") { state = 0; out += "  "; i += 2; continue; }
      out += (c === "\n" ? "\n" : " "); i++; continue;
    }
    if (c === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
    if ((state === 3 && c === "'") || (state === 4 && c === '"') || (state === 5 && c === "`")) {
      state = 0;
    }
    out += c; i++; continue;
  }
  return out;
}

const ROUTE_RE = new RegExp(
  `^\\s*router\\.(${HTTP_METHODS})\\(\\s*(["'\`])((?:\\\\.|(?!\\2).)*)\\2\\s*,\\s*(.*)$`,
);
const MOUNT_RE = new RegExp(
  `^\\s*router\\.use\\(\\s*(["'\`])((?:\\\\.|(?!\\1).)*)\\1\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\)`,
);

// Peels off leading `identifier,` tokens (the middleware list) until the
// remainder no longer matches that shape — which is exactly where the
// handler (an arrow function, `async (...)`, or a bare function reference
// with no trailing comma) begins. A trailing handler reference is correctly
// NOT captured, since it has no comma after it.
function extractMiddlewares(rest) {
  const mws = [];
  let s = rest;
  for (;;) {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*,\s*/.exec(s);
    if (!m) break;
    mws.push(m[1]);
    s = s.slice(m[0].length);
  }
  return mws;
}

function pathUnderPrefix(path, prefix) {
  if (path === prefix) return true;
  return path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

/**
 * Scan one source file for auth-gated route registrations lacking rate-limit
 * coverage (no inline `<x>Limiter` middleware, and not under a
 * `router.use(<prefix>, <x>Limiter)` mount).
 *
 * @param {string} source
 * @param {string} filename
 * @returns {Array<{file:string,line:number,method:string,path:string,middlewares:string[]}>}
 */
export function scan(source, filename = "<source>") {
  // Normalise CRLF -> LF first: this codebase's files carry CRLF line endings
  // (Windows checkouts), and an unstripped trailing \r defeats the `(.*)$`
  // tail of ROUTE_RE (`.` never matches a LineTerminator, which includes \r,
  // so `$` can't reach the absolute end of the string).
  const code = stripCommentsKeepStrings(source.replace(/\r\n/g, "\n"));
  const lines = code.split("\n");

  // Pass 1: collect rate-limited mount prefixes anywhere in the file.
  const coveredPrefixes = [];
  for (const line of lines) {
    const m = MOUNT_RE.exec(line);
    if (m && LIMITER_RE.test(m[3])) coveredPrefixes.push(m[2]);
  }

  // Pass 2: find auth-gated route registrations lacking coverage.
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ROUTE_RE.exec(lines[i]);
    if (!m) continue;
    const [, method, , path, rest] = m;
    const middlewares = extractMiddlewares(rest);
    const isAuthGated = middlewares.some((mw) => AUTH_MIDDLEWARE.has(mw));
    if (!isAuthGated) continue;
    const hasInlineLimiter = middlewares.some((mw) => LIMITER_RE.test(mw));
    if (hasInlineLimiter) continue;
    const coveredByMount = coveredPrefixes.some((prefix) => pathUnderPrefix(path, prefix));
    if (coveredByMount) continue;
    findings.push({ file: filename, line: i + 1, method: method.toUpperCase(), path, middlewares });
  }
  return findings;
}

const toPosix = (p) => p.split(sep).join("/");

function walk(dir, acc) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    if (e === "node_modules" || e === "dist" || e === "build" || e === ".git") continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, acc);
    else if (st.isFile() && SCAN_EXTS.has(extname(p)) && !TEST_FILE_RE.test(p)) acc.push(toPosix(p));
  }
  return acc;
}

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try { return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? ""); }
  catch { return false; }
}

// --- Baseline-ratchet (kun stigninger fejler) ------------------------------
// Samme form som lint-pagination-guard.mjs / lint-ui-slop.mjs: en count pr.
// fil. #530's audit fandt ~76 eksisterende ukendte GET-ruter (requireAuth,
// ikke under /admin) uden dækning — for mange til at rate-limite i denne PR.
// Baselinen grandfathrer dem; kun NYE uncovered ruter fejler CI.

function countsByFile(findings) {
  const byFile = {};
  for (const f of findings) byFile[f.file] = (byFile[f.file] || 0) + 1;
  return byFile;
}

export function compareAgainstBaseline(findings, baseline) {
  const cur = countsByFile(findings);
  const base = baseline.files || {};
  const newViolations = [];
  const stale = [];

  for (const [file, n] of Object.entries(cur)) {
    const max = base[file] || 0;
    if (n > max) {
      newViolations.push(`${file}: ${n} uncovered route(r) (baseline tillader ${max}, +${n - max} ny(e))`);
    }
  }
  for (const [file, max] of Object.entries(base)) {
    const n = cur[file] || 0;
    if (n < max) {
      stale.push(`${file}: ${n}/${max} tilbage (baseline kan strammes)`);
    }
  }
  return { newViolations, stale };
}

function buildBaseline(findings) {
  const files = countsByFile(findings);
  const sorted = {};
  for (const file of Object.keys(files).sort()) sorted[file] = files[file];
  return {
    $comment:
      "Kendte auth-gated ruter (requireAuth/requireAdmin) uden rate-limit-daekning "
      + "(ratchet - maa kun skrumpe). Hovedparten er GET-ruter (#530's audit: ~76 "
      + "ikke-admin GET-ruter uden nogen limiter, hverken inline eller global). "
      + "Genereret af scripts/check-rate-limit-coverage.mjs --update-baseline. "
      + "Nye overtraedelser maa IKKE tilfoejes her - tilfoej en <x>Limiter fra "
      + "backend/lib/rateLimiters.js paa selve ruten, eller monter en "
      + "router.use(<prefix>, <x>Limiter). Refs #530.",
    files: sorted,
  };
}

function run() {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes("--update-baseline");
  const explicitFiles = args.filter((a) => a !== "--update-baseline").map(toPosix);
  const usingDefaultDirs = explicitFiles.length === 0;
  const files = usingDefaultDirs ? DEFAULT_DIRS.flatMap((d) => walk(d, [])) : explicitFiles;

  const findings = [];
  for (const f of files) {
    let src;
    try { src = readFileSync(f, "utf8"); } catch { continue; }
    findings.push(...scan(src, f));
  }

  if (!usingDefaultDirs) {
    for (const fnd of findings) {
      process.stderr.write(
        `${fnd.file}:${fnd.line}: ${fnd.method} ${fnd.path} is auth-gated (${fnd.middlewares.join(", ")}) but has no rate-limit coverage\n`,
      );
    }
    process.exit(findings.length > 0 ? 1 : 0);
  }

  if (updateBaseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify(buildBaseline(findings), null, 2) + "\n");
    console.log(`Baseline skrevet til ${BASELINE_PATH} (${findings.length} kendte uncovered route(r)).`);
    return;
  }

  let baseline = { files: {} };
  if (existsSync(BASELINE_PATH)) baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

  const { newViolations, stale } = compareAgainstBaseline(findings, baseline);

  if (stale.length) {
    console.log(`${stale.length} baseline-entr${stale.length === 1 ? "y" : "ies"} skrumpet (fixet) - stram ratchet'en i en dedikeret commit:`);
    for (const s of stale.slice(0, 12)) console.log(`   - ${s}`);
    console.log("   -> node scripts/check-rate-limit-coverage.mjs --update-baseline");
  }

  if (newViolations.length > 0) {
    process.stderr.write(`\nRate-limit coverage guard blocked: ${newViolations.length} NY(E) uncovered auth-gated route(r) (ikke i baseline):\n`);
    for (const v of newViolations) process.stderr.write(`   - ${v}\n`);
    process.stderr.write(`
Background: a requireAuth/requireAdmin route with no rate-limit coverage (no
inline <x>Limiter middleware, and no router.use(<prefix>, <x>Limiter) mount
covering its path) can be hammered by a single authenticated user with no
backstop (#530).

Fix: add an existing limiter from backend/lib/rateLimiters.js (marketWriteLimiter
for team-owned writes, adminWriteLimiter for admin writes, presencePulseLimiter
for cheap/frequent pings, or a new dedicated one) as a middleware argument on
the route.

Baseline maa IKKE udvides med nye overtraedelser (ratchet, Refs #530).

Refs #530.
`);
    process.exit(1);
  }

  const knownFiles = Object.keys(baseline.files || {}).length;
  console.log(`\nRate-limit coverage guard: ingen nye overtraedelser (${knownFiles} kendte baseline-filer, ${findings.length} baseline-fund tilbage).`);
  process.exit(0);
}

if (isMain()) {
  try { run(); }
  catch (err) {
    process.stderr.write(`check-rate-limit-coverage: ${err.stack || err.message}\n`);
    process.exit(2);
  }
}
