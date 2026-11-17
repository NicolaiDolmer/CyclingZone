#!/usr/bin/env node
// patch-notes-number.mjs: patch notes som fragmenter pr. PR, nummer ved merge (#8346).
//
// Problem: hver spillerrettet PR skrev sin note oeverst i frontend/src/data/patchNotes.js
// med et versionsnummer. Alle aabne PR'er ramte derfor de samme linjer og de samme numre
// (17/11: seks PR'er i konflikt paa filen, to med samme version).
//
// Nu: en PR tilfoejer EEN ny fil frontend/src/data/patch-notes/pending/<issue>-<slug>.json
// med samme felter som en post i dag, men uden `version` og `date`. Ingen importerer
// mappen, saa ventende noter er usynlige for spillerne (siden og patch-notes.json laeser
// kun PATCHES). Efter et VERIFICERET merge-tog kalder scripts/merge-queue-closeout.mjs
// `numberPendingOnMain`, som:
//   1. henter origin/main og finder alle ventende fragmenter,
//   2. ordner dem i merge-raekkefoelge (de commits paa main, first-parent, der tilfoejede
//      dem; samme commit sorteres paa filnavn) og giver dato = merge-dagen i
//      Europe/Copenhagen,
//   3. giver dem top-version + 1, + 2 ... og saetter posterne oeverst i patchNotes.js,
//   4. sletter fragmenterne og skriver det hele som eet chore-commit paa main via
//      GitHubs Git Data API oven paa den hentede SHA (ref-opdatering uden force; er
//      main flyttet, proeves een gang til fra frisk main).
// Ingen lokal checkout roeres: koeen koerer ofte i et delt checkout med andres arbejde.
//
// Validering af fragmenterne i PR'er sker i scripts/check-patch-notes-version.js
// (required, frontend-build) via `validatePendingDir`.
//
// CLI:
//   node scripts/patch-notes-number.mjs check                 valider pending/ i arbejdstraeet
//   node scripts/patch-notes-number.mjs plan [--ref <ref>]    vis nummer-planen (skriver intet)
//   node scripts/patch-notes-number.mjs local                 nummerer i arbejdstraeet (ingen commit)
//   node scripts/patch-notes-number.mjs push [--repo o/n] [--dry-run]
//                                                             det merge-toget koerer
// Tests: node --test scripts/patch-notes-number.test.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_REPO = 'NicolaiDolmer/CyclingZone';
export const PATCH_FILE = 'frontend/src/data/patchNotes.js';
export const PENDING_DIR = 'frontend/src/data/patch-notes/pending';
export const FRAGMENT_PATH_RE = /^frontend\/src\/data\/patch-notes\/pending\/[^/]+\.json$/;
const FRAGMENT_NAME_RE = /^[a-z0-9][a-z0-9-]{2,79}\.json$/;
const HEADER = 'export const PATCHES = [';
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const CATEGORIES = ['new', 'improved', 'fixed'];
const AUDIENCES = ['player', 'internal'];
const FRAGMENT_KEYS = ['changes', 'label'];
// Samme regler som frontend/src/lib/patchNotes.data.test.js (gyldig stage, laek-moenster):
// den test ser foerst noten paa main efter nummereringen, saa fragmentet maa ikke kunne
// slippe igennem med noget den afviser.
const STAGES = ['beta'];
const LEAK_RE = /(\bSELECT \b|\bINSERT \b|\bGRANT \b|service_role|\.sql\b|scripts\/|\bRLS\b|\.github\/)/i;

export function isPendingFragmentPath(file) {
  return FRAGMENT_PATH_RE.test(String(file ?? ''));
}

// ---------------------------------------------------------------- validering

/** Valider eet fragment. Returnerer { data, errors }; data er null naar JSON'en ikke kan bruges. */
export function validateFragment(name, text) {
  const errors = [];
  const say = (msg) => errors.push(`${name}: ${msg}`);
  if (!FRAGMENT_NAME_RE.test(name)) say('filnavnet skal vaere <issue>-<kort-slug>.json med a-z, 0-9 og bindestreg');
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    say(`ugyldig JSON (${err?.message ?? err})`);
    return { data: null, errors };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    say('skal vaere et JSON-objekt med "changes"');
    return { data: null, errors };
  }
  for (const key of ['version', 'date']) {
    if (Object.hasOwn(data, key)) say(`"${key}" gives ved merge og maa ikke staa i fragmentet`);
  }
  for (const key of Object.keys(data)) {
    if (!FRAGMENT_KEYS.includes(key) && key !== 'version' && key !== 'date') say(`ukendt felt "${key}" (tilladt: ${FRAGMENT_KEYS.join(', ')})`);
  }
  if (data.label !== undefined && typeof data.label !== 'string') say('"label" skal vaere tekst');
  if (!Array.isArray(data.changes) || data.changes.length === 0) {
    say('"changes" skal vaere en ikke-tom liste');
    return { data: null, errors };
  }
  data.changes.forEach((c, i) => {
    const at = (msg) => errors.push(`${name}#${i}: ${msg}`);
    if (!c || typeof c !== 'object' || Array.isArray(c)) return at('en change skal vaere et objekt');
    if (!CATEGORIES.includes(c.category)) at(`category skal vaere ${CATEGORIES.join('|')}`);
    if (!AUDIENCES.includes(c.audience)) at(`audience skal vaere ${AUDIENCES.join('|')}`);
    if (c.stage !== undefined && !STAGES.includes(c.stage)) at(`stage (hvis sat) skal vaere ${STAGES.join('|')}`);
    const langs = ['en', 'da'].filter((lang) => c[lang] !== undefined);
    if (!langs.some((lang) => typeof c[lang]?.body === 'string' && c[lang].body.trim())) at('mindst eet sprog (en/da) skal have en body');
    for (const lang of langs) {
      const t = c[lang];
      if (!t || typeof t !== 'object') { at(`${lang} skal vaere { title, body }`); continue; }
      if (typeof t.title !== 'string' || !t.title.trim()) at(`${lang}.title mangler`);
      if (typeof t.body !== 'string' || !t.body.trim()) at(`${lang}.body mangler`);
      if (c.audience === 'player' && LEAK_RE.test(String(t.body ?? ''))) at(`${lang}.body indeholder interne signaler (kode, SQL, stier)`);
    }
    if (c.refs !== undefined && (!Array.isArray(c.refs) || !c.refs.every((n) => Number.isSafeInteger(n) && n > 0))) at('refs skal vaere en liste af issue-numre');
  });
  return { data: errors.length ? null : data, errors };
}

/** Ventende fragmenter i et arbejdstrae: [{ path, name, text }], sorteret paa navn. */
export function readPendingDir(root = ROOT) {
  const dir = join(root, ...PENDING_DIR.split('/'));
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((name) => ({ path: `${PENDING_DIR}/${name}`, name, text: readFileSync(join(dir, name), 'utf8') }));
}

/**
 * Fuld validering af pending/ (bruges af check-patch-notes-version.js). Ud over
 * formatet koeres de samme regler som en NY post faar: hver `newEntryChecks`-funktion
 * (fx missingRollout/missingFlag fra versionsvagten) kaldes med fragmentet som en ny
 * version, og tone-vagternes regler (em-dash, doede produkttermer) koeres paa teksten.
 */
export async function validatePendingDir(root = ROOT, { newEntryChecks = [] } = {}) {
  const files = readPendingDir(root);
  const errors = [];
  const fragments = [];
  for (const file of files) {
    const res = validateFragment(file.name, file.text);
    errors.push(...res.errors);
    if (res.data) fragments.push({ ...file, data: res.data });
  }
  if (!fragments.length) return { fragments, errors };
  const { findPatchNotesEmDashViolations } = await import(new URL('./tone-check-em-dash.mjs', import.meta.url).href);
  const { findLocaleTermViolations } = await import(new URL('./tone-check-terms.mjs', import.meta.url).href);
  for (const f of fragments) {
    const provisional = [{ version: `pending/${f.name}`, changes: f.data.changes }];
    for (const [checkName, fn] of newEntryChecks) {
      const bad = fn(provisional, []);
      if (bad.length) errors.push(`${f.name}: fejler ${checkName} (${bad.join(', ')}); se docs/PATCH_NOTES_RULES.md`);
    }
    for (const v of findPatchNotesEmDashViolations(f.data, f.path)) errors.push(`em-dash: ${v}`);
    for (const v of findLocaleTermViolations(f.data, f.path)) errors.push(`doed produktterm: ${v}`);
  }
  return { fragments, errors };
}

// ---------------------------------------------------------------- nummerering

export function compareVersion(a, b) {
  const left = String(a).split('.').map(Number);
  const right = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

export function bumpVersion(version) {
  const parts = String(version).split('.').map(Number);
  parts[parts.length - 1] += 1;
  return parts.join('.');
}

export function topVersion(source) {
  return String(source).match(/"version":\s*"(\d+(?:\.\d+)+)"/)?.[1] ?? null;
}

/** ISO-tidspunkt -> YYYY-MM-DD i Europe/Copenhagen (projektets tidszone). */
export function copenhagenDay(when = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date(when));
}

/** PATCHES-kilden som data (filen er JSON efter `export const PATCHES = `). */
export function parsePatchesSource(source) {
  const text = String(source);
  if (!text.startsWith(HEADER)) throw new Error(`${PATCH_FILE} starter ikke med "${HEADER}"`);
  return JSON.parse(text.slice(HEADER.length - 1).trim().replace(/;\s*$/, ''));
}

/**
 * Saet fragmenterne ind oeverst. fragments: [{ path, data, order, date }], hvor lavere
 * order = merget foerst. Returnerer { source, assigned: [{ path, version, date }] }.
 */
export function numberFragments(source, fragments) {
  if (!fragments.length) return { source, assigned: [] };
  const eol = String(source).includes('\r\n') ? '\r\n' : '\n';
  const head = HEADER + eol;
  if (!source.startsWith(head)) throw new Error(`${PATCH_FILE} starter ikke med "${HEADER}"`);
  let version = topVersion(source);
  if (!version) throw new Error(`ingen version fundet i ${PATCH_FILE}`);
  const ordered = [...fragments].sort((a, b) => a.order - b.order || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const assigned = ordered.map((f) => {
    version = bumpVersion(version);
    const entry = { version, date: f.date, ...(f.data.label ? { label: f.data.label } : {}), changes: f.data.changes };
    return { path: f.path, version, date: f.date, entry };
  });
  const text = [...assigned].reverse().map((a) => `${JSON.stringify(a.entry, null, 2).replace(/\n/g, eol)},${eol}`).join('');
  return { source: head + text + source.slice(head.length), assigned: assigned.map(({ path, version: v, date }) => ({ path, version: v, date })) };
}

/** Sikkerhedsnet foer noget skrives: filen parser, versionerne er unikke og faldende, og de nye er med. */
export function assertNumbered(source, assigned) {
  const patches = parsePatchesSource(source);
  const versions = patches.map((p) => p.version);
  if (new Set(versions).size !== versions.length) throw new Error('dublet-versioner efter nummerering');
  for (let i = 1; i < versions.length; i += 1) {
    if (compareVersion(versions[i - 1], versions[i]) <= 0) throw new Error(`versioner ikke faldende: ${versions[i - 1]} foer ${versions[i]}`);
  }
  for (const a of assigned) if (!versions.includes(a.version)) throw new Error(`version ${a.version} mangler efter nummerering`);
  return patches.length;
}

/**
 * Hvilke commits (first-parent) tilfoejede hvert fragment? Map path -> { sha, iso, index },
 * index 0 = nyeste. git: (args) => stdout.
 */
export function addedCommits(git, ref, paths) {
  const out = git(['log', '--first-parent', '--diff-filter=A', '--name-only', '--format=@@%H %cI', ref, '--', `${PENDING_DIR}/`]);
  const wanted = new Set(paths);
  const map = new Map();
  let current = null;
  let index = -1;
  for (const raw of String(out).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('@@')) {
      const [sha, iso] = line.slice(2).split(' ');
      index += 1;
      current = { sha, iso, index };
    } else if (current && wanted.has(line) && !map.has(line)) {
      map.set(line, current);
    }
  }
  return map;
}

/**
 * Plan for en git-ref: { fragments: [{ path, data, order, date, sha }], skipped: [tekst] }.
 * Ugyldige fragmenter springes over (og meldes), saa een daarlig fil ikke stopper resten.
 */
export function planFromGit({ git, ref, now = new Date() }) {
  const listed = String(git(['ls-tree', '--name-only', ref, '--', `${PENDING_DIR}/`])).split(/\r?\n/).map((l) => l.trim());
  const paths = listed.filter((p) => p.startsWith(`${PENDING_DIR}/`) && p.endsWith('.json')).sort();
  const skipped = [];
  if (!paths.length) return { fragments: [], skipped };
  const added = addedCommits(git, ref, paths);
  const fragments = [];
  for (const path of paths) {
    const res = validateFragment(basename(path), git(['show', `${ref}:${path}`]));
    if (!res.data) { skipped.push(`${path} springes over: ${res.errors.join('; ')}`); continue; }
    const info = added.get(path);
    fragments.push({
      path,
      data: res.data,
      order: info ? -info.index : Number.MAX_SAFE_INTEGER,
      date: copenhagenDay(info ? info.iso : now),
      sha: info?.sha ?? null,
    });
  }
  return { fragments, skipped };
}

export function commitMessage(assigned) {
  const first = assigned[0].version;
  const last = assigned.at(-1).version;
  const range = first === last ? first : `${first}-${last}`;
  const lines = assigned.map((a) => `- ${a.version} (${a.date}): ${a.path.slice(PENDING_DIR.length + 1)}`);
  return [
    `chore(patch-notes): nummerer ${assigned.length} ventende patch note${assigned.length === 1 ? '' : 's'} (${range})`,
    '',
    'Merge-toget giver ventende fragmenter nummer og dato i merge-raekkefoelge',
    'efter et verificeret tog (scripts/patch-notes-number.mjs).',
    '',
    ...lines,
  ].join('\n');
}

// ---------------------------------------------------------------- skrivning via GitHub

function runGhJson(gh, args, body) {
  const dir = mkdtempSync(join(tmpdir(), 'cz-patch-notes-'));
  const file = join(dir, 'body.json');
  try {
    writeFileSync(file, JSON.stringify(body));
    const res = gh([...args, '--input', file]);
    let json;
    try { json = JSON.parse(res.stdout || 'null'); } catch { json = null; }
    return { status: res.status, json, text: `${res.stdout ?? ''}\n${res.stderr ?? ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Eet commit oven paa baseSha: ny patchNotes.js, fragmenterne slettet, ref uden force. */
export function writeCommitViaApi({ gh, repo, baseSha, baseTree, source, removed, message }) {
  const blob = runGhJson(gh, ['api', `repos/${repo}/git/blobs`, '--method', 'POST'], { content: Buffer.from(source, 'utf8').toString('base64'), encoding: 'base64' });
  if (blob.status !== 0 || !blob.json?.sha) return { ok: false, error: `blob fejlede: ${blob.text.trim().slice(0, 300)}` };
  const tree = runGhJson(gh, ['api', `repos/${repo}/git/trees`, '--method', 'POST'], {
    base_tree: baseTree,
    tree: [
      { path: PATCH_FILE, mode: '100644', type: 'blob', sha: blob.json.sha },
      ...removed.map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
    ],
  });
  if (tree.status !== 0 || !tree.json?.sha) return { ok: false, error: `tree fejlede: ${tree.text.trim().slice(0, 300)}` };
  const commit = runGhJson(gh, ['api', `repos/${repo}/git/commits`, '--method', 'POST'], { message, tree: tree.json.sha, parents: [baseSha] });
  if (commit.status !== 0 || !commit.json?.sha) return { ok: false, error: `commit fejlede: ${commit.text.trim().slice(0, 300)}` };
  const ref = runGhJson(gh, ['api', `repos/${repo}/git/refs/heads/main`, '--method', 'PATCH'], { sha: commit.json.sha, force: false });
  if (ref.status !== 0) {
    return { ok: false, notFastForward: /fast.?forward|422/i.test(ref.text), error: `main kunne ikke opdateres: ${ref.text.trim().slice(0, 300)}` };
  }
  return { ok: true, sha: commit.json.sha };
}

export function defaultGit(root = ROOT) {
  return (args) => {
    const res = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
    if (res.error || res.status !== 0) throw new Error(`git ${args[0]} fejlede: ${String(res.stderr || res.error?.message || '').trim().slice(0, 300)}`);
    return res.stdout;
  };
}

export function defaultGh(args) {
  const res = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000, windowsHide: true });
  return { status: res.error ? 1 : (res.status ?? 1), stdout: res.stdout ?? '', stderr: res.stderr ?? String(res.error?.message ?? '') };
}

/**
 * Det merge-toget koerer efter et verificeret tog. Returnerer log-linjer; kaster ved
 * fejl (kalderen er fail-soft). dryRun = vis planen, skriv intet.
 */
export function numberPendingOnMain({ repo = DEFAULT_REPO, dryRun = false, git = defaultGit(), gh = defaultGh, now = new Date(), attempts = 2 } = {}) {
  const lines = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    git(['fetch', '--no-tags', '--quiet', 'origin', 'main']);
    const baseSha = String(git(['rev-parse', 'origin/main'])).trim();
    const plan = planFromGit({ git, ref: baseSha, now });
    for (const s of plan.skipped) lines.push(`patch notes ADVARSEL: ${s}`);
    if (!plan.fragments.length) {
      lines.push('patch notes: ingen ventende fragmenter paa main.');
      return lines;
    }
    const { source, assigned } = numberFragments(String(git(['show', `${baseSha}:${PATCH_FILE}`])), plan.fragments);
    assertNumbered(source, assigned);
    const summary = assigned.map((a) => `${a.version} <- ${a.path.slice(PENDING_DIR.length + 1)}`).join(', ');
    if (dryRun) {
      lines.push(`[dry-run] patch notes: ville nummerere ${assigned.length} fragment(er) paa main: ${summary}.`);
      return lines;
    }
    const baseTree = String(git(['rev-parse', `${baseSha}^{tree}`])).trim();
    const res = writeCommitViaApi({ gh, repo, baseSha, baseTree, source, removed: assigned.map((a) => a.path), message: commitMessage(assigned) });
    if (res.ok) {
      lines.push(`patch notes: ${assigned.length} fragment(er) nummereret paa main som ${String(res.sha).slice(0, 8)}: ${summary}.`);
      lines.push(`patch notes: ${res.sha} er et nyt main-commit efter dette togs verifikation; main-CI og deploy for det ses af naeste tog (dets merge bygger oven paa det) eller tjekkes paa main-HEAD.`);
      return lines;
    }
    if (!res.notFastForward || attempt === attempts) throw new Error(res.error);
    lines.push('patch notes: main flyttede sig undervejs; proever igen fra frisk main.');
  }
  return lines;
}

/** Nummerer i et arbejdstrae (manuel fallback og lokal proeve). Committer intet. */
export function numberLocal({ root = ROOT, git = defaultGit(root), now = new Date() } = {}) {
  const files = readPendingDir(root);
  const errors = [];
  const valid = [];
  for (const f of files) {
    const res = validateFragment(f.name, f.text);
    if (res.data) valid.push({ ...f, data: res.data });
    else errors.push(...res.errors);
  }
  if (errors.length) throw new Error(`ugyldige fragmenter:\n  ${errors.join('\n  ')}`);
  if (!valid.length) return { assigned: [] };
  let added = new Map();
  try { added = addedCommits(git, 'HEAD', valid.map((f) => f.path)); } catch { added = new Map(); }
  const fragments = valid.map((f) => {
    const info = added.get(f.path);
    return { path: f.path, data: f.data, order: info ? -info.index : Number.MAX_SAFE_INTEGER, date: copenhagenDay(info ? info.iso : now) };
  });
  const patchPath = join(root, ...PATCH_FILE.split('/'));
  const { source, assigned } = numberFragments(readFileSync(patchPath, 'utf8'), fragments);
  assertNumbered(source, assigned);
  writeFileSync(patchPath, source);
  for (const a of assigned) unlinkSync(join(root, ...a.path.split('/')));
  return { assigned };
}

// ---------------------------------------------------------------- CLI

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv = process.argv.slice(2), { out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`) } = {}) {
  const cmd = argv[0];
  if (cmd === 'check') {
    const require = createRequire(import.meta.url);
    const guard = require('./check-patch-notes-version.js');
    const newEntryChecks = Object.entries(guard).filter(([name, fn]) => /^missing[A-Z]/.test(name) && typeof fn === 'function');
    const { fragments, errors } = await validatePendingDir(ROOT, { newEntryChecks });
    for (const e of errors) err(`patch-notes-number: ${e}`);
    out(`patch-notes-number: ${fragments.length} gyldige ventende fragment(er), ${errors.length} fejl.`);
    return errors.length ? 1 : 0;
  }
  if (cmd === 'plan') {
    const ref = argValue(argv, '--ref') ?? 'HEAD';
    const git = defaultGit();
    const plan = planFromGit({ git, ref });
    for (const s of plan.skipped) err(`patch-notes-number: ${s}`);
    if (!plan.fragments.length) { out('patch-notes-number: ingen ventende fragmenter.'); return 0; }
    const { assigned } = numberFragments(String(git(['show', `${ref}:${PATCH_FILE}`])), plan.fragments);
    for (const a of assigned) out(`${a.version} (${a.date}) <- ${a.path}`);
    return 0;
  }
  if (cmd === 'local') {
    const { assigned } = numberLocal();
    if (!assigned.length) { out('patch-notes-number: ingen ventende fragmenter.'); return 0; }
    for (const a of assigned) out(`${a.version} (${a.date}) <- ${a.path}`);
    out(`patch-notes-number: ${PATCH_FILE} opdateret og ${assigned.length} fragment(er) slettet i arbejdstraeet (intet committet).`);
    return 0;
  }
  if (cmd === 'push') {
    const lines = numberPendingOnMain({ repo: argValue(argv, '--repo') ?? DEFAULT_REPO, dryRun: argv.includes('--dry-run') });
    for (const l of lines) out(l);
    return 0;
  }
  err('Brug: node scripts/patch-notes-number.mjs check | plan [--ref <ref>] | local | push [--repo o/n] [--dry-run]');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`patch-notes-number: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  }
}
