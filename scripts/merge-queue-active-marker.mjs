#!/usr/bin/env node
// merge-queue-active-marker.mjs: "et merge-tog koerer nu"-markoer (#7587).
//
// Baggrund (ejer 4/11): Stop-hooken (scripts/check-now-md.sh) advarede om
// manglende NOW-linje og SHA-kommentar midt i et merge-tog, hvor close-out
// endnu ikke kan ske (toget er ikke verificeret). merge-queue.ps1 skriver
// derfor denne markoer mens den koerer og fjerner den i finally (ogsaa ved
// STOP/fejl). Hooken udskyder sine paamindelser for togets commits, saa
// laenge markoeren er levende. -DryRun skriver ingen markoer.
//
// Fil: <hoved-checkout>/.claude/run/merge-queue-active.json (gitignoreret).
// Stien findes via git's faelles mappe, saa en koe i et worktree og en hook i
// hoved-checkoutet ser samme fil. MERGE_QUEUE_MARKER_FILE overstyrer (tests).
//
// Indhold: { pid, startedAt (ISO), prs: [N...], merged: [{ pr, sha }...] }.
// Laeseren ignorerer en stale markoer: pid er ikke levende, eller toget
// startede for laenge siden (MAX_AGE_MS). Ulaeselig fil = ingen markoer, saa
// hooken falder tilbage til sin gamle adfaerd (fail-open mod paamindelsen).
//
// CI-plan trin 1 (Codex P2 paa #8330): EEN koe ad gangen tages ATOMISK med `acquire`.
// Foer laeste koeen `status` og skrev saa `start`; to koeer der startede samtidig saa
// begge en tom markoer og kom begge ind. `acquire` laeser, afviser en levende ejer og
// skriver markoeren under en kort fil-laas (mkdir er atomisk paa tvaers af processer).
//
// CLI (alle kald er fail-soft og exit'er 0, undtagen `covers` og `acquire`):
//   node scripts/merge-queue-active-marker.mjs acquire --pid <pid> --prs "1,2,3"
//     exit 0 = markoeren er vores, 3 = en anden levende koe ejer den, 4 = fejl (fail-closed)
//   node scripts/merge-queue-active-marker.mjs start  --pid <pid> --prs "1,2,3"
//   node scripts/merge-queue-active-marker.mjs merged --pid <pid> --pr <N> --sha <40 hex>
//   node scripts/merge-queue-active-marker.mjs stop   --pid <pid>
//   node scripts/merge-queue-active-marker.mjs status
//   node scripts/merge-queue-active-marker.mjs covers --sha <sha> [--subject "<commit-emne>"]
// Env CHECK_NOW_MD_NOW_EPOCH (sekunder) erstatter uret, saa hook og test deler klokke.
// covers: exit 0 = en levende markoer daekker commit'en (SHA'en er merget af
// toget, eller emnet ender paa "(#N)" for en af togets PR'er); ellers exit 1.
//
// Tests: node --test scripts/merge-queue-active-marker.test.mjs

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const MARKER_RELATIVE = join('.claude', 'run', 'merge-queue-active.json');
// Et tog der har koert saa laenge, er ikke laengere et levende tog (proces haengt
// eller draebt uden finally); bedre at vise paamindelsen end at tie for evigt.
export const MAX_AGE_MS = 6 * 60 * 60 * 1000;

// Hoved-checkoutets rod via git's faelles mappe (ogsaa fra et worktree). null = ikke et git-repo.
export function gitCommonRoot(cwd = process.cwd()) {
  const res = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  if (res.error || res.status !== 0) return null;
  const dir = String(res.stdout ?? '').trim();
  return dir ? dirname(resolve(dir)) : null;
}

export function markerFilePath({ cwd = process.cwd(), env = process.env } = {}) {
  if (env.MERGE_QUEUE_MARKER_FILE) return resolve(env.MERGE_QUEUE_MARKER_FILE);
  return join(gitCommonRoot(cwd) ?? resolve(cwd), MARKER_RELATIVE);
}

// process.kill(pid, 0) tester kun eksistens (ogsaa paa Windows). EPERM = findes.
export function isPidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err?.code === 'EPERM'; }
}

function validMarker(m) {
  return m && typeof m === 'object' && Number.isSafeInteger(m.pid) && m.pid > 0
    && typeof m.startedAt === 'string' && Number.isFinite(Date.parse(m.startedAt))
    && Array.isArray(m.prs) && Array.isArray(m.merged);
}

// Raa laesning (ingen stale-vurdering). null = mangler eller ugyldig.
export function readMarkerFile(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return validMarker(parsed) ? parsed : null;
  } catch { return null; }
}

export function isStale(marker, { now = new Date(), isAlive = isPidAlive } = {}) {
  if (!validMarker(marker)) return true;
  const age = now.getTime() - Date.parse(marker.startedAt);
  if (!(age >= 0 && age <= MAX_AGE_MS)) return true;
  return !isAlive(marker.pid);
}

// Den levende markoer, eller null (mangler, ugyldig eller stale).
export function readActiveMarker(file, opts = {}) {
  const marker = readMarkerFile(file);
  return marker && !isStale(marker, opts) ? marker : null;
}

// Hoerer commit'en til toget? Merge-SHA (fuld eller forkortet, min. 7 tegn), eller
// squash-emnet "... (#N)" for en af togets PR'er (daekker vinduet mellem selve
// merget og at koeen har laest merge-SHA'en).
export function markerCovers(marker, { sha = '', subject = '' } = {}) {
  if (!marker) return false;
  const want = String(sha).trim().toLowerCase();
  if (/^[0-9a-f]{7,40}$/.test(want) && marker.merged.some((m) => String(m?.sha ?? '').toLowerCase().startsWith(want))) return true;
  const pr = /\(#(\d+)\)\s*$/.exec(String(subject));
  return Boolean(pr) && marker.prs.map(Number).includes(Number(pr[1]));
}

function writeAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

export function parsePrList(text) {
  return [...new Set(String(text ?? '').split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
}

export function startMarker(file, { pid, prs, now = new Date() }) {
  const marker = { pid, startedAt: now.toISOString(), prs: [...prs], merged: [] };
  writeAtomic(file, marker);
  return marker;
}

export const ACQUIRE_EXIT = Object.freeze({ OK: 0, BUSY: 3, ERROR: 4 });
// En laas der er saa gammel, er efterladt af en draebt proces (den kritiske sektion tager ms).
export const LOCK_STALE_MS = 30_000;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lockAgeMs(lock) {
  try { return Date.now() - statSync(lock).mtimeMs; } catch { return null; }
}

/**
 * Fjerner en efterladt laas uden at kunne ramme en ny (Codex-review): kun den proces
 * der holder <lock>.recover maa slette, og alderen maales igen under den. To koeer der
 * begge saa den gamle laas, kan derfor ikke slette en afloeser. En efterladt .recover
 * (proces draebt midt i oprydningen) ryddes ikke automatisk: acquire fejler lukket.
 */
function recoverStaleLock(lock) {
  const guard = `${lock}.recover`;
  try { mkdirSync(guard); } catch (err) {
    if (err?.code === 'EEXIST') return;
    throw err;
  }
  try {
    const age = lockAgeMs(lock);
    if (age !== null && age > LOCK_STALE_MS) rmSync(lock, { recursive: true, force: true });
  } finally { rmSync(guard, { recursive: true, force: true }); }
}

/**
 * Koerer fn under en fil-laas (<file>.lock som mappe). mkdir lykkes kun for een
 * proces ad gangen, saa laes-og-skriv inde i fn er atomisk i forhold til andre
 * `acquire`-kald. Laasen baerer et ejer-token og fjernes kun af sin ejer.
 * Kaster, hvis laasen ikke kan tages inden timeoutMs (kalderen fejler lukket).
 */
export function withFileLock(file, fn, { timeoutMs = 10_000, sleep = sleepSync } = {}) {
  const lock = `${file}.lock`;
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  mkdirSync(dirname(file), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { mkdirSync(lock); break; } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      const age = lockAgeMs(lock);
      if (age === null) continue;
      if (age > LOCK_STALE_MS) {
        recoverStaleLock(lock);
        if (lockAgeMs(lock) === null) continue;
      }
      if (Date.now() >= deadline) throw new Error(`markoer-laasen ${lock} er optaget (efterladt? slet mappen, naar ingen koe koerer)`);
      sleep(20 + Math.floor(Math.random() * 30));
    }
  }
  const ownerFile = join(lock, 'owner');
  try {
    writeFileSync(ownerFile, token, 'utf8');
    return fn();
  } finally {
    let owner = null;
    try { owner = readFileSync(ownerFile, 'utf8'); } catch { /* token aldrig skrevet */ }
    if (owner === null || owner === token) rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * Atomisk "kun een koe": tager markoeren, medmindre en anden LEVENDE koe ejer den.
 * En stale, ulaeselig eller manglende markoer overtages. { ok, marker } eller { ok: false, owner }.
 */
export function acquireMarker(file, { pid, prs, now = () => new Date(), isAlive = isPidAlive, lockOpts } = {}) {
  return withFileLock(file, () => {
    // Uret laeses INDE i laasen: et tidspunkt fra foer ventetiden ville faa en netop
    // skrevet markoer til at se ud som "startet i fremtiden" (= stale) og blive overtaget.
    const at = typeof now === 'function' ? now() : now;
    const current = readMarkerFile(file);
    if (current && current.pid !== pid && !isStale(current, { now: at, isAlive })) return { ok: false, owner: current };
    return { ok: true, marker: startMarker(file, { pid, prs, now: at }) };
  }, lockOpts);
}

// Kun ejer-processens markoer opdateres; en anden (nyere) koes markoer roeres ikke.
export function recordMerge(file, { pid, pr, sha }) {
  const marker = readMarkerFile(file);
  if (!marker || marker.pid !== pid) return null;
  if (!marker.merged.some((m) => m?.sha === sha)) marker.merged.push({ pr, sha });
  if (!marker.prs.includes(pr)) marker.prs.push(pr);
  writeAtomic(file, marker);
  return marker;
}

// Fjerner kun egen markoer (eller en ulaeselig fil). true = filen er vaek.
export function stopMarker(file, { pid }) {
  const marker = readMarkerFile(file);
  if (marker && marker.pid !== pid) return false;
  rmSync(file, { force: true });
  return true;
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv = process.argv.slice(2), { file = markerFilePath(), now: injectedNow, isAlive = isPidAlive, out = (l) => process.stdout.write(`${l}\n`), lockOpts } = {}) {
  const now = injectedNow ?? new Date();
  const cmd = argv[0];
  const pid = Number(argValue(argv, '--pid'));
  if (cmd === 'covers') {
    const marker = readActiveMarker(file, { now, isAlive });
    return markerCovers(marker, { sha: argValue(argv, '--sha'), subject: argValue(argv, '--subject') }) ? 0 : 1;
  }
  if (cmd === 'status') {
    const marker = readActiveMarker(file, { now, isAlive });
    out(marker ? JSON.stringify(marker) : 'ingen levende merge-tog-markoer');
    return 0;
  }
  if (cmd === 'acquire') {
    // Fail-closed: koeen maa kun starte, naar markoeren beviseligt er dens egen.
    if (!Number.isSafeInteger(pid) || pid <= 0) { out('markoer: --pid mangler eller er ugyldig.'); return ACQUIRE_EXIT.ERROR; }
    try {
      const res = acquireMarker(file, { pid, prs: parsePrList(argValue(argv, '--prs')), now: injectedNow ?? (() => new Date()), isAlive, lockOpts });
      if (res.ok) return ACQUIRE_EXIT.OK;
      out(`pid ${res.owner.pid}, startet ${res.owner.startedAt}, PR'er ${res.owner.prs.join(',') || '-'}`);
      return ACQUIRE_EXIT.BUSY;
    } catch (err) {
      out(`markoer: kunne ikke tages (${err?.message ?? err})`);
      return ACQUIRE_EXIT.ERROR;
    }
  }
  if (!['start', 'merged', 'stop'].includes(cmd)) {
    out('Brug: node scripts/merge-queue-active-marker.mjs acquire|start|merged|stop|status|covers ...');
    return 1;
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) { out('markoer: --pid mangler eller er ugyldig.'); return 0; }
  try {
    if (cmd === 'start') startMarker(file, { pid, prs: parsePrList(argValue(argv, '--prs')), now });
    if (cmd === 'merged') {
      const pr = Number(argValue(argv, '--pr'));
      const sha = String(argValue(argv, '--sha') ?? '').toLowerCase();
      if (Number.isSafeInteger(pr) && pr > 0 && /^[0-9a-f]{40}$/.test(sha)) recordMerge(file, { pid, pr, sha });
      else out('markoer: --pr/--sha ugyldig; intet registreret.');
    }
    if (cmd === 'stop') stopMarker(file, { pid });
  } catch (err) {
    out(`markoer ADVARSEL: ${err?.message ?? err}`);
  }
  return 0;
}

if (process.argv[1]?.endsWith('merge-queue-active-marker.mjs')) {
  let code = 0;
  // Injicerbar klokke (AGENTS.md regel 16): Stop-hooken og dens test deler samme tid.
  const epoch = Number(process.env.CHECK_NOW_MD_NOW_EPOCH);
  const now = Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : undefined;
  try { code = main(process.argv.slice(2), { now }); } catch (err) { process.stdout.write(`markoer ADVARSEL: uventet fejl: ${err?.message ?? err}\n`); code = process.argv[2] === 'covers' ? 1 : process.argv[2] === 'acquire' ? ACQUIRE_EXIT.ERROR : 0; }
  process.exitCode = code;
}
