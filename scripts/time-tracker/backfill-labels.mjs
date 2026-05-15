#!/usr/bin/env node
// Backfill cat:* labels på issues via title-heuristik
// Issue: #390
//
// Usage:
//   node scripts/time-tracker/backfill-labels.mjs --dry-run    # vis forslag (default)
//   node scripts/time-tracker/backfill-labels.mjs --apply      # anvend labels
//   node scripts/time-tracker/backfill-labels.mjs --apply --only 137,279,287

import { execSync } from 'node:child_process';

// Rules evalueres i rækkefølge. Første match vinder.
// Bracket-prefixes (`[bug]`, `[fix]`, `[ops]` osv.) afgør først — de er eksplicitte signaler.
const RULES = [
  // Eksplicitte bracket-prefixes (højeste prioritet)
  { cat: 'cat:bug',          re: /^\s*\[(bug|fix)\]/i },
  { cat: 'cat:infra',        re: /^\s*\[(ops|db|api|infra|platform|scaling|security|test|qa|refactor|audit)\]/i },
  { cat: 'cat:user-feature', re: /^\s*\[(feature|ux|design)\]/i },
  { cat: 'cat:founder',      re: /^\s*\[meta\]/i },
  { cat: 'cat:ai-ops',       re: /^\s*\[(quality|bot|ai[\s-]?ops|dx)\]/i },

  // Indholds-keywords
  { cat: 'cat:ai-ops',       re: /\b(ai[\s-]?ops|token|harness|hook|skill|plugin|mcp|claude|codex|workflow|dx[\s-]|prompt|guardrail|memory|now\.md|patch[\s-]?notes?|cold[\s-]?start|phase[\s-]?\d|verdensklasse\s+ai|agent[\s-]?loop|epic:ai|bootstrap[\s-]?(script|new\s+pc|ny\s+pc)|ny\s+pc|new\s+pc|agents\.md|settings\.json|tok\b|forensic[\s-]?audit)\b/i },
  { cat: 'cat:founder',      re: /\b(monetiz|pricing|marketing|launch|fundrais|strategi|strategy|investor|board|founder|premium|pay[\s-]?to[\s-]?win|revenue|subscription|brand|positioning|waitlist|seo|gdpr|privatliv)\b/i },
  { cat: 'cat:community',    re: /\b(discord|beta|feedback|interview|survey|community|onboarding\s+flow|user\s*test)\b/i },
  { cat: 'cat:infra',        re: /\b(rls|migration|deploy|backend|supabase|edge\s?function|database|schema|cron|secret|sentry|playwright|e2e|smoke[\s-]?test|loadtest|drift[\s-]?monitor|scaling|loop\s+a|baseline)\b/i },
  { cat: 'cat:bug',          re: /\b(bug|regression|krash|kraesh|brudt)\b/i },

  // Default
  { cat: 'cat:user-feature', re: /.*/ },
];

const ALL_CATS = ['cat:user-feature', 'cat:bug', 'cat:infra', 'cat:community', 'cat:ai-ops', 'cat:founder'];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { dryRun: true, only: null, state: 'all' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') opts.dryRun = false;
    else if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--only') opts.only = new Set(args[++i].split(',').map(s => parseInt(s.trim())));
    else if (args[i] === '--state') opts.state = args[++i];
  }
  return opts;
}

function classify(title) {
  for (const rule of RULES) {
    if (rule.re.test(title)) return rule.cat;
  }
  return 'cat:user-feature';
}

function main() {
  const opts = parseArgs();
  console.error(`Mode: ${opts.dryRun ? 'DRY-RUN' : 'APPLY'} · state: ${opts.state}${opts.only ? ' · only: ' + [...opts.only].join(',') : ''}`);

  const json = execSync(
    `gh issue list --state ${opts.state} --limit 1000 --json number,title,labels`,
    { encoding: 'utf8' }
  );
  const issues = JSON.parse(json);

  const proposals = [];
  for (const issue of issues) {
    if (opts.only && !opts.only.has(issue.number)) continue;
    const existing = issue.labels.find(l => ALL_CATS.includes(l.name));
    if (existing) continue; // skip already-categorized
    const cat = classify(issue.title);
    proposals.push({ number: issue.number, title: issue.title, cat });
  }

  console.error(`Issues uden cat:*-label: ${proposals.length}`);
  console.error('');

  const byCat = {};
  for (const p of proposals) {
    (byCat[p.cat] = byCat[p.cat] || []).push(p);
  }
  for (const cat of ALL_CATS) {
    const list = byCat[cat] || [];
    console.log(`\n## ${cat} (${list.length})`);
    for (const p of list.slice(0, 30)) {
      console.log(`  #${String(p.number).padEnd(4)} ${p.title.slice(0, 90)}`);
    }
    if (list.length > 30) console.log(`  ... + ${list.length - 30} flere`);
  }

  if (opts.dryRun) {
    console.error('\nDRY-RUN — ingen ændringer anvendt. Kør med --apply for at anvende.');
    return;
  }

  console.error(`\nApplying ${proposals.length} labels...`);
  let ok = 0, fail = 0;
  for (const p of proposals) {
    try {
      execSync(`gh issue edit ${p.number} --add-label "${p.cat}"`, { stdio: ['ignore', 'ignore', 'pipe'] });
      ok++;
      if (ok % 20 === 0) console.error(`  ${ok}/${proposals.length}...`);
    } catch (e) {
      console.error(`  FAIL #${p.number}: ${e.message.split('\n')[0]}`);
      fail++;
    }
  }
  console.error(`Done. OK: ${ok}, fail: ${fail}`);
}

main();
