// Owner-operated escape hatch. Agents must never emulate a TTY or enter the
// confirmation. TTY is a transport gate, not cryptographic proof of a human.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { readWave, requireModernWave, withWaveStateLock } from './wave-policy.mjs';
import { processSnapshot } from './wave-recovery.mjs';

const normalize = value => String(value || '').replaceAll('\\', '/').replace(/\/+/g, '/').toLowerCase();
function containsPath(command, target) {
  const text = normalize(command), needle = normalize(target).replace(/\/$/, '');
  if (!needle) return false;
  let offset = text.indexOf(needle);
  while (offset !== -1) {
    const next = text[offset + needle.length];
    if (!next || /[\/\s"']/.test(next)) return true;
    offset = text.indexOf(needle, offset + 1);
  }
  return false;
}

export function matchingProcesses(wave, worktrees, processes) {
  if (!Array.isArray(processes)) throw Error('Process overview unavailable');
  const pids = new Set([wave.pid, wave.watchPid, ...(wave.children || []).map(p => p.pid)].filter(Number.isSafeInteger));
  const matches = new Map();
  for (const p of processes) {
    const reasons = [];
    if (pids.has(p.pid)) reasons.push(p.pid === wave.watchPid ? 'registered lane-watch' : 'registered PID');
    for (const tree of worktrees) if (containsPath(p.commandLine, tree)) reasons.push(`worktree: ${tree}`);
    if (/wave-lane-watch\.ps1/i.test(p.commandLine || '')) reasons.push('lane-watch candidate');
    if (reasons.length) matches.set(p.pid, { pid: p.pid, ppid: p.ppid, name: p.name || 'unknown', createdAt: p.createdAt || 'unknown', reasons });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of processes) if (!matches.has(p.pid) && (pids.has(p.ppid) || matches.has(p.ppid))) {
      matches.set(p.pid, { pid: p.pid, ppid: p.ppid, name: p.name || 'unknown', createdAt: p.createdAt || 'unknown', reasons: ['descendant'] });
      changed = true;
    }
  }
  // Never print/log full command lines; they may contain credentials.
  return [...matches.values()].sort((a, b) => a.pid - b.pid);
}

function worktreesFor(dir, wave) {
  const paths = new Set();
  for (const track of wave.tracks || []) {
    if (track.worktree) paths.add(track.worktree);
    if (typeof track.branch !== 'string' || !/^[A-Za-z0-9/_-]+$/.test(track.branch)) throw Error('Invalid track branch');
    const slug = track.branch.replaceAll('/', '-');
    paths.add(path.join(`${path.resolve(dir, '../..')}-worktrees`, slug));
    const manifest = path.join(dir, 'waves', wave.waveId, `${slug}.json`);
    if (fs.existsSync(manifest)) {
      const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (data.worktree) paths.add(data.worktree);
    }
  }
  return [...paths];
}

async function askOwner(phrase) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try { return await terminal.question(`Skriv praecis: ${phrase}\n> `); }
  finally { terminal.close(); }
}

export async function ownerOverride(dir, injected = {}) {
  const io = { isTTY: process.stdin.isTTY === true, outputIsTTY: process.stdout.isTTY === true,
    snapshot: processSnapshot, write: text => process.stdout.write(`${text}\n`), ask: askOwner,
    now: () => Date.now(), identity: () => ({ user: os.userInfo().username, host: os.hostname() }), ...injected };
  if (!io.isTTY || !io.outputIsTTY) throw Error('Owner override requires an interactive TTY; piped/agent invocation is refused');
  const wave = requireModernWave(readWave(dir));
  const original = JSON.stringify(wave), worktrees = worktreesFor(dir, wave);
  const observed = io.snapshot();
  const shown = matchingProcesses(wave, worktrees, observed.processes);
  io.write(JSON.stringify({ waveId: wave.waveId, runtime: wave.runtime, owner: wave.owner, worktrees, liveProcesses: shown }, null, 2));
  io.write('Kontroller selv at boelgens skrivende arbejde er stoppet. Kommandoen frigiver kun markoeren; den stopper ingen processer.');
  const phrase = `FRIGIV BOELGE ${wave.waveId}`;
  if (await io.ask(phrase) !== phrase) throw Error('Owner confirmation did not match; marker retained');
  return withWaveStateLock(dir, () => {
    if (JSON.stringify(readWave(dir)) !== original) throw Error('Wave changed during confirmation; marker retained');
    const fresh = io.snapshot();
    const currentProcesses = matchingProcesses(wave, worktrees, fresh.processes);
    const identities = new Set(shown.map(p => JSON.stringify(p)));
    if (fresh.bootId !== observed.bootId || currentProcesses.some(p => !identities.has(JSON.stringify(p)))) throw Error('New process or boot change after overview; rerun owner recovery');
    const evidenceDir = path.join(dir, 'waves', wave.waveId);
    fs.mkdirSync(evidenceDir, { recursive: true });
    const evidence = path.join(evidenceDir, `owner-override-${randomUUID()}.json`);
    fs.writeFileSync(evidence, JSON.stringify({ waveId: wave.waveId, owner: wave.owner, runtime: wave.runtime,
      proof: 'interactive-owner-confirmation', confirmedBy: io.identity(), confirmedAt: io.now(),
      phrase, processes: currentProcesses, worktrees }, null, 2), { flag: 'wx' });
    fs.unlinkSync(path.join(dir, 'wave-active.json'));
    return { released: true, waveId: wave.waveId, evidence };
  });
}
