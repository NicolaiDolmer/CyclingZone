#!/usr/bin/env node
// scripts/til-doers-check.mjs
// ============================================================
// Til-doers-tjek (#7336): beregner de 8 krav for et issue, vedligeholder EN
// kommentar pr. issue med markoeren <!-- til-doers:v1 --> og auto-lukker
// issuet som completed, naar alle 8 er ok eller na.
//
// Logikken (krav, markeringer, lukke-regler) bor i scripts/lib/til-doers.mjs.
// Denne fil er kun CLI + skrive-lag.
//
// Usage:
//   node scripts/til-doers-check.mjs --issue 7327            (dry-run: printer, skriver intet)
//   node scripts/til-doers-check.mjs --sweep                 (alle aabne claude:done + issues med tabellen)
//   node scripts/til-doers-check.mjs --pr 7422               (issues PR'en refererer)
//   node scripts/til-doers-check.mjs --sweep --apply         (skriver kommentarer og lukker)
//   node scripts/til-doers-check.mjs --sweep --json          (maskinlaesbart)
//   --repo owner/name   (default $GITHUB_REPOSITORY eller NicolaiDolmer/CyclingZone)
//
// Default er ALTID dry-run. Kun --apply skriver til GitHub. CI-workflowet
// (.github/workflows/til-doers.yml) er det eneste sted der koerer --apply.
//
// Skrive-regler:
//   - Kun AABNE issues faar kommentar eller lukning. Lukkede issues (ogsaa
//     not_planned) roeres aldrig.
//   - Kommentaren redigeres kun naar indholdet faktisk er aendret.
//   - Auto-lukning: se decideClose i lib (needs-decision og brand uden krav 8 = ok
//     lukkes aldrig automatisk).
//
// Exit codes: 0 ok, 2 ugyldige argumenter eller GitHub-/git-fejl.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseRegistry } from './generate-feature-status.mjs';
import { loadBuildStop } from './lib/build-stop.mjs';
import {
  DEFAULT_REPO,
  DONE_LABEL,
  CLOSE_COMMENT,
  defaultExecGh,
  defaultExecGit,
  evaluateDoor,
  decideClose,
  renderComment,
  fetchIssueBundle,
  findMarkerComment,
  extractRefIssues,
  resolveMainRef,
  missingKrav,
  ghJson,
  reopenedAt,
  lastMarkerAt,
} from './lib/til-doers.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export function parseArgs(argv) {
  const opts = { issues: [], sweep: false, pr: null, apply: false, json: false, repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a} kræver en værdi`);
      i += 1;
      return v;
    };
    if (a === '--issue') {
      for (const part of next().split(',')) {
        const n = Number(part.trim().replace(/^#/, ''));
        if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`ugyldigt issue-nummer: ${part}`);
        opts.issues.push(n);
      }
    } else if (a === '--pr') {
      const n = Number(next().replace(/^#/, ''));
      if (!Number.isSafeInteger(n) || n <= 0) throw new Error('ugyldigt PR-nummer');
      opts.pr = n;
    } else if (a === '--sweep') opts.sweep = true;
    else if (a === '--apply') opts.apply = true;
    else if (a === '--dry-run') opts.apply = false;
    else if (a === '--json') opts.json = true;
    else if (a === '--repo') opts.repo = next();
    else throw new Error(`ukendt argument: ${a}`);
  }
  if (!opts.sweep && !opts.pr && opts.issues.length === 0) throw new Error('angiv --issue N, --pr N eller --sweep');
  if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) throw new Error(`ugyldigt repo: ${opts.repo}`);
  return opts;
}

/** Aabne issues med claude:done + issues hvor nogen har kommenteret "Til dørs". */
export function sweepTargets(execGh, repo) {
  const set = new Set();
  const done = JSON.parse(execGh(['issue', 'list', '--repo', repo, '--state', 'open', '--label', DONE_LABEL, '--limit', '1000', '--json', 'number']));
  for (const i of done) set.add(i.number);
  const q = `repo:${repo} is:issue is:open "Til dørs" in:comments`;
  const found = execGh(['api', '-X', 'GET', 'search/issues', '-f', `q=${q}`, '-f', 'per_page=100', '--paginate', '--jq', '.items[].number']);
  for (const line of found.split(/\r?\n/).filter(Boolean)) set.add(Number(line));
  return [...set].sort((a, b) => a - b);
}

export function targetsFromPr(execGh, repo, pr) {
  const p = ghJson(execGh, [`repos/${repo}/pulls/${pr}`]);
  if (!p.merged_at) return [];
  return extractRefIssues(`${p.title || ''}\n${p.body || ''}`);
}

/**
 * Beregn + (ved apply) skriv for ét issue. Returnerer en plan der ogsaa
 * bruges i dry-run-output.
 */
export function processIssue({ number, repo, apply, execGh, execGit, mainRef, registry, patchNotesText, brandList }) {
  const bundle = fetchIssueBundle({ execGh, execGit, repo, number, mainRef });
  const { issue, comments } = bundle;
  if (issue.pull_request) return { number, skipped: 'er en PR, ikke et issue' };

  const door = evaluateDoor({ ...bundle, registry, patchNotesText });
  const body = renderComment(door);
  const existing = findMarkerComment(comments);
  const isOpen = issue.state === 'open';
  const commentAction = !isOpen ? 'none' : !existing ? 'create' : existing.body.replace(/\r\n/g, '\n') === body ? 'unchanged' : 'edit';
  const close = decideClose({ issue, door, brandList, reopened: reopenedAt(bundle.timeline), lastMarker: lastMarkerAt(comments) });

  const plan = {
    number,
    title: issue.title,
    state: issue.state,
    stateReason: issue.state_reason || null,
    door,
    missing: missingKrav(door).map((d) => d.krav),
    commentAction,
    close: close.close,
    closeReason: close.reason,
  };

  if (!apply || !isOpen) return plan;

  if (commentAction === 'create') {
    execGh(['api', '-X', 'POST', `repos/${repo}/issues/${number}/comments`, '--input', '-'], JSON.stringify({ body }));
  } else if (commentAction === 'edit') {
    execGh(['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${existing.id}`, '--input', '-'], JSON.stringify({ body }));
  }
  if (close.close) {
    execGh(['api', '-X', 'POST', `repos/${repo}/issues/${number}/comments`, '--input', '-'], JSON.stringify({ body: CLOSE_COMMENT }));
    execGh(['api', '-X', 'PATCH', `repos/${repo}/issues/${number}`, '--input', '-'], JSON.stringify({ state: 'closed', state_reason: 'completed' }));
  }
  return plan;
}

export function summarize(plans, apply) {
  const real = plans.filter((p) => !p.skipped && !p.error);
  const lines = [];
  lines.push(`Til dørs: ${real.length} issues tjekket${apply ? '' : ' (dry-run, intet skrevet)'}.`);
  const closing = real.filter((p) => p.close);
  lines.push(`${apply ? 'Lukket' : 'Ville lukke'}: ${closing.length}${closing.length ? ` (${closing.map((p) => `#${p.number}`).join(', ')})` : ''}.`);
  const counts = { create: 0, edit: 0, unchanged: 0, none: 0 };
  for (const p of real) counts[p.commentAction] += 1;
  lines.push(`Kommentar: ${counts.create} ny, ${counts.edit} opdateret, ${counts.unchanged} uændret, ${counts.none} ikke åben.`);
  const perKrav = new Map();
  for (const p of real) for (const k of p.missing) perKrav.set(k, (perKrav.get(k) || 0) + 1);
  if (perKrav.size) {
    lines.push(`Mangler pr. krav: ${[...perKrav.entries()].sort((a, b) => a[0] - b[0]).map(([k, c]) => `${k}=${c}`).join(', ')}.`);
  }
  for (const p of plans.filter((x) => x.error)) lines.push(`Fejl #${p.number}: ${p.error}`);
  return lines.join('\n');
}

export function main(argv = process.argv.slice(2), deps = {}) {
  const execGh = deps.execGh || defaultExecGh;
  const execGit = deps.execGit || defaultExecGit;
  const log = deps.log || ((s) => process.stdout.write(`${s}\n`));
  const errorLog = deps.errorLog || ((s) => process.stderr.write(`${s}\n`));

  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    errorLog(`til-doers-check: ${err.message}`);
    return 2;
  }

  const registry = deps.registry || parseRegistry(readFileSync(join(ROOT, 'docs', 'FEATURE_REGISTRY.yml'), 'utf8'));
  const patchNotesText = deps.patchNotesText ?? readFileSync(join(ROOT, 'frontend', 'src', 'data', 'patchNotes.js'), 'utf8');
  const brandList = deps.brandList || loadBuildStop().brandList;
  const mainRef = deps.mainRef || resolveMainRef(execGit);

  let targets;
  try {
    const set = new Set(opts.issues);
    if (opts.pr) for (const n of targetsFromPr(execGh, opts.repo, opts.pr)) set.add(n);
    if (opts.sweep) for (const n of sweepTargets(execGh, opts.repo)) set.add(n);
    targets = [...set].sort((a, b) => a - b);
  } catch (err) {
    errorLog(`til-doers-check: kunne ikke finde issues: ${err.message}`);
    return 2;
  }

  const plans = [];
  for (const number of targets) {
    try {
      plans.push(processIssue({ number, repo: opts.repo, apply: opts.apply, execGh, execGit, mainRef, registry, patchNotesText, brandList }));
    } catch (err) {
      plans.push({ number, error: String(err.message || err).split('\n')[0] });
    }
  }

  if (opts.json) {
    log(JSON.stringify({ apply: opts.apply, plans }, null, 2));
  } else {
    for (const p of plans) {
      if (p.skipped || p.error) continue;
      const miss = p.missing.length ? `mangler ${p.missing.join(',')}` : 'alle ok/na';
      log(`#${p.number} [${p.state}] ${miss}; kommentar: ${p.commentAction}; ${p.close ? 'LUKKES' : `lukkes ikke (${p.closeReason})`}`);
    }
    log(summarize(plans, opts.apply));
  }
  return plans.some((p) => p.error) ? 2 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
