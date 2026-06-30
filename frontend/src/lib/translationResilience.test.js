import { test } from "node:test";
import assert from "node:assert/strict";
import { installTranslationResilience } from "./translationResilience.js";

function makeProto() {
  const calls = { remove: [], insert: [] };
  return {
    removeChild(child) { calls.remove.push(child); return child; },
    insertBefore(newNode, ref) { calls.insert.push([newNode, ref]); return newNode; },
    _calls: calls,
  };
}

test("removeChild no-op når child ikke er et barn (oversætter-flyttet)", () => {
  const proto = makeProto();
  installTranslationResilience(proto);
  const parent = Object.create(proto);
  const orphan = { parentNode: { other: true } };
  const r = proto.removeChild.call(parent, orphan);
  assert.equal(r, orphan);
  assert.equal(proto._calls.remove.length, 0); // original IKKE kaldt
});

test("removeChild delegerer når child ER et barn", () => {
  const proto = makeProto();
  installTranslationResilience(proto);
  const parent = Object.create(proto);
  const child = { parentNode: parent };
  proto.removeChild.call(parent, child);
  assert.equal(proto._calls.remove.length, 1); // original kaldt
});

test("insertBefore appender (ref=null) når referenceNode ikke er et barn", () => {
  const proto = makeProto();
  installTranslationResilience(proto);
  const parent = Object.create(proto);
  const orphanRef = { parentNode: { other: true } };
  proto.insertBefore.call(parent, { n: 1 }, orphanRef);
  assert.equal(proto._calls.insert.length, 1);
  assert.equal(proto._calls.insert[0][1], null);
});

test("insertBefore delegerer uændret når referenceNode ER et barn", () => {
  const proto = makeProto();
  installTranslationResilience(proto);
  const parent = Object.create(proto);
  const ref = { parentNode: parent };
  proto.insertBefore.call(parent, { n: 2 }, ref);
  assert.equal(proto._calls.insert[0][1], ref);
});

test("insertBefore med ref=null delegerer (normal append)", () => {
  const proto = makeProto();
  installTranslationResilience(proto);
  const parent = Object.create(proto);
  proto.insertBefore.call(parent, { n: 3 }, null);
  assert.equal(proto._calls.insert[0][1], null);
});

test("idempotent install", () => {
  const proto = makeProto();
  assert.equal(installTranslationResilience(proto), true);
  assert.equal(installTranslationResilience(proto), false);
});
