// scripts/lib/til-doers.mjs
// ============================================================
// Til-doers-systemet (#7336): 8 krav pr. issue, hvor det maalbare udfyldes
// automatisk og resten markeres manuelt med en kommentar-linje.
//
// Grundlag: docs/superpowers/specs/2026-10-29-foelg-til-doers-design.md §3.4
// + plan Task 8, men med ejerens 8 krav (31/10) i stedet for 6:
//   1 Bygget  2 Merget  3 Taendt  4 Synligt  5 Gammelt vaek  6 Hjaelp
//   7 Patch note  8 Verificeret i prod
//
// Status pr. krav: ok | na | mangler. Raekkefoelge naar kilder er uenige:
//   automatisk ok  >  seneste manuelle markering  >  automatisk mangler.
// Et automatisk bevis kan altsaa ikke tales ned af en gammel markering, men
// en markering kan altid udfylde et hul scriptet ikke selv kan maale.
//
// Manuel markering: en linje i en issue-kommentar fra en repo-collaborator
// (author_association OWNER/MEMBER/COLLABORATOR):
//   Til dørs: <1-8> ok|na|mangler <evidens eller begrundelse>
// na uden tekst taeller ikke. Seneste markering pr. krav vinder.
//
// Alt i denne fil er rene funktioner. GitHub-/git-kald ligger i fetch-laget
// nederst og tager en injicerbar exec, saa testene aldrig rammer netvaerket.

import { execFileSync } from 'node:child_process';

export const MARKER = '<!-- til-doers:v1 -->';
export const DEFAULT_REPO = 'NicolaiDolmer/CyclingZone';
export const DONE_LABEL = 'claude:done';
// needs-decision: ejer-krav (#7336). auto-close-veto: repoets faelles veto-label
// (docs/GITHUB_WORKFLOW.md "Autonom close-policy"), respekteres ogsaa her.
export const NO_AUTOCLOSE_LABELS = ['needs-decision', 'auto-close-veto'];
export const HELP_FILE = 'frontend/public/locales/en/help.json';
export const COLLABORATOR_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export const KRAV = [
  { krav: 1, navn: 'Bygget' },
  { krav: 2, navn: 'Merget' },
  { krav: 3, navn: 'Tændt' },
  { krav: 4, navn: 'Synligt' },
  { krav: 5, navn: 'Gammelt væk' },
  { krav: 6, navn: 'Hjælp' },
  { krav: 7, navn: 'Patch note' },
  { krav: 8, navn: 'Verificeret i prod' },
];

const MANUAL_HINT = 'markér med en kommentar-linje: Til dørs: <nr> ok|na <evidens eller begrundelse>';

// ---------------------------------------------------------------- helpers

export function labelNames(issue) {
  return (issue?.labels || []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
}

/**
 * Refererer teksten issuet med et noegleord (Refs/Closes/Fixes/Resolves #N)?
 * Et bart "#N" taeller ikke: det er ofte bare en henvisning i prosa.
 */
export function refsIssue(text, n) {
  if (!text) return false;
  const re = new RegExp(`\\b(?:refs?|close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\b\\s*:?\\s*(?:#\\d+\\s*[,&]?\\s*(?:and\\s+|og\\s+)?)*#${n}(?!\\d)`, 'i');
  return re.test(text);
}

/** Conventional-commit-scope med issuet, fx "fix(7327): ...". */
export function titleScopeIssue(title, n) {
  if (!title) return false;
  return new RegExp(`^[a-z]+\\((?:[^)]*[^0-9])?${n}(?:[^0-9][^)]*)?\\)!?:`, 'i').test(title);
}

/** Alle issue-numre en tekst refererer med noegleord (bruges ved PR-merge). */
export function extractRefIssues(text) {
  const out = new Set();
  if (!text) return [];
  const re = /\b(?:refs?|close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s*((?:#\d+\s*[,&]?\s*(?:and\s+|og\s+)?)+)/gi;
  for (const m of text.matchAll(re)) {
    for (const num of m[1].matchAll(/#(\d+)/g)) out.add(Number(num[1]));
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Patch notes: hvilke versioner har en note hvis refs indeholder issuet?
 * Laeser frontend/src/data/patchNotes.js som tekst (filen er data, ikke kode
 * vi vil importere i CI). check-patch-notes-coverage.js har ingen refs-logik
 * at genbruge, saa parseren bor her.
 */
export function patchNoteVersionsFor(patchNotesText, n) {
  if (!patchNotesText) return [];
  const versions = [];
  const tokenRe = /["']?version["']?\s*:\s*["'](\d+(?:\.\d+)+)["']|["']?refs["']?\s*:\s*\[([^\]]*)\]/g;
  let current = null;
  for (const m of patchNotesText.matchAll(tokenRe)) {
    if (m[1]) {
      current = m[1];
      continue;
    }
    const nums = [...(m[2] || '').matchAll(/\d+/g)].map((x) => Number(x[0]));
    if (nums.includes(n) && current && !versions.includes(current)) versions.push(current);
  }
  return versions;
}

/** Registry-poster der naevner issuet: epic == N eller "#N" i note. */
export function registryEntriesFor(registry, n) {
  const noteRe = new RegExp(`#${n}(?!\\d)`);
  return (registry || []).filter((e) => String(e.epic || '').trim() === String(n) || noteRe.test(e.note || ''));
}

// ---------------------------------------------------------------- markers

const MARKER_LINE = /^\s*[-*>]?\s*til\s+d(?:ø|oe|o)rs\s*:\s*([1-8])\s+(ok|na|n\/a|mangler)\b[\s:.-]*(.*)$/i;

/**
 * Manuelle markeringer fra collaborator-kommentarer. Seneste pr. krav vinder.
 * Kommentarer der selv er til-doers-tabellen springes over, saa scriptets
 * egen kommentar aldrig kan markere noget.
 *
 * @returns {Map<number, {status, tekst, af, dato, commentId}>}
 */
export function parseMarkers(comments) {
  const sorted = [...(comments || [])].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const latest = new Map();
  for (const c of sorted) {
    const body = c.body || '';
    if (body.includes(MARKER)) continue;
    if (!COLLABORATOR_ASSOCIATIONS.has(String(c.author_association || '').toUpperCase())) continue;
    for (const line of body.split(/\r?\n/)) {
      const m = line.match(MARKER_LINE);
      if (!m) continue;
      const krav = Number(m[1]);
      const raw = m[2].toLowerCase();
      const status = raw === 'n/a' ? 'na' : raw;
      const tekst = m[3].trim();
      if (status === 'na' && !tekst) continue; // na uden begrundelse taeller ikke
      latest.set(krav, { status, tekst, af: c.user?.login || '', dato: c.created_at || '', commentId: c.id });
    }
  }
  return latest;
}

// ---------------------------------------------------------------- evaluering

function auto(status, kilde, hvorfor = '') {
  return { status, kilde, hvorfor };
}

function prLabel(pr) {
  return `PR #${pr.number}${pr.merged ? ' (merget)' : pr.state === 'open' ? ' (åben)' : ''}`;
}

/**
 * Den rene kerne. Input er allerede hentet; intet netvaerk her.
 *
 * @param {object} p
 * @param {{number:number, labels?:Array}} p.issue
 * @param {Array} p.comments   REST-kommentarer (body, author_association, created_at, user.login)
 * @param {Array} p.prs        [{number, state:'open'|'closed', merged:boolean}] der refererer issuet
 * @param {Array} [p.commits]  [{sha, subject}] main-commits med Refs/Closes #N
 * @param {Array} p.registry   parseRegistry(FEATURE_REGISTRY.yml)
 * @param {string} p.patchNotesText indholdet af frontend/src/data/patchNotes.js
 * @param {false|string} p.helpChanged falsk, eller kilden der aendrede help.json (fx "PR #12")
 * @returns {Array<{krav, navn, status, kilde, hvorfor}>}
 */
export function evaluateDoor({ issue, comments = [], prs = [], commits = [], registry = [], patchNotesText = '', helpChanged = false }) {
  const n = Number(issue.number);
  const markers = parseMarkers(comments);
  const merged = prs.filter((p) => p.merged);
  const open = prs.filter((p) => p.state === 'open' && !p.merged);
  const entries = registryEntriesFor(registry, n);
  const autoResults = {};

  // 1 Bygget: PR (aaben eller merget) eller main-commit
  if (merged.length) autoResults[1] = auto('ok', prLabel(merged[0]));
  else if (open.length) autoResults[1] = auto('ok', prLabel(open[0]));
  else if (commits.length) autoResults[1] = auto('ok', `commit ${commits[0].sha.slice(0, 9)} på main`);
  else autoResults[1] = auto('mangler', 'ingen PR eller main-commit med Refs/Closes #' + n);

  // 2 Merget: merget PR eller main-commit
  if (merged.length) autoResults[2] = auto('ok', prLabel(merged[0]));
  else if (commits.length) autoResults[2] = auto('ok', `commit ${commits[0].sha.slice(0, 9)} på main`);
  else if (open.length) autoResults[2] = auto('mangler', `${prLabel(open[0])} er ikke merget`);
  else autoResults[2] = auto('mangler', 'ingen merget PR eller main-commit');

  // 3 Taendt: ALLE registry-poster for issuet er live (retired = fjernet med
  // vilje, taeller ikke imod). En live del-feature goer ikke hele issuet taendt.
  const active = entries.filter((e) => e.state !== 'retired');
  const notLive = active.filter((e) => e.state !== 'live');
  if (active.length && !notLive.length) autoResults[3] = auto('ok', `registry ${active.map((e) => e.id).join(', ')} (live)`);
  else if (notLive.length) autoResults[3] = auto('mangler', `registry ikke live: ${notLive.map((e) => `${e.id} (${e.state})`).join(', ')}`, MANUAL_HINT);
  else autoResults[3] = auto('mangler', 'manuelt (ingen registry-post)', MANUAL_HINT);

  // 4 Synligt: registry visible_in, hvis feltet findes
  const visible = entries.find((e) => String(e.visible_in || '').trim());
  if (visible) autoResults[4] = auto('ok', `registry ${visible.id}: ${visible.visible_in}`);
  else autoResults[4] = auto('mangler', 'manuelt', MANUAL_HINT);

  // 5 Gammelt vaek: altid manuelt
  autoResults[5] = auto('mangler', 'manuelt', MANUAL_HINT);

  // 6 Hjaelp: en merget PR for issuet aendrede help.json
  if (helpChanged) autoResults[6] = auto('ok', `${helpChanged} ændrede help.json`);
  else autoResults[6] = auto('mangler', 'manuelt (help.json ikke ændret)', MANUAL_HINT);

  // 7 Patch note: patchNotes.js har en note med refs N
  const versions = patchNoteVersionsFor(patchNotesText, n);
  if (versions.length) autoResults[7] = auto('ok', `patch note v${versions[0]}`);
  else autoResults[7] = auto('mangler', 'manuelt (ingen patch note med refs)', MANUAL_HINT);

  // 8 Verificeret i prod: altid manuelt
  autoResults[8] = auto('mangler', 'manuelt', MANUAL_HINT);

  return KRAV.map(({ krav, navn }) => {
    const a = autoResults[krav];
    const m = markers.get(krav);
    if (a.status === 'ok' || !m) return { krav, navn, ...a };
    const who = m.af ? ` af ${m.af}` : '';
    return { krav, navn, status: m.status, kilde: `markering${who}`, hvorfor: m.tekst };
  });
}

export function missingKrav(door) {
  return door.filter((d) => d.status !== 'ok' && d.status !== 'na');
}

/** Seneste manuelle markering (ISO-tid) eller null. */
export function lastMarkerAt(comments) {
  let at = null;
  for (const m of parseMarkers(comments).values()) if (m.dato && (!at || m.dato > at)) at = m.dato;
  return at;
}

/** Seneste reopened-event (ISO-tid) eller null. */
export function reopenedAt(timeline) {
  let at = null;
  for (const ev of timeline || []) if (ev.event === 'reopened' && (!at || ev.created_at > at)) at = ev.created_at;
  return at;
}

/**
 * Skal issuet auto-lukkes? Kun naar alle 8 er ok/na, issuet er aabent, uden
 * veto-label, og (brand) krav 8 er ok, ikke bare na.
 *
 * Genaabnings-vagt: er issuet genaabnet EFTER den seneste markering, lukkes det
 * ikke igen, foer nogen har markeret paa ny. Ellers ville et issue ejeren
 * genaabner blive lukket igen ved naeste sweep, fordi markeringerne staar uaendret.
 */
export function decideClose({ issue, door, brandList = [], reopened = null, lastMarker = null }) {
  if (issue.state && issue.state !== 'open') return { close: false, reason: 'issuet er ikke åbent' };
  const missing = missingKrav(door);
  if (missing.length) return { close: false, reason: `mangler ${missing.map((d) => d.krav).join(', ')}` };
  const veto = NO_AUTOCLOSE_LABELS.find((l) => labelNames(issue).includes(l));
  if (veto) return { close: false, reason: `label ${veto}` };
  if (reopened && (!lastMarker || reopened > lastMarker)) return { close: false, reason: 'genåbnet efter seneste markering' };
  const isBrand = brandList.some((b) => Number(b?.issue ?? b) === Number(issue.number));
  const k8 = door.find((d) => d.krav === 8);
  if (isBrand && k8?.status !== 'ok') return { close: false, reason: 'brand-issue kræver krav 8 = ok' };
  return { close: true, reason: 'alle 8 krav er ok eller na' };
}

// ---------------------------------------------------------------- rendering

function cell(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

export function renderComment(door) {
  const done = door.filter((d) => d.status === 'ok' || d.status === 'na').length;
  const missing = missingKrav(door);
  const rows = door.map((d) => {
    const kilde = d.status === 'ok' || !d.hvorfor || d.hvorfor === MANUAL_HINT ? d.kilde : `${d.kilde}: ${d.hvorfor}`;
    return `| ${d.krav} | ${d.navn} | ${d.status} | ${cell(kilde)} |`;
  });
  const status = missing.length
    ? `**Status:** ${done} af 8 er ok eller na. Mangler: ${missing.map((d) => `${d.krav} ${d.navn}`).join(', ')}.`
    : '**Status:** alle 8 er ok eller na.';
  return [
    MARKER,
    '### Til dørs (8 krav)',
    '',
    '| # | Krav | Status | Kilde |',
    '|---|---|---|---|',
    ...rows,
    '',
    status,
    '',
    'Denne kommentar opdateres automatisk. Markér et krav i en ny kommentar med en linje som `Til dørs: 5 ok <evidens>` eller `Til dørs: 4 na <begrundelse>`. na kræver en begrundelse, og den seneste markering pr. krav vinder. Se docs/GITHUB_WORKFLOW.md.',
  ].join('\n');
}

export const CLOSE_COMMENT = 'Alle 8 krav i til-dørs-tabellen er ok eller na, så issuet lukkes som færdigt. Genåbn hvis noget alligevel mangler.';

// ---------------------------------------------------------------- fetch-lag

export function defaultExecGh(args, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export function defaultExecGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** gh api --paginate med --jq '.[]' giver én JSON pr. linje. */
export function ghPaged(execGh, path) {
  const out = execGh(['api', '--paginate', path, '--jq', '.[]']);
  return out.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export function ghJson(execGh, args) {
  return JSON.parse(execGh(['api', ...args]));
}

/** Hoerer kilden til repoet? repository.full_name, ellers html_url. */
function sameRepo(src, repo) {
  if (!repo) return true;
  const full = src.repository?.full_name;
  if (full) return full.toLowerCase() === repo.toLowerCase();
  return String(src.html_url || '').toLowerCase().includes(`github.com/${repo.toLowerCase()}/`);
}

/**
 * PR'er der refererer issuet, fundet via timeline cross-referenced-events.
 * Kun PR'er i samme repo: en fremmed PR med "Refs #N" er ikke bevis, og dens
 * nummer ville pege paa en anden PR her.
 */
export function prsFromTimeline(timeline, n, repo) {
  const byNumber = new Map();
  for (const ev of timeline || []) {
    if (ev.event !== 'cross-referenced') continue;
    const src = ev.source?.issue;
    if (!src?.pull_request) continue;
    if (!sameRepo(src, repo)) continue;
    if (!refsIssue(src.body, n) && !refsIssue(src.title, n) && !titleScopeIssue(src.title, n)) continue;
    byNumber.set(src.number, {
      number: src.number,
      title: src.title,
      state: src.state,
      merged: Boolean(src.pull_request.merged_at),
      mergedAt: src.pull_request.merged_at || null,
    });
  }
  return [...byNumber.values()].sort((a, b) => b.number - a.number);
}

/** Seneste tidspunkt labelen blev sat (labeled-event), eller null. */
export function labeledAt(timeline, label = DONE_LABEL) {
  let at = null;
  for (const ev of timeline || []) {
    if (ev.event === 'labeled' && ev.label?.name === label && (!at || ev.created_at > at)) at = ev.created_at;
  }
  return at;
}

/** main-commits med Refs/Closes #N. ref = origin/main hvis den findes. */
export function mainCommitsFor(execGit, n, ref) {
  // git filtrerer groft paa "#N"; noegleords-reglen afgoeres af refsIssue, saa
  // commits og PR'er doemmes efter praecis samme regel (fx "hotfix #N" taeller ikke).
  let out = '';
  try {
    out = execGit(['log', ref, '-E', `--grep=#${n}([^0-9]|$)`, '--format=%H%x1f%s%x1f%b%x1e']);
  } catch {
    return [];
  }
  return out
    .split('\x1e')
    .map((rec) => rec.replace(/^\r?\n/, ''))
    .filter(Boolean)
    .map((rec) => {
      const [sha, subject = '', body = ''] = rec.split('\x1f');
      return { sha: sha.trim(), subject, body };
    })
    .filter((c) => c.sha && refsIssue(`${c.subject}\n${c.body}`, n))
    .map(({ sha, subject }) => ({ sha, subject }));
}

export function resolveMainRef(execGit) {
  for (const ref of ['origin/main', 'main']) {
    try {
      execGit(['rev-parse', '--verify', '--quiet', ref]);
      return ref;
    } catch {
      // proev naeste
    }
  }
  return 'HEAD';
}

function commitTouches(execGit, sha, file) {
  try {
    return execGit(['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--first-parent', sha]).split(/\r?\n/).includes(file);
  } catch {
    return false;
  }
}

/** Henter alt evaluateDoor skal bruge for ét issue. */
export function fetchIssueBundle({ execGh = defaultExecGh, execGit = defaultExecGit, repo = DEFAULT_REPO, number, mainRef }) {
  const issue = ghJson(execGh, [`repos/${repo}/issues/${number}`]);
  const comments = ghPaged(execGh, `repos/${repo}/issues/${number}/comments?per_page=100`);
  const timeline = ghPaged(execGh, `repos/${repo}/issues/${number}/timeline?per_page=100`);
  const prs = prsFromTimeline(timeline, number, repo);
  const ref = mainRef || resolveMainRef(execGit);
  const commits = mainCommitsFor(execGit, number, ref);

  let helpChanged = false;
  for (const pr of prs.filter((p) => p.merged)) {
    const files = ghPaged(execGh, `repos/${repo}/pulls/${pr.number}/files?per_page=100`).map((f) => f.filename);
    if (files.includes(HELP_FILE)) {
      helpChanged = `PR #${pr.number}`;
      break;
    }
  }
  if (!helpChanged) {
    const hit = commits.find((c) => commitTouches(execGit, c.sha, HELP_FILE));
    if (hit) helpChanged = `commit ${hit.sha.slice(0, 9)}`;
  }

  return { issue, comments, timeline, prs, commits, helpChanged };
}

export const BOT_LOGIN = 'github-actions[bot]';
export const DUP_BODY = '<!-- til-doers:dup -->\nDublet af til-dørs-tabellen. Den gældende tabel er den ældste i tråden.';

/**
 * Tabel-kommentarer vi stoler paa: markoeren + skrevet af workflowet
 * (github-actions[bot]) eller en collaborator (lokal koersel med ejerens token).
 * En udenforstaaende kan kopiere markoeren, men aldrig overtage tabellen.
 * Aeldste foerst, saa den gaeldende tabel er stabil.
 */
export function trustedMarkerComments(comments) {
  return (comments || [])
    .filter((c) => (c.body || '').includes(MARKER))
    .filter((c) => c.user?.login === BOT_LOGIN || COLLABORATOR_ASSOCIATIONS.has(String(c.author_association || '').toUpperCase()))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || Number(a.id) - Number(b.id));
}

export function findMarkerComment(comments) {
  return trustedMarkerComments(comments)[0] || null;
}
