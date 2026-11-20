#!/usr/bin/env node
// merge-guard.mjs: merge-vagten i auto-toget (#8331, ejer 20/11).
//
// Baggrund: PR'er med ejerens merge-markoer gik i staa i stilhed. Set 20/11:
// markoer paa et gammelt commit (efter merge af main), hoved-CI der aldrig startede
// paa HEAD, og review-gate roed fordi det nye hoved ikke var reviewet. Auto-toget
// sprang dem bare over, koersel efter koersel.
//
// Vagten koeres af scripts/merge-autotrain.mjs efter vurderingen og:
//   1. finder hver aaben PR med en ejer-markoer, der IKKE er eligible i koerslen,
//      og klassificerer aarsagen (guardFindings, ren funktion);
//   2. taeller i .claude/run/merge-guard.json hvor mange koersler i traek hver
//      PR+aarsag er sprunget over (nulstilles naar PR'en er vaek eller eligible);
//   3. selvhelbreder KUN "CI ikke startet": een gang pr. hoved-SHA lukkes og
//      genaabnes PR'en (samme greb som manuelt 20/11), saa CI faar en ny chance.
//      Intet andet goeres automatisk: en markoer flyttes aldrig (ejerens go er
//      bundet til den SHA, ejeren har set);
//   4. skriver PR'en i `alerts`, naar den er sprunget over to koersler i traek af
//      samme aarsag, og logger "MERGE-VAGT: #N ...". Stop-hooken
//      (scripts/check-now-md.sh) laeser alerts og beder Claude spoerge ejeren.
//
// CLI (til Stop-hooken; exit altid 0):
//   node scripts/merge-guard.mjs hook-lines [--file <sti>] [--now-epoch <sek>]
//   skriver "noegle<TAB>tekst" pr. aktuel alert. Uden --file: MERGE_GUARD_FILE
//   eller <hoved-checkout>/.claude/run/merge-guard.json.
//
// Tests: node --test scripts/merge-autotrain.test.mjs

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitCommonRoot } from './merge-queue-active-marker.mjs';

export const GUARD_RELATIVE = join('.claude', 'run', 'merge-guard.json');
// Hoved-workflowet "CI (AI-Autopilot)".
export const CI_WORKFLOW_FILE = 'ci.yml';
// Saa laenge maa et nyt hoved vente paa sin foerste CI-koersel, foer den kaldes "ikke startet".
export const CI_START_GRACE_MS = 15 * 60_000;
// Alert foerst efter to koersler i traek med samme aarsag (een koersel kan vaere tilfaeldig).
export const ALERT_AFTER_RUNS = 2;
// Stop-hooken ignorerer en tilstand, auto-toget ikke har skrevet laenge (opgaven staar stille).
export const HOOK_MAX_AGE_MS = 6 * 60 * 60_000;

export const REASON = Object.freeze({
  DRAFT: 'kladde',
  CONFLICT: 'konflikt',
  CI_NOT_STARTED: 'ci-ikke-startet',
  RED: 'roede-checks',
  REVIEW: 'review-mangler',
  STALE_MARKER: 'gammel-markoer',
  PENDING: 'checks-afventer',
  REOPEN_FAILED: 'genaabning-fejlede',
  OTHER: 'andet',
});

const LABEL = Object.freeze({
  [REASON.DRAFT]: 'kladde',
  [REASON.CONFLICT]: 'konflikt med main',
  [REASON.CI_NOT_STARTED]: 'CI ikke startet paa hovedet',
  [REASON.RED]: 'roede checks',
  [REASON.REVIEW]: 'review mangler paa hovedet',
  [REASON.STALE_MARKER]: 'markoer paa gammelt commit',
  [REASON.PENDING]: 'checks afventer',
  [REASON.REOPEN_FAILED]: 'lukket af vagten, men IKKE genaabnet',
  [REASON.OTHER]: 'anden aarsag',
});

const SUGGESTION = Object.freeze({
  [REASON.DRAFT]: 'markér PR\'en klar (gh pr ready), hvis den er faerdig',
  [REASON.CONFLICT]: 'merge main ind og loes konflikten; ejeren giver derefter nyt go paa det nye hoved',
  [REASON.CI_NOT_STARTED]: 'vagten har allerede lukket+genaabnet een gang paa dette hoved; tjek Actions eller push et nyt commit',
  [REASON.RED]: 'ret de roede checks',
  [REASON.REVIEW]: 'bed Codex/Claude om review af det nye hoved',
  [REASON.STALE_MARKER]: 'vis ejeren det nye hoved; nyt "merge" giver en ny markoer (vagten flytter aldrig en markoer)',
  [REASON.PENDING]: 'vent paa CI',
  [REASON.REOPEN_FAILED]: 'genaabn PR\'en straks: gh pr reopen',
  [REASON.OTHER]: 'se auto-togets log for aarsagen',
});

// Checks der afventer er normalt (CI kan staa i GitHubs koe i over en time): ingen alert.
const SILENT = new Set([REASON.PENDING]);

const OWNER_MARKER_GLOBAL_RE = /<!--\s*merge-autotrain:\s*ejer-merge\s+sha=([0-9a-f]{7,40})\s*-->/gi;

const lower = (s) => String(s ?? '').toLowerCase();
const sha7 = (s) => String(s ?? '').slice(0, 7);

// ── Ren kerne ──────────────────────────────────────────────────────────────

/** Seneste ejer-markoer-SHA (kommentarer i kronologisk raekkefoelge), uanset hoved. null = ingen. */
export function latestOwnerMarkerSha(comments, ownerLogin) {
  const owner = lower(ownerLogin);
  if (!owner) return null;
  let latest = null;
  for (const c of comments ?? []) {
    if (lower(c?.author?.login) !== owner) continue;
    for (const m of String(c?.body ?? '').matchAll(OWNER_MARKER_GLOBAL_RE)) latest = m[1].toLowerCase();
  }
  return latest;
}

/** Kraever klassifikationen CI-fakta (koersler + commit-tid)? Kun naar checks ikke er groenne. */
export function needsCiFacts(e) {
  return Boolean(e?.ownerMarkerSha) && !e?.eligible && String(e?.reason ?? '').startsWith('checks:');
}

/** Ingen koersel af hoved-CI for hovedet, og hovedet er aeldre end fristen. Ukendt = nej (ingen genstart). */
export function ciNotStarted(facts, now) {
  if (!facts || facts.ciRuns !== 0) return false;
  const t = Date.parse(String(facts.headCommittedAt ?? ''));
  return Number.isFinite(t) && now.getTime() - t > CI_START_GRACE_MS;
}

/** Aarsagen til at en PR med ejer-markoer ikke er eligible. */
export function classifyStall(e, facts, now) {
  const reason = String(e?.reason ?? '');
  if (reason === 'draft') return { reason: REASON.DRAFT, detail: '' };
  if (/^mergeable=(CONFLICTING|DIRTY)/i.test(reason)) return { reason: REASON.CONFLICT, detail: reason };
  if (reason.startsWith('checks:') && ciNotStarted(facts, now)) {
    return { reason: REASON.CI_NOT_STARTED, detail: `ingen ${CI_WORKFLOW_FILE}-koersel for ${sha7(e?.headSha)}` };
  }
  const red = /^checks: roed: (.*)$/.exec(reason);
  if (red) return { reason: REASON.RED, detail: red[1] };
  if (reason.startsWith('checks: afventer')) return { reason: REASON.PENDING, detail: reason.replace(/^checks: /, '') };
  if (/review-gate/.test(reason)) return { reason: REASON.REVIEW, detail: reason };
  const head = lower(e?.headSha);
  const marker = lower(e?.ownerMarkerSha);
  if (marker && !head.startsWith(marker)) {
    return { reason: REASON.STALE_MARKER, detail: `markoer ${sha7(marker)}, hoved ${sha7(head)}` };
  }
  return { reason: REASON.OTHER, detail: reason };
}

/**
 * Fund: hver PR med ejer-markoer, der ikke er eligible i denne koersel.
 * `ciFacts` = { [pr]: { ciRuns, headCommittedAt } } for PR'er hvor needsCiFacts er sand.
 */
export function guardFindings({ evaluations, ciFacts = {}, now = new Date() }) {
  return (evaluations ?? [])
    .filter((e) => e?.ownerMarkerSha && !e.eligible && Number.isSafeInteger(e.number))
    .map((e) => ({
      pr: e.number,
      title: String(e.title ?? ''),
      headSha: String(e.headSha ?? ''),
      markerSha: e.ownerMarkerSha,
      ...classifyStall(e, ciFacts[e.number], now),
    }));
}

/** PR'er der skal lukkes+genaabnes nu: CI ikke startet, og ikke allerede forsoegt paa samme hoved. */
export function restartCandidates(findings, prev) {
  const done = prev?.restarts ?? {};
  return (findings ?? []).filter((f) => f.reason === REASON.CI_NOT_STARTED && done[f.pr]?.headSha !== f.headSha);
}

export function alertFor(entry) {
  return {
    pr: entry.pr,
    title: entry.title,
    reason: entry.reason,
    label: LABEL[entry.reason] ?? entry.reason,
    detail: entry.detail ?? '',
    since: entry.since,
    runs: entry.count,
    suggestion: SUGGESTION[entry.reason] ?? SUGGESTION[REASON.OTHER],
  };
}

/**
 * Naeste tilstand. Samme PR+aarsag som sidst = taelleren stiger og `since` bevares;
 * ny aarsag = starter forfra; PR uden fund (eligible, lukket, merget, uden markoer)
 * = nulstillet. Genstarter huskes pr. PR, saa laenge PR'en er aaben.
 */
export function nextGuardState(prev, findings, { now = new Date(), openNumbers = [] } = {}) {
  const at = now.toISOString();
  const prevEntries = prev?.entries ?? {};
  const entries = {};
  for (const f of findings ?? []) {
    const old = prevEntries[f.pr];
    const same = old && old.reason === f.reason;
    entries[f.pr] = {
      pr: f.pr,
      title: f.title,
      headSha: f.headSha,
      reason: f.reason,
      detail: f.detail ?? '',
      since: same ? old.since : at,
      count: same ? (Number(old.count) || 0) + 1 : 1,
    };
  }
  const open = new Set((openNumbers ?? []).map(Number));
  const restarts = {};
  for (const [n, r] of Object.entries(prev?.restarts ?? {})) if (open.has(Number(n))) restarts[n] = r;
  const alerts = Object.values(entries)
    .filter((e) => e.count >= ALERT_AFTER_RUNS && !SILENT.has(e.reason))
    .sort((a, b) => a.pr - b.pr)
    .map(alertFor);
  return { version: 1, updatedAt: at, entries, restarts, alerts };
}

const COPENHAGEN = new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const clean = (s, max = 80) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').replace(/"/g, '\'').slice(0, max);

export function alertLine(a) {
  const since = Number.isFinite(Date.parse(a?.since)) ? COPENHAGEN.format(new Date(a.since)) : '?';
  const detail = a?.detail ? `: ${clean(a.detail, 120)}` : '';
  return `MERGE-VAGT: #${a?.pr} "${clean(a?.title)}" har ejerens markoer, men staar stille siden ${since} (${a?.label ?? a?.reason}${detail}; ${a?.runs ?? '?'} koersler i traek). Forslag: ${a?.suggestion ?? ''}.`;
}

/** Linjer til Stop-hooken: "noegle<TAB>tekst". Tom, hvis tilstanden er for gammel eller ugyldig. */
export function hookLines(state, { now = new Date() } = {}) {
  const updated = Date.parse(String(state?.updatedAt ?? ''));
  if (!Number.isFinite(updated) || now.getTime() - updated > HOOK_MAX_AGE_MS) return [];
  return (Array.isArray(state?.alerts) ? state.alerts : []).map((a) => {
    const key = `merge-guard:${a?.pr}:${a?.reason}:${a?.since}`.replace(/\s+/g, '');
    return `${key}\t${alertLine(a)} Spoerg ejeren nu.`;
  });
}

// ── IO ─────────────────────────────────────────────────────────────────────

export function readGuardState(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeGuardState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

function defaultGh(args) {
  const res = spawnSync('gh', args, { encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  if (res.error) return { status: -1, stdout: '', stderr: String(res.error.message ?? res.error) };
  return { status: res.status, stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? '') };
}

/** Antal koersler af hoved-CI for SHA'en + hovedets commit-tid. Kaster ved gh-fejl. */
export function fetchCiFacts({ repo, headSha, gh = defaultGh }) {
  const runs = gh(['run', 'list', '--repo', repo, '--workflow', CI_WORKFLOW_FILE, '--commit', headSha, '--limit', '5', '--json', 'databaseId']);
  if (runs.status !== 0) throw new Error(`gh run list exit ${runs.status}: ${runs.stderr.trim().slice(0, 160)}`);
  const commit = gh(['api', `repos/${repo}/commits/${headSha}`, '--jq', '.commit.committer.date']);
  if (commit.status !== 0) throw new Error(`gh api commits exit ${commit.status}: ${commit.stderr.trim().slice(0, 160)}`);
  const list = JSON.parse(runs.stdout || '[]');
  return { ciRuns: Array.isArray(list) ? list.length : 0, headCommittedAt: commit.stdout.trim() };
}

/** Luk + genaabn (som manuelt 20/11). Genaabningen proeves to gange; en lukket PR maa ikke blive liggende. */
export function restartPr(number, { repo, gh = defaultGh }) {
  const closed = gh(['pr', 'close', String(number), '--repo', repo]);
  if (closed.status !== 0) return { ok: false, closed: false, reopened: false, error: closed.stderr.trim().slice(0, 160) };
  let reopened = gh(['pr', 'reopen', String(number), '--repo', repo]);
  if (reopened.status !== 0) reopened = gh(['pr', 'reopen', String(number), '--repo', repo]);
  if (reopened.status !== 0) return { ok: false, closed: true, reopened: false, error: reopened.stderr.trim().slice(0, 160) };
  return { ok: true, closed: true, reopened: true };
}

/**
 * Een vagt-koersel efter auto-togets vurdering. Fail-soft: fejl logges, toget koerer videre.
 * Dry-run: klassificerer og logger, men genstarter intet og skriver ingen tilstand.
 */
export function runMergeGuard({ evaluations, repo, repoRoot, now = new Date(), dryRun = false, gh = defaultGh, file = null, log = () => {} }) {
  const stateFile = file ?? join(repoRoot, GUARD_RELATIVE);
  const prev = readGuardState(stateFile);
  const ciFacts = {};
  for (const e of (evaluations ?? []).filter(needsCiFacts)) {
    try {
      ciFacts[e.number] = fetchCiFacts({ repo, headSha: e.headSha, gh });
    } catch (err) {
      log(`  vagt: #${e.number}: CI-fakta kunne ikke hentes (${err?.message ?? err}).`);
    }
  }
  const findings = guardFindings({ evaluations, ciFacts, now });
  for (const f of findings) log(`  vagt: #${f.pr} har ejer-markoer, men er ikke klar: ${LABEL[f.reason] ?? f.reason}${f.detail ? ` (${f.detail})` : ''}.`);
  const state = nextGuardState(prev, findings, { now, openNumbers: (evaluations ?? []).map((e) => e?.number) });
  const restarted = [];
  for (const f of restartCandidates(findings, prev)) {
    if (dryRun) { log(`  DRY-RUN: MERGE-VAGT ville lukke+genaabne #${f.pr} (CI ikke startet paa ${sha7(f.headSha)}).`); continue; }
    const res = restartPr(f.pr, { repo, gh });
    // Registreres ogsaa ved fejl, saa samme hoved aldrig proeves igen.
    state.restarts[f.pr] = { headSha: f.headSha, at: now.toISOString(), ok: res.ok };
    restarted.push({ pr: f.pr, ...res });
    if (res.ok) {
      log(`  MERGE-VAGT: #${f.pr} lukket+genaabnet, fordi CI ikke startede paa ${sha7(f.headSha)}.`);
    } else if (res.closed && !res.reopened) {
      state.alerts.push(alertFor({ pr: f.pr, title: f.title, reason: REASON.REOPEN_FAILED, detail: res.error, since: now.toISOString(), count: 1 }));
      log(`  MERGE-VAGT: #${f.pr} blev lukket, men genaabning FEJLEDE (${res.error}). Genaabn straks.`);
    } else {
      log(`  MERGE-VAGT: #${f.pr} kunne ikke lukkes til genstart (${res.error}).`);
    }
  }
  for (const a of state.alerts) log(`  ${alertLine(a)}`);
  if (!dryRun) {
    try { writeGuardState(stateFile, state); } catch (err) { log(`  vagt: tilstanden kunne ikke gemmes (${err?.message ?? err}).`); }
  }
  return { findings, state, restarted };
}

function parseCli(argv) {
  const out = { cmd: argv[0], file: process.env.MERGE_GUARD_FILE || null, nowEpoch: null };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--file') out.file = argv[++i] ?? null;
    else if (argv[i] === '--now-epoch') out.nowEpoch = Number(argv[++i]);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const cli = parseCli(process.argv.slice(2));
    if (cli.cmd === 'hook-lines') {
      const file = cli.file ?? join(gitCommonRoot(process.cwd()) ?? process.cwd(), GUARD_RELATIVE);
      const now = Number.isFinite(cli.nowEpoch) && cli.nowEpoch > 0 ? new Date(cli.nowEpoch * 1000) : new Date();
      for (const line of hookLines(readGuardState(file), { now })) process.stdout.write(`${line}\n`);
    }
  } catch { /* fail-soft: hooken maa aldrig fejle pga. vagten */ }
  process.exitCode = 0;
}
