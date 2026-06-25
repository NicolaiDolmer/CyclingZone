import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFirstRaceResultPayload } from "./firstRaceResult.js";

test("returnerer null for tom/ugyldig input", () => {
  assert.equal(pickFirstRaceResultPayload([]), null);
  assert.equal(pickFirstRaceResultPayload(null), null);
  assert.equal(pickFirstRaceResultPayload(undefined), null);
});

test("vælger den bedste (laveste rank) placering", () => {
  const rows = [
    { rank: 12, race: { id: "race-a" } },
    { rank: 3, race: { id: "race-b" } },
    { rank: 27, race: { id: "race-c" } },
  ];
  assert.deepEqual(pickFirstRaceResultPayload(rows), { race_id: "race-b", placement: 3 });
});

test("springer rækker uden race_id over (gamle PCM-løb)", () => {
  const rows = [
    { rank: 1, race: null },
    { rank: 5, race: { id: "race-x" } },
  ];
  assert.deepEqual(pickFirstRaceResultPayload(rows), { race_id: "race-x", placement: 5 });
});

test("returnerer null hvis ingen række har race_id", () => {
  const rows = [
    { rank: 1, race: null },
    { rank: 2, rider_name: "Foo" },
  ];
  assert.equal(pickFirstRaceResultPayload(rows), null);
});

test("placement=null når rank mangler, men race_id bevares", () => {
  const rows = [{ race: { id: "race-y" } }];
  assert.deepEqual(pickFirstRaceResultPayload(rows), { race_id: "race-y", placement: null });
});

test("et tal-rank slår en null-rank uanset rækkefølge", () => {
  const rows = [
    { rank: 9, race: { id: "race-1" } },
    { race: { id: "race-2" } }, // ingen rank → Infinity
  ];
  assert.deepEqual(pickFirstRaceResultPayload(rows), { race_id: "race-1", placement: 9 });
});
