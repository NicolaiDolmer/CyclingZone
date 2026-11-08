#!/usr/bin/env node
// merge-autotrain.mjs: auto-tog for merge-koeen (#7654, ejer-valg 4/11).
//
// Baggrund: merges gik for langsomt, fordi et tog kun koerte naar en session
// huskede at starte det. Dette script koeres af en Windows-planlagt opgave paa
// PC1 (scripts/install-merge-autotrain-task.ps1, hvert 20. minut) og:
//   1. lister aabne, ikke-draft PR'er mod main;
//   2. vaelger dem der er klar: paakraevede checks groenne, review-gate groen
//      (samme regel som scripts/lib/league-check.ps1), MERGEABLE, og en
//      staaende kategori fra scripts/merge-queue-classify.mjs (hard rule 35).
//      EJER-GO koerer kun med ejerens eksplicitte merge-markoer (se nedenfor);
//   3. kalder scripts/merge-queue.ps1 -Pr "<N>" -Repo <repo>, een PR ad gangen
//      efter en frisk vurdering (hovedet maa ikke have flyttet sig), og kun hvis
//      ingen anden koe koerer (tog-markoeren fra #7633: levende markoer = goer intet);
//   4. melder i Discord-ops (DISCORD_OPS_WEBHOOK_URL, fail-soft) naar en PR har
//      vaeret klar i over READY_ALERT_AFTER_MS uden at blive merget, hoejst een
//      besked pr. PR pr. ALERT_THROTTLE_MS. Tilstand: .claude/run/ (gitignoreret).
//
// Ejerens merge-markoer: EJER-GO-PR'er (ogsaa dem med den klaebende
// klassifikator-markoer "merge-queue-category: ejer-go") medtages KUN naar en
// kommentar fra repo-ejerens konto indeholder
//   <!-- merge-autotrain: ejer-merge sha=<head-sha, min. 7 hex> -->
// og SHA'en matcher PR'ens nuvaerende hoved. Den skrives kun efter ejerens
// ordrette "merge" (hard rule 35). Et nyt push goer markoeren ugyldig, saa et
// go aldrig daekker kode ejeren ikke har set. Kommentarer fra andre konti
// ignoreres (repoet er offentligt).
//
// Merge-koeen genkontrollerer selv checks, review-gate, liga-audit og boelge-
// ownership foer hvert merge; udvaelgelsen her er kun forfilteret.
//
// CLI (exit altid 0, fail-soft):
//   node scripts/merge-autotrain.mjs [--dry-run] [--log] [--repo owner/name]
//   --dry-run  laeser og viser beslutningerne; ingen koe, ingen Discord, ingen tilstand.
//   --log      skriver ogsaa til .claude/run/merge-autotrain.log (bruges af den planlagte opgave).
//
// Tests: node --test scripts/merge-autotrain.test.mjs

import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORY, DEFAULT_REPO, classifyPr, fetchMigrationFacts, formatClassification } from './merge-queue-classify.mjs';
import { gitCommonRoot, markerFilePath, readActiveMarker } from './merge-queue-active-marker.mjs';
import { deploymentAttemptState, handedOffRunVerdict } from './ci/deploy-verification-state.mjs';

export const READY_ALERT_AFTER_MS = 2 * 60 * 60 * 1000;
export const ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000;
export const STATE_RELATIVE = join('.claude', 'run', 'merge-autotrain-state.json');
export const LOG_RELATIVE = join('.claude', 'run', 'merge-autotrain.log');
// Codex P1 (#7657): en koe der sluttede uden exit 0 (main-CI/deploy roed eller uverificeret)
// laaser toget paa tvaers af koersler, til main's HEAD er positivt verificeret.
export const BLOCK_RELATIVE = join('.claude', 'run', 'merge-autotrain-block.json');
const LOG_ROTATE_BYTES = 5 * 1024 * 1024;
const HTTP_TIMEOUT_MS = 15_000;

// Labels der altid holder en PR ude af toget.
export const HOLD_LABELS = Object.freeze(['claude:blocked', 'codex:blocked-access', 'do-not-merge', 'hold']);

export const OWNER_MERGE_MARKER_RE = /<!--\s*merge-autotrain:\s*ejer-merge\s+sha=([0-9a-f]{7,40})\s*-->/i;

// ── Ren kerne ──────────────────────────────────────────────────────────────

/** Paakraevede checks: mindst eet, og alle pass/skipping (som `gh pr checks --required` exit 0). */
export function requiredChecksStatus(checks) {
  const list = Array.isArray(checks) ? checks : [];
  if (!list.length) return { green: false, reason: 'ingen paakraevede checks fundet' };
  const notGreen = list.filter((c) => !['pass', 'skipping'].includes(String(c?.bucket ?? '')));
  if (notGreen.length) {
    const pending = notGreen.some((c) => c?.bucket === 'pending');
    return { green: false, reason: `${pending ? 'afventer' : 'roed'}: ${notGreen.map((c) => c?.name ?? '?').slice(0, 3).join(', ')}` };
  }
  if (!list.some((c) => c?.bucket === 'pass')) return { green: false, reason: 'kun skippede paakraevede checks' };
  return { green: true, reason: 'groen' };
}

const isTrustedReviewGate = (c) => c?.name === 'review-gate' && c?.event === 'pull_request_target';

function startedAtMs(c) {
  const t = Date.parse(String(c?.startedAt ?? ''));
  // Spejler league-check.ps1: uden (gyldigt) starttidspunkt sorteres koerslen som nyest.
  return Number.isFinite(t) && new Date(t).getUTCFullYear() > 1 ? t : Number.MAX_SAFE_INTEGER;
}

/** Review-gate (#6654): nyeste koersel fra pull_request_target skal vaere pass. */
export function reviewGateStatus(allChecks) {
  const runs = (Array.isArray(allChecks) ? allChecks : []).filter(isTrustedReviewGate);
  if (!runs.length) return { green: false, reason: 'intet review-gate-check fra pull_request_target' };
  const latest = [...runs].sort((a, b) => startedAtMs(b) - startedAtMs(a))[0];
  if (latest.bucket === 'pass') return { green: true, reason: 'groen' };
  return { green: false, reason: latest.bucket === 'pending' ? 'review-gate afventer' : 'review-gate roed' };
}

/** Ejerens merge-markoer, skrevet fra ejerens konto og bundet til det nuvaerende hoved. */
export function hasOwnerMergeApproval(comments, { headSha, ownerLogin }) {
  const head = String(headSha ?? '').toLowerCase();
  const owner = String(ownerLogin ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(head) || !owner) return false;
  return (comments ?? []).some((c) => {
    if (String(c?.author?.login ?? '').toLowerCase() !== owner) return false;
    const m = OWNER_MERGE_MARKER_RE.exec(String(c?.body ?? ''));
    return Boolean(m) && head.startsWith(m[1].toLowerCase());
  });
}

function labelNames(labels) {
  return (labels ?? []).map((l) => String(typeof l === 'string' ? l : l?.name ?? '').toLowerCase()).filter(Boolean);
}

/**
 * Vurderer een PR. `ready` = alt groent (bruges ogsaa til alarmen);
 * `eligible` = ready og maa koere i toget uden ejeren (eller med ejerens markoer).
 */
/** Afslag der ikke kraever check- eller klassifikationskald. null = gaa videre. */
export function precheck(pr, { baseBranch = 'main' } = {}) {
  if (pr?.isDraft) return 'draft';
  if (String(pr?.baseRefName ?? '') !== baseBranch) return `base er ikke ${baseBranch}`;
  const held = labelNames(pr?.labels).find((l) => HOLD_LABELS.includes(l));
  if (held) return `label ${held}`;
  if (pr?.mergeable !== 'MERGEABLE') return `mergeable=${pr?.mergeable ?? 'UNKNOWN'}`;
  return null;
}

export function evaluatePr(pr, { requiredChecks, allChecks, classification, ownerLogin, baseBranch = 'main' }) {
  const out = {
    number: Number(pr?.number),
    title: String(pr?.title ?? ''),
    headSha: String(pr?.headRefOid ?? ''),
    ready: false,
    eligible: false,
    category: classification?.category ?? null,
    classification: classification ? formatClassification(classification) : null,
    reason: '',
  };
  const no = (reason) => ({ ...out, reason });
  const pre = precheck(pr, { baseBranch });
  if (pre) return no(pre);
  const req = requiredChecksStatus(requiredChecks);
  if (!req.green) return no(`checks: ${req.reason}`);
  const gate = reviewGateStatus(allChecks);
  if (!gate.green) return no(gate.reason);
  const ready = { ...out, ready: true };
  if (!classification) return { ...ready, reason: 'kunne ikke klassificeres (ejer-go)' };
  if (classification.category !== CATEGORY.OWNER) return { ...ready, eligible: true, reason: `staaende kategori ${classification.category}` };
  if (hasOwnerMergeApproval(pr?.comments, { headSha: pr?.headRefOid, ownerLogin })) {
    return { ...ready, eligible: true, reason: 'ejer-go med ejerens merge-markoer paa nuvaerende hoved' };
  }
  return { ...ready, reason: 'klar, men kraever ejer-go' };
}

/** PR-numre til toget, aeldste foerst (stabil raekkefoelge). */
export function selectTrain(evaluations) {
  return evaluations.filter((e) => e.eligible).map((e) => e.number).sort((a, b) => a - b);
}

/** Gaa intet, hvis en koe allerede koerer (levende tog-markoer). */
export function decideAction({ activeMarker, train }) {
  if (activeMarker) return { run: false, reason: `merge-koe koerer allerede (pid ${activeMarker.pid}, startet ${activeMarker.startedAt})` };
  if (!train.length) return { run: false, reason: 'ingen klare PR\'er i staaende kategori' };
  return { run: true, reason: `${train.length} PR'er klar: ${train.map((n) => `#${n}`).join(', ')}` };
}

function emptyState() {
  return { version: 1, prs: {} };
}

/**
 * Opdaterer "klar siden"-uret. En PR der ikke er klar (eller fik nyt hoved)
 * starter forfra; lukkede/mergede PR'er falder ud, fordi de ikke er listet.
 * Alarm-tidspunktet bevares, saa throttlen overlever et kort roedt mellemspil.
 */
export function updateReadyState(prev, evaluations, now) {
  const prevPrs = prev?.prs && typeof prev.prs === 'object' ? prev.prs : {};
  const next = emptyState();
  for (const e of evaluations) {
    if (!e.ready) {
      if (prevPrs[e.number]?.lastAlertAt) next.prs[e.number] = { lastAlertAt: prevPrs[e.number].lastAlertAt };
      continue;
    }
    const old = prevPrs[e.number];
    const sameHead = old?.readySince && old.headSha === e.headSha;
    next.prs[e.number] = {
      headSha: e.headSha,
      readySince: sameHead ? old.readySince : now.toISOString(),
      ...(old?.lastAlertAt ? { lastAlertAt: old.lastAlertAt } : {}),
    };
  }
  return next;
}

/** PR'er der har vaeret klar for laenge og ikke er meldt inden for throttle-vinduet. */
export function dueAlerts(state, evaluations, now) {
  const due = [];
  for (const e of evaluations) {
    if (!e.ready) continue;
    const s = state?.prs?.[e.number];
    const since = Date.parse(String(s?.readySince ?? ''));
    if (!Number.isFinite(since) || now.getTime() - since < READY_ALERT_AFTER_MS) continue;
    const last = Date.parse(String(s?.lastAlertAt ?? ''));
    if (Number.isFinite(last) && now.getTime() - last < ALERT_THROTTLE_MS) continue;
    due.push({ ...e, readySince: s.readySince, waitedMs: now.getTime() - since });
  }
  return due;
}

export function markAlerted(state, numbers, now) {
  const next = { ...state, prs: { ...(state?.prs ?? {}) } };
  for (const n of numbers) next.prs[n] = { ...(next.prs[n] ?? {}), lastAlertAt: now.toISOString() };
  return next;
}

function hours(ms) {
  return `${Math.floor(ms / 3_600_000)} t ${Math.floor((ms % 3_600_000) / 60_000)} min`;
}

/** Discord-ops-besked (ingen spillertekst; kun PR-nummer, titel og status). */
export function buildAlertMessage(alerts, repo = DEFAULT_REPO) {
  const lines = alerts.map((a) => {
    const why = a.eligible ? 'staaende kategori, men ikke merget' : 'venter paa ejer-go';
    return `- #${a.number} ${a.title.slice(0, 90)} (klar i ${hours(a.waitedMs)}; ${why}) https://github.com/${repo}/pull/${a.number}`;
  });
  return { content: `Merge-auto-tog: ${alerts.length} klar(e) PR(er) har ventet over 2 timer.\n${lines.join('\n')}`.slice(0, 1900) };
}

// ── IO ─────────────────────────────────────────────────────────────────────

export function readState(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.prs && typeof parsed.prs === 'object' ? parsed : emptyState();
  } catch {
    return emptyState();
  }
}

export function writeState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

function runGhRaw(args) {
  const res = spawnSync('gh', args, { encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw res.error;
  return { status: res.status, stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? '') };
}

function ghJson(args, { allowExit = [0] } = {}) {
  const res = runGhRaw(args);
  if (!allowExit.includes(res.status)) throw new Error(`gh ${args.slice(0, 2).join(' ')} exit ${res.status}: ${res.stderr.trim().slice(0, 200)}`);
  return JSON.parse(res.stdout || 'null');
}

function ghText(args) {
  const res = runGhRaw(args);
  if (res.status !== 0) {
    const err = new Error(res.stderr.trim().slice(0, 300));
    err.stderr = res.stderr;
    throw err;
  }
  return res.stdout;
}

const PR_FIELDS = 'number,title,body,labels,author,comments,isDraft,mergeable,baseRefName,headRefOid,baseRefOid,changedFiles';

// gh pr checks: exit 1 = noget fejler, exit 8 = afventer; JSON-outputtet er det samme.
const CHECKS_EXIT = [0, 1, 8];

/**
 * Den fulde filliste til klassifikationen (REST, pagineret): GraphQL-listen i
 * `gh pr list` kan vaere afkortet, og en omdoebning skal ogsaa vurderes paa sin
 * kildesti (kode flyttet ind under docs/ maa ikke blive "docs"). Kildestien
 * taeller som slettet, saa en omdoebt migration altid er ejer-go.
 * null = listen er ufuldstaendig (klassifikationen bliver da ejer-go).
 */
export function completeFileList(restFiles, changedFiles) {
  const list = Array.isArray(restFiles) ? restFiles.flat() : [];
  if (!list.length || !Number.isSafeInteger(changedFiles) || list.length !== changedFiles) return null;
  const files = [];
  for (const f of list) {
    if (!f?.filename) return null;
    files.push({ path: f.filename, additions: Number(f.additions) || 0, deletions: Number(f.deletions) || 0 });
    if (f.previous_filename && f.previous_filename !== f.filename) {
      files.push({ path: f.previous_filename, additions: 0, deletions: Math.max(1, Number(f.deletions) || 0) });
    }
  }
  return files;
}

/** Vurderer een PR (checks, review-gate, fuld filliste, klassifikation). */
export function evaluateOne(pr, { repo, ownerLogin, gh, log = () => {} }) {
  // Billige afslag foerst: ingen check- eller klassifikationskald for drafts/konflikter.
  if (precheck(pr)) return evaluatePr(pr, { ownerLogin });
  const requiredChecks = gh.json(['pr', 'checks', String(pr.number), '--repo', repo, '--required', '--json', 'name,bucket'], { allowExit: CHECKS_EXIT }) ?? [];
  const allChecks = gh.json(['pr', 'checks', String(pr.number), '--repo', repo, '--json', 'name,bucket,startedAt,event'], { allowExit: CHECKS_EXIT }) ?? [];
  let classification = null;
  if (requiredChecksStatus(requiredChecks).green && reviewGateStatus(allChecks).green) {
    try {
      const rest = gh.json(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${pr.number}/files?per_page=100`]);
      const files = completeFileList(rest, pr.changedFiles);
      if (!files) {
        log(`  #${pr.number}: fillisten er ufuldstaendig; behandles som ejer-go.`);
      } else {
        const full = { ...pr, files };
        Object.assign(full, fetchMigrationFacts(full, repo, { runGh: gh.text }));
        classification = classifyPr(full);
      }
    } catch (err) {
      log(`  #${pr.number}: klassifikation fejlede (${err?.message ?? err}); behandles som ejer-go.`);
    }
  }
  return evaluatePr(pr, { requiredChecks, allChecks, classification, ownerLogin });
}

const DEFAULT_GH = { json: ghJson, text: ghText };

export function collectEvaluations({ repo, ownerLogin, gh = DEFAULT_GH, log = () => {} }) {
  const prs = gh.json(['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '100', '--json', PR_FIELDS]) ?? [];
  const evaluations = [];
  for (const pr of prs) {
    try {
      evaluations.push(evaluateOne(pr, { repo, ownerLogin, gh, log }));
    } catch (err) {
      log(`  #${pr.number}: kunne ikke vurderes (${err?.message ?? err}); springes over.`);
    }
  }
  return evaluations;
}

/** Frisk vurdering af een PR lige foer koeen startes for den. */
export function reevaluatePr(number, { repo, ownerLogin, gh = DEFAULT_GH, log = () => {} }) {
  const pr = gh.json(['pr', 'view', String(number), '--repo', repo, '--json', PR_FIELDS]);
  return evaluateOne(pr, { repo, ownerLogin, gh, log });
}

/**
 * Maa koeen startes for PR'en nu? Den skal stadig vaere eligible, og hovedet maa
 * ikke have flyttet sig siden udvaelgelsen (ejer-go og kategori gaelder et hoved).
 */
export function confirmBeforeQueue(selected, fresh) {
  if (!fresh?.eligible) return { ok: false, reason: `ikke laengere klar (${fresh?.reason ?? 'ukendt'})` };
  if (!/^[0-9a-f]{40}$/i.test(String(fresh.headSha)) || fresh.headSha !== selected.headSha) {
    return { ok: false, reason: `hovedet har flyttet sig (${String(selected.headSha).slice(0, 7)} -> ${String(fresh.headSha).slice(0, 7)})` };
  }
  return { ok: true, reason: 'uaendret og klar' };
}

async function postDiscord(fetchFn, url, payload) {
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

export function readBlock(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && Number.isInteger(parsed.pr) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Codex P1 (#7657): er main's aktuelle HEAD positivt verificeret? CI (main) skal vaere
 * faerdig og groen. Findes en deploy-verify-koersel for samme SHA, afgoer koeens egen
 * klassifikator det (deploy-verification-state.mjs): releasen skal vaere 'released' og
 * release checks 'ok'. Workflowets samlede conclusion taeller ikke, for "Deployment
 * still pending" slutter ogsaa groent. Alt andet (koerer, roed, ukendt, fejl) = nej.
 */
export function mainVerifiedFromRuns({ headSha, ciRuns = [], deploy = null }) {
  if (!/^[0-9a-f]{40}$/i.test(String(headSha))) return { ok: false, reason: 'main-HEAD ukendt' };
  const ci = ciRuns.find((r) => r.headSha === headSha);
  if (!ci) return { ok: false, reason: `ingen CI (main) for ${headSha.slice(0, 7)} endnu` };
  if (ci.status !== 'completed' || ci.conclusion !== 'success') return { ok: false, reason: `CI (main) ${headSha.slice(0, 7)}: ${ci.status}/${ci.conclusion || '-'}` };
  if (deploy) {
    const state = deploymentAttemptState(deploy.run, deploy.jobs, headSha, 1);
    if (state !== 'released') return { ok: false, reason: `deploy ${headSha.slice(0, 7)}: ${state}` };
    const verdict = handedOffRunVerdict(deploy.run, deploy.jobs);
    if (verdict !== 'ok') return { ok: false, reason: `release checks ${headSha.slice(0, 7)}: ${verdict}` };
  }
  return { ok: true, reason: `main ${headSha.slice(0, 7)} groen${deploy ? ' og released' : ''}` };
}

function defaultCheckMain({ repo }) {
  const head = runGhRaw(['api', `repos/${repo}/commits/main`, '--jq', '.sha']);
  if (head.status !== 0) return { ok: false, reason: 'main-HEAD kunne ikke hentes' };
  const headSha = head.stdout.trim();
  const json = (args, what) => {
    const res = runGhRaw(args);
    if (res.status !== 0) throw new Error(`${what} fejlede`);
    return JSON.parse(res.stdout || 'null');
  };
  try {
    const ciRuns = json(['run', 'list', '--repo', repo, '--workflow', 'ci.yml', '--branch', 'main', '--limit', '20', '--json', 'headSha,status,conclusion'], 'gh run list ci.yml');
    const deployRuns = json(['run', 'list', '--repo', repo, '--workflow', 'deploy-verify.yml', '--branch', 'main', '--limit', '20', '--json', 'databaseId,headSha'], 'gh run list deploy-verify.yml');
    const match = (deployRuns || []).find((r) => r.headSha === headSha);
    let deploy = null;
    if (match) {
      const run = json(['api', `repos/${repo}/actions/runs/${match.databaseId}`], 'deploy-run');
      const jobs = json(['api', `repos/${repo}/actions/runs/${match.databaseId}/attempts/${run.run_attempt}/jobs?per_page=100`], 'deploy-jobs');
      deploy = { run, jobs };
    }
    return mainVerifiedFromRuns({ headSha, ciRuns: ciRuns || [], deploy });
  } catch (err) {
    return { ok: false, reason: String(err?.message ?? err) };
  }
}

const SCRIPT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Koeen koeres fra samme checkout som dette script (den planlagte opgave peger paa hoved-checkoutet).
function defaultRunQueue({ train, repo, logFile, expectHead }) {
  const repoRoot = SCRIPT_ROOT;
  const script = join(repoRoot, 'scripts', 'merge-queue.ps1');
  const args = ['-NoProfile', '-NonInteractive', '-File', script, '-Pr', train.join(','), '-Repo', repo];
  // Codex P1 (#7657): koeen merger kun det hoved, der blev vurderet og godkendt her.
  if (expectHead) args.push('-ExpectHead', expectHead);
  let fd = null;
  try {
    if (logFile) fd = openSync(logFile, 'a');
    const res = spawnSync('pwsh', args, { cwd: repoRoot, windowsHide: true, stdio: ['ignore', fd ?? 'inherit', fd ?? 'inherit'] });
    return res.error ? -1 : res.status ?? -1;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function rotateLog(file) {
  try {
    if (statSync(file).size > LOG_ROTATE_BYTES) renameSync(file, `${file}.1`);
  } catch { /* ingen log endnu */ }
}

export function parseArgs(argv) {
  const out = { dryRun: false, log: false, repo: DEFAULT_REPO };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--log') out.log = true;
    else if (a === '--repo') out.repo = argv[++i] ?? DEFAULT_REPO;
  }
  return out;
}

/**
 * Een koersel. Alle IO-afhaengigheder kan injiceres (tests).
 * Raekkefoelge: tog-markoer -> vurdering -> alarm -> tilstand -> koe (een PR ad gangen, frisk tjek foer hver).
 */
export async function run({
  argv = process.argv.slice(2),
  env = process.env,
  now = new Date(),
  // Tilstand og log ligger hos hoved-checkoutet (som tog-markoeren), ogsaa fra et worktree.
  repoRoot = gitCommonRoot(SCRIPT_ROOT) ?? SCRIPT_ROOT,
  readMarker = () => readActiveMarker(markerFilePath({ cwd: SCRIPT_ROOT })),
  evaluate = (opts) => collectEvaluations(opts),
  reevaluate = (n, opts) => reevaluatePr(n, opts),
  runQueue = defaultRunQueue,
  checkMain = defaultCheckMain,
  blockFile = null,
  fetchFn = globalThis.fetch,
  stateFile = null,
  out = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  const opts = parseArgs(argv);
  const logFile = opts.log && !opts.dryRun ? join(repoRoot, LOG_RELATIVE) : null;
  if (logFile) { mkdirSync(dirname(logFile), { recursive: true }); rotateLog(logFile); }
  const log = (line) => {
    out(line);
    if (logFile) { try { appendFileSync(logFile, `${line}\n`, 'utf8'); } catch { /* fail-soft */ } }
  };
  const file = stateFile ?? join(repoRoot, STATE_RELATIVE);
  const ownerLogin = opts.repo.split('/')[0];
  log(`[${now.toISOString()}] merge-auto-tog${opts.dryRun ? ' (DRY-RUN)' : ''}`);

  const activeMarker = readMarker();
  if (activeMarker) {
    log(`  Goer intet: ${decideAction({ activeMarker, train: [] }).reason}.`);
    return { action: 'skip-active', train: [], alerts: [] };
  }
  const blockPath = blockFile ?? join(repoRoot, BLOCK_RELATIVE);
  let block = readBlock(blockPath);
  if (block) {
    const verified = checkMain({ repo: opts.repo });
    if (!verified.ok) {
      log(`  LAAST: #${block.pr} sluttede med exit ${block.exit} (${block.at}); main er ikke verificeret (${verified.reason}). Ingen nye merges.`);
    } else {
      log(`  Laasen fra #${block.pr} haeves: ${verified.reason}.`);
      if (!opts.dryRun) { try { unlinkSync(blockPath); } catch { /* allerede vaek */ } }
      block = null;
    }
  }

  let evaluations;
  try {
    evaluations = evaluate({ repo: opts.repo, ownerLogin, log });
  } catch (err) {
    log(`  Kunne ikke liste PR'er (${err?.message ?? err}); proever igen naeste koersel.`);
    return { action: 'error', train: [], alerts: [] };
  }
  log(`  ${evaluations.length} aabne PR'er vurderet, ${evaluations.filter((x) => x.ready).length} klar.`);
  for (const e of evaluations.filter((x) => x.ready)) log(`  #${e.number} klar: ${e.reason}${e.classification ? ` [${e.classification}]` : ''}`);
  const train = selectTrain(evaluations);
  const decision = decideAction({ activeMarker: null, train });

  const prev = readState(file);
  let state = updateReadyState(prev, evaluations, now);
  // Ogsaa eligible PR'er meldes: er en PR stadig klar efter 2 timer, har toget fejlet for den.
  const alerts = dueAlerts(state, evaluations, now);
  if (alerts.length) {
    const payload = buildAlertMessage(alerts, opts.repo);
    if (opts.dryRun) {
      log(`  DRY-RUN: ville melde ${alerts.map((a) => `#${a.number}`).join(', ')} i Discord-ops.`);
    } else if (!String(env.DISCORD_OPS_WEBHOOK_URL ?? '').trim()) {
      log(`  ALARM (DISCORD_OPS_WEBHOOK_URL ikke sat, kun her): ${payload.content}`);
    } else if (await postDiscord(fetchFn, env.DISCORD_OPS_WEBHOOK_URL, payload)) {
      log(`  Discord-ops meldt om ${alerts.map((a) => `#${a.number}`).join(', ')}.`);
      state = markAlerted(state, alerts.map((a) => a.number), now);
    } else {
      log('  Discord-ops-beskeden kunne ikke sendes; proever igen naeste koersel.');
    }
  }
  if (!opts.dryRun) {
    try { writeState(file, state); } catch (err) { log(`  ADVARSEL: tilstand ikke gemt (${err?.message ?? err}).`); }
  }

  if (block) {
    return { action: 'blocked', train, alerts };
  }
  if (!decision.run) {
    log(`  Ingen koe: ${decision.reason}.`);
    return { action: 'none', train, alerts };
  }
  if (opts.dryRun) {
    log(`  DRY-RUN: ville koere merge-queue.ps1 -Repo ${opts.repo} een PR ad gangen: ${train.map((n) => `-Pr "${n}"`).join(', ')} (${decision.reason}).`);
    return { action: 'dry-run', train, alerts };
  }
  // Een PR pr. koe-koersel, og frisk vurdering lige foer: merge-queue.ps1 binder ikke
  // merget til det hoved der blev vurderet her, saa et push efter udvaelgelsen maa
  // ikke arve kategori eller ejer-go. Ventetiden mellem tjek og merge er da koeens egen.
  const byNumber = new Map(evaluations.map((e) => [e.number, e]));
  const queued = [];
  const results = [];
  for (const n of train) {
    if (readMarker()) { log('  En anden merge-koe er startet; resten venter til naeste koersel.'); break; }
    let fresh;
    try {
      fresh = reevaluate(n, { repo: opts.repo, ownerLogin, log });
    } catch (err) {
      log(`  #${n}: frisk vurdering fejlede (${err?.message ?? err}); springes over.`);
      continue;
    }
    const confirm = confirmBeforeQueue(byNumber.get(n), fresh);
    if (!confirm.ok) { log(`  #${n}: ${confirm.reason}; springes over.`); continue; }
    log(`  Starter merge-queue.ps1 -Pr "${n}" -Repo ${opts.repo}.`);
    const code = runQueue({ train: [n], repo: opts.repo, logFile, expectHead: fresh.headSha });
    log(`  merge-queue.ps1 (#${n}) sluttede med exit ${code}.`);
    queued.push(n);
    results.push({ pr: n, exit: code });
    if (code !== 0) {
      // Codex P1 (#7657): roed/uverificeret main eller deploy stopper toget, og laasen
      // holder paa tvaers af koersler, til main er positivt verificeret.
      try { writeState(blockPath, { pr: n, exit: code, at: now.toISOString() }); } catch (err) { log(`  ADVARSEL: laasen kunne ikke gemmes (${err?.message ?? err}).`); }
      log(`  Toget stopper efter exit ${code} paa #${n}; laast til main er verificeret.`);
      break;
    }
  }
  return { action: 'queue', train, alerts, queued, results };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await run();
  } catch (err) {
    process.stdout.write(`merge-auto-tog ADVARSEL: uventet fejl: ${err?.message ?? err}\n`);
  }
  process.exitCode = 0;
}
