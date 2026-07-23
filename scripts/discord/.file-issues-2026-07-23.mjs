#!/usr/bin/env node
/**
 * Opretter GitHub-issues + kommentarer fra Discord-sweep 2026-07-23.
 * Input: verdicts.json (workflow-output, dedupliceret mod 413 aabne issues).
 * Skriver .filed-2026-07-23.json med resultatet, saa koerslen er idempotent-tjekbar.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = 'C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/425da460-dac9-45a6-a2f7-858c4c916713/scratchpad';
const verdicts = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'verdicts.json'), 'utf8'));
const OUT = path.join(process.cwd(), 'scripts', 'discord', '.filed-2026-07-23.json');

const VALID_LABELS = new Set(`bug documentation duplicate enhancement claude:todo claude:blocked claude:in-progress claude:done
priority:high priority:low priority:med type:bug type:feature type:refactor type:docs type:investigation type:task
needs-contract shared-refactor security manual-review needs-decision cat:user-feature cat:bug cat:community cat:infra
cat:ai-ops cat:founder cat:balance needs-design slice:frontend post-launch risk:low risk:med risk:high
epic:economy-overhaul epic:progression epic:quality-hardening epic:discord-community slice:race-engine slice:retention
slice:monetization slice:season-1 backend-only docs-only needs-user-action`.split(/\s+/).filter(Boolean));

function gh(args, body) {
  let tmp;
  if (body != null) {
    tmp = path.join(os.tmpdir(), `gh-body-${Date.now()}-${Math.floor(Math.random() * 1e6)}.md`);
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
for (const v of verdicts) {
  if (v.recommended_action === 'skip') {
    filed.push({ key: v.key, action: 'skip', target: v.duplicate_of });
    console.log(`SKIP  ${v.key} (dækket af ${v.duplicate_of})`);
    continue;
  }

  if (v.recommended_action === 'comment_on_existing') {
    // duplicate_of kan vaere "#2757, #2525" -> kommentér paa det FOERSTE (primaere) issue.
    const nums = (v.duplicate_of.match(/#(\d+)/g) || []).map((s) => s.slice(1));
    if (!nums.length) { console.log(`WARN  ${v.key}: ingen issue-nummer i "${v.duplicate_of}"`); continue; }
    const target = nums[0];
    const url = gh(['issue', 'comment', target, '--repo', 'NicolaiDolmer/CyclingZone'], v.proposed_body);
    filed.push({ key: v.key, action: 'comment', target: `#${target}`, url });
    console.log(`CMT   #${target} <- ${v.key}`);
    continue;
  }

  const labels = (v.proposed_labels || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => VALID_LABELS.has(s));
  if (!labels.includes('claude:todo')) labels.push('claude:todo');

  const args = ['issue', 'create', '--repo', 'NicolaiDolmer/CyclingZone', '--title', v.proposed_title];
  for (const l of labels) args.push('--label', l);
  const url = gh(args, v.proposed_body);
  filed.push({ key: v.key, action: 'create', labels, url });
  console.log(`NEW   ${url}  (${v.key})`);
}

fs.writeFileSync(OUT, JSON.stringify(filed, null, 2), 'utf8');
console.log(`\nWROTE ${OUT} — ${filed.filter((f) => f.action === 'create').length} nye, ${filed.filter((f) => f.action === 'comment').length} kommentarer, ${filed.filter((f) => f.action === 'skip').length} sprunget over`);
