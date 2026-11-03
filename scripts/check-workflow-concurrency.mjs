#!/usr/bin/env node
// Vagt for CI-kø-hygiejne (#7582): PR-workflows skal annullere forældede kørsler
// på samme PR, og intet workflow må kunne annullere en kørsel på push til main,
// schedule, workflow_dispatch, merge_group eller workflow_run (merge-køen venter
// på main-kørslerne, så de skal altid køre færdigt).
//
// Regler pr. workflow-fil:
//   pr-cancel-missing  `pull_request`-trigger, men top-level `concurrency` kan
//                      ikke annullere en forældet PR-kørsel (mangler, eller
//                      cancel-in-progress er false/ukendt udtryk).
//   pr-group-not-scoped cancel er slået til for PR, men gruppen er ikke
//                      afgrænset til PR'en (pull_request.number/head_ref/ref),
//                      så PR'er kunne annullere hinanden.
//   non-pr-cancel      workflowet har en ikke-PR-trigger, og en concurrency-blok
//                      (top-level eller job) har cancel-in-progress der kan
//                      blive true for den trigger.
//
// Sikker form (bruges af de workflows #7582 har rettet):
//   concurrency:
//     group: ${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.event.pull_request.number || github.run_id }}
//     cancel-in-progress: ${{ github.event_name == 'pull_request' }}
// Ikke-PR-events får run_id som gruppe, så de hverken serialiseres eller
// erstattes i køen (GitHub annullerer en ventende kørsel i samme gruppe, også
// når cancel-in-progress er false).
//
// Brug: node scripts/check-workflow-concurrency.mjs [workflow-mappe]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const PR_EVENTS = new Set(['pull_request', 'pull_request_target']);

// review-gate.yml røres ikke (ejer: review-gaten må ikke svækkes).
export const EXEMPT_FILES = new Set(['review-gate.yml']);

// Kendte afvigelser i workflows uden for #7582's spor. Hver post skal stadig
// give netop de angivne fund; en post der ikke længere giver fundet fejler
// testen, så listen kun kan skrumpe.
export const KNOWN_EXCEPTIONS = {
  'auto-merge.yml': {
    rules: ['pr-cancel-missing'],
    reason: 'labeled-trigger: hver label-hændelse skal køre færdigt (bevidst cancel-in-progress: false)',
  },
  'roadmap-sync.yml': {
    rules: ['pr-cancel-missing'],
    reason: 'uden for #7582-sporets fil-ejerskab; opfølgning',
  },
  'til-doers.yml': {
    rules: ['pr-cancel-missing'],
    reason: 'kun pull_request: closed (én kørsel pr. PR); uden for sporets fil-ejerskab',
  },
  'done-guard.yml': {
    rules: ['non-pr-cancel'],
    reason: 'cancel-in-progress: true gælder også workflow_dispatch; uden for sporets fil-ejerskab, opfølgning',
  },
  'ts-core-ratchet.yml': {
    rules: ['non-pr-cancel'],
    reason: 'cancel-in-progress: true gælder også push til main; uden for sporets fil-ejerskab, opfølgning',
  },
  'security-grants-audit.yml': {
    rules: ['non-pr-cancel'],
    reason: 'cancel-in-progress: true gælder også ikke-PR-triggere; uden for sporets fil-ejerskab, opfølgning',
  },
  'frontend-freshness.yml': {
    rules: ['non-pr-cancel'],
    reason: 'fast gruppe med cancel-in-progress: true på schedule/dispatch; uden for sporets fil-ejerskab, opfølgning',
  },
  'prod-dependency-audit.yml': {
    rules: ['non-pr-cancel'],
    reason: 'fast gruppe med cancel-in-progress: true på push/schedule/dispatch; uden for sporets fil-ejerskab, opfølgning',
  },
  'deploy-verify.yml': {
    rules: ['non-pr-cancel'],
    reason: 'push/dispatch pr. SHA med cancel-in-progress: true (bevidst dedup pr. SHA); uden for sporets fil-ejerskab',
  },
};

const PR_GATED_RE = /^\$\{\{\s*github\.event_name\s*==\s*(['"])pull_request\1\s*\}\}$/;
const PR_SCOPE_RE = /github\.event\.pull_request\.number|github\.head_ref|github\.ref\b/;

export function getTriggers(doc) {
  // YAML 1.1-parsere kan læse `on:` som boolean true.
  const on = doc?.on ?? doc?.[true] ?? doc?.true;
  if (!on) return [];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  return Object.keys(on);
}

// 'never' | 'pr-only' | 'always'
export function classifyCancel(value) {
  if (value === undefined || value === null || value === false) return 'never';
  if (value === true) return 'always';
  const text = String(value).trim();
  if (text === 'false') return 'never';
  if (text === 'true') return 'always';
  if (PR_GATED_RE.test(text)) return 'pr-only';
  // Ukendt udtryk: kan ikke bevises falsk for ikke-PR-events.
  return 'always';
}

function normalizeConcurrency(conc) {
  if (conc === undefined || conc === null) return null;
  if (typeof conc === 'string') return { group: conc, cancel: undefined };
  return { group: conc.group, cancel: conc['cancel-in-progress'] };
}

export function analyzeWorkflow(fileName, text) {
  const doc = YAML.parse(text) ?? {};
  const triggers = getTriggers(doc);
  const hasPullRequest = triggers.includes('pull_request');
  const nonPrTriggers = triggers.filter((t) => !PR_EVENTS.has(t));
  const findings = [];

  const top = normalizeConcurrency(doc.concurrency);
  const topCancel = classifyCancel(top?.cancel);

  if (hasPullRequest && !EXEMPT_FILES.has(fileName)) {
    if (!top || topCancel === 'never') {
      findings.push({
        rule: 'pr-cancel-missing',
        message: 'pull_request-workflow uden top-level concurrency med cancel-in-progress for PR-events',
      });
    } else if (!PR_SCOPE_RE.test(String(top.group ?? ''))) {
      findings.push({
        rule: 'pr-group-not-scoped',
        message: `concurrency.group er ikke afgrænset til PR'en: ${top.group}`,
      });
    }
  }

  if (nonPrTriggers.length > 0 && !EXEMPT_FILES.has(fileName)) {
    const blocks = [['workflow', top]];
    for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
      blocks.push([`job ${jobId}`, normalizeConcurrency(job?.concurrency)]);
    }
    for (const [where, conc] of blocks) {
      if (!conc) continue;
      if (classifyCancel(conc.cancel) === 'always') {
        findings.push({
          rule: 'non-pr-cancel',
          message: `${where}: cancel-in-progress (${JSON.stringify(conc.cancel)}) kan blive true for ${nonPrTriggers.join(', ')}`,
        });
      }
    }
  }

  return { file: fileName, triggers, findings };
}

export function checkDirectory(dir, exceptions = KNOWN_EXCEPTIONS) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
  const results = files.map((f) => analyzeWorkflow(f, fs.readFileSync(path.join(dir, f), 'utf8')));
  const errors = [];
  for (const r of results) {
    const allowed = new Set(exceptions[r.file]?.rules ?? []);
    for (const finding of r.findings) {
      if (!allowed.has(finding.rule)) errors.push(`${r.file}: [${finding.rule}] ${finding.message}`);
    }
    for (const rule of allowed) {
      if (!r.findings.some((fd) => fd.rule === rule)) {
        errors.push(`${r.file}: undtagelsen [${rule}] er ikke længere nødvendig; fjern den fra KNOWN_EXCEPTIONS`);
      }
    }
  }
  for (const file of Object.keys(exceptions)) {
    if (!files.includes(file)) errors.push(`${file}: undtagelse for et workflow der ikke findes`);
  }
  return { results, errors };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = process.argv[2] ?? path.join(here, '..', '.github', 'workflows');
  const { errors } = checkDirectory(dir);
  if (errors.length > 0) {
    console.error(`check-workflow-concurrency: ${errors.length} fund`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log('check-workflow-concurrency: OK');
}
