#!/usr/bin/env node
// scripts/lint-sql-insert-arity.mjs
// ============================================================
// Forward-guard for #4943 — INSERT column-list arity mismatch.
//
// Origin: 2026-09-07-4943-in-app-survey.sql shipped
//   INSERT INTO public.surveys (slug, title_en, title_da, status)
//   VALUES ('2026-09-features', 'What should I build next?', 'Hvad skal jeg
//   bygge næste gang?')
// — four columns, three values. auto-migrate.yml ran the file with
// `psql -v ON_ERROR_STOP=1` (no -1, so earlier statements in the same file
// stayed committed) and aborted on
//   ERROR: INSERT has more target columns than expressions
// before the `schema_migrations` row was written, so the next merge to main
// re-ran the whole file. Simple typo, silent-until-CI failure class — this
// lint catches it locally / at commit-time instead.
//
// Scope (deliberately narrow): a single `INSERT INTO <table> (<cols>)
// VALUES (<tuple>) [, (<tuple>) ...]` statement, i.e. the literal
// column-list-then-VALUES-tuples shape. It does NOT attempt to understand
// `INSERT INTO t (cols) SELECT ... FROM (VALUES (...), (...)) AS q(...)`
// (used by this same migration's survey_questions seed) — that shape binds
// columns via the SELECT list, not positionally against VALUES, and each of
// its VALUES-table rows is already required to satisfy the `q(...)` alias
// arity by Postgres itself at parse time, so a mismatch there is loud, not
// silent (query fails to even plan, not a partial-then-abort mid-file).
//
// Tokeniser: reuses the same lightweight, zero-dependency approach as
// scripts/lint-sql-strings.mjs — strip line/block comments and dollar-quoted
// bodies to whitespace (preserving length + line numbers), then walk the
// cleaned text tracking paren/bracket depth and single-quoted strings so
// that:
//   - commas inside a string literal ('a, b') don't split a value/column,
//   - commas inside a nested call/cast (`numeric(10,2)`, `now()`,
//     `ARRAY[1,2,3]`, `(SELECT ...)`) don't split at the wrong depth,
//   - `''` (escaped apostrophe) doesn't end the string early.
//
// Usage:
//   node scripts/lint-sql-insert-arity.mjs database/foo.sql database/bar.sql
//   node scripts/lint-sql-insert-arity.mjs                  # defaults to database/*.sql
//   npm run lint:sql-arity                                   # same as above
//
// Historical migrations already applied to prod are never edited to satisfy
// a lint added after the fact (editing an applied migration is pointless —
// psql already ran the old text — and risks masking real history). If one
// trips this lint, it goes in WHITELIST_FILES below with a comment, not a
// code fix.
//
// Exit codes:
//   0 — no findings (outside the whitelist)
//   1 — at least one file has an INSERT column/value arity mismatch
//
// Refs #4943.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Already-applied migrations that trip this lint (heuristic false-positive
// or a historical bug in a file psql has already run against prod). Do NOT
// "fix" these — editing an applied migration changes nothing in prod and
// only muddies history. Add an entry with a one-line reason if a new file
// needs it; keep the list short by fixing genuinely new/unapplied files
// instead.
const WHITELIST_FILES = new Set([
  // (none yet — see README above for the exemption policy)
]);

/**
 * Strip `--` line comments, `/* *\/` block comments, and `$tag$...$tag$`
 * dollar-quoted bodies from `source`, replacing removed characters with
 * spaces (newlines preserved) so indices/line numbers stay aligned with the
 * original text. Single-quoted strings are left untouched — the caller's
 * paren/quote-aware walker needs their real content.
 */
export function stripCommentsAndDollarQuotes(source) {
  const n = source.length;
  let out = '';
  let i = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false; // single-quoted string — must still track to avoid
  // treating `--` or `/*` inside a string literal as a real comment opener.
  let dollarTag = null; // string tag when inside a dollar-quoted body, else null

  while (i < n) {
    const c = source[i];
    const c2 = source.slice(i, i + 2);

    if (inLineComment) {
      out += c === '\n' ? '\n' : ' ';
      if (c === '\n') inLineComment = false;
      i++;
      continue;
    }

    if (inBlockComment) {
      if (c2 === '*/') {
        out += '  ';
        i += 2;
        inBlockComment = false;
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    if (dollarTag !== null) {
      const closeMarker = `$${dollarTag}$`;
      if (source.slice(i, i + closeMarker.length) === closeMarker) {
        out += ' '.repeat(closeMarker.length);
        i += closeMarker.length;
        dollarTag = null;
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    if (inString) {
      out += c;
      if (c === "'") {
        if (source[i + 1] === "'") {
          out += source[i + 1];
          i += 2;
          continue;
        }
        inString = false;
      }
      i++;
      continue;
    }

    // Not inside a comment/dollar-quote/string right now.
    if (c === "'") {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c2 === '--') {
      inLineComment = true;
      out += '  ';
      i += 2;
      continue;
    }
    if (c2 === '/*') {
      inBlockComment = true;
      out += '  ';
      i += 2;
      continue;
    }
    if (c === '$') {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(source[j])) j++;
      if (j < n && source[j] === '$') {
        dollarTag = source.slice(i + 1, j);
        out += ' '.repeat(j + 1 - i);
        i = j + 1;
        continue;
      }
    }
    out += c;
    i++;
  }

  return out;
}

function lineAt(source, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

/**
 * Parse a parenthesised, comma-separated list starting right after an
 * opening `(` at `cleaned[openIdx]`. Tracks nested `()`/`[]` depth and
 * single-quoted strings (`''` escape respected) so commas inside a nested
 * call, cast, or string literal don't split an item.
 *
 * @returns {{items: string[], endIdx: number} | null} endIdx is the index of
 *   the matching closing `)` (exclusive-end use: caller should resume at
 *   endIdx + 1). Returns null if the closing paren is never found (malformed
 *   / truncated — caller should bail out silently rather than guess).
 */
function parseParenGroup(cleaned, openIdx) {
  const n = cleaned.length;
  if (cleaned[openIdx] !== '(') return null;
  let i = openIdx + 1;
  let depth = 1;
  let itemStart = i;
  const items = [];
  let inString = false;

  while (i < n) {
    const c = cleaned[i];

    if (inString) {
      if (c === "'") {
        if (cleaned[i + 1] === "'") {
          i += 2;
          continue;
        }
        inString = false;
      }
      i++;
      continue;
    }

    if (c === "'") {
      inString = true;
      i++;
      continue;
    }
    if (c === '(' || c === '[') {
      depth++;
      i++;
      continue;
    }
    if (c === ')' || c === ']') {
      depth--;
      if (depth === 0) {
        // Only ')' can legally close the group we opened with '('; a
        // mismatched ']' at depth 0 means malformed input — bail out.
        if (c !== ')') return null;
        const tail = cleaned.slice(itemStart, i).trim();
        if (tail.length > 0 || items.length > 0) items.push(tail);
        return { items, endIdx: i };
      }
      i++;
      continue;
    }
    if (c === ',' && depth === 1) {
      items.push(cleaned.slice(itemStart, i).trim());
      itemStart = i + 1;
      i++;
      continue;
    }
    i++;
  }
  return null; // unterminated — malformed or truncated snippet
}

/**
 * Scan a single SQL source for `INSERT INTO <table> (<cols>) VALUES
 * (<tuple>) [, (<tuple>) ...]` statements whose column-list length doesn't
 * match one of its VALUES tuples.
 *
 * @param {string} source - file contents
 * @param {string} filename - for diagnostics
 * @returns {Array<{file: string, line: number, table: string, expected: number, actual: number, tupleIndex: number}>}
 */
export function scan(source, filename = '<source>') {
  const cleaned = stripCommentsAndDollarQuotes(source);
  const findings = [];
  const insertRe = /\bINSERT\s+INTO\s+([A-Za-z0-9_."]+)\s*\(/gi;
  let m;

  while ((m = insertRe.exec(cleaned)) !== null) {
    const table = m[1];
    const colsOpenIdx = m.index + m[0].length - 1; // index of the '('
    const colsGroup = parseParenGroup(cleaned, colsOpenIdx);
    if (!colsGroup) continue;
    const colCount = colsGroup.items.length;

    // Immediately after the column list must come VALUES for this to be
    // the shape we check — a SELECT-based INSERT (e.g. the
    // survey_questions seed) is intentionally out of scope (see header).
    const afterCols = cleaned.slice(colsGroup.endIdx + 1);
    const valuesMatch = afterCols.match(/^\s*VALUES\s*/i);
    if (!valuesMatch) continue;

    let cursor = colsGroup.endIdx + 1 + valuesMatch[0].length;
    let tupleIndex = 0;
    while (cleaned[cursor] === '(') {
      const tupleGroup = parseParenGroup(cleaned, cursor);
      if (!tupleGroup) break;
      const valCount = tupleGroup.items.length;
      if (valCount !== colCount) {
        findings.push({
          file: filename,
          line: lineAt(source, cursor),
          table,
          expected: colCount,
          actual: valCount,
          tupleIndex,
        });
      }
      cursor = tupleGroup.endIdx + 1;
      tupleIndex++;
      // Advance past a `, (` separator to the next tuple, if present.
      const sepMatch = cleaned.slice(cursor).match(/^\s*,\s*(?=\()/);
      if (!sepMatch) break;
      cursor += sepMatch[0].length;
    }

    // Resume scanning after this statement so overlapping/nested matches
    // (e.g. a value containing the literal text "insert into") aren't
    // re-parsed from the wrong offset.
    insertRe.lastIndex = Math.max(insertRe.lastIndex, cursor);
  }

  return findings;
}

function expandGlob(pattern) {
  // Minimal glob: support `database/*.sql` literal pattern (mirrors
  // scripts/lint-sql-strings.mjs — kept zero-dep on purpose).
  const gm = pattern.match(/^(.*?)([/\\])([^/\\*]+)\*(\.[A-Za-z]+)?$/);
  if (!gm) return [pattern];

  const [, dir, sep, prefix, ext] = gm;
  const dirPath = dir || '.';
  try {
    const entries = readdirSync(dirPath);
    return entries
      .filter((entry) => entry.startsWith(prefix) && (!ext || entry.endsWith(ext)))
      .map((entry) => `${dirPath}${sep}${entry}`)
      .filter((p) => {
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [pattern];
  }
}

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try {
    const here = fileURLToPath(import.meta.url);
    const main = resolve(process.argv[1] ?? '');
    return resolve(here) === main;
  } catch {
    return false;
  }
}

async function main() {
  let files = process.argv.slice(2);
  if (files.length === 0) {
    files = expandGlob('database/*.sql');
  } else {
    files = files.flatMap((p) => (p.includes('*') ? expandGlob(p) : [p]));
  }

  let anyBad = false;
  for (const f of files) {
    let src;
    try {
      src = readFileSync(f, 'utf8');
    } catch {
      continue; // lint-staged only passes existing files; skip otherwise
    }
    if (WHITELIST_FILES.has(basename(f))) continue;

    const findings = scan(src, f);
    if (findings.length > 0) {
      anyBad = true;
      for (const fnd of findings) {
        process.stderr.write(
          `${fnd.file}:${fnd.line}: INSERT INTO ${fnd.table} — column list has ${fnd.expected} column(s) but tuple #${fnd.tupleIndex + 1} has ${fnd.actual} value(s)\n`
        );
      }
    }
  }

  if (anyBad) {
    process.stderr.write(`
🔴 SQL lint blocked: INSERT column-list arity mismatch.

Background: #4943 — \`INSERT INTO public.surveys (slug, title_en, title_da,
status) VALUES (..., ..., ...)\` had 4 columns and 3 values. auto-migrate.yml
ran with ON_ERROR_STOP=1 and aborted mid-file: the tables/RLS before the
INSERT stayed committed, but the seed row and the schema_migrations entry
never landed, so the whole file re-ran on the next merge to main.

Fix: make the column list and every VALUES tuple the same length — either
add the missing value(s) or drop the extra column(s) (a column with a
DEFAULT can usually just be omitted from both sides).

Whitelisted (never edited): historical migrations already applied to prod —
see WHITELIST_FILES in scripts/lint-sql-insert-arity.mjs.

Override (LAST RESORT): git commit --no-verify

Refs #4943.
`);
    process.exit(1);
  }
  process.exit(0);
}

if (isMain()) {
  main().catch((err) => {
    process.stderr.write(`lint-sql-insert-arity: ${err.stack || err.message}\n`);
    process.exit(2);
  });
}
