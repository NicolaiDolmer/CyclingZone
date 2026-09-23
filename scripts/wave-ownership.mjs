// Ordinary release requires the admitted process identity and its living tree.
// Session names and public wave IDs alone are not proof of ownership.
import fs from 'node:fs';
import { processSnapshot } from './wave-process-snapshot.mjs';
import { measureBootId, sameBoot } from './wave-boot-identity.mjs';

export function ownershipSnapshot() {
  if (process.platform === 'win32') return processSnapshot();
  if (process.platform !== 'linux') throw Error('Cannot prove wave process ownership on this platform');
  const bootId = measureBootId();
  const processes = [];
  for (const pid of fs.readdirSync('/proc').filter(p => /^\d+$/.test(p))) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      processes.push({ pid: Number(pid), ppid: Number(fields[1]), createdAt: fields[19] });
    } catch (error) {
      if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error;
    }
  }
  return { bootId, processes };
}

const creation = value => /^\d+$/.test(String(value)) ? BigInt(value) : BigInt(Date.parse(value));

export function assertWaveOwnership(wave, observed, callerPid = process.pid, sessionId) {
  const fail = () => { throw Error('Another session owns this wave; marker retained'); };
  if (sessionId !== undefined && sessionId !== wave.owner) fail();
  const owner = wave.ownerProcess;
  // Normalized comparison (#5533): markers with raw drifted ticks stay valid.
  if (!owner || !owner.createdAt || !sameBoot(owner.bootId, observed.bootId) || !Array.isArray(observed.processes)) fail();
  const byPid = new Map(observed.processes.map(p => [p.pid, p]));
  if (byPid.get(owner.pid)?.createdAt !== owner.createdAt) fail();
  const seen = new Set();
  let cursor = byPid.get(callerPid);
  while (cursor && !seen.has(cursor.pid)) {
    if (cursor.pid === owner.pid) return;
    seen.add(cursor.pid);
    const parent = byPid.get(cursor.ppid);
    if (!parent) fail();
    try { if (creation(parent.createdAt) > creation(cursor.createdAt)) fail(); }
    catch { fail(); }
    cursor = parent;
  }
  fail();
}

export function admissionOwnerProcess(pid, observed = ownershipSnapshot()) {
  const owner = observed.processes.find(p => p.pid === pid);
  if (!owner?.createdAt) throw Error('Cannot verify admission owner process');
  const ownerProcess = { pid, createdAt: owner.createdAt, bootId: observed.bootId };
  assertWaveOwnership({ ownerProcess }, observed);
  return ownerProcess;
}
