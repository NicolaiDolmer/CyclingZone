import test from "node:test";
import assert from "node:assert/strict";

import {
  acquireReloadBlock,
  getReloadBlockReasons,
  isReloadAllowed,
  onReloadAllowed,
  RELOAD_BLOCK_REASONS,
  __resetReloadGateForTests,
} from "./reloadGate.js";

test.beforeEach(() => __resetReloadGateForTests());

test("uden blokeringer er automatisk reload tilladt", () => {
  assert.equal(isReloadAllowed(), true);
  assert.deepEqual(getReloadBlockReasons(), []);
});

test("en blokering stopper automatisk reload indtil den slippes", () => {
  const release = acquireReloadBlock(RELOAD_BLOCK_REASONS.DIRTY);
  assert.equal(isReloadAllowed(), false);
  assert.deepEqual(getReloadBlockReasons(), ["dirty"]);
  release();
  assert.equal(isReloadAllowed(), true);
});

test("flere flader kan blokere samtidig — porten aabner foerst naar den SIDSTE slipper", () => {
  const a = acquireReloadBlock(RELOAD_BLOCK_REASONS.DIRTY);
  const b = acquireReloadBlock(RELOAD_BLOCK_REASONS.DIALOG);
  assert.deepEqual(getReloadBlockReasons(), ["dialog", "dirty"]);
  a();
  assert.equal(isReloadAllowed(), false, "dialogen er stadig aaben");
  b();
  assert.equal(isReloadAllowed(), true);
});

test("release er idempotent — et dobbelt kald frigiver ikke en ANDEN flades blokering", () => {
  const a = acquireReloadBlock(RELOAD_BLOCK_REASONS.DIRTY);
  const b = acquireReloadBlock(RELOAD_BLOCK_REASONS.BUSY);
  a();
  a();
  a();
  assert.equal(isReloadAllowed(), false, "b blokerer stadig");
  b();
  assert.equal(isReloadAllowed(), true);
});

test("onReloadAllowed fyrer paa overgangen blokeret -> fri, ikke ved hver release", () => {
  let calls = 0;
  onReloadAllowed(() => { calls += 1; });
  const a = acquireReloadBlock("dirty");
  const b = acquireReloadBlock("busy");
  a();
  assert.equal(calls, 0, "der er stadig en blokering tilbage");
  b();
  assert.equal(calls, 1);
});

test("onReloadAllowed returnerer en afmelding", () => {
  let calls = 0;
  const off = onReloadAllowed(() => { calls += 1; });
  off();
  acquireReloadBlock("dirty")();
  assert.equal(calls, 0);
});

test("en lytter der kaster, stopper ikke de oevrige", () => {
  const seen = [];
  onReloadAllowed(() => { throw new Error("boom"); });
  onReloadAllowed(() => seen.push("anden"));
  acquireReloadBlock("dirty")();
  assert.deepEqual(seen, ["anden"]);
});
