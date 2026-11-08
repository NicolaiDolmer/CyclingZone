import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runWave, childArgs } from './codex-wave.mjs';
import * as runner from './codex-wave.mjs';
import { hostLaneCap } from './wave-capacity.mjs';
import { updateWave } from './wave-policy.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ownershipSnapshot } from './wave-ownership.mjs';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { observeChildClose, persistChildStop } from './wave-child-lifecycle.mjs';
import { generateBrief } from './make-wave-brief.mjs';

// #7336: fixtures bruger opdigtede issues; byggestoppet slaas fra her og testes
// for sig i build-stop.test.mjs og i '#7336'-testene i wave-policy.test.mjs
// (acquireWave med runtime 'codex').
const BUILD_STOP_OFF = path.join(mkdtempSync(path.join(os.tmpdir(), 'cz-build-stop-off-')), 'build-stop.json');
writeFileSync(BUILD_STOP_OFF, JSON.stringify({ active: false, since: '2026-10-29', areaCap: 3, finishList: [], cleanupList: [], brandList: [] }));
process.env.CZ_BUILD_STOP_FILE = BUILD_STOP_OFF;
process.env.CZ_BUILD_STOP_LOG = path.join(path.dirname(BUILD_STOP_OFF), 'brand-log.jsonl');

test('#7027: writer brief uses the PowerShell guard with fail-closed commit ordering', () => {
  const brief = generateBrief({ ...tracks[0], slug: 'guard-fixture', scopeText: 'Fixture',
    repoWorktreesRoot: 'C:/Work trees', scratchRoot: 'C:/Scratch' });
  const rendered = runner.writerBrief(brief);
  assert.ok(brief.includes('bash "C:/Work trees\\guard-fixture/scripts/guard-commit-branch.sh"'));
  assert.ok(rendered.includes('pwsh -File "C:/Work trees\\guard-fixture/scripts/guard-commit-branch.ps1" "codex/1-fixture" "C:/Work trees\\guard-fixture"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git -C "C:/Work trees\\guard-fixture" commit -F'));
  assert.doesNotMatch(rendered, /bash [^\r\n]*guard-commit-branch[.]sh/);
  assert.ok(rendered.includes('Blokerer guarden: STOP'));
});

const localAppData = 'C:\\Users\\Fixture\\AppData\\Local';
const appCli = `${localAppData}\\OpenAI\\Codex\\bin\\current\\codex.exe`;
const npmCli = 'C:\\Users\\Fixture\\AppData\\Roaming\\npm\\codex.ps1';
const command = sources => runner.codexCommand({ platform: 'win32', localAppData, discover: () => sources });

test('Windows discovery selects the app CLI when npm shims precede it on PATH', () => {
  assert.deepEqual(command([npmCli, npmCli.replace('.ps1', '.cmd'), appCli]), { file: appCli, prefix: [] });
});

test('app CLI discovery accepts Windows case and slash differences', () => {
  const executable = appCli.replaceAll('\\', '/').toUpperCase();
  assert.deepEqual(command([npmCli, executable]), { file: executable, prefix: [] });
});

test('an unrelated codex.exe does not masquerade as the app binary', () => {
  const unrelated = `${localAppData}\\OpenAI\\Codex\\bin-old\\codex.exe`;
  assert.deepEqual(command([npmCli, unrelated]), { file: 'pwsh', prefix: ['-NoProfile', '-File', npmCli] });
});

test('CLI-only Windows installations preserve PowerShell and executable fallback', () => {
  assert.deepEqual(command(npmCli), { file: 'pwsh', prefix: ['-NoProfile', '-File', npmCli] });
  const exe = 'C:\\Tools\\codex.exe';
  assert.deepEqual(command([exe]), { file: exe, prefix: [] });
});

test('missing CLI discovery fails before a child can be spawned', () => {
  assert.throws(() => command([]), /No Codex CLI found/);
});

test('non-Windows runner preserves PATH resolution without Windows discovery', () => {
  assert.deepEqual(runner.codexCommand({ platform: 'linux', discover: () => { assert.fail('unexpected discovery'); } }),
    { file: 'codex', prefix: [] });
});

const now = 1790000000000;
function observedJob(waveId,key,pid) {
  const job={type:'windows-job-v1',token:'00000000-0000-4000-8000-000000000001',waveId,childKey:key};
  return {job,treeProof:{version:1,containment:job.type,activeProcesses:0,token:job.token,waveId,childKey:key,supervisorPid:pid}};
}

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cz-wave-run-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const tracks = [1, 2].map(issue => ({ issue, branch: `codex/${issue}-fixture`, title: 'Fixture', ownership: [`fixtures/${issue}`], tier: 'TARGETED', verifyCommands: ['node --test fixture.test.mjs'] }));

test('#5509: Codex reads issue content before setup or any spawn', async t => {
  const root = fixture(t);
  let reads = 0;
  await assert.rejects(runWave({ root, runDir: root, tracks, owner: 'fixture' }, deps({
    readIssue: () => { reads++; return { labels: ['player-report'], body: 'SQL endpoint verified' }; },
    prepare: async () => assert.fail('unmeasured complaint reached setup'),
    runAgent: async () => assert.fail('unmeasured complaint reached spawn'),
  })), /Player-report evidence/);
  assert.equal(reads, 1);
  assert.equal(existsSync(path.join(root, 'wave-active.json')), false);
});
test('#6335: Codex plans reject broad ownership and touches while keeping independent files', () => {
  for (const field of ['ownership', 'touches']) {
    for (const raw of ['backend/lib', 'backend/routes/**', 'FRONTEND\\SRC\\PAGES\\']) {
      assert.throws(() => runner.executionPlan({ tracks: [{ ...tracks[0], [field]: [raw] }] }), /too broad/);
    }
  }
  assert.doesNotThrow(() => runner.executionPlan({ tracks: [
    { ...tracks[0], ownership: ['backend/lib/engine/v4/', 'backend/routes/raceFixture.ts'] },
    { ...tracks[1], ownership: ['backend/lib/trainingRunResponse.ts'] },
  ] }));
});
test('reviewer model and effort do not change worker, fixer or permission-probe selection', () => {
  const track = { worktree: '/fixture', scratch: '/scratch', model: 'gpt-6.1-sol', effort: 'medium', reviewerModel: 'gpt-6-astra', reviewerEffort: 'high' };
  for (const role of ['worker', 'fixer', 'permission-probe', 'reviewer']) {
    const args = childArgs(role, track, 'schema', 'out');
    assert.equal(args[args.indexOf('--model') + 1], role === 'reviewer' ? 'gpt-6-astra' : 'gpt-6.1-sol');
    assert.ok(args.includes(`model_reasoning_effort="${role === 'reviewer' ? 'high' : 'medium'}"`));
    if (role === 'reviewer') assert.ok(args.includes('read-only'));
  }
});

test('a different reviewer model without effort uses its configured default, not the worker effort', () => {
  const args = childArgs('reviewer', { worktree: '/fixture', model: 'gpt-6.1-sol', effort: 'medium', reviewerModel: 'gpt-6-astra' }, 'schema', 'out');
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-astra');
  assert.equal(args.includes('-c'), false);
});

test('legacy tracks preserve model inheritance and unspecified models stay unspecified', () => {
  const track = { worktree: '/fixture', model: 'gpt-6.1-sol', effort: 'medium' };
  const args = childArgs('reviewer', track, 'schema', 'out');
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-6.1-sol');
  assert.ok(args.includes('model_reasoning_effort="medium"'));
  const inherited = childArgs('reviewer', { worktree: '/fixture' }, 'schema', 'out');
  assert.equal(inherited.includes('--model'), false);
  assert.equal(inherited.includes('-c'), false);
});

test('reviewer effort alone preserves the track model', () => {
  const args = childArgs('reviewer', { worktree: '/fixture', model: 'gpt-6.1-sol', effort: 'medium', reviewerEffort: 'high' }, 'schema', 'out');
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-6.1-sol');
  assert.ok(args.includes('model_reasoning_effort="high"'));
});

test('malformed model requests fail before admission', async t => {
  const root = fixture(t);
  for (const key of ['model', 'effort', 'reviewerModel', 'reviewerEffort']) {
    for (const value of [null, '', '  ', 4, {}]) {
      await assert.rejects(runWave({ root, runDir: root, tracks: [{ ...tracks[0], [key]: value }], owner: 'fixture' }, deps({
        readPrs: async () => { assert.fail('invalid model reached admission'); },
      })), /must be a non-empty string/);
    }
  }
});

test('four independent tracks can occupy four lanes with role selections recorded', async t => {
  const root = fixture(t);
  const four = [1, 2, 3, 4].map(issue => ({ ...tracks[0], issue, branch: `codex/${issue}-fixture`, ownership: [`fixtures/${issue}`], model: 'gpt-6.1-sol', effort: 'medium', reviewerModel: 'gpt-6-astra', reviewerEffort: 'high' }));
  let active = 0, peak = 0;
  const result = await runWave({ root, runDir: root, tracks: four, owner: 'fixture', lanes: 4 }, deps({
    runAgent: async role => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setImmediate(resolve));
      active--;
      return role === 'reviewer' ? { verdict: 'approved', findings: [] } : { status: 'ready', tests: ['pass'] };
    },
  }));
  assert.equal(peak, 4);
  assert.ok(result.results.every(row => row.state === 'ready'));
  const report = JSON.parse(readFileSync(result.report));
  assert.equal(report.execution.lanes, 4);
  assert.deepEqual(report.execution.models[0], { issue: 1, worker: { model: 'gpt-6.1-sol', effort: 'medium' }, reviewer: { model: 'gpt-6-astra', effort: 'high' } });
});

test('invalid lane counts fail before admission or worktree setup', async t => {
  const root = fixture(t);
  for (const lanes of [0, -1, 5, 1.5, '4', null]) {
    await assert.rejects(runWave({ root, runDir: root, tracks, owner: 'fixture', lanes }, deps({
      readPrs: async () => { assert.fail('invalid plan reached admission'); },
      prepare: async () => { assert.fail('invalid plan reached setup'); },
    })), /lanes must be an integer from 1 to 4 \(lane cap on FIXTURE-UNKNOWN-HOST/);
    assert.equal(existsSync(path.join(root, 'wave-active.json')), false);
  }
});

test('#6615: NICOLAIPC allows six lanes, an unknown host still rejects five', async t => {
  const root = fixture(t);
  const six = [1, 2, 3, 4, 5, 6].map(issue => ({ ...tracks[0], issue, branch: `codex/${issue}-fixture`, ownership: [`fixtures/${issue}`] }));
  assert.equal(runner.executionPlan({ tracks: six, lanes: 6 }, hostLaneCap('NICOLAIPC')).lanes, 6);
  assert.equal(runner.executionPlan({ tracks: six, lanes: 6 }, hostLaneCap('nicolaipc')).lanes, 6);
  assert.throws(() => runner.executionPlan({ tracks: six, lanes: 7 }, hostLaneCap('NICOLAIPC')), /from 1 to 6 \(lane cap on NICOLAIPC/);
  assert.throws(() => runner.executionPlan({ tracks: six, lanes: 5 }, hostLaneCap('DOLMERPC')), /from 1 to 4 \(lane cap on DOLMERPC/);
  let active = 0, peak = 0;
  const result = await runWave({ root, runDir: root, tracks: six, owner: 'fixture', lanes: 6 }, deps({
    laneLimit: () => hostLaneCap('NICOLAIPC'),
    runAgent: async role => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setImmediate(resolve));
      active--;
      return role === 'reviewer' ? { verdict: 'approved', findings: [] } : { status: 'ready', tests: ['pass'] };
    },
  }));
  assert.equal(peak, 6);
  assert.equal(JSON.parse(readFileSync(result.report)).execution.verifyMax, 2);
  await assert.rejects(runWave({ root, runDir: root, tracks: six, owner: 'fixture', lanes: 5 }, deps({
    readPrs: async () => { assert.fail('over-cap plan reached admission'); },
  })), /from 1 to 4 \(lane cap on FIXTURE-UNKNOWN-HOST/);
});

test('reports record explicit capacity and model requests without claiming resolved CLI defaults', async t => {
  const root = fixture(t);
  const result = await runWave({ root, runDir: root, tracks, owner: 'fixture', lanes: 4 }, deps());
  const report = JSON.parse(readFileSync(result.report));
  assert.deepEqual(report.execution, {
    requestedLanes: 4, lanes: 2, laneSource: 'explicit', verifyMax: 2,
    models: tracks.map(track => ({ issue: track.issue, worker: { model: null, effort: null }, reviewer: { model: null, effort: null } })),
  });
});

test('omitted capacity remains two lanes and is visible as a default', async t => {
  const root = fixture(t);
  const result = await runWave({ root, runDir: root, tracks, owner: 'fixture' }, deps());
  const report = JSON.parse(readFileSync(result.report));
  assert.equal(report.execution.requestedLanes, null);
  assert.equal(report.execution.lanes, 2);
  assert.equal(report.execution.laneSource, 'default');
});

// Host-independent: the suite runs on machines with different caps (#6615).
const unknownHost = () => hostLaneCap('FIXTURE-UNKNOWN-HOST');

function deps(overrides = {}) {
  return { now: () => now, bootId: () => 'fixture-boot', readPrs: async () => [], readIssue: () => ({ labels: [], body: '' }), prefilter: async () => {}, laneLimit: unknownHost,
    prepare: async t => ({ ...t, worktree: `/fixture/${t.issue}` }),
    runAgent: async (role, t) => role === 'reviewer' ? { verdict: 'approved', findings: [] } : { status: 'ready', summary: 'fixture', tests: ['pass'] },
    verifyPermissions: async () => {}, validateResult: async () => {}, ...overrides };
}

test('dispatch counts open PRs, including parked drafts, but never rejects on count', async (t) => {
  const root = fixture(t);
  const prs = Array.from({ length: 6 }, (_, i) => ({ number: i + 10, headRefName: `parked/${i}`, isDraft: true }));
  const result = await runWave({ root, runDir: root, tracks, owner: 'fixture' }, deps({ readPrs: async () => prs }));
  assert.ok(result.results.every(r => r.state === 'ready'));
});

// Ejer-beslutning 22/9 (variant B, #5510): loftet paa 8 aabne PR'er er
// fjernet. En boelge maa ikke afvises fordi der allerede er 8+ aabne PR'er -
// lanerne (loft pr. maskine, #6615) og verifikations-semaforen (2) er fortsat bremsen.
test('a wave is not rejected when 8 or more PRs are already open', async (t) => {
  const root = fixture(t);
  const prs = Array.from({ length: 10 }, (_, i) => ({ number: i + 20, headRefName: `parked/${i}`, isDraft: true }));
  const result = await runWave({ root, runDir: root, tracks, owner: 'fixture' }, deps({ readPrs: async () => prs }));
  assert.ok(result.results.every(r => r.state === 'ready'));
});

test('an unfetchable PR list still fails closed and dispatches nothing', async (t) => {
  const root = fixture(t);
  let called = false;
  await assert.rejects(runWave({ root, runDir: root, tracks, owner: 'fixture' }, deps({
    readPrs: async () => { throw Error('PR count unavailable'); },
    runAgent: async () => { called = true; },
  })), /PR count unavailable/);
  assert.equal(called, false);
  assert.equal(existsSync(path.join(root, 'wave-active.json')), false);
});

test('two independent workers are followed by fresh reviewers; owned marker is released', async (t) => {
  const root = fixture(t), events = [];
  let writers = 0, max = 0;
  const result = await runWave({ root, runDir: root, tracks, owner: 'fixture', lanes: 2 }, deps({
    runAgent: async (role, track) => {
      events.push(`${role}:${track.issue}`);
      if (role === 'worker') { writers++; max = Math.max(max, writers); await new Promise(r => setImmediate(r)); writers--; return { status: 'ready', tests: ['pass'] }; }
      return { verdict: 'approved', findings: [] };
    },
  }));
  assert.equal(max, 2);
  assert.equal(result.results.length, 2);
  assert.ok(result.results.every(r => r.state === 'ready'));
  for (const track of tracks) assert.ok(events.indexOf(`reviewer:${track.issue}`) > events.indexOf(`worker:${track.issue}`));
  assert.equal(existsSync(path.join(root, 'wave-active.json')), false);
  assert.ok(existsSync(result.report));
});

test('blocking review gives the same worktree one fix pass and new independent review', async (t) => {
  const root = fixture(t), calls = [];
  let reviews = 0;
  const result = await runWave({ root, runDir: root, tracks: tracks.slice(0, 1), owner: 'fixture' }, deps({
    runAgent: async (role, track) => {
      calls.push([role, track.worktree]);
      if (role === 'reviewer') return ++reviews === 1
        ? { verdict: 'changes_requested', findings: ['fixture failure'] }
        : { verdict: 'approved', findings: [] };
      return { status: 'ready', tests: ['pass'] };
    },
  }));
  assert.deepEqual(calls.map(c => c[0]), ['worker', 'reviewer', 'fixer', 'reviewer']);
  assert.equal(new Set(calls.map(c => c[1])).size, 1);
  assert.equal(result.results[0].state, 'ready');
});

test('setup failure preserves report, does not dispatch, and cleans only owned marker', async (t) => {
  const root = fixture(t);
  let called = false;
  await assert.rejects(runWave({ root, runDir: root, tracks, owner: 'fixture' }, deps({
    prepare: async () => { throw Error('fixture setup failed'); },
    runAgent: async () => { called = true; },
  })), /setup failed/);
  assert.equal(called, false);
  assert.equal(existsSync(path.join(root, 'wave-active.json')), false);
});

test('Git metadata permission failure is caught before any writer dispatch', async t => {
  const root=fixture(t); let writers=0, prepared=0;
  await assert.rejects(runWave({root,runDir:root,tracks,owner:'fixture'},deps({
    prepare:async track => {prepared++;return {...track,worktree:'/fixture/owned'};},
    verifyPermissions:async () => {throw Error('Git metadata write probe failed');},
    runAgent:async () => {writers++;},
  })),/Git metadata write probe failed/);
  assert.equal(prepared,1); assert.equal(writers,0);
  assert.equal(existsSync(path.join(root,'wave-active.json')),false);
});

test('automatic approval review is limited to writable worker/fixer roles', () => {
  const track={worktree:'/fixture',scratch:'/scratch'};
  for(const role of ['worker','fixer']) assert.ok(childArgs(role,track,'schema','out').includes('--approve-for-me'));
  assert.equal(childArgs('reviewer',track,'schema','out').includes('--approve-for-me'),false);
  assert.equal(childArgs('worker',{...track,kind:'investigate'},'schema','out').includes('--approve-for-me'),false);
});

test('setup is marked before it can launch worktree or dependency subprocesses', async t => {
  const root = fixture(t);
  await runWave({ root, runDir: root, tracks, owner: 'fixture' }, deps({
    prepare: async track => {
      assert.equal(JSON.parse(readFileSync(path.join(root, 'wave-active.json'))).dispatchStarted, true);
      return { ...track, worktree: `/fixture/${track.issue}` };
    },
  }));
});

test('unobserved child termination retains marker and prevents unsafe cleanup', async (t) => {
  const root = fixture(t);
  const result = await runWave({ root, runDir: root, tracks: tracks.slice(0, 1), owner: 'fixture' }, deps({
    runAgent: async () => { const e = Error('stop unconfirmed'); e.terminationUnconfirmed = true; throw e; },
  }));
  assert.equal(result.results[0].state, 'blocked');
  assert.equal(existsSync(path.join(root, 'wave-active.json')), true);
  assert.equal(JSON.parse(readFileSync(result.report)).cleanup, 'retained-unconfirmed-child');
});

test('worker failure never becomes ready or reaches reviewer', async (t) => {
  const root = fixture(t), calls = [];
  const result = await runWave({ root, runDir: root, tracks: tracks.slice(0, 1), owner: 'fixture' }, deps({
    runAgent: async role => { calls.push(role); throw Error('fixture tests failed'); },
  }));
  assert.deepEqual(calls, ['worker']);
  assert.equal(result.results[0].state, 'blocked');
});

test('writer and reviewer invocation preserve selected cwd and distinct sandbox roles', () => {
  const t = { worktree: 'C:/fixture/worker', scratch: 'C:/fixture/scratch' };
  assert.ok(childArgs('worker', t, 'schema', 'out').includes('--approve-for-me'));
  assert.equal(childArgs('worker', t, 'schema', 'out').includes('--sandbox'), false);
  assert.ok(childArgs('reviewer', t, 'schema', 'out').includes('read-only'));
  assert.ok(childArgs('reviewer', t, 'schema', 'out').includes(t.worktree));
  assert.equal(childArgs('worker', t, 'schema', 'out').includes('--dangerously-bypass-approvals-and-sandbox'), false);
});

test('#7027: writers and investigate tracks get network; reviewers stay offline', () => {
  const t = { worktree: '/fixture', scratch: '/scratch' };
  for (const role of ['worker', 'fixer', 'permission-probe']) {
    assert.ok(childArgs(role, t, 'schema', 'out').includes('sandbox_workspace_write.network_access=true'));
  }
  const investigate = childArgs('worker', { ...t, kind: 'investigate' }, 'schema', 'out');
  assert.ok(investigate.includes('sandbox_workspace_write.network_access=true'));
  assert.equal(investigate[investigate.indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(investigate.includes('/scratch'));
  assert.equal(childArgs('reviewer', t, 'schema', 'out').includes('sandbox_workspace_write.network_access=true'), false);
});

test('#7027: writers escalate git writes per command and never loosen the sandbox', () => {
  assert.match(runner.WRITER_GIT_RULE, /command-only escalation/);
  assert.match(runner.WRITER_GIT_RULE, /never disable the sandbox, add writable directories or change config/);
  for (const op of ['fetch', 'rebase', 'commit', 'push']) assert.ok(runner.WRITER_GIT_RULE.includes(op));
});

test('Codex child receives explicit runtime even with a Claude parent and no Codex session variables', async () => {
  const { spawnSync } = await import('node:child_process');
  const inherited = { ...process.env, CZ_VERIFY_RUNTIME: 'claude' };
  delete inherited.CODEX_THREAD_ID; delete inherited.CODEX_SESSION_ID;
  const options = runner.agentSpawnOptions(process.cwd(), 'fixture-wave', inherited);
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({runtime:process.env.CZ_VERIFY_RUNTIME,wave:process.env.CZ_WAVE_ID}))'], { ...options, encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.deepEqual(JSON.parse(child.stdout), { runtime: 'codex', wave: 'fixture-wave' });
});

test('#7554: late observed close releases a drained wave without changing the failed result', async t => {
  const root=fixture(t); let closeChild;
  const result=await runWave({root,runDir:root,tracks:tracks.slice(0,1),owner:'fixture'},deps({
    runAgent:async (_role,_track,context)=>{
      const child={key:'fixture-child',pid:2_000_000_000,state:'running'};
      updateWave(root,context.wave.waveId,w=>({...w,children:[child]}));
      closeChild=()=>{
        updateWave(root,context.wave.waveId,w=>({...w,children:[{...child,state:'stopped',closeObserved:true,closedAt:now,exitCode:0,...observedJob(context.wave.waveId,'fixture-child',2_000_000_000)}]}));
        context.onChildStopped?.();
      };
      const error=Error('close not yet observed');error.terminationUnconfirmed=true;throw error;
    },
  }));
  assert.equal(result.results[0].state,'blocked');
  assert.equal(existsSync(path.join(root,'wave-active.json')),true);
  closeChild();
  assert.equal(existsSync(path.join(root,'wave-active.json')),false,'observed late close must trigger automatic release');
  const report=JSON.parse(readFileSync(result.report));
  assert.equal(report.cleanup,'owned-marker-only');
  assert.equal(report.children[0].closeObserved,true);
  assert.equal(report.results[0].state,'blocked');
});
test('#7554: observed close before an unconfirmed-stop rejection still permits safe finalization', async t => {
  const root=fixture(t);
  const result=await runWave({root,runDir:root,tracks:tracks.slice(0,1),owner:'fixture'},deps({
    runAgent:async (_role,_track,context)=>{
      updateWave(root,context.wave.waveId,w=>({...w,children:[{key:'fixture-child',pid:2_000_000_000,state:'stopped',closeObserved:true,closedAt:now,exitCode:0,...observedJob(context.wave.waveId,'fixture-child',2_000_000_000)}]}));
      const error=Error('earlier timeout');error.terminationUnconfirmed=true;throw error;
    },
  }));
  assert.equal(result.results[0].state,'blocked');
  assert.equal(existsSync(path.join(root,'wave-active.json')),false,'all registered children have observed close');
});

test('#7554: unresolved watch identity is visible as incomplete cleanup',async t=>{
  const root=fixture(t);
  const result=await runWave({root,runDir:root,tracks:tracks.slice(0,1),owner:'fixture'},deps({
    runAgent:async (role,_track,context)=>{
      updateWave(root,context.wave.waveId,w=>({...w,watchPid:2_000_000_000,watchStarted:'unknown'}));
      return role==='reviewer'?{verdict:'approved',findings:[]}:{status:'ready',tests:['pass']};
    },
  }));
  assert.equal(existsSync(path.join(root,'wave-active.json')),true);
  assert.equal(result.cleanup,'retained-unconfirmed-child');
});

test('#7554: native child close persists even after the caller timeout has won',async t=>{
  const root=fixture(t), record=path.join(root,'child.json');
  const child=spawn(process.execPath,['-e',"process.stdin.once('data',()=>process.exit(0))"],{windowsHide:true,stdio:['pipe','ignore','ignore']});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();});
  const closed=observeChildClose(child,observation=>writeFileSync(record,JSON.stringify(observation)));
  await assert.rejects(Promise.race([closed,Promise.reject(Error('timeout fixture'))]),/timeout fixture/);
  assert.equal(existsSync(record),false);
  child.stdin.end('stop');
  assert.equal(await closed,0);
  const observation=JSON.parse(readFileSync(record));
  assert.equal(observation.pid,child.pid);
  assert.equal(observation.exitCode,0);
  assert.equal(observation.spawnFailed,false);
});
test('#7554: exit and kill-result signals alone never persist close evidence',async t=>{
  const root=fixture(t), record=path.join(root,'child.json'), child=new EventEmitter();child.pid=123;
  const closed=observeChildClose(child,observation=>writeFileSync(record,JSON.stringify(observation)));
  child.emit('exit',0);child.emit('kill-result',0);
  assert.equal(existsSync(record),false);
  child.emit('close',null,'SIGTERM');
  await closed;
  assert.equal(JSON.parse(readFileSync(record)).signal,'SIGTERM');
});
test('#7554: failed native spawn still records the later close after error rejection',async t=>{
  const root=fixture(t), record=path.join(root,'child.json');
  const child=spawn(path.join(root,'missing-executable'),[],{windowsHide:true,stdio:'ignore'});
  const closed=observeChildClose(child,observation=>writeFileSync(record,JSON.stringify(observation)));
  const closeEvent=new Promise(resolve=>child.once('close',resolve));
  await assert.rejects(closed,error=>error.code==='ENOENT');
  await closeEvent;
  const observation=JSON.parse(readFileSync(record));
  assert.equal(observation.pid,null);
  assert.equal(observation.spawnFailed,true);
});
test('#7554: failed persistence never reports a successful observed close',async()=>{
  const child=new EventEmitter();child.pid=123;
  const closed=observeChildClose(child,()=>{throw Error('persistence failed');});
  child.emit('close',0);
  await assert.rejects(closed,/persistence failed/);
});

function jobSpec(root,arguments_) {
  const owner=ownershipSnapshot().processes.find(p=>p.pid===process.pid);
  const spec={file:process.execPath,arguments:arguments_,cwd:root,ownerPid:process.pid,ownerCreatedAt:owner.createdAt,
    waveId:'job-fixture',childKey:'worker-0',token:randomUUID(),proofFile:path.join(root,'proof.json'),stopFile:path.join(root,'stop')};
  const file=path.join(root,'spec.json');writeFileSync(file,JSON.stringify(spec));return {file,spec};
}
test('#7554: Windows kernel job host preserves arguments and redirected stdin/stdout',{skip:process.platform!=='win32'},t=>{
  const root=fixture(t),args=['space value','quote"value','trailing\\','', 'זרו','2026-11-03T10:00:00.000Z','a\tb','a\nb','literal$(not-a-command)'];
  const program="let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({args:process.argv.slice(1),input})))";
  const {file,spec}=jobSpec(root,['-e',program,'--',...args]);
  const result=spawnSync('pwsh',['-NoProfile','-File',fileURLToPath(new URL('./wave-job-host.ps1',import.meta.url)),'-SpecPath',file],{input:'fixture input',encoding:'utf8',timeout:30_000,windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{args,input:'fixture input'});
  const proof=JSON.parse(readFileSync(spec.proofFile));
  assert.equal(proof.activeProcesses,0);
  assert.equal(proof.containment,'windows-job-v1');
  assert.equal(proof.token,spec.token);
  assert.equal(proof.supervisorPid,result.pid);
});

test('#7554: close receipt is durable before a contended mirror and remains reusable',async t=>{
  const root=fixture(t),record=path.join(root,'receipt.json');let attempts=0;
  const value={state:'stopped',closeObserved:true,closedAt:now};
  await persistChildStop(record,value,()=>{
    assert.deepEqual(JSON.parse(readFileSync(record)),value);
    if(++attempts<3)throw Error('Wave state lock busy fixture');
  },{attempts:3,delayMs:0});
  assert.equal(attempts,3);
  await assert.rejects(persistChildStop(record,value,()=>{throw Error('Wave state lock busy fixture');},{attempts:1,delayMs:0}),/lock busy/);
  assert.deepEqual(JSON.parse(readFileSync(record)),value);
  assert.deepEqual((await import('node:fs')).readdirSync(root),['receipt.json']);
});

test('#7554: stop requested before job startup prevents payload execution',{skip:process.platform!=='win32'},t=>{
  const root=fixture(t),sentinel=path.join(root,'payload-ran');
  const {file,spec}=jobSpec(root,['-e',"require('node:fs').writeFileSync(process.argv[1],'ran')",sentinel]);
  writeFileSync(spec.stopFile,'stop');
  const result=spawnSync('pwsh',['-NoProfile','-File',fileURLToPath(new URL('./wave-job-host.ps1',import.meta.url)),'-SpecPath',file],{encoding:'utf8',timeout:30_000,windowsHide:true});
  assert.equal(existsSync(sentinel),false,'a pre-existing stop must fence resume');
  assert.notEqual(result.status,0);
  assert.equal(JSON.parse(readFileSync(spec.proofFile)).activeProcesses,0);
});
test('#7554: kernel job stops a deep detached orphan after its parents exit',{skip:process.platform!=='win32'},t=>{
  const root=fixture(t),record=path.join(root,'orphan.json');
  const middle="const {spawn}=require('node:child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});p.unref();require('node:fs').writeFileSync(process.argv[1],JSON.stringify({pid:p.pid,parent:process.pid}));";
  const program="const {spawn}=require('node:child_process');const p=spawn(process.execPath,['-e',"+JSON.stringify(middle)+",process.argv[1]],{stdio:'ignore',detached:true});p.on('exit',()=>process.exit(0));";
  const {file,spec}=jobSpec(root,['-e',program,record]);
  const result=spawnSync('pwsh',['-NoProfile','-File',fileURLToPath(new URL('./wave-job-host.ps1',import.meta.url)),'-SpecPath',file],{encoding:'utf8',timeout:30_000,windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  const orphan=JSON.parse(readFileSync(record));
  assert.equal(JSON.parse(readFileSync(spec.proofFile)).activeProcesses,0);
  const processes=ownershipSnapshot().processes;
  assert.equal(processes.some(p=>p.pid===orphan.pid),false,'the detached grandchild must be stopped before attestation');
  assert.equal(processes.some(p=>p.pid===orphan.parent),false);
});
