import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRiderValueSnapshot,
  isDealValueSnapshotSchemaPending,
  updateDealWithValueSnapshot,
} from "./dealValueSnapshot.js";

// Fake der svarer med de givne fejl i rækkefølge og logger hver UPDATE.
function makeSupabase(errors = []) {
  const updates = [];
  return {
    updates,
    from(table) {
      return {
        update(payload) {
          return {
            eq(column, value) {
              updates.push({ table, payload, column, value });
              return Promise.resolve({ error: errors.shift() ?? null });
            },
          };
        },
      };
    },
  };
}

test("buildRiderValueSnapshot navngiver kolonner og runder til heltal", () => {
  assert.deepEqual(
    buildRiderValueSnapshot({ market_value: 123456.6, base_value: "90000" }, { suffix: "at_close" }),
    { rider_market_value_at_close: 123457, rider_base_value_at_close: 90000 }
  );
  assert.deepEqual(
    buildRiderValueSnapshot(null, { prefix: "offered_rider", suffix: "at_accept" }),
    { offered_rider_market_value_at_accept: null, offered_rider_base_value_at_accept: null }
  );
});

test("updateDealWithValueSnapshot skriver status og snapshot i samme UPDATE", async () => {
  const supabase = makeSupabase();
  const result = await updateDealWithValueSnapshot(supabase, {
    table: "transfer_offers",
    id: "offer-1",
    payload: { status: "accepted" },
    snapshot: { rider_market_value_at_accept: 500000, rider_base_value_at_accept: 400000 },
  });
  assert.deepEqual(result, { snapshotWritten: true });
  assert.equal(supabase.updates.length, 1);
  assert.deepEqual(supabase.updates[0], {
    table: "transfer_offers",
    payload: { status: "accepted", rider_market_value_at_accept: 500000, rider_base_value_at_accept: 400000 },
    column: "id",
    value: "offer-1",
  });
});

test("updateDealWithValueSnapshot udelader snapshot når rytterværdien mangler", async () => {
  const supabase = makeSupabase();
  await updateDealWithValueSnapshot(supabase, {
    table: "auctions",
    id: "a-1",
    payload: { status: "completed" },
    snapshot: { rider_market_value_at_close: null, rider_base_value_at_close: null },
  });
  assert.deepEqual(supabase.updates[0].payload, { status: "completed" });
});

test("auto-migrate-vinduet: manglende kolonne → gentag uden snapshot", async () => {
  const supabase = makeSupabase([
    { code: "PGRST204", message: "Could not find the 'rider_market_value_at_accept' column of 'transfer_offers' in the schema cache" },
  ]);
  const result = await updateDealWithValueSnapshot(supabase, {
    table: "transfer_offers",
    id: "offer-1",
    payload: { status: "accepted" },
    snapshot: { rider_market_value_at_accept: 500000, rider_base_value_at_accept: 400000 },
  });
  assert.deepEqual(result, { snapshotWritten: false });
  assert.equal(supabase.updates.length, 2);
  assert.deepEqual(supabase.updates[1].payload, { status: "accepted" });
});

test("andre fejl kastes og gentages ikke", async () => {
  const supabase = makeSupabase([{ code: "23505", message: "duplicate key" }]);
  await assert.rejects(
    updateDealWithValueSnapshot(supabase, {
      table: "transfer_offers",
      id: "offer-1",
      payload: { status: "accepted" },
      snapshot: { rider_market_value_at_accept: 1 },
    })
  );
  assert.equal(supabase.updates.length, 1);
});

test("isDealValueSnapshotSchemaPending kræver at fejlen nævner en snapshot-kolonne", () => {
  const cols = ["rider_market_value_at_close"];
  assert.equal(isDealValueSnapshotSchemaPending({ code: "42703", message: 'column "rider_market_value_at_close" does not exist' }, cols), true);
  assert.equal(isDealValueSnapshotSchemaPending({ code: "42703", message: 'column "other" does not exist' }, cols), false);
  assert.equal(isDealValueSnapshotSchemaPending(null, cols), false);
});
