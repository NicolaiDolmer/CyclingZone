#!/usr/bin/env node
// scripts/til-doers-draft.mjs
// ============================================================
// Til dørs-robotten (#8266): efter hver merge og dagligt samler den ÉT
// udkast-dokument over det spillervendte, der mangler efter de seneste
// mergede PR'er, og en daglig oprydning.
//
// Robotten udgiver aldrig spillervendt tekst. Den skriver en kommentar pr.
// dag paa dirigent-tavlen (#7911); hovedsessionen fremlaegger udkastet for
// ejeren og laegger selv patch note, Hjaelp, roadmap og masterplan ind.
//
// Hvad den bygger ovenpaa (intet dobbeltarbejde):
//   - scripts/lib/til-doers.mjs: interne stier (isInternalChange), markeringer
//     "Til dørs: 6|7 ok|na ..." (parseMarkers), gh-hjaelperne.
//   - scripts/merge-queue-closeout.mjs: Refs/Closes-parseren og reglen for
//     "bag slukket kontakt" (isBehindSwitch), saa robotten og merge-koeen
//     doemmer en PR ens.
//   - scripts/check-patch-notes-coverage.js: opt-out-linjen
//     "patch-notes: n/a - <grund>" respekteres paa samme maade.
//   - til-doers.yml skriver 8-krav-tabellen pr. issue; denne robot samler i
//     stedet pr. dag og udfylder skabelonerne. roadmap-sync.yml opretter
//     punkter for flag; roadmap-punkter med flag_key flyttes af databasens
//     triggere og vises derfor ikke her.
//
// Rent Node, ingen betalte AI-kald. Supabase laeses kun (GET), og kun hvis
// SUPABASE_URL + SUPABASE_SERVICE_KEY er sat; ellers springes roadmap over.
//
// CLI:
//   node scripts/til-doers-draft.mjs draft   [--days 3] [--issue 7911] [--repo o/n] [--apply]
//   node scripts/til-doers-draft.mjs cleanup [--max 100] [--min-age-hours 24] [--repo o/n] [--apply]
// Uden --apply skrives intet (dry-run): udkastet/planen skrives til stdout.
// draft laeser en oprydnings-rapport fra env CLEANUP_REPORT (JSON fra cleanup).
//
// Tests: node --test scripts/til-doers-draft.test.mjs
// ============================================================

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BOT_LOGIN,
  COLLABORATOR_ASSOCIATIONS,
  DEFAULT_REPO,
  DONE_LABEL,
  HELP_FILE,
  defaultExecGh,
  defaultExecGit,
  ghPaged,
  isInternalChange,
  labelNames,
  parseMarkers,
  titleScopeIssues,
} from './lib/til-doers.mjs';
import { isBehindSwitch, parseIssueRefs } from './merge-queue-closeout.mjs';

const require = createRequire(import.meta.url);
const { hasOptOut, PATCH_NOTES_DATA_FILE } = require('./check-patch-notes-coverage.js');

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export const DRAFT_ISSUE = 7911;
export const MARKER_PREFIX = '<!-- til-doers-draft:v1';
export const DUP_BODY = `${MARKER_PREFIX} dup -->\nDublet af dagens til dørs-udkast. Det gældende udkast er det ældste for datoen.`;
const CLEANUP_START = '<!-- til-doers-draft:cleanup -->';
const CLEANUP_END = '<!-- /til-doers-draft:cleanup -->';
const HELP_FILE_DA = 'frontend/public/locales/da/help.json';
const MASTERPLAN_FILE = 'docs/MASTERPLAN.md';
const NOW_FILE = 'docs/NOW.md';
const MAX_COMMENT = 60000;

// Branches robotten aldrig sletter, uanset PR-historik.
export const PROTECTED_BRANCHES = [/^main$/, /^master$/, /^gh-pages$/, /^release\//, /^production$/];

export function markerFor(date) {
  return `${MARKER_PREFIX} date=${date} -->`;
}

// ---------------------------------------------------------------- datoer

/** YYYY-MM-DD i Europe/Copenhagen (projektets tidszone). */
export function copenhagenDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function shortDay(day) {
  const [, m, d] = String(day).split('-');
  return `${Number(d)}/${Number(m)}`;
}

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- patch notes

/**
 * Hver note i patchNotes.js som {version, date, refs}. Filen laeses som tekst
 * (den er data), samme tilgang som patchNoteVersionsFor i til-doers.mjs, men
 * med datoen, saa en gammel note paa et issue ikke daekker en ny PR.
 */
export function parsePatchNotes(text) {
  const out = [];
  if (!text) return out;
  const re = /["']?version["']?\s*:\s*["'](\d+(?:\.\d+)+)["']|["']?date["']?\s*:\s*["'](\d{4}-\d{2}-\d{2})["']|["']?refs["']?\s*:\s*\[([^\]]*)\]/g;
  let version = null;
  let date = null;
  for (const m of text.matchAll(re)) {
    if (m[1]) {
      version = m[1];
      date = null;
    } else if (m[2]) {
      date = m[2];
    } else if (version) {
      const refs = [...(m[3] || '').matchAll(/\d+/g)].map((x) => Number(x[0]));
      out.push({ version, date, refs });
    }
  }
  return out;
}

/** Foerste note med refs til et af numrene, skrevet samme dag som merget eller senere. */
export function coveringNote(notes, numbers, sinceDay) {
  const wanted = new Set(numbers.map(Number));
  return notes.find((n) => n.refs.some((r) => wanted.has(r)) && (!sinceDay || !n.date || n.date >= sinceDay)) || null;
}

function headingRe() {
  return /^#{1,6}\s+/;
}

/**
 * Patch note-afsnittet i PR-body ("## Patch note", "## Patch note-udkast ...").
 * Returnerer {heading, en, da, raw} eller null. en/da laeses fra linjer der
 * starter med EN:/DA: (ogsaa **EN:** og "- EN:"); staar teksten paa linjerne
 * efter, tages afsnittet indtil en tom linje.
 */
// Alt fra "<!--" til naeste "-->" (eller til slutningen, hvis den mangler)
// droppes. Gentages til teksten er stabil, fordi stumperne omkring en fjernet
// kommentar kan saette sig sammen til et nyt "<!--" ("<!-<!-- x -->-").
function stripHtmlComments(src) {
  let text = src;
  for (let prev = null; prev !== text;) { prev = text; text = stripHtmlCommentsOnce(text); }
  return text;
}

function stripHtmlCommentsOnce(src) {
  let out = '';
  let i = 0;
  for (;;) {
    const open = src.indexOf('<!--', i);
    if (open < 0) return out + src.slice(i);
    out += src.slice(i, open);
    const close = src.indexOf('-->', open + 4);
    if (close < 0) return out;
    i = close + 3;
  }
}

export function extractPatchNoteDraft(body) {
  // CodeQL #394/#395: fjern HTML-kommentarer uden regex-erstatning (se stripHtmlComments).
  const text = stripHtmlComments(String(body || ''));
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s*patch[\s-]?notes?\b/i.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (headingRe().test(lines[i])) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start + 1, end);
  const pick = (lang) => {
    const re = new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${lang}(?:\\*\\*)?\\s*[:.]\\s*(?:\\*\\*)?\\s*(.*)$`, 'i');
    const i = section.findIndex((l) => re.test(l));
    if (i < 0) return '';
    let text = section[i].match(re)[1].trim();
    if (!text) {
      const parts = [];
      for (let j = i + 1; j < section.length && section[j].trim(); j += 1) parts.push(section[j].trim());
      text = parts.join(' ');
    }
    return unquote(text);
  };
  const raw = section.join('\n').trim();
  return { heading: lines[start].replace(headingRe(), '').trim(), en: pick('EN'), da: pick('DA'), raw };
}

function unquote(s) {
  const t = String(s || '').trim();
  const m = t.match(/^["“”„](.*)["“”]$/s);
  return (m ? m[1] : t).trim();
}

const TYPE_CATEGORY = { feat: 'new', fix: 'fixed' };
const SCOPE_TOPIC = [
  [/train|traen|træn|xp|fatigue|traeth|træth/i, 'Training'],
  [/race|loeb|løb|stage|etape|result|engine|motor/i, 'Races'],
  [/transfer|market|marked/i, 'Transfers'],
  [/auction|auktion/i, 'Auctions'],
  [/board|bestyrelse/i, 'Board'],
  [/academy|akademi|youth|u23|junior/i, 'Academy'],
  [/notif|inbox|besked/i, 'Notifications'],
  [/rider|rytter|scout/i, 'Riders'],
  [/econom|finance|okonomi|økonomi|sponsor/i, 'Economy'],
  [/plan/i, 'Planning'],
  [/roadmap/i, 'Roadmap'],
  [/help|hjaelp|hjælp/i, 'Help'],
];

/** Conventional-type og scope fra PR-titlen. */
export function parseTitle(title) {
  const m = /^([a-z]+)(?:\(([^)]*)\))?!?:\s*(.*)$/i.exec(String(title || '').trim());
  if (!m) return { type: '', scope: '', subject: String(title || '').trim() };
  return { type: m[1].toLowerCase(), scope: m[2] || '', subject: m[3].replace(/\s*\((?:refs?|closes?)[^)]*\)\s*$/i, '').trim() };
}

export function guessTopic(title) {
  const { scope, subject } = parseTitle(title);
  for (const [re, topic] of SCOPE_TOPIC) if (re.test(scope)) return topic;
  for (const [re, topic] of SCOPE_TOPIC) if (re.test(subject)) return topic;
  return 'TODO';
}

/** patchNotes.js-post udfyldt fra PR'en. Titler skal skrives af et menneske. */
export function patchNoteTemplate(pr, numbers) {
  const { type } = parseTitle(pr.title);
  const draft = extractPatchNoteDraft(pr.body);
  const entry = {
    category: TYPE_CATEGORY[type] || 'improved',
    audience: 'player',
    rollout: 'live',
    topic: guessTopic(pr.title),
    en: { title: 'TODO', body: draft?.en || 'TODO' },
    da: { title: 'TODO', body: draft?.da || 'TODO' },
    refs: numbers.length ? numbers : [pr.number],
  };
  return { entry, draft };
}

// ---------------------------------------------------------------- Hjaelp

function fold(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

// Fyldord i PR-titler, der ellers ville matche tilfaeldige Hjaelp-noegler.
const STOP_WORDS = new Set(['viser', 'efter', 'naar', 'eller', 'ikke', 'foer', 'samme', 'alle', 'straks', 'gang', 'udgave', 'rettelse', 'rettelser', 'review', 'fejl', 'kommer', 'bliver', 'with', 'from', 'when', 'show', 'shows', 'fix', 'feat']);

export function tokens(s) {
  const spaced = String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return [...new Set(fold(spaced).split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !/^\d+$/.test(t) && !STOP_WORDS.has(t)))];
}

/** [{key, label, words}] fra help.json en + da. */
export function buildHelpIndex(en, da) {
  const out = [];
  for (const [key, section] of Object.entries(en?.sections || {})) {
    const daSection = da?.sections?.[key] || {};
    const words = new Set([
      ...tokens(key),
      ...tokens(section.label),
      ...tokens(daSection.label),
      ...Object.keys(section).filter((k) => k !== 'label').flatMap((k) => tokens(k)),
    ]);
    out.push({ key, label: daSection.label || section.label || key, words });
  }
  return out;
}

function wordsMatch(a, b) {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 5 && l.startsWith(s);
}

/** Op til to Hjaelp-afsnit hvis ord ligner PR-titlens. Heuristik, ikke facit. */
export function helpPointers(title, index, limit = 2) {
  const { scope, subject } = parseTitle(title);
  const words = tokens(`${scope} ${subject}`);
  const scored = index
    .map((s) => ({ ...s, score: words.filter((w) => [...s.words].some((x) => wordsMatch(w, x))).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return scored.slice(0, limit).map(({ key, label }) => ({ key, label }));
}

// ---------------------------------------------------------------- masterplan

/** Linjer i MASTERPLAN.md der naevner #N, med afsnit og et kort uddrag. */
export function masterplanMentions(markdown, n) {
  const out = [];
  let section = '';
  const re = new RegExp(`#${n}(?!\\d)`);
  for (const line of String(markdown || '').split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) {
      section = line.replace(/^#+\s*/, '').trim();
      continue;
    }
    const m = re.exec(line);
    if (!m) continue;
    const from = Math.max(0, m.index - 70);
    const to = Math.min(line.length, m.index + 90);
    const excerpt = `${from > 0 ? '…' : ''}${line.slice(from, to).trim()}${to < line.length ? '…' : ''}`;
    out.push({ section, excerpt });
  }
  return out;
}

// ---------------------------------------------------------------- backup-tabeller

/**
 * Paamindelser i NOW.md af formen "slet `backup_x` ~15/11" (flere navne med +
 * eller komma). Returnerer {names, due, status}: status 'over' naar datoen er
 * passeret, 'i dag' paa datoen, ellers 'senere'. Robotten sletter aldrig.
 */
export function parseBackupReminders(nowMd, today) {
  const out = [];
  // CodeQL #392: ingen tvetydig gentagelse (\s* paa begge sider af et valgfrit skilletegn).
  const re = /slet\s+(`[^`]+`(?:\s*(?:(?:\+|,|og)\s*)?`[^`]+`)*)\s*~\s*(\d{1,2})\/(\d{1,2})/gi;
  const year = Number(String(today).slice(0, 4));
  for (const m of String(nowMd || '').matchAll(re)) {
    const names = [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]).filter((x) => /^backup_/i.test(x));
    if (!names.length) continue;
    const mm = String(m[3]).padStart(2, '0');
    const dd = String(m[2]).padStart(2, '0');
    let due = `${year}-${mm}-${dd}`;
    // Aarsskifte: en dato et halvt aar vaek ligger i naboaaret.
    if (due > addDays(today, 183)) due = `${year - 1}-${mm}-${dd}`;
    else if (due < addDays(today, -183)) due = `${year + 1}-${mm}-${dd}`;
    const status = due < today ? 'over' : due === today ? 'i dag' : 'senere';
    out.push({ names, due, status });
  }
  return out;
}

// ---------------------------------------------------------------- PR-vurdering

/**
 * Issue-numre PR'en refererer: Refs/Closes i titel+body og titlens scope. Et
 * scope taeller kun, naar det alene bestaar af numre ("fix(7801)", "feat(#12, 34)"),
 * saa "race-v6" ikke bliver til issue #6.
 */
export function prIssueRefs(pr) {
  const byIssue = new Map();
  for (const r of parseIssueRefs(`${pr.title || ''}\n${pr.body || ''}`, pr.number)) byIssue.set(r.issue, r);
  const { scope } = parseTitle(pr.title);
  if (/^[#\d\s,&]+$/.test(scope)) {
    for (const n of titleScopeIssues(pr.title)) if (n !== pr.number && !byIssue.has(n)) byIssue.set(n, { issue: n, kind: 'refs' });
  }
  return [...byIssue.values()].sort((a, b) => a.issue - b.issue);
}

function prFiles(pr) {
  return (pr.files || []).map((f) => (typeof f === 'string' ? f : f.path || f.filename)).filter(Boolean);
}

/**
 * Alle filer kendt og alle interne? Ufuldstaendig liste = spillervendt (fail-safe).
 * patchNotes.js selv taeller som internt her: en PR der kun skriver patch notes
 * (og docs) er selve leverancen af kravet, ikke noget nyt der mangler en note.
 */
export function isInternalPr(pr) {
  const files = prFiles(pr);
  if (!files.length || Number(pr.changedFiles) > files.length) return false;
  const rest = files.filter((f) => f !== PATCH_NOTES_DATA_FILE);
  return rest.length === 0 || isInternalChange(rest);
}

// Conventional-typer der kan aendre noget spilleren maerker. chore/test/ci/docs/
// refactor/build/style forventes ikke at have en patch note; utypede titler
// behandles som spillervendte (fail-safe).
const PATCH_TYPES = new Set(['feat', 'fix', 'perf', 'revert', '']);
// Hjaelp forklarer mekanik; det er nyt (feat), ikke rettelser.
const HELP_TYPES = new Set(['feat']);
// Scopes for driftsvaerktoej (fx "feat(ops): ..."): ingen spillertekst.
const INTERNAL_SCOPES = /^(?:ops|ci|hooks|dev|infra|admin|deps)$/i;

/** Har et menneske markeret kravet ok/na, mens PR'en var aaben eller senere? */
function markedSince(issueInfo, krav, sinceIso) {
  if (!issueInfo) return null;
  const m = parseMarkers(issueInfo.comments || [], { issue: issueInfo.number }).get(krav);
  if (!m || (m.status !== 'ok' && m.status !== 'na')) return null;
  if (sinceIso && String(m.dato) < String(sinceIso)) return null;
  return m;
}

/** Er issuet leveret: lukket, claude:done, eller PR'en lukker det. */
export function isDelivered(ref, issueInfo) {
  if (ref.kind === 'closes') return true;
  if (!issueInfo) return false;
  return issueInfo.state === 'closed' || labelNames(issueInfo).includes(DONE_LABEL);
}

/**
 * Den rene kerne for én PR. Input er hentet; intet netvaerk.
 * @returns {{pr, refs, internal, behindSwitch, patch, help, delivered}}
 */
export function evaluatePr({ pr, notes, issues = new Map(), helpIndex = [] }) {
  const refs = prIssueRefs(pr);
  const numbers = refs.map((r) => r.issue);
  const files = prFiles(pr);
  const internal = isInternalPr(pr);
  const behindSwitch = isBehindSwitch(pr.title, pr.body);
  const mergedDay = pr.mergedAt ? copenhagenDay(new Date(pr.mergedAt)) : null;
  const { type, scope } = parseTitle(pr.title);
  const res = { pr, refs, internal, behindSwitch, patch: null, help: null };
  if (internal || INTERNAL_SCOPES.test(scope)) return res;

  // Patch note
  if (PATCH_TYPES.has(type)) {
    const marked7 = refs.map((r) => markedSince(issues.get(r.issue), 7, pr.createdAt)).find(Boolean);
    const note = coveringNote(notes, [...numbers, pr.number], mergedDay);
    if (files.includes(PATCH_NOTES_DATA_FILE)) res.patch = { status: 'ok', kilde: 'PR’en ændrede patchNotes.js' };
    else if (note) res.patch = { status: 'ok', kilde: `patch note v${note.version}` };
    else if (hasOptOut(pr.body)) res.patch = { status: 'ok', kilde: 'patch-notes: n/a i PR-body' };
    else if (marked7) res.patch = { status: 'ok', kilde: `Til dørs: 7 ${marked7.status}` };
    // Bag slukket kontakt: noten skrives ved taending, ikke nu.
    else if (behindSwitch) res.patch = { status: 'venter', draft: extractPatchNoteDraft(pr.body) };
    else res.patch = { status: 'mangler', ...patchNoteTemplate(pr, numbers) };
  }

  // Hjaelp
  if (HELP_TYPES.has(type) && !behindSwitch) {
    const marked6 = refs.map((r) => markedSince(issues.get(r.issue), 6, pr.createdAt)).find(Boolean);
    if (files.includes(HELP_FILE) || files.includes(HELP_FILE_DA)) res.help = { status: 'ok', kilde: 'PR’en ændrede help.json' };
    else if (marked6) res.help = { status: 'ok', kilde: `Til dørs: 6 ${marked6.status}` };
    else res.help = { status: 'mangler', sections: helpPointers(pr.title, helpIndex) };
  }

  return res;
}

/**
 * Leverede issues (til roadmap og masterplan). Issuets tilstand afgoer:
 * lukket eller claude:done (merge-koeen flipper ikke, naar PR'en ligger bag en
 * kontakt). Et Closes taeller kun fra en PR, der ikke ligger bag en kontakt.
 */
export function deliveredIssues(results, issues) {
  const out = new Map();
  for (const r of results) {
    for (const ref of r.refs) {
      if (out.has(ref.issue)) continue;
      const info = issues.get(ref.issue);
      const byState = isDelivered({ ...ref, kind: 'refs' }, info);
      if (byState || (ref.kind === 'closes' && !r.behindSwitch)) out.set(ref.issue, r.pr.number);
    }
  }
  return out;
}

// ---------------------------------------------------------------- oprydning

/**
 * Plan for sletning af remote branches. En branch slettes kun naar:
 *   - en PR fra samme repo med den branch som head er merget ind i main,
 *     for mindst minAgeHours siden,
 *   - branchens spids stadig er PR'ens head-commit (intet nyt skubbet siden),
 *   - ingen aaben PR har den som head ELLER base (stablede PR'er),
 *   - navnet ikke er beskyttet.
 * GitHub gemmer commits'ene paa PR'en ("Restore branch"), saa intet tabes.
 */
export function planBranchCleanup({ branches, mergedPrs, openPrs, now = new Date(), minAgeHours = 24, max = 100 }) {
  const busy = new Set();
  for (const p of openPrs || []) {
    if (p.headRefName) busy.add(p.headRefName);
    if (p.baseRefName) busy.add(p.baseRefName);
  }
  const byHead = new Map();
  for (const p of mergedPrs || []) {
    if (p.isCrossRepository || (p.baseRefName && p.baseRefName !== 'main') || !p.mergedAt) continue;
    const list = byHead.get(p.headRefName) || [];
    list.push(p);
    byHead.set(p.headRefName, list);
  }
  const cutoff = now.getTime() - minAgeHours * 3600 * 1000;
  const deletions = [];
  const skipped = { aaben: 0, nyCommit: 0, forNy: 0, beskyttet: 0 };
  for (const b of branches || []) {
    const prs = byHead.get(b.name);
    if (!prs) continue;
    if (PROTECTED_BRANCHES.some((re) => re.test(b.name))) {
      skipped.beskyttet += 1;
      continue;
    }
    if (busy.has(b.name)) {
      skipped.aaben += 1;
      continue;
    }
    const hit = prs.find((p) => p.headRefOid === b.sha);
    if (!hit) {
      skipped.nyCommit += 1;
      continue;
    }
    if (new Date(hit.mergedAt).getTime() > cutoff) {
      skipped.forNy += 1;
      continue;
    }
    deletions.push({ branch: b.name, sha: b.sha, pr: hit.number });
  }
  deletions.sort((a, b) => a.pr - b.pr);
  return { deletions: deletions.slice(0, max), udskudt: Math.max(0, deletions.length - max), skipped };
}

/**
 * git push-argumenter der sletter branchen, KUN hvis spidsen stadig er den
 * SHA planen saa. Serveren tjekker den forventede vaerdi atomisk, saa et push
 * mellem opgoerelsen og sletningen afviser sletningen i stedet for at miste det.
 */
export function leaseDeleteArgs(remote, branch, sha) {
  if (!/^[0-9a-f]{40}$/i.test(String(sha))) throw new Error(`ugyldig SHA for ${branch}`);
  if (!branch || branch.startsWith('-') || /[\s~^:?*[\\]|\.\.|@\{/.test(branch)) throw new Error(`ugyldigt branch-navn: ${branch}`);
  return ['push', '--porcelain', `--force-with-lease=refs/heads/${branch}:${sha}`, remote, `:refs/heads/${branch}`];
}

// ---------------------------------------------------------------- rendering

function oneLine(s, max = 140) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function issueList(refs) {
  return refs.length ? refs.map((r) => `#${r.issue}`).join(', ') : 'ingen issue-ref';
}

export function renderCleanup(report, day) {
  if (!report) return '';
  const lines = [CLEANUP_START, `### Oprydning ${shortDay(day)}`, ''];
  if (report.error) {
    lines.push(`Oprydningen fejlede: ${oneLine(report.error, 300)}`);
  } else {
    const n = report.deleted?.length || 0;
    lines.push(`${report.applied ? 'Slettet' : 'Ville slette (dry-run)'}: ${n} mergede remote branches.${report.udskudt ? ` ${report.udskudt} venter til næste kørsel.` : ''} Gendan via PR’ens "Restore branch".`);
    if (n) {
      lines.push('', '<details><summary>Branches</summary>', '');
      for (const d of report.deleted) lines.push(`- \`${d.branch}\` (PR #${d.pr}, ${String(d.sha).slice(0, 9)})`);
      lines.push('', '</details>');
    }
    if (report.errors?.length) lines.push('', `Fejl: ${report.errors.map((e) => oneLine(e, 120)).join('; ')}`);
  }
  lines.push(CLEANUP_END);
  return lines.join('\n');
}

/** Oprydnings-afsnittet fra en tidligere version af dagens kommentar. */
export function extractCleanupSection(body) {
  const s = String(body || '');
  const i = s.indexOf(CLEANUP_START);
  const j = s.indexOf(CLEANUP_END);
  return i >= 0 && j > i ? s.slice(i, j + CLEANUP_END.length) : '';
}

/** Har udkastet noget at sige? (Afventende kontakter alene opretter ingen kommentar.) */
export function hasFindings({ results, masterplan, roadmap, backups, cleanup }) {
  return (
    results.some((r) => r.patch?.status === 'mangler' || r.help?.status === 'mangler') ||
    masterplan.length > 0 ||
    (roadmap?.items?.length || 0) > 0 ||
    backups.some((b) => b.status !== 'senere') ||
    Boolean(cleanup)
  );
}

export function renderDraft({ day, days, results, masterplan, roadmap, backups, cleanup }) {
  const missing = results.filter((r) => r.patch?.status === 'mangler' || r.help?.status === 'mangler');
  const waiting = results.filter((r) => r.patch?.status === 'venter');
  const L = [
    markerFor(day),
    `## Til dørs-udkast ${shortDay(day)}`,
    '',
    `Robotten (#8266) har gennemgået PR’er merget i main de seneste ${days} dage. Dette er **udkast**: robotten udgiver aldrig spillervendt tekst. Hovedsessionen fremlægger for ejeren og lægger selv patch note, Hjælp, roadmap og masterplan ind. Kommentaren opdateres ved hver merge i dag.`,
    '',
  ];

  L.push('### Patch note og Hjælp mangler', '');
  if (!missing.length) L.push('Intet mangler.', '');
  for (const r of missing) {
    const merged = r.pr.mergedAt ? shortDay(copenhagenDay(new Date(r.pr.mergedAt))) : '?';
    L.push(`#### PR #${r.pr.number}: ${oneLine(r.pr.title, 110)} (merget ${merged}; ${issueList(r.refs)})`, '');
    if (r.patch?.status === 'mangler') {
      const src = r.patch.draft?.en || r.patch.draft?.da ? 'EN/DA fra PR’ens patch note-afsnit' : 'ingen patch note-tekst i PR-body; skriv EN/DA';
      L.push(`- **Patch note mangler** (${src}). Skabelon til \`${PATCH_NOTES_DATA_FILE}\`:`, '', '```json', JSON.stringify(r.patch.entry, null, 2), '```', '');
    } else if (r.patch) {
      L.push(`- Patch note: ok (${r.patch.kilde}).`);
    }
    if (r.help?.status === 'mangler') {
      const where = r.help.sections.length ? `mulige afsnit: ${r.help.sections.map((s) => `\`sections.${s.key}\` (${s.label})`).join(', ')}` : 'intet oplagt afsnit fundet';
      L.push(`- **Hjælp ikke ændret**: vurdér om spilleren skal have forklaringen (${where}). Ingen ny mekanik: \`Til dørs: 6 na <grund>\` på issuet.`);
    } else if (r.help) {
      L.push(`- Hjælp: ok (${r.help.kilde}).`);
    }
    L.push('');
  }

  if (roadmap) {
    L.push('### Roadmap: punkter der bør flyttes til leveret', '');
    if (roadmap.error) L.push(`Roadmap kunne ikke læses: ${oneLine(roadmap.error, 200)}`, '');
    else if (!roadmap.items.length) L.push('Ingen åbne punkter uden kontakt på de leverede issues.', '');
    else {
      for (const it of roadmap.items) L.push(`- #${it.issue_ref} ${it.table === 'known_issues' ? 'kendt fejl' : 'roadmap-punkt'} "${oneLine(it.title_en, 90)}" står som ${it.status}. Dry-run: \`node scripts/roadmap-flip.mjs --issue ${it.issue_ref}\` (kun når det er live for alle).`);
      L.push('');
    }
  } else {
    L.push('### Roadmap', '', 'Ikke tjekket (ingen læseadgang til Supabase i denne kørsel).', '');
  }

  L.push('### MASTERPLAN: linjer der nævner leverede issues', '');
  if (!masterplan.length) L.push('Ingen.', '');
  for (const m of masterplan) L.push(`- #${m.issue} (PR #${m.pr}) i "${oneLine(m.section, 60)}": ${m.excerpt.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')}`);
  if (masterplan.length) L.push('');

  const due = backups.filter((b) => b.status !== 'senere');
  L.push('### Backup-tabeller efter påmindelsen i NOW.md', '');
  if (!due.length) L.push('Ingen er over dato.', '');
  for (const b of due) L.push(`- ${b.names.map((x) => `\`${x}\``).join(' + ')}: dato ${shortDay(b.due)} (${b.status === 'over' ? 'over dato' : 'i dag'}). Listes kun; sletning er ejer-gated.`);
  if (due.length) L.push('');

  if (waiting.length) {
    L.push('<details><summary>Bag slukket kontakt (patch note og Hjælp ved tænding)</summary>', '');
    for (const r of waiting) L.push(`- PR #${r.pr.number} ${oneLine(r.pr.title, 100)} (${issueList(r.refs)}); patch note-udkast i PR-body: ${r.patch.draft?.en || r.patch.draft?.da ? 'ja' : 'nej'}`);
    L.push('', '</details>', '');
  }

  if (cleanup) L.push(cleanup, '');

  let body = L.join('\n').trimEnd();
  if (body.length > MAX_COMMENT) body = `${body.slice(0, MAX_COMMENT)}\n\n…(afkortet; se workflow-loggen for resten)`;
  return body;
}

// ---------------------------------------------------------------- kommentaren

/** Dagens kommentarer fra workflowet eller en collaborator, aeldste foerst. */
export function todaysComments(comments, day) {
  const marker = markerFor(day);
  return (comments || [])
    .filter((c) => String(c.body || '').includes(marker))
    .filter((c) => c.user?.login === BOT_LOGIN || COLLABORATOR_ASSOCIATIONS.has(String(c.author_association || '').toUpperCase()))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || Number(a.id) - Number(b.id));
}

/**
 * Hvad skal der skrives? Én kommentar pr. dag: findes den, opdateres den
 * (og dubletter fra samtidige koersler toemmes); ellers oprettes den kun,
 * hvis der er fund.
 */
export function planComment({ comments, day, body, findings }) {
  const mine = todaysComments(comments, day);
  const actions = [];
  if (mine.length) {
    if (mine[0].body !== body) actions.push({ op: 'update', id: mine[0].id, body });
    for (const dup of mine.slice(1)) if (dup.body !== DUP_BODY) actions.push({ op: 'update', id: dup.id, body: DUP_BODY });
  } else if (findings) {
    actions.push({ op: 'create', body });
  }
  return actions;
}

// ---------------------------------------------------------------- fetch-lag

export function fetchMergedPrs(execGh, repo, sinceDay) {
  const out = execGh([
    'pr', 'list', '--repo', repo, '--state', 'merged', '--base', 'main',
    '--search', `merged:>=${sinceDay}`, '--limit', '300',
    '--json', 'number,title,body,labels,createdAt,mergedAt,files,changedFiles,url',
  ]);
  return JSON.parse(out || '[]');
}

/**
 * Tilstand og labels for mange issues i faa GraphQL-kald (50 pr. kald), saa
 * leveret-tjekket kan se ALLE refererede issues uden et REST-kald pr. issue.
 * Returnerer Map<nummer, {number, state: 'open'|'closed', labels:[{name}]}>.
 */
export function fetchIssueStates(execGh, repo, numbers) {
  const [owner, name] = repo.split('/');
  const out = new Map();
  const list = [...new Set(numbers.map(Number))].filter((n) => Number.isSafeInteger(n) && n > 0).sort((a, b) => a - b);
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const fields = chunk.map((n) => `i${n}: issueOrPullRequest(number: ${n}) { ... on Issue { state labels(first: 50) { nodes { name } } } ... on PullRequest { state } }`).join('\n');
    const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {\n${fields}\n} }`;
    const data = JSON.parse(execGh(['api', 'graphql', '-f', `query=${query}`]) || '{}');
    const repoData = data?.data?.repository || {};
    for (const n of chunk) {
      const node = repoData[`i${n}`];
      if (!node) continue;
      out.set(n, { number: n, state: String(node.state || '').toLowerCase() === 'open' ? 'open' : 'closed', labels: node.labels?.nodes || [] });
    }
  }
  return out;
}

export function fetchIssueComments(execGh, repo, n) {
  return ghPaged(execGh, `repos/${repo}/issues/${n}/comments?per_page=100`);
}

/**
 * Roadmap-punkter og kendte fejl uden kontakt paa de leverede issues. Kun GET.
 * Service-noeglen omgaar RLS, og kommentaren er offentlig: kun raekker spillerne
 * allerede kan se (roadmap_items.approved, known_issues.published) maa komme med,
 * baade som filter i forespoergslen og som vaern paa svaret (Vercel Security Review, #8266).
 */
export async function fetchRoadmap({ fetchImpl = globalThis.fetch, env = process.env, issues }) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  if (!issues.length) return { items: [] };
  const list = issues.map(Number).filter(Number.isSafeInteger).join(',');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
  const get = async (table, select, visible, doneStatuses, extra = '') => {
    const q = `${url.replace(/\/+$/, '')}/rest/v1/${table}?select=${select},${visible}&issue_ref=in.(${list})&status=not.in.(${doneStatuses.join(',')})&${visible}=is.true${extra}`;
    const res = await fetchImpl(q, { method: 'GET', headers });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
    return (await res.json())
      .filter((r) => r[visible] === true)
      .map(({ [visible]: _visible, ...r }) => ({ ...r, table }));
  };
  try {
    const items = await get('roadmap_items', 'id,issue_ref,status,title_en,flag_key', 'approved', ['shipped', 'archived'], '&flag_key=is.null');
    const known = await get('known_issues', 'id,issue_ref,status,title_en', 'published', ['fixed', 'dismissed']);
    return { items: [...items, ...known].sort((a, b) => a.issue_ref - b.issue_ref) };
  } catch (err) {
    return { items: [], error: err.message };
  }
}

function readText(rel) {
  try {
    return readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
}

function readJson(rel) {
  try {
    return JSON.parse(readText(rel));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------- kommandoer

export async function runDraft({ execGh = defaultExecGh, repo = DEFAULT_REPO, days = 3, issue = DRAFT_ISSUE, apply = false, now = new Date(), env = process.env, fetchImpl, read = readText, log = console.log }) {
  const day = copenhagenDay(now);
  const since = addDays(day, -(days - 1));
  const prs = fetchMergedPrs(execGh, repo, since);
  const notes = parsePatchNotes(read(PATCH_NOTES_DATA_FILE));
  const masterplanText = read(MASTERPLAN_FILE);
  const helpIndex = buildHelpIndex(JSON.parse(read(HELP_FILE) || '{}'), JSON.parse(read(HELP_FILE_DA) || '{}'));

  // Tilstand og labels for ALLE refererede issues (leveret-tjekket til roadmap
  // og masterplan), samlet i faa GraphQL-kald. Kommentarer (markeringer 6/7)
  // hentes kun for issues paa spillervendte PR'er, hvor de kan aendre udfaldet.
  const allRefs = new Set();
  const needComments = new Set();
  for (const pr of prs) {
    const { type, scope } = parseTitle(pr.title);
    const markersMatter = !isInternalPr(pr) && PATCH_TYPES.has(type) && !INTERNAL_SCOPES.test(scope);
    for (const ref of prIssueRefs(pr)) {
      allRefs.add(ref.issue);
      if (markersMatter) needComments.add(ref.issue);
    }
  }
  let issues = new Map();
  try {
    issues = fetchIssueStates(execGh, repo, [...allRefs]);
  } catch (err) {
    log(`advarsel: issue-tilstande kunne ikke læses: ${err.message}`);
  }
  for (const n of [...needComments].sort((a, b) => a - b)) {
    try {
      const info = issues.get(n) || { number: n, state: 'open', labels: [] };
      issues.set(n, { ...info, comments: fetchIssueComments(execGh, repo, n) });
    } catch (err) {
      log(`advarsel: kommentarer på #${n} kunne ikke læses: ${err.message}`);
    }
  }

  const results = prs.sort((a, b) => a.number - b.number).map((pr) => evaluatePr({ pr, notes, issues, helpIndex }));
  const delivered = deliveredIssues(results, issues);
  const masterplan = [];
  for (const [n, pr] of delivered) for (const m of masterplanMentions(masterplanText, n)) masterplan.push({ issue: n, pr, ...m });
  const roadmap = await fetchRoadmap({ fetchImpl, env, issues: [...delivered.keys()] });
  const backups = parseBackupReminders(read(NOW_FILE), day);

  const comments = ghPaged(execGh, `repos/${repo}/issues/${issue}/comments?per_page=100`);
  let cleanup = '';
  if (env.CLEANUP_REPORT) {
    try {
      cleanup = renderCleanup(JSON.parse(env.CLEANUP_REPORT), day);
    } catch (err) {
      cleanup = renderCleanup({ error: `rapporten kunne ikke læses: ${err.message}` }, day);
    }
  } else {
    cleanup = extractCleanupSection(todaysComments(comments, day)[0]?.body);
  }

  const body = renderDraft({ day, days, results, masterplan, roadmap, backups, cleanup });
  const findings = hasFindings({ results, masterplan, roadmap, backups, cleanup });
  const actions = planComment({ comments, day, body, findings });

  log(body);
  log(`\n---\ntil-doers-draft ${apply ? '' : '[dry-run] '}${day}: ${prs.length} PR'er, ${results.filter((r) => r.patch?.status === 'mangler').length} mangler patch note, ${masterplan.length} masterplan-linjer, handlinger: ${actions.map((a) => a.op).join(', ') || 'ingen'}`);
  if (!apply) return { body, actions, results };
  for (const a of actions) {
    if (a.op === 'create') execGh(['api', '-X', 'POST', `repos/${repo}/issues/${issue}/comments`, '--input', '-'], JSON.stringify({ body: a.body }));
    else execGh(['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${a.id}`, '--input', '-'], JSON.stringify({ body: a.body }));
  }
  return { body, actions, results };
}

export function runCleanup({ execGh = defaultExecGh, execGit = defaultExecGit, repo = DEFAULT_REPO, remote = `https://github.com/${repo}.git`, apply = false, max = 100, minAgeHours = 24, now = new Date(), log = console.log }) {
  const branches = ghPaged(execGh, `repos/${repo}/git/matching-refs/heads/`).map((r) => ({ name: String(r.ref).replace(/^refs\/heads\//, ''), sha: r.object?.sha }));
  const mergedPrs = JSON.parse(execGh(['pr', 'list', '--repo', repo, '--state', 'merged', '--base', 'main', '--limit', '1000', '--json', 'number,headRefName,headRefOid,baseRefName,isCrossRepository,mergedAt']) || '[]');
  const openPrs = JSON.parse(execGh(['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '1000', '--json', 'number,headRefName,baseRefName']) || '[]');
  const plan = planBranchCleanup({ branches, mergedPrs, openPrs, now, minAgeHours, max });
  const deleted = [];
  const errors = [];
  for (const d of plan.deletions) {
    if (!apply) {
      deleted.push(d);
      continue;
    }
    try {
      execGit(leaseDeleteArgs(remote, d.branch, d.sha));
      deleted.push(d);
    } catch (err) {
      errors.push(`${d.branch}: ${String(err.stderr || err.message).trim()}`);
    }
  }
  const report = { applied: apply, deleted, udskudt: plan.udskudt, skipped: plan.skipped, errors };
  for (const d of deleted) log(`${apply ? 'slettet' : 'ville slette'} ${d.branch} (PR #${d.pr}, ${d.sha})`);
  log(`oprydning ${apply ? '' : '[dry-run] '}: ${deleted.length} branches, ${plan.udskudt} udskudt, sprunget over ${JSON.stringify(plan.skipped)}, ${errors.length} fejl`);
  return report;
}

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const out = { cmd, apply: false, days: 3, issue: DRAFT_ISSUE, repo: DEFAULT_REPO, max: 100, minAgeHours: 24, out: '' };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    const val = () => rest[(i += 1)];
    if (a === '--apply') out.apply = true;
    else if (a === '--dry-run') out.apply = false;
    else if (a === '--days') out.days = Number(val());
    else if (a === '--issue') out.issue = Number(val());
    else if (a === '--repo') out.repo = val();
    else if (a === '--max') out.max = Number(val());
    else if (a === '--min-age-hours') out.minAgeHours = Number(val());
    else if (a === '--out') out.out = val();
    else throw new Error(`Ukendt argument: ${a}`);
  }
  if (!['draft', 'cleanup'].includes(cmd)) throw new Error('Brug: til-doers-draft.mjs draft|cleanup [--apply] ...');
  for (const k of ['days', 'issue', 'max', 'minAgeHours']) {
    if (!Number.isSafeInteger(out[k]) || out[k] < (k === 'minAgeHours' ? 0 : 1)) throw new Error(`--${k} skal være et heltal`);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(out.repo)) throw new Error('--repo skal være owner/name');
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd === 'cleanup') {
    const report = runCleanup(args);
    if (args.out) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(args.out, JSON.stringify(report));
    }
    return;
  }
  await runDraft(args);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(`til-doers-draft fejlede: ${err.message}`);
    process.exit(1);
  });
}
