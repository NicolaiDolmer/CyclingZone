// Tests for scripts/plan-gap-audit.mjs (#8230): de rene funktioner bag
// plan-hul-tjekket og Stop-hookens advarsel, naar en commit fjerner et
// issue-nummer fra MASTERPLAN uden en anden plads.
//
// Tests: node --test scripts/plan-gap-audit.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  extractIssueNumbers,
  removedIssueNumbers,
  parseRemovals,
  placedIssues,
  findRemovedWithoutPlace,
  findOwnerAgreedWithoutPlace,
  findArchivedWithoutShipped,
  findStaleOffFlags,
  findDuplicateTarget,
  findBrokenDuplicateClosures,
  rankFindings,
  formatReport,
  formatCommitWarning,
  isBug,
} from "./plan-gap-audit.mjs";

const issue = (number, title, labels = [], lastComment = "") => [number, { number, title, labels, lastComment }];

test("extractIssueNumbers og removedIssueNumbers", () => {
  assert.deepEqual([...extractIssueNumbers("#7737 og #6110, ikke #1 eller 7741")].sort(), [6110, 7737]);
  assert.deepEqual(removedIssueNumbers("#100 #200 #300", "#200 ny #400"), [100, 300]);
});

test("parseRemovals: seneste fjernelse pr. nummer, filhoveder ignoreres", () => {
  const patch = [
    "@@COMMIT abc1234 2026-11-15T10:00:00+01:00",
    "diff --git a/docs/MASTERPLAN.md b/docs/MASTERPLAN.md",
    "--- a/docs/MASTERPLAN.md",
    "+++ b/docs/MASTERPLAN.md",
    "-- Motor: #6912, #7899",
    "+- Motor: #6912",
    "@@COMMIT def5678 2026-11-10T10:00:00+01:00",
    "--- a/docs/NOW.md",
    "+++ b/docs/NOW.md",
    "-Gammel linje #7899 og #8071",
  ].join("\n");
  const r = parseRemovals(patch);
  assert.equal(r.get(7899).sha, "abc1234");
  assert.equal(r.get(7899).date, "2026-11-15");
  assert.equal(r.get(7899).file, "docs/MASTERPLAN.md");
  assert.equal(r.get(8071).file, "docs/NOW.md");
  assert.ok(r.has(6912), "6912 stod paa en fjernet linje; filtreres foerst mod den nuvaerende plan");
});

test("placedIssues: masterplan, I_GANG og roadmap med horisont; ikke arkiveret eller uden horisont", () => {
  const placed = placedIssues({
    masterplan: "1. #100",
    iGang: "| #200 |",
    roadmapItems: [
      { issue_ref: 300, status: "planned", horizon: "next_week" },
      { issue_ref: 400, status: "archived", horizon: "next_week" },
      { issue_ref: 500, status: "planned", horizon: "unscheduled" },
      { issue_ref: 600, status: "planned", horizon: null },
    ],
  });
  assert.deepEqual([...placed].sort(), [100, 200, 300]);
});

test("fjernet uden anden plads: kun aabne issues uden plads kommer med", () => {
  const removals = new Map([
    [100, { sha: "a", date: "2026-11-15", file: "docs/MASTERPLAN.md", line: "x" }], // aaben, uden plads
    [200, { sha: "a", date: "2026-11-15", file: "docs/MASTERPLAN.md", line: "x" }], // aaben, i I_GANG
    [300, { sha: "a", date: "2026-11-15", file: "docs/MASTERPLAN.md", line: "x" }], // lukket (ikke i open)
    [8205, { sha: "a", date: "2026-11-15", file: "docs/MASTERPLAN.md", line: "x" }], // PR, ikke i open
  ]);
  const openIssues = new Map([issue(100, "a"), issue(200, "b")]);
  const out = findRemovedWithoutPlace({ removals, openIssues, placed: new Set([200]) });
  assert.deepEqual(out.map((f) => f.number), [100]);
  assert.equal(out[0].kind, "fjernet");
});

test("ejer-aftalt: ord i titel/seneste kommentar eller labels, ikke tilfaeldige ord", () => {
  const openIssues = new Map([
    issue(1, "Ejer-direktiv: noget"),
    issue(2, "Træning", [], "Ejerens valg 12/11: B"),
    issue(3, "Noget", ["needs-decision"]),
    issue(4, "Fejlrapport om holdejeren"), // "holdejeren": ingen venstre-graense, taeller ikke
    issue(5, "Aftalt med ejeren", [], ""),
    issue(6, "Ejer-direktiv men placeret"),
  ]);
  const out = findOwnerAgreedWithoutPlace({ openIssues, placed: new Set([6]) });
  assert.deepEqual(out.map((f) => f.number).sort(), [1, 2, 3, 5]);
});

test("arkiveret uden shipped: kun i perioden og uden shipped_at", () => {
  const out = findArchivedWithoutShipped({
    sinceIso: "2026-11-09T00:00:00.000Z",
    roadmapItems: [
      { id: "a", issue_ref: 5833, status: "archived", shipped_at: null, updated_at: "2026-11-12T10:00:00Z", title_da: "Sæsonskifte" },
      { id: "b", issue_ref: 1, status: "archived", shipped_at: "2026-11-12T10:00:00Z", updated_at: "2026-11-12T10:00:00Z" },
      { id: "c", issue_ref: 2, status: "archived", shipped_at: null, updated_at: "2026-10-01T10:00:00Z" },
      { id: "d", issue_ref: 3, status: "planned", shipped_at: null, updated_at: "2026-11-12T10:00:00Z" },
    ],
  });
  assert.deepEqual(out.map((f) => f.number), [5833]);
  assert.equal(out[0].kind, "arkiveret");
});

test("kontakt off over 14 dage, hvor registret siger building/dormant", () => {
  const now = "2026-11-16T12:00:00Z";
  const out = findStaleOffFlags({
    now,
    registry: [
      { id: "a", state: "building", flag: "old_off", epic: 100 },
      { id: "b", state: "dormant", flag: "new_off" },
      { id: "c", state: "building", flag: "old_beta" },
      { id: "d", state: "live", flag: "live_off" },
      { id: "e", state: "building" },
    ],
    config: [
      { key: "old_off", value: "off", updated_at: "2026-10-01T00:00:00Z" },
      { key: "new_off", value: "off", updated_at: "2026-11-10T00:00:00Z" },
      { key: "old_beta", value: "beta", updated_at: "2026-10-01T00:00:00Z" },
      { key: "live_off", value: "off", updated_at: "2026-10-01T00:00:00Z" },
    ],
  });
  assert.deepEqual(out.map((f) => f.key), ["flag:old_off"]);
  assert.equal(out[0].number, 100);
});

test("findDuplicateTarget: dublet, samlet i, duplicate of", () => {
  assert.equal(findDuplicateTarget("Lukket som dublet af #7713."), 7713);
  assert.equal(findDuplicateTarget("Samlet i #8030 (ejer)"), 8030);
  assert.equal(findDuplicateTarget("Duplicate of #5841"), 5841);
  assert.equal(findDuplicateTarget("Leveret i PR #8205"), null);
});

test("dublet-lukning: maal lukket uden levering eller aabent uden plads", () => {
  const closures = [
    { number: 6938, title: "Ejer-loefte", text: "Dublet af #7713" }, // maal lukket not planned
    { number: 3900, title: "Kalender", text: "Samlet i #5841" }, // maal aabent uden plads
    { number: 10, title: "ok", text: "Dublet af #11" }, // maal aabent med plads
    { number: 12, title: "ok", text: "Dublet af #13" }, // maal leveret
    { number: 14, title: "ingen maal", text: "Lukket, leveret" },
  ];
  const targetStates = new Map([
    [7713, { state: "CLOSED", stateReason: "NOT_PLANNED" }],
    [5841, { state: "OPEN" }],
    [11, { state: "OPEN" }],
    [13, { state: "CLOSED", stateReason: "COMPLETED" }],
  ]);
  const out = findBrokenDuplicateClosures({ closures, targetStates, placed: new Set([11]) });
  assert.deepEqual(out.map((f) => f.number), [6938, 3900]);
  assert.match(out[0].detail, /#7713 er lukket/);
  assert.match(out[1].detail, /#5841 er åbent uden plads/);
});

test("rankFindings: fejl > ejer-aftalt > stemmer > resten > claude:done; fund samles pr. issue", () => {
  const issues = new Map([
    issue(1, "Almindelig"),
    issue(2, "[bug] Noget i stykker"),
    issue(3, "Ejer-direktiv: X"),
    issue(4, "Med stemmer"),
    issue(5, "Faerdig", ["claude:done"]),
  ]);
  const ranked = rankFindings(
    [
      { number: 1, kind: "fjernet", detail: "a" },
      { number: 4, kind: "fjernet", detail: "b" },
      { number: 3, kind: "fjernet", detail: "c" },
      { number: 3, kind: "ejer-aftalt", detail: "d" },
      { number: 2, kind: "fjernet", detail: "e" },
      { number: 5, kind: "fjernet", detail: "f" },
      { number: null, key: "flag:x", kind: "kontakt-off", detail: "g" },
    ],
    { issues, votes: new Map([[4, 7]]) },
  );
  assert.deepEqual(ranked.map((m) => m.key), ["#2", "#3", "#4", "#1", "flag:x", "#5"]);
  assert.deepEqual(ranked[1].kinds, ["fjernet", "ejer-aftalt"]);
  assert.equal(ranked[2].votes, 7);
});

test("formatReport: hoejst 10 i toppen, claude:done aldrig i toppen, fuld liste har alt", () => {
  const ranked = [];
  for (let i = 0; i < 12; i++) ranked.push({ key: `#${i}`, number: i, kinds: ["fjernet"], details: ["d"], votes: 0, tier: 3, title: `t${i}` });
  ranked.push({ key: "#99", number: 99, kinds: ["fjernet"], details: ["d"], votes: 0, tier: 4, title: "done" });
  const md = formatReport({ ranked, meta: { date: "2026-11-16", period: "7 dage", notes: [] } });
  const top = md.split("## Fuld liste")[0];
  assert.equal((top.match(/^- \*\*/gm) || []).length, 10);
  assert.ok(!top.includes("#99"));
  assert.match(md, /## Fuld liste \(13\)/);
  assert.match(md, /### Færdig men åben/);
});

test("isBug: labels og titel-praefiks", () => {
  assert.ok(isBug({ title: "x", labels: ["type:bug"] }));
  assert.ok(isBug({ title: "[P2] Opfølgning", labels: [] }));
  assert.ok(!isBug({ title: "[motor] noget", labels: [] }));
});

test("formatCommitWarning: tom uden fund, ellers navngivne numre og reglen", () => {
  assert.equal(formatCommitWarning("abc", []), "");
  const msg = formatCommitWarning("abc", [7899, 8071]);
  assert.match(msg, /#7899, #8071/);
  assert.match(msg, /I_GANG/);
  assert.match(msg, /roadmappet med horisont/);
});

// Stop-hooken end-to-end: en commit der fjerner et nummer fra MASTERPLAN giver
// en decision:block-advarsel; nummeret staar i I_GANG -> ingen advarsel.
const HOOK = fileURLToPath(new URL("./check-now-md.sh", import.meta.url));
const NOW_S = 1_800_000_000;

function git(cwd, args, epoch) {
  const date = `@${epoch} +0000`;
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid",
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
    },
  });
  assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

function runHookFixture({ iGang }) {
  const dir = mkdtempSync(join(tmpdir(), "plan-gap-hook-"));
  try {
    git(dir, ["init", "-q"], NOW_S);
    git(dir, ["remote", "add", "origin", "https://github.com/example/repo.git"], NOW_S);
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "NOW.md"), "# NOW\n");
    writeFileSync(join(dir, "docs", "MASTERPLAN.md"), "1. #7899 og #6912\n");
    writeFileSync(join(dir, "docs", "I_GANG.md"), iGang);
    git(dir, ["add", "docs"], NOW_S - 600);
    git(dir, ["commit", "-q", "-m", "docs: plan"], NOW_S - 600);
    writeFileSync(join(dir, "docs", "MASTERPLAN.md"), "1. #6912\n");
    git(dir, ["add", "docs/MASTERPLAN.md"], NOW_S - 60);
    git(dir, ["commit", "-q", "-m", "docs(masterplan): trim"], NOW_S - 60);
    git(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"], NOW_S - 60);
    // Offline: ingen gh-kald, tilstanden er ukendt, saa hooken advarer hellere end at tie.
    const res = spawnSync("bash", [HOOK], {
      cwd: dir,
      encoding: "utf8",
      input: "",
      env: { ...process.env, PLAN_GAP_AUDIT_OFFLINE: "1", CHECK_NOW_MD_NOW_EPOCH: String(NOW_S) },
    });
    return res.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Stop-hook: fjernet MASTERPLAN-nummer uden anden plads giver decision:block", () => {
  const out = runHookFixture({ iGang: "# I gang\n" });
  assert.match(out, /fjernede #7899 fra MASTERPLAN/);
  assert.match(out, /"decision":"block"/);
});

test("Stop-hook: nummeret staar i I_GANG -> ingen plan-advarsel", () => {
  const out = runHookFixture({ iGang: "| #7899 |\n" });
  assert.doesNotMatch(out, /fra MASTERPLAN/);
});
