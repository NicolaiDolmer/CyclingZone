#!/usr/bin/env node
// scripts/til-doers-overdue.mjs
// ============================================================
// Forsinket auto-bevis (#7585, PR 4): merge'de PR'er, der har erklaeret et
// til-doers-proof for et aabent issue, men hvor ingen auto-bevis-kommentar er
// lagt inden for 24 timer. Den rene beslutning bor i findProofOverdue
// (scripts/lib/til-doers-proof.mjs); dette script henter data og skriver.
//
// To ting holdes adskilt for at undgaa falske alarmer:
//   - "ikke koert": deklaration findes, ingen auto-bevis-kommentar. Det er alarmen.
//   - "ingen deklaration": PR'en erklaerede intet. Kun en optaelling, aldrig en alarm.
//
// --apply skriver hoejst een kommentar paa #7632 (egen markoer pr. PR+issue, saa
// et par kun rapporteres een gang). Kommentaren staar aldrig i markeringsformatet
// for til-doers-systemet og kan hverken markere eller lukke noget.
//
// Exit er ALTID 0: scriptet er et signal, aldrig en gate (merge-koeen kalder det
// loesrevet som dry-run). Fejl logges.
//
// Usage:
//   node scripts/til-doers-overdue.mjs                  (dry-run)
//   node scripts/til-doers-overdue.mjs --apply
//   node scripts/til-doers-overdue.mjs --hours 24 --lookback-hours 168 --now 2026-11-06T08:00:00Z
//   --repo owner/name  --post-to 7632

import { fileURLToPath } from 'node:url';
import {
  BOT_LOGIN,
  COLLABORATOR_ASSOCIATIONS,
  DEFAULT_REPO,
  MARKER,
  MARKER_LINE,
  defaultExecGh,
  ghJson,
  ghPaged,
} from './lib/til-doers.mjs';
import { OVERDUE_HOURS, declarationFor, findProofOverdue, proofDeclarationsForPr, proofRefIssues } from './lib/til-doers-proof.mjs';

export const REPORT_ISSUE = 7632;
export const DEFAULT_LOOKBACK_HOURS = 168;
export const OVERDUE_MARKER_PREFIX = '<!-- til-doers-overdue:v1';
const OVERDUE_MARKER_RE = /<!-- til-doers-overdue:v1 pr=(\d+) issue=(\d+) -->/g;
const HOUR_MS = 60 * 60 * 1000;

export function parseArgs(argv) {
  const opts = {
    apply: false,
    hours: OVERDUE_HOURS,
    lookbackHours: DEFAULT_LOOKBACK_HOURS,
    now: null,
    repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO,
    postTo: REPORT_ISSUE,
  };
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
    else if (a === '--hours') {
      opts.hours = Number(next());
      if (!Number.isFinite(opts.hours) || opts.hours < 0) throw new Error('--hours skal være et ikke-negativt tal');
    } else if (a === '--lookback-hours') {
      opts.lookbackHours = Number(next());
      if (!Number.isFinite(opts.lookbackHours) || opts.lookbackHours <= 0) throw new Error('--lookback-hours skal være et positivt tal');
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

/** Par (pr:issue) der allerede er rapporteret i betroede kommentarer paa rapport-issuet. */
export function reportedPairs(comments) {
  const seen = new Set();
  for (const c of comments || []) {
    const trusted = c.user?.login === BOT_LOGIN || COLLABORATOR_ASSOCIATIONS.has(String(c.author_association || '').toUpperCase());
    if (!trusted) continue;
    for (const m of String(c.body || '').matchAll(OVERDUE_MARKER_RE)) seen.add(`${m[1]}:${m[2]}`);
  }
  return seen;
}

/** Overdue-raekker, der ikke allerede er rapporteret. */
export function unreported(overdue, comments) {
  const seen = reportedPairs(comments);
  return overdue.filter((r) => !seen.has(`${r.pr}:${r.issue}`));
}

/**
 * Kommentaren. Ingen "Til dørs:"-linjer og ingen tabel-markoer: den kan aldrig
 * taelle som markering. Kun de skjulte markoerer pr. (PR, issue).
 */
export function renderOverdueComment(rows, { hours = OVERDUE_HOURS } = {}) {
  const lines = rows.map((r) => `- PR #${r.pr} for #${r.issue}: merget for ${r.ageHours} timer siden, ingen auto-bevis-kommentar endnu.`);
  const body = [
    '## Auto-bevis forsinket',
    '',
    `${rows.length} merge'de PR'er erklærede et bevis, men intet bevis er lagt efter ${hours} timer. Dette er en påmindelse, ikke en markering.`,
    '',
    ...lines,
    '',
    ...rows.map((r) => `${OVERDUE_MARKER_PREFIX} pr=${r.pr} issue=${r.issue} -->`),
  ].join('\n');
  if (body.includes(MARKER)) throw new Error('forsinket-kommentaren må ikke indeholde til-doers-tabellens markør');
  if (body.split('\n').some((l) => MARKER_LINE.test(l))) throw new Error('forsinket-kommentaren må ikke have markeringslinjer');
  return body;
}

export function renderSummary({ overdue, noDeclaration, proven }, { hours = OVERDUE_HOURS } = {}) {
  const out = [`Auto-bevis efter ${hours} timer: ${overdue.length} ikke kørt, ${proven.length} med bevis, ${noDeclaration.length} uden deklaration (ingen alarm).`];
  for (const r of overdue) out.push(`  ikke kørt: PR #${r.pr} -> #${r.issue} (${r.ageHours} t)${r.declarationErrors ? `, deklarationen har ${r.declarationErrors} fejl` : ''}`);
  return out.join('\n');
}

export function main(argv = process.argv.slice(2), deps = {}) {
  const execGh = deps.execGh || defaultExecGh;
  const log = deps.log || ((s) => process.stdout.write(`${s}\n`));
  const errorLog = deps.errorLog || ((s) => process.stderr.write(`${s}\n`));

  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    errorLog(`til-doers-overdue: ${err.message}`);
    return 0;
  }
  const now = opts.now || deps.now || new Date();

  try {
    const cutoff = now.getTime() - opts.lookbackHours * HOUR_MS;
    const merged = JSON.parse(
      execGh(['pr', 'list', '--repo', opts.repo, '--state', 'merged', '--base', 'main', '--search', `merged:>=${new Date(cutoff).toISOString()}`, '--limit', '1000', '--json', 'number,title,body,mergedAt,baseRefName']),
    ).filter((p) => p.mergedAt && new Date(p.mergedAt).getTime() >= cutoff);

    // Kun issues med en deklaration kraever kommentarer; resten tælles blot.
    const issueNumbers = new Set();
    const declared = new Set();
    for (const pr of merged) {
      const parsed = proofDeclarationsForPr(pr);
      for (const n of proofRefIssues(pr)) {
        issueNumbers.add(n);
        if (declarationFor(parsed, n)) declared.add(n);
      }
    }
    const issues = [];
    const comments = {};
    for (const n of issueNumbers) {
      // Et slettet eller flyttet issue maa ikke tage de andre paamindelser med sig.
      try {
        const issue = ghJson(execGh, [`repos/${opts.repo}/issues/${n}`]);
        // Foerst naar kommentarerne er hentet: en mislykket hentning maa ikke ligne 'intet bevis'.
        const issueComments = issue.state === 'open' && declared.has(n) ? ghPaged(execGh, `repos/${opts.repo}/issues/${n}/comments?per_page=100`) : null;
        if (issueComments) comments[n] = issueComments;
        issues.push({ number: n, state: issue.state });
      } catch (err) {
        errorLog(`til-doers-overdue: springer #${n} over: ${String(err.message || err).split('\n')[0]}`);
      }
    }

    const result = findProofOverdue({ prs: merged, issues, comments, now, hours: opts.hours });
    log(renderSummary(result, { hours: opts.hours }));

    const reportComments = result.overdue.length ? ghPaged(execGh, `repos/${opts.repo}/issues/${opts.postTo}/comments?per_page=100`) : [];
    const fresh = unreported(result.overdue, reportComments);
    if (!fresh.length) {
      log(result.overdue.length ? '\nAlt forsinket er allerede rapporteret.' : '\nIntet forsinket.');
      return 0;
    }
    const body = renderOverdueComment(fresh, { hours: opts.hours });
    if (opts.apply) {
      execGh(['api', '-X', 'POST', `repos/${opts.repo}/issues/${opts.postTo}/comments`, '--input', '-'], JSON.stringify({ body }));
      log(`\nPostet på #${opts.postTo} (${fresh.length} nye).`);
    } else {
      log(`\n${body}\n\n(dry-run: intet postet)`);
    }
  } catch (err) {
    errorLog(`til-doers-overdue: fejlede, intet postet: ${String(err.message || err).split('\n')[0]}`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
