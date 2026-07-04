#!/usr/bin/env node
// scripts/lint-rankings-raceresults-fetch.mjs
// ============================================================
// Forward-guard for the rangliste perf-regression class (#2196 Del 2).
//
// Origin: #2175 (Del 1) fixed a hard perf bug — /standings og /rider-rankings
// hentede ALLE ~38k race_results til browseren og aggregerede client-side (én
// fejlet batch = uendelig spinner). Del 1 flyttede aggregeringen til Postgres-
// matviews (rider_rankings_mv, team_standings_ext_mv, team_race_points_mv);
// frontend laver nu lette queries mod færdig-beregnet resultat.
//
// The regression this guard blocks: a future edit RE-INTRODUCES a direct
// `.from("race_results")` fetch in a rangliste data-path — the exact 38k-row
// client-fetch Del 1 removed. That degrades perf silently (no error, just a slow
// page), which is precisely what nobody gets alerted about today. The runtime
// counterpart is stall-watchdog check (e) (matview-refresh-stall); this is the
// build-time half — catch the regression at PR review, not in prod.
//
// A realtime SUBSCRIPTION on race_results (a change-signal, not a fetch) is fine
// and NOT flagged: `["season_standings", "race_results"]` has no `.from(` before
// it, so only an actual `.from("race_results")` PostgREST fetch trips the guard.
//
// SCOPE: the three known rangliste data-paths (hard-coded, not a directory scan —
// other pages legitimately fetch race_results). A missing target file is a HARD
// error, not a skip: a rename must force updating this guard, never rot silently.
//
// Escape hatch: `rankings-raceresults-ok` in a comment on the same line or the
// line directly above, when a fetch is genuinely intentional (with a reason).
//
// Usage:
//   node scripts/lint-rankings-raceresults-fetch.mjs                 # default targets
//   node scripts/lint-rankings-raceresults-fetch.mjs path/to/file.js # explicit files
//   npm run lint:rankings-fetch
//
// Exit codes:
//   0 — no findings
//   1 — at least one race_results fetch in a rangliste data-path (or missing target)
//   2 — internal error
//
// Refs #2175 #2196.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Rangliste-datastier (relative til repo-root). Hold i sync med de faktiske filer;
// en rename her er en bevidst handling, ikke noget guarden må gætte sig til.
export const DEFAULT_TARGETS = [
  'frontend/src/pages/RiderRankingsPage.jsx',
  'frontend/src/pages/StandingsPage.jsx',
  'frontend/src/hooks/useRiderRankings.js',
];

const OPT_OUT = 'rankings-raceresults-ok';

// `.from(` + quote + race_results + quote. Fanger .from("race_results") /
// .from('race_results') / .from(`race_results`). Realtime-arrays har intet
// `.from(` foran → matches ikke.
const RACE_RESULTS_FETCH = /\.from\(\s*(['"`])race_results\1/;

/**
 * Blank // line-comments and /* *​/ block-comments while PRESERVING string
 * literals (the forbidden `.from("race_results")` argument IS a string, so we
 * must not blank strings the way lint-postgrest-in-cap does) and newlines
 * (so line numbers stay accurate).
 *
 * @param {string} src
 * @returns {string} same-length source with comments blanked
 */
export function stripCommentsKeepStrings(src) {
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
      if (c === "'") { state = 3; out += c; i++; continue; }
      if (c === '"') { state = 4; out += c; i++; continue; }
      if (c === '`') { state = 5; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 1) { // line comment
      if (c === '\n') { state = 0; out += '\n'; } else out += ' ';
      i++; continue;
    }
    if (state === 2) { // block comment
      if (c2 === '*/') { state = 0; out += '  '; i += 2; continue; }
      out += (c === '\n' ? '\n' : ' '); i++; continue;
    }
    // string states 3/4/5 — preserve chars, honour backslash escapes
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
    if ((state === 3 && c === "'") || (state === 4 && c === '"') || (state === 5 && c === '`')) {
      state = 0;
    }
    out += c; i++; continue;
  }
  return out;
}

/**
 * Scan one source for a `.from("race_results")` fetch outside comments.
 *
 * @param {string} source
 * @param {string} filename
 * @returns {Array<{file:string,line:number,snippet:string}>}
 */
export function scan(source, filename = '<source>') {
  const code = stripCommentsKeepStrings(source);
  const srcLines = source.split('\n');
  const codeLines = code.split('\n');
  const findings = [];
  for (let idx = 0; idx < codeLines.length; idx++) {
    if (!RACE_RESULTS_FETCH.test(codeLines[idx])) continue;
    // Escape hatch: opt-out marker on this line or the line directly above (raw source).
    const here = srcLines[idx] || '';
    const above = srcLines[idx - 1] || '';
    if (here.includes(OPT_OUT) || above.includes(OPT_OUT)) continue;
    findings.push({ file: filename, line: idx + 1, snippet: here.trim().slice(0, 120) });
  }
  return findings;
}

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try { return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? ''); }
  catch { return false; }
}

function run() {
  const args = process.argv.slice(2);
  const files = args.length ? args : DEFAULT_TARGETS;
  let bad = 0;

  for (const f of files) {
    // Missing default target = hard error (a rename must update this guard).
    if (!args.length && !existsSync(f)) {
      process.stderr.write(`🔴 rangliste-fetch guard: target-fil mangler: ${f}\n`);
      process.stderr.write(`   Er filen omdøbt/flyttet? Opdatér DEFAULT_TARGETS i ${'scripts/lint-rankings-raceresults-fetch.mjs'}.\n`);
      bad++;
      continue;
    }
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    for (const fnd of scan(src, f)) {
      bad++;
      process.stderr.write(`${fnd.file}:${fnd.line}: rangliste-sti fetcher race_results direkte: ${fnd.snippet}\n`);
    }
  }

  if (bad > 0) {
    process.stderr.write(`
🔴 Rangliste-fetch guard blocked: ${bad} problem(er).

Background: #2175 (Del 1) flyttede rangliste-aggregeringen fra en ~38k-rækkers
client-fetch af race_results til Postgres-matviews (rider_rankings_mv m.fl.). En
ny direkte .from("race_results")-fetch i en rangliste-sti gen-introducerer den
tavse perf-regression (langsom side, ingen fejl).

Fix: query det relevante matview i stedet (rider_rankings_mv / team_standings_ext_mv
/ team_race_points_mv), eller aggregér backend-side.

Bevidst fetch? Tilføj en "${OPT_OUT}"-kommentar på linjen (eller linjen over) med
en begrundelse.

Refs #2175 #2196.
`);
    process.exit(1);
  }
  process.exit(0);
}

if (isMain()) {
  try { run(); }
  catch (err) {
    process.stderr.write(`lint-rankings-raceresults-fetch: ${err.stack || err.message}\n`);
    process.exit(2);
  }
}
