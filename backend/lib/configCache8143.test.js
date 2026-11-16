// #8143 (H): flag reads share one server memory with config_cache_8143 on; off = per client (#7663).
import test from "node:test";
import assert from "node:assert/strict";
import { readFlagStage, clearFlagStageCache, FLAG_CACHE_TTL_MS } from "./featureStage.js";
import {
  CONFIG_CACHE_SWITCH_KEY, isConfigCacheShared, refreshConfigCacheSwitch, startConfigCacheSwitch, stopConfigCacheSwitch,
} from "./configCache8143.js";

/** A client that answers app_config reads from `rows` and counts every read per key. */
function client(rows, counts = new Map(), { failKeys = new Set(), delay = null } = {}) {
  return {
    counts,
    from(table) {
      assert.equal(table, "app_config");
      let key = null;
      return {
        select() { return this; },
        eq(_col, value) { key = value; return this; },
        async maybeSingle() {
          counts.set(key, (counts.get(key) ?? 0) + 1);
          if (delay) await delay;
          if (failKeys.has(key)) return { data: null, error: { message: "down" } };
          return { data: key in rows ? { value: rows[key] } : null, error: null };
        },
      };
    },
  };
}

const reset = () => { stopConfigCacheSwitch(); clearFlagStageCache(); };

test("switch: only on (or true) shares; off, beta, missing and failures do not", async (t) => {
  t.after(reset);
  for (const [value, expected] of [["on", true], [true, true], ["off", false], ["beta", false], [undefined, false]]) {
    const rows = value === undefined ? {} : { [CONFIG_CACHE_SWITCH_KEY]: value };
    assert.equal(await refreshConfigCacheSwitch(client(rows)), expected, String(value));
  }
  await refreshConfigCacheSwitch(client({ [CONFIG_CACHE_SWITCH_KEY]: "on" }));
  assert.equal(await refreshConfigCacheSwitch(client({}, new Map(), { failKeys: new Set([CONFIG_CACHE_SWITCH_KEY]) })), false, "a failed read is off");
  await refreshConfigCacheSwitch(client({ [CONFIG_CACHE_SWITCH_KEY]: "on" }));
  assert.equal(await refreshConfigCacheSwitch({ from() { throw new Error("network"); } }), false, "a thrown read is off");
});

test("measured: 3 server clients + 100 per-request clients read one flag 100 times each", async (t) => {
  t.after(reset);
  const rows = { some_flag: "on" };
  const run = async () => {
    const counts = new Map();
    const servers = [client(rows, counts), client(rows, counts), client(rows, counts)];
    for (let i = 0; i < 100; i++) for (const c of servers) assert.equal(await readFlagStage(c, "some_flag"), "on");
    for (let i = 0; i < 100; i++) assert.equal(await readFlagStage(client(rows, counts), "some_flag"), "on");
    return counts.get("some_flag");
  };
  reset();
  const off = await run();
  reset();
  await refreshConfigCacheSwitch(client({ [CONFIG_CACHE_SWITCH_KEY]: "on" }));
  const on = await run();
  assert.equal(off, 103, "off: one database read per client, as since #7663");
  assert.equal(on, 1, "on: one database read for the whole server");
});

test("on: engine switches are still read fresh every time", async (t) => {
  t.after(reset);
  await refreshConfigCacheSwitch(client({ [CONFIG_CACHE_SWITCH_KEY]: "on" }));
  const counts = new Map();
  const c = client({ daily_training_enabled: "on" }, counts);
  for (let i = 0; i < 5; i++) await readFlagStage(c, "daily_training_enabled");
  assert.equal(counts.get("daily_training_enabled"), 5);
});

test("on: a failed read is never shared and never falls back to an old value", async (t) => {
  t.after(reset);
  await refreshConfigCacheSwitch(client({ [CONFIG_CACHE_SWITCH_KEY]: "on" }));
  const rows = { some_flag: "on" };
  let clock = 1_000;
  const now = () => clock;
  assert.equal(await readFlagStage(client(rows), "some_flag", { now }), "on");
  clock += FLAG_CACHE_TTL_MS + 1;
  const counts = new Map();
  const failing = client(rows, counts, { failKeys: new Set(["some_flag"]) });
  assert.equal(await readFlagStage(failing, "some_flag", { now }), null, "failure = off, not the old on");
  assert.equal(await readFlagStage(failing, "some_flag", { now }), null);
  assert.equal(counts.get("some_flag"), 2, "the failure was not remembered");
});

test("on: an admin change forgets the key for every client at once, also a read under way", async (t) => {
  t.after(reset);
  await refreshConfigCacheSwitch(client({ [CONFIG_CACHE_SWITCH_KEY]: "on" }));
  const rows = { some_flag: "off" };
  const admin = client(rows);
  const other = client(rows);
  assert.equal(await readFlagStage(other, "some_flag"), "off");
  rows.some_flag = "on";
  assert.equal(await readFlagStage(other, "some_flag"), "off", "remembered within the TTL");
  clearFlagStageCache({ client: admin, key: "some_flag" }); // what the admin flag route does
  assert.equal(await readFlagStage(other, "some_flag"), "on", "another client sees the change at once");

  // A read that started before the change must not put the old value back.
  clearFlagStageCache({ client: admin, key: "some_flag" });
  let release;
  const slow = client({ some_flag: "old" }, new Map(), { delay: new Promise((r) => { release = r; }) });
  const under = readFlagStage(slow, "some_flag");
  clearFlagStageCache({ client: admin, key: "some_flag" });
  release();
  assert.equal(await under, "old", "the caller that asked still gets its answer");
  rows.some_flag = "new";
  assert.equal(await readFlagStage(other, "some_flag"), "new", "the stale answer was not remembered");
});

test("a flip either way empties the shared memory; stop returns to per client", async (t) => {
  t.after(reset);
  await refreshConfigCacheSwitch(client({ [CONFIG_CACHE_SWITCH_KEY]: "on" }));
  const rows = { some_flag: "a" };
  assert.equal(await readFlagStage(client(rows), "some_flag"), "a");
  rows.some_flag = "b";
  await refreshConfigCacheSwitch(client({ [CONFIG_CACHE_SWITCH_KEY]: "off" }));
  await refreshConfigCacheSwitch(client({ [CONFIG_CACHE_SWITCH_KEY]: "on" }));
  assert.equal(await readFlagStage(client(rows), "some_flag"), "b");
  stopConfigCacheSwitch();
  assert.equal(isConfigCacheShared(), false);
});

test("start asks at once, then on its interval; stop stops asking", async (t) => {
  t.after(reset);
  const counts = new Map();
  const c = client({ [CONFIG_CACHE_SWITCH_KEY]: "on" }, counts);
  startConfigCacheSwitch({ supabase: c, intervalMs: 5 });
  startConfigCacheSwitch({ supabase: c, intervalMs: 5 }); // a second start is ignored
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(isConfigCacheShared(), true);
  const asked = counts.get(CONFIG_CACHE_SWITCH_KEY);
  assert.ok(asked >= 2, `asked ${asked} times`);
  stopConfigCacheSwitch();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(counts.get(CONFIG_CACHE_SWITCH_KEY), asked);
  assert.equal(isConfigCacheShared(), false);
});
