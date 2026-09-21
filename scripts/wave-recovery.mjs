// Explicit recovery for a dead owner. No TTL, force flag, worktree cleanup or
// process-name kill. Unknown identity/snapshot/spawn state keeps the marker.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readWave, requireModernWave, releaseWave } from './wave-policy.mjs';

export function processSnapshot() {
  if (process.platform !== 'win32') throw Error('Automatic recovery requires the Windows process snapshot; unsupported platform retains the marker');
  const observed = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-Command',
    '$ErrorActionPreference="Stop"; @{ bootId=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().Ticks.ToString(); processes=@(Get-CimInstance Win32_Process | Select-Object @{n="pid";e={[int]$_.ProcessId}}, @{n="ppid";e={[int]$_.ParentProcessId}}, @{n="name";e={$_.Name}}, @{n="commandLine";e={$_.CommandLine}}, @{n="createdAt";e={$_.CreationDate.ToUniversalTime().ToString("o")}}) } | ConvertTo-Json -Compress'], { encoding: 'utf8', timeout: 15000 }));
  if (!Array.isArray(observed.processes) || !observed.processes.length || !observed.bootId) throw Error('Process snapshot unavailable');
  return observed;
}

export function recoverWave(dir, expected, snapshot = processSnapshot) {
  const wave = requireModernWave(readWave(dir));
  if (!expected.waveId || wave.waveId !== expected.waveId || !expected.owner || wave.owner !== expected.owner) throw Error('Recovery owner/waveId mismatch');
  if (!Number.isFinite(expected.now)) throw Error('Recovery now required');
  if (!['registered', 'owner-tree'].includes(wave.processTracking)) throw Error('Legacy process history; marker retained');
  const observed = snapshot();
  if (!wave.bootId || typeof observed?.bootId !== 'string' || !observed.bootId) throw Error('Unknown host boot identity; marker retained');
  const rebooted = wave.bootId !== observed.bootId;
  if (!rebooted && (!Number.isSafeInteger(wave.pid) || wave.pid < 1)) throw Error('Unknown owner PID; marker retained');
  const children = wave.children || [];
  if (!rebooted && (!Array.isArray(children) || children.some(c => !Number.isSafeInteger(c.pid) || c.pid < 1 || !['running', 'stopped'].includes(c.state)))) {
    throw Error('Spawn history incomplete; marker retained');
  }
  // A snapshot cannot prove a historical tree stopped when an intermediate
  // process already exited. Only a changed OS boot proves all such descendants
  // are gone. Same-boot recovery is limited to admission before ANY dispatch.
  if (!rebooted && wave.dispatchStarted !== false) throw Error('Same-boot descendants cannot be proven stopped; restart Windows and rerun recovery');
  const roots = new Set([wave.pid, ...(Array.isArray(children) ? children : []).map(c => c.pid)].filter(Number.isSafeInteger));
  const processes = observed.processes;
  if (!Array.isArray(processes) || processes.some(p => !Number.isSafeInteger(p.pid) || !Number.isSafeInteger(p.ppid))) throw Error('Process snapshot invalid');
  const related = new Set(roots);
  // Windows retains ParentProcessId after the parent has exited. This finds
  // surviving descendants even when their registered wrapper is already gone.
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of processes) if (related.has(p.ppid) && !related.has(p.pid)) { related.add(p.pid); changed = true; }
  }
  const alive = rebooted ? [] : processes.filter(p => related.has(p.pid) && p.pid !== wave.watchPid);
  if (alive.length) throw Error(`Wave process still alive (${alive.map(p => p.pid).join(', ')}); marker retained`);
  // Serialize competing recovery commands. Admission remains blocked by the
  // original marker until owned release, including throughout the snapshot.
  // A recovery-process crash must not block the next boot's recovery. Old
  // boot-qualified lock files are inert evidence, never shared with a new boot.
  const bootKey = createHash('sha256').update(observed.bootId).digest('hex').slice(0, 16);
  const recoveryLock = path.join(dir, `wave-recovery-${wave.waveId}-${bootKey}.lock`);
  const lock = fs.openSync(recoveryLock, 'wx');
  try {
    const current = readWave(dir);
    if (JSON.stringify(current) !== JSON.stringify(wave)) throw Error('Wave changed during recovery; marker retained');
    const evidenceDir = path.join(dir, 'waves', wave.waveId);
    fs.mkdirSync(evidenceDir, { recursive: true });
    const evidence = path.join(evidenceDir, 'recovery.json');
    fs.writeFileSync(evidence, JSON.stringify({ waveId: wave.waveId, owner: wave.owner, checkedAt: expected.now, checkedPids: [...roots], proof: rebooted ? 'host-restarted' : 'dead-owner-before-dispatch', observedBootId: observed.bootId }, null, 2));
    releaseWave(dir, wave.waveId, true, observed.bootId);
    return { released: true, waveId: wave.waveId, evidence };
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(recoveryLock);
  }
}
