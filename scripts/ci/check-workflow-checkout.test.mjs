// check-workflow-checkout.test.mjs (#5441)
//
// Beviser at guarden BIDER. En guard der kun er grøn beviser ingenting, jf.
// .claude/learnings/2026-08-28-groent-flueben-der-intet-verificerede.md.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWorkflowCheckouts, findCheckoutSteps } from "./check-workflow-checkout.mjs";

function withWorkflows(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "workflow-checkout-"));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("checkout uden with:-blok overhovedet flages", () => {
  const found = withWorkflows(
    { "a.yml": "jobs:\n  x:\n    steps:\n      - name: Checkout\n        uses: actions/checkout@v7\n\n      - run: echo hi\n" },
    checkWorkflowCheckouts
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, "missing-persist-credentials");
});

test("checkout med with:-blok men uden persist-credentials flages", () => {
  const found = withWorkflows(
    { "a.yml": "jobs:\n  x:\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          fetch-depth: 0\n" },
    checkWorkflowCheckouts
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, "missing-persist-credentials");
});

test("checkout med persist-credentials: false passerer", () => {
  const found = withWorkflows(
    { "a.yml": "jobs:\n  x:\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          persist-credentials: false\n" },
    checkWorkflowCheckouts
  );
  assert.deepEqual(found, []);
});

test("checkout med persist-credentials: false OG andre with-nøgler passerer", () => {
  const found = withWorkflows(
    {
      "a.yml":
        "jobs:\n  x:\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          persist-credentials: false\n          fetch-depth: 0\n",
    },
    checkWorkflowCheckouts
  );
  assert.deepEqual(found, []);
});

test("persist-credentials: true i en ikke-allowlistet fil flages", () => {
  const found = withWorkflows(
    { "random-job.yml": "jobs:\n  x:\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          persist-credentials: true\n" },
    checkWorkflowCheckouts
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, "unallowed-persist-credentials-true");
});

test("persist-credentials: true i claude.yml (allowlistet) passerer", () => {
  const found = withWorkflows(
    { "claude.yml": "jobs:\n  x:\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          persist-credentials: true\n" },
    checkWorkflowCheckouts
  );
  assert.deepEqual(found, []);
});

test("flere checkout-steps i samme fil evalueres uafhaengigt", () => {
  const found = withWorkflows(
    {
      "multi.yml":
        "jobs:\n" +
        "  a:\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          persist-credentials: false\n" +
        "  b:\n    steps:\n      - uses: actions/checkout@v7\n",
    },
    checkWorkflowCheckouts
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, "missing-persist-credentials");
});

test("REGRESSION: dash + uses paa samme linje ('- uses: ...') parses korrekt", () => {
  // Formatet stale-branches-report.yml/priority-hygiene.yml brugte allerede foer #5441:
  // dash og uses: paa samme linje, ikke split over 'name:' + 'uses:'.
  const found = withWorkflows(
    { "a.yml": "jobs:\n  x:\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          persist-credentials: false\n" },
    checkWorkflowCheckouts
  );
  assert.deepEqual(found, []);
});

test("findCheckoutSteps rapporterer korrekt linjenummer", () => {
  const text = "jobs:\n  x:\n    steps:\n      - name: Checkout\n        uses: actions/checkout@v7\n";
  const steps = findCheckoutSteps(text);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].line, 5);
  assert.equal(steps[0].persistCredentials, null);
});

test("repoets EGNE workflows er rene", () => {
  // Den test der faktisk holder repoet aerligt over tid.
  assert.deepEqual(checkWorkflowCheckouts(".github/workflows"), []);
});
