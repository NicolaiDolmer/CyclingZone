import test from "node:test";
import assert from "node:assert/strict";

import { runIntakeOfferExpirySweep, INTAKE_OFFER_EXPIRY_DAYS } from "./academyIntakeExpirySweep.js";

test("INTAKE_OFFER_EXPIRY_DAYS er 7", () => {
  assert.equal(INTAKE_OFFER_EXPIRY_DAYS, 7);
});

test("runIntakeOfferExpirySweep: skip når flag OFF", async () => {
  const r = await runIntakeOfferExpirySweep({
    supabase: { from: () => ({}) },
    isEnabled: async () => false,
  });
  assert.deepEqual(r, { ran: false, reason: "flag_off" });
});

test("runIntakeOfferExpirySweep: kaster hvis supabase-klient mangler", async () => {
  await assert.rejects(
    () => runIntakeOfferExpirySweep({ supabase: null }),
    /Supabase client required/
  );
});

// Bygger en mock der genkender .eq("status","offered").lt("created_at", cutoff)-kæden
// og lader et testfixture af rækker afgøre hvad der "rammes" af filteret.
function buildMockSupabase({ rows, captureUpdate }) {
  return {
    from(table) {
      assert.equal(table, "academy_intake");
      return {
        update(payload) {
          captureUpdate.payload = payload;
          return {
            eq(col, val) {
              assert.equal(col, "status");
              assert.equal(val, "offered");
              return {
                lt(col2, cutoffIso) {
                  assert.equal(col2, "created_at");
                  captureUpdate.cutoffIso = cutoffIso;
                  const matched = rows.filter(
                    (r) => r.status === "offered" && r.created_at < cutoffIso
                  );
                  return {
                    async select() {
                      return { data: matched.map((r) => ({ id: r.id })), error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

test("runIntakeOfferExpirySweep: udløber KUN offered-rækker ældre end 7 dage", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const rows = [
    { id: "old-offered", status: "offered", created_at: "2026-07-01T00:00:00.000Z" }, // 17d gammel → udløbes
    { id: "fresh-offered", status: "offered", created_at: "2026-07-17T00:00:00.000Z" }, // 1d gammel → rører ikke
    { id: "old-signed", status: "signed", created_at: "2026-07-01T00:00:00.000Z" }, // ikke offered → rører ikke
    { id: "old-rejected", status: "rejected", created_at: "2026-07-01T00:00:00.000Z" }, // ikke offered → rører ikke
  ];
  const captureUpdate = {};
  const supabase = buildMockSupabase({ rows, captureUpdate });

  const r = await runIntakeOfferExpirySweep({ supabase, now, isEnabled: async () => true });

  assert.equal(r.ran, true);
  assert.equal(r.expired, 1);
  assert.deepEqual(captureUpdate.payload, { status: "expired", resolved_at: now.toISOString() });
  // Cutoff skal være now - 7 dage.
  assert.equal(captureUpdate.cutoffIso, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
});

test("runIntakeOfferExpirySweep: sætter resolved_at = now", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const rows = [{ id: "old-offered", status: "offered", created_at: "2026-06-01T00:00:00.000Z" }];
  const captureUpdate = {};
  const supabase = buildMockSupabase({ rows, captureUpdate });

  await runIntakeOfferExpirySweep({ supabase, now, isEnabled: async () => true });

  assert.equal(captureUpdate.payload.status, "expired");
  assert.equal(captureUpdate.payload.resolved_at, now.toISOString());
});

test("runIntakeOfferExpirySweep: ingen matchende rækker → expired:0, ingen fejl", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const rows = [{ id: "fresh-offered", status: "offered", created_at: "2026-07-17T00:00:00.000Z" }];
  const captureUpdate = {};
  const supabase = buildMockSupabase({ rows, captureUpdate });

  const r = await runIntakeOfferExpirySweep({ supabase, now, isEnabled: async () => true });

  assert.deepEqual(r, { ran: true, expired: 0, cutoff: captureUpdate.cutoffIso });
});

test("runIntakeOfferExpirySweep: kaster hvis update fejler", async () => {
  const supabase = {
    from: () => ({
      update: () => ({
        eq: () => ({
          lt: () => ({
            select: async () => ({ data: null, error: { message: "boom" } }),
          }),
        }),
      }),
    }),
  };
  await assert.rejects(
    () => runIntakeOfferExpirySweep({ supabase, isEnabled: async () => true }),
    /academy_intake expiry update: boom/
  );
});
