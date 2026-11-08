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

// #7827: internt arbejde. Spilleren kan ikke se eller maerke disse stier, saa
// krav 3-7 giver ingen mening for et issue, der kun har roert dem. Listen er en
// positivliste: en ukendt sti (ny mappe, frontend/src, backend/lib, database/)
// goer issuet spillervendt, saa fejlen altid gaar mod at holde det aabent.
const INTERNAL_PATHS = [
  /^scripts\//,
  /^\.github\//,
  /^\.claude\//,
  /^docs\//,
  /^pr-screens\//,
  /^[^/]+\.md$/,
  /^backend\/scripts\/dev\//,
  /^backend\/test\//,
  /^frontend\/tests\//,
  /\.test\.[cm]?[jt]sx?$/,
];

/** Roerer fillisten kun interne stier? Tom eller ukendt liste = nej (fail-safe). */
export function isInternalChange(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return false;
  return paths.every((p) => typeof p === 'string' && INTERNAL_PATHS.some((re) => re.test(p)));
}
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

/** Issue-numre i en titels scope, fx `fix(4242): ...` eller `feat(12, 34): ...`. */
export function titleScopeIssues(title) {
  const m = /^[a-z]+\(([^)]*)\)!?:/i.exec(title || "");
  if (!m) return [];
  return [...new Set([...m[1].matchAll(/\d+/g)].map((x) => Number(x[0])))].sort((a, b) => a - b);
}

/**
 * En merget PR taeller kun som merget, naar den er merget ind i main. En PR
 * merget ind i en anden feature- eller integrationsbranch har merged_at sat,
 * men intet af den ligger paa main (Codex P2 paa #7428).
 */
export function mergedIntoMain(pull, mainBranch = "main") {
  return Boolean(pull?.merged_at) && pull?.base?.ref === mainBranch;
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

// Eksporteret saa auto-bevis-kernen (til-doers-proof.mjs) og testene kan
// bevise, at en udkast-linje aldrig kan laeses som en markering.
export const MARKER_LINE = /^\s*[-*>]?\s*til\s+d(?:ø|oe|o)rs\s*:\s*([1-8])\s+(ok|na|n\/a|mangler)\b[\s:.-]*(.*)$/i;

// Auto-bevis (#7585): en kommentar med denne markoer er skrevet af auto-bevis-
// koerslen efter et merge-tog. Den koerer lokalt med ejerens gh-token, saa
// GitHub giver den author_association OWNER, og dens linjer taeller derfor som
// markeringer. De vises med kilden 'auto-bevis', taeller ikke som en ny
// menneskelig markering efter en genaabning, og et brand-issue lukkes aldrig
// alene paa auto-bevis for krav 8 (se decideClose).
// github-actions[bot] faar author_association CONTRIBUTOR (verificeret paa
// #7585 4/11), som ikke er i COLLABORATOR_ASSOCIATIONS: en bot-skrevet
// auto-bevis-kommentar taeller aldrig.
export const PROOF_MARKER_PREFIX = '<!-- til-doers-proof:v1';
const PROOF_MARKER_RE = /<!-- til-doers-proof:v1 pr=(\d+) issue=(\d+) sha=([0-9a-f]{7,40}) -->/;

/** Er kommentaren (eller et forsoeg paa) en auto-bevis-kommentar? */
export function isProofComment(body) {
  return String(body || '').includes(PROOF_MARKER_PREFIX);
}

/** {pr, issue, sha} fra auto-bevis-markoeren, eller null hvis den mangler eller er misdannet. */
export function parseProofMarker(body) {
  const m = PROOF_MARKER_RE.exec(String(body || ''));
  if (!m) return null;
  return { pr: Number(m[1]), issue: Number(m[2]), sha: m[3] };
}

/**
 * Markeringer fra collaborator-kommentarer. Seneste pr. krav vinder.
 * Kommentarer der selv er til-doers-tabellen springes over, saa scriptets
 * egen kommentar aldrig kan markere noget.
 *
 * Linjer fra en auto-bevis-kommentar faar auto: true. Er issue angivet, taeller
 * en auto-bevis-kommentar kun hvis markoeren er gyldig og peger paa netop det
 * issue, saa et bevis kopieret over paa et andet issue ikke markerer noget.
 * menneske er den seneste ikke-automatiske markering for samme krav (eller null).
 *
 * @param {Array} comments
 * @param {{issue?: number}} [opts]
 * @returns {Map<number, {status, tekst, af, dato, commentId, auto, menneske}>}
 */
export function parseMarkers(comments, { issue = null } = {}) {
  // En auto-bevis-kommentar redigeres paa stedet, naar samme tog koeres igen.
  // Dens tidspunkt er derfor updated_at, saa et nyere bevis vinder over en
  // menneskelig markering skrevet mellem foerste og seneste koersel.
  const at = (c) => String((isProofComment(c.body) && c.updated_at) || c.created_at || '');
  const sorted = [...(comments || [])].sort((a, b) => at(a).localeCompare(at(b)));
  const latest = new Map();
  const latestHuman = new Map();
  for (const c of sorted) {
    const body = c.body || '';
    if (body.includes(MARKER)) continue;
    if (!COLLABORATOR_ASSOCIATIONS.has(String(c.author_association || '').toUpperCase())) continue;
    const auto = isProofComment(body);
    if (auto && issue != null && parseProofMarker(body)?.issue !== Number(issue)) continue;
    for (const line of body.split(/\r?\n/)) {
      const m = line.match(MARKER_LINE);
      if (!m) continue;
      const krav = Number(m[1]);
      const raw = m[2].toLowerCase();
      const status = raw === 'n/a' ? 'na' : raw;
      const tekst = m[3].trim();
      if (status === 'na' && !tekst) continue; // na uden begrundelse taeller ikke
      const entry = { status, tekst, af: c.user?.login || '', dato: at(c), commentId: c.id, auto };
      latest.set(krav, entry);
      if (!auto) latestHuman.set(krav, entry);
    }
  }
  for (const [krav, entry] of latest) latest.set(krav, { ...entry, menneske: latestHuman.get(krav) || null });
  return latest;
}

// ---------------------------------------------------------------- evaluering

function auto(status, kilde, hvorfor = '') {
  return { status, kilde, hvorfor };
}

const INTERNAL_SOURCE = 'internt arbejde: kun scripts, CI, tests eller docs';

/** Har merge-koeen skrevet "Verificeret" for netop denne PR paa netop dette issue? */
export function queueVerified(comments, pr, issue) {
  const marker = `<!-- merge-queue-closeout:v1 pr=${pr} issue=${issue} -->`;
  return (comments || []).some((c) => {
    const body = c.body || '';
    return body.includes(marker) && body.includes('Verificeret:') && COLLABORATOR_ASSOCIATIONS.has(String(c.author_association || '').toUpperCase());
  });
}

/** Sidst mergede PR efter merge-tid. PR-nummeret afgoer kun ved ens eller manglende tid. */
export function latestMerged(prs) {
  return [...prs].sort((a, b) => String(b.mergedAt || '').localeCompare(String(a.mergedAt || '')) || b.number - a.number)[0];
}

/** Main-commits der ikke er squash-commits fra issuets mergede PR'er. */
export function directCommits(commits, prs) {
  const fromPr = prs.filter((p) => p.merged).map((p) => `(#${p.number})`);
  return (commits || []).filter((c) => !fromPr.some((tag) => String(c.subject || '').includes(tag)));
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
 * @param {boolean} [p.internalOnly] alle mergede PR'er roerte kun interne stier (#7827)
 * @returns {Array<{krav, navn, status, kilde, hvorfor}>}
 */
export function evaluateDoor({ issue, comments = [], prs = [], commits = [], registry = [], patchNotesText = '', helpChanged = false, internalOnly = false }) {
  const n = Number(issue.number);
  const markers = parseMarkers(comments, { issue: n });
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

  // #7827: internt arbejde udfyldes selv, saa det ikke hober sig op som aabent.
  // Kun naar nogen har sagt done, intet er aabent og issuet ikke er en epic:
  // en enkelt merget PR under en delopgave er ikke det samme som faerdig.
  const labels = labelNames(issue);
  if (internalOnly && merged.length && !open.length && labels.includes(DONE_LABEL) && !labels.some((l) => l === 'epic' || l.startsWith('epic:'))) {
    for (const krav of [3, 4, 5, 6, 7]) {
      if (autoResults[krav].status === 'mangler') autoResults[krav] = auto('na', INTERNAL_SOURCE);
    }
    const newest = latestMerged(merged).number;
    if (queueVerified(comments, newest, n)) {
      // autoBevis: en menneskelig markering vinder stadig, og brand kraever et menneske.
      autoResults[8] = { ...auto('ok', `merge-køen verificerede PR #${newest}`), autoBevis: true, menneskeStatus: null };
    }
  }

  return KRAV.map(({ krav, navn }) => {
    const a = autoResults[krav];
    const m = markers.get(krav);
    if ((a.status === 'ok' && !a.autoBevis) || !m) return { krav, navn, ...a };
    if (m.auto) {
      // menneskeStatus: seneste menneskelige markering for samme krav, til brand-reglen i decideClose.
      return { krav, navn, status: m.status, kilde: 'auto-bevis', hvorfor: m.tekst, autoBevis: true, menneskeStatus: m.menneske?.status || null };
    }
    const who = m.af ? ` af ${m.af}` : '';
    return { krav, navn, status: m.status, kilde: `markering${who}`, hvorfor: m.tekst };
  });
}

export function missingKrav(door) {
  return door.filter((d) => d.status !== 'ok' && d.status !== 'na');
}

/**
 * Seneste menneskelige markering (ISO-tid) eller null. Auto-bevis taeller ikke:
 * har ejeren genaabnet et issue, maa en ny automatisk koersel ikke laase op for
 * en ny lukning, foer et menneske har markeret igen.
 */
export function lastMarkerAt(comments) {
  let at = null;
  for (const m of parseMarkers(comments).values()) {
    const human = m.auto ? m.menneske : m;
    if (human?.dato && (!at || human.dato > at)) at = human.dato;
  }
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
  // Brand-regel (#7585): auto-bevis alene lukker aldrig et brand-issue. Er det
  // seneste ord paa krav 8 et auto-bevis, skal et menneske ogsaa have sagt ok.
  if (isBrand && k8.autoBevis && k8.menneskeStatus !== 'ok') {
    return { close: false, reason: 'brand-issue kræver en menneskelig markering af krav 8, auto-bevis er ikke nok' };
  }
  return { close: true, reason: 'alle 8 krav er ok eller na' };
}

// ---------------------------------------------------------------- rendering

// Backslash escapes foer pipe (CodeQL #385): ellers bliver et "\" foran et "|"
// i evidensen til "\\|", og tabellen brydes alligevel.
export function cell(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
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

function commitFiles(execGit, sha) {
  try {
    return execGit(['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--first-parent', sha]).split(/\r?\n/).filter(Boolean);
  } catch {
    return []; // ukendt filliste: isInternalChange svarer nej
  }
}

function commitTouches(execGit, sha, file) {
  return commitFiles(execGit, sha).includes(file);
}

/** Henter alt evaluateDoor skal bruge for ét issue. */
export function fetchIssueBundle({ execGh = defaultExecGh, execGit = defaultExecGit, repo = DEFAULT_REPO, number, mainRef }) {
  const issue = ghJson(execGh, [`repos/${repo}/issues/${number}`]);
  const comments = ghPaged(execGh, `repos/${repo}/issues/${number}/comments?per_page=100`);
  const timeline = ghPaged(execGh, `repos/${repo}/issues/${number}/timeline?per_page=100`);
  const prs = prsFromTimeline(timeline, number, repo).map((pr) => {
    if (!pr.merged) return pr;
    const pull = ghJson(execGh, [`repos/${repo}/pulls/${pr.number}`]);
    return mergedIntoMain(pull) ? pr : { ...pr, merged: false, mergedAt: null };
  });
  const ref = mainRef || resolveMainRef(execGit);
  const commits = mainCommitsFor(execGit, number, ref);

  let helpChanged = false;
  let internalOnly = prs.some((p) => p.merged);
  for (const pr of prs.filter((p) => p.merged)) {
    const files = ghPaged(execGh, `repos/${repo}/pulls/${pr.number}/files?per_page=100`).map((f) => f.filename);
    if (!isInternalChange(files)) internalOnly = false;
    if (!helpChanged && files.includes(HELP_FILE)) helpChanged = `PR #${pr.number}`;
  }
  // En direkte main-commit er ogsaa levering: roerer den spillerkode, er issuet ikke internt.
  if (internalOnly && directCommits(commits, prs).some((c) => !isInternalChange(commitFiles(execGit, c.sha)))) internalOnly = false;
  if (!helpChanged) {
    const hit = commits.find((c) => commitTouches(execGit, c.sha, HELP_FILE));
    if (hit) helpChanged = `commit ${hit.sha.slice(0, 9)}`;
  }

  return { issue, comments, timeline, prs, commits, helpChanged, internalOnly };
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
