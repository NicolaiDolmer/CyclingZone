#!/usr/bin/env node
// scripts/weekly-steering-report.mjs
// ============================================================
// Soendagsrapport-rutine — forbereder mandagens styringssession (#5328).
//
// WHY (styringssession 17/9, docs/superpowers/specs/2026-09-17-weekly-
// steering-session-design.md, "Tilgang C"): mandagens session har fem
// blokke (docs/WEEKLY_STEERING.md). Uden en forberedt rapport gaar en stor
// del af blok 1-2's tid til at INDSAMLE data i stedet for at BESLUTTE.
// Dette script samler de syv datapunkter issue #5328 lister, saa mandag
// bliver rent beslutningsmoede.
//
// READ-ONLY (bindende, jf. issuet): scriptet laeser gh/Supabase/lokale filer
// og AENDRER ALDRIG et issue eller en PR. Ingen add_issue_comment, ingen
// issue_write, ingen label-aendringer. Output er kun docs/audits/<dato>-
// styringsrapport.md (skrevet af kaldstedet/workflowet, ikke af dette
// script - se --out) + evt. en kort Discord-besked (workflow-ansvar, ikke
// dette script).
//
// De syv sektioner (issue #5328):
//   1. Tal            - koerer scripts/monday-numbers.mjs (kraever Supabase-env).
//   2. PR-koe         - alle aabne PR'er, BLOCKED/DIRTY + roede checks + seneste
//                       menneske-kommentar (kun for BLOCKED/DIRTY, bounded).
//   3. Triage-kandidater - genbruger scripts/lib/triage-age.mjs (#5329): alle
//                       aabne triage:new + de aeldre end 7 dage saerskilt.
//   4. Icebox-kandidater - priority:low, ikke i MASTERPLAN, ikke bug/
//                       spillerfund/epic, grupperet pr. cat:-label.
//   5. MASTERPLAN mod GitHub - lukkede issues uden ✅-checkmark i MASTERPLAN.md,
//                       + aabne priority:high-issues slet ikke naevnt.
//   6. Loefte-tjek    - roadmap_items status=active uden tekst-match i
//                       MASTERPLAN.md (Supabase, samme env som #1).
//   7. Budget         - scripts/check-agent-token-hygiene.ps1 FAIL/WARN.
//   8. Spillersignal  - kun tal om hvad spillerne stemmer og melder (#7783);
//                       samme Supabase-env som #1 og #6, aldrig navne/user_id.
//
// CAVEATS (skriv ALDRIG disse som loest - se ogsaa outputtets egne noter):
//   - Sektion 5+6 er TEKST-heuristik (regex/ord-match), ikke semantisk
//     forstaaelse. Falske positiver/negativer forventes - rapporten er et
//     forslag til blok 2/3, ikke en facit-liste. Ejeren afgoer.
//   - Sektion 1 kraever SUPABASE_URL/SUPABASE_SERVICE_KEY i miljoeet
//     (Infisical i workflowet). Mangler de, skriver sektionen det og
//     springer selve tallene over - ingen MCP-fallback er muligt fra et
//     rent Node-script (MCP er kun tilgaengeligt i en interaktiv
//     Claude-session, jf. issuets "ellers Supabase MCP som fallback").
//   - Sektion 2's "seneste menneske-kommentar" hentes kun for BLOCKED/DIRTY
//     PR'er (bounded antal gh-kald), ikke for alle aabne PR'er.
//
// Usage:
//   node scripts/weekly-steering-report.mjs                      # skriver til stdout
//   node scripts/weekly-steering-report.mjs --out docs/audits/2026-09-21-styringsrapport.md
//   node scripts/weekly-steering-report.mjs --repo owner/name --now 2026-09-21
//   node scripts/weekly-steering-report.mjs --skip-numbers        # spring sektion 1 over (test/CI uden Supabase-env)
//
// Exit codes:
//   0 - rapport genereret (uanset om der er fund - dette er et rapport-
//       script, ikke en gate; exit-koden signalerer kun "koerte uden
//       proces-fejl", IKKE "ingen anomalier")
//   2 - ugyldige argumenter, eller et paakraevet gh-kald fejlede haardt
//
// Refs #5328 #5329.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_TRIAGE_AGE_DAYS,
  DEFAULT_TRIAGE_LABEL,
  classifyTriageAge,
  formatTriageAgeSection,
  sanitizeTitle,
} from './lib/triage-age.mjs';

export const DEFAULT_REPO = 'NicolaiDolmer/CyclingZone';
const MASTERPLAN_PATH = 'docs/MASTERPLAN.md';
const TZ = 'Europe/Copenhagen';

// ---------------------------------------------------------------------------
// gh/exec-eksekvering (injicerbar for test-skyld, samme idiom som priority-hygiene.mjs)
// ---------------------------------------------------------------------------

export function defaultExecGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

export function defaultExecNode(args) {
  return execFileSync('node', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

export function defaultExecPwsh(args) {
  return execFileSync('pwsh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

function normalizeLabels(labels) {
  return (labels || []).map((l) => (typeof l === 'string' ? l : l.name));
}

// ---------------------------------------------------------------------------
// 1. Tal
// ---------------------------------------------------------------------------

export function runMondayNumbers(execNode) {
  try {
    const output = execNode(['scripts/monday-numbers.mjs']);
    return { ok: true, output };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function formatNumbersSection({ ok, output, error }, hasSupabaseEnv) {
  if (!hasSupabaseEnv) {
    return (
      'SUPABASE_URL/SUPABASE_SERVICE_KEY ikke sat i miljoeet — sektionen sprunget over. ' +
      'Koer manuelt: `infisical run --env=prod -- node scripts/monday-numbers.mjs` ' +
      '(ingen MCP-fallback mulig fra et rent script, kun fra en interaktiv Claude-session).'
    );
  }
  if (!ok) return `monday-numbers.mjs fejlede: ${error}`;
  return output.trim();
}

// ---------------------------------------------------------------------------
// 2. PR-koe
// ---------------------------------------------------------------------------

export function fetchOpenPrs(execGh, repo) {
  const raw = execGh([
    'pr', 'list',
    '--repo', repo,
    '--state', 'open',
    '--json', 'number,title,url,isDraft,mergeStateStatus,statusCheckRollup,updatedAt',
    '--limit', '100',
  ]);
  return JSON.parse(raw || '[]');
}

/** @param {object} pr */
export function classifyPr(pr) {
  const status = String(pr.mergeStateStatus || '').toUpperCase();
  if (status === 'DIRTY') return 'DIRTY';
  if (status === 'BLOCKED') return 'BLOCKED';
  const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  const failing = checks.some((c) => {
    const concl = String(c?.conclusion || '').toUpperCase();
    const state = String(c?.state || '').toUpperCase();
    return concl === 'FAILURE' || concl === 'ERROR' || state === 'FAILURE' || state === 'ERROR';
  });
  if (failing) return 'ROEDE-CHECKS';
  if (pr.isDraft) return 'DRAFT';
  return 'OK';
}

/**
 * Henter seneste ikke-bot-kommentar paa en PR. Kaldes KUN for BLOCKED/DIRTY
 * PR'er (bounded antal ekstra gh-kald - ikke alle aabne PR'er).
 */
export function fetchLastHumanComment(execGh, repo, number) {
  let data;
  try {
    const raw = execGh(['pr', 'view', String(number), '--repo', repo, '--json', 'comments']);
    data = JSON.parse(raw || '{}');
  } catch {
    return null;
  }
  const comments = Array.isArray(data.comments) ? data.comments : [];
  const human = comments.filter((c) => {
    const login = c?.author?.login || '';
    return login && !login.endsWith('[bot]') && login !== 'github-actions';
  });
  if (human.length === 0) return null;
  const last = human[human.length - 1];
  return { author: last.author?.login || '?', body: String(last.body || '').replace(/\r?\n/g, ' ').slice(0, 120) };
}

export function formatPrQueueSection(prs, lastComments) {
  if (prs.length === 0) return "Ingen aabne PR'er. ✅";
  const lines = [];
  lines.push('| # | Titel | Status | Seneste menneske-kommentar |');
  lines.push('|---|---|---|---|');
  let blocked = 0;
  let dirty = 0;
  for (const pr of prs) {
    const status = classifyPr(pr);
    if (status === 'BLOCKED') blocked += 1;
    if (status === 'DIRTY') dirty += 1;
    const comment = lastComments?.get(pr.number);
    const commentText = comment ? `${comment.author}: "${comment.body}"` : (status === 'BLOCKED' || status === 'DIRTY' ? '(ingen)' : '—');
    lines.push(`| \`#${pr.number}\` | ${sanitizeTitle(pr.title)} | ${status} | ${commentText} |`);
  }
  lines.push('');
  lines.push(`${blocked} BLOCKED, ${dirty} DIRTY af ${prs.length} aabne (mål: 0 BLOCKED uden aftalt naeste skridt).`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 4. Icebox-kandidater
// ---------------------------------------------------------------------------

export function fetchOpenPriorityLowIssues(execGh, repo) {
  const raw = execGh([
    'issue', 'list',
    '--repo', repo,
    '--state', 'open',
    '--label', 'priority:low',
    '--json', 'number,title,labels,url',
    '--limit', '500',
  ]);
  return JSON.parse(raw || '[]');
}

export function isIceboxCandidate(issue, masterplanNumbers) {
  const labels = normalizeLabels(issue.labels);
  if (masterplanNumbers.has(issue.number)) return false;
  if (labels.includes('type:bug')) return false;
  if (labels.includes('cat:spillerfund')) return false;
  if (labels.some((l) => l === 'epic' || l.startsWith('epic:'))) return false;
  return true;
}

export function groupIceboxCandidates(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const labels = normalizeLabels(issue.labels);
    const area = labels.find((l) => l.startsWith('cat:')) || '(uden omraade-label)';
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(issue);
  }
  return groups;
}

export function formatIceboxSection(groups) {
  if (groups.size === 0) {
    return 'Ingen icebox-kandidater (priority:low, ikke i MASTERPLAN, ikke bug/spillerfund/epic).';
  }
  const lines = [];
  let total = 0;
  const sortedAreas = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [area, issues] of sortedAreas) {
    total += issues.length;
    lines.push(`- **${area}** (${issues.length}): ${issues.map((i) => `\`#${i.number}\``).join(', ')}`);
  }
  lines.unshift(`${total} icebox-kandidat(er), grupperet pr. omraade (ejer-go kraevet pr. batch før lukning):`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 5. MASTERPLAN mod GitHub
// ---------------------------------------------------------------------------

/**
 * Finder alle `#N`-referencer i MASTERPLAN.md og om referencen staar i et
 * segment der ogsaa indeholder ✅ (segmenter er linjer ELLER "·"-adskilte
 * klumper, da filens format bruger begge som listeadskillere). Et nummer der
 * er ✅-markeret BARE ét sted i filen taeller som "checket" — samme nummer
 * kan nævnes flere gange (fx i "Rest:"-linjen efter det er startet).
 * @param {string} markdown
 * @returns {Map<number, boolean>} nummer -> checket-nogetsteds
 */
export function extractMasterplanRefs(markdown) {
  const refs = new Map();
  const segments = String(markdown).split(/\n|·/);
  for (const segment of segments) {
    const checked = segment.includes('✅');
    for (const m of segment.matchAll(/#(\d+)/g)) {
      const num = Number(m[1]);
      refs.set(num, Boolean(refs.get(num)) || checked);
    }
  }
  return refs;
}

// Maalt 18/9: 2223 lukkede issues i alt (gh api graphql issues(states:CLOSED)
// totalCount) - default-loftet giver rigelig headroom uden at vokse ubegraenset.
export const DEFAULT_CLOSED_ISSUES_FETCH_LIMIT = 3000;

/**
 * Henter ALLE lukkede issue-numre i ét bulk-kald i stedet for ét `gh issue
 * view` pr. MASTERPLAN-reference (CodeRabbit-review, #5328: MASTERPLAN.md
 * kan referere hundredvis af numre, og sekventielle enkelt-kald var langsomt
 * og risikerede secondary rate limiting, som stille degraderede sektion 5 -
 * fetchIssueState returnerede null paa enhver fejl).
 * @param {(args: string[]) => string} execGh
 * @param {string} repo
 * @param {number} limit
 * @returns {{numbers: Set<number>, hitLimit: boolean}}
 */
export function fetchClosedIssueNumbers(execGh, repo, limit = DEFAULT_CLOSED_ISSUES_FETCH_LIMIT) {
  const raw = execGh([
    'issue', 'list',
    '--repo', repo,
    '--state', 'closed',
    '--json', 'number',
    '--limit', String(limit),
  ]);
  const list = JSON.parse(raw || '[]');
  return { numbers: new Set(list.map((i) => i.number)), hitLimit: list.length >= limit };
}

export function findClosedWithoutCheckmark(masterplanRefs, closedIssueNumbers) {
  const result = [];
  for (const [number, checked] of masterplanRefs.entries()) {
    if (checked) continue;
    if (closedIssueNumbers.has(number)) result.push(number);
  }
  return result.sort((a, b) => a - b);
}

export function fetchOpenHighPrioIssues(execGh, repo) {
  const raw = execGh([
    'issue', 'list',
    '--repo', repo,
    '--state', 'open',
    '--label', 'priority:high',
    '--json', 'number,title,url',
    '--limit', '500',
  ]);
  return JSON.parse(raw || '[]');
}

export function findHighPrioWithoutPlads(openHighPrioIssues, masterplanRefs) {
  return openHighPrioIssues.filter((i) => !masterplanRefs.has(i.number));
}

export function formatMasterplanSection({ closedWithoutCheckmark, highPrioWithoutPlads }) {
  const lines = [];
  if (closedWithoutCheckmark.length === 0) {
    lines.push('Ingen lukkede issues uden ✅-checkmark i MASTERPLAN.md. ✅');
  } else {
    lines.push(`${closedWithoutCheckmark.length} lukket issue(s) mangler ✅ i MASTERPLAN.md: ${closedWithoutCheckmark.map((n) => `\`#${n}\``).join(', ')}`);
  }
  lines.push('');
  if (highPrioWithoutPlads.length === 0) {
    lines.push('Ingen aabne `priority:high`-issues uden plads i MASTERPLAN.md. ✅');
  } else {
    lines.push(`${highPrioWithoutPlads.length} aaben \`priority:high\`-issue(s) er slet ikke naevnt i MASTERPLAN.md:`);
    for (const i of highPrioWithoutPlads.slice(0, 30)) {
      lines.push(`- \`#${i.number}\` ${sanitizeTitle(i.title)}`);
    }
    if (highPrioWithoutPlads.length > 30) lines.push(`- … + ${highPrioWithoutPlads.length - 30} flere`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 6. Loefte-tjek (roadmap_items)
// ---------------------------------------------------------------------------

const ROADMAP_STOPWORDS = new Set([
  'med', 'for', 'til', 'fra', 'som', 'ikke', 'alle', 'over', 'under', 'uden',
  'samt', 'eller', 'saa', 'saaledes', 'dette', 'denne', 'kan', 'skal', 'vil',
  'have', 'blive', 'more', 'that', 'with', 'from', 'this', 'have', 'will',
]);

export function normalizeWords(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9æøå]+/i)
    .filter((w) => w.length >= 4 && !ROADMAP_STOPWORDS.has(w));
}

/**
 * Grov tekst-heuristik (IKKE semantisk): et roadmap-loefte "har plan-
 * henvisning" hvis nok af dets meningsbaerende ord genfindes i MASTERPLAN.md.
 * Bevidst konservativ tærskel for at undgaa at oversvoemme rapporten med
 * falske positiver paa almindelige ord - men falske negativer/positiver MAA
 * forventes. Rapportens forbrugere afgør, den er ikke en gate.
 * @param {{title_en?: string, title_da?: string}} item
 * @param {string} masterplanText
 */
export function roadmapItemHasPlanReference(item, masterplanText) {
  const words = new Set([...normalizeWords(item.title_en || ''), ...normalizeWords(item.title_da || '')]);
  if (words.size === 0) return { hasReference: false, hits: 0 };
  const planWords = new Set(normalizeWords(masterplanText));
  let hits = 0;
  for (const w of words) if (planWords.has(w)) hits += 1;
  const threshold = words.size === 1 ? 1 : 2;
  return { hasReference: hits >= threshold, hits };
}

/**
 * Henter aktive roadmap_items via Supabase (samme env som scripts/monday-numbers.mjs).
 * @param {string} url
 * @param {string} key
 */
export async function fetchActiveRoadmapItems(url, key) {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db
    .from('roadmap_items')
    .select('id,title_en,title_da,status')
    .eq('status', 'active')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`roadmap_items: ${error.message}`);
  return data ?? [];
}

export function formatPromiseCheckSection(items, masterplanText, hasSupabaseEnv) {
  if (!hasSupabaseEnv) {
    return 'SUPABASE_URL/SUPABASE_SERVICE_KEY ikke sat — sektionen sprunget over (samme env som sektion 1).';
  }
  const missing = items
    .map((item) => ({ item, ...roadmapItemHasPlanReference(item, masterplanText) }))
    .filter((r) => !r.hasReference);
  const lines = [];
  lines.push(
    `${items.length} aktive spillerloefter (\`roadmap_items\`). Tekst-heuristik (titel-ord mod MASTERPLAN.md) - verificér manuelt, ikke en facit-liste.`,
  );
  lines.push('');
  if (missing.length === 0) {
    lines.push('Ingen loefter uden tekst-match i MASTERPLAN.md. ✅');
  } else {
    lines.push(`${missing.length} loefte(r) uden fundet plan-henvisning:`);
    for (const { item } of missing) {
      // BEVIDST ikke `#N` her: item.id er roadmap_items' egen PK, ikke et
      // GitHub-issuenummer - `#N`-notation ville GitHub-auto-linke forkert
      // hvis teksten nogensinde limes ind i en kommentar (samme klasse fejl
      // som priority-hygiene.mjs's sanitizeTitle-GOTCHA laengere oppe).
      lines.push(`- roadmap_items.id=${item.id}: ${item.title_en || item.title_da || '(uden titel)'}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 7. Budget (token-hygiejne)
// ---------------------------------------------------------------------------

export function runTokenHygieneCheck(execPwsh) {
  try {
    const output = execPwsh(['-File', 'scripts/check-agent-token-hygiene.ps1']);
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: String(err.stdout || ''), error: err.message };
  }
}

export function formatBudgetSection({ ok, output }) {
  const summaryLine = String(output || '')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('Summary:'));
  if (ok) {
    return `check-agent-token-hygiene.ps1: PASS.${summaryLine ? ` ${summaryLine.trim()}` : ''}`;
  }
  return `check-agent-token-hygiene.ps1: FAIL.${summaryLine ? ` ${summaryLine.trim()}` : ''} Se fuld output i CI-loggen.`;
}

// ---------------------------------------------------------------------------
// 8. Spillersignal (#7783)
// ---------------------------------------------------------------------------
//
// WHY: stemmer, fejlmeldinger og feedback ligger i databasen, men blev kun
// laest ved haandkraft. Sektionen giver ejeren et fast, sammenligneligt signal
// hver uge. Rapporten havner i det offentlige docs/audits/, saa output er KUN
// tal og offentlige punkt-titler: aldrig user_id, navne, e-mails eller tekst
// pr. spiller. Ingen ny tabel eller view: alt beregnes her af read-only
// laesninger, saa der ikke kraeves en migration.
//
// Laeser kun; aendrer aldrig noget i databasen.

export const SIGNAL_MIN_VOTERS = 10;
export const SIGNAL_MIN_VOTES_PER_VOTER = 10;
export const SIGNAL_OUTSIDE_PLAN_LIFT = 0.5;
const SIGNAL_ITEM_STATUSES = new Set(['active', 'planned', 'in_progress']);
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

async function fetchAllRows(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Henter raa raekker til spillersignalet. Vaelger kun de kolonner der skal
 * til; e-mail, brugernavne og beskedtekster hentes aldrig.
 * @param {string} url
 * @param {string} key
 */
export async function fetchPlayerSignalData(url, key) {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const [users, teams, votes, items, issues, reports] = await Promise.all([
    fetchAllRows(() => db.from('users').select('id,role,last_seen').order('id')),
    fetchAllRows(() => db.from('teams').select('id,user_id,is_ai,is_test_account,is_bank').order('id')),
    fetchAllRows(() => db.from('roadmap_votes').select('id,item_id,user_id,importance_score,created_at,updated_at').not('importance_score', 'is', null).order('id')),
    fetchAllRows(() => db.from('roadmap_items').select('id,issue_ref,title_da,title_en,status,approved,created_at').order('id')),
    fetchAllRows(() => db.from('known_issues').select('id,issue_ref,title_da,title_en,status,published').order('id')),
    fetchAllRows(() => db.from('known_issue_reports').select('issue_id,user_id').order('issue_id').order('user_id')),
  ]);
  const { count, error } = await db.from('player_feedback').select('id', { count: 'exact', head: true }).eq('status', 'new');
  if (error) throw new Error(`player_feedback: ${error.message}`);
  return { users, teams, votes, items, issues, reports, feedbackNew: count ?? 0 };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Ren beregning (ingen I/O). Spejler det foreslaaede SQL-view: en stemmes
 * "loeft" er afstanden til stemmerens eget gennemsnit, saa en haard og en
 * venlig stemmer vejer ens. Kun aktive managere (sidst set inden for 7 dage,
 * ikke admin/AI/test/bank) tael, og kun stemmere med nok stemmer til et
 * paalideligt eget gennemsnit.
 * @param {object} data raa raekker fra fetchPlayerSignalData
 * @param {Date} now
 * @param {Set<number>} masterplanNumbers issue-numre nævnt i MASTERPLAN.md
 */
export function computePlayerSignal(data, now, masterplanNumbers = new Set()) {
  const cut7 = now.getTime() - 7 * DAY_MS;
  const cut30 = now.getTime() - 30 * DAY_MS;

  const eligibleTeamUsers = new Set(
    data.teams
      .filter((t) => t.user_id && !t.is_ai && !t.is_test_account && !t.is_bank)
      .map((t) => t.user_id),
  );
  const eligibleUsers = data.users.filter((u) => eligibleTeamUsers.has(u.id) && u.role !== 'admin');
  const active7 = new Set(
    eligibleUsers.filter((u) => u.last_seen && new Date(u.last_seen).getTime() >= cut7).map((u) => u.id),
  );

  const votes = data.votes.filter((v) => active7.has(v.user_id) && Number.isFinite(Number(v.importance_score)));
  const votesByUser = new Map();
  for (const v of votes) {
    if (!votesByUser.has(v.user_id)) votesByUser.set(v.user_id, []);
    votesByUser.get(v.user_id).push(v);
  }

  const voted = (v, cut) => new Date(v.updated_at || v.created_at).getTime() >= cut;
  const voters7 = [...votesByUser.entries()].filter(([, vs]) => vs.some((v) => voted(v, cut7))).length;
  const voters30 = [...votesByUser.entries()].filter(([, vs]) => vs.some((v) => voted(v, cut30))).length;
  const counts = [...votesByUser.values()].map((vs) => vs.length).sort((a, b) => b - a);
  const totalVotes = counts.reduce((a, b) => a + b, 0);
  const top5Share = totalVotes === 0 ? 0 : counts.slice(0, 5).reduce((a, b) => a + b, 0) / totalVotes;

  const voterMean = new Map();
  for (const [uid, vs] of votesByUser) {
    if (vs.length >= SIGNAL_MIN_VOTES_PER_VOTER) voterMean.set(uid, mean(vs.map((v) => Number(v.importance_score))));
  }

  const rowsByItem = new Map();
  for (const v of votes) {
    if (!voterMean.has(v.user_id)) continue;
    const score = Number(v.importance_score);
    if (!rowsByItem.has(v.item_id)) rowsByItem.set(v.item_id, []);
    rowsByItem.get(v.item_id).push({
      score,
      lift: score - voterMean.get(v.user_id),
      isNew: new Date(v.created_at).getTime() > cut7,
      unchangedSinceCut: new Date(v.updated_at || v.created_at).getTime() <= cut7,
    });
  }

  const itemStats = [];
  for (const item of data.items) {
    if (!SIGNAL_ITEM_STATUSES.has(item.status) || item.approved !== true) continue; // kladder er ikke offentlige
    const rows = rowsByItem.get(item.id) || [];
    const n = rows.length;
    const lifts = rows.map((r) => r.lift);
    const liftAvg = n ? mean(lifts) : null;
    let se = null;
    if (n >= 2) {
      const variance = lifts.reduce((a, l) => a + (l - liftAvg) ** 2, 0) / (n - 1);
      se = Math.sqrt(variance / n);
    }
    const prev = rows.filter((r) => r.unchangedSinceCut);
    const avg = n ? mean(rows.map((r) => r.score)) : null;
    const prevAvg = prev.length ? mean(prev.map((r) => r.score)) : null;
    itemStats.push({
      id: item.id,
      issueRef: item.issue_ref ?? null,
      title: item.title_da || item.title_en || '(uden titel)',
      titleEn: item.title_en || '',
      voters: n,
      avg: avg === null ? null : round2(avg),
      high: rows.filter((r) => r.score >= 5).length,
      low: rows.filter((r) => r.score <= 2).length,
      lift: liftAvg === null ? null : round2(liftAvg),
      se: se === null ? null : round2(se),
      newVotes7d: rows.filter((r) => r.isNew).length,
      enough: n >= SIGNAL_MIN_VOTERS,
      prevVoters: prev.length,
      moved: avg !== null && prevAvg !== null && prev.length >= SIGNAL_MIN_VOTERS ? round2(avg - prevAvg) : null,
    });
  }

  const ranked = itemStats.filter((s) => s.enough).sort((a, b) => b.lift - a.lift || b.voters - a.voters);
  const top = ranked.slice(0, 10);
  const bottom = ranked.slice(10).slice(-5).reverse();
  const thin = itemStats.filter((s) => !s.enough && s.voters > 0).sort((a, b) => b.voters - a.voters);
  const movedMost = ranked
    .filter((s) => s.moved !== null && s.moved !== 0)
    .sort((a, b) => Math.abs(b.moved) - Math.abs(a.moved))
    .slice(0, 5);
  const outsidePlan = ranked.filter((s) => {
    if (s.lift < SIGNAL_OUTSIDE_PLAN_LIFT) return false;
    if (s.issueRef != null) return !masterplanNumbers.has(Number(s.issueRef));
    return true; // uden issue_ref kan planhenvisning ikke afgoeres: vis og lad ejeren tjekke
  });

  const reportUsers = new Map();
  for (const r of data.reports) {
    if (!reportUsers.has(r.issue_id)) reportUsers.set(r.issue_id, new Set());
    reportUsers.get(r.issue_id).add(r.user_id);
  }
  const openIssues = data.issues
    .filter((i) => i.published && !['fixed', 'dismissed'].includes(i.status))
    .map((i) => ({
      issueRef: i.issue_ref ?? null,
      title: i.title_da || i.title_en || '(uden titel)',
      status: i.status,
      reports: reportUsers.get(i.id)?.size ?? 0,
    }))
    .sort((a, b) => b.reports - a.reports);

  return {
    coverage: {
      eligible: eligibleUsers.length,
      active7: active7.size,
      voted7: voters7,
      voted30: voters30,
      votes: totalVotes,
      top5SharePct: Math.round(top5Share * 100),
      calibratedVoters: voterMean.size,
    },
    top,
    bottom,
    thinCount: thin.length,
    thin: thin.slice(0, 10),
    movedMost,
    outsidePlan,
    openIssues: { total: openIssues.length, withReports: openIssues.filter((i) => i.reports > 0).length, top: openIssues.filter((i) => i.reports > 0).slice(0, 5) },
    feedbackNew: data.feedbackNew ?? 0,
  };
}

function itemLabel(s) {
  const ref = s.issueRef != null ? `\`#${s.issueRef}\` ` : '';
  return `${ref}${sanitizeTitle(s.title)}`;
}

function signed(n) {
  if (n === null || n === undefined) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
}

function itemTable(rows) {
  const lines = ['| Punkt | Stemmere | Snit | Høje | Lave | Løft | ±se | Nye 7d |', '|---|---|---|---|---|---|---|---|'];
  for (const s of rows) {
    lines.push(`| ${itemLabel(s)} | ${s.voters} | ${s.avg?.toFixed(2) ?? '—'} | ${s.high} | ${s.low} | ${signed(s.lift)} | ${s.se?.toFixed(2) ?? '—'} | ${s.newVotes7d} |`);
  }
  return lines;
}

export function formatPlayerSignalSection(signal, hasSupabaseEnv = true) {
  if (!hasSupabaseEnv) {
    return 'SUPABASE_URL/SUPABASE_SERVICE_KEY ikke sat — sektionen sprunget over (samme env som sektion 1).';
  }
  const c = signal.coverage;
  const lines = [];
  lines.push('Kun tal og offentlige punkt-titler. Løft = stemmens afstand fra stemmerens eget gennemsnit; kun aktive managere (sidst set inden for 7 dage) med mindst ' + `${SIGNAL_MIN_VOTES_PER_VOTER} stemmer tæller. Punkter med under ${SIGNAL_MIN_VOTERS} stemmere rangeres ikke.`);
  lines.push('');
  lines.push('### Dækning');
  lines.push(`- Aktive managere sidste 7 dage: ${c.active7} af ${c.eligible}.`);
  lines.push(`- Heraf har stemt (nyt eller ændret) sidste 7 dage: ${c.voted7}, sidste 30 dage: ${c.voted30}.`);
  lines.push(`- ${c.votes} stemmer fra aktive. De 5 mest stemmende står for ${c.top5SharePct} %. ${c.calibratedVoters} stemmere har nok stemmer til løft.`);
  lines.push('');
  lines.push('### Top 10 (mindst ' + `${SIGNAL_MIN_VOTERS} stemmere)`);
  lines.push(signal.top.length ? itemTable(signal.top).join('\n') : 'Ingen punkter har nok stemmere endnu.');
  lines.push('');
  lines.push('### Bund 5');
  lines.push(signal.bottom.length ? itemTable(signal.bottom).join('\n') : 'Ingen punkter uden for top 10 har nok stemmere.');
  lines.push('');
  lines.push(`### Nye punkter under ${SIGNAL_MIN_VOTERS} stemmere (ikke rangeret)`);
  if (signal.thinCount === 0) {
    lines.push('Ingen.');
  } else {
    lines.push(`${signal.thinCount} punkt(er) med stemmer, men for få til at rangere. De ${signal.thin.length} med flest:`);
    lines.push('');
    lines.push(itemTable(signal.thin).join('\n'));
  }
  lines.push('');
  lines.push('### Flyttet mest siden sidste uge');
  lines.push('Ændring i snit mod stemmer, der er uændret siden for 7 dage siden. Ingen stemmehistorik gemmes, så tallet er en tilnærmelse.');
  lines.push('');
  if (signal.movedMost.length === 0) {
    lines.push('Ingen punkter med nok stemmere har flyttet sig.');
  } else {
    for (const s of signal.movedMost) lines.push(`- ${itemLabel(s)}: ${signed(s.moved)} (${s.voters} stemmere)`);
  }
  lines.push('');
  lines.push('### Åbne fejl spillerne har meldt');
  const oi = signal.openIssues;
  lines.push(`${oi.total} åbne, publicerede fejl, ${oi.withReports} med mindst én spillermelding.`);
  if (oi.top.length) {
    lines.push('');
    for (const i of oi.top) lines.push(`- ${itemLabel(i)}: ${i.reports} spiller(e) har meldt den`);
  }
  lines.push('');
  lines.push('### Ubehandlet feedback');
  lines.push(`${signal.feedbackNew} feedback-besked(er) med status \`new\`.`);
  lines.push('');
  lines.push(`### Høje punkter uden for MASTERPLAN (løft over +${SIGNAL_OUTSIDE_PLAN_LIFT.toFixed(1)}, mindst ${SIGNAL_MIN_VOTERS} stemmere)`);
  if (signal.outsidePlan.length === 0) {
    lines.push('Ingen. ✅');
  } else {
    lines.push('Punkt uden issue-nummer kan ikke krydstjekkes og vises, så ejeren kan se efter.');
    lines.push('');
    for (const s of signal.outsidePlan) lines.push(`- ${itemLabel(s)}: løft ${signed(s.lift)}, ${s.voters} stemmere`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = { repo: DEFAULT_REPO, now: new Date(), out: null, skipNumbers: false, days: DEFAULT_TRIAGE_AGE_DAYS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') {
      const val = argv[i + 1];
      if (!val || val.startsWith('--')) throw new Error('--repo: mangler vaerdi');
      args.repo = val; i += 1;
    } else if (arg === '--now') {
      const parsed = new Date(argv[i + 1]);
      if (Number.isNaN(parsed.getTime())) throw new Error(`--now: ugyldig dato "${argv[i + 1]}"`);
      args.now = parsed; i += 1;
    } else if (arg === '--out') {
      const val = argv[i + 1];
      if (!val || val.startsWith('--')) throw new Error('--out: mangler vaerdi');
      args.out = val; i += 1;
    } else if (arg === '--skip-numbers') {
      args.skipNumbers = true;
    } else if (arg === '--days') {
      const val = Number(argv[i + 1]);
      if (!Number.isFinite(val) || val <= 0) throw new Error(`--days: ugyldig vaerdi "${argv[i + 1]}"`);
      args.days = val; i += 1;
    }
  }
  return args;
}

function cphDateString(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(date);
}

export async function generateReport(opts, deps = {}) {
  const execGh = deps.execGh || defaultExecGh;
  const execNode = deps.execNode || defaultExecNode;
  const execPwsh = deps.execPwsh || defaultExecPwsh;
  const readFile = deps.readFile || ((p) => readFileSync(p, 'utf8'));
  const fetchRoadmap = deps.fetchActiveRoadmapItems || fetchActiveRoadmapItems;
  const fetchSignal = deps.fetchPlayerSignalData || fetchPlayerSignalData;

  const { repo, now, days } = opts;
  const hasSupabaseEnv = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
  const dateStr = cphDateString(now);
  const lines = [];
  const notes = [];

  lines.push(`# Styringsrapport — ${dateStr} (soendagsrutine, forbereder mandagens session)`);
  lines.push('');
  lines.push('> Autogenereret (#5328). Read-only: ingen issues/PR\'er er aendret af denne koersel. Se `docs/WEEKLY_STEERING.md` for rytmen.');
  lines.push('');

  // 1. Tal
  lines.push('## 1. Tal');
  if (opts.skipNumbers) {
    lines.push('(sprunget over: --skip-numbers)');
  } else {
    const numbersResult = hasSupabaseEnv ? runMondayNumbers(execNode) : { ok: false };
    lines.push(formatNumbersSection(numbersResult, hasSupabaseEnv));
  }
  lines.push('');

  // 2. PR-koe
  lines.push('## 2. PR-koe');
  let prs = [];
  try {
    prs = fetchOpenPrs(execGh, repo);
  } catch (err) {
    notes.push(`PR-koe kunne ikke hentes: ${err.message}`);
  }
  const lastComments = new Map();
  for (const pr of prs) {
    const status = classifyPr(pr);
    if (status === 'BLOCKED' || status === 'DIRTY') {
      const comment = fetchLastHumanComment(execGh, repo, pr.number);
      if (comment) lastComments.set(pr.number, comment);
    }
  }
  lines.push(formatPrQueueSection(prs, lastComments));
  lines.push('');

  // 3. Triage-kandidater (genbruger #5329-logikken)
  lines.push('## 3. Triage-kandidater (`triage:new`)');
  let triageIssues = [];
  try {
    const raw = execGh(['issue', 'list', '--repo', repo, '--state', 'open', '--label', DEFAULT_TRIAGE_LABEL, '--json', 'number,title,createdAt,url', '--limit', '500']);
    triageIssues = JSON.parse(raw || '[]');
  } catch (err) {
    notes.push(`Triage-kandidater kunne ikke hentes: ${err.message}`);
  }
  const { overdue, withinLimit } = classifyTriageAge(triageIssues, days, now);
  lines.push(`${triageIssues.length} aabne \`triage:new\`-issue(s) i alt.`);
  lines.push('');
  lines.push(formatTriageAgeSection({ overdue, withinLimit, days }));
  lines.push('');

  // 4. Icebox-kandidater
  lines.push('## 4. Icebox-kandidater');
  let masterplanText = '';
  try {
    masterplanText = readFile(MASTERPLAN_PATH);
  } catch (err) {
    notes.push(`${MASTERPLAN_PATH} kunne ikke laeses: ${err.message}`);
  }
  const masterplanRefs = extractMasterplanRefs(masterplanText);
  const masterplanNumbers = new Set(masterplanRefs.keys());
  let priorityLowIssues = [];
  try {
    priorityLowIssues = fetchOpenPriorityLowIssues(execGh, repo);
  } catch (err) {
    notes.push(`priority:low-issues kunne ikke hentes: ${err.message}`);
  }
  const iceboxCandidates = priorityLowIssues.filter((i) => isIceboxCandidate(i, masterplanNumbers));
  lines.push(formatIceboxSection(groupIceboxCandidates(iceboxCandidates)));
  lines.push('');

  // 5. MASTERPLAN mod GitHub
  lines.push('## 5. MASTERPLAN mod GitHub');
  let closedWithoutCheckmark = [];
  let highPrioWithoutPlads = [];
  try {
    const { numbers: closedIssueNumbers, hitLimit } = fetchClosedIssueNumbers(execGh, repo);
    if (hitLimit) {
      notes.push(`fetchClosedIssueNumbers ramte loftet (${DEFAULT_CLOSED_ISSUES_FETCH_LIMIT}) - sektion 5's "lukket uden checkmark" kan undertaelle.`);
    }
    closedWithoutCheckmark = findClosedWithoutCheckmark(masterplanRefs, closedIssueNumbers);
    const openHighPrio = fetchOpenHighPrioIssues(execGh, repo);
    highPrioWithoutPlads = findHighPrioWithoutPlads(openHighPrio, masterplanRefs);
  } catch (err) {
    notes.push(`MASTERPLAN-krydstjek fejlede delvist: ${err.message}`);
  }
  lines.push(formatMasterplanSection({ closedWithoutCheckmark, highPrioWithoutPlads }));
  lines.push('');
  notes.push('MASTERPLAN-krydstjek (sektion 5) er regex/tekst-baseret (✅-naerhed til `#N`), ikke en semantisk parser - dobbelttjek fund manuelt.');

  // 6. Loefte-tjek
  lines.push('## 6. Loefte-tjek (spillerloefter)');
  if (hasSupabaseEnv) {
    try {
      const roadmapItems = await fetchRoadmap(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      lines.push(formatPromiseCheckSection(roadmapItems, masterplanText, hasSupabaseEnv));
    } catch (err) {
      lines.push(`roadmap_items kunne ikke hentes: ${err.message}`);
      notes.push(`Loefte-tjek fejlede: ${err.message}`);
    }
  } else {
    lines.push(formatPromiseCheckSection([], masterplanText, hasSupabaseEnv));
  }
  lines.push('');
  notes.push('Loefte-tjek (sektion 6) er ord-overlap mellem roadmap-titel og MASTERPLAN.md, ikke en database-relation (roadmap_items har ingen issue/plan-kolonne) - falske positiver/negativer forventes.');

  // 7. Budget
  lines.push('## 7. Budget (token-hygiejne)');
  const budgetResult = runTokenHygieneCheck(execPwsh);
  lines.push(formatBudgetSection(budgetResult));
  lines.push('');

  // 8. Spillersignal
  lines.push('## 8. Spillersignal');
  if (hasSupabaseEnv) {
    try {
      const data = await fetchSignal(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      lines.push(formatPlayerSignalSection(computePlayerSignal(data, now, masterplanNumbers), true));
    } catch (err) {
      lines.push(`Spillersignal kunne ikke hentes: ${err.message}`);
      notes.push(`Spillersignal fejlede: ${err.message}`);
    }
  } else {
    lines.push(formatPlayerSignalSection(null, false));
  }
  lines.push('');
  notes.push("Spillersignal (sektion 8) er kun tal. 'Flyttet mest' er en tilnaermelse, fordi stemmehistorik ikke gemmes.");

  if (notes.length > 0) {
    lines.push('## Forbehold under koerslen');
    for (const n of notes) lines.push(`- ${n}`);
    lines.push('');
  }

  return lines.join('\n');
}

export async function main(argv, deps = {}) {
  const log = deps.log || console.log;
  const errorLog = deps.errorLog || console.error;

  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    errorLog(err.message);
    return 2;
  }

  let report;
  try {
    report = await generateReport(opts, deps);
  } catch (err) {
    errorLog(`Rapport-generering fejlede: ${err.stack || err.message}`);
    return 2;
  }

  if (opts.out) {
    const writeFile = deps.writeFile || writeFileSync;
    const mkdir = deps.mkdir || mkdirSync;
    mkdir(dirname(opts.out), { recursive: true });
    writeFile(opts.out, report);
    log(`Skrev ${opts.out}`);
  } else {
    log(report);
  }

  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
