// Selvtest for scripts/generate-status-board.mjs (#5674).
//
// Ingen af testene rammer netvaerket: GitHub-kald ligger bag et io-parameter
// (samme moenster som scripts/wave-policy.mjs), saa `generate()` tager
// fixtures ind i stedet for at kalde `gh`.

import assert from "node:assert/strict";
import test from "node:test";

import {
  ageDays,
  approxTokens,
  buildSections,
  capList,
  classifyMergeState,
  extractIssueRefs,
  generate,
  hasOwnerGoSignal,
  priorityRank,
  render,
  renderWithinBudget,
  TOKEN_BUDGET_FAIL,
  truncateTitle,
} from "./generate-status-board.mjs";

const NOW = new Date("2026-09-26T12:00:00Z").getTime();

test("ageDays regner heltal dage og fejler aldrig negativt", () => {
  assert.equal(ageDays("2026-09-16T12:00:00Z", NOW), 10);
  assert.equal(ageDays("2026-09-26T11:00:00Z", NOW), 0);
  assert.equal(ageDays("2026-09-27T00:00:00Z", NOW), 0); // fremtid -> 0, ikke negativ
  assert.equal(ageDays("ikke-en-dato", NOW), null);
});

test("truncateTitle respekterer 90-tegns-loftet og laegger ellipse til", () => {
  const short = "Kort titel";
  assert.equal(truncateTitle(short), short);
  const long = "x".repeat(120);
  const truncated = truncateTitle(long, 90);
  assert.equal(truncated.length, 90);
  assert.ok(truncated.endsWith("…"));
});

test("extractIssueRefs finder #N i titel og body, samt tal i branch-navn", () => {
  const refs = extractIssueRefs({
    title: "fix(x): ret noget (#111)",
    body: "Refs #222 og se ogsaa #333.",
    headRefName: "chore/444-status-board-generator",
  });
  assert.deepEqual([...refs].sort((a, b) => a - b), [111, 222, 333, 444]);
});

test("extractIssueRefs er robust mod manglende felter", () => {
  assert.deepEqual([...extractIssueRefs({})], []);
  assert.deepEqual([...extractIssueRefs({ title: null, body: undefined, headRefName: "main" })], []);
});

test("classifyMergeState: DIRTY (merge-konflikt) slaar altid igennem, uanset CI", () => {
  assert.equal(classifyMergeState({ mergeStateStatus: "DIRTY", statusCheckRollup: [{ conclusion: "SUCCESS" }] }), "dirty");
  assert.equal(classifyMergeState({ mergeStateStatus: "dirty" }), "dirty"); // case-insensitiv
});

test("classifyMergeState: BLOCKED med 0 fejlede checks er groen, IKKE roed (#5281 m.fl.)", () => {
  assert.equal(
    classifyMergeState({ mergeStateStatus: "BLOCKED", statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "NEUTRAL" }] }),
    "green",
  );
  assert.equal(classifyMergeState({ mergeStateStatus: "CLEAN", statusCheckRollup: [] }), "green");
});

test("classifyMergeState: en fejlet/error check (conclusion ELLER state) er roed, ogsaa naar mergeStateStatus ikke er DIRTY", () => {
  assert.equal(classifyMergeState({ mergeStateStatus: "BLOCKED", statusCheckRollup: [{ conclusion: "FAILURE" }] }), "red");
  assert.equal(classifyMergeState({ mergeStateStatus: "CLEAN", statusCheckRollup: [{ conclusion: "ERROR" }] }), "red");
  assert.equal(classifyMergeState({ mergeStateStatus: "CLEAN", statusCheckRollup: [{ state: "FAILURE" }] }), "red");
  assert.equal(classifyMergeState({ mergeStateStatus: "UNKNOWN", statusCheckRollup: undefined }), "green");
});

test("hasOwnerGoSignal finder 'ejer-go' i label ELLER body, case-insensitivt", () => {
  assert.equal(hasOwnerGoSignal({ labels: [{ name: "ejer-go" }], body: "" }), true);
  assert.equal(hasOwnerGoSignal({ labels: [], body: "Kraever EJER-GO foer merge." }), true);
  assert.equal(hasOwnerGoSignal({ labels: [{ name: "docs-only" }], body: "Ingen spillertekst." }), false);
  assert.equal(hasOwnerGoSignal({}), false);
});

test("hasOwnerGoSignal matcher IKKE substrings som 'ejer-godkendelse'/'ejer-godkendt'", () => {
  assert.equal(hasOwnerGoSignal({ labels: [], body: "Efter ejer-godkendelse kan vi merge." }), false);
  assert.equal(hasOwnerGoSignal({ labels: [{ name: "ejer-godkendt" }], body: "" }), false);
  assert.equal(hasOwnerGoSignal({ labels: [], body: "Venter paa ejer-go foer merge." }), true);
});

test("priorityRank sorterer high < med < low < ingen", () => {
  assert.equal(priorityRank([{ name: "priority:high" }]), 0);
  assert.equal(priorityRank([{ name: "priority:med" }]), 1);
  assert.equal(priorityRank([{ name: "priority:low" }]), 2);
  assert.equal(priorityRank([{ name: "type:bug" }]), 3);
  assert.equal(priorityRank(undefined), 3);
});

test("capList klipper til max og skriver noejagtigt antal resterende", () => {
  const rows = ["a", "b", "c", "d", "e"];
  assert.deepEqual(capList(rows, 10), rows);
  assert.deepEqual(capList(rows, 3), ["a", "b", "c", "- …og 2 mere"]);
  assert.deepEqual(capList(rows, 0), ["- …og 5 mere"]);
});

function pr(overrides = {}) {
  return {
    number: 1,
    title: "Test PR",
    isDraft: false,
    labels: [],
    mergeStateStatus: "BLOCKED",
    headRefName: "fix/1-test",
    updatedAt: "2026-09-20T00:00:00Z",
    body: "",
    ...overrides,
  };
}

function issue(overrides = {}) {
  return {
    number: 100,
    title: "Test issue",
    labels: [],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

test("buildSections: claude:todo med en refereret PR forsvinder fra 'ikke bygget'", () => {
  const sections = buildSections({
    registryEntries: [],
    prs: [pr({ number: 5, title: "fix: noget (#100)" })],
    issuesByLabel: {
      "claude:todo": [issue({ number: 100 }), issue({ number: 101, title: "Uden PR endnu" })],
      "claude:done": [],
      "needs-decision": [],
      "needs-design": [],
    },
    now: NOW,
  });
  assert.equal(sections.notBuiltRows.length, 1);
  assert.ok(sections.notBuiltRows[0].includes("#101"));
});

test("buildSections: draft og roed ikke-draft havner i sektion 3, groen ikke", () => {
  const sections = buildSections({
    registryEntries: [],
    prs: [
      pr({ number: 1, isDraft: true }),
      pr({ number: 2, isDraft: false, statusCheckRollup: [{ conclusion: "FAILURE" }] }),
      pr({ number: 3, isDraft: false, mergeStateStatus: "CLEAN" }),
    ],
    issuesByLabel: { "claude:todo": [], "claude:done": [], "needs-decision": [], "needs-design": [] },
    now: NOW,
  });
  assert.equal(sections.draftRows.length, 1);
  assert.ok(sections.draftRows[0].includes("#1"));
  assert.equal(sections.redRows.length, 1);
  assert.ok(sections.redRows[0].includes("#2"));
  // sektion 1 (queueRows) daekker alle ikke-draft PR'er uanset tilstand
  assert.equal(sections.queueRows.length, 2);
});

test("buildSections: 'ejer-go' PR'er samles i decisions-sektionen", () => {
  const sections = buildSections({
    registryEntries: [],
    prs: [pr({ number: 9, body: "Kraever ejer-go." }), pr({ number: 10 })],
    issuesByLabel: {
      "claude:todo": [],
      "claude:done": [],
      "needs-decision": [issue({ number: 200 })],
      "needs-design": [],
    },
    now: NOW,
  });
  assert.equal(sections.ownerGoPrRows.length, 1);
  assert.ok(sections.ownerGoPrRows[0].includes("#9"));
  assert.equal(sections.decisionIssueRows.length, 1);
  assert.ok(sections.decisionIssueRows[0].includes("#200"));
});

test("buildSections: needs-decision og needs-design deduplikeres paa issue-nummer", () => {
  const sections = buildSections({
    registryEntries: [],
    prs: [],
    issuesByLabel: {
      "claude:todo": [],
      "claude:done": [],
      "needs-decision": [issue({ number: 300 })],
      "needs-design": [issue({ number: 300 })],
    },
    now: NOW,
  });
  assert.equal(sections.decisionIssueRows.length, 1);
});

test("buildSections: claude:done aabne issues havner i sektion 5", () => {
  const sections = buildSections({
    registryEntries: [],
    prs: [],
    issuesByLabel: {
      "claude:todo": [],
      "claude:done": [issue({ number: 400 })],
      "needs-decision": [],
      "needs-design": [],
    },
    now: NOW,
  });
  assert.equal(sections.doneRows.length, 1);
  assert.ok(sections.doneRows[0].includes("#400"));
});

test("buildSections: registry-summary opsummerer state-fordeling", () => {
  const sections = buildSections({
    registryEntries: [
      { id: "a", area: "market", state: "live" },
      { id: "b", area: "market", state: "building" },
    ],
    prs: [],
    issuesByLabel: { "claude:todo": [], "claude:done": [], "needs-decision": [], "needs-design": [] },
    now: NOW,
  });
  assert.match(sections.registrySummary, /2 features/);
  assert.match(sections.registrySummary, /live 1/);
  assert.match(sections.registrySummary, /building 1/);
});

test("buildSections: tomt registry giver en tydelig advarsels-summary, ikke et krak", () => {
  const sections = buildSections({
    registryEntries: [],
    prs: [],
    issuesByLabel: { "claude:todo": [], "claude:done": [], "needs-decision": [], "needs-design": [] },
    now: NOW,
  });
  assert.match(sections.registrySummary, /kunne ikke laeses/);
});

test("render: 'ingen' vises for en tom sektion i stedet for en tom liste", () => {
  const sections = buildSections({
    registryEntries: [],
    prs: [],
    issuesByLabel: { "claude:todo": [], "claude:done": [], "needs-decision": [], "needs-design": [] },
    now: NOW,
  });
  const markdown = render(sections, 15);
  assert.match(markdown, /- ingen/);
  assert.match(markdown, /^# STATUS BOARD/);
  assert.match(markdown, /GENERERET FIL/);
});

test("renderWithinBudget skrumper listerne til filen er under TOKEN_BUDGET_FAIL", () => {
  const manyIssues = Array.from({ length: 400 }, (_, i) =>
    issue({ number: 1000 + i, title: `Backlog-post nummer ${i} med en lidt laengere titel for at fylde tokens` }),
  );
  const sections = buildSections({
    registryEntries: [],
    prs: [],
    issuesByLabel: { "claude:todo": manyIssues, "claude:done": [], "needs-decision": [], "needs-design": [] },
    now: NOW,
  });
  const markdown = renderWithinBudget(sections);
  assert.ok(approxTokens(markdown) <= TOKEN_BUDGET_FAIL, `forventede <= ${TOKEN_BUDGET_FAIL} tokens, fik ${approxTokens(markdown)}`);
  assert.match(markdown, /…og \d+ mere/);
});

test("generate(): io-fixture uden netvaerk producerer gyldig markdown inden for budget", async () => {
  const io = {
    getOpenPrs: async () => [pr({ number: 1, mergeStateStatus: "CLEAN" }), pr({ number: 2, isDraft: true })],
    getIssuesByLabel: async (label) => {
      if (label === "claude:todo") return [issue({ number: 50, title: "Ubygget post" })];
      if (label === "claude:done") return [issue({ number: 60, title: "Faerdig men aaben" })];
      return [];
    },
  };
  const markdown = await generate(io, NOW);
  assert.ok(approxTokens(markdown) <= TOKEN_BUDGET_FAIL);
  assert.match(markdown, /#1 /);
  assert.match(markdown, /#50 Ubygget post/);
  assert.match(markdown, /#60 Faerdig men aaben/);
});

test("generate(): et io-svar der ikke er en liste blokerer i stedet for at skrive stoej", async () => {
  const badPrs = { getOpenPrs: async () => ({ not: "an array" }), getIssuesByLabel: async () => [] };
  await assert.rejects(generate(badPrs, NOW), /gh pr list/);

  const badIssues = {
    getOpenPrs: async () => [],
    getIssuesByLabel: async () => ({ not: "an array" }),
  };
  await assert.rejects(generate(badIssues, NOW), /gh issue list/);
});
