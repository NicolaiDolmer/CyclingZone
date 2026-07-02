// frontend/src/lib/raceHubDnd.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeDrag, decodeDrag, dropAction } from "./raceHubDnd.js";

test("encode/decode round-trips drag-payload", () => {
  assert.deepEqual(decodeDrag(encodeDrag({ riderId: "r1", fromRaceId: "A" })), { riderId: "r1", fromRaceId: "A" });
  assert.deepEqual(decodeDrag(encodeDrag({ riderId: "r1", fromRaceId: null })), { riderId: "r1", fromRaceId: null });
  assert.equal(decodeDrag("not-json"), null);
  assert.equal(decodeDrag('{"noRider":true}'), null);
});

test("dropAction: pulje→kolonne = add; kolonne→kolonne = move; kolonne→pulje = remove", () => {
  assert.equal(dropAction({ fromRaceId: null, toKind: "column", targetFull: false, targetLocked: false }), "add");
  assert.equal(dropAction({ fromRaceId: "A", toRaceId: "B", toKind: "column", targetFull: false, targetLocked: false }), "move");
  assert.equal(dropAction({ fromRaceId: "A", toKind: "pool" }), "remove");
});

test("dropAction: fuldt/frosset mål eller samme kolonne = none", () => {
  assert.equal(dropAction({ fromRaceId: null, toKind: "column", targetFull: true, targetLocked: false }), "none");
  assert.equal(dropAction({ fromRaceId: "A", toRaceId: "B", toKind: "column", targetFull: false, targetLocked: true }), "none");
  assert.equal(dropAction({ fromRaceId: "A", toRaceId: "A", toKind: "column", targetFull: false, targetLocked: false }), "none");
  assert.equal(dropAction({ fromRaceId: null, toKind: "pool" }), "none"); // pulje→pulje
});
