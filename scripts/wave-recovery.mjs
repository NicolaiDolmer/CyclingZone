// Explicit recovery for a dead owner. No TTL, force flag, worktree cleanup or
// process-name kill. Unknown identity/snapshot/spawn state keeps the marker.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readWave, requireModernWave, withWaveStateLock, stopWaveWatch } from './wave-policy.mjs';
import { isClockDerivedBootId, normalizeBootId, sameBoot } from './wave-boot-identity.mjs';

import { processSnapshot } from './wave-process-snapshot.mjs';
import { allChildrenObservedStopped, registeredChildProcesses } from './wave-child-lifecycle.mjs';
export { processSnapshot } from './wave-process-snapshot.mjs';

const isoStart = value => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN);

// A Windows boot time is derived from the wall clock, so even a mismatch far
// beyond the tolerance can be a large clock correction (#5533). Process start
// times are recorded once and never adjusted: a restart is proven only when
// every observed process, the kernel's own included, started after the
// admitted owner process. Anything less keeps the same-boot rules below.
function restartProven(wave, observed, observedBootId) {
  if (sameBoot(wave.bootId, observedBootId)) return false;
  if (!isClockDerivedBootId(wave.bootId) && !isClockDerivedBootId(observedBootId)) return true;
  const ownerStart = isoStart(wave.ownerProcess?.createdAt);
  const starts = (Array.isArray(observed?.processes) ? observed.processes : []).map(p => isoStart(p?.createdAt)).filter(Number.isFinite);
  return Number.isFinite(ownerStart) && starts.length > 0 && starts.every(start => start > ownerStart);
}

export function recoverWave(dir, expected, snapshot = processSnapshot) {
  const wave = requireModernWave(readWave(dir));
  if (!expected.waveId || wave.waveId !== expected.waveId || !expected.owner || wave.owner !== expected.owner) throw Error('Recovery owner/waveId mismatch');
  if (!Number.isFinite(expected.now)) throw Error('Recovery now required');
  if (!['registered', 'owner-tree'].includes(wave.processTracking)) throw Error('Legacy process history; marker retained');
  const observed = snapshot();
  const observedBootId = normalizeBootId(observed?.bootId);
  if (!normalizeBootId(wave.bootId) || !observedBootId) throw Error('Unknown host boot identity; marker retained');
  // Sub-second drift within one Windows boot is NOT a restart (#5533); only a
  // proven different boot may skip the process check below.
  const rebooted = restartProven(wave, observed, observedBootId);
  if (!rebooted && (!Number.isSafeInteger(wave.pid) || wave.pid < 1)) throw Error('Unknown owner PID; marker retained');
  const children = wave.children || [];
  const observedStops = allChildrenObservedStopped(wave);
  if (!rebooted && (!Array.isArray(children) || children.some(c => (!(Number.isSafeInteger(c.pid) && c.pid > 0) && !(observedStops && c.pid === null && c.spawnFailed === true)) || !['running', 'stopped'].includes(c.state)))) {
    throw Error('Spawn history incomplete; marker retained');
  }
  // A snapshot alone cannot prove a historical tree stopped. The new registered
  // runtime additionally persists each close and seals registration; legacy
  // waves still require reboot after dispatch.
  if (!rebooted && !observedStops && wave.dispatchStarted !== false) throw Error('Same-boot descendants cannot be proven stopped; restart Windows and rerun recovery');
  const roots = new Set([wave.pid, wave.watchPid, ...(Array.isArray(children) ? children : []).map(c => c.pid)].filter(Number.isSafeInteger));
  const related = registeredChildProcesses(wave, observed, true);
  const alive = rebooted ? [] : related.filter(p => p.pid !== wave.watchPid);
  if (alive.length) throw Error(`Wave process still alive (${alive.map(p => p.pid).join(', ')}); marker retained`);
  // Serialize competing recovery commands. Admission remains blocked by the
  // original marker until owned release, including throughout the snapshot.
  // A recovery-process crash must not block the next boot's recovery. Old
  // boot-qualified lock files are inert evidence, never shared with a new boot.
  const bootKey = createHash('sha256').update(observedBootId).digest('hex').slice(0, 16);
  const recoveryLock = path.join(dir, `wave-recovery-${wave.waveId}-${bootKey}.lock`);
  const lock = fs.openSync(recoveryLock, 'wx');
  try {
    const current = readWave(dir);
    if (JSON.stringify(current) !== JSON.stringify(wave)) throw Error('Wave changed during recovery; marker retained');
    const evidenceDir = path.join(dir, 'waves', wave.waveId);
    fs.mkdirSync(evidenceDir, { recursive: true });
    const evidence = path.join(evidenceDir, 'recovery.json');
    withWaveStateLock(dir, () => {
      if (JSON.stringify(readWave(dir)) !== JSON.stringify(wave)) throw Error('Wave changed during recovery; marker retained');
      // Unless a restart is proven, the watch belongs to this boot and must stop.
      stopWaveWatch(wave, rebooted ? observedBootId : undefined);
      if (observedStops && !rebooted) {
        const fresh = snapshot();
        if (!sameBoot(observedBootId, fresh?.bootId)) throw Error('Boot changed during recovery; marker retained');
        if (registeredChildProcesses(wave, fresh, true).length) throw Error('Wave process still alive during final validation; marker retained');
      }
      if (JSON.stringify(readWave(dir)) !== JSON.stringify(wave)) throw Error('Wave changed during recovery; marker retained');
      fs.writeFileSync(evidence, JSON.stringify({ waveId: wave.waveId, owner: wave.owner, checkedAt: expected.now,
        checkedPids: [...roots], proof: rebooted ? 'host-restarted' : observedStops ? 'registered-children-closed' : 'dead-owner-before-dispatch', observedBootId }, null, 2));
      fs.unlinkSync(path.join(dir, 'wave-active.json'));
    });
    return { released: true, waveId: wave.waveId, evidence };
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(recoveryLock);
  }
}
