#!/usr/bin/env node
// Vagt for kladde-PR'er uden tung CI (#8802, ejer 26/11): en kladde-PR koerer
// ingen tunge jobs, og naar den markeres klar, koerer hele suiten paa samme HEAD.
//
// Regler pr. workflow med en `pull_request`-trigger der kan give forældede
// koersler (types indeholder synchronize, eller types mangler = default):
//   ready-missing   types mangler `ready_for_review`. Uden den koerer de
//                   oversprungne jobs aldrig, naar kladden markeres klar, og
//                   PR'en star tilbage med kladdens "skipped" som groent.
//   draft-unguarded et job kan koere paa en kladde: dets `if` naevner ikke
//                   `github.event.pull_request.draft`, jobbet er ikke afgraenset
//                   til andre events end pull_request, og det arver ikke et
//                   kladde-skip via `needs` (et job med always()/!cancelled()/
//                   failure() i sin `if` arver det IKKE). Billige vagter der
//                   bevidst koerer paa kladder, staar i DRAFT_ALLOWED med grund.
//
// Hvorfor job-niveau og ikke workflow-niveau: et oversprunget job rapporterer
// "skipped", som GitHub regner som groent for et required check. Et workflow der
// slet ikke starter, efterlader required checks som "expected" og blokerer
// merge-koeen. Kladder kan ikke merges, og scripts/lib/pr-checks.mjs regner
// koersler fra foer seneste ready_for_review som forældede.
//
// Brug: node scripts/check-workflow-draft-skip.mjs [workflow-mappe]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

// Filer vagten ikke maaler, med grund.
export const EXEMPT_FILES = new Map([
  ['review-gate.yml', 'roeres ikke (ejer: review-gaten maa ikke svaekkes); review-gate-jobbet er allerede kladde-afgraenset, og review-gate-tests tager sekunder'],
  ['dependabot-auto-merge.yml', 'koerer kun for dependabot[bot], der aldrig aabner kladder'],
]);

// Jobs der bevidst koerer paa kladder: billige (under et minut, maalt 26/11)
// og giver lanen hurtig besked, som preflight ikke allerede giver lokalt.
export const DRAFT_ALLOWED = {
  'feature-registry-check.yml:registry-freshness':
    'billig (sekunder), hurtig besked naar FEATURE_STATUS.md er ude af sync med registret',
  'yaml-validate.yml:actionlint':
    'billig, fanger en workflow-fejl ved foerste push (kun ved aendrede workflow-filer)',
  'secret-scan.yml:gitleaks':
    'repoet er offentligt: en laekket noegle skal fanges ved foerste push, ikke foerst ved ready',
};

const DRAFT_RE = /github\.event\.pull_request\.draft/;
const STATUS_FN_RE = /\b(always|cancelled|failure)\(\)/;
const EVENT_EQ_RE = /github\.event_name\s*==\s*'([a-z_]+)'/g;
const NOT_PR_RE = /github\.event_name\s*!=\s*'pull_request'/;

export function getOn(doc) {
  // YAML 1.1-parsere kan laese `on:` som boolean true.
  return doc?.on ?? doc?.[true] ?? doc?.true;
}

/** Types for pull_request-triggeren, null hvis triggeren mangler, 'default' hvis types mangler. */
export function pullRequestTypes(doc) {
  const on = getOn(doc);
  if (!on) return null;
  if (typeof on === 'string') return on === 'pull_request' ? 'default' : null;
  if (Array.isArray(on)) return on.includes('pull_request') ? 'default' : null;
  if (!('pull_request' in on)) return null;
  const types = on.pull_request?.types;
  if (types === undefined || types === null) return 'default';
  return [].concat(types).map(String);
}

/** Kan triggeren give en ny koersel paa en kladde (nyt push)? */
export function runsOnDraftPushes(types) {
  return types === 'default' || (Array.isArray(types) && types.includes('synchronize'));
}

/** Er jobbets `if` afgraenset til andre events end pull_request? */
export function excludesPullRequest(ifText) {
  if (!ifText) return false;
  const text = String(ifText);
  if (NOT_PR_RE.test(text) && !text.includes('||')) return true;
  const events = [...text.matchAll(EVENT_EQ_RE)].map((m) => m[1]);
  if (!events.length || text.includes('!=')) return false;
  return !events.includes('pull_request');
}

export function analyzeWorkflow(file, text) {
  const doc = YAML.parse(text);
  const findings = [];
  if (EXEMPT_FILES.has(file)) return { findings };
  const types = pullRequestTypes(doc);
  if (types === null || !runsOnDraftPushes(types)) return { findings };
  if (types === 'default' || !types.includes('ready_for_review')) {
    findings.push({ file, rule: 'ready-missing', detail: 'pull_request.types mangler ready_for_review' });
  }

  const jobs = doc?.jobs ?? {};
  const guarded = new Map();
  const isGuarded = (name, seen = new Set()) => {
    if (guarded.has(name)) return guarded.get(name);
    if (seen.has(name)) return false;
    seen.add(name);
    const job = jobs[name] ?? {};
    const ifText = job.if === undefined || job.if === null ? '' : String(job.if);
    let ok = DRAFT_RE.test(ifText) || excludesPullRequest(ifText) || Boolean(DRAFT_ALLOWED[`${file}:${name}`]);
    if (!ok && !STATUS_FN_RE.test(ifText)) {
      // Et job uden status-funktion springes over, naar et job det har brug for er sprunget over.
      const needs = [].concat(job.needs ?? []);
      ok = needs.some((dep) => jobs[dep] && isGuarded(dep, seen) && !DRAFT_ALLOWED[`${file}:${dep}`]);
    }
    guarded.set(name, ok);
    return ok;
  };
  for (const name of Object.keys(jobs)) {
    if (!isGuarded(name)) {
      findings.push({ file, rule: 'draft-unguarded', detail: `job '${name}' kan koere paa en kladde-PR` });
    }
  }
  return { findings };
}

export function checkDirectory(dir) {
  const errors = [];
  const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
  for (const file of files) {
    errors.push(...analyzeWorkflow(file, fs.readFileSync(path.join(dir, file), 'utf8')).findings);
  }
  for (const key of Object.keys(DRAFT_ALLOWED)) {
    const [file, job] = key.split(':');
    const full = path.join(dir, file);
    const doc = fs.existsSync(full) ? YAML.parse(fs.readFileSync(full, 'utf8')) : null;
    if (!doc?.jobs?.[job]) errors.push({ file, rule: 'stale-allowlist', detail: `DRAFT_ALLOWED peger paa '${key}', som ikke findes` });
  }
  return { errors, files: files.length };
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = process.argv[2] ?? path.join(here, '..', '.github', 'workflows');
  const { errors, files } = checkDirectory(dir);
  if (errors.length) {
    console.error(`check-workflow-draft-skip: ${errors.length} fund (#8802):`);
    for (const e of errors) console.error(`  - ${e.file} [${e.rule}] ${e.detail}`);
    console.error('Tilfoej `if: ${{ !github.event.pull_request.draft }}` paa jobbet (eller kombinér med den eksisterende if),');
    console.error('og ready_for_review i pull_request.types. Billige vagter: DRAFT_ALLOWED med grund.');
    process.exitCode = 1;
    return;
  }
  console.log(`check-workflow-draft-skip: OK (${files} workflow-filer)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
