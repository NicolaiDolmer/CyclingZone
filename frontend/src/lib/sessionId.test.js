import { test } from "node:test";
import assert from "node:assert/strict";
import { getSessionId, __testing__ } from "./sessionId.js";

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test("returnerer stabilt id inden for vinduet", () => {
  const s = makeStorage();
  const a = getSessionId(s, 1000);
  const b = getSessionId(s, 1500);
  assert.equal(a, b);
});

test("nyt id efter timeout", () => {
  const s = makeStorage();
  const a = getSessionId(s, 1000);
  const b = getSessionId(s, 1000 + 31 * 60 * 1000);
  assert.notEqual(a, b);
});

test("sliding vindue: aktivitet forlænger sessionen", () => {
  const s = makeStorage();
  const a = getSessionId(s, 1000);
  // 20 min senere → samme session, vinduet glider
  const b = getSessionId(s, 1000 + 20 * 60 * 1000);
  // yderligere 20 min (40 total, men kun 20 siden sidste touch) → stadig samme
  const c = getSessionId(s, 1000 + 40 * 60 * 1000);
  assert.equal(a, b);
  assert.equal(b, c);
});

test("fallback uden storage giver stadig et id", () => {
  const id = getSessionId(null, 1000);
  assert.match(id, /./);
});

test("parseEntry afviser malformet", () => {
  assert.equal(__testing__.parseEntry("junk"), null);
  assert.equal(__testing__.parseEntry(null), null);
  assert.equal(__testing__.parseEntry(JSON.stringify({ id: 5, ts: "x" })), null);
});
