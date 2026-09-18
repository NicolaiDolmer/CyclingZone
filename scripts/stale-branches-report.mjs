#!/usr/bin/env node
// scripts/stale-branches-report.mjs
// ============================================================
// Ugentlig forward-guard mod branch-kaos (#5391).
//
// WHY (ejer 18/9, #5391, pkt. 2 "Forward-guard"): opgørelsen i
// docs/audits/2026-09-18-branch-opgoerelse.md er et engangs-snapshot - uden
// en tilbagevendende rutine vokser bunken bare igen. Dette script kører
// ugentligt (.github/workflows/stale-branches-report.yml) og
// opretter/ajourfører ÉT stabilt GitHub-issue med branches der er 14+ dage
// gamle UDEN en åben PR - samme kriterie som "forældreløs" i
// scripts/branch-inventory.mjs (og de to scripts genbruger derfor samme
// klassificerings-funktioner derfra, ingen dupliceret logik).
//
// Find-eller-opret ÉT issue: samme mønster som
// .github/workflows/perf-seo-review.yml ("gh issue list --label X --state
// open --json number", derefter `issue edit` hvis fundet, ellers `issue
// create`) - ikke en ny kommentar/nyt issue hver uge.
//
// INGEN sletning, HVERKEN branches eller issues - scriptet rapporterer kun.
// Selve sletningen er ejer-gated (#5391's scope), og dette script rører
// aldrig `git`-state overhovedet, kun GitHub-issues via `gh`.
//
// Usage:
//   node scripts/stale-branches-report.mjs                 # kører for reelt (opretter/opdaterer issuet)
//   node scripts/stale-branches-report.mjs --dry-run        # printer kun issue-body, rører intet issue
//   node scripts/stale-branches-report.mjs --days 21
//   node scripts/stale-branches-report.mjs --repo owner/name
//
// Refs #5391, #4924.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  DEFAULT_REPO,
  DEFAULT_MAIN_REF,
  DEFAULT_STALE_DAYS,
  daysBetween,
  sanitizeText,
  classifyBranchStatus,
  fetchRemoteBranches,
  fetchAllPrsByHead,
  makeAncestorChecker,
  makeAheadCounter,
  defaultExecGit,
  defaultExecGh,
} from './branch-inventory.mjs';

export const MARKER_LABEL = 'stale-branches-report';
export const LABEL_COLOR = 'D93F0B';
export const LABEL_DESC = 'Automatisk ugentlig liste over forældreløse branches 14+ dage uden åben PR (#5391) - bot-marker, rør ikke';
export const ISSUE_TITLE = '[bot] Forældreløse branches (ugentlig, automatisk)';

export { DEFAULT_REPO, DEFAULT_MAIN_REF, DEFAULT_STALE_DAYS };

// ---------------------------------------------------------------------------
// Rene funktioner (ingen exec-kald)
// ---------------------------------------------------------------------------

/**
 * Filtrerer + klassificerer branches til dem der er "forældreløs" og mindst
 * `days` dage gamle (samme status-logik som branch-inventory.mjs).
 * @param {Array<{name:string,sha:string,committerDate:string,subject:string}>} branches
 * @param {Map<string, Array<object>>} prsByHead
 * @param {(sha:string) => boolean} isAncestorOfMain
 * @param {(sha:string) => number} commitsAheadOfMain
 * @param {Date} now
 * @param {number} days
 */
export function computeStaleBranches(branches, prsByHead, isAncestorOfMain, commitsAheadOfMain, now, days) {
  const rows = [];
  for (const b of branches) {
    const { status, isAncestor } = classifyBranchStatus(b, prsByHead, isAncestorOfMain);
    if (status !== 'foraeldreloes') continue;
    const ageDays = daysBetween(b.committerDate, now);
    if (ageDays < days) continue;
    rows.push({
      name: b.name,
      sha: b.sha.slice(0, 9),
      subject: b.subject,
      ageDays,
      commitsAhead: isAncestor ? 0 : commitsAheadOfMain(b.sha),
    });
  }
  rows.sort((a, b) => b.ageDays - a.ageDays);
  return rows;
}

/**
 * Bygger issue-body'en (markdown). Overskrives hver kørsel - ajourfører,
 * append'er ikke.
 * @param {Array<object>} staleBranches
 * @param {Date} now
 * @param {number} days
 * @param {string} repo
 */
export function buildIssueBody(staleBranches, now, days, repo) {
  const lines = [];
  const dateStr = now.toISOString().slice(0, 10);
  lines.push(`Automatisk kørt ${dateStr} af \`.github/workflows/stale-branches-report.yml\` (#5391, ugentlig, dette issue ajourføres - ikke en ny kommentar).`);
  lines.push('');
  lines.push(`Ingen branches slettes af denne rutine. Fuld opgørelse (alle branches, ikke kun forældreløse): \`docs/audits/2026-09-18-branch-opgoerelse.md\` (opdatér manuelt hvis listen skal genkøres i sin helhed).`);
  lines.push('');

  if (staleBranches.length === 0) {
    lines.push(`✅ Ingen forældreløse branches ${days}+ dage gamle uden åben PR lige nu.`);
  } else {
    lines.push(`## ${staleBranches.length} branch(es) ${days}+ dage gammel(e) uden åben PR i \`${repo}\``);
    lines.push('');
    lines.push('| Branch | Alder (dage) | Commits foran main | Sidste commit |');
    lines.push('|---|---|---|---|');
    for (const r of staleBranches) {
      lines.push(`| \`${sanitizeText(r.name)}\` | ${r.ageDays} | ${r.commitsAhead} | \`${r.sha}\` ${sanitizeText(r.subject)} |`);
    }
    lines.push('');
    lines.push('Ejeren afgør pr. branch (flet, genåbn som PR, eller bekræft skrot) - ingen automatisk sletning.');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// exec-kald (injicerbare for test-skyld)
// ---------------------------------------------------------------------------

/**
 * Idempotent label-oprettelse (`--force` opdaterer i stedet for at fejle på
 * "already exists" - samme mønster som perf-seo-review.yml).
 * @param {(args:string[]) => string} execGh
 */
export function ensureMarkerLabel(execGh) {
  execGh(['label', 'create', MARKER_LABEL, '-c', LABEL_COLOR, '-d', LABEL_DESC, '--force']);
}

/**
 * Finder nummeret på det ÅBNE issue der bærer marker-labelen, hvis det findes.
 * @param {(args:string[]) => string} execGh
 * @param {string} repo
 * @returns {number|null}
 */
export function findExistingIssueNumber(execGh, repo) {
  const raw = execGh(['issue', 'list', '--repo', repo, '--label', MARKER_LABEL, '--state', 'open', '--json', 'number', '--limit', '5']);
  const found = JSON.parse(raw || '[]');
  return found.length > 0 ? found[0].number : null;
}

/**
 * Opretter eller opdaterer det ene stabile issue.
 * @param {(args:string[]) => string} execGh
 * @param {string} repo
 * @param {string} body
 * @returns {{number: number, created: boolean}}
 */
export function upsertIssue(execGh, repo, body) {
  ensureMarkerLabel(execGh);
  const existing = findExistingIssueNumber(execGh, repo);
  if (existing) {
    execGh(['issue', 'edit', String(existing), '--repo', repo, '--title', ISSUE_TITLE, '--body', body]);
    return { number: existing, created: false };
  }
  const raw = execGh(['issue', 'create', '--repo', repo, '--title', ISSUE_TITLE, '--label', MARKER_LABEL, '--body', body]);
  const match = String(raw).match(/\/issues\/(\d+)/);
  return { number: match ? Number(match[1]) : null, created: true };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = { repo: DEFAULT_REPO, mainRef: DEFAULT_MAIN_REF, days: DEFAULT_STALE_DAYS, now: new Date(), cwd: process.cwd(), dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') { args.repo = argv[i + 1]; i += 1; }
    else if (arg === '--main-ref') { args.mainRef = argv[i + 1]; i += 1; }
    else if (arg === '--days') { args.days = Number(argv[i + 1]); i += 1; }
    else if (arg === '--cwd') { args.cwd = argv[i + 1]; i += 1; }
    else if (arg === '--now') { args.now = new Date(argv[i + 1]); i += 1; }
    else if (arg === '--dry-run') { args.dryRun = true; }
  }
  return args;
}

export function main(argv, deps = {}) {
  const execGit = deps.execGit || defaultExecGit;
  const execGh = deps.execGh || defaultExecGh;
  const log = deps.log || console.log;

  const { repo, mainRef, days, now, cwd, dryRun } = parseArgs(argv);

  const branches = fetchRemoteBranches(execGit, cwd);
  const prsByHead = fetchAllPrsByHead(execGh, repo);
  const isAncestorOfMain = makeAncestorChecker(execGit, cwd, mainRef);
  const commitsAheadOfMain = makeAheadCounter(execGit, cwd, mainRef);

  const staleBranches = computeStaleBranches(branches, prsByHead, isAncestorOfMain, commitsAheadOfMain, now, days);
  const body = buildIssueBody(staleBranches, now, days, repo);

  if (dryRun) {
    log(`[dry-run] ${staleBranches.length} forældreløs(e) branch(es) ${days}+ dage - ville oprette/opdatere issue "${ISSUE_TITLE}" (label ${MARKER_LABEL}):`);
    log('');
    log(body);
    return 0;
  }

  const { number, created } = upsertIssue(execGh, repo, body);
  log(`${created ? 'Oprettede' : 'Opdaterede'} issue #${number} med ${staleBranches.length} forældreløs(e) branch(es) ${days}+ dage.`);
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
