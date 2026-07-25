#!/usr/bin/env node
/**
 * Opretter GitHub-issues + kommentarer fra Discord-sweep 2026-07-25.
 * Input: items-2026-07-25.json (dedupliceret mod alle 1593 issues, open+closed).
 * Skriver .filed-2026-07-25.json så kørslen er idempotent-tjekbar.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = 'C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/c009d6db-7885-492a-9d3d-153fbf6600da/scratchpad';
const items = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'items-2026-07-25.json'), 'utf8'));
const OUT = path.join(process.cwd(), 'scripts', 'discord', '.filed-2026-07-25.json');

// Ekstra kategori-labels pr. item (matcher husets cat:*-konvention).
const CAT = {
  'standings-pool-empty': 'cat:bug',
  'z-index-scales': 'cat:bug',
  'academy-promote-contract-reset': 'cat:bug',
  'discord-result-post-dropped': 'cat:bug',
  'season-planner-unusable': 'cat:user-feature',
  'auction-duration-antisnipe': 'cat:user-feature',
  'sell-to-ai-after-failed-auctions': 'cat:user-feature',
  'team-results-history-widget': 'cat:user-feature',
  'sports-director-decline-and-pool': 'cat:balance',
  'team-page-density': 'cat:user-feature',
  'help-season-economy-timing': 'cat:user-feature',
};

function gh(args, body) {
  let tmp;
  if (body != null) {
    tmp = path.join(os.tmpdir(), `gh-body-${process.pid}-${args.length}-${body.length}.md`);
    fs.writeFileSync(tmp, body, 'utf8');
    args = args.concat(['--body-file', tmp]);
  }
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20e6 }).trim();
      } catch (e) {
        const msg = String(e.stderr || e.message);
        if (attempt === 3 || !/504|502|timeout|Gateway/i.test(msg)) throw new Error(msg);
      }
    }
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }
}

const filed = [];
for (const it of items) {
  if (it.action === 'comment_on_existing') {
    const url = gh(['issue', 'comment', String(it.target), '--repo', 'NicolaiDolmer/CyclingZone'], it.body);
    filed.push({ key: it.key, action: 'comment', target: `#${it.target}`, url });
    console.log(`CMT   #${it.target} <- ${it.key}`);
    continue;
  }

  const labels = it.labels.split(',').map((s) => s.trim()).filter(Boolean);
  if (CAT[it.key]) labels.push(CAT[it.key]);
  if (!labels.includes('claude:todo')) labels.push('claude:todo');

  const args = ['issue', 'create', '--repo', 'NicolaiDolmer/CyclingZone', '--title', it.title];
  for (const l of labels) args.push('--label', l);
  const url = gh(args, it.body);
  filed.push({ key: it.key, action: 'create', title: it.title, labels, url });
  console.log(`NEW   ${url}  (${it.key})`);
}

fs.writeFileSync(OUT, JSON.stringify(filed, null, 2), 'utf8');
const n = (a) => filed.filter((f) => f.action === a).length;
console.log(`\nWROTE ${OUT} — ${n('create')} nye issues, ${n('comment')} kommentarer`);
