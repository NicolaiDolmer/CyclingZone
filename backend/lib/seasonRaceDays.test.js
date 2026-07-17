import test from "node:test";
import assert from "node:assert/strict";

import { countDistinctRaceDays, recomputeSeasonRaceDays } from "./seasonRaceDays.js";

test("countDistinctRaceDays: tæller distinkte game_day_start blandt completede løb", () => {
  const races = [
    { status: "completed", game_day_start: 0 },
    { status: "completed", game_day_start: 3 },   // grand tour, samme start-dag som ingen andre
    { status: "upcoming", game_day_start: 10 },   // ikke kørt → tæller ikke
    { status: "completed", game_day_start: 3 },    // parallel division, SAMME kalenderdag → tæller ikke ekstra
  ];
  assert.equal(countDistinctRaceDays(races, { completedOnly: true }), 2);
});

test("countDistinctRaceDays: uden completedOnly tæller ALLE løb (planlagt kalender)", () => {
  const races = [
    { status: "completed", game_day_start: 0 },
    { status: "upcoming", game_day_start: 10 },
    { status: "active", game_day_start: 20 },
  ];
  assert.equal(countDistinctRaceDays(races), 3);
});

test("countDistinctRaceDays: løb uden game_day_start (null/undefined) tæller ikke", () => {
  const races = [
    { status: "completed", game_day_start: null },
    { status: "completed", game_day_start: undefined },
    { status: "completed" },
  ];
  assert.equal(countDistinctRaceDays(races, { completedOnly: true }), 0);
});

test("countDistinctRaceDays: tom liste → 0", () => {
  assert.equal(countDistinctRaceDays([]), 0);
  assert.equal(countDistinctRaceDays(), 0);
});

test("countDistinctRaceDays: ingen completede løb → 0", () => {
  assert.equal(countDistinctRaceDays([{ status: "upcoming", game_day_start: 5 }], { completedOnly: true }), 0);
});

test("countDistinctRaceDays: mange divisioner der afvikler løb parallelt SAMME dag tæller som ÉN dag (#2512-regression)", () => {
  // 4 divisioner afvikler hver et endagsløb på game_day_start=7 → tidligere (SUM(stages))
  // ville dette have talt som 4 race-days; korrekt enhed er 1 kalenderdag.
  const races = Array.from({ length: 4 }, () => ({ status: "completed", game_day_start: 7 }));
  assert.equal(countDistinctRaceDays(races, { completedOnly: true }), 1);
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

test("recomputeSeasonRaceDays: skriver BÅDE race_days_completed og race_days_total (distinkte kalenderdage)", async () => {
  const captured = {};
  const supabase = makeSupabase({
    races: [
      { status: "completed", game_day_start: 0 },
      { status: "completed", game_day_start: 1 },
      { status: "active", game_day_start: 2 },     // ikke completed, men tæller med i total
      { status: "upcoming", game_day_start: 27 },   // fremtidig kalenderdag, tæller med i total
    ],
    capturedUpdate: captured,
  });

  const result = await recomputeSeasonRaceDays({ supabase, seasonId: "season-1" });

  assert.equal(result, 2);
  assert.deepEqual(captured.payload, { race_days_completed: 2, race_days_total: 4 });
  assert.equal(captured.updatedSeasonId, "season-1");
  assert.equal(captured.racesQueriedFor, "season-1");
});

test("recomputeSeasonRaceDays: parallelle divisioner på samme dag inflaterer IKKE completed (#2512)", async () => {
  const captured = {};
  // 20 løb, men kun 3 distinkte kalenderdage completed — tidligere SUM(stages)-bug
  // ville have talt op mod 20+ for én kalenderdag med mange divisioner.
  const races = [
    ...Array.from({ length: 8 }, () => ({ status: "completed", game_day_start: 0 })),
    ...Array.from({ length: 8 }, () => ({ status: "completed", game_day_start: 1 })),
    ...Array.from({ length: 4 }, () => ({ status: "completed", game_day_start: 2 })),
  ];
  const supabase = makeSupabase({ races, capturedUpdate: captured });

  const result = await recomputeSeasonRaceDays({ supabase, seasonId: "season-1" });

  assert.equal(result, 3);
  assert.deepEqual(captured.payload, { race_days_completed: 3, race_days_total: 3 });
});

test("recomputeSeasonRaceDays: idempotent — samme input giver samme værdi", async () => {
  const races = [
    { status: "completed", game_day_start: 0 },
    { status: "completed", game_day_start: 1 },
  ];
  const a = await recomputeSeasonRaceDays({ supabase: makeSupabase({ races, capturedUpdate: {} }), seasonId: "s" });
  const b = await recomputeSeasonRaceDays({ supabase: makeSupabase({ races, capturedUpdate: {} }), seasonId: "s" });
  assert.equal(a, 2);
  assert.equal(b, 2);
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
