import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PRESENCE_INTERVAL_MS,
  readOnlineCountFromPresence,
  startPresenceHeartbeat,
} from "./presenceHeartbeat.ts";

function makeEnv(initialHidden = false) {
  const listeners: Array<() => void> = [];
  const doc = {
    hidden: initialHidden,
    addEventListener: (_t: "visibilitychange", l: () => void) => { listeners.push(l); },
    removeEventListener: (_t: "visibilitychange", l: () => void) => {
      const i = listeners.indexOf(l);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  const intervals = new Map<number, () => void>();
  let nextId = 1;
  let ticks = 0;
  return {
    doc,
    listeners,
    intervals,
    get ticks() { return ticks; },
    opts: {
      tick: () => { ticks++; },
      doc,
      setIntervalFn: (fn: () => void) => { const id = nextId++; intervals.set(id, fn); return id; },
      clearIntervalFn: (id: unknown) => { intervals.delete(id as number); },
    },
    fire() { listeners.slice().forEach((l) => l()); },
    runIntervals() { [...intervals.values()].forEach((f) => f()); },
  };
}

test("synlig fane: intervallet kalder tick", () => {
  const env = makeEnv(false);
  startPresenceHeartbeat(env.opts);
  assert.equal(env.intervals.size, 1);
  env.runIntervals();
  assert.equal(env.ticks, 1);
});

test("skjult fane ved start: intet interval, intet kald", () => {
  const env = makeEnv(true);
  startPresenceHeartbeat(env.opts);
  assert.equal(env.intervals.size, 0);
  assert.equal(env.ticks, 0);
});

test("fanen skjules: intervallet stoppes", () => {
  const env = makeEnv(false);
  startPresenceHeartbeat(env.opts);
  env.doc.hidden = true;
  env.fire();
  assert.equal(env.intervals.size, 0);
  assert.equal(env.ticks, 0);
});

test("fanen bliver synlig: ét kald straks og intervallet genstartes", () => {
  const env = makeEnv(true);
  startPresenceHeartbeat(env.opts);
  env.doc.hidden = false;
  env.fire();
  assert.equal(env.ticks, 1);
  assert.equal(env.intervals.size, 1);
  env.runIntervals();
  assert.equal(env.ticks, 2);
});

test("gentagne synlig-events giver aldrig mere end ét interval", () => {
  const env = makeEnv(false);
  startPresenceHeartbeat(env.opts);
  env.fire();
  env.fire();
  assert.equal(env.intervals.size, 1);
});

test("intervallet kalder ikke tick mens dokumentet er skjult", () => {
  const env = makeEnv(false);
  startPresenceHeartbeat(env.opts);
  env.doc.hidden = true;
  env.runIntervals();
  assert.equal(env.ticks, 0);
});

test("cleanup fjerner listener og interval", () => {
  const env = makeEnv(false);
  const stop = startPresenceHeartbeat(env.opts);
  stop();
  assert.equal(env.listeners.length, 0);
  assert.equal(env.intervals.size, 0);
});

test("standardintervallet er 60 sekunder", () => {
  assert.equal(PRESENCE_INTERVAL_MS, 60000);
});

test("readOnlineCountFromPresence: tal accepteres, alt andet giver null", () => {
  assert.equal(readOnlineCountFromPresence({ ok: true, online_count: 7 }), 7);
  assert.equal(readOnlineCountFromPresence({ online_count: 0 }), 0);
  assert.equal(readOnlineCountFromPresence({ ok: true }), null);
  assert.equal(readOnlineCountFromPresence({ online_count: "3" }), null);
  assert.equal(readOnlineCountFromPresence(null), null);
});

test("Layout bruger presenceHeartbeat og ingen rå 60s-setInterval", () => {
  const src = readFileSync(new URL("../components/Layout.jsx", import.meta.url), "utf8");
  assert.match(src, /startPresenceHeartbeat\(/);
  assert.doesNotMatch(src, /heartbeatRef\.current = setInterval/);
});
