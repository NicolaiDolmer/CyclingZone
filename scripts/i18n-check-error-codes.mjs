#!/usr/bin/env node
// i18n error-code coverage guard — Refs #2848.
//
// #2834 postmortem (23/7, wave-2026-07-23-reviewet): a squad-risk PR added 3
// new backend errorCode literals (seller_squad_risk_too_small,
// cannot_release_squad_risk, cannot_auction_squad_risk) with no matching
// frontend/public/locales/{en,da}/errors.json entry. None of the existing
// i18n gates caught it because none of them cross-check backend errorCode
// literals against errors.json — i18n-check-keys.mjs only diffs en against
// da, so a code missing SYMMETRICALLY in both locales is invisible to it
// (same blind-spot class as #2896's terrain-coverage guard). Danish players
// would have seen a raw key or empty bubble at the new 409-blocks.
//
// This script is the forward guard: it scans backend/{lib,routes}/**/*.js
// (excluding tests) for every `errorCode` literal-value construct actually
// used in this codebase, and fails if any code is missing a
// frontend/public/locales/{en,da}/errors.json `api.<code>` entry.
//
// Literal constructs covered (all confirmed present as of #2848):
//   1. `errorCode: "foo"` / `'foo'`      — direct object property
//   2. `x.errorCode = "foo"`            — assignment (boardMembers.js)
//   3. `errorCode: cond ? "a" : "b"`    — ternary (both arms)
//   4. `errorCode: { k: "a", ... }[x]`  — inline/const lookup table
//      (also `const errorCode = { ... }[x]`)
//   5. `failure(status, "message", "foo")` — transferExecution.js's internal
//      `failure(status, error, code, extra)` helper; the literal 3rd arg
//      becomes `result.code` → `errorCode: result.code` in api.js.
//   6. `{ code: "foo" }` returned from getTransferExecutionIssue /
//      getSwapExecutionIssue specifically (transferExecution.js) — these two
//      issue-getters' `.code` is forwarded AS-IS via `failure(status,
//      message.error, issue.code, ...)`. Sibling getters in the same file
//      (getListingCancelIssue, getListingPriceUpdateIssue,
//      getTransferCancelIssue, getSwapCancelIssue) are deliberately EXCLUDED —
//      api.js always re-literalizes or remaps their `.code` before it reaches
//      the client (e.g. `not_found` → `listing_not_found` via a lookup
//      table, already covered by rule 4; `deal_already_accepted` is only ever
//      used as a boolean truthy check, api.js sends its own
//      `deal_locked_both_confirmed` literal instead). Including them would
//      produce false "missing translation" failures for codes players never
//      actually see.
//
// KNOWN BLIND SPOT (out of scope for #2848, left for a follow-up): the
// legacy academy convention — `res.status(409).json({ error: "academy_full" })`
// with NO `errorCode` field at all (backend/lib/academy{Graduation,Transfer,
// Intake}.js) — which the frontend resolves via a hand-written wrapper in
// RiderManageActions.jsx (`resolveApiError({ errorCode: code }, t, ...)`) or,
// for the academy sign/reject flow, a completely separate local mapping in
// AcademyPage.jsx outside the `errors:api.*` namespace entirely. A new code
// added through that convention would not be caught here. Solving it would
// require tracing arbitrary `throw new Error("...")` / `err?.message`
// call-sites, not a bounded literal-construct grep — a materially bigger
// change than "cross-check the errorCode contract" (#2848's actual ask).
//
// Reverse direction (errors.json `api.*` keys no backend errorCode literal
// emits any more) is measured and printed, but does NOT fail the build —
// mirrors i18n-check-keys.mjs's __MISSING__-placeholder handling (info, not
// error), because the known blind spot above means a real "dead" key can't
// be told apart from one only reachable through an unmodelled convention.
//
// Brug:
//   node scripts/i18n-check-error-codes.mjs
//
// CI: .github/workflows/i18n-check.yml

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BACKEND_DIRS = ["backend/lib", "backend/routes"];
const LOCALES_DIR = join(ROOT, "frontend", "public", "locales");
const LNGS = ["en", "da"];
const NS = "errors";
const KEY_PATH = "api";

// Named issue-getters whose `{ code: "..." }` return value is forwarded
// AS-IS to players (see rule 6 in the header comment above).
const DIRECTLY_FORWARDED_ISSUE_GETTERS = ["getTransferExecutionIssue", "getSwapExecutionIssue"];

function listJsFilesRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsFilesRecursive(full));
    } else if (entry.isFile() && extname(entry.name) === ".js" && !entry.name.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

// Bound a named function's body: from `function <name>(` up to the first
// line that is JUST a closing brace (the function's own end — nested blocks
// inside stay indented in this codebase's style, so they never produce a
// column-0 `}` before the real end). Returns "" if not found.
function extractFunctionBody(text, fnName) {
  // Match through the (possibly destructured, multi-line) parameter list up
  // to its closing `) {` — NOT the first `{`, which for a destructured param
  // (`function foo({ a, b }) {`) would be the parameter list's own brace.
  const headerRe = new RegExp(`function\\s+${fnName}\\s*\\([\\s\\S]*?\\)\\s*\\{`);
  const headerMatch = headerRe.exec(text);
  if (!headerMatch) return "";
  const bodyStart = headerMatch.index + headerMatch[0].length - 1; // at the body's opening "{"
  const endMatch = /\n\}/.exec(text.slice(bodyStart));
  if (!endMatch) return "";
  return text.slice(bodyStart, bodyStart + endMatch.index + endMatch[0].length);
}

// Pure — no fs. Every `errorCode`-literal-value construct this codebase
// actually uses, extracted from one file's source text (see header comment
// for the enumerated rules).
export function extractErrorCodesFromSource(text) {
  const codes = new Set();

  // 1. Direct literal property.
  for (const m of text.matchAll(/\berrorCode\s*:\s*["']([\w.]+)["']/g)) codes.add(m[1]);

  // 2. Assignment (`err.errorCode = "..."` or bare `errorCode = "..."`).
  for (const m of text.matchAll(/\berrorCode\s*=\s*["']([\w.]+)["']/g)) codes.add(m[1]);

  // 3. Ternary — both arms.
  for (const m of text.matchAll(/\berrorCode\s*:\s*[^\n]*?\?\s*["']([\w.]+)["']\s*:\s*["']([\w.]+)["']/g)) {
    codes.add(m[1]);
    codes.add(m[2]);
  }

  // 4. Inline/const lookup table: `errorCode: { k: "a", ... }[x]` or
  //    `const errorCode = { k: "a", ... }[x]` — every string VALUE inside.
  for (const m of text.matchAll(/\berrorCode\s*(?:=|:)\s*\{([^}]*)\}\s*\[/g)) {
    for (const inner of m[1].matchAll(/:\s*["']([\w.]+)["']/g)) codes.add(inner[1]);
  }

  // 5. transferExecution.js's `failure(status, "message", "code")` helper —
  //    literal 3rd arg.
  for (const m of text.matchAll(/\bfailure\(\s*\d+\s*,\s*(?:"[^"]*"|'[^']*'|`[^`]*`)\s*,\s*["']([\w.]+)["']/g)) {
    codes.add(m[1]);
  }

  // 6. `{ code: "..." }` returned from the two directly-forwarded issue-getters.
  for (const fnName of DIRECTLY_FORWARDED_ISSUE_GETTERS) {
    const body = extractFunctionBody(text, fnName);
    if (!body) continue;
    for (const m of body.matchAll(/\{\s*code\s*:\s*["']([\w.]+)["']/g)) codes.add(m[1]);
  }

  return codes;
}

// Pure — no fs. `sourcesByFile`: { [relativeFilePath]: sourceText }. Returns
// Map<code, Set<relativeFilePath>> so failures can point at the origin.
export function collectBackendErrorCodes(sourcesByFile) {
  const codeFiles = new Map();
  for (const [file, text] of Object.entries(sourcesByFile)) {
    for (const code of extractErrorCodesFromSource(text)) {
      if (!codeFiles.has(code)) codeFiles.set(code, new Set());
      codeFiles.get(code).add(file);
    }
  }
  return codeFiles;
}

// Pure — no fs. For each backend code, which locale(s) lack an
// `errors.json`'s `<keyPath>.<code>` entry?
export function findMissingErrorCodeTranslations(codes, localeDataByLng, keyPath) {
  const missing = [];
  for (const code of codes) {
    const missingIn = [];
    for (const lng of Object.keys(localeDataByLng)) {
      const bucket = localeDataByLng[lng]?.[keyPath];
      const hasKey = bucket != null && typeof bucket === "object" && Object.prototype.hasOwnProperty.call(bucket, code);
      if (!hasKey) missingIn.push(lng);
    }
    if (missingIn.length > 0) missing.push({ code, missingIn });
  }
  return missing;
}

// Pure — no fs. Reverse direction: `errors.json`'s `<keyPath>.*` keys that no
// backend errorCode literal (as extracted above) emits any more. Advisory —
// see header comment for why this doesn't fail the build.
export function findDeadErrorCodeKeys(codes, localeDataByLng, keyPath) {
  const codeSet = codes instanceof Set ? codes : new Set(codes);
  const dead = [];
  for (const lng of Object.keys(localeDataByLng)) {
    const bucket = localeDataByLng[lng]?.[keyPath] || {};
    for (const key of Object.keys(bucket)) {
      if (!codeSet.has(key)) dead.push({ key, lng });
    }
  }
  return dead;
}

function loadJSON(lng, ns) {
  return JSON.parse(readFileSync(join(LOCALES_DIR, lng, `${ns}.json`), "utf8"));
}

function main() {
  const files = BACKEND_DIRS.flatMap((d) => listJsFilesRecursive(join(ROOT, d)));
  const sourcesByFile = {};
  for (const f of files) sourcesByFile[relative(ROOT, f).replace(/\\/g, "/")] = readFileSync(f, "utf8");

  const codeFiles = collectBackendErrorCodes(sourcesByFile);
  const codes = [...codeFiles.keys()];

  const localeDataByLng = Object.fromEntries(LNGS.map((lng) => [lng, loadJSON(lng, NS)]));

  const missing = findMissingErrorCodeTranslations(codes, localeDataByLng, KEY_PATH);
  const dead = findDeadErrorCodeKeys(codes, localeDataByLng, KEY_PATH);

  if (missing.length === 0) {
    console.log(
      `✓ i18n error-code coverage OK — ${codes.length} backend errorCode(s) × ${LNGS.length} language(s)` +
        (dead.length > 0 ? ` (${dead.length} possibly-dead api.* key(s), see below)` : "")
    );
  } else {
    console.error(`✗ i18n error-code coverage FAILED — ${missing.length} backend errorCode(s) missing a translation:\n`);
    for (const { code, missingIn } of missing) {
      const origin = [...(codeFiles.get(code) || [])].join(", ");
      console.error(`  • "${code}" (from ${origin}) missing at frontend/public/locales/{${missingIn.join(",")}}/errors.json → api.${code}`);
    }
    console.error(
      `\nFix: add the missing key(s) EN-first, DA-second, under frontend/public/locales/{en,da}/errors.json's "api" object.`
    );
  }

  if (dead.length > 0) {
    console.log(`\nℹ i18n error-code coverage — ${dead.length} errors.json "api.*" key(s) with no matching backend errorCode literal:`);
    for (const { key, lng } of dead) console.log(`  • "${key}" (${lng}/errors.json)`);
    console.log(
      `  (advisory only — some of these may be reached through a convention this guard doesn't model, see header comment; not auto-removed)`
    );
  }

  process.exit(missing.length > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
