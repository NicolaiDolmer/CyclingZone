import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isTestFile } from './merge-queue-classify.mjs';
import { findFunctionSettings } from './lint-migration-function-settings.mjs';

const UI_FILE = /^frontend\/src\/(?!preview\/).*\.(?:jsx|tsx|css|scss)$/i;
const MIGRATION = /^(?:database|supabase\/migrations)\/.*\.sql$/i;
const FIX = /^fix(?:\([^)]*\))?!?:\s/i;
const PROD_SECTION = /^## +Fejlens effekt i prod\s*$/m;
const SIDE = /^\s*(?:[-*]\s+|#{3,6}\s+)?\**(Før|Efter)\**\s*(?::\**\s*|$)/gim;
const IMAGE = /\[[^\]]*\]\(([^)]+\.(?:png|jpe?g|webp|avif)(?:[?#][^)]*)?)\)/gi;
const BEFORE_AFTER = /(?:før\s*(?:\/|og|[-–])\s*efter|before\s*(?:\/|and|[-–])\s*after)/i;

function activeMarkdown(body) {
  return body.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*```[^\n]*\n[\s\S]*?^\s*```\s*$/gm, '');
}

function hasProdEffect(body) {
  const header = PROD_SECTION.exec(body);
  if (!header) return false;
  const section = body.slice(header.index + header[0].length).split(/^#{1,2} +/m)[0];
  const labels = [...section.matchAll(SIDE)];
  const populated = labels.filter((label, i) => {
    const text = section.slice(label.index + label[0].length, labels[i + 1]?.index ?? section.length);
    return text.trim().length > 0;
  });
  return ['før', 'efter'].every((side) => populated.some((label) => label[1].toLowerCase() === side));
}

export function deliveryFindings({ title = '', body = '', files = [], migrations = [] } = {}) {
  const findings = [];
  const markdown = activeMarkdown(body);
  for (const line of markdown.split(/\r?\n/)) {
    if (!/^\s*(?:[-*]\s+)?Refs\b/i.test(line)) continue;
    const refs = [...line.matchAll(/#\d+/g)];
    if (refs.slice(1).some((ref, index) => !/^\s*,\s*$/.test(line.slice(refs[index].index + refs[index][0].length, ref.index)))) {
      findings.push('Sæt komma mellem issue-numre på Refs-linjen, fx Refs #10, #11.');
      break;
    }
  }
  if (FIX.test(title) && !hasProdEffect(markdown)) {
    findings.push('Fix-PR’en skal have ## Fejlens effekt i prod med udfyldt Før og Efter i samme sektion.');
  }
  const touchesUi = files.some((path) => UI_FILE.test(path) && !isTestFile(path));
  const linkedBeforeAfter = [...markdown.matchAll(IMAGE)].some((match) =>
    BEFORE_AFTER.test(match[0]) || (BEFORE_AFTER.test(markdown) && /(?:^|\/)pr-screens\//i.test(match[1]))
  );
  if (touchesUi && !linkedBeforeAfter) {
    findings.push('Link til ét annoteret før/efter-billede for frontend-UI i PR-body, fx [Før/efter](pr-screens/ændring.png).');
  }
  for (const { path, sql } of migrations) {
    for (const { setting, line } of findFunctionSettings(sql, path, { includeTopLevel: true })) {
      findings.push(`${path}:${line} bruger SET ${setting.replaceAll('"', '')}. Fjern den egne punktum-indstilling fra migrationen.`);
    }
  }
  return findings;
}

function gitPaths(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 15_000 }).split('\0').filter(Boolean);
}

function currentPullRequest(cwd) {
  try {
    const json = execFileSync('gh', ['pr', 'view', '--json', 'state,title,body'], {
      cwd, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pr = JSON.parse(json);
    return pr.state === 'OPEN' ? pr : null;
  } catch {
    return null;
  }
}

export function missingPrMetadata({ files, title, bodyKnown }) {
  return files.length > 0 && (!title.trim() || !bodyKnown)
    ? 'PR-metadata kunne ikke bekræftes. Brug -PrTitle og -PrBodyFile med den aktuelle kladdetekst, eller kontrollér GitHub-adgangen.'
    : null;
}

function main([prTitle = '', prBodyFile = ''], cwd = process.cwd()) {
  const files = [...new Set([
    ...gitPaths(cwd, ['--no-pager', 'diff', '--name-only', '-z', 'origin/main...HEAD']),
    ...gitPaths(cwd, ['--no-pager', 'diff', '--name-only', '-z', 'HEAD']),
    ...gitPaths(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])];
  const pr = prBodyFile && prTitle ? null : currentPullRequest(cwd);
  const title = prTitle || pr?.title || '';
  const body = prBodyFile ? readFileSync(resolve(cwd, prBodyFile), 'utf8') : pr?.body ?? '';
  const metadataFinding = missingPrMetadata({ files, title, bodyKnown: Boolean(prBodyFile || pr) });
  const migrations = files.filter((file) => MIGRATION.test(file) && existsSync(resolve(cwd, file)))
    .map((file) => ({ path: file, sql: readFileSync(resolve(cwd, file), 'utf8') }));
  const findings = deliveryFindings({ title, body, files, migrations });
  if (metadataFinding) findings.unshift(metadataFinding);
  for (const finding of findings) process.stderr.write(`${finding}\n`);
  return findings.length ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`PR-preflight kunne ikke læse ændringer eller PR-body: ${error.message}\n`);
    process.exitCode = 1;
  }
}
