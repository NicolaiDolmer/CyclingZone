#!/usr/bin/env node
// scripts/lint-sql-strings.mjs
// ============================================================
// Forward-guard for #639 — unescaped apostrophes in SQL string-literals.
//
// Origin: #635. Migration 2026-05-24-squad-enforcement-started-at.sql:63
// shipped with `claim'et` instead of `claim''et`. psql ON_ERROR_STOP=1
// aborted the COMMENT statement, schema_migrations row never INSERT'ed,
// drift sat for days until the weekly feature-liveness audit caught it.
//
// This lint runs at commit-time (lint-staged) on staged database/*.sql
// files. It tokenises with a small state machine:
//
//   1. Skip line comments (`-- ...` to EOL).
//   2. Skip block comments (`/* ... */`).
//   3. Skip dollar-quoted strings ($$...$$ and $tag$...$tag$). These are
//      PL/pgSQL function bodies and may legitimately contain `'` literals.
//   4. Inside a single-quoted string ('...'), `''` is an escaped apostrophe
//      and is allowed. A closing `'` is "suspicious" when the IMMEDIATELY
//      next character (no whitespace skip) is an identifier-ish char
//      ([A-Za-z0-9_]). That's the exact shape of the #635 bug: `claim'et`.
//      Legitimate SQL like `'foo' FROM t` has a space after the closing
//      apostrophe, so it doesn't trip. `'foo'::cast` has `:` which is
//      not [A-Za-z0-9_], so it also doesn't trip.
//
// Heuristic-vs-tokenizer trade-off:
//   - psql's own grammar would be authoritative but requires a live DB.
//   - This heuristic accepts close-tokens like ` `, `||`, `,`, `)`, `;`,
//     EOL, `::cast`, etc. as legitimate string-end markers — verified
//     against all database/*.sql files 2026-05-25 — clean (0 findings).
//
// Usage:
//   node scripts/lint-sql-strings.mjs database/foo.sql database/bar.sql
//   node scripts/lint-sql-strings.mjs                  # defaults to database/*.sql
//   npm run lint:sql                                    # same as above
//
// Exit codes:
//   0 — no findings
//   1 — at least one file has an unescaped apostrophe
//
// Refs #639 #635.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APOST = "'";

/**
 * Scan a single SQL source for unescaped apostrophes in single-quoted strings.
 *
 * State machine:
 *   0 normal SQL
 *   1 line comment (-- to EOL)
 *   2 block comment (/ * ... * /)
 *   3 single-quoted string ( ' ... ' )
 *   4 dollar-quoted string ($tag$ ... $tag$)
 *
 * @param {string} source - file contents
 * @param {string} filename - for diagnostics
 * @returns {Array<{file: string, line: number, snippet: string}>}
 */
export function scan(source, filename = '<source>') {
  const findings = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  let state = 0;
  let dquoteTag = '';
  let lit = '';
  let litLine = 0;

  while (i < n) {
    const c = source[i];
    const c2 = source.slice(i, i + 2);

    if (c === '\n') {
      // Line comment terminates at EOL; nothing else affected by newline
      // since SQL strings may span lines (we don't reset litLine).
      if (state === 1) state = 0;
      line++;
      i++;
      continue;
    }

    if (state === 1) {
      // line comment — consume to EOL
      i++;
      continue;
    }

    if (state === 2) {
      // block comment — look for */
      if (c2 === '*/') {
        state = 0;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (state === 3) {
      // inside single-quoted string
      if (c === APOST) {
        const nxt = i + 1 < n ? source[i + 1] : '';
        if (nxt === APOST) {
          // escaped apostrophe — stay in string, consume both
          lit += "''";
          i += 2;
          continue;
        }
        // closing apostrophe — flag iff the IMMEDIATELY next char is an
        // identifier-ish character (#635 shape: `claim'et`). Legitimate
        // SQL like `'foo' FROM` has whitespace; `'foo'::text` has `:`;
        // `'foo')` has `)` — none of those trigger.
        const follow = i + 1 < n ? source[i + 1] : '';
        if (follow && /[A-Za-z0-9_]/.test(follow)) {
          const lastChars = lit.length > 40 ? lit.slice(-40) : lit;
          const tailEnd = Math.min(n, i + 12);
          const tail = source.slice(i, tailEnd).replace(/\n.*$/s, '');
          findings.push({
            file: filename,
            line: litLine,
            snippet: `${lastChars}<<HERE>>${tail}`,
          });
        }
        state = 0;
        lit = '';
        i++;
        continue;
      }
      lit += c;
      i++;
      continue;
    }

    if (state === 4) {
      // inside dollar-quoted string — look for matching close tag
      const closeMarker = `$${dquoteTag}$`;
      if (source.slice(i, i + closeMarker.length) === closeMarker) {
        state = 0;
        dquoteTag = '';
        i += closeMarker.length;
        continue;
      }
      i++;
      continue;
    }

    // state 0 — normal SQL
    if (c2 === '--') {
      state = 1;
      i += 2;
      continue;
    }
    if (c2 === '/*') {
      state = 2;
      i += 2;
      continue;
    }
    if (c === '$') {
      // dollar-quote opener: $tag$ where tag is [A-Za-z0-9_]*
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(source[j])) j++;
      if (j < n && source[j] === '$') {
        dquoteTag = source.slice(i + 1, j);
        state = 4;
        i = j + 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === APOST) {
      state = 3;
      lit = '';
      litLine = line;
      i++;
      continue;
    }
    i++;
  }

  return findings;
}

function expandGlob(pattern) {
  // Minimal glob: support `database/*.sql` literal pattern.
  // We do NOT pull in micromatch — keep zero-dep.
  const m = pattern.match(/^(.*?)([/\\])([^/\\*]+)\*(\.[A-Za-z]+)?$/);
  if (!m) return [pattern];

  const [, dir, sep, prefix, ext] = m;
  const dirPath = dir || '.';
  try {
    const entries = readdirSync(dirPath);
    const matches = entries
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
    return matches;
  } catch {
    return [pattern];
  }
}

function isMain() {
  // CommonJS-on-mjs interop: process.argv[1] is the entry script.
  // ES module main detection across Windows/POSIX.
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
    // expand any glob-like patterns the shell didn't expand (Windows)
    files = files.flatMap((p) => (p.includes('*') ? expandGlob(p) : [p]));
  }

  let anyBad = false;
  for (const f of files) {
    let src;
    try {
      src = readFileSync(f, 'utf8');
    } catch (err) {
      // lint-staged only passes existing files; skip otherwise.
      continue;
    }
    const findings = scan(src, f);
    if (findings.length > 0) {
      anyBad = true;
      for (const fnd of findings) {
        process.stderr.write(
          `${fnd.file}:${fnd.line}: unescaped apostrophe in SQL string-literal: ${fnd.snippet}\n`
        );
      }
    }
  }

  if (anyBad) {
    process.stderr.write(`
🔴 SQL lint blocked: unescaped apostrophe(s) in single-quoted string-literal.

Background: #635 — \`claim'et\` instead of \`claim''et\` made auto-migrate
fail ON_ERROR_STOP=1, schema_migrations row never landed, drift sat for
days. This lint is the forward-guard (#639).

Fix: replace \`'\` with \`''\` inside the affected string.
Example: 'manageren''s klub' (NOT 'manageren's klub').

Override (LAST RESORT): git commit --no-verify

Refs #639 #635.
`);
    process.exit(1);
  }
  process.exit(0);
}

if (isMain()) {
  main().catch((err) => {
    process.stderr.write(`lint-sql-strings: ${err.stack || err.message}\n`);
    process.exit(2);
  });
}
