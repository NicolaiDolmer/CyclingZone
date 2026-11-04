// Tests for scripts/til-doers-proof.mjs (#7585 PR 3): runneren med injiceret
// gh, git, fetch og billedstation. Intet netvaerk, ingen browser, intet build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DUP_PROOF_BODY,
  LOCK_FILE,
  acquireLock,
  catchUpPrs,
  findDeployVerify,
  hasProof,
  interpretShot,
  main,
  makePrepareWorktree,
  makeStation,
  parseArgs,
  parseCatFileBatch,
  runProdChecks,
  runSideChecks,
  shotLabel,
  waitSelector,
} from './til-doers-proof.mjs';
import { proofMarker } from './lib/til-doers-proof.mjs';

const REPO = 'NicolaiDolmer/CyclingZone';
const SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const LATER = '1111111222222233333334444444555555566666';
const T0 = Date.parse('2026-11-04T10:00:00Z');

function tmp() {
  return mkdtempSync(join(tmpdir(), 'cz-tdp-test-'));
}

// ---------------------------------------------------------------- parseArgs

test('parseArgs: default er dry-run, --apply skriver, --dry-run vinder', () => {
  assert.equal(parseArgs(['run', '--pr', '7621,7634']).write, false);
  assert.deepEqual(parseArgs(['run', '--pr', '7621,#7634']).prs, [7621, 7634]);
  assert.equal(parseArgs(['run', '--pr=7621', '--apply']).write, true);
  assert.equal(parseArgs(['run', '--pr', '7621', '--apply', '--dry-run']).write, false);
  const c = parseArgs(['--catch-up', '--hours', '6']);
  assert.equal(c.catchUp, true);
  assert.equal(c.hours, 6);
  assert.equal(c.write, false);
});

test('parseArgs: afviser manglende tog, ugyldige tal og usikker prod-base', () => {
  assert.throws(() => parseArgs(['run']), /--pr/);
  assert.throws(() => parseArgs(['run', '--pr', 'x']), /ugyldigt PR/);
  assert.throws(() => parseArgs(['--catch-up', '--hours', '0']), /--hours/);
  assert.throws(() => parseArgs(['--catch-up', '--prod-base', 'http://example.com']), /https/);
  assert.throws(() => parseArgs(['--catch-up', '--prod-base', 'https://u:p@example.com']), /https/);
  assert.throws(() => parseArgs(['--catch-up', '--bogus']), /ukendt/);
  assert.equal(parseArgs(['--catch-up', '--prod-base', 'https://example.com/x']).prodBase, 'https://example.com');
});

// ---------------------------------------------------------------- lock

test('acquireLock: een koersel ad gangen, forladt lock overtages', () => {
  const dir = tmp();
  try {
    const file = join(dir, 'sub', LOCK_FILE);
    const a = acquireLock(file, { now: T0, pid: 101, isAlive: () => true });
    assert.equal(a.ok, true);
    const b = acquireLock(file, { now: T0 + 60_000, pid: 102, isAlive: () => true });
    assert.equal(b.ok, false);
    assert.match(b.reason, /anden koersel/);
    // Doed proces: overtages.
    const c = acquireLock(file, { now: T0 + 60_000, pid: 103, isAlive: (pid) => pid !== 101 });
    assert.equal(c.ok, true);
    // a's release roerer ikke c's lock.
    a.release();
    assert.equal(existsSync(file), true);
    c.release();
    assert.equal(existsSync(file), false);
    // For gammel: overtages, selv om processen lever.
    acquireLock(file, { now: T0, pid: 104, isAlive: () => true });
    const d = acquireLock(file, { now: T0 + 26 * 60_000, pid: 105, isAlive: () => true });
    assert.equal(d.ok, true);
    d.release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireLock (Codex): en tom lock er en koersel der starter, til fristen er gaaet', () => {
  const dir = tmp();
  try {
    const file = join(dir, LOCK_FILE);
    writeFileSync(file, '');
    // Codex P1: fast ur og fast filtid, aldrig vaeguret.
    const T = 1_790_000_000_000;
    utimesSync(file, T / 1000, T / 1000);
    const fresh = acquireLock(file, { now: T + 1_000, pid: 201, isAlive: () => true });
    assert.equal(fresh.ok, false);
    assert.match(fresh.reason, /ved at starte/);
    const old = acquireLock(file, { now: T + 2 * 60_000 + 1_000, pid: 202, isAlive: () => true });
    assert.equal(old.ok, true);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, 202);
    old.release();
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makePrepareWorktree (Codex): eget checkout, setup-worktree under verify-lock', () => {
  const dir = tmp();
  try {
    const wt = join(dir, 'wt');
    const gitCalls = [];
    const git = (args, o = {}) => {
      gitCalls.push({ args, cwd: o.cwd });
      if (args[0] === 'worktree' && args[1] === 'add') mkdirSync(wt, { recursive: true });
      if (args[0] === 'rev-parse') return `${wt}\n`;
      return '';
    };
    const runs = [];
    const run = (cmd, args, o) => {
      runs.push({ cmd, args, o });
      return { status: 0 };
    };
    const prepare = makePrepareWorktree({ git, stateDir: dir, run, env: {} });
    assert.equal(prepare(SHA, { timeoutMs: 300_000 }), wt);
    assert.deepEqual(gitCalls.map((c) => c.args.slice(0, 2).join(' ')), ['worktree prune', 'worktree add', 'rev-parse --show-toplevel', 'checkout --detach']);
    assert.equal(runs[0].cmd, 'pwsh');
    assert.ok(runs[0].args.some((a) => a.endsWith('verify-lock.ps1')));
    assert.ok(runs[0].args.some((a) => a.endsWith('setup-worktree.ps1')));
    assert.equal(runs[0].o.timeout, 300_000);

    // Holder koerslen allerede et slot, koeres setup direkte.
    const nested = makePrepareWorktree({ git, stateDir: dir, run, env: { CZ_VERIFY_LOCK_HELD_SLOT: 'x' } });
    nested(SHA);
    assert.ok(!runs[1].args.some((a) => a.endsWith('verify-lock.ps1')));

    // Et checkout der ikke er vores eget, roeres ikke.
    const foreign = makePrepareWorktree({ git: (args) => (args[0] === 'rev-parse' ? 'C:/Dev/CyclingZone\n' : ''), stateDir: dir, run, env: {} });
    assert.throws(() => foreign(SHA), /ikke runnerens eget checkout/);
    const failing = makePrepareWorktree({ git, stateDir: dir, run: () => ({ status: 1 }), env: {} });
    assert.throws(() => failing(SHA), /setup-worktree fejlede/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- git-hjælpere

test('parseCatFileBatch: indhold pr. sti, missing springes over, utf8-bytes tælles rigtigt', () => {
  const a = 'import X from "./X";\n';
  const b = 'const s = "Trup æøå";\n';
  const buf = Buffer.concat([
    Buffer.from(`oid1 blob ${Buffer.byteLength(a)}\n`), Buffer.from(a), Buffer.from('\n'),
    Buffer.from(`${SHA}:frontend/src/gone.js missing\n`),
    Buffer.from(`oid2 blob ${Buffer.byteLength(b)}\n`), Buffer.from(b), Buffer.from('\n'),
  ]);
  const out = parseCatFileBatch(buf, ['frontend/src/a.js', 'frontend/src/gone.js', 'frontend/src/b.js']);
  assert.equal(out.get('frontend/src/a.js'), a);
  assert.equal(out.has('frontend/src/gone.js'), false);
  assert.equal(out.get('frontend/src/b.js'), b);
});

// ---------------------------------------------------------------- Deploy verify

test('findDeployVerify: samme sha, senere sha der indeholder den, ellers status eller null', () => {
  const contains = (a, d) => a === SHA && d === LATER;
  const exactOk = [{ databaseId: 1, headSha: SHA, status: 'completed', conclusion: 'success', event: 'push', createdAt: '2026-11-04T10:00:00Z' }];
  assert.deepEqual(findDeployVerify({ runs: exactOk, sha: SHA, contains }), { conclusion: 'success', sha: SHA, containsMerge: false, runId: 1 });

  const batched = [
    { databaseId: 2, headSha: SHA, status: 'completed', conclusion: 'failure', event: 'push', createdAt: '2026-11-04T10:00:00Z' },
    { databaseId: 3, headSha: LATER, status: 'completed', conclusion: 'success', event: 'push', createdAt: '2026-11-04T10:30:00Z' },
  ];
  assert.deepEqual(findDeployVerify({ runs: batched, sha: SHA, contains }), { conclusion: 'success', sha: LATER, containsMerge: true, runId: 3 });

  const failed = [batched[0]];
  assert.equal(findDeployVerify({ runs: failed, sha: SHA, contains }).conclusion, 'failure');
  const running = [{ databaseId: 4, headSha: SHA, status: 'in_progress', conclusion: '', event: 'push', createdAt: '2026-11-04T10:00:00Z' }];
  assert.equal(findDeployVerify({ runs: running, sha: SHA, contains }).conclusion, 'in_progress');
  // En groen koersel paa en commit der IKKE indeholder merge-SHA'en taeller ikke.
  const other = [{ databaseId: 5, headSha: LATER, status: 'completed', conclusion: 'success', event: 'push', createdAt: '2026-11-04T10:00:00Z' }];
  assert.equal(findDeployVerify({ runs: other, sha: SHA, contains: () => false }), null);
  // workflow_dispatch: headSha er startref'en, ikke det verificerede commit (Codex).
  const dispatched = [{ databaseId: 6, headSha: SHA, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', createdAt: '2026-11-04T10:00:00Z' }];
  assert.equal(findDeployVerify({ runs: dispatched, sha: SHA, contains: () => true }), null);
});

// ---------------------------------------------------------------- prod-tjek

test('runProdChecks: relativ URL mod prod-base, kun GET, manual redirect, fejl og dubletter', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/down')) throw new Error('ECONNREFUSED');
    return { status: url.endsWith('/moved') ? 301 : 200 };
  };
  const checks = [
    { method: 'GET', url: '/api/health', status: 200 },
    { method: 'GET', url: '/api/health', status: 200 },
    { method: 'GET', url: 'https://cyclingzone.org/moved', status: 200 },
    { method: 'GET', url: '/down', status: 200 },
  ];
  const res = await runProdChecks({ checks, prodBase: 'https://cyclingzone.org', fetchImpl, deadline: T0 + 60_000, now: () => T0 });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://cyclingzone.org/api/health');
  for (const c of calls) {
    assert.equal(c.init.method, 'GET');
    assert.equal(c.init.redirect, 'manual');
    assert.equal(c.init.credentials, 'omit');
  }
  assert.deepEqual(res[0], { method: 'GET', url: '/api/health', status: 200 });
  assert.equal(res[1].status, 301);
  assert.match(res[2].error, /ECONNREFUSED/);
  const late = await runProdChecks({ checks: checks.slice(0, 1), prodBase: 'https://cyclingzone.org', fetchImpl, deadline: T0, now: () => T0 });
  assert.match(late[0].error, /tidsgrænsen/);
});

// ---------------------------------------------------------------- side-tjek

const SIDE_SEL = { path: '/team', kind: 'selector', value: '[data-testid="squad-table"]' };
const SIDE_TXT = { path: '/team', kind: 'tekst', value: 'Trup' };
const SIDE_OTHER = { path: '/riders', kind: 'selector', value: '.rider-list' };

function report({ label, createdAt = '2026-11-04T10:00:05.000Z', sha = SHA, dirty = false, routes = ['/team'], waits = [], mocks = [], stoppedAt = null }) {
  return {
    label,
    createdAt,
    git: { sha, dirty },
    shots: routes.map((route) => ({ route, width: 1440 })),
    waits,
    mocks,
    stoppedAt,
  };
}

test('waitSelector og shotLabel', () => {
  assert.equal(waitSelector(SIDE_SEL), '[data-testid="squad-table"]');
  assert.equal(waitSelector(SIDE_TXT), 'text=Trup');
  assert.equal(shotLabel({ pr: 7621, sha: SHA, path: '/team/stats' }), 'proof-pr7621-abcdef1-team-stats');
  assert.equal(shotLabel({ pr: 7621, sha: SHA, path: '/' }), 'proof-pr7621-abcdef1-root');
});

test('interpretShot: fundet, timeout = ikke fundet, anden fejl = kunne ikke køre', () => {
  const checks = [SIDE_SEL, SIDE_TXT];
  const ok = interpretShot({ checks, report: report({ label: 'x' }), exitCode: 0 });
  assert.equal(ok.loggedIn, true);
  assert.deepEqual(ok.results.map((r) => r.found), [true, true]);

  const waits = [
    { route: '/team', width: 1440, selector: 'text=Trup', error: 'Timeout 30000ms exceeded.' },
    { route: '/team', width: 1440, selector: '[data-testid="squad-table"]', error: 'Unexpected token "]" while parsing selector' },
  ];
  const mixed = interpretShot({ checks, report: report({ label: 'x', waits }), exitCode: 3 });
  assert.equal(mixed.results[0].found, undefined);
  assert.match(mixed.results[0].error, /Unexpected token/);
  assert.equal(mixed.results[1].found, false);

  const none = interpretShot({ checks, report: null, exitCode: 2 });
  assert.equal(none.loggedIn, false);
  assert.ok(none.results.every((r) => r.error));
  const crash = interpretShot({ checks, report: null, exitCode: 1 });
  assert.equal(crash.loggedIn, null);

  const stopped = interpretShot({ checks, report: report({ label: 'x', stoppedAt: '/team @ 1440' }), exitCode: 2 });
  assert.equal(stopped.loggedIn, false);
});

function sideDeps({ shots, prepare = () => 'C:/wt', outRoot = { dir: 'C:/OneDrive/x', private: true }, now = () => T0 }) {
  const calls = [];
  const station = (args) => {
    calls.push(args);
    const make = shots[calls.length - 1];
    return typeof make === 'function' ? make(args) : make;
  };
  return { calls, station, prepareWorktree: prepare, outRoot, deadline: T0 + 20 * 60_000, now };
}

test('runSideChecks: en serie pr. side, build kun første gang, billeder kun i OneDrive', () => {
  const d = sideDeps({
    shots: [
      (a) => ({ exitCode: 0, report: report({ label: a.label }) }),
      (a) => ({ exitCode: 0, report: report({ label: a.label, routes: ['/riders'] }) }),
    ],
  });
  const side = runSideChecks({ pr: 7621, sha: SHA, checks: [SIDE_SEL, SIDE_TXT, SIDE_OTHER], derived: ['/team'], ...d });
  assert.equal(d.calls.length, 2);
  assert.equal(d.calls[0].build, true);
  assert.equal(d.calls[1].build, false);
  assert.deepEqual(d.calls[0].selectors, ['[data-testid="squad-table"]', 'text=Trup']);
  assert.match(d.calls[0].outDir.replace(/\\/g, '/'), /^C:\/OneDrive\/x\/til-doers-proof$/);
  assert.equal(side.buildSha, SHA);
  assert.equal(side.loggedIn, true);
  assert.equal(side.mocks, false);
  assert.deepEqual(side.derived, ['/team']);
  assert.ok(side.results.every((r) => r.found === true));
});

test('runSideChecks: uden OneDrive, fejlende checkout og gammel rapport giver fejl, aldrig fund', () => {
  const noOneDrive = sideDeps({ shots: [], outRoot: { dir: 'C:/repo/pr-screens/live', private: false } });
  const a = runSideChecks({ pr: 1, sha: SHA, checks: [SIDE_SEL], derived: [], ...noOneDrive });
  assert.equal(noOneDrive.calls.length, 0);
  assert.match(a.results[0].error, /OneDrive/);

  const badWt = sideDeps({ shots: [], prepare: () => { throw new Error('worktree add fejlede'); } });
  const b = runSideChecks({ pr: 1, sha: SHA, checks: [SIDE_SEL], derived: [], ...badWt });
  assert.match(b.results[0].error, /build-checkoutet/);

  // En rapport fra en tidligere koersel (aeldre createdAt) taeller ikke.
  const stale = sideDeps({ shots: [(x) => ({ exitCode: 0, report: report({ label: x.label, createdAt: '2026-11-03T10:00:00.000Z' }) })] });
  const c = runSideChecks({ pr: 1, sha: SHA, checks: [SIDE_SEL], derived: [], ...stale });
  assert.ok(c.results[0].error);
  assert.equal(c.loggedIn, null);
});

test('runSideChecks (Codex P2): en gammel rapport fra et fejlet build giver ikke --no-build til naeste side', () => {
  const d = sideDeps({
    shots: [
      () => ({ exitCode: 1, report: report({ label: 'gammel-koersel' }) }),
      (a) => ({ exitCode: 0, report: report({ label: a.label, routes: ['/riders'] }) }),
    ],
  });
  runSideChecks({ pr: 7621, sha: SHA, checks: [SIDE_SEL, SIDE_OTHER], derived: ['/team'], ...d });
  assert.equal(d.calls.length, 2);
  assert.equal(d.calls[0].build, true);
  assert.equal(d.calls[1].build, true, 'buildet er ikke bevist koert, saa naeste side bygger selv');
});

test('runSideChecks: snavset checkout, andet build og mocks fanges', () => {
  const dirty = sideDeps({ shots: [(x) => ({ exitCode: 0, report: report({ label: x.label, dirty: true }) })] });
  assert.equal(runSideChecks({ pr: 1, sha: SHA, checks: [SIDE_SEL], derived: [], ...dirty }).buildSha, null);
  const mocked = sideDeps({ shots: [(x) => ({ exitCode: 0, report: report({ label: x.label, mocks: [{ path: '/api/me' }] }) })] });
  assert.equal(runSideChecks({ pr: 1, sha: SHA, checks: [SIDE_SEL], derived: [], ...mocked }).mocks, true);
  const loggedOut = sideDeps({ shots: [{ exitCode: 2, report: null }] });
  assert.equal(runSideChecks({ pr: 1, sha: SHA, checks: [SIDE_SEL], derived: [], ...loggedOut }).loggedIn, false);
});

test('makeStation: pr-shots under verify-lock, direkte når slottet allerede holdes; rapport læses', () => {
  const dir = tmp();
  try {
    const label = 'proof-pr1-abcdef1-team';
    const calls = [];
    const run = (cmd, args, o) => {
      calls.push({ cmd, args, o });
      return { status: 0 };
    };
    const station = makeStation({ run, env: {} });
    writeFileSync(join(dir, 'skip'), '');
    const none = station({ label, worktree: 'C:/wt', path: '/team', selectors: ['text=Trup'], build: true, outDir: dir, timeoutMs: 600_000 });
    assert.equal(none.report, null);
    assert.equal(calls[0].cmd, 'pwsh');
    assert.ok(calls[0].args.includes('-Max') && calls[0].args.includes('--'));
    assert.ok(calls[0].args.includes('--wait-for=text=Trup'));
    assert.ok(calls[0].args.includes('--widths=1440'));
    assert.ok(!calls[0].args.includes('--no-build'));
    assert.equal(calls[0].o.timeout, 600_000);

    const nested = makeStation({ run, env: { CZ_VERIFY_LOCK_HELD_SLOT: 'x' } });
    mkdirSync(join(dir, label), { recursive: true });
    writeFileSync(join(dir, label, 'report.json'), JSON.stringify({ label, createdAt: 'z' }));
    const got = nested({ label, worktree: 'C:/wt', path: '/team', selectors: [], build: false, outDir: dir, timeoutMs: 600_000 });
    assert.equal(calls[1].cmd, process.execPath);
    assert.ok(calls[1].args.includes('--no-build'));
    assert.equal(got.report.label, label);

    const busy = makeStation({ run: () => ({ status: 75 }), env: {} });
    assert.match(busy({ label, worktree: 'C:/wt', path: '/team', selectors: [], build: true, outDir: dir, timeoutMs: 1 }).error, /slot/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- hele koerslen

function decl(issue, lines) {
  return ['```til-doers-proof', `issue: ${issue}`, ...lines, '```'].join('\n');
}

function makeWorld({ pulls, issues, comments = {}, files = {}, prList = [] }) {
  const writes = [];
  const store = Object.fromEntries(Object.entries(comments).map(([k, v]) => [k, [...v]]));
  let nextId = 900;
  const execGh = (args, input) => {
    if (args[0] === 'api' && args[1] === '-X') {
      const [, , method, path] = args;
      writes.push({ method, path, body: JSON.parse(input).body });
      const m = /issues\/(\d+)\/comments$/.exec(path);
      if (method === 'POST' && m) {
        (store[m[1]] ||= []).push({ id: nextId++, body: JSON.parse(input).body, author_association: 'OWNER', created_at: '2026-11-04T10:05:00Z' });
      }
      const e = /issues\/comments\/(\d+)$/.exec(path);
      if (method === 'PATCH' && e) {
        for (const list of Object.values(store)) for (const c of list) if (String(c.id) === e[1]) c.body = JSON.parse(input).body;
      }
      return '{}';
    }
    if (args[0] === 'api' && args[1] === '--paginate') {
      const path = args[2];
      let m = /issues\/(\d+)\/comments/.exec(path);
      if (m) return (store[m[1]] || []).map((c) => JSON.stringify(c)).join('\n');
      m = /pulls\/(\d+)\/files/.exec(path);
      if (m) return (files[m[1]] || []).map((f) => JSON.stringify({ filename: f })).join('\n');
      throw new Error(`ukendt paged ${path}`);
    }
    if (args[0] === 'api') {
      const path = args[1];
      let m = new RegExp(`^repos/${REPO}/pulls/(\\d+)$`).exec(path);
      if (m) {
        if (!pulls[m[1]]) throw new Error('HTTP 404');
        return JSON.stringify(pulls[m[1]]);
      }
      m = new RegExp(`^repos/${REPO}/issues/(\\d+)$`).exec(path);
      if (m) return JSON.stringify(issues[m[1]] || { number: Number(m[1]), state: 'open' });
      throw new Error(`ukendt api ${path}`);
    }
    if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(prList);
    throw new Error(`ukendt gh ${args.join(' ')}`);
  };
  return { execGh, writes, store };
}

function pull(number, { body = '', title = `ops(til-doers): noget (#${number})`, sha = SHA } = {}) {
  return { number, title, body, merged_at: '2026-11-04T09:00:00Z', base: { ref: 'main' }, merge_commit_sha: sha };
}

const TREE = {
  'frontend/src/App.jsx': '<Route path="/team" element={<TeamPage />} />\n<Route path="/riders" element={<RidersPage />} />',
  'frontend/src/pages/TeamPage.jsx': 'import Squad from "../components/Squad";',
  'frontend/src/pages/RidersPage.jsx': '',
  'frontend/src/components/Squad.jsx': '',
};
const treeAtSha = () => ({
  listFiles: () => Object.keys(TREE),
  readFile: (p) => {
    if (!(p in TREE)) throw new Error('ENOENT');
    return TREE[p];
  },
});

function runDeps(world, extra = {}) {
  const dir = tmp();
  const logs = [];
  const errs = [];
  const fetchCalls = [];
  const stationCalls = [];
  const deps = {
    execGh: world.execGh,
    git: () => '',
    treeAtSha,
    stateDir: dir,
    now: () => T0,
    log: (s) => logs.push(s),
    errorLog: (s) => errs.push(s),
    brandList: [],
    outRoot: { dir: join(dir, 'onedrive'), private: true },
    prepareWorktree: () => join(dir, 'wt'),
    station: (a) => {
      stationCalls.push(a);
      return { exitCode: 0, report: report({ label: a.label, createdAt: new Date(T0 + 1000).toISOString(), routes: [a.path] }) };
    },
    deployVerifyRuns: () => [{ databaseId: 1, headSha: SHA, status: 'completed', conclusion: 'success', event: 'push', createdAt: '2026-11-04T09:30:00Z' }],
    fetch: async (url) => {
      fetchCalls.push(url);
      return { status: 200 };
    },
    ...extra,
  };
  return { deps, logs, errs, fetchCalls, stationCalls, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const FULL_BODY = `Refs #7585\n\n${decl(7585, ['side: /team | selector [data-testid="squad-table"]', 'prod: GET /api/health -> 200'])}`;

test('main: dry-run kører tjek og printer kommentaren, men skriver intet', async () => {
  const world = makeWorld({ pulls: { 7621: pull(7621, { body: FULL_BODY }) }, issues: { 7585: { number: 7585, state: 'open' } }, files: { 7621: ['frontend/src/components/Squad.jsx'] } });
  const r = runDeps(world);
  try {
    assert.equal(await main(['run', '--pr', '7621'], r.deps), 0);
    assert.equal(world.writes.length, 0);
    assert.equal(r.stationCalls.length, 1);
    assert.deepEqual(r.fetchCalls, ['https://cyclingzone.org/api/health']);
    const out = r.logs.join('\n');
    assert.match(out, /dry-run, intet skrevet/);
    assert.match(out, /#7585 \[open\] 4=ok 8=ok; kommentar: create/);
    assert.match(out, /udledte sider \/team/);
    assert.match(out, /\| Til dørs: 4 ok auto-bevis/);
    // Lockfilen er frigivet.
    assert.equal(existsSync(join(r.deps.stateDir, LOCK_FILE)), false);
  } finally {
    r.cleanup();
  }
});

test('main: --apply opretter én kommentar, og en ny kørsel af samme tog er uændret', async () => {
  const world = makeWorld({ pulls: { 7621: pull(7621, { body: FULL_BODY }) }, issues: { 7585: { number: 7585, state: 'open' } } });
  const r = runDeps(world);
  try {
    await main(['run', '--pr', '7621', '--apply'], r.deps);
    assert.equal(world.writes.length, 1);
    assert.equal(world.writes[0].method, 'POST');
    assert.match(world.writes[0].path, /issues\/7585\/comments$/);
    assert.ok(world.writes[0].body.startsWith(proofMarker({ pr: 7621, issue: 7585, sha: SHA })));
    await main(['run', '--pr', '7621', '--apply', '--json'], r.deps);
    assert.equal(world.writes.length, 1);
    const json = JSON.parse(r.logs.at(-1));
    assert.equal(json.plans[0].issues[0].action, 'unchanged');
  } finally {
    r.cleanup();
  }
});

test('main: uden deklaration bliver alt udkast, og intet build eller prod-kald køres', async () => {
  const world = makeWorld({ pulls: { 7700: pull(7700, { body: 'Refs #7585' }) }, issues: { 7585: { number: 7585, state: 'open' } }, files: { 7700: ['frontend/src/components/Squad.jsx'] } });
  const r = runDeps(world);
  try {
    await main(['run', '--pr', '7700', '--apply', '--json'], r.deps);
    assert.equal(r.stationCalls.length, 0);
    assert.equal(r.fetchCalls.length, 0);
    const body = world.writes[0].body;
    assert.match(body, /Udkast \(auto-bevis\) 4: ingen til-doers-proof-deklaration for issuet \(udledte sider giver kun udkast: \/team\)/);
    assert.match(body, /Udkast \(auto-bevis\) 8:/);
    assert.doesNotMatch(body, /^Til dørs:/m);
  } finally {
    r.cleanup();
  }
});

test('main: Deploy verify ikke grøn giver udkast for 8 uden prod-kald; fejlet tjek giver mangler', async () => {
  const world = makeWorld({ pulls: { 7621: pull(7621, { body: FULL_BODY }) }, issues: { 7585: { number: 7585, state: 'open' } } });
  const r = runDeps(world, {
    deployVerifyRuns: () => [{ databaseId: 1, headSha: SHA, status: 'completed', conclusion: 'failure', event: 'push', createdAt: '2026-11-04T09:30:00Z' }],
    station: (a) => ({
      exitCode: 3,
      report: report({ label: a.label, createdAt: new Date(T0 + 1000).toISOString(), routes: [a.path], waits: [{ route: a.path, width: 1440, selector: a.selectors[0], error: 'Timeout 30000ms exceeded.' }] }),
    }),
  });
  try {
    await main(['run', '--pr', '7621', '--json'], r.deps);
    assert.equal(r.fetchCalls.length, 0);
    const issue = JSON.parse(r.logs.at(-1)).plans[0].issues[0];
    assert.deepEqual(issue.results.map((x) => x.udfald), ['mangler', 'udkast']);
    assert.match(issue.results[1].tekst, /Deploy verify er ikke grøn \(failure\)/);
  } finally {
    r.cleanup();
  }
});

test('main: --plan-only kører hverken billedstation, Deploy verify eller prod-kald', async () => {
  const world = makeWorld({ pulls: { 7621: pull(7621, { body: FULL_BODY }) }, issues: { 7585: { number: 7585, state: 'open' } } });
  let dvCalls = 0;
  const r = runDeps(world, { deployVerifyRuns: () => { dvCalls += 1; return []; } });
  try {
    await main(['run', '--pr', '7621', '--plan-only', '--apply'], r.deps);
    assert.equal(r.stationCalls.length, 0);
    assert.equal(r.fetchCalls.length, 0);
    assert.equal(dvCalls, 0);
    assert.match(r.logs.join('\n'), /kun plan/);
    // --plan-only skriver heller ikke, selv med --apply: tjekkene er ikke koert.
    assert.equal(world.writes.length, 0);
  } finally {
    r.cleanup();
  }
});

test('main: lukkede issues får ingen kommentar og ingen tjek; brand-issue får brand-noten', async () => {
  const body = `Refs #7585 Refs #7000\n\n${decl(7585, ['prod: GET /api/health -> 200'])}\n${decl(7000, ['side: /team | tekst Trup'])}`;
  const world = makeWorld({
    pulls: { 7621: pull(7621, { body }) },
    issues: { 7585: { number: 7585, state: 'open' }, 7000: { number: 7000, state: 'closed' } },
  });
  const r = runDeps(world, { brandList: [{ issue: 7585 }] });
  try {
    await main(['run', '--pr', '7621', '--apply', '--json'], r.deps);
    assert.equal(r.stationCalls.length, 0);
    assert.equal(world.writes.length, 1);
    assert.match(world.writes[0].path, /issues\/7585\//);
    assert.match(world.writes[0].body, /Brand-issue: krav 8 lukker ikke på auto-bevis alene/);
    const plan = JSON.parse(r.logs.at(-1)).plans[0];
    assert.equal(plan.issues.find((i) => i.issue === 7000).action, 'none');
  } finally {
    r.cleanup();
  }
});

test('main: --catch-up springer issues med bevis over og tager resten', async () => {
  const existing = { id: 5, body: `${proofMarker({ pr: 7621, issue: 7585, sha: SHA })}\nx`, author_association: 'OWNER', created_at: '2026-11-04T09:40:00Z' };
  const world = makeWorld({
    pulls: { 7621: pull(7621, { body: 'Refs #7585' }), 7622: pull(7622, { body: 'Refs #7586', sha: LATER }) },
    issues: { 7585: { number: 7585, state: 'open' }, 7586: { number: 7586, state: 'open' } },
    comments: { 7585: [existing] },
    prList: [{ number: 7622, mergedAt: '2026-11-04T09:10:00Z' }, { number: 7621, mergedAt: '2026-11-04T09:00:00Z' }],
  });
  const r = runDeps(world);
  try {
    await main(['--catch-up', '--hours', '12', '--apply', '--json'], r.deps);
    const plans = JSON.parse(r.logs.at(-1)).plans;
    assert.deepEqual(plans.map((p) => p.pr), [7621, 7622]);
    assert.match(plans[0].skipped, /har bevis/);
    assert.equal(world.writes.length, 1);
    assert.match(world.writes[0].path, /issues\/7586\//);
  } finally {
    r.cleanup();
  }
});

test('main: dubletter mister markøren, og exit er 0 ved fejl, lås og dårlige argumenter', async () => {
  const marker = proofMarker({ pr: 7621, issue: 7585, sha: SHA });
  const c1 = { id: 1, body: `${marker}\ngammel`, author_association: 'OWNER', created_at: '2026-11-04T09:40:00Z' };
  const c2 = { id: 2, body: `${marker}\ngammel`, author_association: 'OWNER', created_at: '2026-11-04T09:41:00Z' };
  const world = makeWorld({ pulls: { 7621: pull(7621, { body: 'Refs #7585' }) }, issues: { 7585: { number: 7585, state: 'open' } }, comments: { 7585: [c1, c2] } });
  const r = runDeps(world);
  try {
    await main(['run', '--pr', '7621', '--apply'], r.deps);
    assert.deepEqual(world.writes.map((w) => `${w.method} ${w.path.split('/').slice(-1)[0]}`), ['PATCH 1', 'PATCH 2']);
    assert.equal(world.writes[1].body, DUP_PROOF_BODY);
    assert.equal(hasProof([{ ...c2, body: DUP_PROOF_BODY }], { pr: 7621, issue: 7585, sha: SHA }), false);

    // Ukendt PR: fejl i planen, exit 0.
    assert.equal(await main(['run', '--pr', '9999'], r.deps), 0);
    assert.match(r.logs.at(-1), /PR #9999: fejl/);
    // Daarlige argumenter: exit 0, besked paa stderr.
    assert.equal(await main(['run'], r.deps), 0);
    assert.match(r.errs.at(-1), /--pr/);
    // En anden koersel holder laasen: springes over.
    writeFileSync(join(r.deps.stateDir, LOCK_FILE), JSON.stringify({ pid: process.pid, startedAt: new Date(T0).toISOString() }));
    const before = world.writes.length;
    assert.equal(await main(['run', '--pr', '7621', '--apply'], r.deps), 0);
    assert.equal(world.writes.length, before);
    assert.match(r.errs.at(-1), /anden koersel/);
    assert.equal(JSON.parse(readFileSync(join(r.deps.stateDir, LOCK_FILE), 'utf8')).pid, process.pid);
  } finally {
    r.cleanup();
  }
});

test('main: tidsgrænsen stopper nye PRer, men exit er stadig 0', async () => {
  const world = makeWorld({ pulls: { 7621: pull(7621, { body: 'Refs #7585' }) }, issues: { 7585: { number: 7585, state: 'open' } } });
  const r = runDeps(world, { timeoutMs: 0 });
  try {
    assert.equal(await main(['run', '--pr', '7621', '--apply'], r.deps), 0);
    assert.equal(world.writes.length, 0);
    assert.match(r.logs.join('\n'), /tidsgrænsen/);
  } finally {
    r.cleanup();
  }
});

test('catchUpPrs: søger mergede PRer siden N timer, ældste først', () => {
  let seen = null;
  const execGh = (args) => {
    seen = args;
    return JSON.stringify([{ number: 3, mergedAt: '2026-11-04T09:00:00Z' }, { number: 2, mergedAt: '2026-11-04T08:00:00Z' }]);
  };
  assert.deepEqual(catchUpPrs(execGh, REPO, { hours: 2, now: () => T0 }), [2, 3]);
  assert.ok(seen.includes('merged:>=2026-11-04T08:00:00Z'));
  assert.ok(seen.includes('--base') && seen.includes('main'));
});
