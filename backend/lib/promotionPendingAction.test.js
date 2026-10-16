// #6710: trupsidens "Afventer oprykning" + "Ryk op" (promotionPendingAction.js).
import test from "node:test";
import assert from "node:assert/strict";

import {
  listPendingPromotions,
  promotePendingRider,
  handleListPendingRequest,
  handlePromotePendingRequest,
} from "./promotionPendingAction.js";

// Mock: riders (list med eq/not/order + maybeSingle + conditional update) og
// academy_graduation (restempling: select ... maybeSingle + update.eq).
function makeSupabase({ riders = [], gradRows = [] } = {}) {
  const rec = { riderUpdates: [], gradUpdates: [] };
  const supabase = {
    from(table) {
      if (table === "riders") {
        return {
          select() {
            const filters = [];
            const api = {
              eq(col, val) { filters.push(["eq", col, val]); return api; },
              not(col, op, val) { filters.push(["not-is", col, val]); return api; },
              order() {
                const out = riders.filter((r) => filters.every(([op, c, v]) =>
                  op === "eq" ? r[c] === v : (r[c] ?? null) !== v));
                return Promise.resolve({ data: out, error: null });
              },
              maybeSingle() {
                const id = filters.find(([, c]) => c === "id")?.[2];
                return Promise.resolve({ data: riders.find((r) => r.id === id) ?? null, error: null });
              },
            };
            return api;
          },
          update(payload) {
            const filters = [];
            const b = {
              eq(col, val) { filters.push([col, val]); return b; },
              then(resolve, reject) {
                rec.riderUpdates.push({ payload, filters });
                return Promise.resolve({ error: null }).then(resolve, reject);
              },
            };
            return b;
          },
        };
      }
      if (table === "academy_graduation") {
        return {
          select() {
            const filters = [];
            const api = {
              eq(col, val) { filters.push([col, val]); return api; },
              order() { return api; },
              limit() { return api; },
              maybeSingle() {
                const hit = gradRows.find((g) => filters.every(([c, v]) => g[c] === v));
                return Promise.resolve({ data: hit ?? null, error: null });
              },
            };
            return api;
          },
          update(payload) {
            return { eq(col, val) { rec.gradUpdates.push({ ...payload, __eq: [col, val] }); return Promise.resolve({ error: null }); } };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { supabase, rec };
}

const JUNIOR_WAITING = {
  id: "r1", team_id: "t1", firstname: "Ada", lastname: "Junior", birthdate: "2009-03-01",
  squad: "junior", is_academy: true, is_retired: false,
  promotion_pending_to: "u23", promotion_pending_since: "2026-11-01T21:00:00.000Z",
};
const U23_WAITING = {
  id: "r2", team_id: "t1", firstname: "Bo", lastname: "Under", birthdate: "2005-03-01",
  squad: "u23", is_academy: true, is_retired: false,
  promotion_pending_to: "senior", promotion_pending_since: "2026-11-01T21:00:00.000Z",
};
// Stale: allerede flyttet op ad en anden vej — felterne er harmløse og skal ikke vises.
const ALREADY_MOVED = {
  id: "r3", team_id: "t1", firstname: "Cy", lastname: "Moved", birthdate: "2009-03-01",
  squad: "u23", is_academy: true, is_retired: false,
  promotion_pending_to: "u23", promotion_pending_since: "2026-11-01T21:00:00.000Z",
};
const EXPIRED_GRAD = { id: "g1", team_id: "t1", rider_id: "r1", status: "expired" };

const FIXED_NOW = new Date("2026-10-16T12:00:00Z");

test("#6710 listPendingPromotions: viser kun aktive ventende med plads pr. maal-trup", async () => {
  const { supabase } = makeSupabase({ riders: [JUNIOR_WAITING, U23_WAITING, ALREADY_MOVED] });
  const checked = [];
  const roomCheck = async (_sb, { targetSquad }) => { checked.push(targetSquad); return targetSquad === "u23"; };
  const out = await listPendingPromotions(supabase, { teamId: "t1", seasonNumber: 5, roomCheck });
  assert.deepEqual(out.riders.map((r) => [r.id, r.from, r.to, r.canPromote]), [
    ["r1", "junior", "u23", true],
    ["r2", "u23", "senior", false],
  ]);
  assert.deepEqual(out.room, { u23: true, senior: false });
  assert.deepEqual(checked.sort(), ["senior", "u23"], "eet plads-tjek pr. maal-trup");
});

test("#6710 promotePendingRider: flytter via moveRider til maal-truppen, rydder felterne og restempler grad-raekken", async () => {
  const { supabase, rec } = makeSupabase({ riders: [JUNIOR_WAITING], gradRows: [EXPIRED_GRAD] });
  const moves = [];
  const move = async (_sb, args) => { moves.push(args); return { riderId: args.riderId, action: "moved", from: "junior", to: args.targetSquad }; };
  const res = await promotePendingRider(supabase, { teamId: "t1", riderId: "r1", seasonNumber: 5, move, now: FIXED_NOW });

  assert.equal(moves.length, 1);
  assert.equal(moves[0].targetSquad, "u23");
  assert.equal(moves[0].teamId, "t1");
  assert.equal(res.promotedFromPending, true);
  assert.equal(res.to, "u23");
  assert.deepEqual(rec.riderUpdates[0].payload, { promotion_pending_to: null, promotion_pending_since: null });
  assert.equal(rec.gradUpdates.length, 1);
  assert.equal(rec.gradUpdates[0].status, "promoted");
  assert.deepEqual(rec.gradUpdates[0].__eq, ["id", "g1"]);
});

test("#6710 promotePendingRider: fuld maal-trup → moveRider's squad_full bobler op, intet ryddes", async () => {
  const { supabase, rec } = makeSupabase({ riders: [U23_WAITING], gradRows: [] });
  const move = async () => { throw new Error("squad_full"); };
  await assert.rejects(() => promotePendingRider(supabase, { teamId: "t1", riderId: "r2", seasonNumber: 5, move, now: FIXED_NOW }), /squad_full/);
  assert.equal(rec.riderUpdates.length, 0);
});

test("#6710 promotePendingRider: andet hold / ikke ventende / ukendt rytter afvises uden flytning", async () => {
  const { supabase } = makeSupabase({ riders: [{ ...JUNIOR_WAITING, team_id: "t2" }, ALREADY_MOVED] });
  const move = async () => { throw new Error("must not move"); };
  await assert.rejects(() => promotePendingRider(supabase, { teamId: "t1", riderId: "r1", seasonNumber: 5, move, now: FIXED_NOW }), /not_owned/);
  await assert.rejects(() => promotePendingRider(supabase, { teamId: "t1", riderId: "r3", seasonNumber: 5, move, now: FIXED_NOW }), /not_pending/);
  await assert.rejects(() => promotePendingRider(supabase, { teamId: "t1", riderId: "nope", seasonNumber: 5, move, now: FIXED_NOW }), /rider_not_found/);
});

test("#6710 handleListPendingRequest: flag off → allerede afventende ryttere vises stadig (rollback-sikker)", async () => {
  const out = await handleListPendingRequest({}, {
    teamId: "t1", seasonNumber: 5, isEnabled: async () => false,
    list: async () => ({ riders: [{ id: "r1" }], room: { u23: true } }),
  });
  assert.deepEqual(out, { status: 200, body: { enabled: false, riders: [{ id: "r1" }], room: { u23: true } } });
});

test("#6710 handleListPendingRequest: flag off foer migrationen (kolonne mangler) → tom liste", async () => {
  const out = await handleListPendingRequest({}, {
    teamId: "t1", seasonNumber: 5, isEnabled: async () => false,
    list: async () => { throw new Error("column riders.promotion_pending_to does not exist"); },
  });
  assert.deepEqual(out, { status: 200, body: { enabled: false, riders: [], room: {} } });
});

test("#6710 handleListPendingRequest: flag on → listen + enabled", async () => {
  const out = await handleListPendingRequest({}, {
    teamId: "t1", seasonNumber: 5, isEnabled: async () => true,
    list: async () => ({ riders: [{ id: "r1" }], room: { u23: true } }),
  });
  assert.deepEqual(out, { status: 200, body: { enabled: true, riders: [{ id: "r1" }], room: { u23: true } } });
});

test("#6710 handlePromotePendingRequest: flag off → en afventende rytter kan stadig rykkes op", async () => {
  const out = await handlePromotePendingRequest({}, {
    teamId: "t1", riderId: "r1", seasonNumber: 5, isEnabled: async () => false,
    promote: async () => ({ riderId: "r1", promotedFromPending: true }),
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.promotedFromPending, true);
});

test("#6710 handlePromotePendingRequest: flag off + ukendt fejl (foer migrationen) → 409 disabled", async () => {
  const out = await handlePromotePendingRequest({}, {
    teamId: "t1", riderId: "r1", seasonNumber: 5, isEnabled: async () => false,
    promote: async () => { throw new Error("column riders.promotion_pending_to does not exist"); },
  });
  assert.equal(out.status, 409);
  assert.equal(out.body.errorCode, "promotion_pending_disabled");
});

test("#6710 handlePromotePendingRequest: forventede afvisninger → 4xx med errorCode; uventede kastes", async () => {
  const run = (msg) => handlePromotePendingRequest({}, {
    teamId: "t1", riderId: "r1", seasonNumber: 5, isEnabled: async () => true,
    promote: async () => { throw new Error(msg); },
  });
  assert.deepEqual(await run("squad_full"), { status: 409, body: { error: "squad_full", errorCode: "squad_full" } });
  assert.equal((await run("not_pending")).status, 409);
  assert.equal((await run("not_owned")).status, 403);
  assert.equal((await run("rider_not_found")).status, 404);
  await assert.rejects(() => run("db exploded"), /db exploded/);
});

test("#6710 handlePromotePendingRequest: succes → 200 med resultatet", async () => {
  const out = await handlePromotePendingRequest({}, {
    teamId: "t1", riderId: "r1", seasonNumber: 5, isEnabled: async () => true,
    promote: async () => ({ riderId: "r1", action: "moved", to: "u23", promotedFromPending: true }),
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.promotedFromPending, true);
});
