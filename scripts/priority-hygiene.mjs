#!/usr/bin/env node
// scripts/priority-hygiene.mjs
// ============================================================
// Priority-hygiejne-vagt (#5155).
//
// WHY (ejer-regel 11/9, #5155): en `priority:high`-issue kraever en synlig
// handling (en PR, en kommentar med naeste skridt, eller en eksplicit
// ejer-beslutning) inden 14 dage - ellers nedjusteres den til `priority:med`
// med en kommentar om hvorfor. Maalt 11/9: 53 af 175 `priority:high`-issues
// (30 %) havde ikke haft aktivitet i 14+ dage (docs/audits/2026-09-11-github-
// audit.md, afsnit 4). `priority:high` uden bevaegelse er ikke et signal,
// det er stoej der drukner det der faktisk braender.
//
// Epics (label `epic` eller `epic:*`) undtages fra selve nedjusteringen -
// men rapporteres saerskilt hvis de IKKE har et aabent child-issue med
// aktivitet, saa "hele epic-sporet er koldt" ikke gemmer sig bag labelen.
//
// "Sidste aktivitet" er IKKE bare issue.updatedAt: GitHub opdaterer den ved
// nye kommentarer og label-aendringer, men IKKE naar en linket PR faar nyt
// liv (nyt commit, ny kommentar, merge) uden selv at kommentere paa issuet.
// Derfor scanner scriptet issuets timeline (`gh api .../timeline`) for
// "cross-referenced"-events hvor kilden er en PR, og bruger PR'ens EGEN
// (live) `updated_at` som aktivitets-signal - det er "linked PR-aktivitet".
//
// GOTCHA (fundet under 11/9-verifikationen mod det rigtige repo, se PR #5175):
// GitHub auto-linker ETHVERT bart `#N` i en PR-body/kommentar/commit - også
// inde i en markdown-tabel der bare RAPPORTERER om issue N. Det opretter en
// ægte cross-referenced-event, og fordi PR'en er frisk, ser issue N pludselig
// "linked-pr"-aktivt ud - stille selvforurening af netop det signal scriptet
// måler. Derfor render formatReport() ALTID issue-numre i backticks
// (`` `#N` ``, aldrig bart `#N`) - GitHub autolinker ikke inde i code spans.
// Rør IKKE ved det uden at forstå hvorfor.
//
// Auth: bruger udelukkende den allerede-autentificerede `gh` CLI-session.
// Scriptet laeser eller printer ALDRIG et token.
//
// Usage:
//   node scripts/priority-hygiene.mjs                 # dry-run (DEFAULT)
//   node scripts/priority-hygiene.mjs --dry-run
//   node scripts/priority-hygiene.mjs --execute        # nedjuster + kommentér for reelt
//   node scripts/priority-hygiene.mjs --days 21        # aendr graensen (default 14)
//   node scripts/priority-hygiene.mjs --repo owner/name
//
// Exit codes:
//   0 - koert (dry-run rapport, eller execute gennemfoert uden fejl)
//   1 - en eller flere `gh`-kald fejlede under --execute
//
// Refs #5155.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const DEFAULT_DAYS = 14;
export const DEFAULT_REPO = 'NicolaiDolmer/CyclingZone';
const MAX_TIMELINE_PAGES = 10; // 1.000 events - langt over hvad en enkelt issue har

// ---------------------------------------------------------------------------
// Rene helper-funktioner (ingen gh-kald)
// ---------------------------------------------------------------------------

/**
 * Gør en issue-titel sikker at saette i en markdown-taebel-celle: undgaar at
 * en titel med et bart "#N" (fx "Post-merge #3798: ...") selv skaber en ny
 * cross-reference naar rapporten postes som PR-body/kommentar (samme klasse
 * som GOTCHA'en i filens header - fanget af CodeRabbit-reviewet, #5155).
 * Escaper ogsaa taebel-delimiters og linjeskift.
 *
 * REAEKKEFOELGE ER BINDENDE (CodeQL #361 "Incomplete string escaping", #5176):
 * backslash escapes FOERST. Ellers "escaper" et senere trin en backslash der i
 * virkeligheden hoerer til titlens EGEN tekst - en titel der allerede
 * indeholder "\|" (bogstaveligt backslash-pipe, ikke en escape) ville faa sin
 * pipe escapet OVENPAA den eksisterende backslash og lave en falsk "\\|" som
 * markdown-parseren laeser forkert. Ved at escape "\" til "\\" foerst bliver
 * ALLE senere indsatte "\" (fra pipe- og #N-escapes) entydigt tegn scriptet
 * selv har tilfoejet.
 * @param {string} title
 */
export function sanitizeTitle(title) {
  return String(title)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/#(\d+)/g, '`#$1`');
}

/**
 * @param {string[]} labelNames
 * @returns {boolean} true hvis issuet er en epic (label `epic` eller `epic:*`)
 */
export function isEpicLabels(labelNames) {
  return labelNames.some((name) => name === 'epic' || name.startsWith('epic:'));
}

/**
 * Heltalsantal HELE dage mellem `iso` og `now` (>= 0). Bruges konsekvent i
 * stedet for millisekund-differencer for at holde graenser (--days) forudsigelige.
 * @param {string} iso
 * @param {Date} now
 */
export function daysBetween(iso, now) {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  return Math.max(0, Math.floor(diffMs / 86_400_000));
}

/**
 * Finder det seneste aktivitets-tidspunkt for en issue: issuets egen
 * `updatedAt`, plus alt der findes i dens timeline (kommentarer,
 * label-aendringer, og "linked PR"-aktivitet via cross-reference-events).
 *
 * @param {{updatedAt: string}} issue
 * @param {Array<object>} timelineEvents rå GitHub timeline-events
 * @returns {{ lastActivity: string, reason: string }}
 */
export function computeLastActivity(issue, timelineEvents) {
  let last = new Date(issue.updatedAt);
  let reason = 'issue-updated';

  for (const ev of timelineEvents) {
    let ts = null;
    let r = null;

    if (ev.event === 'commented' && ev.created_at) {
      ts = ev.created_at;
      r = 'comment';
    } else if ((ev.event === 'labeled' || ev.event === 'unlabeled') && ev.created_at) {
      ts = ev.created_at;
      r = 'label-change';
    } else if (ev.event === 'cross-referenced' && ev.source?.issue?.pull_request) {
      // Brug PR'ens egen (live) updated_at, ikke tidspunktet for selve
      // cross-referencen - en PR der er blevet merget/pushet siden vises da.
      ts = ev.source.issue.updated_at || ev.created_at;
      r = 'linked-pr';
    }

    if (ts) {
      const d = new Date(ts);
      if (d.getTime() > last.getTime()) {
        last = d;
        reason = r;
      }
    }
  }

  return { lastActivity: last.toISOString(), reason };
}

/**
 * Standard-kommentartekst ved nedjustering (dansk, kort, henviser til reglen + #5155).
 * @param {number} daysInactive
 * @param {number} days graensen der blev brugt
 */
export function buildDowngradeComment(daysInactive, days) {
  return (
    `Nedjusteret til \`priority:med\`: ingen synlig aktivitet i ${daysInactive} dage ` +
    `(graense ${days}, ejer-regel 11/9 #5155 - \`priority:high\` kraever handling inden ${days} dage). ` +
    'Genopgradér manuelt hvis noget er i gang, eller kommentér med naeste skridt.'
  );
}

// ---------------------------------------------------------------------------
// gh-kald (alle gaar via en injicerbar `execGh(args) -> stdout` for test-skyld)
// ---------------------------------------------------------------------------

/** Default gh-eksekvering. Kastes videre til kalderen ved fejl. */
export function defaultExecGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

/**
 * Henter alle aabne `priority:high`-issues.
 * @param {(args: string[]) => string} execGh
 * @param {string} repo
 */
export function fetchOpenPriorityHighIssues(execGh, repo) {
  const raw = execGh([
    'issue', 'list',
    '--repo', repo,
    '--state', 'open',
    '--label', 'priority:high',
    '--json', 'number,title,labels,updatedAt,url',
    '--limit', '500',
  ]);
  return JSON.parse(raw || '[]');
}

/**
 * Henter en issues fulde timeline (paginerer manuelt - `gh api --paginate`
 * konkatenerer JSON-sider uden separator, hvilket ikke er sikkert at parse).
 * @param {(args: string[]) => string} execGh
 * @param {string} repo
 * @param {number} number
 */
export function fetchTimeline(execGh, repo, number) {
  const events = [];
  for (let page = 1; page <= MAX_TIMELINE_PAGES; page += 1) {
    const raw = execGh([
      'api', '--method', 'GET', `repos/${repo}/issues/${number}/timeline`,
      '-f', 'per_page=100',
      '-f', `page=${page}`,
    ]);
    const pageEvents = JSON.parse(raw || '[]');
    events.push(...pageEvents);
    if (pageEvents.length < 100) break;
  }
  return events;
}

/**
 * Finder om en epic har mindst ét AABENT child-issue med aktivitet inden
 * for graensen. Foerst native GitHub sub-issues (`.../sub_issues`); hvis den
 * er tom (repoet bruger den ikke konsekvent), falder den tilbage til en
 * tekst-soegning efter "#<epicNumber>"-omtaler i aabne issues. Begge spor er
 * best-effort - se docs/GITHUB_WORKFLOW.md for begraensninger.
 *
 * @param {(args: string[]) => string} execGh
 * @param {string} repo
 * @param {number} epicNumber
 * @param {number} days
 * @param {Date} now
 */
export function findActiveChildForEpic(execGh, repo, epicNumber, days, now) {
  let subIssues = [];
  try {
    const raw = execGh(['api', '--method', 'GET', `repos/${repo}/issues/${epicNumber}/sub_issues`, '-f', 'per_page=100']);
    subIssues = JSON.parse(raw || '[]');
  } catch {
    subIssues = [];
  }

  let source = 'sub_issues';
  let candidates = subIssues.filter((i) => i.state === 'open');

  if (candidates.length === 0) {
    source = 'text-search';
    try {
      const raw = execGh([
        'search', 'issues', `"#${epicNumber}"`,
        '--repo', repo,
        '--state', 'open',
        '--json', 'number,title,updatedAt',
      ]);
      candidates = JSON.parse(raw || '[]').filter((i) => i.number !== epicNumber);
    } catch {
      candidates = [];
    }
  }

  if (candidates.length === 0) {
    return { hasActiveChild: false, source, children: [] };
  }

  // `sub_issues` er raa REST (snake_case `updated_at`); `search issues --json`
  // er gh's egen GraphQL-baserede JSON (camelCase `updatedAt`) - normalisér
  // begge, ellers filtrerer REST-sporet ALTID alt aktivt fra (#5155-review).
  const active = candidates.filter((c) => {
    const updated = c.updated_at || c.updatedAt;
    return Boolean(updated) && daysBetween(updated, now) < days;
  });
  return { hasActiveChild: active.length > 0, source, children: candidates };
}

/**
 * Fejl fra applyDowngrade der bærer PRAECIS hvor langt vi kom - saa main()
 * aldrig blot antager fuld succes, og et delvist forsoeg forbliver
 * selvhelende (se rækkefoelge-kommentaren i applyDowngrade).
 */
export class DowngradeError extends Error {
  constructor(message, { commented, labelChanged }) {
    super(message);
    this.name = 'DowngradeError';
    this.commented = commented;
    this.labelChanged = labelChanged;
  }
}

/**
 * Nedjusterer label + kommentér (kun kaldt under --execute).
 *
 * Raekkefoelge er bevidst: KOMMENTAR FOERST, label-aendring BAGEFTER. Hvis
 * label-edittet skulle fejle efter en vellykket kommentar, forbliver issuet
 * `priority:high` og bliver fanget igen af NAESTE koersel (selvhelende, om
 * end med en dobbelt kommentar i sjaeldne tilfaelde). Omvendt raekkefoelge
 * ville risikere en STILLE nedjusteret issue uden forklaring, som aldrig
 * dukker op i en `priority:high`-soegning igen (CodeRabbit-review, #5155).
 */
export function applyDowngrade(execGh, repo, issueNumber, comment) {
  try {
    execGh(['issue', 'comment', String(issueNumber), '--repo', repo, '--body', comment]);
  } catch (err) {
    throw new DowngradeError(`kommentar fejlede, intet aendret: ${err.message}`, { commented: false, labelChanged: false });
  }
  try {
    execGh(['issue', 'edit', String(issueNumber), '--repo', repo, '--remove-label', 'priority:high', '--add-label', 'priority:med']);
  } catch (err) {
    throw new DowngradeError(
      `kommentar OK, men label-aendring fejlede - issuet er STADIG priority:high og fanges igen naeste koersel: ${err.message}`,
      { commented: true, labelChanged: false },
    );
  }
  return { commented: true, labelChanged: true };
}

// ---------------------------------------------------------------------------
// Klassificering
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {Array<object>} opts.issues rå gh issue list-output
 * @param {(args: string[]) => string} opts.execGh
 * @param {string} opts.repo
 * @param {number} opts.days
 * @param {Date} opts.now
 * @returns {{ candidates: object[], epicsFlagged: object[], epicsOk: object[], kept: object[], errors: object[] }}
 */
export function classifyIssues({ issues, execGh, repo, days, now }) {
  const candidates = [];
  const epicsFlagged = [];
  const epicsOk = [];
  const kept = [];
  const errors = [];

  for (const issue of issues) {
    const labelNames = (issue.labels || []).map((l) => l.name);

    if (isEpicLabels(labelNames)) {
      const { hasActiveChild, source, children } = findActiveChildForEpic(execGh, repo, issue.number, days, now);
      const entry = { number: issue.number, title: issue.title, url: issue.url, source, childCount: children.length };
      if (hasActiveChild) epicsOk.push(entry);
      else epicsFlagged.push(entry);
      continue;
    }

    // Isolér timeline-fejl PR. issue - én utilgaengelig/slettet issue maa ikke
    // vaelte hele koersel og efterlade ingen rapport (#5155-review). Vi
    // bruger IKKE issue.updatedAt som stille fallback her: uden timeline kan
    // vi ikke se "linked PR-aktivitet", saa issuet klassificeres slet ikke -
    // det rapporteres separat i stedet, saa det tjekkes manuelt.
    let timeline;
    try {
      timeline = fetchTimeline(execGh, repo, issue.number);
    } catch (err) {
      errors.push({ number: issue.number, title: issue.title, url: issue.url, message: err.message });
      continue;
    }

    const { lastActivity, reason } = computeLastActivity(issue, timeline);
    const daysInactive = daysBetween(lastActivity, now);

    const entry = {
      number: issue.number,
      title: issue.title,
      url: issue.url,
      lastActivity,
      reason,
      daysInactive,
    };

    if (daysInactive >= days) candidates.push(entry);
    else kept.push(entry);
  }

  return { candidates, epicsFlagged, epicsOk, kept, errors };
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

export function formatReport({ candidates, epicsFlagged, errors = [], outcomes, days, now, executed }) {
  const lines = [];
  const dateStr = now.toISOString().slice(0, 10);
  const mode = executed ? 'EXECUTE' : 'DRY-RUN (ingen aendringer)';

  lines.push(`# Priority-hygiejne — ${dateStr} (${mode}, graense ${days} dage)`);
  lines.push('');

  if (candidates.length === 0) {
    lines.push('Ingen `priority:high`-issues uden aktivitet i ' + days + '+ dage. ✅');
  } else {
    lines.push(`## ${candidates.length} kandidat(er) til nedjustering`);
    lines.push('');
    const resultHeader = executed ? 'Resultat' : 'Hvorfor';
    lines.push(`| # | Titel | Dage siden aktivitet | ${resultHeader} |`);
    lines.push('|---|---|---|---|');
    for (const c of candidates) {
      let statusText;
      if (executed) {
        // ALDRIG antag succes - vis det EGET udfald pr. issue (CodeRabbit-review, #5155).
        const outcome = outcomes instanceof Map ? outcomes.get(c.number) : undefined;
        statusText = outcome === 'ok'
          ? 'nedjusteret til priority:med'
          : outcome === 'partial'
            ? '⚠️ DELVIST - kommentar OK, label IKKE aendret (fanges igen naeste koersel)'
            : '❌ FEJLET - intet aendret';
      } else {
        statusText = c.reason === 'issue-updated'
          ? 'ingen kommentar/label-ændring/linket PR-aktivitet'
          : `seneste signal: ${c.reason}`;
      }
      lines.push(`| \`#${c.number}\` | ${sanitizeTitle(c.title)} | ${c.daysInactive} | ${statusText} |`);
    }
  }

  lines.push('');
  if (epicsFlagged.length === 0) {
    lines.push('Ingen epics uden aktivt child-issue.');
  } else {
    lines.push(`## ${epicsFlagged.length} epic(s) uden aabent child-issue med aktivitet (springes over, kun rapporteret)`);
    lines.push('');
    lines.push('| # | Titel | Kilde |');
    lines.push('|---|---|---|');
    for (const e of epicsFlagged) {
      lines.push(`| \`#${e.number}\` | ${sanitizeTitle(e.title)} | ${e.source} |`);
    }
  }

  if (errors.length > 0) {
    lines.push('');
    lines.push(`## ${errors.length} issue(s) kunne IKKE tjekkes (gh-kald fejlede - tjek manuelt)`);
    lines.push('');
    lines.push('| # | Titel | Fejl |');
    lines.push('|---|---|---|');
    for (const e of errors) {
      lines.push(`| \`#${e.number}\` | ${sanitizeTitle(e.title)} | ${e.message} |`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = {
    execute: false,
    days: DEFAULT_DAYS,
    repo: DEFAULT_REPO,
    now: new Date(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--execute') args.execute = true;
    else if (arg === '--dry-run') args.execute = false;
    else if (arg === '--days') {
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
    } else if (arg === '--now') {
      // test-hook, samme idiom som check-dependabot-exceptions.mjs
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

  const { execute, days, repo, now } = opts;

  const issues = fetchOpenPriorityHighIssues(execGh, repo);
  const { candidates, epicsFlagged, epicsOk, kept, errors } = classifyIssues({ issues, execGh, repo, days, now });

  let failures = 0;
  const outcomes = new Map(); // number -> 'ok' | 'partial' | 'failed' (kun udfyldt under --execute)
  if (execute) {
    for (const c of candidates) {
      const comment = buildDowngradeComment(c.daysInactive, days);
      try {
        applyDowngrade(execGh, repo, c.number, comment);
        outcomes.set(c.number, 'ok');
      } catch (err) {
        failures += 1;
        if (err instanceof DowngradeError && err.commented && !err.labelChanged) {
          outcomes.set(c.number, 'partial');
        } else {
          outcomes.set(c.number, 'failed');
        }
        errorLog(`#${c.number}: ${err.message}`);
      }
    }
  }

  log(formatReport({ candidates, epicsFlagged, errors, outcomes, days, now, executed: execute }));
  log('');
  log(`(${kept.length} priority:high inden for graensen, ${epicsOk.length} epic(s) med aktivt child-issue - ikke vist ovenfor.)`);

  return failures > 0 ? 1 : 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
