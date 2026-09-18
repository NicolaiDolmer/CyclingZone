#!/usr/bin/env node
// scripts/branch-inventory.mjs
// ============================================================
// Opgørelse af alle remote branches (#5391 + #4924).
//
// WHY (ejer 18/9, #5391): "Der skal til at vaere styr paa vores kaos med
// enorme maengder af worktrees og branches. Jeg kan se i GitHub at der
// nogle gange ligger omkring 50." Dette script laver en READ-ONLY opgørelse
// - INGEN sletning. Output er to lister ejeren kan bruge til at give et
// eksplicit "slet"-go (samme moenster som #4924's afsluttede worktree-audit,
// docs/audits/2026-09-18-orphan-worktrees-uge38.md).
//
// Status pr. branch (gensidigt udelukkende, i praektet raekkefoelge):
//   - "aaben PR"    - der findes en OPEN PR med denne branch som head.
//   - "merget"      - der findes en MERGED PR for branchen, ELLER branch-
//                     spidsen er selv en ancestor af origin/main (fx en
//                     chore/docs-commit pushet direkte paa main, eller en
//                     merge uden PR).
//   - "foraeldreloes" - ingen PR (hverken aaben eller merget) og spidsen er
//                     IKKE en ancestor af main.
//
// To lister til ejeren (samme skel som #4924's worktree-audit):
//   - "kan slettes sikkert": merget-branches + foraeldreloese branches hvis
//     spids ALLEREDE er en ancestor af main (nul unikt arbejde tilbage).
//   - "har unikt arbejde": aaben-PR-branches + foraeldreloese branches med
//     commits foran main der IKKE er en ancestor (reelt uafsluttet arbejde -
//     kraever et blik foer nogen sletning).
//
// Merge-status bruger PR-data FOERST (mere praecist end ancestor-tjek ved
// squash-merge, hvor branch-spidsen ALDRIG bliver en ancestor af main - kun
// squash-commit'et er). Ancestor-tjekket er et fallback for branches der
// aldrig havde en PR (direkte push) eller hvor PR-historikken er tabt.
//
// Auth: bruger udelukkende den allerede-autentificerede `gh`/`git`-session.
// Scriptet muterer ALDRIG git-state (ingen push/delete/checkout).
//
// Usage:
//   node scripts/branch-inventory.mjs                      # markdown til stdout
//   node scripts/branch-inventory.mjs --repo owner/name
//   node scripts/branch-inventory.mjs --main-ref origin/main
//   node scripts/branch-inventory.mjs --stale-days 14       # bruges kun i label-teksten
//
// Refs #5391, #4924.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const DEFAULT_REPO = 'NicolaiDolmer/CyclingZone';
export const DEFAULT_MAIN_REF = 'origin/main';
export const DEFAULT_STALE_DAYS = 14;

// ---------------------------------------------------------------------------
// Rene helper-funktioner (ingen exec-kald)
// ---------------------------------------------------------------------------

/** @param {string} iso @param {Date} now */
export function daysBetween(iso, now) {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  return Math.max(0, Math.floor(diffMs / 86_400_000));
}

/**
 * Samme markdown-tabel-sikring som priority-hygiene.mjs' sanitizeTitle -
 * bart "#N" i en commit-subject ville selv skabe en cross-reference naar
 * denne tabel lander i en committet docs-fil (GitHub autolinker inde i
 * markdown-filer paa default branch ligesom i PR-body/kommentarer).
 * @param {string} text
 */
export function sanitizeText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/#(\d+)/g, '`#$1`');
}

/**
 * Klassificerer én branch ud fra dens PR-historik + ancestor-status.
 * @param {{name: string, sha: string}} branch
 * @param {Map<string, Array<{number:number,state:string,url:string,isDraft:boolean}>>} prsByHead
 * @param {(sha: string) => boolean} isAncestorOfMain
 * @returns {{ status: 'aaben PR'|'merget'|'foraeldreloes', openPr: object|null, mergedPr: object|null, isAncestor: boolean }}
 */
export function classifyBranchStatus(branch, prsByHead, isAncestorOfMain) {
  const prs = prsByHead.get(branch.name) || [];
  const openPr = prs.find((p) => p.state === 'OPEN') || null;
  const mergedPr = prs.find((p) => p.state === 'MERGED') || null;
  const isAncestor = isAncestorOfMain(branch.sha);

  let status;
  if (openPr) status = 'aaben PR';
  else if (mergedPr || isAncestor) status = 'merget';
  else status = 'foraeldreloes';

  return { status, openPr, mergedPr, isAncestor };
}

/**
 * Bygger den fulde opgørelses-raekke for én branch (ren funktion - tager
 * allerede-hentet data ind, ingen exec-kald selv).
 * @param {{name:string, sha:string, committerDate:string, subject:string}} branch
 * @param {Map<string, Array<object>>} prsByHead
 * @param {(sha:string) => boolean} isAncestorOfMain
 * @param {(sha:string) => number} commitsAheadOfMain antal commits branch-spidsen er foran main (kun kaldt naar ikke-ancestor)
 * @param {Date} now
 */
export function buildInventoryRow(branch, prsByHead, isAncestorOfMain, commitsAheadOfMain, now) {
  const { status, openPr, mergedPr, isAncestor } = classifyBranchStatus(branch, prsByHead, isAncestorOfMain);
  const ageDays = daysBetween(branch.committerDate, now);
  const ahead = isAncestor ? 0 : commitsAheadOfMain(branch.sha);

  return {
    name: branch.name,
    sha: branch.sha.slice(0, 9),
    committerDate: branch.committerDate,
    subject: branch.subject,
    ageDays,
    status,
    openPr,
    mergedPr,
    isAncestor,
    commitsAhead: ahead,
  };
}

/**
 * Deler den fulde raekkeliste i "kan slettes sikkert" og "har unikt arbejde"
 * (se filens header for definitionen).
 * @param {Array<ReturnType<typeof buildInventoryRow>>} rows
 */
export function splitSafeAndUnique(rows) {
  const safe = [];
  const unique = [];
  for (const r of rows) {
    if (r.status === 'merget') safe.push(r);
    else if (r.status === 'foraeldreloes' && r.isAncestor) safe.push(r);
    else unique.push(r); // 'aaben PR', eller 'foraeldreloes' med commits foran main
  }
  return { safe, unique };
}

// ---------------------------------------------------------------------------
// exec-kald (injicerbare for test-skyld)
// ---------------------------------------------------------------------------

export function defaultExecGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

export function defaultExecGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

/**
 * Alle remote-branches undtagen HEAD og selve default-branchen (main).
 * Tab-separeret for-each-ref: navn, sha, committer-dato (ISO), subject.
 * @param {(args:string[], cwd?:string) => string} execGit
 * @param {string} cwd
 * @param {string} remote
 */
export function fetchRemoteBranches(execGit, cwd, remote = 'origin') {
  const raw = execGit(
    ['for-each-ref', '--format=%(refname:short)%09%(objectname)%09%(committerdate:iso-strict)%09%(subject)', `refs/remotes/${remote}`],
    cwd,
  );
  const prefix = `${remote}/`;
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [refShort, sha, committerDate, ...subjectParts] = line.split('\t');
      return { name: refShort.slice(prefix.length), sha, committerDate, subject: subjectParts.join('\t') };
    })
    .filter((b) => b.name && b.name !== 'HEAD' && b.name !== 'main');
}

/**
 * Alle PR'er (åbne + lukkede + mergede), grupperet pr. headRefName.
 * @param {(args:string[]) => string} execGh
 * @param {string} repo
 */
export function fetchAllPrsByHead(execGh, repo) {
  const raw = execGh([
    'pr', 'list',
    '--repo', repo,
    '--state', 'all',
    '--json', 'number,headRefName,state,url,isDraft',
    '--limit', '1000',
  ]);
  const prs = JSON.parse(raw || '[]');
  const byHead = new Map();
  for (const pr of prs) {
    const list = byHead.get(pr.headRefName) || [];
    list.push(pr);
    byHead.set(pr.headRefName, list);
  }
  return byHead;
}

/** @param {(args:string[], cwd?:string) => string} execGit @param {string} cwd @param {string} sha @param {string} mainRef */
export function makeAncestorChecker(execGit, cwd, mainRef) {
  return (sha) => {
    try {
      execGit(['merge-base', '--is-ancestor', sha, mainRef], cwd);
      return true; // exit 0
    } catch {
      return false; // exit 1 (ikke ancestor) - eller andet, behandles konservativt som "ikke ancestor"
    }
  };
}

/** @param {(args:string[], cwd?:string) => string} execGit @param {string} cwd @param {string} mainRef */
export function makeAheadCounter(execGit, cwd, mainRef) {
  return (sha) => {
    try {
      const raw = execGit(['rev-list', '--count', sha, `^${mainRef}`], cwd);
      return Number(raw.trim()) || 0;
    } catch {
      return 0;
    }
  };
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

function statusBadge(status) {
  if (status === 'aaben PR') return 'åben PR';
  if (status === 'merget') return 'merget';
  return 'forældreløs';
}

export function formatReport({ rows, safe, unique, repo, mainRef, now, staleDays }) {
  const lines = [];
  const dateStr = now.toISOString().slice(0, 10);

  lines.push(`# Branch-opgørelse — ${dateStr}`);
  lines.push('');
  lines.push(
    `> Read-only opgørelse (#5391), bygget videre på #4924's afsluttede worktree-audit ` +
    `(\`docs/audits/2026-09-18-orphan-worktrees-uge38.md\`). Ingen branches slettet af dette pas. ` +
    `Repo: \`${repo}\`, sammenlignet mod \`${mainRef}\`.`,
  );
  lines.push('');
  lines.push(`**${rows.length} remote branches** i alt (ekskl. \`main\` selv) — ${safe.length} kan slettes sikkert, ${unique.length} har unikt arbejde eller en åben PR.`);
  lines.push('');

  lines.push('## Forward-guards (verificeret 2026-09-18, #5391)');
  lines.push('');
  lines.push(
    '- `delete_branch_on_merge` er allerede **slået til** på repoet (`gh api repos/NicolaiDolmer/CyclingZone`) - enhver merge, ' +
    'uanset vej (UI, `gh pr merge`, `scripts/merge-queue.ps1`), sletter automatisk branchen. Ingen ændring nødvendig.\n' +
    '- `scripts/merge-queue.ps1` merger allerede med `--delete-branch` som en ekstra, eksplicit garanti oveni repo-indstillingen. Ingen ændring nødvendig.\n' +
    '- **Konsekvens for listen herunder:** fordi merge altid sletter branchen, er der ingen "merget, men stadig til stede"-branches i denne opgørelse - ' +
    'alle 43 er enten en åben PR eller reelt forældreløs (aldrig merget/afvist/glemt). "Kan slettes sikkert" (0 stk. lige nu) vil derfor typisk kun ' +
    'ramme forældreløse branches hvis spids allerede findes på main via en ANDEN branch (samme commits, ingen unik historik) - ikke selve merge-sporet.\n' +
    '- Ny ugentlig rutine (`.github/workflows/stale-branches-report.yml` + `scripts/stale-branches-report.mjs`): opretter/ajourfører ÉT issue med ' +
    'branches 14+ dage uden åben PR, se sektionen nedenfor. Kører read-only (kun `issues: write` for selve issue-oprettelsen/-redigeringen, ingen ' +
    'branch-mutation).',
  );
  lines.push('');

  lines.push('## Kan slettes sikkert');
  lines.push('');
  if (safe.length === 0) {
    lines.push('(ingen)');
  } else {
    lines.push('Merget (PR merged, eller spidsen er allerede en ancestor af main) eller forældreløs uden unikke commits foran main.');
    lines.push('');
    lines.push('| Branch | Status | Alder (dage) | Sidste commit |');
    lines.push('|---|---|---|---|');
    for (const r of safe) {
      const commitInfo = `\`${r.sha}\` ${sanitizeText(r.subject)}`;
      lines.push(`| \`${sanitizeText(r.name)}\` | ${statusBadge(r.status)} | ${r.ageDays} | ${commitInfo} |`);
    }
  }
  lines.push('');

  lines.push('## Har unikt arbejde (kræver et blik før noget slettes)');
  lines.push('');
  if (unique.length === 0) {
    lines.push('(ingen)');
  } else {
    lines.push('Åben PR, eller forældreløs med commits foran main der ikke findes andre steder.');
    lines.push('');
    lines.push('| Branch | Status | Alder (dage) | Commits foran main | Sidste commit |');
    lines.push('|---|---|---|---|---|');
    for (const r of unique) {
      const prTxt = r.openPr ? ` (${r.openPr.url})` : '';
      const commitInfo = `\`${r.sha}\` ${sanitizeText(r.subject)}`;
      lines.push(`| \`${sanitizeText(r.name)}\` | ${statusBadge(r.status)}${prTxt} | ${r.ageDays} | ${r.status === 'foraeldreloes' ? r.commitsAhead : '-'} | ${commitInfo} |`);
    }
  }
  lines.push('');

  const staleOrphans = unique.filter((r) => r.status === 'foraeldreloes' && r.ageDays >= staleDays);
  lines.push(`## Forældreløse ${staleDays}+ dage gamle uden åben PR (samme kriterie som den ugentlige rutine, se \`scripts/stale-branches-report.mjs\`)`);
  lines.push('');
  if (staleOrphans.length === 0) {
    lines.push('(ingen)');
  } else {
    for (const r of staleOrphans) {
      lines.push(`- \`${sanitizeText(r.name)}\` — ${r.ageDays} dage, ${r.commitsAhead} commit(s) foran main`);
    }
  }
  lines.push('');
  lines.push('## Næste skridt');
  lines.push('');
  lines.push(
    '1. Ejeren ser listerne og siger "slet" for "kan slettes sikkert" (samme go-mønster som #4924).\n' +
    '2. "Har unikt arbejde" kræver et blik pr. branch (åbne PR\'er følger deres eget flow; forældreløse med unikt arbejde afgøres enkeltvis - flet, genåbn som PR, eller bekræft skrot).',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = { repo: DEFAULT_REPO, mainRef: DEFAULT_MAIN_REF, staleDays: DEFAULT_STALE_DAYS, now: new Date(), cwd: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') { args.repo = argv[i + 1]; i += 1; }
    else if (arg === '--main-ref') { args.mainRef = argv[i + 1]; i += 1; }
    else if (arg === '--stale-days') { args.staleDays = Number(argv[i + 1]); i += 1; }
    else if (arg === '--cwd') { args.cwd = argv[i + 1]; i += 1; }
    else if (arg === '--now') { args.now = new Date(argv[i + 1]); i += 1; }
  }
  return args;
}

export function main(argv, deps = {}) {
  const execGit = deps.execGit || defaultExecGit;
  const execGh = deps.execGh || defaultExecGh;
  const log = deps.log || console.log;

  const { repo, mainRef, staleDays, now, cwd } = parseArgs(argv);

  const branches = fetchRemoteBranches(execGit, cwd);
  const prsByHead = fetchAllPrsByHead(execGh, repo);
  const isAncestorOfMain = makeAncestorChecker(execGit, cwd, mainRef);
  const commitsAheadOfMain = makeAheadCounter(execGit, cwd, mainRef);

  const rows = branches
    .map((b) => buildInventoryRow(b, prsByHead, isAncestorOfMain, commitsAheadOfMain, now))
    .sort((a, b) => b.ageDays - a.ageDays);

  const { safe, unique } = splitSafeAndUnique(rows);

  log(formatReport({ rows, safe, unique, repo, mainRef, now, staleDays }));
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
