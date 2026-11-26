import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_HOLDOUT_FRACTION,
  holdoutBucket,
  isHeldOut,
  normalizeHoldoutFraction,
  splitHoldout,
} from "./emailHoldout.js";

const ids = Array.from({ length: 2000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

test("share: empty means 0, numbers and numeric strings in range pass, the rest is refused", () => {
  for (const empty of [undefined, null, ""]) assert.equal(normalizeHoldoutFraction(empty), 0);
  assert.equal(normalizeHoldoutFraction(0.1), 0.1);
  assert.equal(normalizeHoldoutFraction(" 0.25 "), 0.25);
  assert.equal(normalizeHoldoutFraction(MAX_HOLDOUT_FRACTION), MAX_HOLDOUT_FRACTION);
  for (const bad of [-0.01, 0.51, 1, 10, "10%", "x", Number.NaN, Infinity]) {
    assert.throws(() => normalizeHoldoutFraction(bad), RangeError, String(bad));
  }
});

test("bucket: stable for the same salt and user, in [0, 1), different per salt", () => {
  const a = holdoutBucket("s6_season", ids[0]);
  assert.equal(holdoutBucket("s6_season", ids[0]), a);
  assert.ok(a >= 0 && a < 1);
  const differs = ids.slice(0, 50).some((id) => holdoutBucket("s6_season", id) !== holdoutBucket("other", id));
  assert.ok(differs);
  assert.throws(() => holdoutBucket("", ids[0]));
  assert.throws(() => holdoutBucket("s6_season", ""));
});

test("isHeldOut: share 0 never holds anyone out", () => {
  assert.equal(ids.some((userId) => isHeldOut({ salt: "s6_season", userId, fraction: 0 })), false);
});

test("split: share 0 returns the same array and an empty control group", () => {
  const list = ids.map((userId) => ({ userId }));
  const { send, holdout } = splitHoldout(list, { salt: "s6_season", fraction: 0 });
  assert.equal(send, list);
  assert.deepEqual(holdout, []);
});

test("split: keeps order, loses no one, and lands near the share", () => {
  const list = ids.map((userId) => ({ userId }));
  const { send, holdout } = splitHoldout(list, { salt: "s6_season", fraction: 0.1 });
  assert.equal(send.length + holdout.length, list.length);
  const order = (arr) => arr.map((c) => ids.indexOf(c.userId));
  assert.deepEqual(order(send), [...order(send)].sort((a, b) => a - b));
  assert.deepEqual(order(holdout), [...order(holdout)].sort((a, b) => a - b));
  const share = holdout.length / list.length;
  assert.ok(share > 0.07 && share < 0.13, `share ${share}`);
  for (const c of holdout) assert.equal(isHeldOut({ salt: "s6_season", userId: c.userId, fraction: 0.1 }), true);
});

test("split: a custom id reader is honoured", () => {
  const list = ids.slice(0, 200).map((id) => ({ user_id: id }));
  const { holdout } = splitHoldout(list, { salt: "s6_season", fraction: 0.5, idOf: (c) => c.user_id });
  assert.ok(holdout.length > 0);
});
