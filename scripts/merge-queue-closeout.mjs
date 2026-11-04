#!/usr/bin/env node
// merge-queue-closeout.mjs: close-out efter et VERIFICERET merge-tog (#7587 punkt 6).
//
// Baggrund (ejer 3/11): merge-koeen merger i baggrunden, saa Stop-hookens
// SHA-paamindelse naaede ejeren foer Claude (#7580). Koeen skriver derfor selv
// close-out, naar et tog er verificeret (main-CI groen + deploy-verifikation
// eller, uden deploy, CI groen + minimumsventetid):
//   1. SHA-kommentar paa hvert issue som PR-body naevner med `Refs #N` eller
//      `Closes #N` (ogsaa GitHubs andre lukke-ord: fixes/resolves m.fl.).
//   2. claude:todo -> claude:done KUN for lukke-referencer. Refs-issues faar kun
//      kommentaren, fordi mange Refs-issues ikke er faerdige.
//   3. EEN samlet NOW-linje pr. tog, UDSKREVET (ikke committet). Valg + grund:
//      koeen koerer typisk i et delt checkout, hvor sessionen kan have egne
//      ucommittede NOW-rettelser; et auto-commit ville enten feje dem med eller
//      fejle, det ville skubbe til main midt i et tog, og NOW.md har en
//      struktur og et budget (Next action, Working agent) et script ikke kan
//      vurdere. Orkestratoren committer linjen ved close-out.
//
// Idempotent: hver kommentar baerer en skjult markoer pr. (PR, issue); findes
// den allerede, skrives intet. Kan kommentarerne ikke laeses, skrives heller
// intet (ukendt = ingen dublet-risiko). Label-flip sker kun naar claude:todo
// faktisk sidder paa issuet.
// Fail-soft: alle fejl samles i resultatet; CLI'et exit'er 0 medmindre selve
// input er ugyldigt. merge-queue.ps1 kalder det i try/catch, saa en fejl her
// aldrig goer et verificeret merge til en fejl.
//
// CLI:
//   node scripts/merge-queue-closeout.mjs run --train '[{"number":1,"sha":"<40 hex>"}]' [--repo owner/name] [--dry-run] [--no-deploy]
// --no-deploy: toget deployede ikke (kun main-CI + ventetid), det staar saa i teksten.
// --dry-run laeser PR-body + issue-state, men skriver intet (ingen kommentar, intet label).
// Genkoersel med samme tog er sikker (fx manuel recovery efter en gh-fejl).
//
// Tests: node --test scripts/merge-queue-closeout.test.mjs

import { spawnSync } from 'node:child_process';

export const DEFAULT_REPO = 'NicolaiDolmer/CyclingZone';
export const MARKER_PREFIX = 'merge-queue-closeout:v1';
const CLOSE_WORDS = 'close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved';
const REF_RE = new RegExp(`\\b(refs|${CLOSE_WORDS})\\b\\s*:?\\s*(#\\d+(?:\\s*(?:,|\\band\\b|\\bog\\b|&)\\s*#\\d+)*)`, 'gi');

export function markerFor(pr, issue) {
  return `<!-- ${MARKER_PREFIX} pr=${pr} issue=${issue} -->`;
}

// HTML-kommentarer (PR-skabelonens hjaelpetekst) og kodeblokke er ikke referencer.
export function stripNonProse(body) {
  return String(body ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

// [{ issue, kind: 'closes'|'refs' }] i foerste forekomsts raekkefoelge; closes vinder over refs.
export function parseIssueRefs(body, selfNumber = null) {
  const text = stripNonProse(body);
  const byIssue = new Map();
  for (const match of text.matchAll(REF_RE)) {
    const kind = match[1].toLowerCase() === 'refs' ? 'refs' : 'closes';
    for (const num of match[2].matchAll(/#(\d+)/g)) {
      const issue = Number(num[1]);
      if (!Number.isSafeInteger(issue) || issue <= 0 || issue === selfNumber) continue;
      const prev = byIssue.get(issue);
      if (!prev) byIssue.set(issue, { issue, kind });
      else if (kind === 'closes') prev.kind = 'closes';
    }
  }
  return [...byIssue.values()];
}

export function shortSha(sha) {
  return String(sha ?? '').slice(0, 8);
}

export function verificationText(deployVerified) {
  return deployVerified ? 'main-CI + deploy-verifikation grønne' : 'main-CI grøn, toget deployer ikke';
}

export function commentBody({ pr, issue, sha, kind, deployVerified = true }) {
  const tail = kind === 'closes'
    ? 'PR\'en lukker issuet (`Closes`); label flyttet til `claude:done` hvis det stod på `claude:todo`.'
    : 'PR\'en refererer issuet (`Refs`); labels er ikke ændret.';
  return `${markerFor(pr, issue)}\nMerget via merge-køen: PR #${pr} som \`${shortSha(sha)}\` (${sha}). Verificeret: ${verificationText(deployVerified)}. ${tail}`;
}

// d/M i Europe/Copenhagen (projektets tidszone).
export function copenhagenDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', day: 'numeric', month: 'numeric' }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${Number(get('day'))}/${Number(get('month'))}`;
}

function shortTitle(title) {
  const clean = String(title ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > 70 ? `${clean.slice(0, 67)}...` : clean;
}

export function buildNowLine(prs, now = new Date(), deployVerified = true) {
  if (!prs.length) return null;
  const parts = prs.map((pr) => {
    const refs = pr.refs.map((r) => `${r.kind === 'closes' ? 'Closes' : 'Refs'} #${r.issue}`).join(', ');
    const title = shortTitle(pr.title);
    return `#${pr.number} \`${shortSha(pr.sha)}\`${title ? ` ${title}` : ''}${refs ? ` (${refs})` : ''}`;
  });
  return `- ${copenhagenDate(now)} merge-tog verificeret (${verificationText(deployVerified)}): ${parts.join('; ')}.`;
}

export function validTrain(train) {
  return Array.isArray(train) && train.length > 0 && train.every((e) =>
    Number.isSafeInteger(e?.number) && e.number > 0 && (e.sha === null || /^[0-9a-f]{40}$/.test(String(e.sha))));
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

// Laes alle kommentar-bodies for et issue. null = kunne ikke laeses (skriv da intet).
function readCommentBodies(gh, repo, issue) {
  const res = gh(['api', `repos/${repo}/issues/${issue}/comments?per_page=100`, '--paginate', '--slurp']);
  if (res.status !== 0) return null;
  const pages = parseJson(res.stdout);
  if (!Array.isArray(pages)) return null;
  const bodies = [];
  for (const page of pages) {
    if (!Array.isArray(page)) return null;
    for (const c of page) bodies.push(String(c?.body ?? ''));
  }
  return bodies;
}

// gh injiceres: (args: string[]) => { status, stdout }. Kaster aldrig.
export function runCloseOut({ train, repo = DEFAULT_REPO, dryRun = false, deployVerified = true, gh, now = new Date(), log = () => {} }) {
  const result = { prs: [], comments: [], skippedComments: [], flips: [], errors: [], nowLine: null, dryRun };
  if (!validTrain(train)) { result.errors.push('ugyldigt tog'); return result; }
  if (typeof gh !== 'function') { result.errors.push('ingen gh-runner'); return result; }
  const say = (line) => log(dryRun ? `[dry-run] ${line}` : line);
  for (const entry of train) {
    let refs = [];
    let title = '';
    try {
      const view = gh(['pr', 'view', String(entry.number), '--repo', repo, '--json', 'body,title']);
      const parsed = view.status === 0 ? parseJson(view.stdout) : undefined;
      if (!parsed || typeof parsed !== 'object') {
        result.errors.push(`PR #${entry.number}: body kunne ikke laeses`);
      } else {
        title = String(parsed.title ?? '');
        refs = parseIssueRefs(parsed.body, entry.number);
      }
    } catch (err) {
      result.errors.push(`PR #${entry.number}: ${err?.message ?? err}`);
    }
    result.prs.push({ number: entry.number, sha: entry.sha, title, refs });
    if (!refs.length) say(`close-out PR #${entry.number}: ingen Refs/Closes-issues i PR-body.`);
    for (const ref of refs) {
      try { closeOutIssue({ entry, ref, repo, dryRun, deployVerified, gh, result, say }); }
      catch (err) { result.errors.push(`#${ref.issue}: ${err?.message ?? err}`); }
    }
  }
  if (train.every((e) => e.sha)) result.nowLine = buildNowLine(result.prs, now, deployVerified);
  return result;
}

function closeOutIssue({ entry, ref, repo, dryRun, deployVerified, gh, result, say }) {
  const pr = entry.number;
  const issue = ref.issue;
  const marker = markerFor(pr, issue);
  const bodies = readCommentBodies(gh, repo, issue);
  if (bodies === null) {
    result.errors.push(`#${issue}: kommentarer kunne ikke laeses; SHA-kommentar springes over (ingen dublet-risiko)`);
  } else if (bodies.some((b) => b.includes(marker))) {
    result.skippedComments.push({ issue, pr });
    say(`close-out #${issue}: SHA-kommentar for PR #${pr} findes allerede.`);
  } else if (!entry.sha) {
    say(`close-out #${issue}: ville skrive SHA-kommentar for PR #${pr} (merge-SHA kendes efter merge).`);
  } else if (dryRun) {
    say(`close-out #${issue}: ville skrive SHA-kommentar for PR #${pr} (${shortSha(entry.sha)}).`);
  } else {
    const res = gh(['issue', 'comment', String(issue), '--repo', repo, '--body', commentBody({ pr, issue, sha: entry.sha, kind: ref.kind, deployVerified })]);
    if (res.status === 0) { result.comments.push({ issue, pr }); say(`close-out #${issue}: SHA-kommentar skrevet (PR #${pr}, ${shortSha(entry.sha)}).`); }
    else result.errors.push(`#${issue}: SHA-kommentar fejlede (gh exit ${res.status})`);
  }
  if (ref.kind !== 'closes') return;
  const view = gh(['issue', 'view', String(issue), '--repo', repo, '--json', 'labels']);
  const parsed = view.status === 0 ? parseJson(view.stdout) : undefined;
  if (!parsed || !Array.isArray(parsed.labels)) { result.errors.push(`#${issue}: labels kunne ikke laeses; intet flip`); return; }
  const names = parsed.labels.map((l) => String(l?.name ?? ''));
  if (!names.includes('claude:todo')) {
    say(`close-out #${issue}: intet claude:todo at flippe${names.includes('claude:done') ? ' (allerede claude:done)' : ''}.`);
    return;
  }
  // Uden merge-SHA (forhaandsvisning foer merge) skrives heller ikke labels.
  if (dryRun || !entry.sha) { say(`close-out #${issue}: ville flippe claude:todo -> claude:done (Closes i PR #${pr}).`); return; }
  const edit = gh(['issue', 'edit', String(issue), '--repo', repo, '--remove-label', 'claude:todo', '--add-label', 'claude:done']);
  if (edit.status === 0) { result.flips.push(issue); say(`close-out #${issue}: claude:todo -> claude:done.`); }
  else result.errors.push(`#${issue}: label-flip fejlede (gh exit ${edit.status})`);
}

export function defaultGh(args) {
  const res = spawnSync('gh', args, { encoding: 'utf8', timeout: 60_000, windowsHide: true });
  return { status: res.error ? 1 : (res.status ?? 1), stdout: res.stdout ?? '' };
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv = process.argv.slice(2), { gh = defaultGh, out = (l) => process.stdout.write(`${l}\n`) } = {}) {
  if (argv[0] !== 'run') { out('Brug: node scripts/merge-queue-closeout.mjs run --train <json> [--repo owner/name] [--dry-run]'); return 1; }
  const train = parseJson(argValue(argv, '--train') ?? '');
  if (!validTrain(train)) { out('close-out: ugyldigt --train (forventer [{number, sha}]).'); return 1; }
  const repo = argValue(argv, '--repo') ?? DEFAULT_REPO;
  const dryRun = argv.includes('--dry-run');
  const deployVerified = !argv.includes('--no-deploy');
  const result = runCloseOut({ train, repo, dryRun, deployVerified, gh, log: out });
  for (const err of result.errors) out(`close-out ADVARSEL: ${err}`);
  if (result.nowLine) out(`NOW-LINJE (commit selv i docs/NOW.md ved close-out): ${result.nowLine}`);
  out(`close-out ${dryRun ? '[dry-run] ' : ''}faerdig: ${result.comments.length} kommentar(er), ${result.skippedComments.length} fandtes allerede, ${result.flips.length} flip, ${result.errors.length} advarsel(er).`);
  return 0;
}

if (process.argv[1]?.endsWith('merge-queue-closeout.mjs')) {
  let code = 0;
  try { code = main(); } catch (err) { process.stdout.write(`close-out ADVARSEL: uventet fejl: ${err?.message ?? err}\n`); code = 0; }
  process.exitCode = code;
}
