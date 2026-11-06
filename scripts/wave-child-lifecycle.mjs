import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Registered close observations are evidence; PID absence is not a substitute.
export function validJobProof(proof, expected) {
  return expected?.type === 'windows-job-v1' && typeof expected.token === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expected.token)
    && proof?.version === 1 && proof.containment === expected.type && proof.activeProcesses === 0
    && proof.waveId === expected.waveId && proof.childKey === expected.childKey && proof.token === expected.token
    && Number.isSafeInteger(proof.supervisorPid) && proof.supervisorPid > 0
    && (expected.pid === null || expected.pid === undefined || proof.supervisorPid === expected.pid);
}

export function allChildrenObservedStopped(wave) {
  if (wave?.runtime !== 'codex' || wave.processTracking !== 'registered'
    || wave.state !== 'draining' || wave.registrationClosed !== true
    || wave.terminationUnaccounted === true || !Array.isArray(wave.children)) return false;
  const keys = new Set();
  if (wave.watchPid && !wave.children.some(child => child.pid === wave.watchPid)) return false;
  return wave.children.every(child => {
    if (!child || typeof child.key !== 'string' || !child.key || keys.has(child.key)) return false;
    keys.add(child.key);
    const neverSpawned = child.pid === null && child.spawnFailed === true;
    const tree = child.job?.waveId === wave.waveId && child.job?.childKey === child.key
      && Number.isSafeInteger(child.pid) && child.pid > 0 && validJobProof(child.treeProof, { ...child.job, pid: child.pid });
    return (neverSpawned || tree) && child.state === 'stopped'
      && child.closeObserved === true && Number.isFinite(child.closedAt);
  });
}

export function registeredChildProcesses(wave, observed, includeOwner = false) {
  const processes = observed?.processes;
  if (!Array.isArray(processes) || processes.some(p => !Number.isSafeInteger(p?.pid) || p.pid < 0 || !Number.isSafeInteger(p.ppid) || p.ppid < 0)) throw Error('Process snapshot invalid; marker retained');
  const roots = new Set([...(includeOwner ? [wave.pid] : []), wave.watchPid,
    ...(wave.children || []).map(child => child.pid)].filter(pid => Number.isSafeInteger(pid) && pid > 0));
  // Windows reuses PIDs quickly. A process born after a child's observed close cannot be
  // that child or its descendant, so it must not hold the lock.
  const closedAt = new Map((wave.children || []).filter(child => Number.isFinite(child?.closedAt)).map(child => [child.pid, child.closedAt]));
  const bornAfterClose = (process, pid) => closedAt.has(pid) && Date.parse(process.createdAt) > closedAt.get(pid);
  for (const process of processes) if (bornAfterClose(process, process.pid)) roots.delete(process.pid);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (roots.has(process.ppid) && !roots.has(process.pid) && !bornAfterClose(process, process.ppid)) { roots.add(process.pid); changed = true; }
    }
  }
  return processes.filter(process => roots.has(process.pid));
}

// Observe close even after the consumer's timeout race has already rejected.
// The callback owns persistence; neither kill completion nor 'exit' is close.
export function observeChildClose(child, onClosed) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      try {
        Promise.resolve(onClosed({ pid: child.pid ?? null, exitCode: code, signal: signal ?? null, spawnFailed: !child.pid })).then(() => resolve(code), reject);
      } catch (error) { reject(error); }
    });
  });
}

export function writeJsonAtomic(file, value) {
  const temporary=path.join(path.dirname(file),'.wave-receipt-'+randomUUID()+'.tmp');
  let descriptor;
  try {
    descriptor=fs.openSync(temporary,'wx');
    fs.writeFileSync(descriptor,JSON.stringify(value));fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);descriptor=undefined;fs.renameSync(temporary,file);
  } finally {
    if(descriptor!==undefined)fs.closeSync(descriptor);
    if(fs.existsSync(temporary))fs.unlinkSync(temporary);
  }
}

export async function persistChildStop(file, observation, mirror, { attempts=3, delayMs=250 }={}) {
  writeJsonAtomic(file,observation);
  for(let attempt=0;;attempt++) {
    try { return mirror(); }
    catch(error) {
      if(!/Wave state lock busy/.test(error.message)||attempt>=attempts-1)throw error;
      await new Promise(resolve=>setTimeout(resolve,delayMs));
    }
  }
}
