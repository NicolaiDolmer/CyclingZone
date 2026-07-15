#!/usr/bin/env node
/**
 * Ret off-by-one i cross-referencer fra .file-issues-2026-07-15.mjs.
 * KEY-mappen pegede på forkerte array-indeks for 5 nøgler.
 *
 * Korrekt: RESPONSIVT=#2445 (ikke 2446) · TRAENING_KOLONNER=#2446 (ikke 2447)
 *          MENU_IA=#2443 (ikke 2444) · AUKTIONS_GEBYR=#2452 (ikke 2453)
 *          PERSONALE_OVERSIGT=#2450 (ikke 2451)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'czfix-'));
const REPO = 'NicolaiDolmer/CyclingZone';

// Kun præcise, kontekst-bundne erstatninger — ikke blind global replace,
// da #2444/#2447 m.fl. er legitime referencer andre steder.
const FIXES = [
  {
    kind: 'issue',
    n: 2446,
    subs: [['#2446 (responsivt layout', '#2445 (responsivt layout']],
  },
  {
    kind: 'comment',
    n: 1027,
    subs: [
      ['#2446 — responsivt layout', '#2445 — responsivt layout'],
      ['#2447 — daglig træning', '#2446 — daglig træning'],
      ['#2444 — menu-rework', '#2443 — menu-rework'],
    ],
  },
  { kind: 'comment', n: 2398, subs: [['#2451 (personale-oversigt', '#2450 (personale-oversigt']] },
  { kind: 'comment', n: 1905, subs: [['#2453 (gebyr ved udbudspris', '#2452 (gebyr ved udbudspris']] },
  { kind: 'comment', n: 2176, subs: [['#2453 (gratis auktion', '#2452 (gratis auktion']] },
];

for (const f of FIXES) {
  let body, commentId;
  if (f.kind === 'issue') {
    body = JSON.parse(gh(['issue', 'view', String(f.n), '--json', 'body'])).body;
  } else {
    const cs = JSON.parse(gh(['api', `repos/${REPO}/issues/${f.n}/comments`, '--paginate']));
    const last = cs[cs.length - 1];
    commentId = last.id;
    body = last.body;
  }

  let out = body;
  for (const [from, to] of f.subs) {
    if (!out.includes(from)) {
      console.error(`  ADVARSEL: "${from}" ikke fundet i ${f.kind} #${f.n} — springer over`);
      continue;
    }
    out = out.split(from).join(to);
  }
  if (out === body) {
    console.log(`  ${f.kind} #${f.n}: ingen ændring`);
    continue;
  }

  const file = path.join(tmp, `${f.kind}-${f.n}.md`);
  fs.writeFileSync(file, out, 'utf8');
  if (f.kind === 'issue') {
    gh(['issue', 'edit', String(f.n), '--body-file', file]);
  } else {
    gh(['api', '--method', 'PATCH', `repos/${REPO}/issues/comments/${commentId}`,
      '-F', `body=@${file}`]);
  }
  console.log(`  ${f.kind} #${f.n}: rettet (${f.subs.length} sub(s))`);
}
console.log('\nFÆRDIG.');
