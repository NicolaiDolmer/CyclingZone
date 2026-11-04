import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  BASELINE_FILES,
  EXIT,
  FRONTEND_BASELINE,
  TS_CORE_BASELINE,
  classifyConflicts,
  compareFrontendBaselines,
  compareTsCoreBaselines,
  parseArgs,
  parseMergeTreeConflicts,
  resolveBaselineConflict,
  testsForChangedFiles,
} from './merge-queue-baseline-resolve.mjs';

// #7628: merge-koeen loeser selv en konflikt der KUN ligger i TS-baseline-filerne.
// Al I/O injiceres, saa testene hverken roerer git, gh eller filsystemet.

const HEAD = 'a'.repeat(40);
const MAIN = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const MERGED = 'd'.repeat(40);
const ROOT = path.join(path.sep, 'repo');
const TMP = path.join(path.sep, 'tmp');

const tsBaseline = (js, errors) => ({
  areas: { economy: { globs: ['lib/economy*'], jsFileCount: js, tsErrorCount: errors, files: { 'lib/economyEngine.js': errors } } },
  totals: { jsFileCount: js, tsErrorCount: errors },
});

/**
 * Simuleret verden: PR-tilstand, konflikt-filer, PR'ens aendrede filer og hvad
 * --update-baseline skriver. Hvert kald logges i `calls` (i raekkefoelge).
 */
function world({
  conflicts = [TS_CORE_BASELINE],
  mergeable = 'CONFLICTING',
  fetchedHead = HEAD,
  changed = ['backend/lib/economyEngine.ts', 'backend/lib/economyEngine.js'],
  tree = ['backend/lib/economyEngine.ts', 'backend/lib/economyEngine.test.js'],
  mainTs = tsBaseline(3, 10),
  nextTs = tsBaseline(2, 8),
  mainFe = { '../backend/lib/a.js': { TS2339: 4 } },
  nextFe = { '../backend/lib/a.js': { TS2339: 3 } },
  unlinkFails = false,
} = {}) {
  const calls = [];
  const files = new Map();
  const links = new Set();
  const resolved = new Set();
  let wt = null;
  const rel = (p) => (wt ? path.relative(wt, p).replaceAll('\\', '/') : null);
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });

  const git = (args, opts = {}) => {
    calls.push({ tool: 'git', args, cwd: opts.cwd ?? ROOT });
    const [cmd] = args;
    if (cmd === 'fetch') return ok();
    if (cmd === 'rev-parse' && args[1] === 'FETCH_HEAD') return ok(`${fetchedHead}\n`);
    if (cmd === 'rev-parse' && args[1] === 'refs/remotes/origin/main') return ok(`${MAIN}\n`);
    if (cmd === 'rev-parse' && args[1] === 'HEAD') return ok(`${MERGED}\n`);
    if (cmd === 'merge-tree') return { status: conflicts.length ? 1 : 0, stdout: `${'e'.repeat(40)}\n${conflicts.join('\n')}\n`, stderr: '' };
    if (cmd === 'merge-base') return ok(`${BASE}\n`);
    if (cmd === 'diff' && args.includes('--diff-filter=U')) return ok(conflicts.filter((f) => !resolved.has(f)).join('\n'));
    if (cmd === 'diff' && args[1] === '--name-only' && args[2]?.includes('..')) return ok(changed.join('\n'));
    if (cmd === 'diff') return ok('');
    if (cmd === 'ls-tree') return ok(tree.join('\n'));
    if (cmd === 'worktree' && args[1] === 'add') { wt = args[4]; return ok(); }
    if (cmd === 'merge') return { status: 1, stdout: 'CONFLICT', stderr: '' };
    if (cmd === 'checkout') return ok();
    if (cmd === 'add') { resolved.add(args[2]); return ok(); }
    if (cmd === 'show' && args[1].endsWith(TS_CORE_BASELINE)) return ok(JSON.stringify(mainTs));
    if (cmd === 'show' && args[1].endsWith(FRONTEND_BASELINE)) return ok(JSON.stringify(mainFe));
    if (cmd === 'commit' || cmd === 'push' || cmd === 'worktree' || cmd === 'branch') return ok();
    throw new Error(`uventet git-kald: ${args.join(' ')}`);
  };
  const gh = (args) => {
    calls.push({ tool: 'gh', args });
    if (args[0] === 'pr' && args[1] === 'view') {
      return ok(JSON.stringify({ state: 'OPEN', baseRefName: 'main', headRefName: 'feat/x', headRefOid: HEAD, isCrossRepository: false, mergeable }));
    }
    if (args[0] === 'pr' && args[1] === 'comment') return ok();
    throw new Error(`uventet gh-kald: ${args.join(' ')}`);
  };
  const node = (args, opts = {}) => {
    calls.push({ tool: 'node', args, cwd: opts.cwd });
    if (args[0] === 'scripts/check-ts-core-ratchet.mjs' && args[1] === '--update-baseline') {
      files.set(TS_CORE_BASELINE, JSON.stringify(nextTs));
    }
    if (args[0] === 'scripts/ci/typecheck-baseline.mjs' && args[1] === '--update') {
      files.set(FRONTEND_BASELINE, JSON.stringify(nextFe));
    }
    return ok();
  };
  const bash = (args) => { calls.push({ tool: 'bash', args }); return ok(); };
  const fs = {
    exists: (p) => {
      if (p.endsWith('node_modules')) return p.startsWith(ROOT) || links.has(p);
      const r = rel(p);
      return r !== null && tree.includes(r);
    },
    readFile: (p) => files.get(rel(p)),
    writeFile: (p, text) => { calls.push({ tool: 'writeFile', p }); files.set(p, text); },
    mkdtemp: (prefix) => { calls.push({ tool: 'mkdtemp' }); return `${prefix}x`; },
    realpath: (p) => p,
    junction: (target, p) => { calls.push({ tool: 'junction', p }); links.add(p); },
    isLink: (p) => links.has(p),
    unlink: (p) => { calls.push({ tool: 'unlink', p }); if (!unlinkFails) links.delete(p); },
    removeTempDir: () => { calls.push({ tool: 'rmtemp' }); },
  };
  const deps = { repoRoot: ROOT, git, gh, node, bash, fs, tmpRoot: TMP, now: () => 1, log: () => {} };
  return { deps, calls, links };
}

const has = (calls, tool, pred = () => true) => calls.some((c) => c.tool === tool && pred(c.args ?? [], c));
const index = (calls, tool, pred = () => true) => calls.findIndex((c) => c.tool === tool && pred(c.args ?? [], c));
const MUTATIONS = (calls) => ({
  worktree: has(calls, 'git', (a) => a[0] === 'worktree'),
  commit: has(calls, 'git', (a) => a[0] === 'commit'),
  push: has(calls, 'git', (a) => a[0] === 'push'),
  comment: has(calls, 'gh', (a) => a[1] === 'comment'),
});

test('kun-baseline-konflikt loeses: main\'s baseline, genberegning, gate, tests, guard, push uden force, @codex review', () => {
  const { deps, calls, links } = world();
  const res = resolveBaselineConflict({ pr: 7001, repo: 'o/r' }, deps);
  assert.equal(res.code, EXIT.RESOLVED, res.lines.join('\n'));

  assert.ok(has(calls, 'git', (a) => a[0] === 'checkout' && a[1] === '--theirs' && a[3] === TS_CORE_BASELINE), 'tager main\'s version');
  const update = index(calls, 'node', (a) => a[0] === 'scripts/check-ts-core-ratchet.mjs' && a[1] === '--update-baseline');
  const gate = index(calls, 'node', (a) => a[0] === 'scripts/check-ts-core-ratchet.mjs' && a.length === 1);
  const tests = index(calls, 'node', (a) => a[0] === '--test');
  const guard = index(calls, 'bash', (a) => a[0].endsWith('guard-commit-branch.sh'));
  const commit = index(calls, 'git', (a) => a[0] === 'commit');
  const push = index(calls, 'git', (a) => a[0] === 'push');
  assert.ok(update >= 0 && update < gate && gate < tests && tests < guard && guard < commit && commit < push, 'raekkefoelge');

  const testCall = calls[tests];
  assert.deepEqual(testCall.args, ['--test', '--import', './test-setup.js', 'lib/economyEngine.test.js']);
  assert.ok(testCall.cwd.endsWith('backend'), 'backend-tests koerer i backend/');

  const pushArgs = calls[push].args;
  assert.deepEqual(pushArgs, ['push', 'origin', 'HEAD:refs/heads/feat/x']);
  assert.ok(!pushArgs.some((a) => /^(-f|--force.*)$/.test(a) || a.startsWith('+')), 'aldrig force');

  const guardArgs = calls[guard].args;
  assert.match(guardArgs[1], /^mq-baseline\/pr-7001-/, 'guarden faar den midlertidige branch');
  assert.ok(has(calls, 'gh', (a) => a[1] === 'comment' && a.at(-1).startsWith('@codex review')));

  // Oprydning: junctions ikke-rekursivt FOER worktree remove, derefter temp-branch.
  const lastUnlink = calls.map((c) => c.tool).lastIndexOf('unlink');
  const remove = index(calls, 'git', (a) => a[0] === 'worktree' && a[1] === 'remove');
  assert.ok(lastUnlink >= 0 && lastUnlink < remove, 'junctions fjernes foer git worktree remove');
  assert.ok(has(calls, 'git', (a) => a[0] === 'branch' && a[1] === '-D' && a[2].startsWith('mq-baseline/')));
  assert.equal(links.size, 0);
});

test('baseline der stiger stopper: ingen commit, push eller kommentar, men worktreet ryddes op', () => {
  const { deps, calls } = world({ nextTs: tsBaseline(4, 10) });
  const res = resolveBaselineConflict({ pr: 7002, repo: 'o/r' }, deps);
  assert.equal(res.code, EXIT.STOPPED);
  assert.match(res.lines.join('\n'), /hoejere end main's/);
  const m = MUTATIONS(calls);
  assert.equal(m.commit, false);
  assert.equal(m.push, false);
  assert.equal(m.comment, false);
  assert.ok(has(calls, 'git', (a) => a[0] === 'worktree' && a[1] === 'remove'), 'oprydning ogsaa ved STOP');
});

test('frontend-baseline der stiger stopper ogsaa', () => {
  const { deps, calls } = world({ conflicts: [FRONTEND_BASELINE], nextFe: { '../backend/lib/a.js': { TS2339: 5 } } });
  const res = resolveBaselineConflict({ pr: 7003, repo: 'o/r' }, deps);
  assert.equal(res.code, EXIT.STOPPED);
  assert.equal(MUTATIONS(calls).push, false);
  assert.ok(has(calls, 'node', (a) => a[0] === 'scripts/ci/typecheck-baseline.mjs' && a[1] === '--update'));
});

test('begge baseline-filer i konflikt: begge genberegnes, og begge gates koerer', () => {
  const { deps, calls } = world({ conflicts: [...BASELINE_FILES] });
  const res = resolveBaselineConflict({ pr: 7004, repo: 'o/r' }, deps);
  assert.equal(res.code, EXIT.RESOLVED, res.lines.join('\n'));
  assert.ok(has(calls, 'node', (a) => a[0] === 'scripts/ci/typecheck-baseline.mjs' && a.length === 1), 'frontend-gaten');
  assert.ok(has(calls, 'git', (a) => a[0] === 'checkout' && a[3] === FRONTEND_BASELINE));
});

test('konflikt i en anden fil stopper: intet worktree, ingen push (uaendret koe-adfaerd)', () => {
  const { deps, calls } = world({ conflicts: [TS_CORE_BASELINE, 'backend/lib/economyEngine.js'] });
  const res = resolveBaselineConflict({ pr: 7005, repo: 'o/r' }, deps);
  assert.equal(res.code, EXIT.NOT_ELIGIBLE);
  assert.match(res.lines.join('\n'), /backend\/lib\/economyEngine\.js/);
  assert.deepEqual(MUTATIONS(calls), { worktree: false, commit: false, push: false, comment: false });
});

test('dry-run skriver intet: intet worktree, ingen junction, fil, commit, push eller kommentar', () => {
  const { deps, calls } = world();
  const res = resolveBaselineConflict({ pr: 7006, repo: 'o/r', dryRun: true }, deps);
  assert.equal(res.code, EXIT.RESOLVED);
  assert.deepEqual(MUTATIONS(calls), { worktree: false, commit: false, push: false, comment: false });
  for (const tool of ['junction', 'writeFile', 'mkdtemp', 'bash']) assert.equal(has(calls, tool), false, tool);
  assert.equal(has(calls, 'node'), false, 'hverken gate eller tests koeres');
  const text = res.lines.join('\n');
  assert.match(text, /\[dry-run\].*ville/);
  assert.match(text, /lib\/economyEngine\.test\.js/, 'viser hvilke tests der ville koere');
});

test('ingen konflikt eller ikke-CONFLICTING PR: intet at loese', () => {
  const a = world({ mergeable: 'MERGEABLE' });
  assert.equal(resolveBaselineConflict({ pr: 7007, repo: 'o/r' }, a.deps).code, EXIT.NOTHING);
  assert.equal(has(a.calls, 'git'), false, 'ingen fetch');
  const b = world({ conflicts: [] });
  assert.equal(resolveBaselineConflict({ pr: 7008, repo: 'o/r' }, b.deps).code, EXIT.NOTHING);
  assert.equal(MUTATIONS(b.calls).worktree, false);
});

test('PR-hovedet flyttede sig under laesningen: STOP foer noget oprettes', () => {
  const { deps, calls } = world({ fetchedHead: 'f'.repeat(40) });
  assert.equal(resolveBaselineConflict({ pr: 7009, repo: 'o/r' }, deps).code, EXIT.STOPPED);
  assert.equal(MUTATIONS(calls).worktree, false);
});

test('kan en junction ikke fjernes, fjernes worktreet IKKE (ingen rekursiv sletning gennem linket)', () => {
  const { deps, calls } = world({ unlinkFails: true });
  const res = resolveBaselineConflict({ pr: 7010, repo: 'o/r' }, deps);
  assert.match(res.lines.join('\n'), /ADVARSEL: kunne ikke fjerne en node_modules-junction/);
  assert.equal(has(calls, 'git', (a) => a[0] === 'worktree' && a[1] === 'remove'), false);
  assert.equal(has(calls, 'rmtemp'), false);
});

test('rene hjaelpere: merge-tree-parsning, klassifikation, sammenligning, test-udvaelgelse, argumenter', () => {
  assert.deepEqual(parseMergeTreeConflicts(`tree\r\n${TS_CORE_BASELINE}\r\n${TS_CORE_BASELINE}\r\n`), [TS_CORE_BASELINE]);
  assert.deepEqual(classifyConflicts([]).eligible, false, 'tom liste er ikke en baseline-konflikt');
  assert.equal(classifyConflicts([FRONTEND_BASELINE]).eligible, true);
  assert.equal(classifyConflicts([FRONTEND_BASELINE, 'docs/NOW.md']).eligible, false);

  assert.equal(compareTsCoreBaselines(tsBaseline(3, 10), tsBaseline(3, 10)).ok, true, 'lig er ok');
  assert.equal(compareTsCoreBaselines(tsBaseline(3, 10), tsBaseline(3, 11)).ok, false);
  const newArea = { areas: { ...tsBaseline(1, 1).areas, scheduler: { globs: ['lib/s*'], jsFileCount: 0, tsErrorCount: 0, files: {} } }, totals: { jsFileCount: 1, tsErrorCount: 1 } };
  assert.equal(compareTsCoreBaselines(tsBaseline(3, 10), newArea).ok, false, 'ukendt omraade = fail closed');

  assert.equal(compareFrontendBaselines({ f: { TS1: 2 } }, { f: { TS1: 1 } }).ok, true);
  assert.equal(compareFrontendBaselines({ f: { TS1: 2 } }, { f: { TS1: 1, TS2: 1 } }).ok, false, 'ny kode i en fil');

  const tree = new Set(['backend/lib/x.test.js', 'frontend/src/lib/y.test.js', 'scripts/z.test.mjs', 'backend/lib/w.test.ts']);
  assert.deepEqual(
    testsForChangedFiles(['backend/lib/x.ts', 'frontend/src/lib/y.js', 'scripts/z.test.mjs', 'docs/a.md', 'backend/lib/w.js'], (f) => tree.has(f)),
    [
      { pkg: 'backend', args: ['--test', '--import', './test-setup.js', 'lib/w.test.ts', 'lib/x.test.js'] },
      { pkg: 'frontend', args: ['--test', 'src/lib/y.test.js'] },
      { pkg: '', args: ['--test', 'scripts/z.test.mjs'] },
    ],
  );

  assert.deepEqual(parseArgs(['--pr', '12', '--repo', 'o/r', '--dry-run']), { pr: 12, repo: 'o/r', dryRun: true });
  assert.throws(() => parseArgs(['--pr', 'x']));
  assert.throws(() => parseArgs(['--pr', '1', '--force']));
});

test('merge-queue.ps1 kalder modulet kun ved CONFLICTING, sender -DryRun videre og lader ventelogikken overtage', () => {
  const source = readFileSync(new URL('./merge-queue.ps1', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const block = source.match(/# #7628:[^\n]*\n(?:  [^\n]*\n){4}/);
  assert.ok(block, 'koblingsblokken findes');
  assert.match(block[0], /\$fresh\.mergeable -eq 'CONFLICTING' -and -not \$script:updated\.ContainsKey\("\$n"\)/);
  assert.match(block[0], /merge-queue-baseline-resolve\.mjs'\) --pr "\$n" --repo \$Repo @\(if \(\$DryRun\) \{ '--dry-run' \}\)/);
  // Loest: markeres som opdateret (ingen update-branch oven i) og laeses frisk, saa den
  // eksisterende klar-foerst/Wait-PrGreen-logik venter paa groen CI + review-gate.
  assert.match(block[0], /if \(\$LASTEXITCODE -eq 0 -and -not \$DryRun\) \{ \$script:updated\["\$n"\] = \$true; \$fresh = Get-PrPlanEntry \$n \}/);
  const after = source.slice(source.indexOf(block[0]) + block[0].length);
  assert.match(after, /^  if \(\$fresh\.checksExit -ne 0 -and -not \$StopOnRedPr -and -not \$DryRun\) \{/, 'lige foer den eksisterende vent/SKIP-logik');
});
