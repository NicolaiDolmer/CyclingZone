#!/usr/bin/env node
// merge-autotrain.mjs: auto-tog for merge-koeen (#7654, ejer-valg 4/11).
//
// Baggrund: merges gik for langsomt, fordi et tog kun koerte naar en session
// huskede at starte det. Dette script koeres af en Windows-planlagt opgave paa
// PC1 (scripts/install-merge-autotrain-task.ps1, hvert 20. minut) og:
//   1. lister aabne, ikke-draft PR'er mod main;
//   2. vaelger dem der er klar: paakraevede checks groenne, review-gate groen
//      (samme regel som scripts/lib/league-check.ps1), MERGEABLE, og en
//      staaende kategori fra scripts/merge-queue-classify.mjs (hard rule 35).
//      EJER-GO koerer kun med ejerens eksplicitte merge-markoer (se nedenfor);
//   3. kalder scripts/merge-queue.ps1 EEN gang med ET samlet tog (ejer 17/11, #8331):
//      op til TRAIN_MAX_BATCH klare PR'er, hoejst TRAIN_MAX_DEPLOY deploy-PR'er sidst i toget (solo alene).
//      Hver PR vurderes frisk lige foer koeen startes, og koeen faar det vurderede
//      hoved pr. PR (-ExpectHead); et andet hoved merges aldrig (Codex P1 #7657).
//      Koeen faar -CiTimeoutMinutes 90 (17/11: 25 min gav falsk timeout og laaste toget,
//      mens main-CI stod i GitHubs koe). Kun hvis ingen anden koe koerer (tog-markoeren
//      fra #7633: levende markoer = goer intet; koeen tager den selv atomisk, exit 3).
//
// Ejerens merge-markoer: EJER-GO-PR'er (ogsaa dem med den klaebende
// klassifikator-markoer "merge-queue-category: ejer-go") medtages KUN naar en
// kommentar fra repo-ejerens konto indeholder
//   <!-- merge-autotrain: ejer-merge sha=<head-sha, min. 7 hex> -->
// og SHA'en matcher PR'ens nuvaerende hoved. Den skrives kun efter ejerens
// ordrette "merge" (hard rule 35). Et nyt push goer markoeren ugyldig, saa et
// go aldrig daekker kode ejeren ikke har set. Kommentarer fra andre konti
// ignoreres (repoet er offentligt).
//
// Gen-bestilling af Codex-review (#7654, ejer 23/11): efter update-branch eller merge af
// main i en PR staar Codex-reviewet paa det gamle hoved, og ingen bestilte et nyt, saa PR'en
// stod stille. For hver aaben, ikke-draft PR med ejer-markoer eller staaende kategori, hvor
// review-gatens Codex-del mangler paa HEAD, skriver toget EN `@codex review`-kommentar
// (idempotent pr. hoved: ikke naar en bestilling allerede daekker hovedet. Togets egen bestilling
// baerer en skjult markoer med hoved-SHA'en; en manuel bestilling daekker, hvis den er skrevet
// efter hovedets commit).
// Svarede Codex "Something went wrong", bestilles igen hoejst een gang i timen. Ejer-markoerer
// roeres aldrig.
//
// Merge-koeen genkontrollerer selv checks, review-gate, liga-audit og boelge-
// ownership foer hvert merge; udvaelgelsen her er kun forfilteret.
//
// CLI (exit altid 0, fail-soft):
//   node scripts/merge-autotrain.mjs [--dry-run] [--log] [--repo owner/name]
//   --dry-run  laeser og viser beslutningerne; ingen koe eller tilstand.
//   --log      skriver ogsaa til .claude/run/merge-autotrain.log (bruges af den planlagte opgave).
//
// Tests: node --test scripts/merge-autotrain.test.mjs

import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORY, DEFAULT_REPO, classifyPr, fetchMigrationFacts, formatClassification } from './merge-queue-classify.mjs';
import { gitCommonRoot, markerFilePath, readActiveMarker } from './merge-queue-active-marker.mjs';
import { deploymentAttemptState, handedOffRunVerdict } from './ci/deploy-verification-state.mjs';
import { classifyPrFiles, mustRunAlone, touchesVercel } from './merge-queue-files.mjs';
import { latestOwnerMarkerSha, runMergeGuard } from './merge-guard.mjs';
import { CODEX_LOGIN, EXEMPT_AUTHORS, evaluateCodex } from './review-gate.mjs';

export const LOG_RELATIVE = join('.claude', 'run', 'merge-autotrain.log');
// Samme loft som merge-queue.ps1's -MaxBatch (testen laaser de to sammen).
export const TRAIN_MAX_BATCH = 5;
// Ejer 20/11: op til 3 deploy-PR'er pr. tog (koeen understoetter det siden 23/10, -MaxDeployBatch);
// togets sidste merge-SHA baerer deploy-verifikationen, og koeen lukker selv toget, hvis den sidste
// PR ikke daekker togets deploy-maal (Codex P1 #7104). En solo-PR (migration/motor) koerer altid alene.
export const TRAIN_MAX_DEPLOY = 3;
// main-CI tog 76-110 min i koe-spidser 16-17/11; sendes eksplicit til koeen.
export const QUEUE_CI_TIMEOUT_MINUTES = 90;
// merge-queue.ps1: 2 = nogle PR'er sprunget over, men det merged er verificeret; 3 = en anden koe ejer markoeren.
export const QUEUE_EXIT_PARTIAL = 2;
export const QUEUE_EXIT_BUSY = 3;
// Codex P1 (#7657): en koe der sluttede uden exit 0 (main-CI/deploy roed eller uverificeret)
// laaser toget paa tvaers af koersler, til main's HEAD er positivt verificeret.
export const BLOCK_RELATIVE = join('.claude', 'run', 'merge-autotrain-block.json');
const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

// Labels der altid holder en PR ude af toget.
export const HOLD_LABELS = Object.freeze(['claude:blocked', 'codex:blocked-access', 'do-not-merge', 'hold']);

export const OWNER_MERGE_MARKER_RE = /<!--\s*merge-autotrain:\s*ejer-merge\s+sha=([0-9a-f]{7,40})\s*-->/i;

// ── Ren kerne ──────────────────────────────────────────────────────────────

/** Paakraevede checks: mindst eet, og alle pass/skipping (som `gh pr checks --required` exit 0). */
export function requiredChecksStatus(checks) {
  const list = Array.isArray(checks) ? checks : [];
  if (!list.length) return { green: false, reason: 'ingen paakraevede checks fundet' };
  const notGreen = list.filter((c) => !['pass', 'skipping'].includes(String(c?.bucket ?? '')));
  if (notGreen.length) {
    const pending = notGreen.some((c) => c?.bucket === 'pending');
    return { green: false, reason: `${pending ? 'afventer' : 'roed'}: ${notGreen.map((c) => c?.name ?? '?').slice(0, 3).join(', ')}` };
  }
  if (!list.some((c) => c?.bucket === 'pass')) return { green: false, reason: 'kun skippede paakraevede checks' };
  return { green: true, reason: 'groen' };
}

const isTrustedReviewGate = (c) => c?.name === 'review-gate' && c?.event === 'pull_request_target';

function startedAtMs(c) {
  const t = Date.parse(String(c?.startedAt ?? ''));
  // Spejler league-check.ps1: uden (gyldigt) starttidspunkt sorteres koerslen som nyest.
  return Number.isFinite(t) && new Date(t).getUTCFullYear() > 1 ? t : Number.MAX_SAFE_INTEGER;
}

/** Review-gate (#6654): nyeste koersel fra pull_request_target skal vaere pass. */
export function reviewGateStatus(allChecks) {
  const runs = (Array.isArray(allChecks) ? allChecks : []).filter(isTrustedReviewGate);
  if (!runs.length) return { green: false, reason: 'intet review-gate-check fra pull_request_target' };
  const latest = [...runs].sort((a, b) => startedAtMs(b) - startedAtMs(a))[0];
  if (latest.bucket === 'pass') return { green: true, reason: 'groen' };
  return { green: false, reason: latest.bucket === 'pending' ? 'review-gate afventer' : 'review-gate roed' };
}

/** Ejerens merge-markoer, skrevet fra ejerens konto og bundet til det nuvaerende hoved. */
export function hasOwnerMergeApproval(comments, { headSha, ownerLogin }) {
  const head = String(headSha ?? '').toLowerCase();
  const owner = String(ownerLogin ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(head) || !owner) return false;
  return (comments ?? []).some((c) => {
    if (String(c?.author?.login ?? '').toLowerCase() !== owner) return false;
    const m = OWNER_MERGE_MARKER_RE.exec(String(c?.body ?? ''));
    return Boolean(m) && head.startsWith(m[1].toLowerCase());
  });
}

function labelNames(labels) {
  return (labels ?? []).map((l) => String(typeof l === 'string' ? l : l?.name ?? '').toLowerCase()).filter(Boolean);
}

/**
 * Vurderer een PR. `ready` = alt groent;
 * `eligible` = ready og maa koere i toget uden ejeren (eller med ejerens markoer).
 */
/** Afslag der ikke kraever check- eller klassifikationskald. null = gaa videre. */
export function precheck(pr, { baseBranch = 'main' } = {}) {
  if (pr?.isDraft) return 'draft';
  if (String(pr?.baseRefName ?? '') !== baseBranch) return `base er ikke ${baseBranch}`;
  const held = labelNames(pr?.labels).find((l) => HOLD_LABELS.includes(l));
  if (held) return `label ${held}`;
  if (pr?.mergeable !== 'MERGEABLE') return `mergeable=${pr?.mergeable ?? 'UNKNOWN'}`;
  return null;
}

/**
 * Udloeser PR'en et deploy (samme regel som merge-queue.ps1: backend, Railway eller
 * Vercel), eller skal den koere alene (migration/motor)? Ukendt filliste = ja (fail-safe).
 */
export function deployImpact(files) {
  const paths = Array.isArray(files) ? files.map((f) => (typeof f === 'string' ? f : f?.path)) : null;
  if (!paths?.length || paths.some((p) => typeof p !== 'string')) return { deploys: true, solo: true };
  const { touchesBackend, touchesRailway } = classifyPrFiles(paths);
  const solo = mustRunAlone(paths);
  return { deploys: Boolean(touchesBackend || touchesRailway || touchesVercel(paths) || solo), solo };
}

export function evaluatePr(pr, { requiredChecks, allChecks, classification, ownerLogin, baseBranch = 'main', deploy = null }) {
  const out = {
    number: Number(pr?.number),
    title: String(pr?.title ?? ''),
    headSha: String(pr?.headRefOid ?? ''),
    ready: false,
    eligible: false,
    deploys: deploy ? Boolean(deploy.deploys) : true,
    solo: deploy ? Boolean(deploy.solo) : true,
    category: classification?.category ?? null,
    classification: classification ? formatClassification(classification) : null,
    reason: '',
    // Merge-vagten (#8331): seneste ejer-markoer uanset hoved.
    ownerMarkerSha: latestOwnerMarkerSha(pr?.comments, ownerLogin),
  };
  const no = (reason) => ({ ...out, reason });
  const pre = precheck(pr, { baseBranch });
  if (pre) return no(pre);
  const req = requiredChecksStatus(requiredChecks);
  if (!req.green) return no(`checks: ${req.reason}`);
  const gate = reviewGateStatus(allChecks);
  if (!gate.green) return no(gate.reason);
  const ready = { ...out, ready: true };
  if (!classification) return { ...ready, reason: 'kunne ikke klassificeres (ejer-go)' };
  if (classification.category !== CATEGORY.OWNER) return { ...ready, eligible: true, reason: `staaende kategori ${classification.category}` };
  if (hasOwnerMergeApproval(pr?.comments, { headSha: pr?.headRefOid, ownerLogin })) {
    return { ...ready, eligible: true, reason: 'ejer-go med ejerens merge-markoer paa nuvaerende hoved' };
  }
  return { ...ready, reason: 'klar, men kraever ejer-go' };
}

/**
 * PR-numre til ET samlet tog (ejer 17/11, #8331), aeldste foerst, hoejst maxBatch.
 * Deploy-reglen (ejer 20/11): hoejst maxDeploy deploy-PR'er (de aeldste), sidst i toget, saa
 * togets sidste merge-SHA baerer deploy-verifikationen (Codex P1 #6861); koeen lukker selv
 * toget, hvis en PR ikke daekker togets deploy-maal (#7104). En solo-PR (migration/motor eller
 * ukendt status, fail-safe) koerer altid som eneste deploy-PR. Resten venter til naeste koersel.
 */
export function selectTrain(evaluations, { maxBatch = TRAIN_MAX_BATCH, maxDeploy = TRAIN_MAX_DEPLOY } = {}) {
  const eligible = (evaluations ?? []).filter((e) => e?.eligible).sort((a, b) => a.number - b.number);
  const deployAll = eligible.filter((e) => e.deploys !== false);
  const deploys = deployAll.length && deployAll[0].solo !== false
    ? [deployAll[0]]
    : deployAll.filter((e) => e.solo === false).slice(0, Math.max(0, Math.min(maxDeploy, maxBatch)));
  const quiet = eligible.filter((e) => e.deploys === false).map((e) => e.number);
  const room = Math.max(0, maxBatch - deploys.length);
  return [...quiet.slice(0, room), ...deploys.map((e) => e.number)];
}

/** Gaa intet, hvis en koe allerede koerer (levende tog-markoer). */
export function decideAction({ activeMarker, train }) {
  if (activeMarker) return { run: false, reason: `merge-koe koerer allerede (pid ${activeMarker.pid}, startet ${activeMarker.startedAt})` };
  if (!train.length) return { run: false, reason: 'ingen klare PR\'er i staaende kategori' };
  return { run: true, reason: `${train.length} PR'er klar: ${train.map((n) => `#${n}`).join(', ')}` };
}

// IO og vedvarende sikkerhedslaas.

export function writeState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

function runGhRaw(args) {
  const res = spawnSync('gh', args, { encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw res.error;
  return { status: res.status, stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? '') };
}

function ghJson(args, { allowExit = [0] } = {}) {
  const res = runGhRaw(args);
  if (!allowExit.includes(res.status)) throw new Error(`gh ${args.slice(0, 2).join(' ')} exit ${res.status}: ${res.stderr.trim().slice(0, 200)}`);
  return JSON.parse(res.stdout || 'null');
}

function ghText(args) {
  const res = runGhRaw(args);
  if (res.status !== 0) {
    const err = new Error(res.stderr.trim().slice(0, 300));
    err.stderr = res.stderr;
    throw err;
  }
  return res.stdout;
}

const PR_FIELDS = 'number,title,body,labels,author,comments,isDraft,mergeable,baseRefName,headRefOid,baseRefOid,changedFiles';

// gh pr checks: exit 1 = noget fejler, exit 8 = afventer; JSON-outputtet er det samme.
const CHECKS_EXIT = [0, 1, 8];

/**
 * Den fulde filliste til klassifikationen (REST, pagineret): GraphQL-listen i
 * `gh pr list` kan vaere afkortet, og en omdoebning skal ogsaa vurderes paa sin
 * kildesti (kode flyttet ind under docs/ maa ikke blive "docs"). Kildestien
 * taeller som slettet, saa en omdoebt migration altid er ejer-go.
 * null = listen er ufuldstaendig (klassifikationen bliver da ejer-go).
 */
export function completeFileList(restFiles, changedFiles) {
  const list = Array.isArray(restFiles) ? restFiles.flat() : [];
  if (!list.length || !Number.isSafeInteger(changedFiles) || list.length !== changedFiles) return null;
  const files = [];
  for (const f of list) {
    if (!f?.filename) return null;
    files.push({ path: f.filename, additions: Number(f.additions) || 0, deletions: Number(f.deletions) || 0 });
    if (f.previous_filename && f.previous_filename !== f.filename) {
      files.push({ path: f.previous_filename, additions: 0, deletions: Math.max(1, Number(f.deletions) || 0) });
    }
  }
  return files;
}

/** Vurderer een PR (checks, review-gate, fuld filliste, klassifikation). */
export function evaluateOne(pr, { repo, ownerLogin, gh, log = () => {} }) {
  // Billige afslag foerst: ingen check- eller klassifikationskald for drafts/konflikter.
  if (precheck(pr)) return evaluatePr(pr, { ownerLogin });
  const requiredChecks = gh.json(['pr', 'checks', String(pr.number), '--repo', repo, '--required', '--json', 'name,bucket'], { allowExit: CHECKS_EXIT }) ?? [];
  const allChecks = gh.json(['pr', 'checks', String(pr.number), '--repo', repo, '--json', 'name,bucket,startedAt,event'], { allowExit: CHECKS_EXIT }) ?? [];
  let classification = null;
  let deploy = null;
  // Klassifikationen kraever kun groenne paakraevede checks (review-gate er ikke paakraevet):
  // en PR med roed/manglende review-gate skal ogsaa kendes som staaende kategori (#7654).
  if (requiredChecksStatus(requiredChecks).green) {
    try {
      const rest = gh.json(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${pr.number}/files?per_page=100`]);
      const files = completeFileList(rest, pr.changedFiles);
      if (!files) {
        log(`  #${pr.number}: fillisten er ufuldstaendig; behandles som ejer-go.`);
      } else {
        deploy = deployImpact(files);
        const full = { ...pr, files };
        Object.assign(full, fetchMigrationFacts(full, repo, { runGh: gh.text }));
        classification = classifyPr(full);
      }
    } catch (err) {
      log(`  #${pr.number}: klassifikation fejlede (${err?.message ?? err}); behandles som ejer-go.`);
    }
  }
  return evaluatePr(pr, { requiredChecks, allChecks, classification, ownerLogin, deploy });
}

const DEFAULT_GH = { json: ghJson, text: ghText };

export function collectEvaluations({ repo, ownerLogin, gh = DEFAULT_GH, log = () => {} }) {
  const prs = gh.json(['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '100', '--json', PR_FIELDS]) ?? [];
  const evaluations = [];
  for (const pr of prs) {
    try {
      evaluations.push(evaluateOne(pr, { repo, ownerLogin, gh, log }));
    } catch (err) {
      log(`  #${pr.number}: kunne ikke vurderes (${err?.message ?? err}); springes over.`);
    }
  }
  return evaluations;
}

/** Frisk vurdering af een PR lige foer koeen startes for den. */
export function reevaluatePr(number, { repo, ownerLogin, gh = DEFAULT_GH, log = () => {} }) {
  const pr = gh.json(['pr', 'view', String(number), '--repo', repo, '--json', PR_FIELDS]);
  return evaluateOne(pr, { repo, ownerLogin, gh, log });
}

// ── Gen-bestilling af Codex-review (#7654) ─────────────────────────────────

export const CODEX_REQUEST_COMMENT = '@codex review';
// Toget binder sin bestilling til hoved-SHA'en med en skjult markoer (Codex P2 paa PR'en): committer-datoen er
// forfatter-styret og kan ligge foer en bestilling paa det forrige hoved eller i fremtiden.
export const CODEX_REQUEST_MARKER_RE = /<!--\s*merge-autotrain:\s*codex-review-request\s+sha=([0-9a-f]{7,40})\s*-->/i;
export const codexRequestBody = (headSha) => `${CODEX_REQUEST_COMMENT}\n\n<!-- merge-autotrain: codex-review-request sha=${String(headSha).toLowerCase()} -->`;
// Hoejst een gen-bestilling i timen, naar Codex svarede med en fejl.
export const CODEX_RETRY_MS = 60 * 60_000;
// Kun en kommentar der STARTER med bestillingen taeller: review-gatens egne kommentarer
// naevner `@codex review` midt i en forklaring og er ikke en bestilling.
const CODEX_REQUEST_RE = /^\s*@codex\s+review\b/i;
const CODEX_ERROR_RE = /something went wrong/i;
const STANDING_CATEGORIES = new Set([CATEGORY.A_BRAND_FIX, CATEGORY.B_ENGINE_V4, CATEGORY.C_SAFE, CATEGORY.D_ADDITIVE_MIGRATION]);
// Afslag fra precheck() der ikke giver mening at bruge en review paa (UNKNOWN maa gerne, det er kortvarigt).
const NO_REVIEW_REASON_RE = /^(draft|base er ikke|label |mergeable=(CONFLICTING|DIRTY))/i;

const botLogin = (l) => String(l ?? '').replace(/^app\//i, '').replace(/\[bot\]$/i, '').toLowerCase();
const timeMs = (iso) => Date.parse(String(iso ?? ''));

/**
 * Hvilke vurderede PR'er kan komme i betragtning? Ikke klar (klar = gaten er groen, dvs.
 * Codex har reviewet hovedet), ikke draft/hold/konflikt, og enten ejer-markoer eller staaende
 * kategori. Ejer-go uden markoer er ejerens og faar ingen automatik.
 */
export function codexReviewCandidates(evaluations) {
  return (evaluations ?? []).filter((e) => e
    && Number.isSafeInteger(e.number)
    && !e.ready
    && !NO_REVIEW_REASON_RE.test(String(e.reason ?? ''))
    && (e.ownerMarkerSha || STANDING_CATEGORIES.has(e.category)));
}

/**
 * Skal der bestilles en Codex-review af hovedet nu? Ren funktion.
 * Input er rene REST-former: comments {author, body, createdAt}, reviews {author, body, commit, submittedAt}.
 * Samme Codex-regler som review-gaten (evaluateCodex): kun bevis paa PR'ens aktuelle HEAD taeller.
 * @returns {{request: boolean, reason: string}}
 */
export function decideCodexRerequest({ comments = [], reviews = [], headSha, headCommittedAt, isDraft = false, author = '', ownerLogin = '', now = new Date() }) {
  if (isDraft) return { request: false, reason: 'draft' };
  if (EXEMPT_AUTHORS.includes(botLogin(author))) return { request: false, reason: 'undtaget fra Codex-krav' };
  const codex = evaluateCodex({ comments, reviews, headSha });
  if (codex.state === 'completed') return { request: false, reason: 'Codex har reviewet hovedet' };
  if (codex.state === 'pending') return { request: false, reason: 'Codex-review koerer' };
  const headAt = timeMs(headCommittedAt);
  const head = String(headSha ?? '').toLowerCase();
  const owner = botLogin(ownerLogin);
  const isCodex = (x) => botLogin(x?.author) === CODEX_LOGIN;
  // En bestilling daekker hovedet, naar den er togets egen (ejerens konto + markoer) og bundet til SHA'en,
  // ellers (manuel bestilling) naar den er skrevet efter hovedets commit.
  const requestAts = comments
    .filter((c) => !isCodex(c) && CODEX_REQUEST_RE.test(String(c?.body ?? '')))
    .map((c) => {
      const at = timeMs(c.createdAt);
      const bound = owner && botLogin(c.author) === owner ? CODEX_REQUEST_MARKER_RE.exec(String(c.body ?? ''))?.[1]?.toLowerCase() : null;
      const covers = bound ? head.startsWith(bound) : Number.isFinite(headAt) && Number.isFinite(at) && at > headAt;
      return covers && Number.isFinite(at) ? at : null;
    })
    .filter((t) => t !== null);
  if (!requestAts.length) {
    // Uden kendt hovedtidspunkt kan en manuel bestilling ikke vurderes: hellere ingen kommentar end en dobbelt.
    if (!Number.isFinite(headAt)) return { request: false, reason: 'hovedets tidspunkt ukendt' };
    return { request: true, reason: 'ingen bestilling paa hovedet' };
  }
  const lastRequest = Math.max(...requestAts);
  const errorAts = [...comments.map((c) => ({ x: c, at: timeMs(c?.createdAt) })), ...reviews.map((r) => ({ x: r, at: timeMs(r?.submittedAt) }))]
    .filter(({ x, at }) => isCodex(x) && CODEX_ERROR_RE.test(String(x?.body ?? '')) && Number.isFinite(at))
    .map(({ at }) => at);
  const errored = codex.state === 'failed' || errorAts.some((t) => t > lastRequest);
  if (!errored) return { request: false, reason: 'allerede bestilt efter hovedets commit' };
  if (now.getTime() - lastRequest < CODEX_RETRY_MS) return { request: false, reason: 'Codex fejlede, men der er bestilt inden for den seneste time' };
  return { request: true, reason: 'Codex fejlede paa hovedet; ny bestilling (hoejst en i timen)' };
}

/** Rene REST-fakta til decideCodexRerequest. Kaster ved gh-fejl. */
export function fetchCodexFacts(number, { repo, gh = DEFAULT_GH }) {
  const flat = (pages) => (Array.isArray(pages) ? pages.flat() : []);
  const meta = gh.json(['api', `repos/${repo}/pulls/${number}`]);
  const headSha = String(meta?.head?.sha ?? '');
  if (!/^[0-9a-f]{40}$/i.test(headSha)) throw new Error('hoved-SHA ukendt');
  const comments = flat(gh.json(['api', '--paginate', '--slurp', `repos/${repo}/issues/${number}/comments?per_page=100`]))
    .map((c) => ({ author: c?.user?.login ?? '', body: c?.body ?? '', createdAt: c?.created_at ?? '' }));
  const reviews = flat(gh.json(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${number}/reviews?per_page=100`]))
    .map((r) => ({ author: r?.user?.login ?? '', body: r?.body ?? '', commit: r?.commit_id ?? null, submittedAt: r?.submitted_at ?? '' }));
  const headCommittedAt = String(gh.text(['api', `repos/${repo}/commits/${headSha}`, '--jq', '.commit.committer.date'])).trim();
  return { headSha, isDraft: Boolean(meta?.draft), author: meta?.user?.login ?? '', comments, reviews, headCommittedAt };
}

/**
 * Bestiller Codex-review paa de PR'er hvor den mangler paa hovedet. Hoejst een kommentar pr. PR
 * pr. koersel, aldrig paa drafts, fail-soft pr. PR. Dry-run logger kun. Returnerer PR-numrene.
 */
export function requestStaleCodexReviews({ evaluations, repo, now = new Date(), dryRun = false, gh = DEFAULT_GH, log = () => {} }) {
  const requested = [];
  for (const e of codexReviewCandidates(evaluations)) {
    try {
      const facts = fetchCodexFacts(e.number, { repo, gh });
      const verdict = decideCodexRerequest({ ...facts, ownerLogin: repo.split('/')[0], now });
      if (!verdict.request) continue;
      if (dryRun) { log(`  DRY-RUN: ville gen-bestille review: #${e.number} (HEAD ${facts.headSha.slice(0, 7)}) - ${verdict.reason}.`); continue; }
      gh.text(['pr', 'comment', String(e.number), '--repo', repo, '--body', codexRequestBody(facts.headSha)]);
      requested.push(e.number);
      log(`  gen-bestilt review: #${e.number} (HEAD ${facts.headSha.slice(0, 7)})`);
    } catch (err) {
      log(`  #${e.number}: gen-bestilling af review fejlede (${err?.message ?? err}).`);
    }
  }
  return requested;
}

/**
 * Maa koeen startes for PR'en nu? Den skal stadig vaere eligible, og hovedet maa
 * ikke have flyttet sig siden udvaelgelsen (ejer-go og kategori gaelder et hoved).
 */
export function confirmBeforeQueue(selected, fresh) {
  if (!fresh?.eligible) return { ok: false, reason: `ikke laengere klar (${fresh?.reason ?? 'ukendt'})` };
  if (!/^[0-9a-f]{40}$/i.test(String(fresh.headSha)) || fresh.headSha !== selected.headSha) {
    return { ok: false, reason: `hovedet har flyttet sig (${String(selected.headSha).slice(0, 7)} -> ${String(fresh.headSha).slice(0, 7)})` };
  }
  return { ok: true, reason: 'uaendret og klar' };
}

export function readBlock(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && Number.isInteger(parsed.pr) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Codex P1 (#7657): er main's aktuelle HEAD positivt verificeret? CI (main) skal vaere
 * faerdig og groen. Findes en deploy-verify-koersel for samme SHA, afgoer koeens egen
 * klassifikator det (deploy-verification-state.mjs): releasen skal vaere 'released' og
 * release checks 'ok'. Workflowets samlede conclusion taeller ikke, for "Deployment
 * still pending" slutter ogsaa groent. Alt andet (koerer, roed, ukendt, fejl) = nej.
 */
export function mainVerifiedFromRuns({ headSha, ciRuns = [], deploy = null }) {
  if (!/^[0-9a-f]{40}$/i.test(String(headSha))) return { ok: false, reason: 'main-HEAD ukendt' };
  const ci = ciRuns.find((r) => r.headSha === headSha);
  if (!ci) return { ok: false, reason: `ingen CI (main) for ${headSha.slice(0, 7)} endnu` };
  if (ci.status !== 'completed' || ci.conclusion !== 'success') return { ok: false, reason: `CI (main) ${headSha.slice(0, 7)}: ${ci.status}/${ci.conclusion || '-'}` };
  if (deploy) {
    const state = deploymentAttemptState(deploy.run, deploy.jobs, headSha, 1);
    if (state !== 'released') return { ok: false, reason: `deploy ${headSha.slice(0, 7)}: ${state}` };
    const verdict = handedOffRunVerdict(deploy.run, deploy.jobs);
    if (verdict !== 'ok') return { ok: false, reason: `release checks ${headSha.slice(0, 7)}: ${verdict}` };
  }
  return { ok: true, reason: `main ${headSha.slice(0, 7)} groen${deploy ? ' og released' : ''}` };
}

function defaultCheckMain({ repo }) {
  const head = runGhRaw(['api', `repos/${repo}/commits/main`, '--jq', '.sha']);
  if (head.status !== 0) return { ok: false, reason: 'main-HEAD kunne ikke hentes' };
  const headSha = head.stdout.trim();
  const json = (args, what) => {
    const res = runGhRaw(args);
    if (res.status !== 0) throw new Error(`${what} fejlede`);
    return JSON.parse(res.stdout || 'null');
  };
  try {
    const ciRuns = json(['run', 'list', '--repo', repo, '--workflow', 'ci.yml', '--branch', 'main', '--limit', '20', '--json', 'headSha,status,conclusion'], 'gh run list ci.yml');
    const deployRuns = json(['run', 'list', '--repo', repo, '--workflow', 'deploy-verify.yml', '--branch', 'main', '--limit', '20', '--json', 'databaseId,headSha'], 'gh run list deploy-verify.yml');
    const match = (deployRuns || []).find((r) => r.headSha === headSha);
    let deploy = null;
    if (match) {
      const run = json(['api', `repos/${repo}/actions/runs/${match.databaseId}`], 'deploy-run');
      const jobs = json(['api', `repos/${repo}/actions/runs/${match.databaseId}/attempts/${run.run_attempt}/jobs?per_page=100`], 'deploy-jobs');
      deploy = { run, jobs };
    }
    return mainVerifiedFromRuns({ headSha, ciRuns: ciRuns || [], deploy });
  } catch (err) {
    return { ok: false, reason: String(err?.message ?? err) };
  }
}

const SCRIPT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * Argumenterne til merge-queue.ps1 for et samlet tog. -ExpectHead har een SHA pr. PR i
 * samme raekkefoelge (Codex P1 #7657), -MaxDeployBatch TRAIN_MAX_DEPLOY (3, ejer 20/11) lader koeen selv haandhaeve
 * deploy-reglen, og -CiTimeoutMinutes er sat eksplicit (#8331).
 */
export function queueArgs({ script, train, repo, expectHeads }) {
  const args = ['-NoProfile', '-NonInteractive', '-File', script, '-Pr', train.join(','), '-Repo', repo,
    '-MaxBatch', String(TRAIN_MAX_BATCH), '-MaxDeployBatch', String(TRAIN_MAX_DEPLOY), '-CiTimeoutMinutes', String(QUEUE_CI_TIMEOUT_MINUTES)];
  if (expectHeads?.length) args.push('-ExpectHead', expectHeads.join(','));
  return args;
}

// Koeen koeres fra samme checkout som dette script (den planlagte opgave peger paa hoved-checkoutet).
function defaultRunQueue({ train, repo, logFile, expectHeads }) {
  const repoRoot = SCRIPT_ROOT;
  const script = join(repoRoot, 'scripts', 'merge-queue.ps1');
  // Codex P1 (#7657): koeen merger kun de hoveder, der blev vurderet og godkendt her.
  const args = queueArgs({ script, train, repo, expectHeads });
  let fd = null;
  try {
    if (logFile) fd = openSync(logFile, 'a');
    const res = spawnSync('pwsh', args, { cwd: repoRoot, windowsHide: true, stdio: ['ignore', fd ?? 'inherit', fd ?? 'inherit'] });
    return res.error ? -1 : res.status ?? -1;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function rotateLog(file) {
  try {
    if (statSync(file).size > LOG_ROTATE_BYTES) renameSync(file, `${file}.1`);
  } catch { /* ingen log endnu */ }
}

export function parseArgs(argv) {
  const out = { dryRun: false, log: false, repo: DEFAULT_REPO };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--log') out.log = true;
    else if (a === '--repo') out.repo = argv[++i] ?? DEFAULT_REPO;
  }
  return out;
}

/**
 * Een koersel. Alle IO-afhaengigheder kan injiceres (tests).
 * Raekkefoelge: tog-markoer -> vurdering -> frisk tjek af hver PR -> koe (eet samlet tog).
 */
export async function run({
  argv = process.argv.slice(2),
  now = new Date(),
  // Sikkerhedslaas og log ligger hos hoved-checkoutet (som tog-markoeren), ogsaa fra et worktree.
  repoRoot = gitCommonRoot(SCRIPT_ROOT) ?? SCRIPT_ROOT,
  readMarker = () => readActiveMarker(markerFilePath({ cwd: SCRIPT_ROOT })),
  evaluate = (opts) => collectEvaluations(opts),
  reevaluate = (n, opts) => reevaluatePr(n, opts),
  runQueue = defaultRunQueue,
  checkMain = defaultCheckMain,
  blockFile = null,
  guard = runMergeGuard,
  requestReviews = requestStaleCodexReviews,
  out =(line) => process.stdout.write(`${line}\n`),
} = {}) {
  const opts = parseArgs(argv);
  const logFile = opts.log && !opts.dryRun ? join(repoRoot, LOG_RELATIVE) : null;
  if (logFile) { mkdirSync(dirname(logFile), { recursive: true }); rotateLog(logFile); }
  const log = (line) => {
    out(line);
    if (logFile) { try { appendFileSync(logFile, `${line}\n`, 'utf8'); } catch { /* fail-soft */ } }
  };
  const ownerLogin = opts.repo.split('/')[0];
  log(`[${now.toISOString()}] merge-auto-tog${opts.dryRun ? ' (DRY-RUN)' : ''}`);

  const activeMarker = readMarker();
  if (activeMarker) {
    log(`  Goer intet: ${decideAction({ activeMarker, train: [] }).reason}.`);
    return { action: 'skip-active', train: [] };
  }
  const blockPath = blockFile ?? join(repoRoot, BLOCK_RELATIVE);
  let block = readBlock(blockPath);
  if (block) {
    const verified = checkMain({ repo: opts.repo });
    if (!verified.ok) {
      log(`  LAAST: #${block.pr} sluttede med exit ${block.exit} (${block.at}); main er ikke verificeret (${verified.reason}). Ingen nye merges.`);
    } else {
      log(`  Laasen fra #${block.pr} haeves: ${verified.reason}.`);
      if (!opts.dryRun) { try { unlinkSync(blockPath); } catch { /* allerede vaek */ } }
      block = null;
    }
  }

  let evaluations;
  try {
    evaluations = evaluate({ repo: opts.repo, ownerLogin, log });
  } catch (err) {
    log(`  Kunne ikke liste PR'er (${err?.message ?? err}); proever igen naeste koersel.`);
    return { action: 'error', train: [] };
  }
  log(`  ${evaluations.length} aabne PR'er vurderet, ${evaluations.filter((x) => x.ready).length} klar.`);
  for (const e of evaluations.filter((x) => x.ready)) log(`  #${e.number} klar: ${e.reason}${e.classification ? ` [${e.classification}]` : ''}`);
  // Merge-vagten (#8331): PR'er med ejer-markoer der staar stille; fail-soft.
  try { guard({ evaluations, repo: opts.repo, repoRoot, now, dryRun: opts.dryRun, log }); } catch (err) { log(`  MERGE-VAGT fejlede (${err?.message ?? err}).`); }
  // Gen-bestilling af Codex-review paa et flyttet hoved (#7654); fail-soft, flytter aldrig en markoer.
  try { requestReviews({ evaluations, repo: opts.repo, now, dryRun: opts.dryRun, log }); } catch (err) { log(`  gen-bestilling af review fejlede (${err?.message ?? err}).`); }
  const train = selectTrain(evaluations);
  const decision = decideAction({ activeMarker: null, train });

  if (block) {
    return { action: 'blocked', train };
  }
  if (!decision.run) {
    log(`  Ingen koe: ${decision.reason}.`);
    return { action: 'none', train };
  }
  if (opts.dryRun) {
    log(`  DRY-RUN: ville koere merge-queue.ps1 -Pr "${train.join(',')}" -Repo ${opts.repo} som eet tog (${decision.reason}).`);
    return { action: 'dry-run', train };
  }
  // ET samlet tog (ejer 17/11, #8331). Frisk vurdering af hver PR lige foer koeen
  // startes: et push efter udvaelgelsen maa ikke arve kategori eller ejer-go, og koeen
  // faar det friske hoved pr. PR (-ExpectHead) og merger aldrig et andet (Codex P1 #7657).
  const byNumber = new Map(evaluations.map((e) => [e.number, e]));
  const confirmed = [];
  for (const n of train) {
    let fresh;
    try {
      fresh = reevaluate(n, { repo: opts.repo, ownerLogin, log });
    } catch (err) {
      log(`  #${n}: frisk vurdering fejlede (${err?.message ?? err}); springes over.`);
      continue;
    }
    const confirm = confirmBeforeQueue(byNumber.get(n), fresh);
    if (!confirm.ok) { log(`  #${n}: ${confirm.reason}; springes over.`); continue; }
    confirmed.push(fresh);
  }
  // Deploy-reglen igen paa de friske vurderinger (en PR kan have aendret filer).
  const finalTrain = selectTrain(confirmed);
  if (!finalTrain.length) {
    log('  Ingen koe: ingen PR\'er bekraeftet ved den friske vurdering.');
    return { action: 'none', train: [] };
  }
  if (readMarker()) {
    log('  En anden merge-koe er startet; toget venter til naeste koersel.');
    return { action: 'skip-active', train: finalTrain };
  }
  const freshBy = new Map(confirmed.map((e) => [e.number, e]));
  const expectHeads = finalTrain.map((n) => freshBy.get(n).headSha);
  log(`  Starter merge-queue.ps1 -Pr "${finalTrain.join(',')}" -Repo ${opts.repo} som eet tog (CI-frist ${QUEUE_CI_TIMEOUT_MINUTES} min).`);
  const code = runQueue({ train: finalTrain, repo: opts.repo, logFile, expectHeads });
  log(`  merge-queue.ps1 (${finalTrain.map((n) => `#${n}`).join(', ')}) sluttede med exit ${code}.`);
  const results = [{ prs: finalTrain, exit: code }];
  if (code === QUEUE_EXIT_BUSY) {
    // Koeen tog ikke markoeren (en anden koe naaede foerst): intet er merget, ingen laas.
    log('  En anden merge-koe ejer markoeren; intet merget. Proever igen naeste koersel.');
  } else if (code !== 0 && code !== QUEUE_EXIT_PARTIAL) {
    // Codex P1 (#7657): roed/uverificeret main eller deploy stopper toget, og laasen
    // holder paa tvaers af koersler, til main er positivt verificeret. Exit 2 (nogle
    // PR'er sprunget over) er verificeret af koeen selv og laaser ikke.
    try { writeState(blockPath, { pr: finalTrain[0], prs: finalTrain, exit: code, at: now.toISOString() }); } catch (err) { log(`  ADVARSEL: laasen kunne ikke gemmes (${err?.message ?? err}).`); }
    log(`  Toget sluttede med exit ${code}; laast til main er verificeret.`);
  }
  return { action: 'queue', train: finalTrain, queued: finalTrain, results };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await run();
  } catch (err) {
    process.stdout.write(`merge-auto-tog ADVARSEL: uventet fejl: ${err?.message ?? err}\n`);
  }
  process.exitCode = 0;
}
