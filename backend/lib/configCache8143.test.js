// #8143 (H): flag reads share one server memory with config_cache_8143 on; off = per client (#7663).
// The switch is read on demand with a bounded lifetime, never polled (AGENTS.md rule 36).
import test from "node:test";
import assert from "node:assert/strict";
import { readFlagStage, clearFlagStageCache, FLAG_CACHE_TTL_MS } from "./featureStage.js";
import {
  CONFIG_CACHE_SWITCH_KEY, CONFIG_CACHE_SWITCH_TTL_MS, isConfigCacheShared, settleConfigCacheSwitch,
  startConfigCacheSwitch, stopConfigCacheSwitch,
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
// Rule 16: no wall clock. One fixed instant for every read that is not about expiry.
const FIXED = { now: () => 1_000 };

/** Register a switch client answering `value`, ask once, and wait for the answer. */
async function useSwitch(value, { now = FIXED.now, counts = new Map(), opts } = {}) {
  const rows = value === undefined ? {} : { [CONFIG_CACHE_SWITCH_KEY]: value };
  const c = client(rows, counts, opts);
  startConfigCacheSwitch({ supabase: c, now });
  isConfigCacheShared();
  await settleConfigCacheSwitch();
  return { c, rows, counts };
}

test("switch: only on (or true) shares; off, beta, missing and failures do not", async (t) => {
  t.after(reset);
  for (const [value, expected] of [["on", true], [true, true], ["off", false], ["beta", false], [undefined, false]]) {
    reset();
    await useSwitch(value);
    assert.equal(isConfigCacheShared(), expected, String(value));
  }
  reset();
  await useSwitch("on", { opts: { failKeys: new Set([CONFIG_CACHE_SWITCH_KEY]) } });
  assert.equal(isConfigCacheShared(), false, "a failed read is off");
  reset();
  startConfigCacheSwitch({ supabase: { from() { throw new Error("network"); } }, now: FIXED.now });
  isConfigCacheShared();
  await settleConfigCacheSwitch();
  assert.equal(isConfigCacheShared(), false, "a thrown read is off");
});

test("no timer: importing and registering start nothing, and nothing is read without a flag read", async (t) => {
  t.after(reset);
  const started = [];
  const saved = { setInterval: globalThis.setInterval, setTimeout: globalThis.setTimeout };
  globalThis.setInterval = (...args) => { started.push("setInterval"); return saved.setInterval(...args); };
  globalThis.setTimeout = (...args) => { started.push("setTimeout"); return saved.setTimeout(...args); };
  try {
    // A fresh copy of the module, so its top level runs under the watch.
    const fresh = await import("./configCache8143.js?no-timer");
    const counts = new Map();
    fresh.startConfigCacheSwitch({ supabase: client({ [CONFIG_CACHE_SWITCH_KEY]: "on" }, counts), now: FIXED.now });
    assert.equal(counts.get(CONFIG_CACHE_SWITCH_KEY), undefined, "registering reads nothing");
    fresh.isConfigCacheShared();
    await fresh.settleConfigCacheSwitch();
    fresh.stopConfigCacheSwitch();
  } finally {
    globalThis.setInterval = saved.setInterval;
    globalThis.setTimeout = saved.setTimeout;
  }
  assert.deepEqual(started, [], "no timer is started");
});

test("off: the switch is asked once per lifetime, only when flags are read, never in between", async (t) => {
  t.after(reset);
  let clock = 1_000;
  const now = () => clock;
  const { counts } = await useSwitch("off", { now });
  assert.equal(counts.get(CONFIG_CACHE_SWITCH_KEY), 1);
  const rows = { some_flag: "on" };
  for (let i = 0; i < 50; i++) assert.equal(await readFlagStage(client(rows), "some_flag", { now }), "on");
  await settleConfigCacheSwitch();
  assert.equal(counts.get(CONFIG_CACHE_SWITCH_KEY), 1, "off: no repeated reads within the lifetime");
  assert.equal(isConfigCacheShared(), false);

  clock += 10 * CONFIG_CACHE_SWITCH_TTL_MS;
  await settleConfigCacheSwitch();
  assert.equal(counts.get(CONFIG_CACHE_SWITCH_KEY), 1, "time passing alone reads nothing (no polling)");
});

test("the answer runs out after its lifetime: the next flag read asks again", async (t) => {
  t.after(reset);
  let clock = 1_000;
  const now = () => clock;
  const { rows, counts } = await useSwitch("off", { now });
  rows[CONFIG_CACHE_SWITCH_KEY] = "on";
  clock += CONFIG_CACHE_SWITCH_TTL_MS - 1;
  assert.equal(isConfigCacheShared(), false, "still trusted just before the end");
  await settleConfigCacheSwitch();
  assert.equal(counts.get(CONFIG_CACHE_SWITCH_KEY), 1);
  clock += 1;
  assert.equal(isConfigCacheShared(), false, "the read that finds it run out goes on with the last answer");
  isConfigCacheShared();
  isConfigCacheShared();
  await settleConfigCacheSwitch();
  assert.equal(counts.get(CONFIG_CACHE_SWITCH_KEY), 2, "reads at the same time share one question");
  assert.equal(isConfigCacheShared(), true, "the new answer is used");
});

test("measured: 3 server clients + 100 per-request clients read one flag 100 times each", async (t) => {
  t.after(reset);
  const rows = { some_flag: "on" };
  const run = async () => {
    const counts = new Map();
    const servers = [client(rows, counts), client(rows, counts), client(rows, counts)];
    for (let i = 0; i < 100; i++) for (const c of servers) assert.equal(await readFlagStage(c, "some_flag", FIXED), "on");
    for (let i = 0; i < 100; i++) assert.equal(await readFlagStage(client(rows, counts), "some_flag", FIXED), "on");
    return counts.get("some_flag");
  };
  reset();
  const off = await run();
  reset();
  await useSwitch("on");
  const on = await run();
  assert.equal(off, 103, "off: one database read per client, as since #7663");
  assert.equal(on, 1, "on: one database read for the whole server");
});

test("on: engine switches are still read fresh every time", async (t) => {
  t.after(reset);
  await useSwitch("on");
  const counts = new Map();
  const c = client({ daily_training_enabled: "on" }, counts);
  for (let i = 0; i < 5; i++) await readFlagStage(c, "daily_training_enabled", FIXED);
  assert.equal(counts.get("daily_training_enabled"), 5);
});

test("on: a failed read is never shared and never falls back to an old value", async (t) => {
  t.after(reset);
  let clock = 1_000;
  const now = () => clock;
  await useSwitch("on", { now });
  const rows = { some_flag: "on" };
  assert.equal(await readFlagStage(client(rows), "some_flag", { now }), "on");
  clock += FLAG_CACHE_TTL_MS + 1;
  await settleConfigCacheSwitch(); // the switch answer ran out too; it is asked again and stays on
  const counts = new Map();
  const failing = client(rows, counts, { failKeys: new Set(["some_flag"]) });
  assert.equal(await readFlagStage(failing, "some_flag", { now }), null, "failure = off, not the old on");
  assert.equal(await readFlagStage(failing, "some_flag", { now }), null);
  assert.equal(counts.get("some_flag"), 2, "the failure was not remembered");
});

test("on: an admin change forgets the key for every client at once, also a read under way", async (t) => {
  t.after(reset);
  await useSwitch("on");
  const rows = { some_flag: "off" };
  const admin = client(rows);
  const other = client(rows);
  assert.equal(await readFlagStage(other, "some_flag", FIXED), "off");
  rows.some_flag = "on";
  assert.equal(await readFlagStage(other, "some_flag", FIXED), "off", "remembered within the TTL");
  clearFlagStageCache({ client: admin, key: "some_flag" }); // what the admin flag route does
  assert.equal(await readFlagStage(other, "some_flag", FIXED), "on", "another client sees the change at once");
  assert.equal(isConfigCacheShared(), true, "another key does not touch the switch");

  // A read that started before the change must not put the old value back.
  clearFlagStageCache({ client: admin, key: "some_flag" });
  let release;
  const slow = client({ some_flag: "old" }, new Map(), { delay: new Promise((r) => { release = r; }) });
  const under = readFlagStage(slow, "some_flag", FIXED);
  clearFlagStageCache({ client: admin, key: "some_flag" });
  release();
  assert.equal(await under, "old", "the caller that asked still gets its answer");
  rows.some_flag = "new";
  assert.equal(await readFlagStage(other, "some_flag", FIXED), "new", "the stale answer was not remembered");
});

test("invalidation: an admin write of the switch stops sharing at once and the next read asks again", async (t) => {
  t.after(reset);
  const { rows, counts } = await useSwitch("on");
  const flags = { some_flag: "a" };
  assert.equal(await readFlagStage(client(flags), "some_flag", FIXED), "a");
  assert.equal(isConfigCacheShared(), true);

  rows[CONFIG_CACHE_SWITCH_KEY] = "off";
  clearFlagStageCache({ client: client({}), key: CONFIG_CACHE_SWITCH_KEY }); // the admin flag route
  assert.equal(isConfigCacheShared(), false, "off at once, within the lifetime");
  await settleConfigCacheSwitch();
  assert.equal(counts.get(CONFIG_CACHE_SWITCH_KEY), 2, "the read after the write asked again");
  assert.equal(isConfigCacheShared(), false);

  // Back on: the shared memory starts empty, nothing from before is reused.
  flags.some_flag = "b";
  rows[CONFIG_CACHE_SWITCH_KEY] = "on";
  clearFlagStageCache({ client: client({}), key: CONFIG_CACHE_SWITCH_KEY });
  isConfigCacheShared();
  await settleConfigCacheSwitch();
  assert.equal(isConfigCacheShared(), true);
  assert.equal(await readFlagStage(client(flags), "some_flag", FIXED), "b");
});

test("invalidation: a switch answer under way when the switch is written is not trusted", async (t) => {
  t.after(reset);
  let release;
  const counts = new Map();
  const rows = { [CONFIG_CACHE_SWITCH_KEY]: "on" };
  const slow = client(rows, counts, { delay: new Promise((r) => { release = r; }) });
  startConfigCacheSwitch({ supabase: slow, now: FIXED.now });
  isConfigCacheShared(); // asks; the answer ("on", from before the write) is still under way
  const before = settleConfigCacheSwitch();
  rows[CONFIG_CACHE_SWITCH_KEY] = "off";
  clearFlagStageCache({ client: client({}), key: CONFIG_CACHE_SWITCH_KEY });
  release();
  await before;
  assert.equal(isConfigCacheShared(), false, "the old answer was dropped; the new question is under way");
  await settleConfigCacheSwitch();
  assert.equal(isConfigCacheShared(), false, "the new answer is off");
  assert.equal(counts.get(CONFIG_CACHE_SWITCH_KEY), 2);
});

test("a flip either way empties the shared memory; stop returns to per client", async (t) => {
  t.after(reset);
  let clock = 1_000;
  const now = () => clock;
  const { rows: sw } = await useSwitch("on", { now });
  const rows = { some_flag: "a" };
  assert.equal(await readFlagStage(client(rows), "some_flag", { now }), "a");
  rows.some_flag = "b";
  sw[CONFIG_CACHE_SWITCH_KEY] = "off";
  clock += CONFIG_CACHE_SWITCH_TTL_MS;
  isConfigCacheShared();
  await settleConfigCacheSwitch();
  assert.equal(isConfigCacheShared(), false);
  sw[CONFIG_CACHE_SWITCH_KEY] = "on";
  clock += CONFIG_CACHE_SWITCH_TTL_MS;
  isConfigCacheShared();
  await settleConfigCacheSwitch();
  assert.equal(await readFlagStage(client(rows), "some_flag", { now }), "b");
  stopConfigCacheSwitch();
  assert.equal(isConfigCacheShared(), false);
});

test("stop: no client, no reads; a second start is ignored", async (t) => {
  t.after(reset);
  const counts = new Map();
  const first = client({ [CONFIG_CACHE_SWITCH_KEY]: "on" }, counts);
  const second = client({ [CONFIG_CACHE_SWITCH_KEY]: "off" }, new Map());
  startConfigCacheSwitch({ supabase: first, now: FIXED.now });
  startConfigCacheSwitch({ supabase: second, now: FIXED.now });
  isConfigCacheShared();
  await settleConfigCacheSwitch();
  assert.equal(isConfigCacheShared(), true, "the first client is the one asked");
  stopConfigCacheSwitch();
  for (let i = 0; i < 5; i++) assert.equal(isConfigCacheShared(), false);
  await settleConfigCacheSwitch();
  assert.equal(counts.get(CONFIG_CACHE_SWITCH_KEY), 1, "stopped: nothing is asked");
});
