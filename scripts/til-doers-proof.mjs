#!/usr/bin/env node
// scripts/til-doers-proof.mjs
// ============================================================
// Til doers auto-bevis (#7585), PR 3: runneren.
//
// Efter et merge-tog tager runneren live-bevis for de issues de mergede PR'er
// refererer, og laegger EN idempotent kommentar pr. issue pr. PR i toget
// (markoer <!-- til-doers-proof:v1 pr=X issue=Y sha=Z -->). Hvad beviset maa
// sige (ok, mangler eller udkast), afgoer kernen i scripts/lib/til-doers-proof.mjs.
// Denne fil henter data, koerer tjekkene og skriver.
//
// Usage:
//   node scripts/til-doers-proof.mjs run --pr 7621,7634           (dry-run: koerer tjek, skriver intet til GitHub)
//   node scripts/til-doers-proof.mjs run --catch-up --hours 24     (tog fra de sidste N timer uden bevis)
//   node scripts/til-doers-proof.mjs run --pr 7621 --plan-only     (kun planen: intet build, ingen prod-kald)
//   node scripts/til-doers-proof.mjs run --pr 7621 --apply         (skriver kommentarerne)
//   --dry-run     tvinger dry-run, ogsaa sammen med --apply
//   --json        maskinlaesbart output
//   --repo owner/name, --prod-base https://cyclingzone.org
//
// Default er ALTID dry-run. Den foerste uge koerer runneren kun som dry-run
// (ejer-go 4/11); rigtig skrivning kraever --apply.
//
// Tjekkene:
//   - Side-tjek (krav 4): kun erklaerede `side:`-linjer. Billedstationen
//     (scripts/pr-shots.mjs) bygger frontend fra merge-SHA'en i runnerens eget
//     checkout, bruger en kopi af login-profilen (kun laesning, skrive-vagt) og
//     venter paa selector/tekst. Billederne lander kun i OneDrive-context;
//     findes den ikke, tages ingen billeder, og resultatet bliver et udkast.
//     Tunge koersler gaar gennem verify-lock.ps1 (semafor 2).
//   - Udledte sider (affected-routes) naevnes kun i udkastet; de giver aldrig ok.
//   - Prod-tjek (krav 8): kun erklaerede GET-kald, og kun efter en groen
//     Deploy verify der daekker merge-SHA'en. Ingen login, ingen cookies.
//
// Fail-soft: lockfil (een koersel ad gangen), samlet tidsgraense paa 20 min,
// og exit-koden er altid 0. Kommentarer skrives kun paa aabne issues.

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBuildStop } from './lib/build-stop.mjs';
import { deriveAffectedRoutes } from './lib/affected-routes.mjs';
import { defaultOutRoot, slugify } from './lib/prShots.mjs';
import {
  COLLABORATOR_ASSOCIATIONS,
  DEFAULT_REPO,
  defaultExecGh,
  extractRefIssues,
  ghJson,
  ghPaged,
  mergedIntoMain,
  titleScopeIssues,
} from './lib/til-doers.mjs';
import {
  evaluateProof,
  oneLine,
  parseProofMarker,
  planProofComment,
  proofDeclarationsForPr,
  renderProofComment,
  sameSha,
} from './lib/til-doers-proof.mjs';
import { parseRouteMap } from './verify-affected.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TOTAL_TIMEOUT_MS = 20 * 60 * 1000;
export const LOCK_STALE_MS = 25 * 60 * 1000;
export const LOCK_UNREADABLE_GRACE_MS = 60 * 1000;
export const DEFAULT_PROD_BASE = 'https://cyclingzone.org';
export const DEFAULT_HOURS = 24;
export const MAX_HOURS = 24 * 7;
export const MAX_PRS = 30;
export const DEPLOY_VERIFY_WORKFLOW = 'deploy-verify.yml';
export const STATE_DIR_NAME = 'cz-til-doers-proof';
export const LOCK_FILE = 'run.lock';
export const PROOF_OUT_DIR = 'til-doers-proof';
export const DUP_PROOF_BODY = 'Dublet af auto-bevis-kommentaren for samme PR og merge. Den gældende er den ældste i tråden.';
const SHOT_WIDTH = 1440;
// Et build + billede tager typisk et par minutter; der startes ikke et nyt,
// naar der er mindre tid tilbage end det.
const MIN_SHOOT_MS = 3 * 60 * 1000;
const PROD_FETCH_TIMEOUT_MS = 15 * 1000;

// ---------------------------------------------------------------- argumenter

export function parseArgs(argv) {
  const opts = {
    prs: [],
    catchUp: false,
    hours: DEFAULT_HOURS,
    apply: false,
    dryRun: false,
    planOnly: false,
    json: false,
    repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO,
    prodBase: DEFAULT_PROD_BASE,
  };
  const args = [...argv];
  if (args[0] === 'run') args.shift();
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const flag = eq === -1 ? a : a.slice(0, eq);
    const inline = eq === -1 ? null : a.slice(eq + 1);
    const next = () => {
      if (inline !== null) return inline;
      const v = args[i + 1];
      if (v === undefined) throw new Error(`${flag} kræver en værdi`);
      i += 1;
      return v;
    };
    if (flag === '--pr' || flag === '--prs') {
      for (const part of next().split(',')) {
        const n = Number(part.trim().replace(/^#/, ''));
        if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`ugyldigt PR-nummer: ${part}`);
        if (!opts.prs.includes(n)) opts.prs.push(n);
      }
    } else if (flag === '--catch-up') opts.catchUp = true;
    else if (flag === '--hours') {
      const h = Number(next());
      if (!Number.isFinite(h) || h <= 0 || h > MAX_HOURS) throw new Error(`--hours skal være mellem 0 og ${MAX_HOURS}`);
      opts.hours = h;
    } else if (flag === '--apply') opts.apply = true;
    else if (flag === '--dry-run') opts.dryRun = true;
    else if (flag === '--plan-only') opts.planOnly = true;
    else if (flag === '--json') opts.json = true;
    else if (flag === '--repo') opts.repo = next();
    else if (flag === '--prod-base') opts.prodBase = next();
    else throw new Error(`ukendt argument: ${a}`);
  }
  if (!opts.catchUp && !opts.prs.length) throw new Error('angiv --pr N[,M] (et merge-tog) eller --catch-up');
  if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) throw new Error(`ugyldigt repo: ${opts.repo}`);
  let base;
  try {
    base = new URL(opts.prodBase);
  } catch {
    throw new Error(`ugyldig --prod-base: ${opts.prodBase}`);
  }
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('--prod-base skal være https:// uden login-oplysninger');
  opts.prodBase = base.origin;
  // --dry-run vinder altid over --apply, og --plan-only koerer ingen tjek, saa
  // der er intet bevis at skrive.
  opts.write = opts.apply && !opts.dryRun && !opts.planOnly;
  return opts;
}

// ---------------------------------------------------------------- lockfil

/**
 * Een koersel ad gangen. Lockfilen indeholder pid, et token og starttid. En
 * lock er forladt, naar den er aeldre end LOCK_STALE_MS, eller processen er
 * doed. En tom eller ulaeselig lock er en koersel der lige er ved at starte, og
 * taeller som optaget, til den er aeldre end en kort frist (Codex).
 * @returns {{ok: true, release: Function} | {ok: false, reason: string}}
 */
export function acquireLock(file, { now = Date.now(), pid = process.pid, isAlive = pidAlive, staleMs = LOCK_STALE_MS, graceMs = LOCK_UNREADABLE_GRACE_MS } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const token = `${pid}-${now}-${Math.random().toString(36).slice(2)}`;
  const release = () => {
    try {
      if (JSON.parse(readFileSync(file, 'utf8')).token === token) rmSync(file, { force: true });
    } catch {
      // best-effort: en lock vi ikke kan laese, er ikke laengere vores
    }
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = openSync(file, 'wx');
      try {
        writeSync(fd, JSON.stringify({ pid, token, startedAt: new Date(now).toISOString() }));
      } finally {
        closeSync(fd);
      }
      return { ok: true, release };
    } catch (err) {
      if (err.code !== 'EEXIST') return { ok: false, reason: `lockfilen kunne ikke oprettes (${err.code || err.message})` };
    }
    let raw = null;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') continue;
    }
    let held = null;
    try {
      held = JSON.parse(raw);
    } catch {
      held = null;
    }
    if (!held) {
      if (now - statMtime(file) <= graceMs) return { ok: false, reason: 'en anden koersel er ved at starte' };
    } else {
      const started = Date.parse(held.startedAt || '') || statMtime(file) || now;
      if (now - started <= staleMs && isAlive(Number(held.pid))) {
        return { ok: false, reason: `en anden koersel er i gang (pid ${Number(held.pid)}, startet ${oneLine(held.startedAt, 40)})` };
      }
    }
    // Overtag kun, hvis det stadig er den samme forladte lock: flyt den atomisk
    // vaek, og laeg den tilbage, hvis en anden naaede at skrive en ny imellem.
    const moved = `${file}.stale-${token}`;
    try {
      renameSync(file, moved);
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      return { ok: false, reason: `lockfilen kunne ikke overtages (${err.code || err.message})` };
    }
    let movedRaw = null;
    try {
      movedRaw = readFileSync(moved, 'utf8');
    } catch {
      movedRaw = null;
    }
    if (movedRaw !== raw) {
      try {
        linkSync(moved, file);
      } catch {
        // en tredje koersel har allerede taget lockfilen; den beholder den
      }
      rmSync(moved, { force: true });
      return { ok: false, reason: 'en anden koersel overtog lockfilen samtidig' };
    }
    rmSync(moved, { force: true });
  }
  return { ok: false, reason: 'lockfilen kunne ikke overtages' };
}

function statMtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// ---------------------------------------------------------------- git

/** git i repo-roden. Kaster ved exit != 0. buffer: true giver stdout som Buffer. */
export function defaultGit(args, { input, buffer = false, cwd = REPO_ROOT, timeout = 5 * 60 * 1000 } = {}) {
  const res = spawnSync('git', args, { cwd, input, maxBuffer: 512 * 1024 * 1024, timeout, windowsHide: true });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const err = new Error(`git ${args[0]} fejlede (exit ${res.status}): ${String(res.stderr || '').split(/\r?\n/)[0]}`);
    err.status = res.status;
    throw err;
  }
  return buffer ? res.stdout : res.stdout.toString('utf8');
}

/** Er commit `ancestor` indeholdt i `descendant`? */
export function isAncestor(git, ancestor, descendant) {
  try {
    git(['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

/** Parser `git cat-file --batch`-output til Map<sti, indhold>. names er i samme raekkefoelge som input. */
export function parseCatFileBatch(buf, names) {
  const out = new Map();
  let pos = 0;
  for (const name of names) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl === -1) break;
    const header = buf.subarray(pos, nl).toString('utf8');
    pos = nl + 1;
    if (/ missing$/.test(header)) continue;
    const size = Number(header.split(' ')[2]);
    if (!Number.isSafeInteger(size) || size < 0) break;
    out.set(name, buf.subarray(pos, pos + size).toString('utf8'));
    pos += size + 1;
  }
  return out;
}

/**
 * frontend/src som den saa ud ved merge-SHA'en, til affected-routes. Laeser
 * alle kodefiler i EET git-kald, saa importgrafen ikke koster hundredvis af kald.
 */
export function treeAtSha(git, sha) {
  const names = git(['ls-tree', '-r', '--name-only', sha, '--', 'frontend/src/']).split(/\r?\n/).filter(Boolean);
  const code = names.filter((n) => /\.(?:[cm]?jsx?|tsx?)$/.test(n));
  const buf = git(['cat-file', '--batch'], { input: code.map((n) => `${sha}:${n}\n`).join(''), buffer: true });
  const contents = parseCatFileBatch(buf, code);
  return {
    listFiles: () => names,
    readFile: (p) => {
      if (!contents.has(p)) throw new Error(`${p} findes ikke ved ${String(sha).slice(0, 7)}`);
      return contents.get(p);
    },
  };
}

/** Udledte ruter for en PR. Fejl giver en tom liste med en grund, aldrig en exception. */
export function deriveRoutesForPr({ files, tree }) {
  try {
    const routeMap = parseRouteMap(tree.readFile('frontend/src/App.jsx'));
    const res = deriveAffectedRoutes(files, { listFiles: tree.listFiles, readFile: tree.readFile, routeMap });
    return { routes: res.routes.map((r) => `/${r}`), fallback: res.fallback, error: null };
  } catch (err) {
    return { routes: [], fallback: true, error: oneLine(err.message, 120) };
  }
}

// ---------------------------------------------------------------- Deploy verify

/**
 * Den Deploy verify-koersel der daekker merge-SHA'en: den foerste groenne
 * koersel paa samme sha eller paa en senere main-commit der indeholder den.
 * Ellers koerslen paa netop den sha (med dens status), eller null.
 *
 * Kun push-koersler taeller: ved workflow_dispatch er headSha den ref workflowet
 * blev startet fra, mens det tjekkede commit er inputs.sha, saa headSha beviser
 * intet om, hvad der blev verificeret (Codex).
 */
export function findDeployVerify({ runs, sha, contains }) {
  const byTime = [...(runs || [])].filter((r) => r.event === 'push').sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  for (const r of byTime) {
    if (r.status !== 'completed' || r.conclusion !== 'success') continue;
    if (sameSha(r.headSha, sha)) return { conclusion: 'success', sha: r.headSha, containsMerge: false, runId: r.databaseId };
    if (contains(sha, r.headSha)) return { conclusion: 'success', sha: r.headSha, containsMerge: true, runId: r.databaseId };
  }
  const exact = byTime.filter((r) => sameSha(r.headSha, sha)).pop();
  if (!exact) return null;
  return {
    conclusion: exact.status === 'completed' ? exact.conclusion || 'ukendt' : exact.status || 'ukendt',
    sha: exact.headSha,
    containsMerge: false,
    runId: exact.databaseId,
  };
}

export function listDeployVerifyRuns(execGh, repo) {
  return JSON.parse(
    execGh([
      'run', 'list', '--repo', repo, '--workflow', DEPLOY_VERIFY_WORKFLOW, '--branch', 'main', '--limit', '50',
      '--json', 'databaseId,headSha,status,conclusion,createdAt,event',
    ]),
  );
}

// ---------------------------------------------------------------- prod-tjek

/** Koer de erklaerede GET-kald. Ingen credentials, ingen redirects fulgt, timeout pr. kald. */
export async function runProdChecks({ checks, prodBase, fetchImpl, deadline, now }) {
  const results = [];
  const seen = new Set();
  for (const c of checks) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    if (now() >= deadline) {
      results.push({ method: 'GET', url: c.url, error: 'tidsgrænsen for kørslen er nået' });
      continue;
    }
    const target = c.url.startsWith('/') ? new URL(c.url, prodBase).href : c.url;
    try {
      const res = await fetchImpl(target, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: { 'user-agent': 'cz-til-doers-proof' },
        signal: AbortSignal.timeout(Math.max(1000, Math.min(PROD_FETCH_TIMEOUT_MS, deadline - now()))),
      });
      results.push({ method: 'GET', url: c.url, status: Number(res.status) });
    } catch (err) {
      results.push({ method: 'GET', url: c.url, error: oneLine(err.name === 'TimeoutError' ? 'timeout' : err.message, 80) });
    }
  }
  return results;
}

// ---------------------------------------------------------------- side-tjek

/** Selector til billedstationens --wait-for: CSS som den er, tekst som Playwrights text=. */
export function waitSelector(check) {
  return check.kind === 'selector' ? check.value : `text=${check.value}`;
}

export function shotLabel({ pr, sha, path }) {
  return slugify(`proof-pr${pr}-${String(sha).slice(0, 7)}-${path === '/' ? 'root' : path}`);
}

/**
 * Laes billedstationens rapport for een koersel om til resultater pr. tjek.
 * report: report.json fra pr-shots (eller null). En vent der fejlede paa
 * timeout er "ikke fundet"; alle andre fejl er "kunne ikke koere".
 */
export function interpretShot({ checks, report, exitCode, error }) {
  if (!report) {
    const why = error || `billedstationen gav ingen rapport (exit ${exitCode ?? 'ukendt'})`;
    return { report: null, loggedIn: exitCode === 2 ? false : null, results: checks.map((c) => ({ ...c, error: why })) };
  }
  if (report.stoppedAt) {
    return { report, loggedIn: false, results: checks.map((c) => ({ ...c, error: 'sessionen holdt ikke undervejs' })) };
  }
  const shotRoutes = new Set((report.shots || []).map((s) => s.route));
  const results = checks.map((c) => {
    const sel = waitSelector(c);
    const fail = (report.waits || []).find((w) => w.route === c.path && w.selector === sel);
    if (fail) return /timeout/i.test(String(fail.error || '')) ? { ...c, found: false } : { ...c, error: oneLine(fail.error || 'ukendt fejl', 80) };
    if (!shotRoutes.has(c.path)) return { ...c, error: 'intet billede af siden' };
    return { ...c, found: true };
  });
  return { report, loggedIn: true, results };
}

/**
 * Koer de erklaerede side-tjek for een PR paa et build fra merge-SHA'en.
 * Returnerer side-objektet til kernens evaluateSideProof.
 */
export function runSideChecks({ pr, sha, checks, derived, station, prepareWorktree, outRoot, deadline, now }) {
  const base = { buildSha: null, loggedIn: null, mocks: null, derived, results: [] };
  const allError = (why) => ({ ...base, results: checks.map((c) => ({ ...c, error: why })) });
  if (!outRoot?.private) return allError('OneDrive-context ikke fundet; billeder tages kun i OneDrive');
  if (deadline - now() < MIN_SHOOT_MS) return allError('tidsgrænsen for kørslen er nået');

  let worktree;
  try {
    worktree = prepareWorktree(sha, { timeoutMs: deadline - now() });
  } catch (err) {
    return allError(`build-checkoutet kunne ikke gøres klar (${oneLine(err.message, 80)})`);
  }

  const byPath = new Map();
  for (const c of checks) {
    if (!byPath.has(c.path)) byPath.set(c.path, []);
    if (!byPath.get(c.path).some((x) => x.kind === c.kind && x.value === c.value)) byPath.get(c.path).push(c);
  }
  const results = [];
  const reports = [];
  let loggedOut = false;
  let built = false;
  for (const [path, pathChecks] of byPath) {
    if (deadline - now() < MIN_SHOOT_MS) {
      results.push(...pathChecks.map((c) => ({ ...c, error: 'tidsgrænsen for kørslen er nået' })));
      continue;
    }
    const label = shotLabel({ pr, sha, path });
    const startedAt = new Date(now()).toISOString();
    const shot = station({
      label,
      worktree,
      path,
      selectors: pathChecks.map(waitSelector),
      build: !built,
      outDir: join(outRoot.dir, PROOF_OUT_DIR),
      timeoutMs: deadline - now(),
    });
    const fresh = shot.report && shot.report.label === label && String(shot.report.createdAt || '') >= startedAt ? shot.report : null;
    // Codex P2 (#7655): kun en frisk rapport beviser, at buildet koerte; en gammel
    // rapport maa ikke give de naeste ruter --no-build mod en foraeldet dist.
    built = built || Boolean(fresh);
    const r = interpretShot({ checks: pathChecks, report: fresh, exitCode: shot.exitCode, error: shot.error });
    if (r.loggedIn === false) loggedOut = true;
    if (r.report) reports.push(r.report);
    results.push(...r.results);
  }

  // Buildet tæller kun som merge-SHA'ens, hvis checkoutet var rent, og alle
  // billeder kom fra samme commit.
  const shas = [...new Set(reports.map((r) => (r.git?.dirty === false ? String(r.git?.sha || '') : '')))];
  const buildSha = shas.length === 1 && shas[0] ? shas[0] : null;
  const mocks = reports.length ? reports.some((r) => (r.mocks || []).length > 0) : null;
  // Logget ind = mindst een rapport bekraeftede det, og ingen serie mistede
  // sessionen. Tjek der ikke kunne koeres, staar som fejl i results (udkast).
  const loggedIn = loggedOut ? false : reports.length ? true : null;
  return { buildSha, loggedIn, mocks, derived, results };
}

// ---------------------------------------------------------------- standard-afhængigheder

export function defaultStateDir(env = process.env) {
  const base = env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(base, STATE_DIR_NAME);
}

/**
 * Runnerens eget checkout (git worktree, detached) til build fra merge-SHA'en.
 * Det ligger under state-mappen og roeres aldrig af andre; setup-worktree.ps1
 * giver det node_modules og .env som et normalt worktree.
 */
export function makePrepareWorktree({ git = defaultGit, stateDir, run = spawnSync, env = process.env } = {}) {
  return (sha, { timeoutMs = 10 * 60 * 1000 } = {}) => {
    const dir = join(stateDir, 'wt');
    if (!existsSync(dir)) {
      git(['worktree', 'prune']);
      git(['worktree', 'add', '--detach', dir, sha]);
    }
    const top = git(['rev-parse', '--show-toplevel'], { cwd: dir }).trim();
    if (resolve(top).toLowerCase() !== resolve(dir).toLowerCase()) throw new Error(`${dir} er ikke runnerens eget checkout`);
    git(['checkout', '--detach', '--force', sha], { cwd: dir });
    // setup-worktree kan koere npm ci ved en ny lockfil, saa det gaar gennem
    // semaforen som et build (Codex).
    const [cmd, args] = heavyCommand(env, 'pwsh', ['-NoProfile', '-File', join(REPO_ROOT, 'scripts', 'setup-worktree.ps1'), '-WorktreeRoot', dir, '-MainRepoRoot', REPO_ROOT, '-Quiet'], timeoutMs);
    const setup = run(cmd, args, { cwd: REPO_ROOT, stdio: ['ignore', 2, 2], timeout: timeoutMs, windowsHide: true });
    if (setup.error || setup.status !== 0) throw new Error(`setup-worktree fejlede (exit ${setup.status ?? setup.error?.message})`);
    return dir;
  };
}

/**
 * En tung kommando under verify-lock (semafor 2). Holder koerslen allerede et
 * slot (CZ_VERIFY_LOCK_HELD_SLOT), koeres den direkte: et indlejret slot afvises.
 * @returns {[string, string[]]}
 */
export function heavyCommand(env, exe, args, timeoutMs) {
  if (env.CZ_VERIFY_LOCK_HELD_SLOT) return [exe, args];
  const secs = Math.max(60, Math.floor(timeoutMs / 1000));
  return ['pwsh', ['-NoProfile', '-File', join(REPO_ROOT, 'scripts', 'verify-lock.ps1'), '-Max', '2', '-Timeout', String(secs), '-Label', 'til-doers-proof', '--', exe, ...args]];
}

/**
 * Billedstationen: `pr-shots.mjs shoot` under verify-lock (semafor 2), med
 * output paa stderr, saa --json-output forbliver rent. Koerer runneren selv
 * under verify-lock, kaldes pr-shots direkte (en indlejret slot afvises).
 */
export function makeStation({ run = spawnSync, env = process.env } = {}) {
  return ({ label, worktree, path, selectors, build, outDir, timeoutMs }) => {
    const shootArgs = [
      join(REPO_ROOT, 'scripts', 'pr-shots.mjs'), 'shoot', label, worktree, path, `--widths=${SHOT_WIDTH}`,
      ...selectors.map((s) => `--wait-for=${s}`), `--out=${outDir}`, ...(build ? [] : ['--no-build']),
    ];
    const [cmd, args] = heavyCommand(env, env.CZ_VERIFY_LOCK_HELD_SLOT ? process.execPath : 'node', shootArgs, timeoutMs);
    const res = run(cmd, args, { cwd: REPO_ROOT, stdio: ['ignore', 2, 2], timeout: timeoutMs, windowsHide: true });
    if (res.error) return { exitCode: null, report: null, error: res.error.code === 'ETIMEDOUT' ? 'tidsgrænsen for kørslen er nået' : oneLine(res.error.message, 80) };
    if (res.status === 75) return { exitCode: 75, report: null, error: 'ingen ledig verifikations-slot' };
    let report = null;
    try {
      report = JSON.parse(readFileSync(join(outDir, label, 'report.json'), 'utf8'));
    } catch {
      report = null;
    }
    return { exitCode: res.status, report, error: null };
  };
}

// ---------------------------------------------------------------- et PR i toget

function refIssuesFor(pull) {
  return [...new Set([...extractRefIssues(`${pull.title || ''}\n${pull.body || ''}`), ...titleScopeIssues(pull.title)])].sort((a, b) => a - b);
}

/** Har issuet allerede en auto-bevis-kommentar (fra en collaborator) for netop denne PR og merge? */
export function hasProof(comments, { pr, issue, sha }) {
  return (comments || []).some((c) => {
    if (!COLLABORATOR_ASSOCIATIONS.has(String(c.author_association || '').toUpperCase())) return false;
    const m = parseProofMarker(c.body);
    return Boolean(m) && m.pr === Number(pr) && m.issue === Number(issue) && sameSha(m.sha, sha);
  });
}

/**
 * Plan (og ved write: skrivning) for een PR. Kaster aldrig for et enkelt
 * issue; fejl lander i planen.
 */
export async function processPr(prNumber, ctx) {
  const { opts, execGh, git, deps, deadline, now } = ctx;
  const repo = opts.repo;
  const pull = ghJson(execGh, [`repos/${repo}/pulls/${prNumber}`]);
  if (!mergedIntoMain(pull)) return { pr: prNumber, skipped: 'ikke merget til main' };
  const sha = String(pull.merge_commit_sha || '').toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return { pr: prNumber, skipped: 'ingen merge-SHA' };
  const parsed = proofDeclarationsForPr(pull);
  const declFor = (n) => parsed.declarations.find((d) => d.issue === n) || null;

  const issues = [];
  for (const n of refIssuesFor(pull)) {
    try {
      const issue = ghJson(execGh, [`repos/${repo}/issues/${n}`]);
      if (issue.pull_request) continue;
      const comments = ghPaged(execGh, `repos/${repo}/issues/${n}/comments?per_page=100`);
      if (opts.catchUp && hasProof(comments, { pr: prNumber, issue: n, sha })) continue;
      issues.push({ number: n, state: issue.state, comments, declaration: declFor(n) });
    } catch (err) {
      issues.push({ number: n, error: oneLine(err.message, 120) });
    }
  }
  const plan = { pr: prNumber, sha, issues: [] };
  if (!issues.length) return { ...plan, skipped: opts.catchUp ? 'alle refererede issues har bevis' : 'refererer ingen issues' };

  // Udledte sider: kun til udkastets note.
  let derived = { routes: [], fallback: false, error: null };
  try {
    const files = ghPaged(execGh, `repos/${repo}/pulls/${prNumber}/files?per_page=100`).map((f) => f.filename);
    derived = deriveRoutesForPr({ files, tree: deps.treeAtSha(sha) });
  } catch (err) {
    derived = { routes: [], fallback: true, error: oneLine(err.message, 120) };
  }
  plan.derived = derived;

  // Kun aabne issues faar kommentar, saa kun deres tjek koeres.
  const valid = issues.filter((i) => i.state === 'open' && i.declaration && !i.declaration.errors.length);
  const sideChecks = valid.flatMap((i) => i.declaration.sides);
  const prodChecks = valid.flatMap((i) => i.declaration.prods);

  let side = null;
  if (sideChecks.length && !opts.planOnly) {
    side = runSideChecks({
      pr: prNumber, sha, checks: sideChecks, derived: derived.routes,
      station: deps.station, prepareWorktree: deps.prepareWorktree, outRoot: deps.outRoot, deadline, now,
    });
  }

  let prod = null;
  if (prodChecks.length && !opts.planOnly) {
    let deployVerify = null;
    try {
      deployVerify = findDeployVerify({ runs: deps.deployVerifyRuns(), sha, contains: (a, d) => isAncestor(git, a, d) });
    } catch (err) {
      deployVerify = { conclusion: `ukendt: ${oneLine(err.message, 60)}`, sha: null };
    }
    const covers = deployVerify?.conclusion === 'success' && (sameSha(deployVerify.sha, sha) || deployVerify.containsMerge === true);
    const results = covers ? await runProdChecks({ checks: prodChecks, prodBase: opts.prodBase, fetchImpl: deps.fetch, deadline, now }) : [];
    prod = { deployVerify, results };
  }
  plan.deployVerify = prod?.deployVerify || null;

  for (const i of issues) {
    if (i.error) {
      plan.issues.push({ issue: i.number, error: i.error });
      continue;
    }
    try {
      const issueSide = i.declaration?.sides?.length && !i.declaration.errors.length ? side : { derived: derived.routes };
      const results = evaluateProof({ declaration: i.declaration, sha, side: issueSide, prod });
      const brand = deps.brandList.some((b) => Number(b?.issue ?? b) === i.number);
      const body = renderProofComment({ pr: prNumber, issue: i.number, sha, results, brand });
      const commentPlan = planProofComment({ comments: i.comments, pr: prNumber, issue: i.number, sha, body });
      const open = i.state === 'open';
      const entry = {
        issue: i.number,
        state: i.state,
        results,
        action: open ? commentPlan.action : 'none',
        duplicates: commentPlan.duplicates.length,
        body,
      };
      if (opts.write && open) writeComment({ execGh, repo, number: i.number, commentPlan, body });
      plan.issues.push(entry);
    } catch (err) {
      plan.issues.push({ issue: i.number, error: oneLine(err.message, 120) });
    }
  }
  return plan;
}

function writeComment({ execGh, repo, number, commentPlan, body }) {
  if (commentPlan.action === 'create') {
    execGh(['api', '-X', 'POST', `repos/${repo}/issues/${number}/comments`, '--input', '-'], JSON.stringify({ body }));
  } else if (commentPlan.action === 'edit') {
    execGh(['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${commentPlan.id}`, '--input', '-'], JSON.stringify({ body }));
  }
  // Dubletter (to koersler der samtidig ikke saa nogen kommentar) mister
  // markoeren og deres markeringslinjer, saa kun den aeldste taeller.
  for (const dup of commentPlan.duplicates) {
    execGh(['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${dup.id}`, '--input', '-'], JSON.stringify({ body: DUP_PROOF_BODY }));
  }
}

// ---------------------------------------------------------------- toget

/** Mergede PR'er til main i de sidste `hours` timer (catch-up), nyeste sidst. */
export function catchUpPrs(execGh, repo, { hours, now }) {
  const since = new Date(now() - hours * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const list = JSON.parse(
    execGh(['pr', 'list', '--repo', repo, '--state', 'merged', '--base', 'main', '--search', `merged:>=${since}`, '--limit', String(MAX_PRS * 2), '--json', 'number,mergedAt']),
  );
  return list
    .sort((a, b) => String(a.mergedAt || '').localeCompare(String(b.mergedAt || '')) || a.number - b.number)
    .map((p) => p.number);
}

export function formatPlans(plans, opts) {
  const lines = [];
  const mode = opts.write ? 'skriver' : opts.planOnly ? 'kun plan, ingen tjek kørt' : 'dry-run, intet skrevet til GitHub';
  lines.push(`Til dørs auto-bevis (${mode}): ${plans.length} PR'er.`);
  for (const p of plans) {
    if (p.error) {
      lines.push(`PR #${p.pr}: fejl: ${p.error}`);
      continue;
    }
    if (p.skipped) {
      lines.push(`PR #${p.pr}: springes over (${p.skipped})`);
      continue;
    }
    const dv = p.deployVerify ? `, Deploy verify ${p.deployVerify.conclusion}` : '';
    const derived = p.derived?.routes?.length ? `, udledte sider ${p.derived.routes.join(' ')}${p.derived.fallback ? ' (fallback)' : ''}` : '';
    lines.push(`PR #${p.pr} (merge ${p.sha.slice(0, 7)}${dv}${derived})`);
    for (const i of p.issues) {
      if (i.error) {
        lines.push(`  #${i.issue}: fejl: ${i.error}`);
        continue;
      }
      const verdict = i.results.map((r) => `${r.krav}=${r.udfald}`).join(' ');
      lines.push(`  #${i.issue} [${i.state}] ${verdict}; kommentar: ${i.action}${i.duplicates ? ` (+${i.duplicates} dublet)` : ''}`);
      if (!opts.write) for (const l of i.body.split('\n')) lines.push(`    | ${l}`);
    }
  }
  return lines.join('\n');
}

/**
 * Hele koerslen. Returnerer altid 0: runneren koerer loesrevet efter
 * merge-koeen, og en fejl her maa aldrig stoppe noget andet.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log || ((s) => process.stdout.write(`${s}\n`));
  const errorLog = deps.errorLog || ((s) => process.stderr.write(`${s}\n`));
  const now = deps.now || Date.now;
  const startedAt = now();
  const deadline = startedAt + (deps.timeoutMs ?? TOTAL_TIMEOUT_MS);

  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    errorLog(`til-doers-proof: ${err.message}`);
    return 0;
  }

  const stateDir = deps.stateDir || defaultStateDir();
  const lock = acquireLock(join(stateDir, LOCK_FILE), { now: startedAt });
  if (!lock.ok) {
    errorLog(`til-doers-proof: springer over: ${lock.reason}`);
    return 0;
  }
  try {
    const execGh = deps.execGh || defaultExecGh;
    const git = deps.git || defaultGit;
    const full = {
      treeAtSha: deps.treeAtSha || ((sha) => treeAtSha(git, sha)),
      station: deps.station || makeStation(),
      prepareWorktree: deps.prepareWorktree || makePrepareWorktree({ git, stateDir }),
      outRoot: deps.outRoot || defaultOutRoot({ env: process.env, homedir: homedir(), repoRoot: REPO_ROOT, exists: existsSync }),
      fetch: deps.fetch || globalThis.fetch,
      brandList: deps.brandList || loadBuildStop().brandList,
      deployVerifyRuns: null,
    };
    let runsCache = null;
    full.deployVerifyRuns = () => {
      runsCache ||= deps.deployVerifyRuns ? deps.deployVerifyRuns() : listDeployVerifyRuns(execGh, opts.repo);
      return runsCache;
    };

    try {
      git(['fetch', 'origin', 'main', '--quiet']);
    } catch (err) {
      errorLog(`til-doers-proof: git fetch fejlede (${oneLine(err.message, 80)}); bruger lokale commits`);
    }

    let targets = [...opts.prs];
    if (opts.catchUp) {
      try {
        for (const n of catchUpPrs(execGh, opts.repo, { hours: opts.hours, now })) if (!targets.includes(n)) targets.push(n);
      } catch (err) {
        errorLog(`til-doers-proof: kunne ikke finde mergede PR'er: ${oneLine(err.message, 120)}`);
      }
    }
    if (targets.length > MAX_PRS) {
      errorLog(`til-doers-proof: ${targets.length} PR'er, tager de ${MAX_PRS} nyeste`);
      targets = targets.slice(-MAX_PRS);
    }

    const plans = [];
    for (const pr of targets) {
      if (now() >= deadline) {
        plans.push({ pr, skipped: 'tidsgrænsen for kørslen er nået' });
        continue;
      }
      try {
        plans.push(await processPr(pr, { opts, execGh, git, deps: full, deadline, now }));
      } catch (err) {
        plans.push({ pr, error: oneLine(err.message, 160) });
      }
    }

    if (opts.json) log(JSON.stringify({ write: opts.write, planOnly: opts.planOnly, plans }, null, 2));
    else log(formatPlans(plans, opts));
  } catch (err) {
    errorLog(`til-doers-proof: uventet fejl: ${oneLine(err.message, 160)}`);
  } finally {
    lock.release();
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`til-doers-proof: ${err?.message || err}\n`);
      process.exitCode = 0;
    },
  );
}
