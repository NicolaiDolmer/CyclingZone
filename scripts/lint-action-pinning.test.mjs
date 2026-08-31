// lint-action-pinning.test.mjs (#4467)
//
// Beviser at guarden BIDER. En guard der kun er groen beviser ingenting, jf.
// .claude/learnings/2026-08-28-groent-flueben-der-intet-verificerede.md og de fire
// forekomster af samme klasse i natboelgen 30-31/8.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findUnpinnedActions, onBlockOf } from "./lint-action-pinning.mjs";

const SHA = "5afcf98fcd03f1c2f92c3c83f58ae24323cc57fd";

function withWorkflows(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "action-pinning-"));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("tredjeparts-action paa et flytbart tag flages", () => {
  const found = withWorkflows(
    { "a.yml": "on:\n  push:\njobs:\n  x:\n    steps:\n      - uses: treosh/lighthouse-ci-action@v12\n" },
    findUnpinnedActions
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, "third-party");
  assert.equal(found[0].action, "treosh/lighthouse-ci-action");
});

test("tredjeparts-action pinnet til SHA passerer", () => {
  const found = withWorkflows(
    { "a.yml": `on:\n  push:\njobs:\n  x:\n    steps:\n      - uses: treosh/lighthouse-ci-action@${SHA} # v12\n` },
    findUnpinnedActions
  );
  assert.deepEqual(found, []);
});

test("GitHubs egen action paa et tag passerer i en almindelig workflow", () => {
  const found = withWorkflows(
    { "a.yml": "on:\n  pull_request:\njobs:\n  x:\n    steps:\n      - uses: actions/checkout@v7\n" },
    findUnpinnedActions
  );
  assert.deepEqual(found, []);
});

test("REGRESSION #4467: GitHubs egen action paa et tag flages i en pull_request_target-workflow", () => {
  // Praecis den fil PR #4467 afsloerede: pull_request_target + secrets.PROJECTS_PAT,
  // action pinnet til v2.0.0. Trigges af enhver fremmed.
  const found = withWorkflows(
    {
      "add-to-project.yml":
        "on:\n  pull_request_target:\n    types: [opened]\njobs:\n  x:\n    steps:\n" +
        "      - uses: actions/add-to-project@v2.0.0\n        with:\n          github-token: ${{ secrets.PROJECTS_PAT }}\n",
    },
    findUnpinnedActions
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, "secret-bearing-trigger");
  assert.equal(found[0].action, "actions/add-to-project");
});

test("issue_comment taeller ogsaa som secret-baerende trigger", () => {
  const found = withWorkflows(
    { "c.yml": "on:\n  issue_comment:\n    types: [created]\njobs:\n  x:\n    steps:\n      - uses: actions/github-script@v9\n" },
    findUnpinnedActions
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, "secret-bearing-trigger");
});

test("lokale og docker-actions ignoreres", () => {
  const found = withWorkflows(
    { "a.yml": "on:\n  push:\njobs:\n  x:\n    steps:\n      - uses: ./.github/actions/local\n      - uses: docker://alpine:3\n" },
    findUnpinnedActions
  );
  assert.deepEqual(found, []);
});

test("under-sti i en tredjeparts-action fanges ogsaa", () => {
  const found = withWorkflows(
    { "a.yml": "on:\n  push:\njobs:\n  x:\n    steps:\n      - uses: some-org/some-action/sub/path@v1\n" },
    findUnpinnedActions
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].action, "some-org/some-action/sub/path");
});

test("REGRESSION: `permissions: issues: write` er IKKE en trigger", () => {
  // Foerste udgave af guarden soegte i hele filen efter `issues:` og matchede derfor
  // permissions-blokken. Det gav 56 falske fund paa foerste koersel mod repoet, og en
  // guard der raaber 56 gange om ingenting bliver slaaet fra i loebet af en uge.
  const found = withWorkflows(
    {
      "s.yml":
        "on:\n  schedule:\n    - cron: '0 5 * * *'\npermissions:\n  contents: read\n  issues: write\n" +
        "jobs:\n  x:\n    steps:\n      - uses: actions/checkout@v7\n",
    },
    findUnpinnedActions
  );
  assert.deepEqual(found, []);
});

test("on-blokken stopper ved naeste noegle i kolonne 0", () => {
  const text = "name: x\non:\n  schedule:\n    - cron: '0 5 * * *'\npermissions:\n  issues: write\n";
  const block = onBlockOf(text);
  assert.ok(block.includes("schedule"));
  assert.ok(!block.includes("issues"));
});

test("repoets EGNE workflows er rene", () => {
  // Den test der faktisk holder repoet aerligt over tid.
  assert.deepEqual(findUnpinnedActions(".github/workflows"), []);
});
