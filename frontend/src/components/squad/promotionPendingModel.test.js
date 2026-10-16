import { test } from "node:test";
import assert from "node:assert/strict";
import { promotionErrorKey, pendingRidersFromResponse } from "./promotionPendingModel.js";

test("promotionErrorKey: kendte koder faar egen tekst, resten den generiske", () => {
  assert.equal(promotionErrorKey("squad_full"), "promotionPending.error.squad_full");
  assert.equal(promotionErrorKey("rider_on_market"), "promotionPending.error.rider_on_market");
  assert.equal(promotionErrorKey("rider_in_stage_race"), "promotionPending.error.rider_in_stage_race");
  assert.equal(promotionErrorKey("not_pending"), "promotionPending.error.generic");
  assert.equal(promotionErrorKey(undefined), "promotionPending.error.generic");
});

test("pendingRidersFromResponse: flag off, fejl og skrald giver tom liste", () => {
  assert.deepEqual(pendingRidersFromResponse(null), []);
  assert.deepEqual(pendingRidersFromResponse({ ok: false, data: { enabled: true, riders: [{ id: "a", to: "u23" }] } }), []);
  assert.deepEqual(pendingRidersFromResponse({ ok: true, data: { enabled: false, riders: [{ id: "a", to: "u23" }] } }), []);
  assert.deepEqual(pendingRidersFromResponse({ ok: true, data: { enabled: true, riders: "nope" } }), []);
});

test("pendingRidersFromResponse: beholder kun gyldige maal-trupper", () => {
  const rows = pendingRidersFromResponse({
    ok: true,
    data: { enabled: true, riders: [
      { id: "a", to: "u23", canPromote: true },
      { id: "b", to: "senior", canPromote: false },
      { id: "c", to: "junior" },
      null,
    ] },
  });
  assert.deepEqual(rows.map((r) => r.id), ["a", "b"]);
});
