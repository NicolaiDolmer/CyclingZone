/**
 * Unit-tests for route-helpers der er eksporteret fra api.js til testbarhed.
 * Kører med: node --test backend/routes/api.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import router, { assertTeamNotTransferFrozen, claimSeasonEndOrReject, countPendingRaceResults } from "./api.js";

// Minimal fake res der opfanger status + json
function fakeRes() {
  const r = {
    code: null,
    body: null,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return r;
}

// ── assertTeamNotTransferFrozen ──────────────────────────────────────────────

test("assertTeamNotTransferFrozen — returnerer false og sender 403 når transfer_frozen=true", () => {
  const req = { team: { transfer_frozen: true } };
  const res = fakeRes();

  const result = assertTeamNotTransferFrozen(req, res);

  assert.equal(result, false, "skal returnere false");
  assert.equal(res.code, 403, "skal sætte status 403");
  assert.equal(res.body?.errorCode, "team_transfer_frozen", "skal sætte errorCode");
  assert.ok(typeof res.body?.error === "string" && res.body.error.length > 0, "skal have en fejlbesked");
});

test("assertTeamNotTransferFrozen — returnerer true og svarer IKKE når transfer_frozen=false", () => {
  const req = { team: { transfer_frozen: false } };
  const res = fakeRes();

  const result = assertTeamNotTransferFrozen(req, res);

  assert.equal(result, true, "skal returnere true");
  assert.equal(res.code, null, "må ikke kalde status()");
  assert.equal(res.body, null, "må ikke kalde json()");
});

test("assertTeamNotTransferFrozen — returnerer true og svarer IKKE når transfer_frozen mangler (undefined)", () => {
  const req = { team: { transfer_frozen: undefined } };
  const res = fakeRes();

  const result = assertTeamNotTransferFrozen(req, res);

  assert.equal(result, true, "udefineret transfer_frozen = ikke frosset");
  assert.equal(res.code, null);
  assert.equal(res.body, null);
});

test("assertTeamNotTransferFrozen — returnerer true og svarer IKKE når req.team er null", () => {
  const req = { team: null };
  const res = fakeRes();

  const result = assertTeamNotTransferFrozen(req, res);

  assert.equal(result, true, "null team = ikke frosset (eksisterende guard håndterer det)");
  assert.equal(res.code, null);
  assert.equal(res.body, null);
});

// ── claimSeasonEndOrReject (#2847 — dobbelt-POST-garanti) ────────────────────
// Minimal fake supabase der kun implementerer .from("season_end_claims").insert(...).
function fakeSupabaseForClaim(insertResult) {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        return {
          insert(row) {
            calls.push({ table, row });
            return Promise.resolve(insertResult);
          },
        };
      },
    },
  };
}

test("claimSeasonEndOrReject — vinder claim'et (INSERT lykkes) → returnerer true, rører ikke res", async () => {
  const { client, calls } = fakeSupabaseForClaim({ error: null });
  const res = fakeRes();

  const result = await claimSeasonEndOrReject(client, "season-1", res);

  assert.equal(result, true);
  assert.equal(res.code, null, "må ikke kalde status() ved vundet claim");
  assert.deepEqual(calls, [{ table: "season_end_claims", row: { season_id: "season-1" } }]);
});

test("claimSeasonEndOrReject — taber claim'et (23505 unique_violation) → 409 + false", async () => {
  const { client } = fakeSupabaseForClaim({ error: { code: "23505", message: "duplicate key" } });
  const res = fakeRes();

  const result = await claimSeasonEndOrReject(client, "season-1", res);

  assert.equal(result, false);
  assert.equal(res.code, 409);
  assert.ok(typeof res.body?.error === "string" && res.body.error.length > 0);
});

test("claimSeasonEndOrReject — anden DB-fejl (ikke 23505) → 500 + false", async () => {
  const { client } = fakeSupabaseForClaim({ error: { code: "42P01", message: "relation does not exist" } });
  const res = fakeRes();

  const result = await claimSeasonEndOrReject(client, "season-1", res);

  assert.equal(result, false);
  assert.equal(res.code, 500);
  assert.equal(res.body?.error, "relation does not exist");
});

// ── Route-rækkefølge: statiske stier før parametriserede (#1479) ──────────────
// Express matcher routes i registrerings-rækkefølge. Hvis POST /training/:riderId
// står FØR POST /training/run-today, fanger :riderId-routen "run-today" som et
// rytter-id, kalder isValidFocus(undefined) → "invalid_focus" og blokerer "Træn
// i dag"-knappen helt. Denne test låser rækkefølgen fast.
function postRouteIndex(path) {
  return router.stack.findIndex(
    (layer) => layer.route?.path === path && layer.route?.methods?.post,
  );
}

test("POST /training/run-today registreres FØR POST /training/:riderId (#1479)", () => {
  const runTodayIdx = postRouteIndex("/training/run-today");
  const riderIdIdx = postRouteIndex("/training/:riderId");

  assert.notEqual(runTodayIdx, -1, "run-today POST-route skal være registreret");
  assert.notEqual(riderIdIdx, -1, ":riderId POST-route skal være registreret");
  assert.ok(
    runTodayIdx < riderIdIdx,
    `run-today (idx ${runTodayIdx}) skal stå før :riderId (idx ${riderIdIdx}) — ellers blokeres træning af invalid_focus`,
  );
});

test("POST /training/bulk registreres FØR POST /training/:riderId (#1885)", () => {
  const bulkIdx = postRouteIndex("/training/bulk");
  const riderIdIdx = postRouteIndex("/training/:riderId");

  assert.notEqual(bulkIdx, -1, "bulk POST-route skal være registreret");
  assert.notEqual(riderIdIdx, -1, ":riderId POST-route skal være registreret");
  assert.ok(
    bulkIdx < riderIdIdx,
    `bulk (idx ${bulkIdx}) skal stå før :riderId (idx ${riderIdIdx}) — ellers matcher :riderId "bulk" som et rytter-id`,
  );
});

// ── #1895 PR 2: pr-rytter ugerytme-override-routes ────────────────────────────
function putRouteIndex(path) {
  return router.stack.findIndex(
    (layer) => layer.route?.path === path && layer.route?.methods?.put,
  );
}
function deleteRouteIndex(path) {
  return router.stack.findIndex(
    (layer) => layer.route?.path === path && layer.route?.methods?.delete,
  );
}

test("PUT/DELETE /training/week-plan/:riderId registreres FØR POST/DELETE /training/:riderId (#1895 PR 2)", () => {
  const putWeekPlanRiderIdx = putRouteIndex("/training/week-plan/:riderId");
  const deleteWeekPlanRiderIdx = deleteRouteIndex("/training/week-plan/:riderId");
  const postRiderIdIdx = postRouteIndex("/training/:riderId");
  const deleteRiderIdIdx = deleteRouteIndex("/training/:riderId");

  assert.notEqual(putWeekPlanRiderIdx, -1, "PUT week-plan/:riderId skal være registreret");
  assert.notEqual(deleteWeekPlanRiderIdx, -1, "DELETE week-plan/:riderId skal være registreret");
  assert.ok(putWeekPlanRiderIdx < postRiderIdIdx, "PUT week-plan/:riderId skal stå før POST :riderId");
  assert.ok(deleteWeekPlanRiderIdx < deleteRiderIdIdx, "DELETE week-plan/:riderId skal stå før DELETE :riderId");
});

// ── countPendingRaceResults (#3014 — URL-længde-cap ved mange løb) ───────────
// Minimal fake supabase der spejler .from("pending_race_results").select(...,
// {count,head}).in("race_id", chunk).eq("status", "pending") og tracker hvor
// stor hver .in()-chunk var.
function fakeSupabaseForPendingCount(countsPerChunk) {
  const chunkSizes = [];
  let call = 0;
  return {
    chunkSizes,
    client: {
      from(table) {
        assert.equal(table, "pending_race_results");
        return {
          select() {
            return {
              in(column, ids) {
                assert.equal(column, "race_id");
                chunkSizes.push(ids.length);
                const count = countsPerChunk[call] ?? 0;
                call += 1;
                return {
                  eq(statusColumn, status) {
                    assert.equal(statusColumn, "status");
                    assert.equal(status, "pending");
                    return Promise.resolve({ count, error: null });
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

test("countPendingRaceResults — chunker id-listen (455 løb → 5 chunks af maks 100) og summer count", async () => {
  const raceIds = Array.from({ length: 455 }, (_, i) => `race-${i}`);
  const { client, chunkSizes } = fakeSupabaseForPendingCount([1, 0, 2, 0, 0]);

  const total = await countPendingRaceResults(client, raceIds);

  assert.deepEqual(chunkSizes, [100, 100, 100, 100, 55], "455 løb skal chunkes i 4×100 + 1×55");
  assert.equal(total, 3, "summen af pending-count på tværs af alle chunks");
});

test("countPendingRaceResults — under én chunk-størrelse giver ét kald", async () => {
  const raceIds = ["race-1", "race-2", "race-3"];
  const { client, chunkSizes } = fakeSupabaseForPendingCount([0]);

  const total = await countPendingRaceResults(client, raceIds);

  assert.deepEqual(chunkSizes, [3]);
  assert.equal(total, 0);
});

test("countPendingRaceResults — tom id-liste kalder aldrig supabase", async () => {
  const { client, chunkSizes } = fakeSupabaseForPendingCount([]);

  const total = await countPendingRaceResults(client, []);

  assert.deepEqual(chunkSizes, []);
  assert.equal(total, 0);
});

test("countPendingRaceResults — DB-fejl i en chunk kaster (kaldstedet svarer 500)", async () => {
  const raceIds = Array.from({ length: 150 }, (_, i) => `race-${i}`);
  let call = 0;
  const client = {
    from(table) {
      assert.equal(table, "pending_race_results");
      return {
        select() {
          return {
            in() {
              const thisCall = call;
              call += 1;
              return {
                eq() {
                  if (thisCall === 1) {
                    return Promise.resolve({ count: null, error: { message: "boom" } });
                  }
                  return Promise.resolve({ count: 0, error: null });
                },
              };
            },
          };
        },
      };
    },
  };

  await assert.rejects(
    () => countPendingRaceResults(client, raceIds),
    (err) => err.message === "boom",
  );
});
