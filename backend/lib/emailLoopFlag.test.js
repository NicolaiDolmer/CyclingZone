import test from "node:test";
import assert from "node:assert/strict";
import { EMAIL_LOOP_FLAG_KEY, readEmailLoopStage, isEmailLoopActive } from "./emailLoopFlag.js";

function appConfigMock(value) {
  return {
    from(table) {
      assert.equal(table, "app_config");
      return {
        select() { return this; },
        eq(col, key) {
          assert.equal(col, "key");
          assert.equal(key, EMAIL_LOOP_FLAG_KEY);
          return this;
        },
        maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }),
      };
    },
  };
}

test("readEmailLoopStage returns off when app_config has no row", async () => {
  assert.equal(await readEmailLoopStage(appConfigMock(undefined)), "off");
});

test("readEmailLoopStage returns off for an unknown/garbage value (fail-safe)", async () => {
  assert.equal(await readEmailLoopStage(appConfigMock("beta")), "off");
  assert.equal(await readEmailLoopStage(appConfigMock(true)), "off");
  assert.equal(await readEmailLoopStage(appConfigMock(null)), "off");
});

test("readEmailLoopStage passes through the three valid stages", async () => {
  assert.equal(await readEmailLoopStage(appConfigMock("off")), "off");
  assert.equal(await readEmailLoopStage(appConfigMock("dry_run")), "dry_run");
  assert.equal(await readEmailLoopStage(appConfigMock("on")), "on");
});

test("readEmailLoopStage fails safe (off) when supabase is missing/broken", async () => {
  assert.equal(await readEmailLoopStage(null), "off");
  assert.equal(await readEmailLoopStage({}), "off");
});

test("isEmailLoopActive is true for dry_run and on, false for off", async () => {
  assert.equal(await isEmailLoopActive(appConfigMock("off")), false);
  assert.equal(await isEmailLoopActive(appConfigMock("dry_run")), true);
  assert.equal(await isEmailLoopActive(appConfigMock("on")), true);
  assert.equal(await isEmailLoopActive(appConfigMock(undefined)), false);
});
