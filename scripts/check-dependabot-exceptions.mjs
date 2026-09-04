#!/usr/bin/env node
// scripts/check-dependabot-exceptions.mjs
// ============================================================
// Forward-guard mod udatérede dependency-undtagelser (#4551).
//
// WHY (ejer-direktiv 1/9): "en undtagelse uden udløb er en permanent
// undtagelse". `.github/dependabot.yml`'s ignore-entries og
// `.github/workflows/dependency-review.yml`'s GHSA/license-allowlists er
// begge steder man kan lukke øjnene for en sårbarhed eller en major-bump for
// evigt uden at nogen mærker det — indtil et helt andet PR (React 19-bumpet,
// #4547) tilfældigvis rydder op i det. GHSA-allowlisten stod uden review-dato
// i månederne mellem #2960 og #4547 og løj om vores reelle exponering.
// Samme mønster som #4463/#4335: en vagt mod ERKLÆRET tilstand, ikke mod
// runtime-adfærd.
//
// RULE:
//   Hver `ignore`-entry i .github/dependabot.yml og hver
//   `allow-ghsas`/`allow-licenses`-linje i
//   .github/workflows/dependency-review.yml SKAL have en kommentarblok
//   umiddelbart ovenfor med (a) en issue-reference (`#<tal>`) og (b) en
//   review-dato på formen `review YYYY-MM-DD`. Guarden fejler hvis en af
//   delene mangler, ELLER hvis review-datoen er passeret.
//
// Bevidst tekstuel/regex-baseret parsing (samme idiom som repoets øvrige
// statiske guards, fx lint-workflow-output-masking.mjs) — roden har ingen
// YAML-parser som runtime-dependency.
//
// Usage:
//   node scripts/check-dependabot-exceptions.mjs
//   node scripts/check-dependabot-exceptions.mjs --now 2027-01-01   (test-hook)
//
// Exit codes:
//   0 - alle undtagelser har issue-reference + ikke-udløbet review-dato
//   1 - mindst én undtagelse mangler reference/dato, eller er udløbet
//
// Refs #4551 #4463 #4335.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ISSUE_REF = /#(\d+)/;
const REVIEW_DATE = /\breview\s+(\d{4}-\d{2}-\d{2})\b/i;
const MAX_COMMENT_LOOKBACK = 12;

/**
 * Saml den sammenhaengende blok af kommentarlinjer (`#...`) der staar
 * UMIDDELBART over linje `index` (blanke linjer springes IKKE over — en
 * blank linje afbryder blokken, ligesom i resten af filens konvention).
 *
 * @param {string[]} lines
 * @param {number} index linjen der skal have en begrundelse ovenfor
 * @returns {string} de fundne kommentarlinjer, sammensat med '\n'
 */
function commentBlockAbove(lines, index) {
  const collected = [];
  let i = index - 1;
  let steps = 0;
  while (i >= 0 && steps < MAX_COMMENT_LOOKBACK) {
    const line = lines[i];
    if (/^\s*#/.test(line)) {
      collected.unshift(line);
      i--;
      steps++;
      continue;
    }
    break;
  }
  return collected.join('\n');
}

/**
 * @param {string} block kommentarblok fundet af commentBlockAbove
 * @param {string} name den undtagelse blokken skal begrunde (til fejlbesked)
 * @param {number} line 1-indekseret linjenummer for selve entry'en
 * @param {string} file rapporteret filsti
 * @param {Date} now
 * @returns {{file: string, line: number, name: string, message: string}|null}
 */
function validateBlock(block, name, line, file, now) {
  if (!block) {
    return { file, line, name, message: `\`${name}\` har ingen kommentarblok ovenfor — mangler issue-reference OG review-dato.` };
  }
  const issueMatch = block.match(ISSUE_REF);
  const dateMatch = block.match(REVIEW_DATE);
  if (!issueMatch && !dateMatch) {
    return { file, line, name, message: `\`${name}\` mangler både issue-reference (#N) og review-dato (\`review YYYY-MM-DD\`) i kommentarblokken.` };
  }
  if (!issueMatch) {
    return { file, line, name, message: `\`${name}\` mangler issue-reference (#N) i kommentarblokken.` };
  }
  if (!dateMatch) {
    return { file, line, name, message: `\`${name}\` mangler review-dato (\`review YYYY-MM-DD\`) i kommentarblokken.` };
  }
  const reviewDate = new Date(`${dateMatch[1]}T00:00:00Z`);
  if (Number.isNaN(reviewDate.getTime())) {
    return { file, line, name, message: `\`${name}\`'s review-dato \`${dateMatch[1]}\` er ikke en gyldig kalenderdato.` };
  }
  if (reviewDate.getTime() < now.getTime()) {
    return {
      file, line, name,
      message: `\`${name}\`'s review-dato (${dateMatch[1]}, #${issueMatch[1]}) er OVERSKREDET. En undtagelse uden gyldig udløb er en permanent undtagelse — genbekræft eller fjern.`,
    };
  }
  return null;
}

/**
 * Scan .github/dependabot.yml for `- dependency-name: "X"` under en
 * `ignore:`-nøgle, og krav en begrundet kommentarblok over hver.
 *
 * @param {string} source
 * @param {string} file
 * @param {Date} now
 * @returns {Array<{file: string, line: number, name: string, message: string}>}
 */
export function scanDependabotIgnores(source, file, now = new Date()) {
  const lines = source.split('\n');
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s+dependency-name:\s*"([^"]+)"/);
    if (!m) continue;
    const block = commentBlockAbove(lines, i);
    const finding = validateBlock(block, m[1], i + 1, file, now);
    if (finding) findings.push(finding);
  }
  return findings;
}

/**
 * Scan en workflow-fil (i praksis dependency-review.yml) for
 * `allow-ghsas:`/`allow-licenses:`-linjer under `dependency-review-action`,
 * og krav en begrundet kommentarblok over hver.
 *
 * @param {string} source
 * @param {string} file
 * @param {Date} now
 * @returns {Array<{file: string, line: number, name: string, message: string}>}
 */
export function scanDependencyReviewAllowlist(source, file, now = new Date()) {
  const lines = source.split('\n');
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(allow-ghsas|allow-licenses):\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim();
    // Tomt/kommenteret ud (fx `allow-ghsas:` alene som skabelon) er intet fund.
    if (!value || value.startsWith('#')) continue;
    const block = commentBlockAbove(lines, i);
    const finding = validateBlock(block, `${m[1]}: ${value}`, i + 1, file, now);
    if (finding) findings.push(finding);
  }
  return findings;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function repoRoot() {
  return resolve(fileURLToPath(new URL('..', import.meta.url)));
}

export function defaultTargets() {
  const root = repoRoot();
  return {
    dependabotYml: resolve(root, '.github/dependabot.yml'),
    dependencyReviewYml: resolve(root, '.github/workflows/dependency-review.yml'),
  };
}

function parseNowArg(argv) {
  const idx = argv.indexOf('--now');
  if (idx === -1) return new Date();
  const val = argv[idx + 1];
  const parsed = new Date(`${val}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    console.error(`--now: ugyldig dato "${val}" (forventet YYYY-MM-DD)`);
    process.exit(2);
  }
  return parsed;
}

function main(argv) {
  const now = parseNowArg(argv);
  const { dependabotYml, dependencyReviewYml } = defaultTargets();

  const findings = [
    ...scanDependabotIgnores(readFileSync(dependabotYml, 'utf8'), '.github/dependabot.yml', now),
    ...scanDependencyReviewAllowlist(readFileSync(dependencyReviewYml, 'utf8'), '.github/workflows/dependency-review.yml', now),
  ];

  if (findings.length === 0) {
    console.log(
      '\n✅ Dependabot-exceptions-guard: alle ignore-entries + allowlist-linjer har issue-reference ' +
      `+ ikke-udløbet review-dato (målt mod ${now.toISOString().slice(0, 10)}).`
    );
    return 0;
  }

  console.error(`\n❌ Dependabot-exceptions-guard: ${findings.length} fund\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} — ${f.name}`);
    console.error(`      ${f.message}\n`);
  }
  console.error(
    'En undtagelse uden udløb er en permanent undtagelse (ejer-direktiv 1/9). Tilføj\n' +
    '`# #<issue> - review <YYYY-MM-DD>` til kommentarblokken over entry\'en, eller fjern\n' +
    'undtagelsen hvis den ikke længere er nødvendig. Se #4551.\n'
  );
  return 1;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
