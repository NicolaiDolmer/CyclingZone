// #7239: en klient uden `co_captain_id` (fx saesonmatrixen) nulstiller ikke holdets delte kaptajn.
import test from "node:test";
import assert from "node:assert/strict";
import { keptCoCaptainId } from "./raceSelection.js";

const base = {
  current: { rider_ids: ["r1", "r2", "r3"], captain_id: "r1", co_captain_id: "r2" },
  riderIds: ["r1", "r2", "r3"],
  captainId: "r1",
  allowed: true,
};

test("#7239: feltet mangler -> den gemte delte kaptajn beholdes", () => {
  assert.equal(keptCoCaptainId({ ...base, body: { rider_ids: base.riderIds, captain_id: "r1" } }), "r2");
});

test("#7239: klienten sender feltet (ogsaa null) -> klienten vinder", () => {
  assert.equal(keptCoCaptainId({ ...base, body: { co_captain_id: null } }), null);
  assert.equal(keptCoCaptainId({ ...base, body: { co_captain_id: "r3" } }), null, "kalderen bruger selv body-vaerdien");
});

test("#7239: beholdes ikke naar han er ude af truppen, uden kaptajn, i en anden rolle eller i et aeldre loeb", () => {
  const body = {};
  assert.equal(keptCoCaptainId({ ...base, body, riderIds: ["r1", "r3"] }), null);
  assert.equal(keptCoCaptainId({ ...base, body, captainId: null }), null);
  assert.equal(keptCoCaptainId({ ...base, body, hunterId: "r2" }), null);
  assert.equal(keptCoCaptainId({ ...base, body, freeRoleIds: ["r2"] }), null);
  assert.equal(keptCoCaptainId({ ...base, body, captainId: "r2" }), null);
  assert.equal(keptCoCaptainId({ ...base, body, allowed: false }), null);
  assert.equal(keptCoCaptainId({ ...base, body, current: null }), null);
});
