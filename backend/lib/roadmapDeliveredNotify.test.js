// #7792: leveret-beskeden pr. manager pr. roadmap-punkt. Sweepen testes mod et
// lille in-memory-lager, saa idempotensen kan bevises uden database.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ROADMAP_DELIVERED_TYPE,
  defaultRoadmapDeliveredStore,
  isRoadmapDeliveredSchemaPending,
  roadmapDeliveredKeys,
  runRoadmapDeliveredNotify,
} from "./roadmapDeliveredNotify.js";
import { translate } from "./i18nServer.js";

const NOW = new Date("2026-11-07T10:00:00.000Z");

function makeStore({ items, voters = {}, receipts = new Set(), failMark = false } = {}) {
  const state = { items: items.map((i) => ({ ...i, done: false })), receipts, released: [] };
  const key = (itemId, userId) => `${itemId}:${userId}`;
  return {
    state,
    listOpenItems: async () => state.items.filter((i) => !i.done),
    listHighVoters: async ({ itemId }) => voters[itemId] ?? [],
    claim: async ({ itemId, userId }) => {
      if (state.receipts.has(key(itemId, userId))) return false;
      state.receipts.add(key(itemId, userId));
      return true;
    },
    release: async ({ itemId, userId }) => { state.receipts.delete(key(itemId, userId)); state.released.push(userId); },
    markItemDone: async ({ itemId }) => {
      if (failMark) throw new Error("mark failed");
      state.items.find((i) => i.id === itemId).done = true;
    },
  };
}

const ITEM = { id: "item-1", title_en: "Rider search", title_da: "Rytter-søgning" };

test("sender én besked til hver manager der gav høj stemme, og lukker punktet", async () => {
  const store = makeStore({ items: [ITEM], voters: { "item-1": ["u1", "u2"] } });
  const sent = [];
  const r = await runRoadmapDeliveredNotify({ supabase: {}, now: NOW, store, notify: async (a) => { sent.push(a); return { delivered: true }; } });
  assert.deepEqual([r.items, r.sent, r.skipped, r.failed], [1, 2, 0, 0]);
  assert.deepEqual(sent.map((s) => s.userId), ["u1", "u2"]);
  for (const s of sent) {
    assert.equal(s.type, ROADMAP_DELIVERED_TYPE);
    assert.equal(s.relatedId, "item-1");
    assert.equal(s.messageCode, "notif.roadmapDelivered.message");
    assert.deepEqual(s.messageParams, { item: "Rider search", itemDa: "Rytter-søgning" });
  }
  assert.equal(store.state.items[0].done, true);
});

test("gentaget statusskift giver ingen ekstra besked: kvitteringen står, også når punktet åbnes igen", async () => {
  const store = makeStore({ items: [ITEM], voters: { "item-1": ["u1"] } });
  const sent = [];
  const notify = async (a) => { sent.push(a.userId); return { delivered: true }; };
  await runRoadmapDeliveredNotify({ supabase: {}, now: NOW, store, notify });
  store.state.items[0].done = false; // leveret, tilbage, leveret igen
  const second = await runRoadmapDeliveredNotify({ supabase: {}, now: NOW, store, notify });
  assert.deepEqual(sent, ["u1"]);
  assert.equal(second.sent, 0);
  assert.equal(second.skipped, 1);
});

test("en stemme der kommer til efter første kørsel får beskeden, de gamle får ikke en ny", async () => {
  const voters = { "item-1": ["u1"] };
  const store = makeStore({ items: [ITEM], voters });
  const sent = [];
  const notify = async (a) => { sent.push(a.userId); return { delivered: true }; };
  await runRoadmapDeliveredNotify({ supabase: {}, now: NOW, store, notify });
  voters["item-1"] = ["u1", "u2"];
  store.state.items[0].done = false;
  await runRoadmapDeliveredNotify({ supabase: {}, now: NOW, store, notify });
  assert.deepEqual(sent, ["u1", "u2"]);
});

test("en fejlet afsendelse ruller kun sin egen claim tilbage og holder punktet åbent til næste tick", async () => {
  const store = makeStore({ items: [ITEM], voters: { "item-1": ["u1", "u2"] } });
  const sent = [];
  let fail = true;
  const notify = async (a) => {
    if (a.userId === "u1" && fail) throw new Error("insert failed");
    sent.push(a.userId);
    return { delivered: true };
  };
  const first = await runRoadmapDeliveredNotify({ supabase: {}, now: NOW, store, notify });
  assert.equal(first.failed, 1);
  assert.deepEqual(sent, ["u2"]);
  assert.equal(store.state.items[0].done, false);
  fail = false;
  const second = await runRoadmapDeliveredNotify({ supabase: {}, now: NOW, store, notify });
  assert.deepEqual(sent, ["u2", "u1"]);
  assert.equal(second.skipped, 1);
  assert.equal(store.state.items[0].done, true);
});

test("en afsender der ikke findes længere (FK) stopper ikke punktet og prøves ikke igen", async () => {
  const store = makeStore({ items: [ITEM], voters: { "item-1": ["ghost"] } });
  const notify = async () => { throw Object.assign(new Error("fk"), { code: "23503" }); };
  const r = await runRoadmapDeliveredNotify({ supabase: {}, now: NOW, store, notify });
  assert.equal(r.failed, 0);
  assert.equal(store.state.items[0].done, true);
  assert.equal(store.state.receipts.has("item-1:ghost"), true);
});

test("punkt uden høje stemmer lukkes uden besked", async () => {
  const store = makeStore({ items: [ITEM], voters: {} });
  const r = await runRoadmapDeliveredNotify({ supabase: {}, now: NOW, store, notify: async () => assert.fail("ingen besked") });
  assert.equal(r.sent, 0);
  assert.equal(store.state.items[0].done, true);
});

test("migrationen mangler endnu: tick springes over uden at kaste", async () => {
  const store = { listOpenItems: async () => { throw Object.assign(new Error("column roadmap_items.delivery_notified_at does not exist"), { code: "42703" }); } };
  const r = await runRoadmapDeliveredNotify({ supabase: {}, store, notify: async () => assert.fail("ingen besked") });
  assert.equal(r.pending, true);
  assert.equal(isRoadmapDeliveredSchemaPending({ code: "PGRST205" }), true);
  assert.equal(isRoadmapDeliveredSchemaPending({ code: "23505", message: "dup" }), false);
});

test("teksten er på engelsk som fallback, uden vi og uden tankestreg, og DA bruger det danske punktnavn", () => {
  const keys = roadmapDeliveredKeys(ITEM);
  const en = translate(keys.messageCode, keys.messageParams, { language: "en" });
  const da = translate(keys.messageCode, keys.messageParams, { language: "da" });
  assert.match(en, /Rider search/);
  assert.match(da, /Rytter-søgning/);
  assert.doesNotMatch(da, /Rider search/);
  for (const text of [en, da, translate(keys.titleCode, {}, { language: "en" }), translate(keys.titleCode, {}, { language: "da" })]) {
    assert.doesNotMatch(text, /[—–]/);
    assert.doesNotMatch(text, /\b(we|vi)\b/i);
  }
});

test("standardlageret spørger kun efter høje stemmer på de to akser og claimer med ON CONFLICT DO NOTHING", async () => {
  const calls = [];
  const chain = (table) => {
    const q = { table, ops: [] };
    const proxy = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === "then") return (resolve) => { calls.push(q); resolve({ data: table === "roadmap_delivery_receipts" ? [{ user_id: "u1" }] : [{ user_id: "u1" }], error: null }); };
        return (...args) => { q.ops.push([prop, ...args]); return proxy; };
      },
    });
    return proxy;
  };
  const supabase = { from: chain };
  const voters = await defaultRoadmapDeliveredStore.listHighVoters({ supabase, itemId: "item-1" });
  assert.deepEqual(voters, ["u1"]);
  const orOp = calls[0].ops.find(([op]) => op === "or");
  assert.equal(orOp[1], "importance_score.gte.5,idea_score.gte.5");
  assert.deepEqual(calls[0].ops.find(([op]) => op === "eq"), ["eq", "item_id", "item-1"]);

  const claimed = await defaultRoadmapDeliveredStore.claim({ supabase, itemId: "item-1", userId: "u1", sentAtIso: NOW.toISOString() });
  assert.equal(claimed, true);
  const upsert = calls[1].ops.find(([op]) => op === "upsert");
  assert.deepEqual(upsert[2], { onConflict: "item_id,user_id", ignoreDuplicates: true });
});
