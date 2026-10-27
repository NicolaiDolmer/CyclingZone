#!/usr/bin/env node
// scripts/review-gate.mjs - risikostyret review-gate (#6654, ejer 15/10).
//
// Regel (AGENTS.md hard rule 35 + docs/GITHUB_WORKFLOW.md "Review-gate"):
//   - ALLE PR'er: Codex-review gennemfoert for PR'ens AKTUELLE HEAD og ingen
//     uloeste Codex-fund (en Codex-traad er loest naar den er markeret
//     "Resolve conversation"). Review-bevis fra et aeldre commit taeller ikke.
//   - HOEJRISIKO (motor, database/migrationer/RLS, penge/oekonomi, betaling/
//     abonnement, auth/sikkerhed/webhooks/CORS/rate-limit, cron, backend-routes/API
//     (inkl. *Handlers), workflows og CI-vagt-scripts, review-gaten selv (inkl.
//     .coderabbit.yaml og merge-koeen), review-/CI-konfiguration (CODEOWNERS, hooks, lokale vagter,
//     baselines), scripts der skriver til prod, deploy-konfiguration, nye kontos finans-gates og
//     andre moduler der debiterer/krediterer penge, en AFKORTET PR-filliste (GitHub max 3000 filer;
//     fail-closed), eller label
//     risk:high/security): derudover en
//     Claude-review-markoer for HEAD uden blokerende fund:
//         <!-- claude-review: clean|notes|blocking sha=<HEAD-commit> -->
//     Seneste markoer for HEAD fra en betroet konto (OWNER/MEMBER/COLLABORATOR)
//     gaelder. Efter et push skal der en ny markoer til.
//   - CodeRabbit er bonus, aldrig et krav. Dependabot er undtaget (Codex
//     reviewer ikke Dependabot-PR'er; rule 35 (c) daekker dem med CI).
//
// Alt herunder er rene funktioner; gh-kaldene ligger i main() nederst.
//
//   node scripts/review-gate.mjs evaluate --pr 6654 [--repo owner/name]
//   node scripts/review-gate.mjs post-claude-review --pr 6654 --verdict clean [--note "..."]
//   node scripts/review-gate.mjs refresh [--pr 6654]          # genkoer gaten (CI)
//   node scripts/review-gate.mjs escaped-report [--since 2026-10-01] [--until 2026-11-01]
//
// Tests: node --test scripts/review-gate.test.mjs

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_REPO = "NicolaiDolmer/CyclingZone";
export const WORKFLOW_FILE = "review-gate.yml";
export const CODEX_LOGIN = "chatgpt-codex-connector";
export const CODERABBIT_LOGIN = "coderabbitai";
export const CODEX_SUMMARY_MARKER = "<!-- codex-pull-request-review-summary -->";
export const CLAUDE_MARKER_RE = /<!--\s*claude-review:\s*(clean|notes|blocking)(?:\s+sha=([0-9a-f]{7,40}))?\s*-->/i;
export const TRUSTED_ASSOCIATIONS = Object.freeze(["OWNER", "MEMBER", "COLLABORATOR"]);
export const HIGH_RISK_LABELS = Object.freeze(["risk:high", "security"]);
export const EXEMPT_AUTHORS = Object.freeze(["dependabot"]);
export const ESCAPED_DEFECT_LABEL = "escaped-defect";
export const LOW_RISK_CLAUDE_DETAIL =
  "ikke paakraevet (lav risiko); Codex + groen CI er nok til autonom merge (rule 35 d, ejer 16/10)";

// ── Risiko-klassifikation ──────────────────────────────────────────────────

const TEST_FILE_RE = /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\/|(^|\/)tests?\//;
// Fejlsikker retning: hellere en Claude-review for meget end en motor-/pengefil
// der glider igennem som lav risiko. Noegleordene matcher hele filnavnet (ikke
// stien), uden forskel paa store/smaa bogstaver. HOLD I SYNC med path_filters i
// .coderabbit.yaml - testen i review-gate.test.mjs sammenligner dem fil for fil.
const backendName = (words) => new RegExp(`^backend\\/(.*\\/)?[^/]*(${words})[^/]*$`, "i");
const HIGH_RISK_RULES = Object.freeze([
  { reason: "motor", re: /^backend\/lib\/engine\// },
  { reason: "database", re: /^(database|supabase)\// },
  { reason: "workflow", re: /^\.github\/(workflows|actions)\// },
  // Hemmelighedsscanneren (+ dens ignore-liste, der kan skjule fund) og Infisical-opsaetningen.
  { reason: "sikkerhed", re: /^(\.gitleaks\.toml|\.gitleaksignore|\.infisical\.json|SECURITY\.md)$/ },
  // Deploy-konfiguration: backend-deploy (Railway) og frontend-headers/rewrites (Vercel).
  { reason: "deploy", re: /^(backend\/railway\.json|frontend\/vercel\.json|frontend\/\.env\.production)$/ },
  // Review-gaten selv: klassifikator/gate, CodeRabbit-daekningen og merge-koeens
  // haandhaevelse, inkl. det koeen delegerer til: wave-policy (assert-merge-allowed,
  // guarded-merge), wave-ownership (ejerskabstjek), wave-owner-override (ejer-undtagelse
  // fra ejerskabstjekket), merge-queue-* (klassifikation/filer) og merge-pr-owned
  // (head-pinning + --admin merge). En PR der svaekker dem svaekker reviewet af alle senere PR'er.
  { reason: "review-gate", re: /^(scripts\/review-gate\.mjs|\.coderabbit\.yaml|scripts\/merge-queue[^/]*|scripts\/lib\/league-check\.ps1|scripts\/wave-(policy|ownership|owner-override)\.mjs|scripts\/lib\/merge-pr-owned\.ps1)$/ },
  // Review-/CI-konfiguration uden for workflows: CODEOWNERS (hvem skal reviewe),
  // Dependabot og CodeQL, Claude-hooks (secret-blokering, agent-spawn, settings),
  // wave-orkestratoren og git-hooks. Test-fixtures til hookene er ikke hooks.
  { reason: "ci", re: /^(\.github\/(CODEOWNERS|dependabot\.yml|codeql\/)|\.claude\/(settings\.json|workflows\/|hooks\/(?!test-fixtures\/|sanitize-secrets-tests\/))|scripts\/hooks\/)/ },
  // CI-vagterne workflows koerer (check-required-ci-jobs, lint-*, audit-*, scripts/ci/ ...)
  // og deres baselines: en PR der svaekker en vagt er lige saa farlig som en der
  // aendrer workflow-YAML'en (Codex-fund #6657). Navnefamilien er kontrakten;
  // review-gate.test.mjs tjekker at hver vagt som en workflow koerer er med.
  // verify-/preflight-/guard-* er de lokale vagter (verify-lock, preflight-pr, guard-commit-branch),
  // scripts/lib/ er det de deler (js-source-scan, league-audit-check, gh-retry ...), og
  // baselines er baade .js og .json (en hoejere baseline svaekker ratchet'en).
  { reason: "ci", re: /^scripts\/(ci\/.+|(ci|check|lint|audit|i18n-check|tone-check|verify|preflight|guard)-[^/]+|[^/]+-baseline\.(js|json)|lib\/.+)$/ },
  // Sikkerheds-vaerktoej i scripts/: GitHub-/Supabase-sikkerhed, secrets (Infisical, noegle-rotation og
  // -probes), branch protection, git-hook-installation, test-tokens/-konti, DB-backup/-restore og domaene-opsaetning.
  { reason: "sikkerhed", re: /^scripts\/([^/]*(security|infisical|rotate|branch-protection|hook|get-test-token|setup-test-accounts|set-vercel)[^/]*|db-[^/]*|probe-[^/]*-keys[^/]*)$/ },
  // CORS-allowlisten (corsOrigin) og misbrugsvaernet (rateLimiters, DM-rate-guard).
  { reason: "sikkerhed", re: backendName("cors|rateLimit|rateGuard") },
  // Penge/oekonomi: backend-kode hvis filnavn handler om penge (saldo, overfoersler, kontrakter).
  // "value" = rytter-vaerdi (riderValueRefresh, sundayValueSweep, marketValue*): skriver
  // base_value og loenvaerdi for alle ryttere, ogsaa fra cron.
  // "facilit" = facilitetskoeb/-opgradering og personale-loen (facilityService debiterer
  // via economyEngine og tjekker saldo; Codex-fund #6657).
  // "market" = markedet: marketPause (kill switch + auktions-sluttider), marketUtils,
  // youthMarket, marketValue* (Codex-fund #6657).
  // Moduler hvis navn ikke siger penge, men som debiterer/krediterer eller gater penge (gennemgang
  // af alle backend/lib-moduler der importerer economyEngine/balanceRpc/availableBalance, runde 8):
  // "newAccount" = nye kontos finans-gates (anti-misbrug paa lan, overfoersel og auktion; importeres af
  // alle tre stier), "credit"/"debit" (kreditering/debitering), "squadEnforce" (auto-koeb + noedlaan ved vinduesluk), "scoutAssign" (debiterer
  // rejseomkostning), "comeback" (krediterer forholdsmaessig sponsor), "academyIntake"/"academyGraduat"
  // (saldo-gate og salg), "boardConsequence" (sponsor-pullout + haardblokke paa kob),
  // "seasonTransition"/"seasonStart"/"seasonCarryOver"/"seasonAutoTransition" (loen, renter, sponsor, praemier).
  { reason: "penge", re: backendName("econom|financ|salar|wage|prize|sponsor|loan|payout|price|pricing|payment|wallet|budget|debt|auction|bid|balance|transfer|contract|money|cash|revenue|income|expense|transaction|ledger|valuation|value|facilit|market|credit|debit|newAccount|squadEnforce|scoutAssign|comeback|academyIntake|academyGraduat|boardConsequence|seasonTransition|seasonStart|seasonCarryOver|seasonAutoTransition") },
  // Betaling/abonnement (rigtige penge): checkout, kundeportal, abonnementsstatus,
  // adgang til betalt indhold og betalingsudbyderens webhook.
  { reason: "betaling", re: backendName("billing|checkout|subscription|entitlement|alunta|refund|invoice|founder") },
  // Indgaaende webhooks: signaturtjek og afsender-validering er sikkerhedsflade.
  { reason: "sikkerhed", re: backendName("webhook|botDetection|fairplay|betaAccess|likeEscape") },
  // Motor uden for backend/lib/engine/: simulator, bro/flag, finalisering, etaperesultater.
  { reason: "motor", re: backendName("race|stage|finaliz|simulat|engine") },
  // Database-RPC-wrappere (skriver via Postgres-funktioner).
  { reason: "database", re: backendName("rpc") },
  // Destruktive/nulstillende flows: beta-reset og relaunch (sletter og genopbygger spillerdata),
  // rytter-oprydning med sletning og FK-reset-audit.
  { reason: "database", re: backendName("betaReset|relaunch|cleanupDeletion|resetFk") },
  // Planlagte job: kalder motor, finalisering og udbetalinger uden menneske i loopet.
  { reason: "cron", re: backendName("cron|scheduler") },
  // Auth/sikkerhed: backend + frontend-lib (login, tokens, admin-adgang, RLS/grants).
  // "Author" (forum) er ikke auth, men authorize/authorization er. ownerGate er
  // OWNER_USER_IDS-allowlisten (fail-closed) bag ejer-only admin-endpoints.
  // "unsub" = afmeldings-linket (emailUnsubRoute/-Token/-Url): ingen session-login,
  // det signerede token er eneste adgangskontrol foer en service-role-skrivning.
  { reason: "auth", re: /^(backend|frontend\/src\/lib)\/(.*\/)?[^/]*(auth(?!or)|authori[sz]|token|security|grant|permission|urlSafety|admin|ownerGate|unsub)[^/]*$/i },
  // RLS case-sensitivt og som ord: "rls" kun forrest i navnet eller efter _ . -,
  // ellers "Rls"/"RLS" (camelCase/versaler). "urlState" (rlS) og "denyUrls"
  // (Urls) er URL'er, ikke RLS.
  { reason: "auth", re: /^(backend|frontend\/src\/lib)\/(.*\/)?([^/]*[_.-])?rls[^/]*$|^(backend|frontend\/src\/lib)\/(.*\/)?[^/]*(Rls|RLS)[^/]*$/ },
  // Frontendens kanoniske Supabase-klient: login/signup/logout, session og
  // Authorization-headeren som alle API-kald bruger (Codex-fund #6657).
  { reason: "auth", re: /^frontend\/src\/lib\/supabase\.[^/]+$/ },
  // Login-/nulstil-adgangskode-siderne og admin-auth-hooken (useAdminAuth) uden for frontend/src/lib.
  { reason: "auth", re: /^frontend\/src\/(pages\/(Login|ResetPassword)[^/]*|(.*\/)?use[A-Za-z]*Auth[^/]*)$/ },
  // API-fladen (efter auth, saa admin-routes melder "auth"): hver route haandhaever
  // selv auth/ejerskab, og server.js monterer dem. *Handlers i backend/ er route-
  // logikken bag tynde wrappers i routes/api.js (service-role, ejerskabsfiltre;
  // Codex-fund #6657).
  { reason: "api", re: /^backend\/(routes|api)\/|^backend\/server\.[cm]?[jt]s$/ },
  { reason: "api", re: backendName("handlers") },
  // Catch-all til sidst, saa mere specifikke aarsager (penge, auth, motor ...) vinder paa navnet.
  // Scripts der skriver til prod eller er destruktive: backend/scripts (reparationer, saesonafslutning,
  // kreditering), scripts/ops, oneoff, migrations-manual og staging (Staging-Guard holder prod ude),
  // samt rod-scripts hvis navn siger slet/reparer/refunder/send/import. Koeres med service-role.
  { reason: "prod-script", re: /^(backend\/(scripts|lib\/dev)\/|scripts\/(ops|oneoff|migrations-manual|staging)\/)/ },
  { reason: "prod-script", re: /^scripts\/[^/]*(delete|repair|wipe|purge|-send|trainingRecovery|run-value-event|sync-dyn)[^/]*$|^scripts\/(sweep-|import_)[^/]*$/ },
]);

const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/^\.\//, "");
const login = (l) => String(l || "").replace(/\[bot\]$/i, "").toLowerCase();

/** Peger en (evt. forkortet, >= 7 tegn) commit-SHA paa HEAD? Ukendt HEAD matcher intet. */
export function shaMatchesHead(sha, headSha) {
  const a = String(sha || "").toLowerCase();
  const h = String(headSha || "").toLowerCase();
  return a.length >= 7 && h.length >= 7 && (h.startsWith(a) || a.startsWith(h));
}
const short = (sha) => String(sha || "?").slice(0, 7);

/** Testfil (aendrer ingen prod-adfaerd)? Filer under .github/ er aldrig "bare tests". */
export function isTestFile(path) {
  const p = norm(path);
  return TEST_FILE_RE.test(p) && !p.startsWith(".github/");
}

/** @returns {string|null} hoejrisiko-grunden for en fil, ellers null. Tests er aldrig hoejrisiko. */
export function classifyFile(path) {
  const p = norm(path);
  // Workflows er altid hoejrisiko; tests ellers aldrig (de aendrer ingen prod-adfaerd).
  if (isTestFile(p)) return null;
  for (const rule of HIGH_RISK_RULES) if (rule.re.test(p)) return rule.reason;
  return null;
}

/** GitHubs PR-fil-endpoint returnerer hoejst 3000 filer, uanset paginering. */
export const PR_FILES_API_CAP = 3000;

/**
 * Er fillisten afkortet? changedFiles er PR'ens egen taeller (meta.changed_files). Mangler den, er en
 * liste paa API-loftet ogsaa mistaenkelig. Afkortet liste = en motor-/penge-/auth-fil kan ligge uden
 * for den, saa risikoen kan ikke afgoeres fra listen (Codex-fund #6657, runde 8).
 */
export function filesTruncated(files = [], changedFiles = null) {
  if (Number.isInteger(changedFiles)) return files.length < changedFiles;
  return files.length >= PR_FILES_API_CAP;
}

/** @returns {{level: "high"|"low", reasons: string[]}} fail-closed: afkortet filliste = hoejrisiko. */
export function classifyRisk(files = [], labels = [], { changedFiles = null } = {}) {
  const reasons = [];
  if (filesTruncated(files, changedFiles)) {
    const total = Number.isInteger(changedFiles) ? changedFiles : `mindst ${PR_FILES_API_CAP}`;
    reasons.push(`filliste afkortet: GitHub gav ${files.length} af ${total} filer, risiko kan ikke afgoeres (fail-closed)`);
  }
  for (const label of labels) {
    if (HIGH_RISK_LABELS.includes(String(label).toLowerCase())) reasons.push(`label ${label}`);
  }
  for (const file of files) {
    const why = classifyFile(file);
    if (why) reasons.push(`${why}: ${norm(file)}`);
  }
  return { level: reasons.length > 0 ? "high" : "low", reasons };
}

// ── Codex ──────────────────────────────────────────────────────────────────

/**
 * Laeser Codex' "Review Summary"-kommentar (tabel: Review | Status | Commit | trigger).
 * @returns {{state: "completed"|"pending"|"failed"|"unknown", commit: string|null}}
 */
export function parseCodexSummary(body) {
  const text = String(body || "");
  if (!text.includes(CODEX_SUMMARY_MARKER)) return { state: "unknown", commit: null };
  const rows = text.split(/\r?\n/)
    .filter((l) => l.trim().startsWith("|"))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells.length >= 3 && !/^-+$/.test(cells[0]) && !/^review$/i.test(cells[0]));
  // Kun Code Review-raekken taeller (#6657 Codex-fund): en anden raekke (fx
  // Security Review) der er gennemfoert maa aldrig goere et fejlet code review
  // groent. En enkelt raekke uden "security" godtages som code review; ellers
  // skal raekken hedde "Code Review" - ingen match = ukendt (fail-closed).
  const isCodeReviewRow = (cells) => /code\s*review/i.test(cells[0]) && !/security/i.test(cells[0]);
  const codeRows = rows.filter(isCodeReviewRow);
  const row = codeRows.length > 0 ? codeRows[codeRows.length - 1]
    : rows.length === 1 && !/security/i.test(rows[0][0]) ? rows[0] : null;
  // Maskinlaesbar tilstand (<!-- codex-review-state:v1 {...} -->) gaelder code_review
  // alene og baerer den fulde SHA; den vinder over tabellen naar den findes.
  const machine = parseCodexReviewState(text);
  if (machine) {
    const state = codexStatusToState(machine.status ?? (row ? row[1] : null));
    return { state, commit: machine.commit };
  }
  if (!row) return { state: "unknown", commit: null };
  const commit = (row[2] || "").match(/[0-9a-f]{7,40}/i)?.[0] || null;
  return { state: codexStatusToState(row[1]), commit };
}

/** Codex-status (tabelcelle eller code_review.status) -> pending|completed|failed. Ukendt = failed. */
export function codexStatusToState(status) {
  const s = String(status ?? "");
  if (/in[\s_-]*progress|running|queued|pending|started|reviewing/i.test(s)) return "pending";
  if (/completed|done|finished/i.test(s)) return "completed";
  return "failed";
}

/** code_review fra Codex' "codex-review-state:v1"-JSON, ellers null. */
export function parseCodexReviewState(body) {
  const m = String(body || "").match(/<!--\s*codex-review-state:v1\s+(\{.*?\})\s*-->/s);
  if (!m) return null;
  try {
    const cr = JSON.parse(m[1])?.code_review;
    const sha = typeof cr?.commit_sha === "string" && /^[0-9a-f]{7,40}$/i.test(cr.commit_sha) ? cr.commit_sha.toLowerCase() : null;
    return sha ? { commit: sha, status: cr.status ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * Codex' alvorsgrad paa et fund ("![P1 Badge](...)" i traadens foerste kommentar).
 * Ejer-beslutning 20/10: kun P0/P1 blokerer merge; P2/P3 samles i et opfoelgnings-issue.
 * Ukendt grad (ingen badge) taeller som blokerende, saa intet fund slipper igennem stille.
 * @returns {"P0"|"P1"|"P2"|"P3"|null}
 */
export function codexSeverity(body) {
  return String(body || "").match(/!\[(P[0-3]) Badge\]/)?.[1] || null;
}

/** CodeRabbit's bot-authored severity header, metadata only; Codex policy is unchanged. */
export function codeRabbitSeverity(body) {
  const header = String(body || '').split(/\r?\n/).find(line => line.startsWith('**') && line.includes('** ·'));
  const severity = header?.replace(/<[^>]*>/g, '').match(/\b(Critical|Major|Minor|Trivial)\*\*/i)?.[1]?.toLowerCase();
  return ({critical:'P0',major:'P1',minor:'P2',trivial:'P3'})[severity] ?? null;
}
/** Blokerer et uloest Codex-fund merge? Kun P0, P1 og ukendt grad. */
export function isBlockingSeverity(severity) {
  return severity == null || severity === "P0" || severity === "P1";
}

/** Codex' rene kvittering (ingen fund) paa et review. */
export const CODEX_CLEAN_RE = /didn['’]t find any major issues/i;

/** "**Reviewed commit:** `fda8692284`" i en Codex-review-krop. */
export function parseCodexReviewedCommit(body) {
  return String(body || "").match(/reviewed commit:\**\s*`?([0-9a-f]{7,40})/i)?.[1]?.toLowerCase() || null;
}

/**
 * Codex-bevis taeller kun for PR'ens aktuelle HEAD (headSha): summary-kommentarens
 * commit eller review.commit / "Reviewed commit". En 👍-reaktion taeller IKKE:
 * den baerer ingen SHA, og et tidspunkt kan ikke bindes sikkert til HEAD
 * (committer-datoen er forfatter-styret). Codex' summary-kommentar opdateres
 * ogsaa ved et rent review og baerer HEAD-commit'et.
 * @param {{comments?: object[], reviews?: object[], threads?: object[], headSha?: string}} input
 *   comments: {author, body}; reviews: {author, body, commit}; threads: {author, isResolved}
 * @returns {{ok: boolean, state: string, unresolved: number, detail: string}}
 */
export function evaluateCodex({ comments = [], reviews = [], threads = [], headSha = null, independentlyVerifiedHead = false } = {}) {
  const isCodex = (x) => login(x.author) === CODEX_LOGIN;
  // Ejer 27/10: en uloest Codex-traad fra et AELDRE commit er forældet, naar Codex selv har
  // kvitteret rent ("Didn't find any major issues") paa HEAD OG en uafhaengig Claude-markoer
  // (clean/notes) gaelder HEAD. Saa skal ejeren aldrig klikke "Resolve" paa rettede fund.
  const codexCleanOnHead = [...comments, ...reviews].some((c) => isCodex(c) && CODEX_CLEAN_RE.test(String(c.body || ""))
    && shaMatchesHead(c.commit || parseCodexReviewedCommit(c.body), headSha));
  const superseded = (t) => independentlyVerifiedHead && codexCleanOnHead && Boolean(t.commit) && !shaMatchesHead(t.commit, headSha);
  const open = threads.filter((t) => isCodex(t) && !t.isResolved && !superseded(t));
  const unresolved = open.filter((t) => isBlockingSeverity(t.severity ?? codexSeverity(t.body))).length;
  const followUps = open.length - unresolved;
  const followUpNote = followUps > 0 ? ` (${followUps} P2/P3-fund blokerer ikke: saml dem i et opfoelgnings-issue)` : "";
  const summaries = comments.filter(isCodex).map((c) => parseCodexSummary(c.body)).filter((s) => s.state !== "unknown");
  const summary = summaries.find((s) => shaMatchesHead(s.commit, headSha));
  const staleCommit = summaries.find((s) => !shaMatchesHead(s.commit, headSha))?.commit || null;
  let state = summary ? summary.state : "missing";
  if (state !== "pending" && state !== "completed") {
    const reviewedHead = reviews.some((r) => isCodex(r) && shaMatchesHead(r.commit || parseCodexReviewedCommit(r.body), headSha));
    if (reviewedHead) state = "completed";
    else if (state === "missing" && (summaries.length > 0 || reviews.some(isCodex))) state = "stale";
  }
  if (unresolved > 0) {
    return { ok: false, state, unresolved, detail: `${unresolved} uloest(e) P0/P1-fund fra Codex: ret dem og marker traaden "Resolve conversation"${followUpNote}` };
  }
  if (state === "completed") {
    return { ok: true, state, unresolved, detail: `Codex-review gennemfoert for HEAD ${short(headSha)}, ingen uloeste P0/P1-fund${followUpNote}` };
  }
  if (state === "pending") return { ok: false, state, unresolved, detail: "Codex-review koerer stadig" };
  if (state === "stale") {
    return { ok: false, state, unresolved, detail: `Codex-review gaelder et aeldre commit${staleCommit ? ` (${short(staleCommit)})` : ""}, ikke HEAD ${short(headSha)}: kommenter \`@codex review\`` };
  }
  if (state === "failed") return { ok: false, state, unresolved, detail: "Codex-review fejlede: kommenter `@codex review` paa PR'en" };
  return { ok: false, state, unresolved, detail: "intet Codex-review endnu: marker PR'en ready, eller kommenter `@codex review`" };
}

// ── Claude ─────────────────────────────────────────────────────────────────

/**
 * Seneste Claude-review-markoer fra en betroet konto.
 * @param {Array<{author?: string, association?: string, body?: string, at?: string}>} items
 * @returns {{verdict: "clean"|"notes"|"blocking", sha: string|null, at: string|null}|null}
 */
export function findClaudeVerdict(items = []) {
  let best = null;
  for (const item of items) {
    if (!TRUSTED_ASSOCIATIONS.includes(String(item.association || "").toUpperCase())) continue;
    const m = String(item.body || "").match(CLAUDE_MARKER_RE);
    if (!m) continue;
    const at = item.at || null;
    if (!best || String(at || "") >= String(best.at || "")) {
      best = { verdict: m[1].toLowerCase(), sha: m[2] ? m[2].toLowerCase() : null, at };
    }
  }
  return best;
}

export function evaluateClaude(items, risk, headSha = null) {
  // Gaten er CI-gulvet (ejer 15/10: lav risiko = Codex). Ejer 16/10: rule 35 (d) er rettet,
  // saa lav risiko merges autonomt paa Codex + groen CI; opus-review kun paa hoejrisiko.
  if (risk.level !== "high") return { required: false, ok: true, verdict: null, detail: LOW_RISK_CLAUDE_DETAIL };
  const hint = "`node scripts/review-gate.mjs post-claude-review --pr N --verdict clean`";
  // Kun markoerer for HEAD taeller; en markoer uden sha= eller for et aeldre commit er foraeldet efter et push.
  const found = findClaudeVerdict(items.filter((i) => {
    const m = String(i.body || "").match(CLAUDE_MARKER_RE);
    return Boolean(m) && shaMatchesHead(m[2], headSha);
  }));
  if (!found) {
    const any = findClaudeVerdict(items);
    if (any) {
      return { required: true, ok: false, verdict: null, detail: `hoejrisiko: Claude-review-markoeren gaelder ${any.sha ? `commit ${short(any.sha)}` : "intet commit (sha= mangler)"}, ikke HEAD ${short(headSha)}: review det nye commit og skriv ny markoer (${hint})` };
    }
    return { required: true, ok: false, verdict: null, detail: `hoejrisiko: mangler Claude-review-markoer for HEAD ${short(headSha)} (${hint})` };
  }
  if (found.verdict === "blocking") return { required: true, ok: false, verdict: found.verdict, detail: "Claude-review har blokerende fund" };
  return { required: true, ok: true, verdict: found.verdict, detail: `Claude-review: ${found.verdict}${found.sha ? ` (commit ${found.sha.slice(0, 7)})` : ""}` };
}

/** Selve gaten. Input er normaliseret PR-data (se fetchPrData); bevis bindes til headSha. */
export function evaluateGate({ author, draft = false, files = [], changedFiles = null, labels = [], comments = [], reviews = [], threads = [], headSha = null }) {
  const risk = classifyRisk(files, labels, { changedFiles });
  if (EXEMPT_AUTHORS.includes(login(author))) {
    return { ok: true, risk, exempt: true, codex: null, claude: null, summary: `undtaget: ${author} (rule 35 c - CI + dependency-review er gaten)` };
  }
  if (draft) {
    return { ok: false, risk, exempt: false, codex: null, claude: null, summary: "draft: gaten evalueres naar PR'en er ready" };
  }
  const claude = evaluateClaude([...comments, ...reviews], risk, headSha);
  const claudeMarkerOnHead = findClaudeVerdict([...comments, ...reviews].filter((i) => {
    const m = String(i.body || "").match(CLAUDE_MARKER_RE);
    return Boolean(m) && shaMatchesHead(m[2], headSha);
  }));
  const independentlyVerifiedHead = claudeMarkerOnHead?.verdict === "clean" || claudeMarkerOnHead?.verdict === "notes";
  const codex = evaluateCodex({ comments, reviews, threads, headSha, independentlyVerifiedHead });
  const ok = codex.ok && claude.ok;
  const summary = `${ok ? "OK" : "BLOKERET"} (${risk.level === "high" ? "hoejrisiko" : "lav risiko"}): Codex - ${codex.detail}; Claude - ${claude.detail}`;
  return { ok, risk, exempt: false, codex, claude, summary };
}

export function formatReport(result, pr) {
  const lines = [
    `## review-gate: ${result.ok ? "groen" : "roed"} (PR #${pr})`,
    "",
    `- Risiko: **${result.risk.level === "high" ? "hoej" : "lav"}**`,
    ...result.risk.reasons.slice(0, 15).map((r) => `  - ${r}`),
    ...(result.risk.reasons.length > 15 ? [`  - ... og ${result.risk.reasons.length - 15} flere`] : []),
  ];
  if (result.exempt || !result.codex) {
    lines.push(`- ${result.summary}`);
  } else {
    lines.push(`- Codex (alle PR'er): ${result.codex.ok ? "ok" : "mangler"} - ${result.codex.detail}`);
    lines.push(`- Claude (kun hoejrisiko): ${result.claude.ok ? "ok" : "mangler"} - ${result.claude.detail}`);
    lines.push("- CodeRabbit: valgfri bonus, aldrig et krav.");
  }
  return lines.join("\n");
}

export function buildClaudeMarkerComment(verdict, sha, note = "") {
  const v = String(verdict || "").toLowerCase();
  if (!["clean", "notes", "blocking"].includes(v)) throw new Error(`ukendt verdict "${verdict}" (clean|notes|blocking)`);
  const shaPart = sha && /^[0-9a-f]{7,40}$/i.test(sha) ? ` sha=${sha.toLowerCase()}` : "";
  const human = { clean: "ingen fund", notes: "bemaerkninger, intet blokerende", blocking: "BLOKERENDE fund" }[v];
  return [`<!-- claude-review: ${v}${shaPart} -->`, `**Claude-review:** ${human}${sha ? ` (commit \`${sha.slice(0, 7)}\`)` : ""}.`, note ? `\n${note}` : ""]
    .join("\n").trim();
}

// ── Escaped defects (maanedlig opfoelgning) ─────────────────────────────────

/** PR-numre fra "Indfoert af: #123" / "Introduced by #123" i issue-tekst. */
export function parseIntroducedBy(text) {
  const out = new Set();
  const re = /(?:indf(?:oe|ø)rt\s+af|introduced\s+by)\s*:?([^\n]*)/gi;
  for (const m of String(text || "").matchAll(re)) {
    for (const n of m[1].matchAll(/#(\d+)/g)) out.add(Number(n[1]));
  }
  return [...out].sort((a, b) => a - b);
}

/** Hvilke reviewere saa PR'en, og hvor mange fund (traade) postede de. */
export function reviewersOnPr(pr) {
  const seen = { codex: 0, claude: 0, coderabbit: 0 };
  const touched = new Set();
  for (const t of pr.threads || []) {
    const l = login(t.author);
    if (l === CODEX_LOGIN) { seen.codex += 1; touched.add("codex"); }
    if (l === CODERABBIT_LOGIN) { seen.coderabbit += 1; touched.add("coderabbit"); }
  }
  for (const c of [...(pr.comments || []), ...(pr.reviews || [])]) {
    const l = login(c.author);
    if (l === CODEX_LOGIN) touched.add("codex");
    if (l === CODERABBIT_LOGIN) touched.add("coderabbit");
    const m = String(c.body || "").match(CLAUDE_MARKER_RE);
    if (m && TRUSTED_ASSOCIATIONS.includes(String(c.association || "").toUpperCase())) {
      touched.add("claude");
      if (m[1].toLowerCase() !== "clean") seen.claude += 1;
    }
  }
  return { touched: [...touched].sort(), findings: seen };
}

/**
 * @param {{prs: object[], escaped: Array<{issue: number, prs: number[]}>, introducing: object[]}} input
 * @returns {Record<string, {reviewedPrs: number, findings: number, missed: number, missedIssues: number[]}>}
 */
export function tallyReviewerStats({ prs = [], escaped = [], introducing = [] }) {
  const stats = {};
  for (const name of ["codex", "claude", "coderabbit"]) stats[name] = { reviewedPrs: 0, findings: 0, missed: 0, missedIssues: [] };
  for (const pr of prs) {
    const r = reviewersOnPr(pr);
    for (const name of r.touched) stats[name].reviewedPrs += 1;
    for (const [name, n] of Object.entries(r.findings)) stats[name].findings += n;
  }
  const byNumber = new Map([...introducing, ...prs].map((p) => [p.number, p]));
  for (const defect of escaped) {
    for (const prNumber of defect.prs) {
      const pr = byNumber.get(prNumber);
      if (!pr) continue;
      for (const name of reviewersOnPr(pr).touched) {
        stats[name].missed += 1;
        if (!stats[name].missedIssues.includes(defect.issue)) stats[name].missedIssues.push(defect.issue);
      }
    }
  }
  return stats;
}

export function formatEscapedReport({ since, until, stats, escaped, mergedCount }) {
  const lines = [
    `## Review-gate: escaped defects ${since} -> ${until}`,
    "",
    `Mergede PR'er i perioden: ${mergedCount}. Issues med label \`${ESCAPED_DEFECT_LABEL}\`: ${escaped.length}` +
      ` (heraf uden "Indfoert af #PR": ${escaped.filter((e) => e.prs.length === 0).length}).`,
    "",
    "| Reviewer | PR'er reviewet | Fund postet | Slap igennem (fejl paa PR den reviewede) |",
    "| --- | ---: | ---: | --- |",
  ];
  for (const [name, s] of Object.entries(stats)) {
    const issues = s.missedIssues.length ? ` (${s.missedIssues.map((n) => `#${n}`).join(", ")})` : "";
    lines.push(`| ${name} | ${s.reviewedPrs} | ${s.findings} | ${s.missed}${issues} |`);
  }
  return lines.join("\n");
}

// ── gh-lim (kun I/O) ───────────────────────────────────────────────────────

function gh(args, { input } = {}) {
  return execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}
function ghLines(path) {
  const out = gh(["api", "--paginate", path, "--jq", ".[] | tojson"]).trim();
  return out ? out.split(/\r?\n/).map((l) => JSON.parse(l)) : [];
}
function ghJson(args) {
  return JSON.parse(gh(args));
}

function fetchThreads(repo, pr) {
  const [owner, name] = repo.split("/");
  const threads = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const q = `query($o:String!,$n:String!,$pr:Int!,$c:String){repository(owner:$o,name:$n){pullRequest(number:$pr){reviewThreads(first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{isResolved comments(first:1){nodes{author{login} body originalCommit{oid}}}}}}}}`;
    const args = ["api", "graphql", "-f", `query=${q}`, "-f", `o=${owner}`, "-f", `n=${name}`, "-F", `pr=${pr}`];
    if (cursor) args.push("-f", `c=${cursor}`);
    const conn = ghJson(args).data.repository.pullRequest.reviewThreads;
    for (const t of conn.nodes) threads.push({ isResolved: t.isResolved, author: t.comments.nodes[0]?.author?.login || "", severity: codexSeverity(t.comments.nodes[0]?.body), rabbitSeverity: login(t.comments.nodes[0]?.author?.login) === CODERABBIT_LOGIN ? codeRabbitSeverity(t.comments.nodes[0]?.body) : null, commit: t.comments.nodes[0]?.originalCommit?.oid?.toLowerCase() || null });
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return threads;
}

export function fetchPrData(repo, pr) {
  const meta = ghJson(["api", `repos/${repo}/pulls/${pr}`]);
  const files = ghLines(`repos/${repo}/pulls/${pr}/files?per_page=100`).map((f) => f.filename);
  const comments = ghLines(`repos/${repo}/issues/${pr}/comments?per_page=100`)
    .map((c) => ({ author: c.user?.login, association: c.author_association, body: c.body, at: c.updated_at || c.created_at }));
  const reviews = ghLines(`repos/${repo}/pulls/${pr}/reviews?per_page=100`)
    .map((r) => ({ author: r.user?.login, association: r.author_association, body: r.body, at: r.submitted_at, commit: r.commit_id }));
  return {
    number: pr,
    author: meta.user?.login,
    draft: Boolean(meta.draft),
    headSha: meta.head?.sha,
    labels: (meta.labels || []).map((l) => l.name),
    files, changedFiles: Number.isInteger(meta.changed_files) ? meta.changed_files : null, comments, reviews,
    threads: fetchThreads(repo, pr),
  };
}

/**
 * Skal den seneste gate-koersel genkoeres? Kun naar dens udfald ikke laengere
 * matcher en frisk evaluering (spar runner-tid og stoej i Actions-listen).
 */
export function shouldRerun(run, freshOk) {
  if (!run) return { rerun: false, why: "ingen gate-koersel for PR'en endnu (naeste push, label eller ready-skift opretter den)" };
  if (run.status !== "completed") return { rerun: false, why: `koersel ${run.id} koerer allerede` };
  if (run.conclusion === "skipped") return { rerun: false, why: "seneste koersel var draft (skipped)" };
  const wasOk = run.conclusion === "success";
  if (wasOk === freshOk) return { rerun: false, why: `uaendret (${freshOk ? "groen" : "roed"})` };
  return { rerun: true, why: freshOk ? "nu groen" : "nu roed" };
}

/** Event gate-check'et produceres af. Kun koersler herfra taeller (merge-koeen filtrerer ogsaa paa det). */
export const GATE_EVENT = "pull_request_target";

/**
 * Koerslens navn (run-name i review-gate.yml, sat af main-YAML'en): bindes til PR-NUMMERET.
 * pull_request_target-koersler har tom pull_requests-liste, run.head_sha = base-branchens
 * seneste commit (IKKE PR'ens HEAD) og run.head_branch = base-branchen, saa hverken SHA
 * eller branch kan identificere PR'en (Codex-fund #6657, runde 8). Navnet kan en PR ikke
 * forfalske: event=pull_request_target-koersler bruger altid mains workflow-fil.
 */
export const GATE_RUN_NAME_RE = /^review-gate PR#(\d+)(?:\s|$)/;
export const gateRunName = (pr, action = "") => `review-gate PR#${Number(pr)}${action ? ` ${action}` : ""}`;

/**
 * Find PR'ens seneste koersel af gaten, uafhaengigt af PR'ens head-SHA. En koersel hoerer til
 * PR'en hvis (a) dens pull_requests-liste indeholder PR'en, eller (b) listen er tom og
 * koerselsnavnet siger "review-gate PR#<nr>". En koersel der er associeret med en ANDEN PR
 * eller navngivet efter en anden PR bruges aldrig; kun GATE_EVENT-koersler taeller. Nyeste vinder.
 */
export function pickGateRun(runs = [], pr) {
  const n = Number(pr);
  const belongs = (r) => {
    if (r.event && r.event !== GATE_EVENT) return false;
    const assoc = r.pull_requests || [];
    if (assoc.length > 0) return assoc.some((p) => Number(p.number) === n);
    const named = GATE_RUN_NAME_RE.exec(String(r.display_title || r.name || ""));
    return Boolean(named) && Number(named[1]) === n;
  };
  const rank = (r) => `${String(r.created_at)}|${String(r.id ?? "").padStart(20, "0")}`;
  return runs.filter(belongs).sort((a, b) => rank(b).localeCompare(rank(a)))[0] || null;
}

/**
 * API-sti til gatens koersler (side for side, nyeste foerst). pull_request_target koerer i
 * base-branchens kontekst: der filtreres aldrig paa head.ref eller head_sha (begge er
 * base-branchens); PR'en findes bagefter via pickGateRun.
 */
export function gateRunsPath(repo, page = 1) {
  const p = Number.isInteger(page) && page > 0 ? page : 1;
  return `repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=${GATE_EVENT}&per_page=100&page=${p}`;
}

/** Genkoer seneste pull_request_target-koersel af gaten for PR'en (check'et opdateres paa stedet). */
function rerunGate(repo, pr) {
  const meta = ghJson(["api", `repos/${repo}/pulls/${pr}`]);
  if (meta.state !== "open" || meta.draft) return `#${pr}: springes over (${meta.state}${meta.draft ? ", draft" : ""})`;
  // Nyeste target-koersler foerst, side for side, til PR'ens koersel er fundet (identificeres
  // via koerselsnavnet, aldrig via SHA: target-koerslens head_sha er base-branchens).
  let run = null;
  for (let page = 1; page <= 5 && !run; page += 1) {
    const runs = ghJson(["api", gateRunsPath(repo, page)]).workflow_runs || [];
    run = pickGateRun(runs, pr);
    if (runs.length < 100) break;
  }
  const fresh = evaluateGate(fetchPrData(repo, pr));
  const decision = shouldRerun(run, fresh.ok);
  if (!decision.rerun) return `#${pr}: ${decision.why}`;
  try {
    gh(["api", "-X", "POST", `repos/${repo}/actions/runs/${run.id}/rerun`]);
    return `#${pr}: genkoert ${run.id} (${decision.why})`;
  } catch (err) {
    return `#${pr}: genkoersel fejlede (${String(err.stderr || err.message).trim().split("\n")[0]})`;
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i += 1; }
    } else out._.push(a);
  }
  return out;
}

function writeSummary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

// Een GraphQL-soegning pr. 25 PR'er (REST pr. PR ville sprenge GITHUB_TOKEN's timekvote).
const PR_REVIEW_FIELDS = "number comments(last:100){nodes{author{login} authorAssociation body}} " +
  "reviews(last:100){nodes{author{login} authorAssociation body}} " +
  "reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{author{login}}}}}";

function toReviewShape(node) {
  const items = (conn) => (conn?.nodes || []).map((c) => ({ author: c.author?.login || "", association: c.authorAssociation, body: c.body }));
  return {
    number: node.number,
    comments: items(node.comments),
    reviews: items(node.reviews),
    threads: (node.reviewThreads?.nodes || []).map((t) => ({ isResolved: t.isResolved, author: t.comments.nodes[0]?.author?.login || "" })),
  };
}

function searchPrsForReport(searchQuery) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 40; page += 1) {
    const q = `query($q:String!,$c:String){search(query:$q,type:ISSUE,first:25,after:$c){pageInfo{hasNextPage endCursor} nodes{... on PullRequest{${PR_REVIEW_FIELDS}}}}}`;
    const args = ["api", "graphql", "-f", `query=${q}`, "-f", `q=${searchQuery}`];
    if (cursor) args.push("-f", `c=${cursor}`);
    const conn = ghJson(args).data.search;
    for (const node of conn.nodes) if (node && node.number) out.push(toReviewShape(node));
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

function escapedReport(repo, since, until) {
  const escapedIssues = ghJson(["issue", "list", "--repo", repo, "--label", ESCAPED_DEFECT_LABEL, "--state", "all", "--limit", "200",
    "--search", `created:${since}..${until}`, "--json", "number,body,comments"]);
  const escaped = escapedIssues.map((i) => ({
    issue: i.number,
    prs: parseIntroducedBy([i.body, ...(i.comments || []).map((c) => c.body)].join("\n")),
  }));
  const prs = searchPrsForReport(`repo:${repo} is:pr is:merged merged:${since}..${until}`);
  const have = new Set(prs.map((p) => p.number));
  const missing = [...new Set(escaped.flatMap((e) => e.prs))].filter((n) => !have.has(n));
  const introducing = [];
  const [owner, name] = repo.split("/");
  for (let i = 0; i < missing.length; i += 10) {
    const chunk = missing.slice(i, i + 10);
    const fields = chunk.map((n) => `p${n}:pullRequest(number:${Number(n)}){${PR_REVIEW_FIELDS}}`).join(" ");
    const q = `query($o:String!,$n:String!){repository(owner:$o,name:$n){${fields}}}`;
    let repoData = {};
    try {
      repoData = ghJson(["api", "graphql", "-f", `query=${q}`, "-f", `o=${owner}`, "-f", `n=${name}`]).data.repository || {};
    } catch (err) {
      console.error(`escaped-report: kunne ikke hente ${chunk.map((n) => `#${n}`).join(" ")} (${String(err.message).split("\n")[0]})`);
    }
    for (const node of Object.values(repoData)) if (node && node.number) introducing.push(toReviewShape(node));
  }
  const stats = tallyReviewerStats({ prs, escaped, introducing });
  return formatEscapedReport({ since, until, stats, escaped, mergedCount: prs.length });
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  const repo = typeof args.repo === "string" ? args.repo : process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const pr = Number(args.pr);

  if (cmd === "evaluate") {
    if (!Number.isInteger(pr) || pr <= 0) { console.error("--pr <N> kraeves"); return 2; }
    const data = fetchPrData(repo, pr);
    const result = evaluateGate(data);
    const report = formatReport(result, pr);
    console.log(report);
    writeSummary(report);
    if (args.json) console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  }

  if (cmd === "post-claude-review") {
    if (!Number.isInteger(pr) || pr <= 0) { console.error("--pr <N> kraeves"); return 2; }
    const head = ghJson(["api", `repos/${repo}/pulls/${pr}`]).head.sha;
    const body = buildClaudeMarkerComment(args.verdict, head, typeof args.note === "string" ? args.note : "");
    gh(["pr", "comment", String(pr), "--repo", repo, "--body-file", "-"], { input: body });
    console.log(`Claude-review-markoer (${args.verdict}) skrevet paa #${pr}. Gaten genkoeres af workflowet.`);
    return 0;
  }

  if (cmd === "refresh") {
    const prs = Number.isInteger(pr) && pr > 0
      ? [pr]
      : ghJson(["pr", "list", "--repo", repo, "--state", "open", "--limit", "100", "--json", "number,isDraft"])
        .filter((p) => !p.isDraft).map((p) => p.number);
    for (const n of prs) console.log(rerunGate(repo, n));
    return 0;
  }

  if (cmd === "escaped-report") {
    const now = new Date();
    // Default: hele forrige maaned (koeres den 1.: fra den 1. i forrige maaned til i gaar).
    const until = typeof args.until === "string" ? args.until : isoDate(new Date(now.getTime() - 24 * 3600 * 1000));
    const since = typeof args.since === "string" ? args.since : isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
    const report = escapedReport(repo, since, until);
    console.log(report);
    writeSummary(report);
    return 0;
  }

  console.error("Brug: review-gate.mjs evaluate|post-claude-review|refresh|escaped-report [--pr N] (se filens header)");
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`review-gate: ${err.stderr || err.message}`);
    process.exitCode = 1;
  }
}
