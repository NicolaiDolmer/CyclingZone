#!/usr/bin/env node
// scripts/lint-getuser-guard.mjs
// ============================================================
// Forward-guard for the getUser()→null-deref crash class.
//
// Origin: #1792 (Sentry CYCLINGZONE-16) — 16 `supabase.auth.getUser()` call
// sites across 15 pages deref'd `user.id` with no `if (!user)` guard. An
// expired/invalid session makes `getUser()` return `user = null`, so the bare
// `user.id` deref crashes the whole page. #1792 added inline guards everywhere,
// but inline guards do NOT stop a NEW page from forgetting the guard again.
// This lint is that missing forward-guard.
//
// It flags a `supabase.auth.getUser()` (raw) or `getAuthedUser()` (the #1807
// helper) whose bound `user` variable is dereferenced as `user.<prop>` BEFORE
// any `if (!user)` / `!user` / `user &&` / `user?.` / `user || …` guard. The
// recommended shape (enforced for both forms):
//
//   const user = await getAuthedUser();
//   if (!user) { return; }     // or redirect
//   … user.id …
//
// It tokenises first (stripCommentsAndStrings) so it never trips on the pattern
// inside a // comment, /* */ block, or string/template literal — e.g. the
// "#1792: stop før user.id" guard comments must NOT be flagged.
//
// Escape hatch: put `getuser-guard-ok` in a comment on the call line or the
// line directly above when an unguarded deref is genuinely intentional.
//
// Usage:
//   node scripts/lint-getuser-guard.mjs                 # default globs
//   node scripts/lint-getuser-guard.mjs path/to/file.jsx
//   npm run test:getuser-guard                          # runs the .test.mjs
//
// Exit codes:
//   0 — no findings
//   1 — at least one unguarded getUser()/getAuthedUser() deref
//   2 — internal error
//
// Refs #1807 #1792.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIRS = ['frontend/src'];
const SCAN_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const OPT_OUT = 'getuser-guard-ok';
const WINDOW = 40; // lines after the call to look for a guard-before-deref

/**
 * Replace // line comments, block comments and string/template literals with
 * blanks of equal length, preserving newlines so line numbers stay accurate.
 * Copied from lint-postgrest-in-cap.mjs (each lint stays standalone).
 *
 * @param {string} src
 * @returns {string} same-length scrubbed source
 */
export function stripCommentsAndStrings(src) {
  const n = src.length;
  let out = '';
  let i = 0;
  // 0 code · 1 line-comment · 2 block-comment · 3 '..' · 4 ".." · 5 `..`
  let state = 0;
  while (i < n) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (state === 0) {
      if (c2 === '//') { state = 1; out += '  '; i += 2; continue; }
      if (c2 === '/*') { state = 2; out += '  '; i += 2; continue; }
      if (c === "'") { state = 3; out += ' '; i++; continue; }
      if (c === '"') { state = 4; out += ' '; i++; continue; }
      if (c === '`') { state = 5; out += ' '; i++; continue; }
      out += c; i++; continue;
    }
    if (c === '\n') { if (state === 1) state = 0; out += '\n'; i++; continue; }
    if (state === 1) { out += ' '; i++; continue; }
    if (state === 2) {
      if (c2 === '*/') { state = 0; out += '  '; i += 2; continue; }
      out += ' '; i++; continue;
    }
    // string states 3/4/5 — honour backslash escapes, blank everything out
    if (c === '\\') { out += '  '; i += 2; continue; }
    if ((state === 3 && c === "'") || (state === 4 && c === '"') || (state === 5 && c === '`')) {
      state = 0; out += ' '; i++; continue;
    }
    out += ' '; i++; continue;
  }
  return out;
}

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Given a bound user-variable name and the call's 0-based line index, decide
 * whether the variable is dereferenced (`<var>.<prop>`) before it is guarded.
 *
 * @returns {null | {line:number}} null = safe; object = unguarded deref (1-based line)
 */
function unguardedDeref(codeLines, userVar, callLineIdx) {
  const v = reEsc(userVar);
  // A guard is any of: !v · if (v · v && · v?. · v ? (ternary) · v == null ·
  // v != null · return v · v || …  — anything that null-checks before use.
  const guardRe = new RegExp(
    `!\\s*${v}\\b|\\bif\\s*\\(\\s*${v}\\b|\\b${v}\\s*&&|${v}\\?\\.|\\b${v}\\s*\\?(?!\\.)`
    + `|\\b${v}\\s*[=!]==?\\s*null|\\breturn\\s+${v}\\b|\\b${v}\\s*\\|\\|`,
  );
  const derefRe = new RegExp(`\\b${v}\\.`); // bare deref — user?.x does NOT match
  const winText = codeLines
    .slice(callLineIdx, Math.min(codeLines.length, callLineIdx + WINDOW))
    .join('\n');
  const derefIdx = winText.search(derefRe);
  if (derefIdx === -1) return null;                 // never deref'd → safe
  const guardIdx = winText.search(guardRe);
  if (guardIdx !== -1 && guardIdx < derefIdx) return null; // guarded first → safe
  const lineOffset = winText.slice(0, derefIdx).split('\n').length - 1;
  return { line: callLineIdx + lineOffset + 1 };    // 1-based deref line
}

const HELPER_CALL = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+getAuthedUser\s*\(\s*\)/g;
const RAW_CALL = /auth\.getUser\s*\(\s*\)/g;
// Destructure that binds the user out of getUser(): { data: { user } } or { data: { user: u } }
const DESTRUCTURE = /data\s*:\s*\{\s*user(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*[},]/;

/**
 * Scan one source for unguarded getUser()/getAuthedUser() derefs.
 *
 * @param {string} source
 * @param {string} filename
 * @returns {Array<{file:string,line:number,snippet:string}>}
 */
export function scan(source, filename = '<source>') {
  const code = stripCommentsAndStrings(source);
  const srcLines = source.split('\n');
  const codeLines = code.split('\n');
  const findings = [];

  const consider = (callIdx, userVar) => {
    const callLineIdx = code.slice(0, callIdx).split('\n').length - 1;
    const hit = unguardedDeref(codeLines, userVar, callLineIdx);
    if (!hit) return;
    const here = srcLines[callLineIdx] || '';
    const above = srcLines[callLineIdx - 1] || '';
    if (here.includes(OPT_OUT) || above.includes(OPT_OUT)) return;
    findings.push({ file: filename, line: hit.line, snippet: (srcLines[hit.line - 1] || '').trim().slice(0, 120) });
  };

  // Pass A — helper: const user = await getAuthedUser()
  let m;
  HELPER_CALL.lastIndex = 0;
  while ((m = HELPER_CALL.exec(code)) !== null) consider(m.index, m[1]);

  // Pass B — raw: supabase.auth.getUser() with a { data: { user } } destructure
  RAW_CALL.lastIndex = 0;
  while ((m = RAW_CALL.exec(code)) !== null) {
    // Look at the statement context (this line + 2 above) for the destructure.
    const callLineIdx = code.slice(0, m.index).split('\n').length - 1;
    const ctx = codeLines.slice(Math.max(0, callLineIdx - 2), callLineIdx + 1).join('\n');
    const dm = ctx.match(DESTRUCTURE);
    if (!dm) continue; // result not destructured to a recognizable user var → skip (conservative)
    consider(m.index, dm[1] || 'user');
  }

  return findings;
}

function walk(dir, acc) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e === 'build' || e === '.git') continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, acc);
    else if (st.isFile() && SCAN_EXTS.has(extname(p))) acc.push(p);
  }
  return acc;
}

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try { return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? ''); }
  catch { return false; }
}

function run() {
  const args = process.argv.slice(2);
  const files = args.length ? args : DEFAULT_DIRS.flatMap((d) => walk(d, []));
  let bad = 0;
  for (const f of files) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    for (const fnd of scan(src, f)) {
      bad++;
      process.stderr.write(`${fnd.file}:${fnd.line}: getUser() result deref'd without a null-guard: ${fnd.snippet}\n`);
    }
  }
  if (bad > 0) {
    process.stderr.write(`
🔴 getUser guard blocked: ${bad} unguarded getUser()/getAuthedUser() deref(s).

Background: an expired session makes getUser() return user=null; a bare
user.<prop> deref then crashes the whole page (#1792, Sentry CYCLINGZONE-16).

Fix: use the helper + guard before deref:
  const user = await getAuthedUser();   // frontend/src/lib/getAuthedUser.js
  if (!user) { return; }                // or redirect
  … user.id …

Intentional unguarded deref? Add a "${OPT_OUT}" comment on the call line
(or the line above) with a one-line reason.

Refs #1807 #1792.
`);
    process.exit(1);
  }
  process.exit(0);
}

if (isMain()) {
  try { run(); }
  catch (err) {
    process.stderr.write(`lint-getuser-guard: ${err.stack || err.message}\n`);
    process.exit(2);
  }
}
