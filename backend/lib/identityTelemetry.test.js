import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIdentityEventRow, getClientIp, recordIdentityEvent } from "./identityTelemetry.js";

function fakeReq({ ip = "203.0.113.7", userAgent = "Mozilla/5.0", acceptLanguage = "da-DK,da;q=0.9" } = {}) {
  return {
    ip,
    headers: {
      "user-agent": userAgent,
      "accept-language": acceptLanguage,
    },
  };
}

// ── getClientIp ─────────────────────────────────────────────────────────────

test("getClientIp returnerer req.ip når sat", () => {
  assert.equal(getClientIp(fakeReq({ ip: "198.51.100.4" })), "198.51.100.4");
});

test("getClientIp returnerer null uden req eller tom ip", () => {
  assert.equal(getClientIp(null), null);
  assert.equal(getClientIp({ ip: "" }), null);
  assert.equal(getClientIp({}), null);
});

// ── buildIdentityEventRow ───────────────────────────────────────────────────

test("buildIdentityEventRow returnerer null uden userId", () => {
  assert.equal(buildIdentityEventRow({ eventType: "signup", req: fakeReq() }), null);
});

test("buildIdentityEventRow returnerer null ved ugyldig event_type", () => {
  assert.equal(
    buildIdentityEventRow({ userId: "u1", eventType: "not_a_real_event", req: fakeReq() }),
    null
  );
});

test("buildIdentityEventRow bygger korrekt signup-payload", () => {
  const row = buildIdentityEventRow({
    userId: "u1",
    eventType: "signup",
    req: fakeReq({ ip: "203.0.113.7", userAgent: "TestUA/1.0", acceptLanguage: "en-US" }),
    firstSeenAt: "2026-07-30T10:00:00.000Z",
    timezoneOffsetMinutes: -120,
  });
  assert.deepEqual(row, {
    user_id: "u1",
    team_id: null,
    event_type: "signup",
    entity_id: null,
    ip: "203.0.113.7",
    user_agent: "TestUA/1.0",
    accept_language: "en-US",
    timezone_offset_minutes: -120,
    first_seen_at: "2026-07-30T10:00:00.000Z",
    metadata: null,
  });
});

test("buildIdentityEventRow bygger korrekt værdibærende-handling-payload", () => {
  const row = buildIdentityEventRow({
    userId: "u1",
    teamId: "t1",
    eventType: "auction_bid",
    entityId: "auction-123",
    req: fakeReq(),
  });
  assert.equal(row.event_type, "auction_bid");
  assert.equal(row.team_id, "t1");
  assert.equal(row.entity_id, "auction-123");
  assert.equal(row.first_seen_at, null);
});

test("buildIdentityEventRow tolererer manglende req (ingen ip/ua)", () => {
  const row = buildIdentityEventRow({ userId: "u1", eventType: "loan_taken", entityId: "loan-1" });
  assert.equal(row.ip, null);
  assert.equal(row.user_agent, null);
  assert.equal(row.accept_language, null);
});

test("buildIdentityEventRow klipper for lange felter og caster entity_id til string", () => {
  const longUa = "x".repeat(1000);
  const row = buildIdentityEventRow({
    userId: "u1",
    eventType: "swap_accepted",
    entityId: 42,
    req: fakeReq({ userAgent: longUa }),
  });
  assert.equal(row.user_agent.length, 500);
  assert.equal(row.entity_id, "42");
});

test("buildIdentityEventRow ignorerer ikke-numerisk timezoneOffsetMinutes", () => {
  const row = buildIdentityEventRow({
    userId: "u1",
    eventType: "transfer_accepted",
    timezoneOffsetMinutes: "not-a-number",
  });
  assert.equal(row.timezone_offset_minutes, null);
});

// ── recordIdentityEvent (fail-open) ─────────────────────────────────────────

test("recordIdentityEvent skriver via supabase.from(...).insert(...)", async () => {
  let capturedTable = null;
  let capturedRow = null;
  const fakeSupabase = {
    from(table) {
      capturedTable = table;
      return {
        insert: async (row) => {
          capturedRow = row;
          return { error: null };
        },
      };
    },
  };

  const result = await recordIdentityEvent(fakeSupabase, {
    userId: "u1",
    eventType: "signup",
    req: fakeReq(),
  });

  assert.equal(capturedTable, "identity_events");
  assert.equal(capturedRow.event_type, "signup");
  assert.equal(result.skipped, false);
});

test("recordIdentityEvent er fail-open når supabase returnerer en fejl", async () => {
  const fakeSupabase = {
    from: () => ({
      insert: async () => ({ error: { message: "boom" } }),
    }),
  };

  const result = await recordIdentityEvent(fakeSupabase, {
    userId: "u1",
    eventType: "signup",
    req: fakeReq(),
  });

  assert.equal(result.skipped, true);
  assert.equal(result.error, "boom");
});

test("recordIdentityEvent er fail-open når supabase.from kaster en exception", async () => {
  const fakeSupabase = {
    from: () => {
      throw new Error("connection refused");
    },
  };

  // Must never throw / reject — this is the core fail-open contract.
  const result = await recordIdentityEvent(fakeSupabase, {
    userId: "u1",
    eventType: "signup",
    req: fakeReq(),
  });

  assert.equal(result.skipped, true);
  assert.equal(result.error, "connection refused");
});

test("recordIdentityEvent er fail-open når insert selv kaster (rejected promise)", async () => {
  const fakeSupabase = {
    from: () => ({
      insert: async () => {
        throw new Error("network timeout");
      },
    }),
  };

  const result = await recordIdentityEvent(fakeSupabase, {
    userId: "u1",
    eventType: "signup",
    req: fakeReq(),
  });

  assert.equal(result.skipped, true);
  assert.equal(result.error, "network timeout");
});

test("recordIdentityEvent springer over (uden DB-kald) ved ugyldigt payload", async () => {
  let called = false;
  const fakeSupabase = {
    from: () => {
      called = true;
      return { insert: async () => ({ error: null }) };
    },
  };

  const result = await recordIdentityEvent(fakeSupabase, {
    userId: null,
    eventType: "signup",
  });

  assert.equal(result.skipped, true);
  assert.equal(called, false);
});
