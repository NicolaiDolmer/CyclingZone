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
  pickGateRun,
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
});

test("classifyFile: UI, docs, scripts og tests er lav risiko", () => {
  assert.equal(classifyFile("frontend/src/pages/RacePage.jsx"), null);
  assert.equal(classifyFile("docs/GITHUB_WORKFLOW.md"), null);
  assert.equal(classifyFile("scripts/review-gate.mjs"), null);
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
    ...Object.keys(CORE_MOTOR_MONEY),
  ];
  for (const f of high) {
    assert.ok(classifyFile(f), `klassifikatoren: ${f} er hoejrisiko`);
    assert.ok(covered(f), `.coderabbit.yaml mangler et filter for ${f}`);
  }
  for (const f of ["frontend/src/pages/RacePage.jsx", "docs/GITHUB_WORKFLOW.md", "scripts/review-gate.mjs", "backend/lib/abilityRegistry.js"]) {
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

test("evaluateCodex: Codex-review for HEAD uden summary, eller 👍 efter HEAD-commit'et, taeller som gennemfoert", () => {
  assert.equal(evaluateCodex({ reviews: [{ author: CODEX, body: "### 💡 Codex Review", commit: HEAD }], headSha: HEAD }).ok, true);
  assert.equal(evaluateCodex({ reviews: [{ author: CODEX, body: "**Reviewed commit:** `b1f0c58e2d`" }], headSha: HEAD }).ok, true);
  const committed = "2026-10-15T10:00:00Z";
  assert.equal(evaluateCodex({ reactions: [{ author: CODEX, content: "+1", at: "2026-10-15T10:05:00Z" }], headSha: HEAD, headCommittedAt: committed }).ok, true);
  assert.equal(evaluateCodex({ reactions: [{ author: CODEX, content: "eyes", at: "2026-10-15T10:05:00Z" }], headSha: HEAD, headCommittedAt: committed }).ok, false);
});

test("evaluateCodex: foraeldet bevis fra et aeldre commit -> roed (#6657 review)", () => {
  const stale = { ...codexDone, body: summary("✅ **Completed**", OLD.slice(0, 7)) };
  const r = evaluateCodex({ comments: [stale], headSha: HEAD });
  assert.equal(r.ok, false);
  assert.equal(r.state, "stale");
  assert.match(r.detail, /512c930.*@codex review/);
  assert.equal(evaluateCodex({ reviews: [{ author: CODEX, body: "x", commit: OLD }], headSha: HEAD }).ok, false, "review paa gammelt commit");
  assert.equal(evaluateCodex({ reactions: [{ author: CODEX, content: "+1", at: "2026-10-15T09:00:00Z" }], headSha: HEAD, headCommittedAt: "2026-10-15T10:00:00Z" }).ok, false,
    "👍 afgivet foer HEAD blev committet");
  assert.equal(evaluateCodex({ reactions: [{ author: CODEX, content: "+1", at: "2026-10-15T11:00:00Z" }], headSha: HEAD }).ok, false,
    "👍 uden kendt HEAD-tidspunkt er fail-closed");
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
  assert.equal(pickGateRun(runs, 42, HEAD).id, 2, "merge-SHA i run.head_sha, PR-head i pull_requests");
  assert.equal(pickGateRun(runs.slice(0, 1), 42, HEAD).id, 1, "ingen koersel for HEAD -> seneste for PR'en");
  assert.equal(pickGateRun(runs, 43, HEAD), null, "andre PR'ers koersler bruges aldrig");
  assert.equal(pickGateRun([{ id: 5, created_at: "t", head_sha: HEAD, pull_requests: [{ number: 42 }] }], 42, HEAD).id, 5);
  assert.equal(pickGateRun([], 42, HEAD), null);
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
