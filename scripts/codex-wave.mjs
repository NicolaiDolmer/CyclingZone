#!/usr/bin/env node
// Codex wave entry. No merge or broad process/worktree cleanup is performed.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { acquireWave, releaseWave, validateTracks, getOpenPrs, sharedRunDir, REPO } from './wave-policy.mjs';
import { generateBrief } from './make-wave-brief.mjs';
import { classifyStall, commitAgeMinutes, resolveTrackTimeoutMinutes, WAVE_FREEZE } from './wave-freeze.mjs';

const json = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const save = (p, data) => fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 30000 }).trim();
const gh = (...args) => JSON.parse(execFileSync('gh', [...args, '--repo', REPO], { encoding: 'utf8', timeout: 30000 }));

export function childArgs(role, track, schema, output) {
  const args = ['exec', '-C', track.worktree, '--sandbox', role === 'reviewer' || track.kind === 'investigate' ? 'read-only' : 'workspace-write',
    '--json', '--output-schema', schema, '--output-last-message', output];
  if (track.model) args.push('--model', track.model);
  if (track.effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(track.effort)}`);
  // No model override by default. Scratch is per track, never a shared root.
  if (role !== 'reviewer') args.push('--add-dir', track.scratch);
  args.push('-');
  return args;
}

function resultSchema(role) {
  const properties = role === 'reviewer'
    ? { verdict: { type: 'string', enum: ['approved', 'changes_requested'] }, findings: { type: 'array', items: { type: 'string' } } }
    : { status: { type: 'string', enum: ['ready', 'blocked'] }, summary: { type: 'string' }, tests: { type: 'array', items: { type: 'string' } } };
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

export async function runWave(options, supplied = {}) {
  const { root, runDir, owner } = options;
  const tracks = validateTracks(options.tracks);
  const deps = { now: () => Date.now(), readPrs: getOpenPrs, ...supplied };
  const wave = await acquireWave(runDir, { runtime: 'codex', owner, pid: process.pid, cwd: root, now: deps.now(), tracks }, deps.readPrs);
  const evidence = path.join(runDir, 'waves', wave.waveId);
  fs.mkdirSync(evidence, { recursive: true });
  const report = path.join(evidence, 'report.json');
  const results = [], prepared = [];
  let terminationConfirmed = true, stopWave = false;
  const controller = new AbortController();
  const onSignal = () => { stopWave = true; controller.abort(); };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  const checkpoint = cleanup => save(report, { waveId: wave.waveId, runtime: 'codex', results, cleanup,
    unstarted: tracks.filter(t => !results.some(r => r.issue === t.issue)).map(t => t.issue) });
  const context = { root, evidence, wave, signal: controller.signal, now: deps.now };
  try {
    // Setup is serial: Git metadata and dependency setup must not race.
    for (const t of tracks) {
      if (controller.signal.aborted) throw Error('Wave interrupted during setup');
      await deps.prefilter(t, context);
      prepared.push(await deps.prepare(t, context));
    }
    let next = 0;
    async function lane() {
      while (!stopWave && next < prepared.length) {
        const track = prepared[next++];
        const row = { issue: track.issue, branch: track.branch, worktree: track.worktree, state: 'running', reviews: 0, startedAt: deps.now() };
        results.push(row); checkpoint('pending');
        try {
          // Recheck live state directly before every writer, including a fixer.
          await deps.prefilter(track, context);
          const currentPrs = await deps.readPrs();
          const missing = tracks.filter(t => t.kind !== 'investigate' && !currentPrs.some(p => p.headRefName === t.branch)).length;
          if (currentPrs.length + missing > 5) throw Error('PR capacity changed since reservation');
          row.worker = await deps.runAgent('worker', track, context);
          if (row.worker?.status !== 'ready') throw Error('Worker reported blocked or invalid result');
          row.evidence = await deps.validateResult(track, context);
          for (let round = 0; round < 2; round++) {
            row.state = 'review'; checkpoint('pending');
            row.review = await deps.runAgent('reviewer', track, { ...context, worker: row.worker, round });
            row.reviews++;
            if (row.review?.verdict === 'approved' && Array.isArray(row.review.findings) && !row.review.findings.length) {
              row.state = 'ready'; break;
            }
            if (row.review?.verdict !== 'changes_requested' || !Array.isArray(row.review.findings)) throw Error('Invalid independent review');
            row.state = 'changes_requested';
            if (round === 1) break;
            await deps.prefilter(track, context);
            row.worker = await deps.runAgent('fixer', track, { ...context, review: row.review });
            if (row.worker?.status !== 'ready') throw Error('Fixer blocked');
            row.evidence = await deps.validateResult(track, context);
          }
        } catch (e) {
          row.state = 'blocked'; row.error = e.message;
          if (e.terminationUnconfirmed) { terminationConfirmed = false; stopWave = true; controller.abort(); }
          if (e.stopsWave) { stopWave = true; controller.abort(); }
        }
        row.finishedAt = deps.now();
        checkpoint('pending');
      }
    }
    // Four child processes at most, including reviewers; each lane reviews
    // serially with a fresh process. Main session remains the architect.
    const count = Math.max(1, Math.min(4, Number(options.lanes) || 2, prepared.length));
    await Promise.all(Array.from({ length: count }, lane));
    return { results, report, waveId: wave.waveId };
  } finally {
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
    checkpoint(terminationConfirmed ? 'owned-marker-only' : 'retained-unconfirmed-child');
    if (terminationConfirmed) releaseWave(runDir, wave.waveId, true);
    // Never remove worktrees: unmerged branches and evidence are retained.
  }
}

function codexCommand() {
  if (process.platform !== 'win32') return { file: 'codex', prefix: [] };
  const source = execFileSync('pwsh', ['-NoProfile', '-Command', '(Get-Command codex -ErrorAction Stop).Source'], { encoding: 'utf8' }).trim();
  return source.endsWith('.ps1') ? { file: 'pwsh', prefix: ['-NoProfile', '-File', source] } : { file: source, prefix: [] };
}

export async function runAgent(role, track, context) {
  const label = `${role}-${context.round || 0}`;
  const output = path.join(track.scratch, `${label}-result.json`);
  const schema = path.join(track.scratch, `${label}-schema.json`);
  save(schema, resultSchema(role));
  if (fs.existsSync(output)) throw Error(`Refusing stale result: ${output}`);
  const command = codexCommand();
  const prompt = context.fixturePrompt || (role === 'reviewer'
    ? `READ-ONLY independent review. Read the brief below, inspect git diff ${track.reviewBase || track.base}...HEAD and tests. Do not trust the worker's summary. Check scope, ownership, requirements, SSOT, test evidence, privacy and regressions. No writes or agents. Approve only if there are no blocking findings.\n${track.brief}`
    : `${role === 'fixer' ? `Fix only these independently found issues: ${JSON.stringify(context.review)}\n` : ''}${track.brief}\nCodex runtime: work ONLY in ${track.worktree}. No other agents, merge, prod writes, flag flips or changes to main. Keep the PR draft for owner review. Never edit shared coordination files. Use the selected worktree in every shell call. Return blocked if a required command fails. Refs #${track.issue}, never Closes. Before every push run scripts/preflight-pr.ps1. Do not claim success from shell exit alone: inspect each command.\n`);
  const child = spawn(command.file, [...command.prefix, ...childArgs(role, track, schema, output)], {
    cwd: track.worktree, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CZ_WAVE_ID: context.wave.waveId },
  });
  const processRecord = path.join(track.scratch, `${label}-process.json`);
  save(processRecord, { pid: child.pid || null, role, waveId: context.wave.waveId, worktree: track.worktree, state: 'running' });
  let completed = false, stopped = false, timedError = null;
  const started = context.now();
  // Raw agent/tool logs may contain private values. Keep local, outside git.
  const log = fs.createWriteStream(path.join(track.scratch, `${label}.jsonl`), { flags: 'wx' });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.stdin.on('error', e => { if (e.code !== 'EPIPE') timedError = e; });
  child.stdin.end(prompt);
  let rejectTermination;
  let stopTimer;
  const unconfirmed = new Promise((_, reject) => { rejectTermination = reject; });
  const closed = new Promise((resolve, reject) => {
    child.once('error', e => { if (!child.pid) completed = true; log.end(); reject(e); });
    child.once('close', code => { completed = true; log.end(); resolve(code); });
  });
  async function stop(reason) {
    if (completed || stopped) return;
    stopped = true; timedError = reason;
    stopTimer = setTimeout(() => {
      if (!completed) { const e = Error('Child termination not observed after stop'); e.terminationUnconfirmed = true; rejectTermination(e); }
    }, 15000);
    if (process.platform === 'win32') {
      // Only the process tree spawned by this invocation. No name-based kills.
      await new Promise(resolve => {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', resolve); killer.once('close', resolve);
      });
    } else child.kill('SIGTERM');
  }
  const onAbort = () => { void stop(Error('Wave interrupted')); };
  context.signal.addEventListener('abort', onAbort, { once: true });
  let nextCheck = (role === 'reviewer' ? WAVE_FREEZE.REVIEW_TIMEOUT_MINUTES : track.kind === 'investigate' ? WAVE_FREEZE.INVESTIGATE_TIMEOUT_MINUTES : resolveTrackTimeoutMinutes(track.timeoutMinutes)) * 60000;
  const timer = setInterval(() => {
    const elapsed = context.now() - started;
    if (elapsed < nextCheck || completed || stopped) return;
    if (role === 'reviewer' || track.kind === 'investigate') { void stop(Error(`${role} timeout`)); return; }
    let probe;
    try {
      const last = Number(git(track.worktree, 'log', '-1', '--format=%ct'));
      probe = classifyStall({ probeOk: true, lastCommitAgeMinutes: commitAgeMinutes(last, context.now() / 1000), elapsedMinutes: elapsed / 60000 });
    } catch { probe = classifyStall({ probeOk: false }); }
    if (probe.verdict === 'extend') nextCheck = elapsed + probe.extendMinutes * 60000;
    else { const e = Error(`Track stopped: ${probe.reason}`); e.stopsWave = probe.stopsWave; void stop(e); }
  }, 5000);
  try {
    if (context.signal.aborted) onAbort();
    const code = await Promise.race([closed, unconfirmed]);
    save(processRecord, { pid: child.pid, role, waveId: context.wave.waveId, state: 'stopped', exitCode: code });
    if (timedError) throw timedError;
    if (code !== 0) throw Error(`${role} exited ${code}; inspect private log ${track.scratch}`);
    const result = json(output);
    return result;
  } finally {
    clearInterval(timer); clearTimeout(stopTimer); context.signal.removeEventListener('abort', onAbort);
    if (!completed) { const e = Error('Child termination not observed; wave marker retained'); e.terminationUnconfirmed = true; throw e; }
  }
}

function productionDeps(root, worktreesRoot) {
  return {
    async prefilter(t) {
      const issue = gh('issue', 'view', String(t.issue), '--json', 'state,labels');
      if (issue.state !== 'OPEN') throw Error(`Issue #${t.issue} is not open`);
      const merged = gh('pr', 'list', '--state', 'merged', '--search', String(t.issue), '--limit', '100', '--json', 'number,title,headRefName');
      if (merged.some(p => p.headRefName === t.branch)) throw Error(`Branch ${t.branch} already merged`);
      // Scope-level merged matches need the architect's documented disposition.
      const covered = new Set(t.checkedMergedPrs || []);
      if (merged.some(p => !covered.has(p.number))) throw Error(`Read merged PR matches for #${t.issue} and record checkedMergedPrs before dispatch`);
    },
    async prepare(t, context) {
      const slug = t.branch.replaceAll('/', '-');
      const worktree = path.join(worktreesRoot, slug);
      if (fs.existsSync(worktree)) throw Error(`Existing worktree requires owner recovery: ${worktree}`);
      const existing = gh('pr', 'list', '--head', t.branch, '--state', 'all', '--json', 'number,state');
      if (existing.length) throw Error(`Existing PR requires owner recovery: ${t.branch}`);
      execFileSync('pwsh', ['-NoProfile', '-File', path.join(root, 'scripts/new-worktree.ps1'), '-Branch', t.branch, '-RepoRoot', root, '-WorktreesRoot', worktreesRoot,
        ...(t.ownNodeModules ? ['-OwnNodeModules'] : [])], { stdio: 'inherit', timeout: 1800000 });
      const scratch = path.join(worktreesRoot, '.wave-scratch', context.wave.waveId, slug);
      fs.mkdirSync(scratch, { recursive: true });
      const base = git(worktree, 'rev-parse', 'HEAD');
      const brief = generateBrief({ ...t, slug, repoWorktreesRoot: worktreesRoot, scratchRoot: path.dirname(scratch) });
      fs.writeFileSync(path.join(scratch, 'brief.md'), brief);
      save(path.join(context.evidence, `${slug}.json`), { issue: t.issue, worktree, branch: t.branch, base, scratch });
      return { ...t, worktree, base, brief, scratch };
    },
    runAgent,
    async validateResult(t) {
      if (git(t.worktree, 'branch', '--show-current') !== t.branch) throw Error('Worker branch changed');
      if (git(t.worktree, 'status', '--porcelain')) throw Error('Worker left uncommitted changes');
      if (t.kind === 'investigate') return;
      // The worker may have rebased. Preserve initial base for provenance,
      // but validate the current PR diff, not commits merged by other lanes.
      git(t.worktree, 'fetch', 'origin', 'main');
      t.reviewBase = git(t.worktree, 'merge-base', 'origin/main', 'HEAD');
      const files = git(t.worktree, 'diff', '--name-only', `${t.reviewBase}...HEAD`).split('\n').filter(Boolean);
      if (!files.length) throw Error('Worker made no committed change');
      const allowed = file => t.ownership.some(raw => {
        const prefix = raw.replaceAll('\\', '/').split('*')[0].replace(/\/$/, '');
        return file === prefix || file.startsWith(prefix + '/');
      });
      if (files.some(f => !allowed(f))) throw Error('Worker exceeded file ownership');
      const prs = gh('pr', 'list', '--head', t.branch, '--state', 'open', '--json', 'number,url,headRefOid');
      if (prs.length !== 1 || prs[0].headRefOid !== git(t.worktree, 'rev-parse', 'HEAD')) throw Error('PR missing or does not contain worker HEAD');
      return { pr: prs[0].url, commit: prs[0].headRefOid, reviewBase: t.reviewBase,
        // A reviewable handoff to the existing merge queue, never execution.
        ownerApprovedMergeCommand: ['pwsh', '-File', path.join(root, 'scripts/merge-queue.ps1'), '-Pr', String(prs[0].number)] };
    },
  };
}

async function cli() {
  const [configPath, mode = '--dry-run'] = process.argv.slice(2);
  if (!configPath || !['--dry-run', '--run'].includes(mode)) throw Error('Usage: codex-wave.mjs plan.json [--dry-run|--run]');
  const config = json(configPath);
  validateTracks(config.tracks);
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel');
  const main = path.dirname(git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
  const worktreesRoot = `${main}-worktrees`;
  if (mode === '--dry-run') {
    console.log(JSON.stringify({ runtime: 'codex', lanes: Math.max(1, Math.min(4, config.lanes || 2)), verifyMax: 2,
      runDir: sharedRunDir(root), worktreesRoot, tracks: config.tracks, mutation: false,
      merge: 'Owner must say merge; use scripts/merge-queue.ps1 separately' }, null, 2));
    return;
  }
  const result = await runWave({ ...config, root, runDir: sharedRunDir(root), owner: `codex-wave-${process.pid}` }, productionDeps(root, worktreesRoot));
  console.log(JSON.stringify(result, null, 2));
  if (result.results.some(r => r.state !== 'ready') || result.results.length !== config.tracks.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  cli().catch(e => { console.error(`codex-wave: ${e.message}`); process.exitCode = 1; });
}
