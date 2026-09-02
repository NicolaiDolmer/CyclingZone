import test from "node:test";
import assert from "node:assert/strict";
import { EMAIL_LOOP_FLAG_KEY, EMAIL_LOOP_TYPE_KEYS, readEmailLoopStage, isEmailLoopActive } from "./emailLoopFlag.js";

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

// #2853: mock that serves a distinct value per app_config key, so per-type +
// fallback behaviour can be exercised. `values` maps key -> value (or leaves
// a key out entirely to simulate an absent row).
function multiKeyAppConfigMock(values) {
  return {
    from(table) {
      assert.equal(table, "app_config");
      let requestedKey = null;
      return {
        select() { return this; },
        eq(col, key) {
          assert.equal(col, "key");
          requestedKey = key;
          return this;
        },
        maybeSingle: async () => ({
          data: requestedKey in values ? { value: values[requestedKey] } : null,
          error: null,
        }),
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

// ─── #2853 · per-mailtype gate ─────────────────────────────────────────────

test("EMAIL_LOOP_TYPE_KEYS names the three per-type app_config keys", () => {
  assert.deepEqual(EMAIL_LOOP_TYPE_KEYS, {
    welcome: "email_loop_welcome",
    day1: "email_loop_day1",
    race_digest: "email_loop_race_digest",
  });
});

test("a type's own key, when set to a valid stage, wins over the legacy key", async () => {
  const supabase = multiKeyAppConfigMock({
    email_loop_day1: "dry_run",
    [EMAIL_LOOP_FLAG_KEY]: "on",
  });
  assert.equal(await readEmailLoopStage(supabase, "day1"), "dry_run");
});

test("each of the three types reads its own key independently (one on, one dry_run, one off)", async () => {
  const supabase = multiKeyAppConfigMock({
    email_loop_welcome: "on",
    email_loop_day1: "dry_run",
    email_loop_race_digest: "off",
  });
  assert.equal(await readEmailLoopStage(supabase, "welcome"), "on");
  assert.equal(await readEmailLoopStage(supabase, "day1"), "dry_run");
  assert.equal(await readEmailLoopStage(supabase, "race_digest"), "off");
});

test("a type whose own key is ABSENT falls back to the legacy shared flag", async () => {
  const supabase = multiKeyAppConfigMock({ [EMAIL_LOOP_FLAG_KEY]: "dry_run" });
  assert.equal(await readEmailLoopStage(supabase, "day1"), "dry_run");
  assert.equal(await readEmailLoopStage(supabase, "race_digest"), "dry_run");
});

test("a type whose own key holds an unknown/garbage value falls back to the legacy flag (fail-safe chain)", async () => {
  const supabase = multiKeyAppConfigMock({ email_loop_welcome: "beta", [EMAIL_LOOP_FLAG_KEY]: "on" });
  assert.equal(await readEmailLoopStage(supabase, "welcome"), "on");
});

test("neither the type key nor the legacy key exists -> off (fail-safe)", async () => {
  const supabase = multiKeyAppConfigMock({});
  assert.equal(await readEmailLoopStage(supabase, "welcome"), "off");
  assert.equal(await readEmailLoopStage(supabase, "day1"), "off");
  assert.equal(await readEmailLoopStage(supabase, "race_digest"), "off");
});

test("omitting type entirely reads only the legacy key (type-agnostic callers, e.g. the retry drain's upfront check)", async () => {
  const supabase = multiKeyAppConfigMock({ email_loop_day1: "on", [EMAIL_LOOP_FLAG_KEY]: "dry_run" });
  assert.equal(await readEmailLoopStage(supabase), "dry_run");
});

test("isEmailLoopActive is per-type: true for the type that's on, false for a sibling type that's off with no legacy fallback", async () => {
  const supabase = multiKeyAppConfigMock({ email_loop_welcome: "on", email_loop_day1: "off" });
  assert.equal(await isEmailLoopActive(supabase, "welcome"), true);
  assert.equal(await isEmailLoopActive(supabase, "day1"), false);
  assert.equal(await isEmailLoopActive(supabase, "race_digest"), false, "no key at all and no legacy row -> off");
});
