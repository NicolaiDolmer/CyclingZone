import test from "node:test";
import assert from "node:assert/strict";

import { recordRiderOwnershipEvent, RIDER_OWNERSHIP_REASON } from "./riderOwnershipAudit.js";

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
