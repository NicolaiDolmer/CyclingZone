import test from "node:test";
import assert from "node:assert/strict";

import { recordRiderOwnershipEvent, attributeTeamExitEvent, RIDER_OWNERSHIP_REASON } from "./riderOwnershipAudit.js";

function makeSupabase({ error = null } = {}) {
  const inserts = [];
  return {
    from(table) {
      assert.equal(table, "rider_ownership_events");
      return {
        insert(payload) {
          inserts.push(payload);
          return Promise.resolve({ error });
        },
      };
    },
    _inserts: inserts,
  };
}

test("recordRiderOwnershipEvent skriver en fuld række med alle felter", async () => {
  const supabase = makeSupabase();
  const result = await recordRiderOwnershipEvent(supabase, {
    riderId: "rider-1",
    riderFirstname: "Seojun",
    riderLastname: "Choi",
    fromTeamId: "seller-team",
    toTeamId: "buyer-team",
    reason: RIDER_OWNERSHIP_REASON.AUCTION_WIN,
    relatedEntityType: "auction",
    relatedEntityId: "auction-1",
    actorType: "cron",
    actorId: null,
    occurredAt: "2026-08-09T07:18:59.371Z",
    idempotencyKey: "auction_winner:auction-1",
  });

  assert.deepEqual(result, { ok: true, skipped: false });
  assert.deepEqual(supabase._inserts, [{
    rider_id: "rider-1",
    rider_firstname: "Seojun",
    rider_lastname: "Choi",
    from_team_id: "seller-team",
    to_team_id: "buyer-team",
    reason: "auction_win",
    related_entity_type: "auction",
    related_entity_id: "auction-1",
    actor_type: "cron",
    actor_id: null,
    idempotency_key: "auction_winner:auction-1",
    occurred_at: "2026-08-09T07:18:59.371Z",
  }]);
});

test("recordRiderOwnershipEvent tillader NULL from/to (fri agent i begge retninger)", async () => {
  const supabase = makeSupabase();
  await recordRiderOwnershipEvent(supabase, {
    riderId: "rider-2",
    fromTeamId: null,
    toTeamId: "buyer-team",
    reason: RIDER_OWNERSHIP_REASON.FREE_AGENT_SIGNING,
  });

  assert.equal(supabase._inserts[0].from_team_id, null);
  assert.equal(supabase._inserts[0].to_team_id, "buyer-team");
});

test("recordRiderOwnershipEvent er non-fatal ved en generel DB-fejl (tabellen findes fx ikke endnu)", async () => {
  const supabase = makeSupabase({ error: { message: "relation \"rider_ownership_events\" does not exist" } });
  const result = await recordRiderOwnershipEvent(supabase, {
    riderId: "rider-3",
    toTeamId: "buyer-team",
    reason: RIDER_OWNERSHIP_REASON.TRADE,
  });

  // Kaster ALDRIG — se modul-header. Kalderen (allerede efter den rigtige
  // mutation) må aldrig kunne rulles tilbage af denne fejl.
  assert.deepEqual(result, { ok: false, skipped: false });
});

test("recordRiderOwnershipEvent no-op'er stille på 23505 (cron-retry af allerede-logget hændelse)", async () => {
  const supabase = makeSupabase({ error: { code: "23505", message: "duplicate key" } });
  const result = await recordRiderOwnershipEvent(supabase, {
    riderId: "rider-4",
    toTeamId: "buyer-team",
    reason: RIDER_OWNERSHIP_REASON.AUCTION_WIN,
    idempotencyKey: "auction_winner:auction-4",
  });

  assert.deepEqual(result, { ok: true, skipped: true });
});

test("recordRiderOwnershipEvent kaster aldrig — manglende riderId fanges og logges i stedet", async () => {
  const supabase = makeSupabase();
  const result = await recordRiderOwnershipEvent(supabase, {
    reason: RIDER_OWNERSHIP_REASON.ADMIN,
  });

  assert.deepEqual(result, { ok: false, skipped: false });
  assert.deepEqual(supabase._inserts, [], "intet forsøgt skrevet uden riderId");
});

test("RIDER_OWNERSHIP_REASON dækker alle veje nævnt i #3582-issuet", () => {
  assert.deepEqual(Object.values(RIDER_OWNERSHIP_REASON).sort(), [
    "academy_promotion",
    "admin",
    "auction_win",
    "free_agent_signing",
    "guaranteed_bank_sale",
    "release",
    "season_transition",
    "stage_race_deferred_flush",
    "swap",
    "trade",
  ]);
});

// #6504: admin-flytningen til intet hold tilskriver triggerens række i stedet for
// at skrive en dublet, og KUN hvis rytterens nyeste række er netop denne udgang.
function makeUpdateSupabase({ found = [{ id: 7, from_team_id: "team-a", to_team_id: null, actor_type: "system" }], findError = null, data = [{ id: 7 }], error = null } = {}) {
  const calls = { patch: null, find: [], update: [], order: [], limit: null };
  return {
    from(table) {
      assert.equal(table, "rider_ownership_events");
      return {
        select() {
          const q = {
            eq(c, v) { calls.find.push([c, v]); return q; },
            order(c, o) { calls.order.push([c, o.ascending]); return q; },
            limit(n) { calls.limit = n; return Promise.resolve({ data: found, error: findError }); },
          };
          return q;
        },
        update(patch) {
          calls.patch = patch;
          const q = {
            eq(c, v) { calls.update.push([c, v]); return q; },
            select() { return Promise.resolve({ data, error }); },
          };
          return q;
        },
      };
    },
    _calls: calls,
  };
}

const ATTR = { riderId: "rider-1", fromTeamId: "team-a", reason: RIDER_OWNERSHIP_REASON.ADMIN, relatedEntityType: "manual", actorType: "admin", actorId: "admin-1" };

test("attributeTeamExitEvent tilskriver rytterens nyeste række, når den er netop denne udgang", async () => {
  const supabase = makeUpdateSupabase();
  assert.deepEqual(await attributeTeamExitEvent(supabase, ATTR), { ok: true, updated: 1 });
  assert.deepEqual(supabase._calls.find, [["rider_id", "rider-1"]]);
  assert.deepEqual(supabase._calls.order, [["created_at", false], ["id", false]]);
  assert.equal(supabase._calls.limit, 1);
  assert.deepEqual(supabase._calls.update, [["id", 7], ["actor_type", "system"]]);
  assert.deepEqual(supabase._calls.patch, { reason: "admin", related_entity_type: "manual", actor_type: "admin", actor_id: "admin-1" });
});

test("attributeTeamExitEvent rører intet, når den nyeste række ikke er denne udgang (fx før triggeren findes)", async () => {
  for (const found of [
    [],
    [{ id: 3, from_team_id: null, to_team_id: "team-a", actor_type: "cron" }],
    [{ id: 4, from_team_id: "team-b", to_team_id: null, actor_type: "system" }],
    [{ id: 5, from_team_id: "team-a", to_team_id: null, actor_type: "admin" }],
  ]) {
    const supabase = makeUpdateSupabase({ found });
    assert.deepEqual(await attributeTeamExitEvent(supabase, ATTR), { ok: true, updated: 0 });
    assert.equal(supabase._calls.patch, null);
  }
});

test("attributeTeamExitEvent kaster aldrig ved DB-fejl", async () => {
  const supabase = makeUpdateSupabase({ found: null, findError: { message: "boom" } });
  assert.deepEqual(await attributeTeamExitEvent(supabase, ATTR), { ok: false, updated: 0 });
});
