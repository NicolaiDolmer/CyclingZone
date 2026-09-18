#!/usr/bin/env node
// scripts/check-triage-age.mjs
// ============================================================
// Guard: `triage:new` aeldre end 7 dage flagges (#5329).
//
// WHY (styringssession 17/9, docs/WEEKLY_STEERING.md "Intake-gate"): siden
// 17/9 opretter alle cloud-rutiner og sweeps fund som `triage:new`, ikke
// `claude:todo` - et issue er foerst "i koeen" naar mandagens styringssession
// (blok 3) har placeret det i en bane + `claude:todo`, eller sendt til
// `icebox` med ejer-go. Uden en alders-guard kan et fund staa uendeligt i
// limbo mellem "fundet" og "besluttet". Denne guard flagger overskridelser -
// den AENDRER ALDRIG et issue selv (read-only: kun `gh issue list`, ingen
// mutationer af issues/PR'er).
//
// Bruges TO steder (docs/superpowers/specs/2026-09-17-weekly-steering-
// session-design.md "Forward-guard" + #5328 punkt 3 + #5329 punkt 2):
//   1. Selvstaendig, advisory CI-koersel mandag morgen
//      (.github/workflows/triage-age-guard.yml).
//   2. Et afsnit i soendagens styringsrapport (scripts/weekly-steering-report.mjs).
// Begge bruger samme rene klassificering fra scripts/lib/triage-age.mjs, saa
// graense og sortering aldrig kan komme ud af trit.
//
// Auth: bruger udelukkende den allerede-autentificerede `gh` CLI-session
// (samme som priority-hygiene.mjs). Scriptet laeser eller printer aldrig et token.
//
// Usage:
//   node scripts/check-triage-age.mjs
//   node scripts/check-triage-age.mjs --days 10
//   node scripts/check-triage-age.mjs --repo owner/name
//   node scripts/check-triage-age.mjs --label triage:new
//   node scripts/check-triage-age.mjs --now 2026-09-25   (test-hook)
//
// Exit codes:
//   0 - ingen `triage:new`-issue aeldre end graensen
//   1 - mindst ét fund (advisory - blokerer intet, kun synligt i CI-status)
//   2 - ugyldige argumenter eller `gh`-kaldet selv fejlede
//
// Refs #5329 #5328.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  DEFAULT_TRIAGE_AGE_DAYS,
  DEFAULT_TRIAGE_LABEL,
  classifyTriageAge,
  formatTriageAgeSection,
} from './lib/triage-age.mjs';

export const DEFAULT_REPO = 'NicolaiDolmer/CyclingZone';

/** Default gh-eksekvering. Kastes videre til kalderen ved fejl. */
export function defaultExecGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

/**
 * Henter alle aabne issues med den givne label (default `triage:new`).
 * @param {(args: string[]) => string} execGh
 * @param {string} repo
 * @param {string} label
 */
export function fetchOpenTriageIssues(execGh, repo, label = DEFAULT_TRIAGE_LABEL) {
  const raw = execGh([
    'issue', 'list',
    '--repo', repo,
    '--state', 'open',
    '--label', label,
    '--json', 'number,title,createdAt,url',
    '--limit', '500',
  ]);
  return JSON.parse(raw || '[]');
}

export function parseArgs(argv) {
  const args = {
    days: DEFAULT_TRIAGE_AGE_DAYS,
    repo: DEFAULT_REPO,
    label: DEFAULT_TRIAGE_LABEL,
    now: new Date(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--days') {
      const val = Number(argv[i + 1]);
      if (!Number.isFinite(val) || val <= 0) {
        throw new Error(`--days: ugyldig vaerdi "${argv[i + 1]}"`);
      }
      args.days = val;
      i += 1;
    } else if (arg === '--repo') {
      const val = argv[i + 1];
      if (!val || val.startsWith('--')) {
        throw new Error(`--repo: mangler vaerdi (forventet "ejer/repo", fik "${val ?? ''}")`);
      }
      args.repo = val;
      i += 1;
    } else if (arg === '--label') {
      const val = argv[i + 1];
      if (!val || val.startsWith('--')) {
        throw new Error(`--label: mangler vaerdi (fik "${val ?? ''}")`);
      }
      args.label = val;
      i += 1;
    } else if (arg === '--now') {
      // test-hook, samme idiom som priority-hygiene.mjs
      const parsed = new Date(argv[i + 1]);
      if (Number.isNaN(parsed.getTime())) throw new Error(`--now: ugyldig dato "${argv[i + 1]}"`);
      args.now = parsed;
      i += 1;
    }
  }

  return args;
}

export function main(argv, deps = {}) {
  const execGh = deps.execGh || defaultExecGh;
  const log = deps.log || console.log;
  const errorLog = deps.errorLog || console.error;

  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    errorLog(err.message);
    return 2;
  }

  const { days, repo, label, now } = opts;

  let issues;
  try {
    issues = fetchOpenTriageIssues(execGh, repo, label);
  } catch (err) {
    errorLog(`gh issue list fejlede: ${err.message}`);
    return 2;
  }

  const { overdue, withinLimit } = classifyTriageAge(issues, days, now);
  const dateStr = now.toISOString().slice(0, 10);

  log(`# Triage-alders-guard — ${dateStr} (graense ${days} dage, label \`${label}\`)`);
  log('');
  log(formatTriageAgeSection({ overdue, withinLimit, days }));

  return overdue.length > 0 ? 1 : 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
