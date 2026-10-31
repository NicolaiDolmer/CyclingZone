#!/usr/bin/env node
// scripts/til-doers-monday.mjs
// ============================================================
// Mandagsrapport for til-doers-systemet (#7336): alle aabne issues med label
// claude:done, hvor labelen blev sat for over 7 dage siden, med de krav der
// stadig mangler. Postes som kommentar paa #7336 hver mandag kl. 07:00 dansk
// tid af .github/workflows/til-doers.yml.
//
// Datoen for done-markeringen er det SENESTE labeled-event for claude:done i
// issuets timeline. Findes intet event, staar issuet i rapporten med "dato
// ukendt" (hellere med end glemt).
//
// Usage:
//   node scripts/til-doers-monday.mjs                  (dry-run: printer rapporten)
//   node scripts/til-doers-monday.mjs --apply          (poster den paa #7336)
//   node scripts/til-doers-monday.mjs --days 10 --now 2026-11-03T06:00:00Z
//   --repo owner/name  --post-to 7336
//
// Exit codes: 0 ok, 2 ugyldige argumenter eller GitHub-/git-fejl.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseRegistry } from './generate-feature-status.mjs';
import { loadBuildStop } from './lib/build-stop.mjs';
import {
  DEFAULT_REPO,
  DONE_LABEL,
  defaultExecGh,
  defaultExecGit,
  decideClose,
  evaluateDoor,
  lastMarkerAt,
  reopenedAt,
  fetchIssueBundle,
  labeledAt,
  missingKrav,
  resolveMainRef,
} from './lib/til-doers.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
export const REPORT_ISSUE = 7336;
export const DEFAULT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseArgs(argv) {
  const opts = { apply: false, days: DEFAULT_DAYS, now: null, repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO, postTo: REPORT_ISSUE };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a} kræver en værdi`);
      i += 1;
      return v;
    };
    if (a === '--apply') opts.apply = true;
    else if (a === '--dry-run') opts.apply = false;
    else if (a === '--days') {
      opts.days = Number(next());
      if (!Number.isFinite(opts.days) || opts.days < 0) throw new Error('--days skal være et ikke-negativt tal');
    } else if (a === '--now') {
      opts.now = new Date(next());
      if (Number.isNaN(opts.now.getTime())) throw new Error('--now er ikke en gyldig dato');
    } else if (a === '--repo') opts.repo = next();
    else if (a === '--post-to') {
      opts.postTo = Number(next());
      if (!Number.isSafeInteger(opts.postTo) || opts.postTo <= 0) throw new Error('--post-to skal være et issue-nummer');
    } else throw new Error(`ukendt argument: ${a}`);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) throw new Error(`ugyldigt repo: ${opts.repo}`);
  return opts;
}

/**
 * Ren udvaelgelse: hvilke issues er done-markeret for over `days` dage siden?
 * @param {Array<{number,title,doneAt:string|null,missing:Array<{krav,navn}>}>} rows
 */
export function selectStale(rows, { now, days }) {
  const cutoff = now.getTime() - days * DAY_MS;
  return rows
    .filter((r) => !r.doneAt || new Date(r.doneAt).getTime() < cutoff)
    .map((r) => ({ ...r, ageDays: r.doneAt ? Math.floor((now.getTime() - new Date(r.doneAt).getTime()) / DAY_MS) : null }))
    .sort((a, b) => (b.ageDays ?? Infinity) - (a.ageDays ?? Infinity) || a.number - b.number);
}

function copenhagenDate(d) {
  return new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', day: 'numeric', month: 'numeric', year: 'numeric' }).format(d);
}

export function renderReport(stale, { now, days }) {
  const head = `## Til dørs: mandagsrapport ${copenhagenDate(now)}`;
  if (stale.length === 0) {
    return `${head}\n\nIngen åbne issues har haft \`${DONE_LABEL}\` i mere end ${days} dage.`;
  }
  const lines = stale.map((r) => {
    const age = r.ageDays === null ? 'dato ukendt' : `${r.ageDays} dage`;
    const miss = r.missing.length
      ? `mangler ${r.missing.map((k) => `${k.krav} ${k.navn}`).join(', ')}`
      : r.blocker
        ? `alle krav ok eller na, men lukkes ikke: ${r.blocker}`
        : 'alle krav ok eller na, lukkes ved næste tjek';
    return `- #${r.number} ${r.title} (${age}): ${miss}`;
  });
  return [
    head,
    '',
    `${stale.length} åbne issues har haft \`${DONE_LABEL}\` i mere end ${days} dage. Ældste først.`,
    '',
    ...lines,
    '',
    'Markér et krav på selve issuet med `Til dørs: <nr> ok|na <evidens eller begrundelse>`.',
  ].join('\n');
}

export function main(argv = process.argv.slice(2), deps = {}) {
  const execGh = deps.execGh || defaultExecGh;
  const execGit = deps.execGit || defaultExecGit;
  const log = deps.log || ((s) => process.stdout.write(`${s}\n`));
  const errorLog = deps.errorLog || ((s) => process.stderr.write(`${s}\n`));

  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    errorLog(`til-doers-monday: ${err.message}`);
    return 2;
  }
  const now = opts.now || deps.now || new Date();
  const registry = deps.registry || parseRegistry(readFileSync(join(ROOT, 'docs', 'FEATURE_REGISTRY.yml'), 'utf8'));
  const patchNotesText = deps.patchNotesText ?? readFileSync(join(ROOT, 'frontend', 'src', 'data', 'patchNotes.js'), 'utf8');
  const brandList = deps.brandList || loadBuildStop().brandList;

  let rows;
  try {
    const mainRef = deps.mainRef || resolveMainRef(execGit);
    const open = JSON.parse(execGh(['issue', 'list', '--repo', opts.repo, '--state', 'open', '--label', DONE_LABEL, '--limit', '1000', '--json', 'number']));
    rows = open.map(({ number }) => {
      const bundle = fetchIssueBundle({ execGh, execGit, repo: opts.repo, number, mainRef });
      const door = evaluateDoor({ ...bundle, registry, patchNotesText });
      const close = decideClose({ issue: bundle.issue, door, brandList, reopened: reopenedAt(bundle.timeline), lastMarker: lastMarkerAt(bundle.comments) });
      const missing = missingKrav(door);
      // Blokering vises kun naar intet krav mangler: ellers er det kravene der er handlingen.
      const blocker = !missing.length && !close.close ? close.reason : null;
      return { number, title: bundle.issue.title, doneAt: labeledAt(bundle.timeline, DONE_LABEL), missing, blocker };
    });
  } catch (err) {
    errorLog(`til-doers-monday: GitHub-kald fejlede: ${String(err.message || err).split('\n')[0]}`);
    return 2;
  }

  const stale = selectStale(rows, { now, days: opts.days });
  const report = renderReport(stale, { now, days: opts.days });
  log(report);
  if (opts.apply) {
    execGh(['api', '-X', 'POST', `repos/${opts.repo}/issues/${opts.postTo}/comments`, '--input', '-'], JSON.stringify({ body: report }));
    log(`\nPostet på #${opts.postTo}.`);
  } else {
    log('\n(dry-run: intet postet)');
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
