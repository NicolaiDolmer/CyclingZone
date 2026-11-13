// #7982 step 2: the press's own read cache (createPressReadCache in trainNow.js).
// The judge's set (trainNowSameResult7982.test.js) proves the same result end to end; this
// file pins the cache's own rules: what is cached, what is never cached, and when it empties.
import test from "node:test";
import assert from "node:assert/strict";
import { createPressReadCache, PRESS_CACHED_TABLES } from "./trainNow.js";
import { CACHE_OWNER_CLIENT, readPrivateConfigEntry, clearPrivateConfigCache } from "./privateConfig.ts";

function fakeClient(tables) {
  const calls = [];
  const client = {
    calls,
    failNext: false,
    from(table) {
      const spec = [];
      let write = null;
      const run = () => {
        calls.push({ table, spec: [...spec], write });
        if (client.failNext) { client.failNext = false; return { data: null, error: { message: "boom" } }; }
        if (write) return { data: null, error: null };
        const rows = (tables[table] ?? []).filter((row) => spec.every(([col, val]) => row[col] === val));
        return { data: structuredClone(rows), error: null };
      };
      const q = {
        select() { return q; },
        eq(col, val) { spec.push([col, val]); return q; },
        update(payload) { write = payload; return q; },
        maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      return q;
    },
    rpcCalls: [],
    async rpc(name) { client.rpcCalls.push(name); return { data: null, error: null }; },
  };
  return client;
}

const TABLES = {
  app_config: [{ key: "a", value: "on" }, { key: "b", value: "off" }],
  training_plans: [{ rider_id: "r1", focus: "sprint" }],
  rider_condition: [{ rider_id: "r1", form: 50 }],
};

test("a cached table is read once per press, and every reader gets its own copy", async () => {
  const client = fakeClient(TABLES);
  const press = createPressReadCache(client);
  const first = await press.from("training_plans").select("*").eq("rider_id", "r1");
  first.data[0].focus = "changed by a reader";
  const second = await press.from("training_plans").select("*").eq("rider_id", "r1");
  assert.equal(second.data[0].focus, "sprint");
  assert.equal(client.calls.length, 1);
  const single = await press.from("app_config").select("value").eq("key", "a").maybeSingle();
  const again = await press.from("app_config").select("value").eq("key", "a").maybeSingle();
  assert.deepEqual([single.data, again.data], [{ key: "a", value: "on" }, { key: "a", value: "on" }]);
  await press.from("app_config").select("value").eq("key", "b").maybeSingle();
  assert.equal(client.calls.length, 3, "another filter is another query");
});

test("tables a press writes are never cached", async () => {
  assert.equal(PRESS_CACHED_TABLES.has("rider_condition"), false);
  const client = fakeClient(TABLES);
  const press = createPressReadCache(client);
  await press.from("rider_condition").select("*").eq("rider_id", "r1");
  await press.from("rider_condition").select("*").eq("rider_id", "r1");
  assert.equal(client.calls.length, 2);
});

test("a failed read is never reused", async () => {
  const client = fakeClient(TABLES);
  const press = createPressReadCache(client);
  client.failNext = true;
  const failed = await press.from("app_config").select("value").eq("key", "a").maybeSingle();
  assert.equal(failed.error.message, "boom");
  const ok = await press.from("app_config").select("value").eq("key", "a").maybeSingle();
  assert.equal(ok.data.value, "on");
  assert.equal(client.calls.length, 2);
});

test("a write to a cached table goes through and empties the cache", async () => {
  const client = fakeClient(TABLES);
  const press = createPressReadCache(client);
  await press.from("app_config").select("value").eq("key", "a").maybeSingle();
  await press.from("app_config").update({ value: "off" }).eq("key", "a");
  assert.deepEqual(client.calls[1].write, { value: "off" });
  await press.from("app_config").select("value").eq("key", "a").maybeSingle();
  assert.equal(client.calls.length, 3);
});

test("the press's own database functions keep the cache; any other function empties it", async () => {
  const client = fakeClient(TABLES);
  const press = createPressReadCache(client);
  await press.from("app_config").select("value").eq("key", "a").maybeSingle();
  await press.rpc("try_commit_training_date_tick", {});
  await press.rpc("register_training_date_work", {});
  await press.from("app_config").select("value").eq("key", "a").maybeSingle();
  assert.equal(client.calls.length, 1);
  await press.rpc("ignite_development_curve_b", {});
  await press.from("app_config").select("value").eq("key", "a").maybeSingle();
  assert.equal(client.calls.length, 2);
  assert.deepEqual(client.rpcCalls, ["try_commit_training_date_tick", "register_training_date_work", "ignite_development_curve_b"]);
});

test("each press has its own cache: a switch read for one press never reaches the next", async () => {
  const client = fakeClient(TABLES);
  await createPressReadCache(client).from("app_config").select("value").eq("key", "a").maybeSingle();
  TABLES.app_config[0].value = "off";
  try {
    const next = await createPressReadCache(client).from("app_config").select("value").eq("key", "a").maybeSingle();
    assert.equal(next.data.value, "off");
  } finally {
    TABLES.app_config[0].value = "on";
  }
});

test("the server's private-parameter cache stays on the real client", async () => {
  clearPrivateConfigCache();
  const client = fakeClient({ private_config: [{ key: "k", value: { a: 1 } }] });
  const press = createPressReadCache(client);
  assert.equal(press[CACHE_OWNER_CLIENT], client);
  const schema = (value) => value;
  // A fixed clock, so the test measures cache ownership and not elapsed time.
  const now = () => 1_000_000;
  await readPrivateConfigEntry(press, "k", { schema, now });
  await readPrivateConfigEntry(client, "k", { schema, now });
  assert.equal(client.calls.length, 1, "the read through the press warmed the real client's cache");
  clearPrivateConfigCache();
});
