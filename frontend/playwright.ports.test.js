import test from "node:test";
import assert from "node:assert/strict";

import {
  MAIN_PORT,
  WORKTREE_PORT_MIN,
  WORKTREE_PORT_MAX,
  derivePort,
  formatWorktreeId,
  checkWorktreeIdentity,
} from "./playwright.ports.js";

const MAIN_ROOT = "C:\\Dev\\CyclingZone";
const WORKTREE_A = "C:\\Dev\\CyclingZone\\.claude\\worktrees\\agent-alpha";
const WORKTREE_B = "C:\\Dev\\CyclingZone\\.claude\\worktrees\\agent-bravo";
const WORKTREE_C = "C:\\Dev\\CyclingZone-worktrees\\feat-min-feature";

test("PW_PORT env-override vinder over alt andet", () => {
  const port = derivePort({ envPort: "4555", repoRoot: WORKTREE_A, isLinkedWorktree: true });
  assert.equal(port, 4555);
});

test("ugyldig PW_PORT fejler højlydt i stedet for stille fallback", () => {
  assert.throws(
    () => derivePort({ envPort: "abc", repoRoot: MAIN_ROOT, isLinkedWorktree: false }),
    /PW_PORT/,
  );
  assert.throws(
    () => derivePort({ envPort: "80", repoRoot: MAIN_ROOT, isLinkedWorktree: false }),
    /PW_PORT/,
  );
  assert.throws(
    () => derivePort({ envPort: "70000", repoRoot: MAIN_ROOT, isLinkedWorktree: false }),
    /PW_PORT/,
  );
});

test("main-checkout beholder den historiske port 4173 (CI + snapshots uændret)", () => {
  assert.equal(MAIN_PORT, 4173);
  const port = derivePort({ envPort: undefined, repoRoot: MAIN_ROOT, isLinkedWorktree: false });
  assert.equal(port, MAIN_PORT);
});

test("linked worktree får port i worktree-rangen, aldrig 4173", () => {
  for (const root of [WORKTREE_A, WORKTREE_B, WORKTREE_C]) {
    const port = derivePort({ envPort: undefined, repoRoot: root, isLinkedWorktree: true });
    assert.ok(
      port >= WORKTREE_PORT_MIN && port <= WORKTREE_PORT_MAX,
      `${root} → ${port} udenfor [${WORKTREE_PORT_MIN}, ${WORKTREE_PORT_MAX}]`,
    );
    assert.notEqual(port, MAIN_PORT);
  }
});

test("port-derivation er deterministisk for samme worktree-sti", () => {
  const a1 = derivePort({ envPort: undefined, repoRoot: WORKTREE_A, isLinkedWorktree: true });
  const a2 = derivePort({ envPort: undefined, repoRoot: WORKTREE_A, isLinkedWorktree: true });
  assert.equal(a1, a2);
});

test("sti-normalisering: casing og slash-retning ændrer ikke porten (win32)", () => {
  const canonical = derivePort({ envPort: undefined, repoRoot: WORKTREE_A, isLinkedWorktree: true });
  const variants = [
    "c:/dev/cyclingzone/.claude/worktrees/agent-alpha",
    "C:/Dev/CyclingZone/.claude/worktrees/AGENT-ALPHA/",
    "c:\\DEV\\cyclingzone\\.claude\\worktrees\\Agent-Alpha",
  ];
  for (const variant of variants) {
    const port = derivePort({ envPort: undefined, repoRoot: variant, isLinkedWorktree: true });
    assert.equal(port, canonical, `variant ${variant} gav ${port}, forventede ${canonical}`);
  }
});

test("forskellige worktree-stier spredes til forskellige porte", () => {
  const a = derivePort({ envPort: undefined, repoRoot: WORKTREE_A, isLinkedWorktree: true });
  const b = derivePort({ envPort: undefined, repoRoot: WORKTREE_B, isLinkedWorktree: true });
  const c = derivePort({ envPort: undefined, repoRoot: WORKTREE_C, isLinkedWorktree: true });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(b, c);
});

test("identity-guard: server fra samme worktree accepteres (casing/slash-ufølsom)", () => {
  const body = formatWorktreeId("C:\\Dev\\CyclingZone\\frontend");
  const verdict = checkWorktreeIdentity(body, "c:/dev/cyclingzone/frontend");
  assert.deepEqual(verdict, { ok: true });
});

test("identity-guard: server fra ANDEN worktree afvises med dens sti i verdict", () => {
  const body = formatWorktreeId(`${WORKTREE_B}\\frontend`);
  const verdict = checkWorktreeIdentity(body, `${WORKTREE_A}\\frontend`);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "wrong-worktree");
  assert.match(verdict.serverRoot, /agent-bravo/);
});

test("identity-guard: ukendt server uden id-endpoint afvises (fx stale pre-fix vite, SPA-fallback-HTML)", () => {
  for (const body of ["<!doctype html><html></html>", "", null, undefined]) {
    const verdict = checkWorktreeIdentity(body, `${WORKTREE_A}\\frontend`);
    assert.equal(verdict.ok, false, `body ${JSON.stringify(body)} burde afvises`);
    assert.equal(verdict.reason, "foreign-server");
  }
});
