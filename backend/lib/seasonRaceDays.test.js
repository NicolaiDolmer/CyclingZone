import test from "node:test";
import assert from "node:assert/strict";

import { sumCompletedRaceDays, recomputeSeasonRaceDays } from "./seasonRaceDays.js";

test("sumCompletedRaceDays: ét race day pr. etape, kun completede løb tæller", () => {
  const races = [
    { status: "completed", stages: 1 },   // endagsløb → 1
    { status: "completed", stages: 21 },  // grand tour → 21
    { status: "upcoming", stages: 7 },    // ikke kørt → 0
    { status: "completed", stages: 5 },   // etapeløb → 5
  ];
  assert.equal(sumCompletedRaceDays(races), 27);
});

test("sumCompletedRaceDays: stages null/0/undefined tæller som 1 (matcher DEFAULT 1)", () => {
  const races = [
    { status: "completed", stages: null },
    { status: "completed", stages: 0 },
    { status: "completed" },
  ];
  assert.equal(sumCompletedRaceDays(races), 3);
});

test("sumCompletedRaceDays: tom liste → 0", () => {
  assert.equal(sumCompletedRaceDays([]), 0);
  assert.equal(sumCompletedRaceDays(), 0);
});

test("sumCompletedRaceDays: ingen completede løb → 0", () => {
  assert.equal(sumCompletedRaceDays([{ status: "upcoming", stages: 21 }]), 0);
});

function makeSupabase({ races, capturedUpdate }) {
  return {
    from(table) {
      if (table === "races") {
        return {
          select() {
            return {
              eq: (_col, seasonId) => {
                capturedUpdate.racesQueriedFor = seasonId;
                return Promise.resolve({ data: races, error: null });
              },
            };
          },
        };
      }
      if (table === "seasons") {
        return {
          update(payload) {
            capturedUpdate.payload = payload;
            return {
              eq: (_col, seasonId) => {
                capturedUpdate.updatedSeasonId = seasonId;
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("recomputeSeasonRaceDays: skriver summen af completede etaper til den rigtige sæson", async () => {
  const captured = {};
  const supabase = makeSupabase({
    races: [
      { status: "completed", stages: 6 },
      { status: "completed", stages: 1 },
      { status: "active", stages: 21 },
    ],
    capturedUpdate: captured,
  });

  const result = await recomputeSeasonRaceDays({ supabase, seasonId: "season-1" });

  assert.equal(result, 7);
  assert.deepEqual(captured.payload, { race_days_completed: 7 });
  assert.equal(captured.updatedSeasonId, "season-1");
  assert.equal(captured.racesQueriedFor, "season-1");
});

test("recomputeSeasonRaceDays: idempotent — samme input giver samme værdi", async () => {
  const races = [{ status: "completed", stages: 3 }, { status: "completed", stages: 4 }];
  const a = await recomputeSeasonRaceDays({ supabase: makeSupabase({ races, capturedUpdate: {} }), seasonId: "s" });
  const b = await recomputeSeasonRaceDays({ supabase: makeSupabase({ races, capturedUpdate: {} }), seasonId: "s" });
  assert.equal(a, 7);
  assert.equal(b, 7);
});

test("recomputeSeasonRaceDays: kræver supabase + seasonId", async () => {
  await assert.rejects(() => recomputeSeasonRaceDays({ supabase: null, seasonId: "s" }));
  await assert.rejects(() => recomputeSeasonRaceDays({ supabase: { from() {} }, seasonId: null }));
});

test("recomputeSeasonRaceDays: kaster ved DB-fejl under hentning", async () => {
  const supabase = {
    from() {
      return { select() { return { eq: () => Promise.resolve({ data: null, error: { message: "boom" } }) }; } };
    },
  };
  await assert.rejects(() => recomputeSeasonRaceDays({ supabase, seasonId: "s" }), /boom/);
});
