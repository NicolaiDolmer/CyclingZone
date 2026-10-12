import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTIF_CHANGED_EVENT,
  NOTIF_DELETED_EVENT,
  NOTIF_CHANNEL_NAME,
  notifyUnreadChanged,
  subscribeUnreadSync,
} from "./unreadSync.js";

// Minimal in-memory "browser": ét window + document + et BroadcastChannel-net
// der leverer til ALLE andre instanser med samme navn (som i en rigtig browser,
// på tværs af faner).
let tabCounter = 0;
function makeTab(bus) {
  const tabId = `tab-${++tabCounter}`;
  const listeners = new Map();
  const target = {
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) ?? []) fn(event); return true; },
  };
  const docListeners = new Map();
  const doc = {
    visibilityState: "visible",
    addEventListener(name, fn) {
      if (!docListeners.has(name)) docListeners.set(name, new Set());
      docListeners.get(name).add(fn);
    },
    removeEventListener(name, fn) { docListeners.get(name)?.delete(fn); },
    fire(name) { for (const fn of docListeners.get(name) ?? []) fn(); },
  };
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this.closed = false;
      bus.add(this);
    }
    postMessage(data) {
      for (const other of bus) {
        if (other !== this && !other.closed && other.name === this.name) other.onmessage?.({ data });
      }
    }
    close() { this.closed = true; bus.delete(this); }
  }
  return { env: { win: target, doc, BC: FakeBroadcastChannel, tabId }, target, doc, listeners, docListeners };
}

test("notifyUnreadChanged — samme fane får window-eventet", () => {
  const bus = new Set();
  const tab = makeTab(bus);
  let calls = 0;
  subscribeUnreadSync(() => { calls += 1; }, tab.env);
  notifyUnreadChanged(tab.env);
  assert.equal(calls, 1);
});

test("notifyUnreadChanged — en ANDEN fane får besked via BroadcastChannel (flere faner, #6473)", () => {
  const bus = new Set();
  const tabA = makeTab(bus);
  const tabB = makeTab(bus);
  let callsB = 0;
  subscribeUnreadSync(() => { callsB += 1; }, tabB.env);
  // 'Marker alle som læst' i fane A
  notifyUnreadChanged(tabA.env);
  assert.equal(callsB, 1, "fane B genberegner sin tæller uden refresh");
});

test("notifyUnreadChanged — afsenderfanen får ikke dobbelt-kald fra sin egen broadcast", () => {
  const bus = new Set();
  const tab = makeTab(bus);
  let calls = 0;
  subscribeUnreadSync(() => { calls += 1; }, tab.env);
  notifyUnreadChanged(tab.env);
  assert.equal(calls, 1);
});

test("subscribeUnreadSync — fane der bliver synlig igen genberegner (sovende Edge-fane)", () => {
  const bus = new Set();
  const tab = makeTab(bus);
  let calls = 0;
  subscribeUnreadSync(() => { calls += 1; }, tab.env);
  tab.doc.visibilityState = "hidden";
  tab.doc.fire("visibilitychange");
  assert.equal(calls, 0, "skjult fane gør intet");
  tab.doc.visibilityState = "visible";
  tab.doc.fire("visibilitychange");
  assert.equal(calls, 1);
});

test("subscribeUnreadSync — fokus, online og den eksisterende cz:notif-deleted udløser også", () => {
  const bus = new Set();
  const tab = makeTab(bus);
  let calls = 0;
  subscribeUnreadSync(() => { calls += 1; }, tab.env);
  tab.target.dispatchEvent({ type: "focus" });
  tab.target.dispatchEvent({ type: "online" });
  tab.target.dispatchEvent({ type: NOTIF_DELETED_EVENT });
  tab.target.dispatchEvent({ type: NOTIF_CHANGED_EVENT });
  assert.equal(calls, 4);
});

test("subscribeUnreadSync — cleanup fjerner alle lyttere", () => {
  const bus = new Set();
  const tab = makeTab(bus);
  let calls = 0;
  const off = subscribeUnreadSync(() => { calls += 1; }, tab.env);
  off();
  tab.target.dispatchEvent({ type: NOTIF_CHANGED_EVENT });
  tab.doc.fire("visibilitychange");
  const other = makeTab(bus);
  notifyUnreadChanged(other.env);
  assert.equal(calls, 0);
  assert.equal([...bus].filter((c) => c.name === NOTIF_CHANNEL_NAME && !c.closed).length, 0);
});

test("source skelner lokal aendring fra ekstern (side-listen genindlaeser kun ved ekstern)", () => {
  const bus = new Set();
  const tabA = makeTab(bus);
  const tabB = makeTab(bus);
  const seenA = [];
  const seenB = [];
  subscribeUnreadSync((s) => seenA.push(s), tabA.env);
  subscribeUnreadSync((s) => seenB.push(s), tabB.env);
  notifyUnreadChanged(tabA.env);
  tabA.target.dispatchEvent({ type: "focus" });
  assert.deepEqual(seenA, ["local", "external"]);
  assert.deepEqual(seenB, ["external"]);
});

test("uden BroadcastChannel/window (SSR, privat vindue) kaster intet", () => {
  assert.doesNotThrow(() => notifyUnreadChanged({ win: null, doc: null, BC: null }));
  const off = subscribeUnreadSync(() => {}, { win: null, doc: null, BC: null });
  assert.doesNotThrow(off);
});

test("BroadcastChannel der kaster ved konstruktion blokerer ikke window-vejen", () => {
  const bus = new Set();
  const tab = makeTab(bus);
  const env = { ...tab.env, BC: class { constructor() { throw new Error("blocked"); } } };
  let calls = 0;
  subscribeUnreadSync(() => { calls += 1; }, env);
  assert.doesNotThrow(() => notifyUnreadChanged(env));
  assert.equal(calls, 1);
});
