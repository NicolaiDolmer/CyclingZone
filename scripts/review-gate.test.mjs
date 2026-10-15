// node --test scripts/review-gate.test.mjs  (#6654)
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFile,
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
  CODEX_SUMMARY_MARKER,
} from "./review-gate.mjs";

const CODEX = "chatgpt-codex-connector[bot]";

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
const marker = (verdict, at = "2026-10-15T11:00:00Z", association = "OWNER") =>
  ({ author: "owner", association, body: `<!-- claude-review: ${verdict} sha=512c930 -->\n**Claude-review**`, at });

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

test("classifyFile: UI, docs, scripts og tests er lav risiko", () => {
  assert.equal(classifyFile("frontend/src/pages/RacePage.jsx"), null);
  assert.equal(classifyFile("docs/GITHUB_WORKFLOW.md"), null);
  assert.equal(classifyFile("scripts/review-gate.mjs"), null);
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

// ── Codex ──

test("parseCodexSummary: completed / pending / failed / ukendt", () => {
  assert.deepEqual(parseCodexSummary(codexDone.body), { state: "completed", commit: "b1f0c58" });
  assert.equal(parseCodexSummary(summary("⏳ **In progress**")).state, "pending");
  assert.equal(parseCodexSummary(summary("❌ **Failed**")).state, "failed");
  assert.equal(parseCodexSummary("ingen markoer | x | y |").state, "unknown");
});

test("evaluateCodex: gennemfoert uden traade -> ok", () => {
  const r = evaluateCodex({ comments: [codexDone] });
  assert.equal(r.ok, true);
  assert.match(r.detail, /b1f0c58/);
});

test("evaluateCodex: uloeste Codex-traade blokerer, loeste og andres traade goer ikke", () => {
  const threads = [
    { author: "chatgpt-codex-connector", isResolved: false },
    { author: "chatgpt-codex-connector", isResolved: true },
    { author: "coderabbitai", isResolved: false },
  ];
  const r = evaluateCodex({ comments: [codexDone], threads });
  assert.equal(r.ok, false);
  assert.equal(r.unresolved, 1);
  assert.match(r.detail, /1 uloest/);
  assert.equal(evaluateCodex({ comments: [codexDone], threads: threads.slice(1) }).ok, true, "CodeRabbit-traade er aldrig et krav");
});

test("evaluateCodex: intet review / koerer / fejlet -> ikke ok med handlingsanvisning", () => {
  assert.match(evaluateCodex({}).detail, /@codex review/);
  assert.equal(evaluateCodex({ comments: [{ author: CODEX, body: summary("In progress") }] }).state, "pending");
  assert.match(evaluateCodex({ comments: [{ author: CODEX, body: summary("Failed") }] }).detail, /fejlede/);
});

test("evaluateCodex: Codex-review uden summary eller 👍-reaktion taeller som gennemfoert", () => {
  assert.equal(evaluateCodex({ reviews: [{ author: CODEX, body: "### 💡 Codex Review" }] }).ok, true);
  assert.equal(evaluateCodex({ reactions: [{ author: CODEX, content: "+1" }] }).ok, true);
  assert.equal(evaluateCodex({ reactions: [{ author: CODEX, content: "eyes" }] }).ok, false);
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
  assert.deepEqual(findClaudeVerdict(items), { verdict: "clean", sha: "512c930", at: "2026-10-15T12:00:00Z" });
  assert.equal(findClaudeVerdict([{ association: "OWNER", body: "claude-review: clean (ingen markoer)" }]), null);
});

test("evaluateClaude: kun paakraevet ved hoejrisiko; blocking og manglende blokerer", () => {
  const low = { level: "low", reasons: [] };
  const high = { level: "high", reasons: ["motor: x"] };
  assert.equal(evaluateClaude([], low).ok, true);
  assert.equal(evaluateClaude([], high).ok, false);
  assert.match(evaluateClaude([], high).detail, /post-claude-review/);
  assert.equal(evaluateClaude([marker("blocking")], high).ok, false);
  assert.equal(evaluateClaude([marker("notes")], high).ok, true);
  assert.equal(evaluateClaude([marker("clean")], high).ok, true);
});

// ── Gaten samlet ──

test("evaluateGate: lav risiko kraever kun Codex", () => {
  const r = evaluateGate({ author: "NicolaiDolmer", files: ["docs/a.md"], comments: [codexDone] });
  assert.equal(r.ok, true);
  assert.equal(r.claude.required, false);
});

test("evaluateGate: hoejrisiko kraever Codex OG Claude", () => {
  const base = { author: "NicolaiDolmer", files: ["backend/lib/engine/v4/x.ts"] };
  assert.equal(evaluateGate({ ...base, comments: [codexDone] }).ok, false, "Claude mangler");
  assert.equal(evaluateGate({ ...base, comments: [marker("clean")] }).ok, false, "Codex mangler");
  assert.equal(evaluateGate({ ...base, comments: [codexDone, marker("clean")] }).ok, true);
  assert.equal(evaluateGate({ ...base, comments: [codexDone, marker("blocking")] }).ok, false);
});

test("evaluateGate: CodeRabbit er aldrig et krav (ingen CodeRabbit-data -> stadig groen)", () => {
  const r = evaluateGate({ author: "x", files: ["frontend/src/x.jsx"], comments: [codexDone], threads: [{ author: "coderabbitai", isResolved: false }] });
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
