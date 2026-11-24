// Tests for scripts/patch-notes-number.mjs (#8346): fragmenter pr. PR, nummer ved merge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PATCH_FILE,
  PENDING_DIR,
  validateFragment,
  validatePendingDir,
  numberFragments,
  assertNumbered,
  parsePatchesSource,
  bumpVersion,
  copenhagenDay,
  planFromGit,
  numberPendingOnMain,
  numberLocal,
  defaultGit,
  isPendingFragmentPath,
  commitMessage,
  isNumberingCommit,
  NUMBERED_SHA_RE,
  numberedShaLine,
} from './patch-notes-number.mjs';

const require = createRequire(import.meta.url);

const change = (over = {}) => ({
  category: 'fixed',
  audience: 'player',
  rollout: 'live',
  topic: 'Calendar',
  area: 'races',
  en: { title: 'Each race once', body: 'The calendar shows each race once.' },
  da: { title: 'Hvert løb én gang', body: 'Kalenderen viser hvert løb én gang.' },
  refs: [5841],
  ...over,
});
const fragmentText = (over = {}) => JSON.stringify({ changes: [change(over)] }, null, 2);

const BASE = `export const PATCHES = [
{
  "version": "7.456",
  "date": "2026-11-16",
  "changes": [
    {
      "category": "improved",
      "audience": "player",
      "rollout": "live",
      "en": { "title": "Old", "body": "Old note." },
      "refs": [8069]
    }
  ]
},
{
  "version": "7.455",
  "date": "2026-11-15",
  "changes": []
}
];
`;

// ---------------------------------------------------------------- validering

test('validateFragment: et gyldigt fragment giver data og ingen fejl', () => {
  const res = validateFragment('5841-each-race-once.json', fragmentText());
  assert.deepEqual(res.errors, []);
  assert.equal(res.data.changes.length, 1);
});

test('validateFragment: version og date gives ved merge og afvises i fragmentet', () => {
  const res = validateFragment('5841-x-y.json', JSON.stringify({ version: '7.457', date: '2026-11-17', changes: [change()] }));
  assert.equal(res.data, null);
  assert.ok(res.errors.some((e) => e.includes('"version"')));
  assert.ok(res.errors.some((e) => e.includes('"date"')));
});

test('validateFragment: filnavn, JSON, felter, sprog, laek og refs', () => {
  assert.ok(validateFragment('Bad Name.json', fragmentText()).errors.some((e) => e.includes('filnavnet')));
  assert.ok(validateFragment('8346-x-y.json', '{ not json').errors.some((e) => e.includes('ugyldig JSON')));
  assert.ok(validateFragment('8346-x-y.json', '[]').errors.some((e) => e.includes('JSON-objekt')));
  assert.ok(validateFragment('8346-x-y.json', JSON.stringify({ changes: [] })).errors.some((e) => e.includes('ikke-tom')));
  assert.ok(validateFragment('8346-x-y.json', JSON.stringify({ changes: [change()], extra: 1 })).errors.some((e) => e.includes('ukendt felt "extra"')));
  assert.ok(validateFragment('8346-x-y.json', fragmentText({ category: 'added' })).errors.some((e) => e.includes('category')));
  assert.ok(validateFragment('8346-x-y.json', fragmentText({ audience: 'everyone' })).errors.some((e) => e.includes('audience')));
  assert.ok(validateFragment('8346-x-y.json', fragmentText({ en: { title: '', body: 'x' } })).errors.some((e) => e.includes('en.title')));
  assert.ok(validateFragment('8346-x-y.json', fragmentText({ en: undefined, da: undefined })).errors.some((e) => e.includes('mindst eet sprog')));
  assert.ok(validateFragment('8346-x-y.json', fragmentText({ en: { title: 't', body: 'Runs scripts/foo.mjs' } })).errors.some((e) => e.includes('interne signaler')));
  assert.ok(validateFragment('8346-x-y.json', fragmentText({ refs: ['8346'] })).errors.some((e) => e.includes('refs')));
  // Datatesten paa main afviser enhver anden stage end beta; fragmentet maa ikke slippe forbi.
  assert.ok(validateFragment('8346-x-y.json', fragmentText({ stage: 'preview' })).errors.some((e) => e.includes('stage')));
  assert.deepEqual(validateFragment('8346-x-y.json', fragmentText({ stage: 'beta' })).errors, []);
  // En intern note maa gerne naevne interne stier.
  assert.deepEqual(validateFragment('8346-x-y.json', fragmentText({ audience: 'internal', en: { title: 't', body: 'scripts/foo.mjs' } })).errors, []);
});

test('isPendingFragmentPath: kun json direkte i pending/', () => {
  assert.equal(isPendingFragmentPath(`${PENDING_DIR}/8346-x.json`), true);
  assert.equal(isPendingFragmentPath(`${PENDING_DIR}/.gitkeep`), false);
  assert.equal(isPendingFragmentPath('frontend/src/data/patch-notes/README.md'), false);
  assert.equal(isPendingFragmentPath(PATCH_FILE), false);
});

function tempRepoDir() {
  return mkdtempSync(join(tmpdir(), 'cz-pn-test-'));
}

function writeFragment(root, name, text) {
  const dir = join(root, ...PENDING_DIR.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), text);
}

test('validatePendingDir: versionsvagtens missing*-regler, em-dash og doede termer rammer fragmenter', async () => {
  const root = tempRepoDir();
  try {
    writeFragment(root, '1001-good-note.json', fragmentText());
    writeFragment(root, '1002-no-rollout.json', fragmentText({ rollout: undefined }));
    writeFragment(root, '1003-beta-no-flag.json', fragmentText({ rollout: 'beta' }));
    writeFragment(root, '1004-em-dash.json', fragmentText({ en: { title: 'A — B', body: 'Body.' } }));
    writeFragment(root, '1005-dead-term.json', fragmentText({ en: { title: 'Patron perks', body: 'Body.' } }));
    const guard = require('./check-patch-notes-version.js');
    const newEntryChecks = Object.entries(guard).filter(([name, fn]) => /^missing[A-Z]/.test(name) && typeof fn === 'function');
    assert.ok(newEntryChecks.length >= 2, 'versionsvagten eksporterer missingRollout og missingFlag');
    const { fragments, errors } = await validatePendingDir(root, { newEntryChecks });
    assert.equal(fragments.length, 5);
    assert.ok(errors.some((e) => e.startsWith('1002-no-rollout.json: fejler missingRollout')), errors.join('\n'));
    assert.ok(errors.some((e) => e.startsWith('1003-beta-no-flag.json: fejler missingFlag')), errors.join('\n'));
    assert.ok(errors.some((e) => e.startsWith('em-dash:') && e.includes('1004-em-dash.json')), errors.join('\n'));
    assert.ok(errors.some((e) => e.startsWith('doed produktterm:') && e.includes('1005-dead-term.json')), errors.join('\n'));
    assert.ok(!errors.some((e) => e.includes('1001-good-note.json')), errors.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validatePendingDir: tom eller manglende mappe er ok', async () => {
  const root = tempRepoDir();
  try {
    assert.deepEqual(await validatePendingDir(root), { fragments: [], errors: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- nummerering

test('numberFragments: merge-raekkefoelge giver stigende numre, nyeste oeverst, intet andet roeres', () => {
  const frag = (path, order, date) => ({ path: `${PENDING_DIR}/${path}`, order, date, data: JSON.parse(fragmentText({ refs: [order + 2000] })) });
  const { source, assigned } = numberFragments(BASE, [frag('b-second.json', -1, '2026-11-17'), frag('a-first.json', -5, '2026-11-16')]);
  assert.deepEqual(assigned.map((a) => [a.path.split('/').at(-1), a.version, a.date]), [
    ['a-first.json', '7.457', '2026-11-16'],
    ['b-second.json', '7.458', '2026-11-17'],
  ]);
  assert.ok(source.startsWith('export const PATCHES = [\n{\n  "version": "7.458",\n  "date": "2026-11-17",\n  "changes": ['));
  assert.ok(source.endsWith(BASE.slice('export const PATCHES = [\n'.length)), 'eksisterende poster er byte-identiske');
  const patches = parsePatchesSource(source);
  assert.deepEqual(patches.map((p) => p.version), ['7.458', '7.457', '7.456', '7.455']);
  assert.equal(patches[1].changes[0].refs[0], 1995);
  assert.equal(assertNumbered(source, assigned), 4);
});

test('numberFragments: samme commit sorteres paa filnavn, label bevares, CRLF bevares', () => {
  const crlf = BASE.replace(/\n/g, '\r\n');
  const data = { label: 'Season start', changes: [change()] };
  const { source, assigned } = numberFragments(crlf, [
    { path: `${PENDING_DIR}/zz.json`, order: 0, date: '2026-11-17', data },
    { path: `${PENDING_DIR}/aa.json`, order: 0, date: '2026-11-17', data },
  ]);
  assert.deepEqual(assigned.map((a) => a.path.split('/').at(-1)), ['aa.json', 'zz.json']);
  assert.ok(!/[^\r]\n/.test(source), 'kun CRLF');
  assert.equal(parsePatchesSource(source)[0].label, 'Season start');
});

test('numberFragments: ingen fragmenter = uaendret; forkert header kaster', () => {
  assert.deepEqual(numberFragments(BASE, []), { source: BASE, assigned: [] });
  assert.throws(() => numberFragments('export default [];\n', [{ path: 'x', order: 0, date: 'd', data: { changes: [] } }]), /starter ikke med/);
});

test('bumpVersion og copenhagenDay', () => {
  assert.equal(bumpVersion('7.456'), '7.457');
  assert.equal(bumpVersion('7.999'), '7.1000');
  assert.equal(copenhagenDay('2026-11-16T23:30:00Z'), '2026-11-17');
  assert.equal(copenhagenDay('2026-07-01T21:59:00Z'), '2026-07-01');
});

test('assertNumbered: fanger dubletter og forkert raekkefoelge', () => {
  const dup = BASE.replace('"7.455"', '"7.456"');
  assert.throws(() => assertNumbered(dup, []), /dublet/);
  const wrong = BASE.replace('"7.455"', '"7.460"');
  assert.throws(() => assertNumbered(wrong, []), /faldende/);
});

test('commitMessage: interval og filer, ingen issue-links', () => {
  const msg = commitMessage([
    { path: `${PENDING_DIR}/a.json`, version: '7.457', date: '2026-11-16' },
    { path: `${PENDING_DIR}/b.json`, version: '7.458', date: '2026-11-17' },
  ]);
  assert.match(msg, /^chore\(patch-notes\): nummerer 2 ventende patch notes \(7\.457-7\.458\)/);
  assert.match(msg, /- 7\.457 \(2026-11-16\): a\.json/);
  assert.doesNotMatch(msg, /#\d/);
});

// ---------------------------------------------------------------- git-integration

function sh(cwd, args, env = {}) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  return res.stdout;
}

/** Et origin (bare) + en klon, med patchNotes.js og to fragmenter merget i hver sin commit. */
function setupRepos() {
  const base = tempRepoDir();
  const origin = join(base, 'origin.git');
  const work = join(base, 'work');
  sh(base, ['init', '--bare', '-b', 'main', origin]);
  sh(base, ['clone', '-q', origin, work]);
  for (const [k, v] of [['user.email', 'test@example.invalid'], ['user.name', 'test'], ['core.autocrlf', 'false'], ['core.hooksPath', '/dev/null'], ['commit.gpgsign', 'false']]) sh(work, ['config', k, v]);
  const commit = (msg, date) => sh(work, ['commit', '-q', '-m', msg], { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date });
  mkdirSync(join(work, 'frontend', 'src', 'data'), { recursive: true });
  writeFileSync(join(work, ...PATCH_FILE.split('/')), BASE);
  sh(work, ['add', '.']);
  commit('base', '2026-11-15T10:00:00Z');
  // Fragmentet med det "tidlige" navn merges SIDST: raekkefoelgen skal foelge merget, ikke navnet.
  writeFragment(work, '2000-merged-first.json', fragmentText({ refs: [2000] }));
  sh(work, ['add', '.']);
  commit('feat: A (#1)', '2026-11-16T22:30:00Z');
  writeFragment(work, '1000-merged-second.json', fragmentText({ refs: [1000] }));
  sh(work, ['add', '.']);
  commit('feat: B (#2)', '2026-11-17T09:00:00Z');
  sh(work, ['push', '-q', 'origin', 'main']);
  return { base, origin, work };
}

test('planFromGit: merge-raekkefoelge fra main-historikken og merge-dagen i Kobenhavn', () => {
  const { base, work } = setupRepos();
  try {
    const plan = planFromGit({ git: defaultGit(work), ref: 'HEAD' });
    assert.deepEqual(plan.skipped, []);
    const { assigned } = numberFragments(BASE, plan.fragments);
    assert.deepEqual(assigned.map((a) => [a.path.split('/').at(-1), a.version, a.date]), [
      ['2000-merged-first.json', '7.457', '2026-11-16'],
      ['1000-merged-second.json', '7.458', '2026-11-17'],
    ]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('planFromGit: et ugyldigt fragment springes over og meldes; resten nummereres', () => {
  const { base, work } = setupRepos();
  try {
    writeFragment(work, '3000-broken.json', '{ nope');
    sh(work, ['add', '.']);
    sh(work, ['commit', '-q', '-m', 'broken']);
    const plan = planFromGit({ git: defaultGit(work), ref: 'HEAD' });
    assert.equal(plan.fragments.length, 2);
    assert.equal(plan.skipped.length, 1);
    assert.match(plan.skipped[0], /3000-broken\.json springes over/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

/** Falsk gh: registrerer kald og svarer som GitHubs Git Data API. */
function fakeGh({ refFailures = 0 } = {}) {
  const calls = [];
  let failures = refFailures;
  const gh = (args) => {
    const input = args[args.indexOf('--input') + 1];
    const body = JSON.parse(readFileSync(input, 'utf8'));
    const endpoint = args[1];
    calls.push({ endpoint, method: args[args.indexOf('--method') + 1], body });
    if (endpoint.endsWith('/git/blobs')) return { status: 0, stdout: JSON.stringify({ sha: 'b'.repeat(40) }) };
    if (endpoint.endsWith('/git/trees')) return { status: 0, stdout: JSON.stringify({ sha: 't'.repeat(40) }) };
    if (endpoint.endsWith('/git/commits')) return { status: 0, stdout: JSON.stringify({ sha: 'c'.repeat(40) }) };
    if (endpoint.endsWith('/git/refs/heads/main')) {
      if (failures > 0) { failures -= 1; return { status: 1, stdout: '{"message":"Update is not a fast forward","status":"422"}', stderr: 'HTTP 422' }; }
      return { status: 0, stdout: JSON.stringify({ object: { sha: body.sha } }) };
    }
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  return { gh, calls };
}

test('numberPendingOnMain: eet commit via API oven paa origin/main, fragmenter slettet, ref uden force', () => {
  const { base, work } = setupRepos();
  try {
    const head = sh(work, ['rev-parse', 'origin/main']).trim();
    const { gh, calls } = fakeGh();
    const lines = numberPendingOnMain({ repo: 'o/r', git: defaultGit(work), gh });
    assert.match(lines.join('\n'), /2 fragment\(er\) nummereret paa main som cccccccc: 7\.457 <- 2000-merged-first\.json, 7\.458 <- 1000-merged-second\.json/);
    // Codex P1 (PR #8353): den nye SHA meldes som maskinlinje, saa merge-koeen kan verificere den.
    assert.equal(lines.at(-1), `PATCH-NOTES-SHA: ${'c'.repeat(40)}`);
    assert.equal(NUMBERED_SHA_RE.exec(lines.at(-1))?.[1], 'c'.repeat(40));
    assert.equal(lines.filter((l) => NUMBERED_SHA_RE.test(l)).length, 1);
    assert.deepEqual(calls.map((c) => c.endpoint), ['repos/o/r/git/blobs', 'repos/o/r/git/trees', 'repos/o/r/git/commits', 'repos/o/r/git/refs/heads/main']);
    const written = Buffer.from(calls[0].body.content, 'base64').toString('utf8');
    assert.deepEqual(parsePatchesSource(written).map((p) => p.version), ['7.458', '7.457', '7.456', '7.455']);
    assert.equal(calls[1].body.base_tree, sh(work, ['rev-parse', `${head}^{tree}`]).trim());
    assert.deepEqual(calls[1].body.tree.map((t) => [t.path, t.sha === null]), [
      [PATCH_FILE, false],
      [`${PENDING_DIR}/2000-merged-first.json`, true],
      [`${PENDING_DIR}/1000-merged-second.json`, true],
    ]);
    assert.deepEqual(calls[2].body.parents, [head]);
    assert.deepEqual(calls[3].body, { sha: 'c'.repeat(40), force: false });
    assert.equal(calls[3].method, 'PATCH');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('numberPendingOnMain: main flyttede sig = een ny runde; to gange = fejl til kalderen', () => {
  const { base, work } = setupRepos();
  try {
    const once = fakeGh({ refFailures: 1 });
    const lines = numberPendingOnMain({ repo: 'o/r', git: defaultGit(work), gh: once.gh });
    assert.ok(lines.some((l) => l.includes('proever igen')));
    assert.equal(once.calls.filter((c) => c.endpoint.endsWith('/refs/heads/main')).length, 2);
    const twice = fakeGh({ refFailures: 2 });
    assert.throws(() => numberPendingOnMain({ repo: 'o/r', git: defaultGit(work), gh: twice.gh }), /main kunne ikke opdateres/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('numberedShaLine: kun en fuld 40-hex SHA giver maskinlinjen', () => {
  assert.equal(numberedShaLine('d'.repeat(40)), `PATCH-NOTES-SHA: ${'d'.repeat(40)}`);
  assert.throws(() => numberedShaLine('abc'), /ugyldig commit-SHA/);
  assert.throws(() => numberedShaLine(undefined), /ugyldig commit-SHA/);
  assert.equal(NUMBERED_SHA_RE.test(`PATCH-NOTES-SHA: ${'d'.repeat(40)} ekstra`), false);
});

test('numberPendingOnMain: dry-run og intet at nummerere skriver intet', () => {
  const { base, work } = setupRepos();
  try {
    const dry = fakeGh();
    const lines = numberPendingOnMain({ repo: 'o/r', dryRun: true, git: defaultGit(work), gh: dry.gh });
    assert.match(lines[0], /^\[dry-run\] patch notes: ville nummerere 2 fragment/);
    assert.equal(dry.calls.length, 0);
    assert.ok(!lines.some((l) => NUMBERED_SHA_RE.test(l)), 'dry-run melder ingen SHA til koeen');
    sh(work, ['rm', '-q', '-r', PENDING_DIR]);
    sh(work, ['commit', '-q', '-m', 'numbered']);
    sh(work, ['push', '-q', 'origin', 'main']);
    const none = fakeGh();
    assert.deepEqual(numberPendingOnMain({ repo: 'o/r', git: defaultGit(work), gh: none.gh }), ['patch notes: ingen ventende fragmenter paa main.']);
    assert.equal(none.calls.length, 0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('numberLocal: nummerer i arbejdstraeet og sletter fragmenterne (intet commit)', () => {
  const { base, work } = setupRepos();
  try {
    const before = sh(work, ['rev-parse', 'HEAD']).trim();
    const { assigned } = numberLocal({ root: work, git: defaultGit(work) });
    assert.deepEqual(assigned.map((a) => a.version), ['7.457', '7.458']);
    assert.equal(existsSync(join(work, ...PENDING_DIR.split('/'), '2000-merged-first.json')), false);
    assert.equal(parsePatchesSource(readFileSync(join(work, ...PATCH_FILE.split('/')), 'utf8'))[0].version, '7.458');
    assert.equal(sh(work, ['rev-parse', 'HEAD']).trim(), before);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('den rigtige patchNotes.js kan nummereres: header, JSON-form og top-version', () => {
  const real = readFileSync(new URL('../frontend/src/data/patchNotes.js', import.meta.url), 'utf8');
  const before = parsePatchesSource(real);
  const { source, assigned } = numberFragments(real, [{ path: `${PENDING_DIR}/x.json`, order: 0, date: '2026-11-17', data: { changes: [change()] } }]);
  assert.equal(assigned[0].version, bumpVersion(before[0].version));
  assert.equal(assertNumbered(source, assigned), before.length + 1);
});

test('numbering-only requires the canonical data, deleted fragments and one pushed commit', () => {
  const before = 'a'.repeat(40);
  const after = 'b'.repeat(40);
  const path = PENDING_DIR + '/5841-each-race-once.json';
  const iso = '2026-11-17T10:00:00Z';
  const fragment = { path, data: JSON.parse(fragmentText()), date: '2026-11-17', order: 0 };
  const { source, assigned } = numberFragments(BASE, [fragment]);
  const expectedDiff = 'M\t' + PATCH_FILE + '\nD\t' + path + '\n';
  const expectedMessage = commitMessage(assigned);
  const verify = ({ parent = before, noteSource = source, diff = expectedDiff, message = expectedMessage, modeChange = '' } = {}) =>
    isNumberingCommit({ before, after, git(args) {
      const key = args.join(' ');
      const responses = new Map([
        ['show -s --format=%P ' + after, parent],
        ['show -s --format=%B ' + after, message + '\n'],
        ['show -s --format=%cI ' + after, iso],
        ['diff --name-status --no-renames ' + before + ' ' + after + ' --', diff],
        ['diff --summary ' + before + ' ' + after + ' -- ' + PATCH_FILE, modeChange],
        ['ls-tree --name-only ' + before + ' -- ' + PENDING_DIR + '/', path + '\n'],
        ['log --first-parent --diff-filter=A --name-only --format=@@%H %cI ' + before + ' -- ' + PENDING_DIR + '/', '@@' + before + ' ' + iso + '\n' + path + '\n'],
        ['show ' + before + ':' + path, fragmentText()],
        ['show ' + before + ':' + PATCH_FILE, BASE],
        ['show ' + after + ':' + PATCH_FILE, noteSource],
      ]);
      assert.ok(responses.has(key), key);
      return responses.get(key);
    } });
  assert.equal(verify(), true);
  assert.equal(verify({ parent: 'c'.repeat(40) }), false, 'push contains more than the numbering commit');
  assert.equal(verify({ parent: before + ' ' + 'c'.repeat(40) }), false, 'merge commit');
  assert.equal(verify({ diff: expectedDiff + 'M\tbackend/server.js\n' }), false, 'code changed too');
  assert.equal(verify({ diff: 'M\t' + PATCH_FILE + '\n' }), false, 'fragment left behind');
  assert.equal(verify({ modeChange: 'mode change 100644 => 100755 ' + PATCH_FILE }), false);
  assert.equal(verify({ noteSource: source.replace('each race once', 'a different note') }), false);
  assert.equal(verify({ message: expectedMessage.replace('7.457', '7.458') }), false);
});

test('main CI gates the heavy jobs on numbering proof and retains the patch notes data test', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const block = name => ci.split(new RegExp('^  ' + name + ':\\s*$', 'm'))[1]?.split(/^  [\w-]+:\s*$/m)[0];
  assert.match(block('patch-notes-mode'), /github\.event_name == 'push'/);
  assert.match(block('patch-notes-mode'), /verify-numbering --before "\$BEFORE_SHA" --after "\$AFTER_SHA"/);
  assert.match(block('patch-notes-numbering'), /needs\.patch-notes-mode\.outputs\.numbering_only == 'true'/);
  assert.match(block('patch-notes-numbering'), /node --test frontend\/src\/lib\/patchNotes\.test\.js/);
  assert.match(block('backend-changes'), /if \[\[ "\$NUMBERING_ONLY" == "true" \]\]; then\s+record "false"/);
  for (const job of ['frontend-build', 'build-determinism-two-builds', 'warning-budget', 'static-guards', 'ops-script-tests', 'migration-idempotency']) {
    assert.match(block(job), /needs: patch-notes-mode/);
    assert.match(block(job), /!cancelled\(\) && needs\.patch-notes-mode\.outputs\.numbering_only != 'true'/);
  }
});
