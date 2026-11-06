import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomic, validJobProof } from './wave-child-lifecycle.mjs';

export function prepareWindowsJob(command, args, { scratch, label, worktree, wave, childKey }) {
  const stem = path.join(scratch, label);
  const job = { type: 'windows-job-v1', token: randomUUID(), waveId: wave.waveId, childKey,
    proofFile: stem + '-job-proof.json', receiptFile: stem + '-process.json', stopFile: stem + '-stop' };
  const specFile = stem + '-job-spec.json';
  for (const file of [specFile, job.proofFile, job.receiptFile, job.stopFile]) if (fs.existsSync(file)) throw Error('Refusing stale job artifacts');
  writeJsonAtomic(specFile, { file: command.file, arguments: [...command.prefix, ...args], cwd: worktree,
    ownerPid: wave.ownerProcess.pid, ownerCreatedAt: wave.ownerProcess.createdAt, ...job });
  return { file: 'pwsh', args: ['-NoProfile', '-File', fileURLToPath(new URL('./wave-job-host.ps1', import.meta.url)), '-SpecPath', specFile], job };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; } // Missing/corrupt private evidence never authorizes release.
}

export function readJobProof(job, pid = null) {
  if (job?.type !== 'windows-job-v1') return null;
  const proof = readJson(job.proofFile);
  return validJobProof(proof, { ...job, pid }) ? proof : null;
}

// A receipt survives a contended marker update. A kernel proof also permits a
// later observer to establish supervisor exit without trusting historical PPIDs.
export function restoredChildStop(child, waveId, now, observed) {
  const job = child.job;
  if (job?.type !== 'windows-job-v1' || typeof job.token !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job.token)
    || job.waveId !== waveId || job.childKey !== child.key) return child;
  const receipt = readJson(job.receiptFile);
  const receiptBound = receipt?.waveId === waveId && receipt.key === child.key && receipt.job?.token === job.token
    && receipt.closeObserved === true && receipt.state === 'stopped' && Number.isFinite(receipt.closedAt);
  if (receiptBound && receipt.spawnFailed === true && receipt.pid === null && child.pid === null) return { ...child, ...receipt };
  const proof = readJobProof(job, child.pid ?? null);
  if (!proof || observed.processes.some(process => process.pid === proof.supervisorPid)) return child;
  return { ...child, pid: proof.supervisorPid, state: 'stopped', closeObserved: true,
    closedAt: receiptBound ? receipt.closedAt : now, treeProof: proof,
    exitCode: receiptBound ? receipt.exitCode : null, spawnFailed: false };
}
