#!/usr/bin/env node
// scripts/lint-schema-columns.mjs
// ============================================================
// Forward-guard for the "select against a column that does not exist" class
// (#3586). Two bugs of exactly this shape landed on the same day:
//
//   #3572  season_standings.prize_money — the column never existed; the select
//          had sat latent for three months because PostgREST answers an
//          unknown column with a 400 the caller swallowed, and nothing in the
//          test pipeline compared the code against the real schema.
//   Day-1  race_results.created_at — same shape, still latent at the time
//          #3586 was written because the code path sits behind a feature gate.
//
// Why the existing pipeline could not catch it:
//   1. createFakeSupabase is projection-aware but NOT schema-aware — a column
//      missing from the fixture row is just `undefined`, never an error.
//   2. The fixtures mirrored the bug (`prize_money: 50000` was in the test
//      data), so mock and code agreed on a reality prod did not have.
//   3. No CI gate read the real schema.
//
// This guard closes gap 3: it resolves every `.from("<relation>").select(...)`
// in backend/ against a committed snapshot of the live `public` schema
// (database/schema-snapshot.json) and fails the build on a column the schema
// does not have.
//
// -------------------------------------------------------------------------
// DESIGN RULE: a false positive is worse than a missed case (#3586). Every
// step below is EXACT resolution or a skip — the guard never guesses:
//   · table argument must resolve to a literal string (directly, via a
//     module-level UPPER_SNAKE const, or via a placeholder-free template);
//     anything else is skipped and counted.
//   · a relation that is not in the snapshot is SKIPPED, never reported —
//     it may live in another schema, or the snapshot may predate it.
//   · select argument must resolve to a literal string the same way. Constant
//     resolution follows relative imports one hop (this is what makes
//     BOARD_AUTO_ACCEPT_SELECT / BOARD_IDENTITY_RIDER_SELECT /
//     U25_ABILITY_KEYS resolvable), and gives up on anything it cannot
//     evaluate literally.
//   · embedded resources (`team:team_id(is_ai)`, `races!inner(...)`,
//     `rider_derived_abilities(climbing, ...)`) are validated against the
//     EMBEDDED relation's own columns, but only when the target resolves
//     exactly: either the reference is itself a relation name in the
//     snapshot, or it is a single-column foreign key on the parent relation.
//     Anything else is skipped and counted.
//   · `*`, aggregates (`col.sum()`), spread embeds (`...t(col)`) and any
//     token that is not a plain identifier after stripping alias/cast/JSON
//     path are skipped and counted.
//
// Every skip is COUNTED and printed, so coverage is honest rather than
// implied (#3586 explicitly asked for this — the prototype could not decide
// 472 tokens and that number has to stay visible).
//
// OUT OF SCOPE (deliberate, #3586's own "Afgrænsning"): insert/update/upsert
// payloads are the same bug class but are built as object literals far from
// the call site, so they are a separate, much harder static problem.
//
// -------------------------------------------------------------------------
// Snapshot freshness: the snapshot is a committed mirror of prod's `public`
// schema. A migration that ADDS a column and is not followed by a snapshot
// refresh makes this guard fail on a legitimate new column — that is the
// fail-closed direction and the error message says how to refresh:
//     node scripts/lint-schema-columns.mjs --update-snapshot
// (requires SUPABASE_DB_URL via Infisical; CI never touches the DB, it only
// reads the committed JSON).
//
// Test files are NOT scanned: fixtures and fakes deliberately model tables
// that do not exist, so scanning them would produce exactly the false
// positives this guard is built to avoid.
//
// Usage:
//   node scripts/lint-schema-columns.mjs                    # default dir (backend)
//   node scripts/lint-schema-columns.mjs path/to/file.js    # explicit files
//   node scripts/lint-schema-columns.mjs --update-snapshot  # refresh the snapshot (needs DB)
//
// Opt-out (last resort): a `schema-columns-ok: <reason>` comment on the call
// line, up to 6 lines above it, or trailing on the chain.
//
// Exit codes:
//   0 — no findings
//   1 — at least one select against a column the schema does not have
//   2 — internal error
//
// Refs #3586 #3572.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIRS = ['backend'];
const SCAN_EXTS = new Set(['.js', '.mjs', '.cjs']);
const SNAPSHOT_PATH = 'database/schema-snapshot.json';
const OPT_OUT = 'schema-columns-ok:';
const ESCAPE_LOOKBACK_LINES = 6;

// Baseline-nøglerne ER filstier, så de skal se ens ud på Windows og Linux
// (samme fælde som lint-pagination-guard.mjs ramte 2026-08-05).
const toPosix = (p) => p.split(sep).join('/');

// ---------------------------------------------------------------------------
// Pre-existing REAL bugs the guard found on its first run against main. They
// are allow-listed (ratchet — this map must only shrink) so the forward-guard
// can go live now instead of being blocked on backend fixes that need their
// own tests and their own review. Keyed `file:relation.column`; every entry
// carries a reason. A NEW violation must NEVER be added here — fix the select.
//
// The guard prints a "can be tightened" line the moment an entry stops
// matching, so a fix cannot silently leave a stale allow-list behind.
// ---------------------------------------------------------------------------
export const KNOWN_FINDINGS = {
  'backend/lib/emailDay1Sweep.js:race_results.created_at':
    '#3586 — the Day-1 mail bug the issue was written about. race_results has '
    + 'imported_at, never created_at; the select (and the .order() next to it) '
    + 'would 400 the moment the e-mail loop is switched on. Left as-is here so '
    + 'this PR stays a pure CI-guard change — the fix (imported_at) belongs '
    + 'with the e-mail loop and its tests.',
  'backend/scripts/driftMonitor.js:riders.name':
    '#3586 — same class, found by this guard: riders has firstname/lastname, '
    + 'never name. The orphan-rider drift check therefore 400s and is skipped '
    + 'silently by its own `if (!orphanError)` guard, so the drift monitor has '
    + 'been reporting no orphan riders regardless of reality. Backend fix out '
    + 'of scope for this PR.',
};

// ---------------------------------------------------------------------------
// Tokeniser. Blank // and /* */ comments while PRESERVING string literals —
// the select argument IS a string literal. Same approach (and same standalone
// copy, one lint = one file) as lint-pagination-guard.mjs /
// lint-rankings-raceresults-fetch.mjs. Length and newlines are preserved so
// offsets and line numbers still point at the raw source.
// ---------------------------------------------------------------------------
// A `/` opens a regex literal only in operand position. Getting this wrong in
// the SAFE direction (reading a regex as division) just restores the old
// behaviour for that one token; the unsafe direction would swallow real code,
// so anything ambiguous — identifiers, `)`, `]`, digits — is division.
const REGEX_PRECEDERS = new Set(
  ['=', '(', ',', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '^', '~', '<', '>']
);
const REGEX_KEYWORDS = new Set(
  ['return', 'typeof', 'instanceof', 'in', 'of', 'case', 'do', 'else', 'yield', 'await', 'void', 'delete', 'new', 'throw']
);

function regexCanStartAfter(out) {
  let j = out.length - 1;
  while (j >= 0 && /\s/.test(out[j])) j--;
  if (j < 0) return true;
  const c = out[j];
  if (REGEX_PRECEDERS.has(c)) return true;
  if (/[A-Za-z0-9_$]/.test(c)) {
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(out[k])) k--;
    return REGEX_KEYWORDS.has(out.slice(k + 1, j + 1));
  }
  return false;
}

export function stripCommentsKeepStrings(src) {
  const n = src.length;
  let out = '';
  let i = 0;
  // 0 code · 1 line-comment · 2 block-comment · 3 '..' · 4 ".." · 5 `..` · 6 /../
  let state = 0;
  let inCharClass = false;
  while (i < n) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (state === 0) {
      if (c2 === '//') { state = 1; out += '  '; i += 2; continue; }
      if (c2 === '/*') { state = 2; out += '  '; i += 2; continue; }
      // Regex literal. Without this the quote in `.replace(/"/g, "&quot;")`
      // opens a phantom string and every later // comment in the file stops
      // being blanked — a select inside one of them would be scanned as real
      // code. Blanked rather than kept: nothing inside a regex is ever a
      // select argument, so this removes the whole false-positive class.
      if (c === '/' && regexCanStartAfter(out)) {
        state = 6; inCharClass = false; out += ' '; i++; continue;
      }
      if (c === "'") { state = 3; out += c; i++; continue; }
      if (c === '"') { state = 4; out += c; i++; continue; }
      if (c === '`') { state = 5; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 1) {
      if (c === '\n') { state = 0; out += '\n'; } else out += ' ';
      i++; continue;
    }
    if (state === 2) {
      if (c2 === '*/') { state = 0; out += '  '; i += 2; continue; }
      out += (c === '\n' ? '\n' : ' '); i++; continue;
    }
    if (state === 6) {
      if (c === '\\') { out += ' '.repeat(c2.length); i += c2.length; continue; }
      // A regex literal cannot span lines. An unterminated one means the
      // heuristic misread a division, so fall back to code rather than eat
      // the rest of the file.
      if (c === '\n') { state = 0; out += '\n'; i++; continue; }
      if (c === '[') inCharClass = true;
      else if (c === ']') inCharClass = false;
      else if (c === '/' && !inCharClass) state = 0;
      out += ' '; i++; continue;
    }
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
    if ((state === 3 && c === "'") || (state === 4 && c === '"') || (state === 5 && c === '`')) {
      state = 0;
    }
    out += c; i++; continue;
  }
  return out;
}

/** Index of the bracket matching the opener at `openIdx`, or -1. Quote-aware. */
function matchingClose(code, openIdx) {
  const open = code[openIdx];
  const close = { '(': ')', '[': ']', '{': '}' }[open];
  let depth = 0;
  let quote = null;
  for (let i = openIdx; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Split `text` on top-level commas, ignoring commas inside brackets or string
 * literals. Used both for call arguments and for PostgREST select lists.
 */
export function splitTopLevel(text, separator = ',') {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === separator && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Index of the first `:` that is NOT part of a `::` cast, or -1. */
export function indexOfAliasColon(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ':') continue;
    if (s[i + 1] === ':') { i++; continue; }
    return i;
  }
  return -1;
}

/** Index of the first top-level `(` (outside string literals), or -1. */
function indexOfTopLevelParen(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(') return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Literal evaluation. Returns { kind: 'string'|'array', value } or null.
// Strict by construction: anything not built purely from string literals,
// array literals, `+` concatenation, `.join(<literal>)` and resolvable
// UPPER_SNAKE constants evaluates to null (→ skipped and counted).
// ---------------------------------------------------------------------------

/** Read a quoted literal starting at `i` (must point at the quote). */
function readQuoted(src, i) {
  const quote = src[i];
  let value = '';
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      const esc = src[j + 1];
      value += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
      j += 2;
      continue;
    }
    if (c === quote) return { value, end: j + 1 };
    value += c;
    j++;
  }
  return null;
}

const CONST_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * @param {string} expr        source text of the expression
 * @param {(name: string) => ({kind:string,value:any}|null)} lookup constant resolver
 * @param {number} depth       recursion guard
 */
export function evalLiteral(expr, lookup, depth = 0) {
  if (depth > 8) return null;
  const s = expr.trim();
  if (!s) return null;

  // Template literal — resolve every ${...} placeholder or give up.
  if (s.startsWith('`')) {
    const closed = readTemplate(s, lookup, depth);
    return closed;
  }

  // String literal, possibly `+`-concatenated with more literals.
  if (s[0] === '"' || s[0] === "'") {
    const lit = readQuoted(s, 0);
    if (!lit) return null;
    const rest = s.slice(lit.end).trim();
    if (!rest) return { kind: 'string', value: lit.value };
    if (rest[0] !== '+') return null;
    const tail = evalLiteral(rest.slice(1), lookup, depth + 1);
    if (!tail || tail.kind !== 'string') return null;
    return { kind: 'string', value: lit.value + tail.value };
  }

  // Array literal, optionally followed by .join(<literal>).
  if (s[0] === '[') {
    const close = matchingClose(s, 0);
    if (close === -1) return null;
    const items = splitTopLevel(s.slice(1, close))
      .map((p) => p.trim())
      .filter(Boolean);
    const values = [];
    for (const item of items) {
      const v = evalLiteral(item, lookup, depth + 1);
      if (!v || v.kind !== 'string') return null;
      values.push(v.value);
    }
    return applyTail({ kind: 'array', value: values }, s.slice(close + 1), lookup, depth);
  }

  // Constant reference, optionally followed by .join(<literal>).
  const nameMatch = /^[A-Za-z_$][\w$]*/.exec(s);
  if (nameMatch) {
    const name = nameMatch[0];
    if (!CONST_NAME_RE.test(name)) return null; // narrow on purpose — see header
    const resolved = lookup(name);
    if (!resolved) return null;
    return applyTail(resolved, s.slice(name.length), lookup, depth);
  }

  return null;
}

/** Apply an optional trailing `.join(<string literal>)` to an array value. */
function applyTail(value, tail, lookup, depth) {
  const rest = tail.trim();
  if (!rest) return value;
  const m = /^\.join\s*\(/.exec(rest);
  if (!m || value.kind !== 'array') return null;
  const openIdx = m[0].length - 1;
  const close = matchingClose(rest, openIdx);
  if (close === -1) return null;
  if (rest.slice(close + 1).trim()) return null;
  const sepExpr = rest.slice(openIdx + 1, close).trim();
  const sep = sepExpr ? evalLiteral(sepExpr, lookup, depth + 1) : { kind: 'string', value: ',' };
  if (!sep || sep.kind !== 'string') return null;
  return { kind: 'string', value: value.value.join(sep.value) };
}

/** Evaluate a template literal, resolving every ${...} placeholder. */
function readTemplate(s, lookup, depth) {
  if (s[0] !== '`') return null;
  let out = '';
  let i = 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { out += s[i + 1]; i += 2; continue; }
    if (c === '`') {
      if (s.slice(i + 1).trim()) return null; // trailing expression — give up
      return { kind: 'string', value: out };
    }
    if (c === '$' && s[i + 1] === '{') {
      const close = matchingClose(s, i + 1);
      if (close === -1) return null;
      const inner = evalLiteral(s.slice(i + 2, close), lookup, depth + 1);
      if (!inner || inner.kind !== 'string') return null;
      out += inner.value;
      i = close + 1;
      continue;
    }
    out += c;
    i++;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Module-level constant + import extraction.
// ---------------------------------------------------------------------------

const DECL_RE = /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=/gm;

/**
 * Extract module-level UPPER_SNAKE constants that evaluate to a string or an
 * array of strings. Anchored at column 0 so a same-named local inside a
 * function body can never shadow the value we resolve.
 *
 * @param {string} code comment-stripped source
 * @param {(name: string) => ({kind:string,value:any}|null)} importLookup
 * @returns {Map<string, {kind:string, value:any}>}
 */
export function extractConstants(code, importLookup = () => null) {
  const consts = new Map();
  const lookup = (name) => consts.get(name) ?? importLookup(name);
  DECL_RE.lastIndex = 0;
  let m;
  while ((m = DECL_RE.exec(code)) !== null) {
    const rhsStart = m.index + m[0].length;
    // RHS runs to the first top-level ';' (or newline-at-depth-0 fallback).
    let depth = 0;
    let quote = null;
    let end = code.length;
    for (let i = rhsStart; i < code.length; i++) {
      const c = code[i];
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ';' && depth <= 0) { end = i; break; }
    }
    const value = evalLiteral(code.slice(rhsStart, end), lookup);
    if (value) consts.set(m[1], value);
  }
  return consts;
}

const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g;

/**
 * Map local names to `{ specifier, exported }` for named imports from
 * RELATIVE paths only (a bare package specifier can never hold one of our
 * select constants).
 */
export function extractNamedImports(code) {
  const map = new Map();
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(code)) !== null) {
    const specifier = m[3];
    if (!specifier.startsWith('.')) continue;
    for (const raw of m[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const asMatch = /^(\w+)\s+as\s+(\w+)$/.exec(part);
      if (asMatch) map.set(asMatch[2], { specifier, exported: asMatch[1] });
      else if (/^\w+$/.test(part)) map.set(part, { specifier, exported: part });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// PostgREST select-list validation.
// ---------------------------------------------------------------------------

/**
 * Strip alias / cast / JSON-path decoration and return the bare column name,
 * or null when the token is not a plain identifier (→ skipped, counted).
 */
export function normalizeColumnToken(token) {
  let s = token.trim();
  const colon = indexOfAliasColon(s);
  if (colon !== -1) s = s.slice(colon + 1).trim();
  s = s.split('::')[0].trim();
  s = s.split('->')[0].trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length > 1) s = s.slice(1, -1);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return null;
  return s.toLowerCase();
}

/**
 * Resolve the relation an embedded resource points at, EXACTLY or not at all.
 *
 * @param {string} head          text before the '(' — `[alias:]ref[!hint][!inner]`
 * @param {string} parent        the relation the embed hangs off
 * @param {object} snapshot
 * @returns {string|null}
 */
export function resolveEmbedTarget(head, parent, snapshot) {
  let s = head.trim();
  if (s.startsWith('...')) return null; // spread embed — out of scope
  const colon = indexOfAliasColon(s);
  if (colon !== -1) s = s.slice(colon + 1).trim();
  const ref = s.split('!')[0].trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(ref)) return null;
  if (snapshot.relations[ref]) return ref;
  const target = snapshot.foreignKeys[`${parent}.${ref}`];
  if (target && snapshot.relations[target]) return target;
  return null;
}

/**
 * Validate one select list against a relation.
 *
 * @returns {{unknown: Array<{relation:string,column:string}>, verified:number,
 *            skippedTokens:number, skippedEmbeds:number, wildcards:number}}
 */
export function checkSelectList(selectStr, relation, snapshot, depth = 0) {
  const acc = { unknown: [], verified: 0, skippedTokens: 0, skippedEmbeds: 0, wildcards: 0 };
  if (depth > 6) { acc.skippedTokens++; return acc; }
  const columns = new Set((snapshot.relations[relation]?.columns ?? []).map((c) => c.toLowerCase()));

  for (const raw of splitTopLevel(selectStr)) {
    const token = raw.trim();
    if (!token) continue;
    if (token === '*') { acc.wildcards++; continue; }

    const parenIdx = indexOfTopLevelParen(token);
    if (parenIdx !== -1) {
      const close = matchingClose(token, parenIdx);
      if (close === -1) { acc.skippedTokens++; continue; }
      const target = resolveEmbedTarget(token.slice(0, parenIdx), relation, snapshot);
      if (!target) { acc.skippedEmbeds++; continue; }
      const inner = checkSelectList(token.slice(parenIdx + 1, close), target, snapshot, depth + 1);
      acc.unknown.push(...inner.unknown);
      acc.verified += inner.verified;
      acc.skippedTokens += inner.skippedTokens;
      acc.skippedEmbeds += inner.skippedEmbeds;
      acc.wildcards += inner.wildcards;
      continue;
    }

    const column = normalizeColumnToken(token);
    if (!column) { acc.skippedTokens++; continue; }
    if (columns.has(column)) acc.verified++;
    else acc.unknown.push({ relation, column });
  }
  return acc;
}

// ---------------------------------------------------------------------------
// File scanning.
// ---------------------------------------------------------------------------

// Any `.from(` — `Array.from(...)` and friends fall out on their own because a
// match only survives if `.select(` is chained IMMEDIATELY after it AND the
// argument resolves to a relation that exists in the snapshot.
const FROM_CALL = /\.from\s*\(/g;

const lineOf = (code, idx) => code.slice(0, idx).split('\n').length;

/**
 * Scan one source for `.from(<relation>).select(<columns>)` pairs.
 *
 * @param {string} source
 * @param {string} filename
 * @param {object} snapshot
 * @param {(name: string) => ({kind:string,value:any}|null)} importLookup
 * @returns {{findings: Array, stats: object}}
 */
export function scan(source, filename, snapshot, importLookup = () => null) {
  const code = stripCommentsKeepStrings(source);
  const srcLines = source.split('\n');
  const consts = extractConstants(code, importLookup);
  const lookup = (name) => consts.get(name) ?? importLookup(name);

  const findings = [];
  const stats = {
    selectsSeen: 0,
    selectsVerified: 0,
    skippedDynamicTable: 0,
    skippedUnknownRelation: 0,
    skippedDynamicSelect: 0,
    skippedTokens: 0,
    skippedEmbeds: 0,
    wildcards: 0,
    verifiedColumns: 0,
  };

  FROM_CALL.lastIndex = 0;
  let m;
  while ((m = FROM_CALL.exec(code)) !== null) {
    const fromOpen = m.index + m[0].length - 1;
    const fromClose = matchingClose(code, fromOpen);
    if (fromClose === -1) continue;

    const afterFrom = code.slice(fromClose + 1);
    const selectMatch = /^\s*\.select\s*\(/.exec(afterFrom);
    if (!selectMatch) continue;

    stats.selectsSeen++;

    const tableExpr = code.slice(fromOpen + 1, fromClose);
    const tableValue = evalLiteral(tableExpr, lookup);
    if (!tableValue || tableValue.kind !== 'string') { stats.skippedDynamicTable++; continue; }
    const relation = tableValue.value.trim().toLowerCase();
    if (!snapshot.relations[relation]) { stats.skippedUnknownRelation++; continue; }

    const selectOpen = fromClose + 1 + selectMatch[0].length - 1;
    const selectClose = matchingClose(code, selectOpen);
    if (selectClose === -1) { stats.skippedDynamicSelect++; continue; }
    const firstArg = splitTopLevel(code.slice(selectOpen + 1, selectClose))[0] ?? '';
    const selectValue = evalLiteral(firstArg, lookup);
    if (!selectValue || selectValue.kind !== 'string') { stats.skippedDynamicSelect++; continue; }

    const result = checkSelectList(selectValue.value, relation, snapshot);
    stats.selectsVerified++;
    stats.verifiedColumns += result.verified;
    stats.skippedTokens += result.skippedTokens;
    stats.skippedEmbeds += result.skippedEmbeds;
    stats.wildcards += result.wildcards;

    if (result.unknown.length === 0) continue;

    const callLine = lineOf(code, m.index);
    const endLine = lineOf(code, selectClose);
    const escapeWindow = srcLines
      .slice(Math.max(0, callLine - 1 - ESCAPE_LOOKBACK_LINES), endLine)
      .join('\n');
    if (escapeWindow.includes(OPT_OUT)) continue;

    for (const u of result.unknown) {
      findings.push({
        file: filename,
        line: callLine,
        relation: u.relation,
        column: u.column,
        snippet: (srcLines[callLine - 1] || '').trim().slice(0, 120),
      });
    }
  }

  return { findings, stats };
}

// ---------------------------------------------------------------------------
// Cross-module constant resolution (one relative hop, cached).
// ---------------------------------------------------------------------------

function makeModuleResolver() {
  const cache = new Map();

  function constantsOf(absPath, stack) {
    const key = toPosix(absPath);
    if (cache.has(key)) return cache.get(key);
    if (stack.includes(key)) return new Map(); // import cycle — give up, never guess
    let src;
    try { src = readFileSync(absPath, 'utf8'); } catch { return new Map(); }
    const code = stripCommentsKeepStrings(src);
    const imports = extractNamedImports(code);
    const nextStack = [...stack, key];
    const importLookup = (name) => {
      const ref = imports.get(name);
      if (!ref) return null;
      const target = resolveSpecifier(absPath, ref.specifier);
      if (!target) return null;
      return constantsOf(target, nextStack).get(ref.exported) ?? null;
    };
    const consts = extractConstants(code, importLookup);
    cache.set(key, consts);
    return consts;
  }

  return {
    /** Build the importLookup a scanned file should use. */
    lookupFor(absPath, code) {
      const imports = extractNamedImports(code);
      return (name) => {
        const ref = imports.get(name);
        if (!ref) return null;
        const target = resolveSpecifier(absPath, ref.specifier);
        if (!target) return null;
        return constantsOf(target, [toPosix(absPath)]).get(ref.exported) ?? null;
      };
    },
  };
}

function resolveSpecifier(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base, `${base}.js`, `${base}.mjs`, join(base, 'index.js')];
  for (const c of candidates) {
    try { if (statSync(c).isFile()) return c; } catch { /* next */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Snapshot building (pure) + refresh (needs DB).
// ---------------------------------------------------------------------------

/**
 * Turn the two catalogue queries into the committed snapshot shape.
 *
 * @param {Array<{rel:string,kind:string,cols:string}>} relRows
 * @param {Array<{src_table:string,src_col:string,tgt_table:string}>} fkRows
 * @param {{generatedAt?: string}} [meta]
 */
export function buildSnapshot(relRows, fkRows, meta = {}) {
  const relations = {};
  for (const row of [...relRows].sort((a, b) => a.rel.localeCompare(b.rel))) {
    relations[row.rel] = {
      kind: row.kind,
      columns: String(row.cols).split(',').map((c) => c.trim()).filter(Boolean),
    };
  }

  // A column with more than one distinct FK target is AMBIGUOUS — drop it so
  // an embedded resource never resolves to a guessed relation.
  const targets = new Map();
  for (const row of fkRows) {
    const key = `${row.src_table}.${row.src_col}`;
    if (!targets.has(key)) targets.set(key, new Set());
    targets.get(key).add(row.tgt_table);
  }
  const foreignKeys = {};
  for (const key of [...targets.keys()].sort()) {
    const set = targets.get(key);
    if (set.size === 1) foreignKeys[key] = [...set][0];
  }

  return {
    $comment:
      'Mirror of the live public schema (relation -> columns) + single-column foreign keys. '
      + 'Read by scripts/lint-schema-columns.mjs to reject selects against columns that do not exist. '
      + 'Generated — do NOT hand-edit. Refresh: node scripts/lint-schema-columns.mjs --update-snapshot '
      + '(requires SUPABASE_DB_URL via Infisical). Refs #3586.',
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    relations,
    foreignKeys,
  };
}

export const RELATION_SQL = `
SELECT c.relname AS rel,
       CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table'
                      WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview'
                      WHEN 'f' THEN 'foreign' END AS kind,
       string_agg(a.attname, ',' ORDER BY a.attnum) AS cols
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r','v','m','p','f')
   AND a.attnum > 0
   AND NOT a.attisdropped
 GROUP BY c.relname, c.relkind
 ORDER BY c.relname`.trim();

export const FK_SQL = `
SELECT DISTINCT cl.relname AS src_table, a.attname AS src_col, fcl.relname AS tgt_table
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_class fcl ON fcl.oid = c.confrelid
  JOIN pg_namespace fn ON fn.oid = fcl.relnamespace
  JOIN LATERAL unnest(c.conkey) AS k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum = k.attnum
 WHERE c.contype = 'f'
   AND n.nspname = 'public'
   AND fn.nspname = 'public'
   AND array_length(c.conkey, 1) = 1
 ORDER BY src_table, src_col`.trim();

async function updateSnapshot() {
  // Lazy import: the guard itself must never pull in DB plumbing in CI.
  const { requireEnv, pgEnvFromDsn, describeTarget, psqlJson } = await import('./db-lib.mjs');
  const pgEnv = pgEnvFromDsn(requireEnv('SUPABASE_DB_URL'));
  console.log(`▶ Reading schema from ${describeTarget(pgEnv)}`);
  const relRows = psqlJson(RELATION_SQL, pgEnv);
  const fkRows = psqlJson(FK_SQL, pgEnv);
  const snapshot = buildSnapshot(relRows, fkRows);
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `✅ ${SNAPSHOT_PATH} refreshed: ${Object.keys(snapshot.relations).length} relations, `
    + `${Object.keys(snapshot.foreignKeys).length} single-column foreign keys.`,
  );
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

function walk(dir, acc) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e === 'build' || e === '.git') continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, acc);
    else if (st.isFile() && SCAN_EXTS.has(extname(p))) acc.push(toPosix(p));
  }
  return acc;
}

/** Fixtures and fakes model tables that do not exist — see header. */
export const isTestFile = (f) => /\.test\.[cm]?js$/.test(f) || /(^|\/)(__tests__|test-setup)\b/.test(f);

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try { return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? ''); }
  catch { return false; }
}

function run() {
  const args = process.argv.slice(2);
  if (args.includes('--update-snapshot')) return updateSnapshot();

  if (!existsSync(SNAPSHOT_PATH)) {
    process.stderr.write(
      `lint-schema-columns: ${SNAPSHOT_PATH} is missing.\n`
      + 'Generate it with: node scripts/lint-schema-columns.mjs --update-snapshot\n',
    );
    process.exit(2);
  }
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

  const explicit = args.filter((a) => !a.startsWith('-')).map(toPosix);
  const files = (explicit.length ? explicit : DEFAULT_DIRS.flatMap((d) => walk(d, [])))
    .filter((f) => !isTestFile(f));

  const resolver = makeModuleResolver();
  const findings = [];
  const totals = {
    files: 0,
    selectsSeen: 0,
    selectsVerified: 0,
    skippedDynamicTable: 0,
    skippedUnknownRelation: 0,
    skippedDynamicSelect: 0,
    skippedTokens: 0,
    skippedEmbeds: 0,
    wildcards: 0,
    verifiedColumns: 0,
  };

  for (const f of files) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    totals.files++;
    const lookup = resolver.lookupFor(resolve(f), stripCommentsKeepStrings(src));
    const { findings: fnd, stats } = scan(src, f, snapshot, lookup);
    findings.push(...fnd);
    for (const k of Object.keys(stats)) totals[k] += stats[k];
  }

  const keyOf = (f) => `${f.file}:${f.relation}.${f.column}`;
  const seen = new Set(findings.map(keyOf));
  const fresh = findings.filter((f) => !KNOWN_FINDINGS[keyOf(f)]);
  const known = findings.length - fresh.length;

  // Ratchet hygiene: an allow-list entry that no longer matches means the bug
  // was fixed — say so, so the entry gets removed instead of rotting.
  const stale = Object.keys(KNOWN_FINDINGS).filter((k) => !seen.has(k));
  if (stale.length && explicit.length === 0) {
    console.log(`ℹ️  ${stale.length} allow-list entr${stale.length === 1 ? 'y' : 'ies'} no longer match — remove ${stale.length === 1 ? 'it' : 'them'} from KNOWN_FINDINGS in scripts/lint-schema-columns.mjs:`);
    for (const k of stale) console.log(`   - ${k}`);
  }

  for (const f of fresh) {
    process.stderr.write(
      `${f.file}:${f.line}: select against "${f.relation}.${f.column}" — that column does not exist in the schema snapshot: ${f.snippet}\n`,
    );
  }

  if (fresh.length > 0) {
    process.stderr.write(`
🔴 Schema-column guard blocked: ${fresh.length} select(s) against a column the
schema does not have.

Background (#3586): this exact class shipped twice in one day — #3572
(season_standings.prize_money, latent for three months) and the Day-1 mail
(race_results.created_at). PostgREST answers an unknown column with an error
the caller usually swallows, so the bug only surfaces in production, and only
if the code path runs at all.

Fix: select a column that exists, or add the column in a migration and refresh
the snapshot:
  node scripts/lint-schema-columns.mjs --update-snapshot   (needs SUPABASE_DB_URL)

Snapshot out of date (the column WAS added by a migration that is already
applied)? Same command — ${SNAPSHOT_PATH} is a committed mirror of prod.

Genuinely fine some other way? Add a "${OPT_OUT} <reason>" comment on the call
line, up to ${ESCAPE_LOOKBACK_LINES} lines above it, or trailing on the chain.

Refs #3586 #3572.
`);
    process.exit(1);
  }

  const skipped = totals.skippedDynamicTable + totals.skippedUnknownRelation + totals.skippedDynamicSelect;
  console.log(
    `\n✅ Schema-column guard: ${totals.selectsVerified}/${totals.selectsSeen} selects verified `
    + `across ${totals.files} file(s), ${totals.verifiedColumns} columns checked, no unknown columns`
    + `${known ? ` (${known} known finding(s) still allow-listed)` : ''}.`,
  );
  console.log(
    `   Skipped (honest coverage): ${skipped} select(s) — ${totals.skippedDynamicTable} dynamic table, `
    + `${totals.skippedUnknownRelation} relation not in snapshot, ${totals.skippedDynamicSelect} dynamic select-arg. `
    + `Tokens: ${totals.wildcards} wildcard, ${totals.skippedEmbeds} unresolved embed, ${totals.skippedTokens} non-plain token.`,
  );
  process.exit(0);
}

if (isMain()) {
  Promise.resolve()
    .then(run)
    .catch((err) => {
      process.stderr.write(`lint-schema-columns: ${err.stack || err.message}\n`);
      process.exit(2);
    });
}
