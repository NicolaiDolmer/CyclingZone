// node --test scripts/review-gate.test.mjs  (#6654)
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  classifyFile,
  isTestFile,
  classifyRisk,
  parseCodexSummary,
  evaluateCodex,
  findClaudeVerdict,
  evaluateClaude,
  evaluateGate,
  formatReport,
  buildClaudeMarkerComment,
  parseIntroducedBy,
  reviewersOnPr,
  tallyReviewerStats,
  formatEscapedReport,
  shouldRerun,
  shaMatchesHead,
  parseCodexReviewedCommit,
  parseCodexReviewState,
  codexStatusToState,
  pickGateRun,
  gateRunsPath,
  gateRunName,
  GATE_RUN_NAME_RE,
  filesTruncated,
  CODEX_SUMMARY_MARKER,
} from "./review-gate.mjs";

const CODEX = "chatgpt-codex-connector[bot]";
const HEAD = "b1f0c58e2d4c6a8b0c2e4f6a8b0c2d4e6f8a0b2c";
const OLD = "512c930aa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

function summary(status, commit = "b1f0c58") {
  return [
    CODEX_SUMMARY_MARKER,
    "",
    "## Codex Review Summary",
    "",
    "| Review | Status | Commit | Review trigger |",
    "| --- | --- | --- | --- |",
    `| 📝 **Code Review** | ${status} | \`${commit}\` | Draft marked ready |`,
    "",
    "<details> <summary>About</summary></details>",
  ].join("\n");
}
const codexDone = { author: CODEX, association: "NONE", body: summary("✅ **Completed** <relative-time>x</relative-time>"), at: "2026-10-15T10:00:00Z" };
const marker = (verdict, at = "2026-10-15T11:00:00Z", association = "OWNER", sha = HEAD.slice(0, 7)) =>
  ({ author: "owner", association, body: `<!-- claude-review: ${verdict}${sha ? ` sha=${sha}` : ""} -->\n**Claude-review**`, at });

// ── classifyFile / classifyRisk ──

test("classifyFile: motor, database, workflows, penge og auth er hoejrisiko", () => {
  assert.equal(classifyFile("backend/lib/engine/v4/mechanics/lateAttack.ts"), "motor");
  assert.equal(classifyFile("database/2026-10-14-x.sql"), "database");
  assert.equal(classifyFile(".github/workflows/ci.yml"), "workflow");
  assert.equal(classifyFile("backend/lib/economyEngine.js"), "penge");
  assert.equal(classifyFile("backend/lib/prizePayoutEngine.js"), "penge");
  assert.equal(classifyFile("backend/lib/loanEngine.js"), "penge");
  assert.equal(classifyFile("backend/scripts/salaryUnifyRecompute.js"), "penge");
  assert.equal(classifyFile("backend/lib/authTokenVerification.js"), "auth");
  assert.equal(classifyFile("backend/routes/adminRoadmap.js"), "auth");
  assert.equal(classifyFile("frontend/src/lib/getAuthedUser.js"), "auth");
  assert.equal(classifyFile(".gitleaks.toml"), "sikkerhed");
});

// Kerne-motor og penge uden for backend/lib/engine/ (review-fund paa #6657):
// filerne der foer gled igennem som lav risiko.
const CORE_MOTOR_MONEY = Object.freeze({
  "backend/lib/raceSimulator.js": "motor",
  "backend/lib/raceEngineV4Bridge.js": "motor",
  "backend/lib/raceEngineFlag.js": "motor",
  "backend/lib/raceFinalizeState.js": "motor",
  "backend/lib/raceFinalizeWatch.js": "motor",
  "backend/lib/stageResultRpc.js": "motor",
  "backend/lib/availableBalance.js": "penge",
  "backend/lib/balanceRpc.js": "penge",
  "backend/lib/poolBalance.js": "penge",
  "backend/lib/transferExecution.js": "penge",
  "backend/lib/contractExpiryRelease.js": "penge",
  "backend/lib/sponsorContractsService.js": "penge",
  "backend/cron.js": "cron",
  "backend/routes/api.js": "api",
});

test("classifyFile: kerne-motor, penge, cron og routes er hoejrisiko", () => {
  for (const [f, reason] of Object.entries(CORE_MOTOR_MONEY)) assert.equal(classifyFile(f), reason, f);
  assert.equal(classifyFile("backend/lib/someWriteRpc.js"), "database");
  assert.equal(classifyFile("backend/lib/stageScheduler.js"), "motor");
  assert.equal(classifyFile("backend/lib/weeklyScheduler.js"), "cron");
  assert.equal(classifyFile("backend/routes/rankings.ts"), "api");
  assert.equal(classifyFile("backend/api/featureFlagsApi.js"), "api");
  assert.equal(classifyFile("backend/server.js"), "api");
  assert.equal(classifyFile("backend/routes/raceSelectionBulk.routes.test.js"), null, "route-tests er stadig tests");
  assert.equal(classifyFile("backend/cron.test.js"), null);
});

// Betaling/abonnement og webhooks (Codex-fund paa #6657): rigtige penge og
// signaturtjek gled igennem som lav risiko.
const BILLING_WEBHOOK = Object.freeze({
  "backend/lib/billingCheckout.js": "betaling",
  "backend/lib/billingPortal.js": "betaling",
  "backend/lib/aluntaWebhook.js": "betaling",
  "backend/lib/alunta.js": "betaling",
  "backend/lib/aluntaSubscriptionReconcile.js": "betaling",
  "backend/lib/subscriptionPlanInterval.js": "betaling",
  "backend/lib/entitlement.js": "betaling",
  "backend/scripts/reconcileAluntaSubscriptions.js": "betaling",
  "backend/lib/wageDeductionSweep.js": "penge",
  "backend/lib/resendWebhook.js": "sikkerhed",
  "backend/lib/opsWebhook.js": "sikkerhed",
});

test("classifyFile: betaling, abonnement og webhooks er hoejrisiko", () => {
  for (const [f, reason] of Object.entries(BILLING_WEBHOOK)) assert.equal(classifyFile(f), reason, f);
  assert.equal(classifyFile("backend/lib/billingCheckout.test.js"), null, "tests er stadig tests");
  assert.equal(classifyFile("frontend/src/pages/BillingPage.jsx"), null, "UI om betaling er ikke betalingskode");
});

// Codex-fund paa #6657 (runde 3): rytter-vaerdi-opdatering og ejer-allowlisten
// gled igennem som lav risiko.
const VALUE_OWNER_GATE = Object.freeze({
  "backend/lib/riderValueRefresh.js": "penge",
  "backend/lib/sundayValueSweep.js": "penge",
  "backend/lib/marketValueLevelCorrectionGate.js": "penge",
  "backend/lib/riderValuesBulkWriteFlag.js": "penge",
  "backend/lib/ownerGate.js": "auth",
});

test("classifyFile: rytter-vaerdi er penge, ownerGate er auth", () => {
  for (const [f, reason] of Object.entries(VALUE_OWNER_GATE)) assert.equal(classifyFile(f), reason, f);
  assert.equal(classifyFile("backend/lib/riderValueRefresh.test.js"), null, "tests er stadig tests");
  assert.equal(classifyFile("backend/lib/ownerGate.test.js"), null);
  assert.equal(classifyFile("frontend/src/components/RiderValueChart.jsx"), null, "UI om vaerdi er ikke oekonomikode");
});

// Codex-fund paa #6657 (runde 4): gaten selv og CORS/rate-limit gled igennem
// som lav risiko.
const GATE_SECURITY = Object.freeze({
  "scripts/review-gate.mjs": "review-gate",
  ".coderabbit.yaml": "review-gate",
  "scripts/merge-queue.ps1": "review-gate",
  "scripts/lib/league-check.ps1": "review-gate",
  ".github/workflows/review-gate.yml": "workflow",
  "backend/lib/corsOrigin.js": "sikkerhed",
  "backend/lib/rateLimiters.js": "sikkerhed",
  "backend/lib/discordDmRateGuard.js": "sikkerhed",
});

test("classifyFile: review-gaten selv og CORS/rate-limit er hoejrisiko", () => {
  for (const [f, reason] of Object.entries(GATE_SECURITY)) assert.equal(classifyFile(f), reason, f);
  assert.equal(classifyFile("scripts/review-gate.test.mjs"), null, "tests er stadig tests");
  assert.equal(classifyFile("backend/lib/corsOrigin.test.js"), null);
  assert.equal(classifyFile("backend/lib/rateLimiters.test.js"), null);
  assert.equal(classifyFile("scripts/test-league-check.ps1"), null, "test-scriptet aendrer ingen haandhaevelse");
  assert.equal(classifyFile("docs/review-gate-notes.md"), null);
  assert.equal(classifyRisk(["scripts/review-gate.mjs"]).level, "high");
});

// Codex-fund paa #6657 (runde 5): afmeldings-routen har intet session-login; det
// signerede token er eneste adgangskontrol foer service-role-skrivningen.
test("classifyFile: afmeldings-linket (emailUnsub*) er auth", () => {
  assert.equal(classifyFile("backend/lib/emailUnsubRoute.js"), "auth");
  assert.equal(classifyFile("backend/lib/emailUnsubToken.js"), "auth");
  assert.equal(classifyFile("backend/lib/emailUnsubUrl.js"), "auth");
  assert.equal(classifyFile("frontend/src/lib/unsubscribeLink.js"), "auth");
  assert.equal(classifyFile("backend/lib/emailUnsubRoute.test.js"), null, "tests er stadig tests");
  assert.equal(classifyRisk(["backend/lib/emailUnsubRoute.js"]).level, "high");
});

// Codex-fund paa #6657 (runde 6): Supabase-klienten (login/session/Bearer-header),
// route-handlerne bag routes/api.js, facilitetskoeb og CI-vagt-scripts gled
// igennem som lav risiko.
const ROUND6 = Object.freeze({
  "frontend/src/lib/supabase.ts": "auth",
  "backend/lib/facilityService.js": "penge",
  "backend/lib/facilityEngine.js": "penge",
  "backend/lib/facilityRoutesHandlers.js": "penge",
  "backend/lib/staffOverviewHandlers.js": "api",
  "backend/lib/teamPublicProfileHandlers.js": "api",
  "scripts/check-required-ci-jobs.mjs": "ci",
  "scripts/ci-required-checks.js": "ci",
  "scripts/ci/check-workflow-checkout.mjs": "ci",
  "scripts/ci/cron-source-map.json": "ci",
  "scripts/lint-swallowed-catches.mjs": "ci",
  "scripts/audit-rls-coverage.js": "ci",
  "scripts/i18n-check-keys.mjs": "ci",
  "scripts/tone-check-em-dash.mjs": "ci",
  "scripts/eslint-disable-baseline.js": "ci",
});

test("classifyFile: Supabase-klienten, *Handlers, faciliteter og CI-vagter er hoejrisiko", () => {
  for (const [f, reason] of Object.entries(ROUND6)) assert.equal(classifyFile(f), reason, f);
  assert.equal(classifyFile("frontend/src/lib/supabasePagination.js"), null, "kun den kanoniske klient");
  assert.equal(classifyFile("scripts/check-required-ci-jobs.test.mjs"), null, "tests er stadig tests");
  assert.equal(classifyFile("scripts/ci/cron-deploy-verification.test.mjs"), null);
  assert.equal(classifyFile("backend/lib/facilityService.test.js"), null);
  assert.equal(classifyFile("frontend/src/pages/FacilitiesPage.jsx"), null, "UI om faciliteter er ikke pengekode");
  assert.equal(classifyFile("scripts/make-wave-brief.mjs"), null, "vaerktoej uden for vagt-familien");
  assert.equal(classifyRisk(["frontend/src/lib/supabase.ts"]).level, "high");
});

test("hver CI-vagt som en workflow koerer, er hoejrisiko (vagt-familien er komplet)", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const tracked = new Set(execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split(/\r?\n/).filter(Boolean));
  const workflows = [...tracked].filter((f) => /^\.github\/(workflows|actions)\/.+\.ya?ml$/.test(f));
  const referenced = new Set();
  for (const wf of workflows) {
    const text = readFileSync(new URL(`../${wf}`, import.meta.url), "utf8");
    for (const m of text.matchAll(/scripts\/[A-Za-z0-9_./-]+\.(?:mjs|cjs|js|ts|ps1|sh|json)/g)) {
      if (tracked.has(m[0]) && !isTestFile(m[0])) referenced.add(m[0]);
    }
  }
  assert.ok(referenced.has("scripts/check-required-ci-jobs.mjs"), "workflows koerer check-required-ci-jobs");
  // En vagt = et script hvis navn siger check/lint/audit, eller som ligger i scripts/ci/.
  const isGuard = (f) => f.startsWith("scripts/ci/") || /(^|\/)(ci|check|lint|audit|i18n-check|tone-check)-[^/]+$/.test(f);
  const missing = [...referenced].filter((f) => isGuard(f) && classifyFile(f) === null);
  assert.deepEqual(missing, [], "CI-vagter uden hoejrisiko-regel (udvid ci-reglen + .coderabbit.yaml)");
});

test("classifyFile: authorize/authorization er auth, Author (forum) er ikke", () => {
  assert.equal(classifyFile("backend/lib/authorizeTeamAction.js"), "auth");
  assert.equal(classifyFile("backend/lib/requestAuthorization.js"), "auth");
  assert.equal(classifyFile("frontend/src/lib/authorisation.js"), "auth");
  assert.equal(classifyFile("backend/lib/forumAuthorName.js"), null);
});

test("classifyFile: RLS er case-sensitivt (urlState er ikke RLS)", () => {
  assert.equal(classifyFile("backend/lib/rlsAudit.js"), "auth");
  assert.equal(classifyFile("backend/lib/teamRlsPolicy.js"), "auth");
  assert.equal(classifyFile("backend/lib/applyRLSGrants.js"), "auth");
  assert.equal(classifyFile("frontend/src/lib/ridersUrlState.js"), null);
  assert.equal(classifyFile("frontend/src/lib/sentryDenyUrls.js"), null, "Urls er ikke RLS");
  assert.equal(classifyFile("backend/scripts/audit-rls-coverage.js"), "auth", "rls efter bindestreg");
  assert.equal(classifyFile("backend/lib/team_rls.js"), "auth", "rls efter underscore");
});

test("classifyFile: UI, docs, scripts og tests er lav risiko", () => {
  assert.equal(classifyFile("frontend/src/pages/RacePage.jsx"), null);
  assert.equal(classifyFile("docs/GITHUB_WORKFLOW.md"), null);
  assert.equal(classifyFile("scripts/make-wave-brief.mjs"), null);
  assert.equal(classifyFile("backend/lib/abilityRegistry.js"), null);
  assert.equal(classifyFile("backend/lib/economyEngine.test.js"), null, "test af pengekode aendrer ingen prod-adfaerd");
  assert.equal(classifyFile("backend/lib/engine/v4/foo.test.ts"), null);
  assert.equal(classifyFile("frontend/src/components/forum/ForumAuthorIdentity.jsx"), null, "Author er ikke auth");
  assert.equal(classifyFile("docs/economy-notes.md"), null, "docs om oekonomi er ikke pengekode");
});

test("classifyFile: Windows-stier normaliseres", () => {
  assert.equal(classifyFile("backend\\lib\\engine\\v4\\x.ts"), "motor");
});

test("classifyRisk: een hoejrisiko-fil goer hele PR'en hoejrisiko; labels risk:high/security ogsaa", () => {
  assert.deepEqual(classifyRisk(["docs/a.md", "frontend/src/x.jsx"], []), { level: "low", reasons: [] });
  const high = classifyRisk(["docs/a.md", "database/x.sql"], []);
  assert.equal(high.level, "high");
  assert.deepEqual(high.reasons, ["database: database/x.sql"]);
  assert.equal(classifyRisk(["docs/a.md"], ["Security"]).level, "high");
  assert.equal(classifyRisk(["docs/a.md"], ["risk:high"]).level, "high");
  assert.equal(classifyRisk(["docs/a.md"], ["risk:med"]).level, "low");
});

// Case-sensitiv glob-matcher (som CodeRabbit). path.posix.matchesGlob er
// case-INsensitiv paa Windows og ville skjule uoverensstemmelser lokalt.
// Understoetter det path_filters bruger: **, *, ?, [..] og {a,b}.
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "[") { const end = glob.indexOf("]", i); re += glob.slice(i, end + 1); i = end; }
    else if (c === "{") { const end = glob.indexOf("}", i); re += `(?:${glob.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|\\]/g, "\\$&")).join("|")})`; i = end; }
    else re += c.replace(/[.+^$()|\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

test("globToRegExp: case-sensitiv og sti-bevidst", () => {
  assert.ok(globToRegExp("backend/**/*[Cc]ron*").test("backend/cron.js"));
  assert.ok(globToRegExp("backend/**/*[Rr]ls*").test("backend/lib/x/rlsAudit.js"));
  assert.ok(!globToRegExp("backend/**/*[Rr]ls*").test("frontend/src/lib/ridersUrlState.js"));
  assert.ok(!globToRegExp("{backend,frontend/src/lib}/**/*[Rr]ls*").test("frontend/src/lib/ridersUrlState.js"), "rlS er ikke rls");
  assert.ok(!globToRegExp("{backend,frontend/src/lib}/**/rls*").test("frontend/src/lib/sentryDenyUrls.js"), "Urls er ikke rls");
  assert.ok(!globToRegExp("{backend,frontend/src/lib}/**/*[_.-]rls*").test("frontend/src/lib/sentryDenyUrls.js"));
  assert.ok(globToRegExp("{backend,frontend/src/lib}/**/*[_.-]rls*").test("backend/scripts/audit-rls-coverage.js"));
  assert.ok(globToRegExp("{backend,frontend/src/lib}/**/*[Aa]uth*").test("frontend/src/lib/getAuthedUser.js"));
  assert.ok(!globToRegExp("backend/server.*").test("backend/lib/server.js"));
});

function coderabbitFilters() {
  const yaml = readFileSync(new URL("../.coderabbit.yaml", import.meta.url), "utf8");
  const block = yaml.split(/^\s*path_filters:\s*$/m)[1].split(/^\s*[a-z_]+:\s*$/m)[0];
  const all = [...block.matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map((m) => m[1]);
  const globs = all.filter((g) => !g.startsWith("!"));
  const excludes = all.filter((g) => g.startsWith("!")).map((g) => g.slice(1));
  const globRes = globs.map(globToRegExp);
  const excludeRes = excludes.map(globToRegExp);
  return {
    globs,
    covered: (f) => globRes.some((g) => g.test(f)),
    excluded: (f) => excludeRes.some((g) => g.test(f)),
  };
}

test(".coderabbit.yaml: auto-review daekker alle hoejrisiko-stier og ingen lavrisiko-stier", () => {
  const { globs, covered } = coderabbitFilters();
  assert.ok(globs.length > 5, "positive path_filters fundet");
  const high = [
    "backend/lib/engine/v4/mechanics/lateAttack.ts", "database/2026-10-14-x.sql", ".github/workflows/ci.yml",
    "backend/lib/economyEngine.js", "backend/lib/seasonFinanceReport.js", "backend/lib/prizePayoutEngine.js",
    "backend/lib/loanEngine.js", "backend/lib/transferPriceBand.js", "backend/lib/midSeasonSponsor.js",
    "backend/lib/authTokenVerification.js", "backend/routes/adminRoadmap.js", "frontend/src/lib/getAuthedUser.js",
    "backend/lib/urlSafety.js", ".gitleaks.toml", "backend/lib/someWriteRpc.js", "backend/lib/weeklyScheduler.js",
    "backend/api/featureFlagsApi.js", "backend/server.js", "backend/lib/authorizeTeamAction.js",
    ...Object.keys(CORE_MOTOR_MONEY), ...Object.keys(BILLING_WEBHOOK), ...Object.keys(VALUE_OWNER_GATE),
    ...Object.keys(GATE_SECURITY), ...Object.keys(ROUND6), ...Object.keys(ROUND7), "backend/scripts/audit-rls-coverage.js",
  ];
  for (const f of high) {
    assert.ok(classifyFile(f), `klassifikatoren: ${f} er hoejrisiko`);
    assert.ok(covered(f), `.coderabbit.yaml mangler et filter for ${f}`);
  }
  for (const f of ["frontend/src/pages/RacePage.jsx", "docs/GITHUB_WORKFLOW.md", "scripts/make-wave-brief.mjs", "backend/lib/abilityRegistry.js", "frontend/src/lib/sentryDenyUrls.js", "scripts/test-league-check.ps1"]) {
    assert.equal(classifyFile(f), null);
    assert.ok(!covered(f), `${f} er lav risiko og maa ikke bruge CodeRabbit-kvote`);
  }
});

test(".coderabbit.yaml og klassifikatoren er enige om hver fil i repoet", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split(/\r?\n/).filter(Boolean);
  assert.ok(files.length > 1000, "git ls-files gav repoets filer");
  const { covered, excluded } = coderabbitFilters();
  const missing = [];
  const extra = [];
  for (const f of files) {
    if (excluded(f)) continue;
    const high = classifyFile(f) !== null;
    // Hoejrisiko => CodeRabbit-filter. Omvendt maa et filter kun ramme hoejrisiko-
    // filer eller tests ved siden af dem (tests reviewes gerne sammen med koden).
    if (high && !covered(f)) missing.push(f);
    if (!high && covered(f) && !isTestFile(f)) extra.push(f);
  }
  assert.deepEqual(missing, [], "hoejrisiko-filer uden CodeRabbit-filter (tilfoej glob i .coderabbit.yaml)");
  assert.deepEqual(extra, [], "CodeRabbit-filtre der rammer lavrisiko-filer (stram glob eller klassifikator)");
});

// ── Codex ──

test("parseCodexSummary: completed / pending / failed / ukendt", () => {
  assert.deepEqual(parseCodexSummary(codexDone.body), { state: "completed", commit: "b1f0c58" });
  assert.equal(parseCodexSummary(summary("⏳ **In progress**")).state, "pending");
  assert.equal(parseCodexSummary(summary("❌ **Failed**")).state, "failed");
  assert.equal(parseCodexSummary("ingen markoer | x | y |").state, "unknown");
});

// Codex-fund paa #6657 (runde 4): tilstanden skal komme fra Code Review-raekken,
// ikke fra en vilkaarlig anden raekke i samme summary.
function multiSummary(codeStatus, otherStatus, { machine = null, commit = "b1f0c58" } = {}) {
  return [
    CODEX_SUMMARY_MARKER,
    ...(machine ? [`<!-- codex-review-state:v1 ${JSON.stringify(machine)} -->`] : []),
    "| Review | Status | Commit | Review trigger |",
    "| --- | --- | --- | --- |",
    `| 📝 **Code Review** | ${codeStatus} | \`${commit}\` | Manual request |`,
    `| 🔒 **Security Review** | ${otherStatus} | \`${commit}\` | Manual request |`,
  ].join("\n");
}

test("parseCodexSummary: fejlet Code Review + gennemfoert Security Review -> failed (ikke completed)", () => {
  assert.equal(parseCodexSummary(multiSummary("❌ **Failed**", "✅ **Completed**")).state, "failed");
  assert.equal(parseCodexSummary(multiSummary("✅ **Completed**", "❌ **Failed**")).state, "completed", "security-raekken paavirker ikke code review");
  assert.equal(parseCodexSummary(multiSummary("✅ **Completed**", "⏳ **In progress**")).state, "completed");
  assert.equal(parseCodexSummary(multiSummary("⏳ **In progress**", "✅ **Completed**")).state, "pending");
  const failedMachine = { code_review: { commit_sha: HEAD, status: "failed" }, security_review: { commit_sha: HEAD, status: "completed" } };
  const body = multiSummary("❌ **Failed**", "✅ **Completed**", { machine: failedMachine });
  assert.deepEqual(parseCodexSummary(body), { state: "failed", commit: HEAD });
  assert.equal(evaluateCodex({ comments: [{ author: CODEX, body }], headSha: HEAD }).ok, false, "fejlet code review for HEAD maa aldrig give groen gate");
  // Maskin-status vinder over tabellen (tabellen kan vaere ude af trit).
  const machineDone = { code_review: { commit_sha: HEAD, status: "completed" } };
  assert.equal(parseCodexSummary(multiSummary("❌ **Failed**", "❌ **Failed**", { machine: machineDone })).state, "completed");
  const machineRunning = { code_review: { commit_sha: HEAD, status: "in_progress" } };
  assert.equal(parseCodexSummary(multiSummary("✅ **Completed**", "✅ **Completed**", { machine: machineRunning })).state, "pending");
});

test("parseCodexSummary: kun en Security Review-raekke er intet code review (fail-closed)", () => {
  const body = [CODEX_SUMMARY_MARKER, "| Review | Status | Commit | Review trigger |", "| --- | --- | --- | --- |",
    `| 🔒 **Security Review** | ✅ **Completed** | \`b1f0c58\` | Manual request |`].join("\n");
  assert.equal(parseCodexSummary(body).state, "unknown");
  assert.equal(evaluateCodex({ comments: [{ author: CODEX, body }], headSha: HEAD }).ok, false);
});

test("codexStatusToState", () => {
  assert.equal(codexStatusToState("completed"), "completed");
  assert.equal(codexStatusToState("in_progress"), "pending");
  assert.equal(codexStatusToState("failed"), "failed");
  assert.equal(codexStatusToState(null), "failed");
});

test("evaluateCodex: gennemfoert uden traade -> ok", () => {
  const r = evaluateCodex({ comments: [codexDone], headSha: HEAD });
  assert.equal(r.ok, true);
  assert.match(r.detail, /b1f0c58/);
});

test("evaluateCodex: uloeste Codex-traade blokerer, loeste og andres traade goer ikke", () => {
  const threads = [
    { author: "chatgpt-codex-connector", isResolved: false },
    { author: "chatgpt-codex-connector", isResolved: true },
    { author: "coderabbitai", isResolved: false },
  ];
  const r = evaluateCodex({ comments: [codexDone], threads, headSha: HEAD });
  assert.equal(r.ok, false);
  assert.equal(r.unresolved, 1);
  assert.match(r.detail, /1 uloest/);
  assert.equal(evaluateCodex({ comments: [codexDone], threads: threads.slice(1), headSha: HEAD }).ok, true, "CodeRabbit-traade er aldrig et krav");
});

test("evaluateCodex: intet review / koerer / fejlet -> ikke ok med handlingsanvisning", () => {
  assert.match(evaluateCodex({}).detail, /@codex review/);
  assert.equal(evaluateCodex({ comments: [{ author: CODEX, body: summary("In progress") }], headSha: HEAD }).state, "pending");
  assert.match(evaluateCodex({ comments: [{ author: CODEX, body: summary("Failed") }], headSha: HEAD }).detail, /fejlede/);
});

test("evaluateCodex: Codex-review for HEAD uden summary taeller som gennemfoert", () => {
  assert.equal(evaluateCodex({ reviews: [{ author: CODEX, body: "### 💡 Codex Review", commit: HEAD }], headSha: HEAD }).ok, true);
  assert.equal(evaluateCodex({ reviews: [{ author: CODEX, body: "**Reviewed commit:** `b1f0c58e2d`" }], headSha: HEAD }).ok, true);
});

test("evaluateCodex: 👍-reaktion er aldrig HEAD-bevis (kan ikke bindes til en SHA, #6657 Codex-fund)", () => {
  const thumbs = [{ author: CODEX, content: "+1", at: "2026-10-15T11:00:00Z" }];
  assert.equal(evaluateCodex({ reactions: thumbs, headSha: HEAD, headCommittedAt: "2026-10-15T10:00:00Z" }).ok, false,
    "👍 efter en (forfatter-styret) committer-dato er ikke nok");
  assert.equal(evaluateGate({ author: "x", files: ["docs/a.md"], reactions: thumbs, headSha: HEAD }).ok, false);
});

test("parseCodexSummary: codex-review-state-JSON giver den fulde SHA", () => {
  const state = `<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${HEAD}","has_any_findings":false,"has_unresolved_findings":false,"status":"completed"},"security_review":{"commit_sha":null}} -->`;
  const body = summary("✅ **Completed**", "b1f0c58").replace(CODEX_SUMMARY_MARKER, `${CODEX_SUMMARY_MARKER}\n${state}`);
  assert.deepEqual(parseCodexSummary(body), { state: "completed", commit: HEAD });
  assert.deepEqual(parseCodexReviewState(body), { commit: HEAD, status: "completed" });
  assert.equal(parseCodexReviewState("<!-- codex-review-state:v1 {ugyldig} -->"), null);
  assert.equal(parseCodexReviewState(`<!-- codex-review-state:v1 {"code_review":{"commit_sha":null}} -->`), null);
  assert.equal(evaluateCodex({ comments: [{ author: CODEX, body }], headSha: HEAD }).ok, true);
});

test("evaluateCodex: foraeldet bevis fra et aeldre commit -> roed (#6657 review)", () => {
  const stale = { ...codexDone, body: summary("✅ **Completed**", OLD.slice(0, 7)) };
  const r = evaluateCodex({ comments: [stale], headSha: HEAD });
  assert.equal(r.ok, false);
  assert.equal(r.state, "stale");
  assert.match(r.detail, /512c930.*@codex review/);
  assert.equal(evaluateCodex({ reviews: [{ author: CODEX, body: "x", commit: OLD }], headSha: HEAD }).ok, false, "review paa gammelt commit");
  assert.equal(evaluateCodex({ comments: [codexDone] }).ok, false, "ukendt HEAD matcher intet");
  assert.equal(evaluateCodex({ comments: [stale, codexDone], headSha: HEAD }).ok, true, "frisk summary for HEAD -> groen");
});

test("shaMatchesHead + parseCodexReviewedCommit", () => {
  assert.equal(shaMatchesHead("b1f0c58", HEAD), true);
  assert.equal(shaMatchesHead(HEAD.toUpperCase(), HEAD), true);
  assert.equal(shaMatchesHead("b1f0c5", HEAD), false, "under 7 tegn er for tvetydigt");
  assert.equal(shaMatchesHead("512c930", HEAD), false);
  assert.equal(shaMatchesHead("b1f0c58", null), false);
  assert.equal(parseCodexReviewedCommit("**Reviewed commit:** `fda8692284`"), "fda8692284");
  assert.equal(parseCodexReviewedCommit("intet"), null);
});

test("evaluateCodex: en summary-kommentar fra en anden konto taeller ikke", () => {
  assert.equal(evaluateCodex({ comments: [{ ...codexDone, author: "someone" }] }).ok, false);
});

// ── Claude ──

test("findClaudeVerdict: seneste betroede markoer vinder; ubetroede ignoreres", () => {
  const items = [
    marker("blocking", "2026-10-15T09:00:00Z"),
    marker("clean", "2026-10-15T12:00:00Z"),
    marker("blocking", "2026-10-15T13:00:00Z", "NONE"),
  ];
  assert.deepEqual(findClaudeVerdict(items), { verdict: "clean", sha: "b1f0c58", at: "2026-10-15T12:00:00Z" });
  assert.equal(findClaudeVerdict([{ association: "OWNER", body: "claude-review: clean (ingen markoer)" }]), null);
});

test("evaluateClaude: kun paakraevet ved hoejrisiko; blocking og manglende blokerer", () => {
  const low = { level: "low", reasons: [] };
  const high = { level: "high", reasons: ["motor: x"] };
  assert.equal(evaluateClaude([], low).ok, true);
  assert.equal(evaluateClaude([], high, HEAD).ok, false);
  assert.match(evaluateClaude([], high, HEAD).detail, /post-claude-review/);
  assert.equal(evaluateClaude([marker("blocking")], high, HEAD).ok, false);
  assert.equal(evaluateClaude([marker("notes")], high, HEAD).ok, true);
  assert.equal(evaluateClaude([marker("clean")], high, HEAD).ok, true);
});

test("evaluateClaude: markoer for et aeldre commit eller uden sha= taeller ikke efter push (#6657 review)", () => {
  const high = { level: "high", reasons: ["motor: x"] };
  const stale = evaluateClaude([marker("clean", "2026-10-15T11:00:00Z", "OWNER", "512c930")], high, HEAD);
  assert.equal(stale.ok, false);
  assert.match(stale.detail, /512c930.*ikke HEAD b1f0c58/);
  assert.equal(evaluateClaude([marker("clean", "2026-10-15T11:00:00Z", "OWNER", null)], high, HEAD).ok, false, "markoer uden sha=");
  assert.equal(evaluateClaude([marker("clean")], high, null).ok, false, "ukendt HEAD matcher intet");
  // Ny markoer for HEAD efter en gammel blocking -> groen; blocking for HEAD efter clean for gammelt commit -> roed.
  assert.equal(evaluateClaude([marker("blocking", "2026-10-15T09:00:00Z", "OWNER", "512c930"), marker("clean", "2026-10-15T12:00:00Z")], high, HEAD).ok, true);
  assert.equal(evaluateClaude([marker("clean", "2026-10-15T13:00:00Z", "OWNER", "512c930"), marker("blocking", "2026-10-15T12:00:00Z")], high, HEAD).ok, false);
});

// ── Gaten samlet ──

test("evaluateGate: lav risiko kraever kun Codex", () => {
  const r = evaluateGate({ author: "NicolaiDolmer", files: ["docs/a.md"], comments: [codexDone], headSha: HEAD });
  assert.equal(r.ok, true);
  assert.equal(r.claude.required, false);
});

// Ejer 16/10: rule 35 (d) er rettet, saa en lav-risiko teknisk PR merges autonomt paa
// Codex + groen CI; opus-review kraeves kun paa hoejrisiko. Rapporten siger det.
test("evaluateGate: lav risiko teknisk PR er groen paa Codex, og rapporten siger at det er nok (rule 35 d)", () => {
  const r = evaluateGate({ author: "NicolaiDolmer", files: ["backend/lib/abilityRegistry.js"], comments: [codexDone], headSha: HEAD });
  assert.equal(r.ok, true);
  assert.equal(r.claude.required, false);
  assert.match(r.claude.detail, /Codex \+ groen CI er nok til autonom merge \(rule 35 d/);
  assert.match(formatReport(r, 1), /Claude \(kun hoejrisiko\): ok - .*Codex \+ groen CI er nok/);
});

test("evaluateGate: hoejrisiko kraever Codex OG Claude", () => {
  const base = { author: "NicolaiDolmer", files: ["backend/lib/engine/v4/x.ts"], headSha: HEAD };
  assert.equal(evaluateGate({ ...base, comments: [codexDone] }).ok, false, "Claude mangler");
  assert.equal(evaluateGate({ ...base, comments: [marker("clean")] }).ok, false, "Codex mangler");
  assert.equal(evaluateGate({ ...base, comments: [codexDone, marker("clean")] }).ok, true);
  assert.equal(evaluateGate({ ...base, comments: [codexDone, marker("blocking")] }).ok, false);
});

test("evaluateGate: groen gate bliver roed efter push til nyt HEAD indtil begge reviews er fornyet", () => {
  const evidence = { author: "NicolaiDolmer", files: ["backend/lib/engine/v4/x.ts"], comments: [codexDone, marker("clean")] };
  assert.equal(evaluateGate({ ...evidence, headSha: HEAD }).ok, true, "frisk bevis -> groen");
  const pushed = evaluateGate({ ...evidence, headSha: OLD });
  assert.equal(pushed.ok, false, "foraeldet bevis -> roed");
  assert.equal(pushed.codex.state, "stale");
  assert.equal(pushed.claude.ok, false);
});

test("evaluateGate: CodeRabbit er aldrig et krav (ingen CodeRabbit-data -> stadig groen)", () => {
  const r = evaluateGate({ author: "x", files: ["frontend/src/x.jsx"], comments: [codexDone], threads: [{ author: "coderabbitai", isResolved: false }], headSha: HEAD });
  assert.equal(r.ok, true);
});

test("evaluateGate: Dependabot er undtaget, draft er aldrig groen", () => {
  assert.equal(evaluateGate({ author: "dependabot[bot]", files: [".github/workflows/ci.yml"] }).ok, true);
  assert.equal(evaluateGate({ author: "x", draft: true, files: ["docs/a.md"], comments: [codexDone] }).ok, false);
});

test("formatReport: viser risiko, Codex, Claude og at CodeRabbit er valgfri", () => {
  const r = evaluateGate({ author: "x", files: ["database/x.sql"], comments: [codexDone] });
  const text = formatReport(r, 42);
  assert.match(text, /review-gate: roed \(PR #42\)/);
  assert.match(text, /database: database\/x\.sql/);
  assert.match(text, /CodeRabbit: valgfri/);
});

test("buildClaudeMarkerComment: markoeren parses tilbage af findClaudeVerdict", () => {
  const body = buildClaudeMarkerComment("notes", "512C930ABCDEF", "Smaating.");
  assert.deepEqual(findClaudeVerdict([{ association: "OWNER", body, at: "t" }]), { verdict: "notes", sha: "512c930abcdef", at: "t" });
  assert.throws(() => buildClaudeMarkerComment("ok", "abc1234"), /ukendt verdict/);
});

test("shouldRerun: kun naar udfaldet er skiftet, aldrig midt i en koersel eller paa en draft-koersel", () => {
  assert.equal(shouldRerun(null, true).rerun, false);
  assert.equal(shouldRerun({ id: 1, status: "in_progress" }, true).rerun, false);
  assert.equal(shouldRerun({ id: 1, status: "completed", conclusion: "skipped" }, true).rerun, false);
  assert.equal(shouldRerun({ id: 1, status: "completed", conclusion: "failure" }, false).rerun, false);
  assert.equal(shouldRerun({ id: 1, status: "completed", conclusion: "success" }, true).rerun, false);
  assert.deepEqual(shouldRerun({ id: 1, status: "completed", conclusion: "failure" }, true), { rerun: true, why: "nu groen" });
  assert.deepEqual(shouldRerun({ id: 1, status: "completed", conclusion: "success" }, false), { rerun: true, why: "nu roed" });
});

test("pickGateRun: finder koerslen via PR-associationen, ogsaa naar run.head_sha er merge-commit'et (#6657 review)", () => {
  const MERGE = "9999999aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const runs = [
    { id: 1, created_at: "2026-10-15T10:00:00Z", head_sha: OLD, pull_requests: [{ number: 42, head: { sha: OLD } }] },
    { id: 2, created_at: "2026-10-15T11:00:00Z", head_sha: MERGE, pull_requests: [{ number: 42, head: { sha: HEAD } }] },
    { id: 3, created_at: "2026-10-15T12:00:00Z", head_sha: HEAD, pull_requests: [{ number: 7, head: { sha: HEAD } }] },
  ];
  assert.equal(pickGateRun(runs, 42).id, 2, "nyeste koersel associeret med PR'en");
  assert.equal(pickGateRun(runs.slice(0, 1), 42).id, 1);
  assert.equal(pickGateRun(runs, 43), null, "andre PR'ers koersler bruges aldrig");
  assert.equal(pickGateRun([{ id: 5, created_at: "t", head_sha: HEAD, pull_requests: [{ number: 42 }] }], 42).id, 5);
  assert.equal(pickGateRun([], 42), null);
});

// Codex-fund paa #6657 (runde 8): en pull_request_target-koersel har head_sha = BASE-branchens
// seneste commit (ikke PR'ens HEAD), head_branch = base og tom pull_requests. PR'en kendes kun paa
// koerselsnavnet (run-name i review-gate.yml).
test("pickGateRun: pull_request_target-koersler identificeres paa koerselsnavnet, aldrig paa PR'ens head-SHA (#6657 Codex-fund)", () => {
  const BASE_SHA = "ba5e000000000000000000000000000000000000";
  const target = (id, at, pr, extra = {}) => ({
    id, created_at: at, event: "pull_request_target", head_sha: BASE_SHA, head_branch: "main",
    display_title: gateRunName(pr, "synchronize"), pull_requests: [], ...extra,
  });
  const runs = [
    target(10, "2026-10-16T09:00:00Z", 42),
    target(11, "2026-10-16T10:00:00Z", 42),
    target(12, "2026-10-16T11:00:00Z", 7),
  ];
  assert.equal(pickGateRun(runs, 42).id, 11, "nyeste koersel for PR 42 trods base-SHA i head_sha");
  assert.equal(pickGateRun(runs, 7).id, 12);
  assert.equal(pickGateRun(runs, 43), null, "ingen koersel for en PR uden koersler");
  assert.equal(pickGateRun(runs, 4), null, "PR#4 er ikke praefiks-match paa PR#42");
  assert.equal(pickGateRun([{ id: 1, created_at: "t", event: "pull_request_target", head_sha: HEAD, pull_requests: [] }], 42), null,
    "en koersel uden navn bindes ikke til en PR bare fordi SHA'en tilfaeldigvis er PR'ens HEAD");
  assert.equal(pickGateRun([target(20, "t", 42, { event: "pull_request" })], 42), null, "kun pull_request_target-koersler taeller");
  assert.equal(pickGateRun([target(21, "t", 42, { pull_requests: [{ number: 7 }] })], 42), null, "association med en anden PR vinder over navnet");
});

test("gateRunName + GATE_RUN_NAME_RE: roundtrip, og workflow-YAML'en saetter praecis dette navn", () => {
  assert.equal(gateRunName(6657, "opened"), "review-gate PR#6657 opened");
  assert.equal(GATE_RUN_NAME_RE.exec(gateRunName(6657, "opened"))[1], "6657");
  assert.equal(GATE_RUN_NAME_RE.exec(gateRunName(6657))[1], "6657");
  assert.equal(GATE_RUN_NAME_RE.exec("Review gate (schedule)"), null);
  const yml = readFileSync(new URL("../.github/workflows/review-gate.yml", import.meta.url), "utf8");
  assert.match(yml, /^run-name: .*format\('review-gate PR#\{0\} \{1\}', github\.event\.pull_request\.number, github\.event\.action\)/m);
});

// ── Escaped defects ──

test("parseIntroducedBy: dansk og engelsk, flere PR'er paa linjen", () => {
  assert.deepEqual(parseIntroducedBy("Fejl i prod.\nIndfoert af: #6632 og #6633\nAndet #1"), [6632, 6633]);
  assert.deepEqual(parseIntroducedBy("Introduced by #10, #9"), [9, 10]);
  assert.deepEqual(parseIntroducedBy("indført af #77"), [77]);
  assert.deepEqual(parseIntroducedBy("ingen henvisning #5"), []);
});

test("reviewersOnPr + tallyReviewerStats: taeller fund og hvem der missede", () => {
  const prA = {
    number: 1,
    threads: [{ author: "chatgpt-codex-connector" }, { author: "coderabbitai" }, { author: "coderabbitai" }],
    comments: [{ author: CODEX, body: "summary" }, marker("notes")],
  };
  const prB = { number: 2, threads: [], comments: [{ author: CODEX, body: "summary" }] };
  assert.deepEqual(reviewersOnPr(prA), { touched: ["claude", "coderabbit", "codex"], findings: { codex: 1, claude: 1, coderabbit: 2 } });
  const stats = tallyReviewerStats({ prs: [prA, prB], escaped: [{ issue: 900, prs: [2] }, { issue: 901, prs: [] }] });
  assert.deepEqual(stats.codex, { reviewedPrs: 2, findings: 1, missed: 1, missedIssues: [900] });
  assert.deepEqual(stats.claude, { reviewedPrs: 1, findings: 1, missed: 0, missedIssues: [] });
  assert.equal(stats.coderabbit.findings, 2);
  const text = formatEscapedReport({ since: "2026-10-01", until: "2026-11-01", stats, escaped: [{ issue: 900, prs: [2] }, { issue: 901, prs: [] }], mergedCount: 2 });
  assert.match(text, /\| codex \| 2 \| 1 \| 1 \(#900\) \|/);
  assert.match(text, /uden "Indfoert af #PR": 1/);
});

test("tallyReviewerStats: indfoerende PR uden for perioden hentes via introducing", () => {
  const old = { number: 5, threads: [], comments: [marker("clean")] };
  const stats = tallyReviewerStats({ prs: [], escaped: [{ issue: 7, prs: [5] }], introducing: [old] });
  assert.equal(stats.claude.missed, 1);
  assert.equal(stats.claude.reviewedPrs, 0, "kun PR'er merget i perioden taeller som reviewet");
});

// Codex-fund paa #6657 (runde 7): markedet (kill switch), delegeret merge-
// haandhaevelse og gate-koersel-opslag paa pull_request_target.
const ROUND7 = Object.freeze({
  "backend/lib/marketPause.js": "penge",
  "backend/lib/marketUtils.js": "penge",
  "backend/lib/youthMarket.js": "penge",
  "scripts/wave-policy.mjs": "review-gate",
  "scripts/wave-ownership.mjs": "review-gate",
  "scripts/lib/merge-pr-owned.ps1": "review-gate",
});

test("classifyFile: markedet og delegeret merge-haandhaevelse er hoejrisiko (#6657)", () => {
  for (const [f, reason] of Object.entries(ROUND7)) assert.equal(classifyFile(f), reason, f);
  assert.equal(classifyFile("backend/lib/marketPause.test.js"), null, "tests er stadig tests");
  assert.equal(classifyFile("scripts/wave-policy.test.mjs"), null);
  assert.equal(classifyFile("frontend/src/pages/MarketPage.jsx"), null, "UI er ikke backend-pengekode");
  assert.equal(classifyFile("scripts/wave-capacity.mjs"), null, "kun haandhaevelsen, ikke al wave-tooling");
});

test("gateRunsPath: kun event + side; aldrig branch- eller SHA-filter (pull_request_target koerer paa base)", () => {
  const p = gateRunsPath("o/r");
  assert.ok(!/branch=/.test(p), "ingen branch-filter");
  assert.ok(!/head_sha=/.test(p), "ingen SHA-filter: target-koerslens head_sha er base-branchens");
  assert.ok(p.includes("event=pull_request_target"));
  assert.ok(p.includes("per_page=100&page=1"));
  assert.ok(gateRunsPath("o/r", 3).endsWith("page=3"));
  assert.ok(gateRunsPath("o/r", "x; rm").endsWith("page=1"), "ugyldig side -> side 1");
});

// Codex-fund paa #6657 (runde 8): nye kontos finans-gates er anti-misbrugsvaernet paa lan, overfoersel og
// auktion. Resten af listen er fundet ved at gennemgaa ALLE backend/lib-moduler der importerer
// economyEngine/balanceRpc/availableBalance/finance_transactions, og scripts/ + .claude/ + .github/ systematisk.
const ROUND8_MONEY = Object.freeze({
  "backend/lib/newAccountGates.js": "penge",
  "backend/lib/squadEnforcement.js": "penge",
  "backend/lib/scoutAssignmentService.js": "penge",
  "backend/lib/comebackService.js": "penge",
  "backend/lib/academyIntake.js": "penge",
  "backend/lib/academyGraduation.js": "penge",
  "backend/lib/boardConsequences.js": "penge",
  "backend/lib/seasonTransition.js": "penge",
  "backend/lib/seasonStartHooks.js": "penge",
  "backend/lib/seasonCarryOver.js": "penge",
  "backend/lib/seasonAutoTransition.js": "penge",
  "backend/lib/founderSeats.js": "betaling",
  "backend/lib/botDetection.js": "sikkerhed",
  "backend/lib/fairplayScoring.js": "sikkerhed",
  "backend/lib/betaAccess.js": "sikkerhed",
  "backend/lib/likeEscape.js": "sikkerhed",
  "backend/lib/betaResetService.js": "database",
  "backend/lib/relaunchOrchestrator.js": "database",
  "backend/lib/riderCleanupDeletion.js": "database",
  "backend/lib/resetFkAudit.js": "database",
});
const ROUND8_SECURITY_MERGE = Object.freeze({
  ".github/CODEOWNERS": "ci",
  ".github/dependabot.yml": "ci",
  ".github/codeql/codeql-config.yml": "ci",
  ".claude/settings.json": "ci",
  ".claude/workflows/wave.js": "ci",
  ".claude/hooks/block-dangerous-secret-commands.sh": "ci",
  ".claude/hooks/sanitize-secrets.ps1": "ci",
  "scripts/hooks/guard-agent-spawn.sh": "ci",
  "scripts/hooks/lib/scan-secrets.py": "ci",
  ".gitleaksignore": "sikkerhed",
  ".infisical.json": "sikkerhed",
  "backend/railway.json": "deploy",
  "frontend/vercel.json": "deploy",
  "frontend/.env.production": "deploy",
  "scripts/merge-queue-classify.mjs": "review-gate",
  "scripts/merge-queue-files.mjs": "review-gate",
  "scripts/wave-owner-override.mjs": "review-gate",
  "scripts/lib/git-merge-detection.ps1": "ci",
  "scripts/lib/league-audit-check.cjs": "ci",
  "scripts/lib/gh-retry.sh": "ci",
  "scripts/verify-lock.ps1": "ci",
  "scripts/verify-local.ps1": "ci",
  "scripts/preflight-pr.ps1": "ci",
  "scripts/guard-commit-branch.sh": "ci",
  "scripts/guard-node-modules-junction.mjs": "ci",
  "scripts/anti-slop-baseline.json": "ci",
  "scripts/ts-core-ratchet-baseline.json": "ci",
  "scripts/feature-registry-flag-expiry-baseline.json": "ci",
  "scripts/pre-push-hook.ps1": "sikkerhed",
  "scripts/install-git-hooks.ps1": "sikkerhed",
  "scripts/enable-github-security.ps1": "sikkerhed",
  "scripts/security-grants.sql": "sikkerhed",
  "scripts/apply-collab-branch-protection.sh": "sikkerhed",
  "scripts/seed-infisical.ps1": "sikkerhed",
  "scripts/rotate-supabase-key-dev-from-prod.ps1": "sikkerhed",
  "scripts/probe-railway-keys.sh": "sikkerhed",
  "scripts/get-test-token.mjs": "sikkerhed",
  "scripts/db-backup.mjs": "sikkerhed",
  "scripts/db-verify-restore.mjs": "sikkerhed",
  "scripts/set-vercel-domain-redirect.ps1": "sikkerhed",
  "frontend/src/pages/LoginPage.jsx": "auth",
  "frontend/src/pages/ResetPasswordPage.jsx": "auth",
  "frontend/src/components/admin/shared/useAdminAuth.js": "auth",
});
const ROUND8_PROD_SCRIPTS = Object.freeze({
  "backend/scripts/endSeasonS2.mjs": "prod-script",
  "backend/scripts/creditDivisionAdjustment-4376.mjs": "penge",
  "backend/scripts/dev/wipeSeason3Calendar.mjs": "prod-script",
  "backend/lib/dev/backfill3746Core.js": "prod-script",
  "scripts/ops/refund-6551-scout-missions.mjs": "prod-script",
  "scripts/ops/cancel-fairplay-auctions.mjs": "prod-script",
  "scripts/oneoff/2026-08-03-repair-ai-rider-fatigue-3015.sql": "prod-script",
  "scripts/migrations-manual/2026-06-10-669-fictional-rider-names-rename-PLAN.sql": "prod-script",
  "scripts/staging/Staging-Guard.ps1": "prod-script",
  "scripts/delete-orphan-test-teams.mjs": "prod-script",
  "scripts/trainingRecovery5928.apply.mjs": "prod-script",
  "scripts/winback-send.mjs": "prod-script",
  "scripts/season-signup-reminder-send.mjs": "prod-script",
  "scripts/run-value-event-5443.ps1": "prod-script",
  "scripts/sweep-forum-image-orphans.mjs": "prod-script",
  "scripts/import_riders.py": "prod-script",
});

test("classifyFile: nye kontos finans-gates og de oevrige penge-, sikkerheds- og reset-moduler er hoejrisiko (#6657 runde 8)", () => {
  for (const [f, reason] of Object.entries(ROUND8_MONEY)) assert.equal(classifyFile(f), reason, f);
  assert.equal(classifyFile("backend/lib/newAccountGates.test.js"), null, "tests er stadig tests");
  assert.equal(classifyFile("backend/lib/squadEnforcement.test.js"), null);
  assert.equal(classifyRisk(["backend/lib/newAccountGates.js"]).level, "high", "en PR der kun roerer gaten er hoejrisiko");
  assert.equal(classifyRisk(["backend/lib/newAccountGates.js"]).reasons[0], "penge: backend/lib/newAccountGates.js");
  // Bevidst lav risiko: gameplay/kosmetik i samme familier.
  for (const f of ["backend/lib/boardGoals.js", "backend/lib/academyFlag.js", "backend/lib/managerParking.js", "backend/lib/seasonLookup.js",
    "backend/lib/seasonFormReset.js", "backend/lib/squadEntryGate.js", "backend/lib/humanTeamFilter.js"]) {
    assert.equal(classifyFile(f), null, `${f} er gameplay, ikke penge/sikkerhed`);
  }
});

test("classifyFile: review-/CI-konfiguration, hooks, lokale vagter, sikkerheds-vaerktoej og login er hoejrisiko (#6657 runde 8)", () => {
  for (const [f, reason] of Object.entries(ROUND8_SECURITY_MERGE)) assert.equal(classifyFile(f), reason, f);
  // Fixtures og tests til hookene, issue-templates og almindeligt vaerktoej er ikke vagter.
  for (const f of [".claude/hooks/test-fixtures/dangerous-env.json", ".claude/hooks/sanitize-secrets-tests/screenshot-data-uri-safe.json",
    ".github/ISSUE_TEMPLATE/bug.yml", ".github/PULL_REQUEST_TEMPLATE.md", "scripts/test-guard-commit-branch.sh", "scripts/test-sanitize-secrets.ps1",
    "scripts/test-block-dangerous-secret-commands.sh", "scripts/lib/patchNotesTransform.test.mjs", "scripts/wave-capacity.mjs",
    "scripts/discord/sweep-daily.mjs", "scripts/monday-numbers.mjs", "scripts/fairplay/3136-segmentation.sql", "frontend/src/pages/RacePage.jsx",
    "frontend/src/components/forum/ForumAuthorIdentity.jsx", "frontend/src/pages/LoginPage.test.jsx"]) {
    assert.equal(classifyFile(f), null, f);
  }
});

test("classifyFile: scripts der skriver til prod er hoejrisiko, men mere specifikke aarsager vinder (#6657 runde 8)", () => {
  for (const [f, reason] of Object.entries(ROUND8_PROD_SCRIPTS)) assert.equal(classifyFile(f), reason, f);
  assert.equal(classifyFile("backend/scripts/endSeasonS2.test.mjs"), null, "tests er stadig tests");
  assert.equal(classifyFile("scripts/ops/railway-log-watch.test.mjs"), null);
  assert.equal(classifyFile("scripts/report-orphan-worktree-dirs.mjs"), null, "worktree-rapport er ikke en prod-skrivning");
});

test("classifyFile: de nye regler er med i CodeRabbit-filtrene (spejlet fil for fil)", () => {
  const { covered } = coderabbitFilters();
  for (const f of [...Object.keys(ROUND8_MONEY), ...Object.keys(ROUND8_SECURITY_MERGE), ...Object.keys(ROUND8_PROD_SCRIPTS)]) {
    if (f.startsWith(".claude/hooks/test-fixtures/")) continue;
    assert.ok(covered(f), `.coderabbit.yaml mangler et filter for ${f}`);
  }
});

// Codex-fund paa #6657 (runde 8, P2): GitHub afkorter PR-fillisten ved 3000 filer. En liste der er kortere end
// PR'ens egen changed_files-taeller maa aldrig kunne give "lav risiko".
test("filesTruncated + classifyRisk: afkortet filliste er hoejrisiko (fail-closed)", () => {
  const docs = (n) => Array.from({ length: n }, (_, i) => `docs/note-${i}.md`);
  assert.equal(filesTruncated(docs(3000), 3001), true);
  assert.equal(filesTruncated(docs(3000), 3000), false, "komplet liste paa loftet er ikke afkortet");
  assert.equal(filesTruncated(docs(5), 5), false);
  assert.equal(filesTruncated(docs(5), null), false, "ukendt taeller, kort liste");
  assert.equal(filesTruncated(docs(3000), null), true, "ukendt taeller og liste paa API-loftet");
  assert.deepEqual(classifyRisk(docs(3), [], { changedFiles: 3 }), { level: "low", reasons: [] });
  const r = classifyRisk(docs(3000), [], { changedFiles: 3250 });
  assert.equal(r.level, "high");
  assert.match(r.reasons[0], /^filliste afkortet: GitHub gav 3000 af 3250 filer/);
  const unknown = classifyRisk(docs(3000));
  assert.equal(unknown.level, "high", "uden changed_files fejler loftet lukket");
  assert.match(unknown.reasons[0], /mindst 3000/);
});

test("evaluateGate: afkortet filliste kraever Claude-review (og lav risiko goer det ikke)", () => {
  const files = Array.from({ length: 3000 }, (_, i) => `docs/note-${i}.md`);
  const base = { author: "x", files, comments: [codexDone], headSha: HEAD };
  const truncated = evaluateGate({ ...base, changedFiles: 3400 });
  assert.equal(truncated.risk.level, "high");
  assert.equal(truncated.ok, false);
  assert.equal(truncated.claude.required, true);
  assert.equal(evaluateGate({ ...base, changedFiles: 3000 }).ok, true, "komplet liste af docs er lav risiko");
  const reviewed = evaluateGate({ ...base, changedFiles: 3400, comments: [codexDone, marker("clean")] });
  assert.equal(reviewed.ok, true, "med Claude-markoer for HEAD kan den afkortede PR passere");
});
