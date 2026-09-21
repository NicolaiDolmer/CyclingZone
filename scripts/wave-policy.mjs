#!/usr/bin/env node
// Shared admission for both runtimes. Files are coordination state, not a lease.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REPO = 'NicolaiDolmer/CyclingZone';
export const PR_LIMIT = 5;
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

export async function acquireWave(dir, request, readPrs = getOpenPrs) {
  validateTracks(request.tracks);
  if (!['claude', 'codex'].includes(request.runtime) || !request.owner || !Number.isFinite(request.now)) throw Error('runtime, owner and now required');
  fs.mkdirSync(dir, { recursive: true });
  const wave = { ...request, waveId: randomUUID(), startedAt: new Date(request.now).toISOString(), verifyMax: 2, state: 'admitting' };
  const file = path.join(dir, 'wave-active.json');
  try { fs.writeFileSync(file, JSON.stringify(wave, null, 2), { flag: 'wx' }); }
  catch (e) { if (e.code === 'EEXIST') throw Error('wave-active.json exists; inspect owner, never expire or overwrite it'); throw e; }
  try {
    wave.capacity = checkCapacity(await readPrs(), request.tracks);
    wave.state = 'running';
    fs.writeFileSync(file, JSON.stringify(wave, null, 2));
    return wave;
  } catch (e) {
    releaseWave(dir, wave.waveId, true);
    throw e;
  }
}

export function releaseWave(dir, waveId, childrenStopped) {
  if (!childrenStopped) throw Error('All children must be observed stopped before release');
  const wave = readWave(dir);
  if (!waveId || wave.waveId !== waveId) throw Error('Wave owner mismatch; marker retained');
  if (wave.watchPid) {
    // PID reuse must never turn cleanup into a kill of somebody else's process.
    const pid = wave.watchPid;
    if (!Number.isSafeInteger(pid) || pid < 1 || !/^\d+$/.test(wave.watchStarted || '')) throw Error('Unverified watch identity; marker retained');
    execFileSync('pwsh', ['-NoProfile', '-Command',
      '$p = Get-Process -Id ' + pid + ' -ErrorAction SilentlyContinue; if ($p) { if ($p.StartTime.ToUniversalTime().Ticks.ToString() -ne ' + "'" + wave.watchStarted + "'" + ') { throw "Watch identity changed" }; Stop-Process -InputObject $p -ErrorAction Stop; $p.WaitForExit() }'], { timeout: 15000 });
  }
  fs.unlinkSync(path.join(dir, 'wave-active.json'));
}

export async function handleHook(payload, dir, readPrs = getOpenPrs, now = Date.now()) {
  const input = payload.tool_input || {};
  const isWave = payload.tool_name === 'Workflow' && (input.name === 'wave' || /(?:^|[\\/])wave\.js$/.test(input.scriptPath || ''));
  if (isWave) {
    const args = input.args || {};
    if (args.dryRun === true) return;
    if (args.lanes !== undefined && (!Number.isInteger(args.lanes) || args.lanes < 1 || args.lanes > 4)) throw Error('Wave lanes must be an integer from 1 to 4');
    if (!payload.session_id) throw Error('Wave admission requires session_id');
    return acquireWave(dir, { runtime: 'claude', owner: payload.session_id, now, tracks: Array.isArray(args) ? args : args.tracks }, readPrs);
  }
  if (payload.tool_name !== 'Agent') return;
  const prompt = String(input.prompt || input.description || '').trimStart();
  if (/^READ-ONLY:/.test(prompt) || ['Explore', 'Plan'].includes(input.subagent_type)) return;
  if (!fs.existsSync(path.join(dir, 'wave-active.json'))) return;
  const wave = readWave(dir); // malformed markers fail closed
  if (wave.runtime === 'codex') throw Error('codex wave owns machine; Claude build dispatch blocked');
  if (wave.owner && payload.session_id !== wave.owner) throw Error('Another session owns this wave');
}

async function cli() {
  const [command, ...args] = process.argv.slice(2);
  const value = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
  const dir = value('--run-dir') || sharedRunDir(process.cwd());
  if (command === 'hook') {
    const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    await handleHook(payload, dir);
  } else if (command === 'inspect') {
    console.log(JSON.stringify(readWave(dir)));
  } else if (command === 'release') {
    releaseWave(dir, value('--wave-id'), args.includes('--children-stopped'));
  } else if (command === 'watch') {
    const wave = readWave(dir);
    if (wave.waveId !== value('--wave-id')) throw Error('Wave owner mismatch');
    const pid = Number(value('--pid'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Invalid watch PID');
    const info = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-Command',
      '$p = Get-CimInstance Win32_Process -Filter "ProcessId = ' + pid + '"; if (!$p -or $p.CommandLine -notmatch "wave-lane-watch[.]ps1") { throw "Not a lane watch" }; $s = Get-Process -Id ' + pid + '; @{ started = $s.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json -Compress'], { encoding: 'utf8', timeout: 10000 }));
    wave.watchPid = pid;
    wave.watchStarted = info.started;
    fs.writeFileSync(path.join(dir, 'wave-active.json'), JSON.stringify(wave, null, 2));
  } else throw Error('Usage: wave-policy.mjs hook|inspect|release|watch');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  cli().catch(e => { console.error(`wave-policy: ${e.message}`); process.exitCode = 2; });
}
