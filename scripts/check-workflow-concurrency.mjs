#!/usr/bin/env node
// Vagt for CI-kø-hygiejne (#7582): PR-workflows skal annullere forældede kørsler
// på samme PR, og intet workflow må kunne annullere en kørsel på push til main,
// schedule, workflow_dispatch, merge_group eller workflow_run (merge-køen venter
// på main-kørslerne, så de skal altid køre færdigt).
//
// Regler pr. workflow-fil:
//   pr-cancel-missing  `pull_request`- eller `pull_request_target`-trigger, men
//                      top-level `concurrency` kan ikke annullere en forældet
//                      kørsel for netop det event (mangler, cancel-in-progress
//                      er false, eller udtrykket dækker kun det andet PR-event).
//                      Undtaget: en PR-trigger hvis `types` kun er engangs-
//                      hændelser (opened/reopened/closed), som aldrig giver en
//                      forældet kørsel at annullere.
//   pr-group-not-scoped cancel er slået til for PR, men gruppen er ikke
//                      afgrænset til PR'en (pull_request.number/head_ref/ref),
//                      så PR'er kunne annullere hinanden.
//   non-pr-cancel      workflowet har en beskyttet ikke-PR-trigger (alt andet
//                      end PR-events og issue_comment/issues), og en
//                      concurrency-blok (top-level eller job) har
//                      cancel-in-progress der kan blive true for den trigger.
//                      issue_comment/issues må annullere: en nyere kommentar
//                      genberegner det samme issue (fx Til dørs, #7582).
//   non-pr-group-shared workflowet kører på push/merge_group, og en
//                      concurrency-gruppe er ikke unik pr. kørsel eller SHA
//                      (run_id/sha). GitHub erstatter en ventende kørsel i samme
//                      gruppe, også når cancel-in-progress er false.
//
// Regel på tværs af filer:
//   duplicate-name     to workflows har samme `name:`. `github.workflow` er
//                      navnet, så grupper bygget på det ville blive delt, og
//                      to workflows kunne annullere hinanden.
//
// Sikker form (bruges af de workflows #7582 har rettet):
//   concurrency:
//     group: ${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.event.pull_request.number || github.run_id }}
//     cancel-in-progress: ${{ github.event_name == 'pull_request' }}
// Ikke-PR-events får run_id som gruppe, så de hverken serialiseres eller
// erstattes i køen (GitHub annullerer en ventende kørsel i samme gruppe, også
// når cancel-in-progress er false). Et pull_request_target-workflow bruger
// samme form med 'pull_request_target' i begge udtryk.
//
// Brug: node scripts/check-workflow-concurrency.mjs [workflow-mappe]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const PR_EVENTS = new Set(['pull_request', 'pull_request_target']);
// Ikke-PR-events hvor en nyere kørsel må annullere en ældre: de genberegner
// samme issue ud fra hele tråden, så den nyeste kørsel dækker den ældre.
export const CANCELLABLE_NON_PR_EVENTS = new Set(['issue_comment', 'issues']);
// PR-hændelser der højst sker én gang pr. tilstandsskift; de giver ingen
// forældet kørsel at annullere (synchronize/edited/labeled gør).
export const ONE_SHOT_PR_TYPES = new Set(['opened', 'reopened', 'closed']);

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
  'add-to-project.yml': {
    rules: ['pr-cancel-missing'],
    reason: 'pull_request_target (opened/reopened/ready_for_review) uden concurrency; kort bekvemmeligheds-job, uden for sporets fil-ejerskab, opfølgning',
  },
  'roadmap-sync.yml': {
    rules: ['non-pr-group-shared'],
    reason: 'sync-jobbets faste gruppe er bevidst serialisering af prod-skrivning; en erstattet ventende sync er ufarlig, den nyere kører idempotent på det nyeste register',
  },
  'auto-migrate.yml': {
    rules: ['non-pr-group-shared'],
    reason: 'fast gruppe er bevidst serialisering af prod-migrationer (to må aldrig køre samtidig)',
  },
  'backend-image.yml': {
    rules: ['non-pr-group-shared'],
    reason: 'gruppe pr. github.ref serialiserer main-push; uden for sporets fil-ejerskab, opfølgning',
  },
  'frontend-freshness.yml': {
    rules: ['non-pr-cancel'],
    reason: 'fast gruppe med cancel-in-progress: true på schedule/dispatch; uden for sporets fil-ejerskab, opfølgning',
  },
  'prod-dependency-audit.yml': {
    rules: ['non-pr-cancel', 'non-pr-group-shared'],
    reason: 'fast gruppe med cancel-in-progress: true på push/schedule/dispatch; uden for sporets fil-ejerskab, opfølgning',
  },
  'deploy-verify.yml': {
    rules: ['non-pr-cancel'],
    reason: 'push/dispatch pr. SHA med cancel-in-progress: true (bevidst dedup pr. SHA: push og dispatch for samme SHA skal ikke verificere to gange)',
  },
};

const EXPR_RE = /^\$\{\{([\s\S]*)\}\}$/;
const EVENT_EQ_RE = /^github\.event_name\s*==\s*(['"])([a-z_]+)\1$/;
const PR_SCOPE_RE = /github\.event\.pull_request\.number|github\.head_ref|github\.ref\b/;
// Events som merge-køen venter på: deres kørsler må ikke dele en gruppe på
// tværs af commits (en ventende kørsel erstattes, også uden cancel-in-progress).
export const QUEUE_SENSITIVE_EVENTS = new Set(['push', 'merge_group']);
const RUN_UNIQUE_RE = /github\.run_id|github\.sha\b|github\.event\.workflow_run\.head_sha/;

export function getTriggers(doc) {
  // YAML 1.1-parsere kan læse `on:` som boolean true.
  const on = doc?.on ?? doc?.[true] ?? doc?.true;
  if (!on) return [];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  return Object.keys(on);
}

// De events hvor cancel-in-progress kan blive true: tomt sæt = aldrig, null =
// altid (eller et udtryk der ikke kan bevises falsk for noget event). Kun en
// ren disjunktion af `github.event_name == '<event>'` genkendes som afgrænset.
export function cancelEvents(value) {
  if (value === undefined || value === null || value === false) return new Set();
  if (value === true) return null;
  const text = String(value).trim();
  if (text === 'false') return new Set();
  if (text === 'true') return null;
  const expr = EXPR_RE.exec(text);
  if (!expr) return null;
  const events = new Set();
  for (const term of expr[1].split('||')) {
    const m = EVENT_EQ_RE.exec(term.trim());
    if (!m) return null;
    events.add(m[2]);
  }
  return events;
}

// 'never' | 'pr-only' | 'events' | 'always'
export function classifyCancel(value) {
  const events = cancelEvents(value);
  if (events === null) return 'always';
  if (events.size === 0) return 'never';
  if ([...events].every((e) => PR_EVENTS.has(e))) return 'pr-only';
  return 'events';
}

// PR-triggere der kan give forældede kørsler (alt andet end rene engangs-types).
export function cancellablePrTriggers(doc, triggers) {
  const on = doc?.on ?? doc?.[true] ?? doc?.true;
  return triggers.filter((t) => {
    if (!PR_EVENTS.has(t)) return false;
    const types = on && typeof on === 'object' && !Array.isArray(on) ? on[t]?.types : undefined;
    const list = Array.isArray(types) ? types : types ? [types] : [];
    return !(list.length > 0 && list.every((type) => ONE_SHOT_PR_TYPES.has(String(type))));
  });
}

function normalizeConcurrency(conc) {
  if (conc === undefined || conc === null) return null;
  if (typeof conc === 'string') return { group: conc, cancel: undefined };
  return { group: conc.group, cancel: conc['cancel-in-progress'] };
}

export function analyzeWorkflow(fileName, text) {
  const doc = YAML.parse(text) ?? {};
  const triggers = getTriggers(doc);
  const prTriggers = cancellablePrTriggers(doc, triggers);
  const nonPrTriggers = triggers.filter((t) => !PR_EVENTS.has(t));
  const protectedTriggers = nonPrTriggers.filter((t) => !CANCELLABLE_NON_PR_EVENTS.has(t));
  const findings = [];

  const top = normalizeConcurrency(doc.concurrency);
  const topEvents = top ? cancelEvents(top.cancel) : new Set();

  if (prTriggers.length > 0 && !EXEMPT_FILES.has(fileName)) {
    const uncovered = topEvents === null ? [] : prTriggers.filter((t) => !topEvents.has(t));
    if (!top || uncovered.length > 0) {
      findings.push({
        rule: 'pr-cancel-missing',
        message: `${(top ? uncovered : prTriggers).join(', ')}-workflow uden top-level concurrency med cancel-in-progress for det event`,
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
    const queueTriggers = nonPrTriggers.filter((t) => QUEUE_SENSITIVE_EVENTS.has(t));
    for (const [where, conc] of blocks) {
      if (!conc) continue;
      if (queueTriggers.length > 0 && !RUN_UNIQUE_RE.test(String(conc.group ?? ''))) {
        findings.push({
          rule: 'non-pr-group-shared',
          message: `${where}: concurrency.group (${conc.group}) er ikke unik pr. kørsel/SHA for ${queueTriggers.join(', ')}; en ventende kørsel kan blive erstattet`,
        });
      }
      const events = cancelEvents(conc.cancel);
      const hit = events === null ? protectedTriggers : protectedTriggers.filter((t) => events.has(t));
      if (hit.length > 0) {
        findings.push({
          rule: 'non-pr-cancel',
          message: `${where}: cancel-in-progress (${JSON.stringify(conc.cancel)}) kan blive true for ${hit.join(', ')}`,
        });
      }
    }
  }

  const name = typeof doc.name === 'string' ? doc.name.trim() : null;
  return { file: fileName, name, triggers, findings };
}

// Uden `name:` er github.workflow filstien og dermed unik; kun navngivne tæller.
export function duplicateNames(results) {
  const byName = new Map();
  for (const r of results) {
    if (!r.name) continue;
    byName.set(r.name, [...(byName.get(r.name) ?? []), r.file]);
  }
  const errors = [];
  for (const [name, files] of byName) {
    if (files.length > 1) {
      errors.push(`${files.join(', ')}: [duplicate-name] workflow-navnet "${name}" bruges af ${files.length} filer; concurrency-grupper med github.workflow ville blive delt`);
    }
  }
  return errors;
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
  errors.push(...duplicateNames(results));
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
