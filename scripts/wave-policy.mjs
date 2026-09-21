#!/usr/bin/env node
// Shared admission for both runtimes. Files are coordination state, not a lease.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REPO = 'NicolaiDolmer/CyclingZone';
export const PR_LIMIT = 8;
const reserved = ['docs/now.md', '.claude/run', '.claude/launch.json'];
const normalize = p => p.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();

export function validateTracks(tracks) {
  if (!Array.isArray(tracks) || !tracks.length || tracks.length > 12) throw Error('Expected 1-12 tracks');
  const issues = new Set(), branches = new Set(), slugs = new Set(), files = [];
  for (const t of tracks) {
    if (!Number.isSafeInteger(t.issue) || t.issue < 1) throw Error('Invalid issue');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]+$/.test(t.branch || '') || t.branch.includes('//')) throw Error('Invalid branch');
    const slug = t.branch.replaceAll('/', '-').toLowerCase();
    if (issues.has(t.issue) || branches.has(t.branch) || slugs.has(slug)) throw Error('duplicate issue, branch or worktree slug');
    issues.add(t.issue); branches.add(t.branch); slugs.add(slug);
    if (!Array.isArray(t.ownership) || !t.ownership.length) throw Error('Explicit ownership required');
    for (const raw of t.ownership) {
      const p = normalize(raw);
      if (!p || p.startsWith('/') || p.includes(':') || p.split('/').some(s => ['.', '..', ''].includes(s))) throw Error('Invalid ownership path');
      // Directory/glob prefixes conservatively conflict with descendants.
      const prefix = p.split('*')[0].replace(/\/$/, '');
      if (!prefix) throw Error('Ownership path too broad');
      if (reserved.some(r => prefix === r || prefix.startsWith(r + '/') || r.startsWith(prefix + '/'))) throw Error(`reserved ownership: ${raw}`);
      for (const f of files) {
        if (f.issue !== t.issue && (prefix === f.path || prefix.startsWith(f.path + '/') || f.path.startsWith(prefix + '/'))) {
          throw Error(`ownership overlap: ${raw}`);
        }
      }
      files.push({ issue: t.issue, path: prefix });
    }
  }
  if (tracks.filter(t => t.tier === 'FULL').length > 1) throw Error('Only one FULL verification track');
  return tracks;
}

export function checkCapacity(prs, tracks) {
  if (!Array.isArray(prs)) throw Error('PR count unavailable');
  const branches = new Set(prs.map(p => p.headRefName));
  const additional = tracks.filter(t => t.kind !== 'investigate' && !branches.has(t.branch)).length;
  const projected = prs.length + additional;
  if (prs.length >= PR_LIMIT || projected > PR_LIMIT) throw Error(`PR capacity: ${prs.length} open + ${additional} reserved > available capacity (${PR_LIMIT})`);
  return { open: prs.length, additional, projected };
}

export function getOpenPrs() {
  return JSON.parse(execFileSync('gh', ['pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '1000', '--json', 'number,headRefName,isDraft,url'], { encoding: 'utf8', timeout: 30000 }));
}

export function sharedRunDir(cwd) {
  const common = execFileSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
  return path.join(path.dirname(common), '.claude', 'run');
}

export function readWave(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'wave-active.json'), 'utf8'));
}

let cachedBootId;
export function hostBootId() {
  if (cachedBootId) return cachedBootId;
  if (process.platform === 'linux') cachedBootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  else if (process.platform === 'win32') cachedBootId = execFileSync('pwsh', ['-NoProfile', '-Command',
    '$ErrorActionPreference="Stop"; (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().Ticks.ToString()'], { encoding: 'utf8', timeout: 15000 }).trim();
  return cachedBootId;
}

export function withWaveStateLock(dir, action) {
  const bootId = hostBootId();
  if (!bootId) throw Error('Cannot identify host boot for wave state lock');
  const key = createHash('sha256').update(bootId).digest('hex').slice(0, 16);
  const lock = path.join(dir, `wave-state-${key}.lock`);
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { fs.mkdirSync(lock); acquired = true; break; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  if (!acquired) throw Error('Wave state lock busy; if its owner crashed, restart Windows before recovery');
  try { return action(); }
  finally { fs.rmdirSync(lock); } // Only this invocation's empty lock directory.
}

export function requireModernWave(wave) {
  if (typeof wave?.waveId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(wave.waveId) || !wave.owner || !['claude', 'codex'].includes(wave.runtime)) {
    throw Error('Legacy wave marker: missing waveId/runtime/owner. Let the original Claude wave finish; do not overwrite or automatically recover it.');
  }
  return wave;
}

export function updateWave(dir, waveId, transform) {
  return withWaveStateLock(dir, () => updateWaveLocked(dir, waveId, transform));
}

function updateWaveLocked(dir, waveId, transform) {
  const wave = requireModernWave(readWave(dir));
  if (wave.waveId !== waveId) throw Error('Wave owner mismatch');
  const next = transform(wave);
  if (next.waveId !== wave.waveId || next.owner !== wave.owner || next.runtime !== wave.runtime) throw Error('Cannot change wave ownership');
  const target = path.join(dir, 'wave-active.json');
  const temporary = path.join(dir, `.wave-${waveId}-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { flag: 'wx' });
    if (readWave(dir).waveId !== waveId) throw Error('Wave owner changed during update');
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return next;
}

function claudeOwnerPid(sessionId) {
  const registry = path.join(os.homedir(), '.claude', 'sessions');
  if (!fs.existsSync(registry)) return undefined;
  const matches = fs.readdirSync(registry).filter(name => name.endsWith('.json')).flatMap(name => {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(registry, name), 'utf8'));
      return entry.sessionId === sessionId && Number.isSafeInteger(entry.pid) && entry.pid > 0 ? [entry.pid] : [];
    } catch { return []; } // Registry churn is expected; unknown identity blocks recovery.
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export async function acquireWave(dir, request, readPrs = getOpenPrs) {
  validateTracks(request.tracks);
  if (!['claude', 'codex'].includes(request.runtime) || !request.owner || !Number.isFinite(request.now)) throw Error('runtime, owner and now required');
  fs.mkdirSync(dir, { recursive: true });
  const wave = { ...request, waveId: randomUUID(), startedAt: new Date(request.now).toISOString(), verifyMax: 2, state: 'admitting' };
  const file = path.join(dir, 'wave-active.json');
  try { withWaveStateLock(dir, () => fs.writeFileSync(file, JSON.stringify(wave, null, 2), { flag: 'wx' })); }
  catch (e) { if (e.code === 'EEXIST') throw Error('wave-active.json exists; inspect owner, never expire or overwrite it'); throw e; }
  try {
    wave.capacity = checkCapacity(await readPrs(), request.tracks);
    wave.state = 'running';
    updateWave(dir, wave.waveId, () => wave);
    return wave;
  } catch (e) {
    releaseWave(dir, wave.waveId, true);
    throw e;
  }
}

export function releaseWave(dir, waveId, childrenStopped, observedBootId) {
  return withWaveStateLock(dir, () => releaseWaveLocked(dir, waveId, childrenStopped, observedBootId));
}

function releaseWaveLocked(dir, waveId, childrenStopped, observedBootId) {
  if (!childrenStopped) throw Error('All children must be observed stopped before release');
  const wave = requireModernWave(readWave(dir));
  if (!waveId || wave.waveId !== waveId) throw Error('Wave owner mismatch; marker retained');
  if (wave.watchPid && !(observedBootId && wave.bootId && observedBootId !== wave.bootId)) {
    // PID reuse must never turn cleanup into a kill of somebody else's process.
    const pid = wave.watchPid;
    if (!Number.isSafeInteger(pid) || pid < 1 || !/^\d+$/.test(wave.watchStarted || '')) throw Error('Unverified watch identity; marker retained');
    execFileSync('pwsh', ['-NoProfile', '-Command',
      '$p = Get-Process -Id ' + pid + ' -ErrorAction SilentlyContinue; if ($p) { if ($p.StartTime.ToUniversalTime().Ticks.ToString() -ne ' + "'" + wave.watchStarted + "'" + ') { throw "Watch identity changed" }; Stop-Process -InputObject $p -ErrorAction Stop; $p.WaitForExit() }'], { timeout: 15000 });
  }
  fs.unlinkSync(path.join(dir, 'wave-active.json'));
}

export async function handleHook(payload, dir, readPrs = getOpenPrs, now = Date.now(), captureBoot = () => undefined) {
  const input = payload.tool_input || {};
  const isWave = payload.tool_name === 'Workflow' && (input.name === 'wave' || /(?:^|[\\/])wave\.js$/.test(input.scriptPath || ''));
  if (isWave) {
    const args = input.args || {};
    if (args.dryRun === true) return;
    if (args.lanes !== undefined && (!Number.isInteger(args.lanes) || args.lanes < 1 || args.lanes > 4)) throw Error('Wave lanes must be an integer from 1 to 4');
    if (!payload.session_id) throw Error('Wave admission requires session_id');
    return acquireWave(dir, { runtime: 'claude', owner: payload.session_id, pid: claudeOwnerPid(payload.session_id), bootId: captureBoot(), dispatchStarted: false, processTracking: 'owner-tree', now, tracks: Array.isArray(args) ? args : args.tracks }, readPrs);
  }
  if (payload.tool_name !== 'Agent') return;
  const prompt = String(input.prompt || input.description || '').trimStart();
  if (/^READ-ONLY:/.test(prompt) || ['Explore', 'Plan'].includes(input.subagent_type)) return;
  if (!fs.existsSync(path.join(dir, 'wave-active.json'))) return;
  const wave = readWave(dir); // malformed markers fail closed
  if (wave.runtime === 'codex') throw Error('codex wave owns machine; Claude build dispatch blocked');
  if (wave.owner && payload.session_id !== wave.owner) throw Error('Another session owns this wave');
  if (wave.waveId && /^WAVE-/.test(prompt)) updateWave(dir, wave.waveId, current => ({ ...current, dispatchStarted: true }));
}

async function cli() {
  const [command, ...args] = process.argv.slice(2);
  const value = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
  const dir = value('--run-dir') || sharedRunDir(process.cwd());
  if (command === 'hook') {
    const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    await handleHook(payload, dir, getOpenPrs, Date.now(), hostBootId);
  } else if (command === 'inspect') {
    console.log(JSON.stringify(requireModernWave(readWave(dir))));
  } else if (command === 'assert-idle') {
    if (fs.existsSync(path.join(dir, 'wave-active.json'))) throw Error('Wave marker exists; merge blocked regardless of age or format');
    console.log(JSON.stringify({ idle: true, runDir: dir }));
  } else if (command === 'recover') {
    if (args.includes('--owner-override')) {
      const { ownerOverride } = await import('./wave-owner-override.mjs');
      console.log(JSON.stringify(await ownerOverride(dir)));
      return;
    }
    const { recoverWave } = await import('./wave-recovery.mjs');
    console.log(JSON.stringify(recoverWave(dir, { waveId: value('--wave-id'), owner: value('--owner'), now: Date.now() })));
  } else if (command === 'release') {
    releaseWave(dir, value('--wave-id'), args.includes('--children-stopped'));
  } else if (command === 'watch') {
    const wave = requireModernWave(readWave(dir));
    if (wave.waveId !== value('--wave-id')) throw Error('Wave owner mismatch');
    const pid = Number(value('--pid'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Invalid watch PID');
    const info = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-Command',
      '$p = Get-CimInstance Win32_Process -Filter "ProcessId = ' + pid + '"; if (!$p -or $p.CommandLine -notmatch "wave-lane-watch[.]ps1") { throw "Not a lane watch" }; $s = Get-Process -Id ' + pid + '; @{ started = $s.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json -Compress'], { encoding: 'utf8', timeout: 10000 }));
    wave.watchPid = pid;
    wave.watchStarted = info.started;
    updateWave(dir, wave.waveId, current => ({ ...current, watchPid: pid, watchStarted: info.started }));
  } else throw Error('Usage: wave-policy.mjs hook|inspect|assert-idle|release|watch|recover');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  cli().catch(e => { console.error(`wave-policy: ${e.message}`); process.exitCode = 2; });
}
