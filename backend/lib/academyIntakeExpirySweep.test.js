import test from "node:test";
import assert from "node:assert/strict";

import {
  runIntakeOfferExpirySweep,
  INTAKE_OFFER_EXPIRY_DAYS,
  INTAKE_EXPIRY_AUCTION_DURATION_HOURS,
  INTAKE_EXPIRY_MAX_PER_RUN,
} from "./academyIntakeExpirySweep.js";

test("konstanter: 7 dages udløb, 24h-auktion, 25 pr. kørsel", () => {
  assert.equal(INTAKE_OFFER_EXPIRY_DAYS, 7);
  assert.equal(INTAKE_EXPIRY_AUCTION_DURATION_HOURS, 24);
  assert.equal(INTAKE_EXPIRY_MAX_PER_RUN, 25);
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

// Mock der spejler det faktiske to-trins-flow: SELECT-kæden (eq→lt→order→limit)
// vælger kandidater ud fra fixture-rækkerne; UPDATE-kæden (in→eq→select) flipper
// dem. captureState opsamler cutoff/limit/payload til assertions.
function buildMockSupabase({ rows, capture }) {
  return {
    from(table) {
      assert.equal(table, "academy_intake");
      return {
        select(cols) {
          assert.equal(cols, "id, rider_id");
          const chain = {
            eq(col, val) { assert.equal(col, "status"); assert.equal(val, "offered"); return chain; },
            lt(col, cutoffIso) { assert.equal(col, "created_at"); capture.cutoffIso = cutoffIso; return chain; },
            order(col, opts) { assert.equal(col, "created_at"); assert.equal(opts.ascending, true); return chain; },
            limit(n) {
              capture.limit = n;
              const matched = rows
                .filter((r) => r.status === "offered" && r.created_at < capture.cutoffIso)
                .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
                .slice(0, n)
                .map((r) => ({ id: r.id, rider_id: r.rider_id }));
              capture.selected = matched;
              return Promise.resolve({ data: matched, error: null });
            },
          };
          return chain;
        },
        update(payload) {
          capture.payload = payload;
          return {
            in(col, ids) {
              assert.equal(col, "id");
              capture.updatedIds = ids;
              return {
                eq(col2, val2) {
                  assert.equal(col2, "status");
                  assert.equal(val2, "offered");
                  return {
                    async select() {
                      const flipped = rows
                        .filter((r) => ids.includes(r.id) && r.status === "offered")
                        .map((r) => ({ id: r.id, rider_id: r.rider_id }));
                      for (const f of flipped) {
                        const row = rows.find((r) => r.id === f.id);
                        row.status = "expired";
                        row.resolved_at = payload.resolved_at;
                      }
                      return { data: flipped, error: null };
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

test("udløber KUN offered-rækker ældre end 7 dage — og lister hver på 24h-ungdomsauktion", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const rows = [
    { id: "old-offered", rider_id: "rider-a", status: "offered", created_at: "2026-07-01T00:00:00.000Z" },
    { id: "fresh-offered", rider_id: "rider-b", status: "offered", created_at: "2026-07-17T00:00:00.000Z" },
    { id: "old-signed", rider_id: "rider-c", status: "signed", created_at: "2026-07-01T00:00:00.000Z" },
    { id: "old-rejected", rider_id: "rider-d", status: "rejected", created_at: "2026-07-01T00:00:00.000Z" },
  ];
  const capture = {};
  const auctionCalls = [];
  const r = await runIntakeOfferExpirySweep({
    supabase: buildMockSupabase({ rows, capture }),
    now,
    isEnabled: async () => true,
    listYouthAuctionFn: async (_sb, opts) => { auctionCalls.push(opts); return { id: `auction-${opts.riderId}` }; },
  });

  assert.equal(r.ran, true);
  assert.equal(r.expired, 1);
  assert.equal(r.auctioned, 1);
  assert.deepEqual(capture.payload, { status: "expired", resolved_at: now.toISOString() });
  assert.equal(capture.cutoffIso, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
  // Ejer-beslutning 18/7: 24 AKTIVE timer, ikke standard-varigheden (1h i prod).
  assert.equal(auctionCalls.length, 1);
  assert.equal(auctionCalls[0].riderId, "rider-a");
  assert.equal(auctionCalls[0].durationHours, INTAKE_EXPIRY_AUCTION_DURATION_HOURS);
});

test("cap: højst INTAKE_EXPIRY_MAX_PER_RUN pr. kørsel, ældste først (drypvis backlog-afvikling)", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const rows = Array.from({ length: 40 }, (_, i) => ({
    id: `o${i}`,
    rider_id: `r${i}`,
    status: "offered",
    // o0 er ældst — stigende created_at, alle ældre end cutoff.
    created_at: `2026-06-${String(1 + Math.floor(i / 2)).padStart(2, "0")}T0${i % 2}:00:00.000Z`,
  }));
  const capture = {};
  const auctionCalls = [];
  const r = await runIntakeOfferExpirySweep({
    supabase: buildMockSupabase({ rows, capture }),
    now,
    isEnabled: async () => true,
    listYouthAuctionFn: async (_sb, opts) => { auctionCalls.push(opts.riderId); return { id: "a" }; },
  });

  assert.equal(capture.limit, INTAKE_EXPIRY_MAX_PER_RUN);
  assert.equal(r.expired, INTAKE_EXPIRY_MAX_PER_RUN);
  assert.equal(r.auctioned, INTAKE_EXPIRY_MAX_PER_RUN);
  assert.equal(auctionCalls[0], "r0", "ældste tilbud skal tages først");
  // De 15 nyeste er urørte (tages i senere ticks).
  assert.equal(rows.filter((x) => x.status === "offered").length, 15);
});

test("re-guard: en række der blev signed mellem select og update flippes IKKE og auktioneres IKKE", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const rows = [
    { id: "o1", rider_id: "r1", status: "offered", created_at: "2026-07-01T00:00:00.000Z" },
  ];
  const capture = {};
  const auctionCalls = [];
  // Simulér race: efter select men før update signes tilbuddet.
  const base = buildMockSupabase({ rows, capture });
  const supabase = {
    from(table) {
      const t = base.from(table);
      return {
        select(cols) {
          const p = t.select(cols);
          // Efter select-kædens limit resolver, flip status (racen).
          return {
            eq: (...a) => { const c = p.eq ? p : p; return c.eq(...a); },
            ...p,
          };
        },
        update: (payload) => {
          rows[0].status = "signed"; // racen: signet FØR update rammer
          return t.update(payload);
        },
      };
    },
  };

  const r = await runIntakeOfferExpirySweep({
    supabase,
    now,
    isEnabled: async () => true,
    listYouthAuctionFn: async (_sb, opts) => { auctionCalls.push(opts.riderId); return { id: "a" }; },
  });

  assert.equal(r.expired, 0);
  assert.equal(r.auctioned, 0);
  assert.equal(auctionCalls.length, 0);
  assert.equal(rows[0].status, "signed", "det signede tilbud må ikke overskrives");
});

test("fejlet auktions-listning aborterer ikke resten — rapporteres i auctionErrors", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const rows = [
    { id: "o1", rider_id: "r-fail", status: "offered", created_at: "2026-07-01T00:00:00.000Z" },
    { id: "o2", rider_id: "r-ok", status: "offered", created_at: "2026-07-02T00:00:00.000Z" },
  ];
  const capture = {};
  const r = await runIntakeOfferExpirySweep({
    supabase: buildMockSupabase({ rows, capture }),
    now,
    isEnabled: async () => true,
    listYouthAuctionFn: async (_sb, opts) => {
      if (opts.riderId === "r-fail") throw new Error("auction boom");
      return { id: "a" };
    },
  });

  assert.equal(r.expired, 2);
  assert.equal(r.auctioned, 1);
  assert.equal(r.auctionErrors.length, 1);
  assert.match(r.auctionErrors[0], /r-fail: auction boom/);
});

test("ingen matchende rækker → expired:0, auctioned:0, ingen auktions-kald", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const rows = [{ id: "fresh", rider_id: "r1", status: "offered", created_at: "2026-07-17T00:00:00.000Z" }];
  const capture = {};
  const auctionCalls = [];
  const r = await runIntakeOfferExpirySweep({
    supabase: buildMockSupabase({ rows, capture }),
    now,
    isEnabled: async () => true,
    listYouthAuctionFn: async () => { auctionCalls.push(1); return { id: "a" }; },
  });
  assert.deepEqual(r, { ran: true, expired: 0, auctioned: 0, cutoff: capture.cutoffIso });
  assert.equal(auctionCalls.length, 0);
});

test("kaster hvis select fejler", async () => {
  const supabase = {
    from: () => ({
      select: () => {
        const chain = {
          eq: () => chain,
          lt: () => chain,
          order: () => chain,
          limit: () => Promise.resolve({ data: null, error: { message: "boom" } }),
        };
        return chain;
      },
    }),
  };
  await assert.rejects(
    () => runIntakeOfferExpirySweep({ supabase, isEnabled: async () => true }),
    /academy_intake expiry select: boom/
  );
});
