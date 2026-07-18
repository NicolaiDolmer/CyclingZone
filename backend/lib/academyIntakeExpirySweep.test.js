import test from "node:test";
import assert from "node:assert/strict";

import {
  runIntakeOfferExpirySweep,
  INTAKE_OFFER_EXPIRY_DAYS,
  INTAKE_EXPIRY_AUCTION_DURATION_HOURS,
  INTAKE_EXPIRY_MAX_PER_DAY,
} from "./academyIntakeExpirySweep.js";

test("konstanter: 7 dages udløb, 24h-auktion, 30 pr. DAG", () => {
  assert.equal(INTAKE_OFFER_EXPIRY_DAYS, 7);
  assert.equal(INTAKE_EXPIRY_AUCTION_DURATION_HOURS, 24);
  assert.equal(INTAKE_EXPIRY_MAX_PER_DAY, 30);
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

// Mock der spejler det fulde flow efter 18/7-hændelsen:
//   academy_intake: (a) dagskvote-count (select head+count), (b) kandidat-select
//   (eq→lt→order→limit), (c) reconcile-UPDATE pr. stale række (eq id + eq status),
//   (d) expiry-UPDATE (in→eq→select).
//   riders: select id,team_id,pending_team_id .in(id, ids) — ejerskabs-sandheden.
function buildMockSupabase({ intakeRows, riders, expiredLast24h = 0, capture }) {
  const riderById = new Map(riders.map((r) => [r.id, r]));
  return {
    from(table) {
      if (table === "riders") {
        return {
          select(cols) {
            assert.equal(cols, "id, team_id, pending_team_id");
            return {
              in(col, ids) {
                assert.equal(col, "id");
                capture.riderLookupIds = ids;
                return Promise.resolve({
                  data: ids.map((id) => riderById.get(id)).filter(Boolean),
                  error: null,
                });
              },
            };
          },
        };
      }
      assert.equal(table, "academy_intake");
      return {
        select(cols, opts) {
          if (opts?.head && opts?.count === "exact") {
            const chain = {
              eq(c, v) { assert.equal(c, "status"); assert.equal(v, "expired"); return chain; },
              gt(c, _v) { assert.equal(c, "resolved_at"); return Promise.resolve({ count: expiredLast24h, error: null }); },
            };
            return chain;
          }
          assert.equal(cols, "id, rider_id, team_id");
          const chain = {
            eq(c, v) { assert.equal(c, "status"); assert.equal(v, "offered"); return chain; },
            lt(c, cutoffIso) { assert.equal(c, "created_at"); capture.cutoffIso = cutoffIso; return chain; },
            order(c, o) { assert.equal(c, "created_at"); assert.equal(o.ascending, true); return chain; },
            limit(n) {
              capture.selectLimit = n;
              const matched = intakeRows
                .filter((r) => r.status === "offered" && r.created_at < capture.cutoffIso)
                .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
                .slice(0, n)
                .map((r) => ({ id: r.id, rider_id: r.rider_id, team_id: r.team_id }));
              return Promise.resolve({ data: matched, error: null });
            },
          };
          return chain;
        },
        update(payload) {
          return {
            eq(col, val) {
              assert.equal(col, "id");
              return {
                eq(col2, val2) {
                  assert.equal(col2, "status"); assert.equal(val2, "offered");
                  const row = intakeRows.find((r) => r.id === val && r.status === "offered");
                  if (row) {
                    row.status = payload.status;
                    row.resolved_at = payload.resolved_at;
                    capture.reconciles = (capture.reconciles ?? []).concat([{ id: val, status: payload.status }]);
                  }
                  return Promise.resolve({ error: null });
                },
              };
            },
            in(col, ids) {
              assert.equal(col, "id");
              return {
                eq(col2, val2) {
                  assert.equal(col2, "status"); assert.equal(val2, "offered");
                  return {
                    async select() {
                      const flipped = intakeRows
                        .filter((r) => ids.includes(r.id) && r.status === "offered")
                        .map((r) => ({ id: r.id, rider_id: r.rider_id }));
                      for (const f of flipped) {
                        const row = intakeRows.find((r) => r.id === f.id);
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

const OLD = "2026-07-01T00:00:00.000Z";
const NOW = new Date("2026-07-18T12:00:00.000Z");

test("HÆNDELSES-REGRESSION 18/7: forældet 'offered'-række med EJET rytter afstemmes — udløbes/auktioneres ALDRIG", async () => {
  const intakeRows = [
    { id: "i-signed", rider_id: "r-signed", team_id: "team-a", status: "offered", created_at: OLD },
    { id: "i-rejected", rider_id: "r-rejected", team_id: "team-a", status: "offered", created_at: OLD },
    { id: "i-free", rider_id: "r-free", team_id: "team-b", status: "offered", created_at: OLD },
  ];
  const riders = [
    { id: "r-signed", team_id: "team-a", pending_team_id: null },
    { id: "r-rejected", team_id: "team-x", pending_team_id: null },
    { id: "r-free", team_id: null, pending_team_id: null },
  ];
  const capture = {};
  const auctionCalls = [];
  const r = await runIntakeOfferExpirySweep({
    supabase: buildMockSupabase({ intakeRows, riders, capture }),
    now: NOW,
    isEnabled: async () => true,
    listYouthAuctionFn: async (_sb, opts) => { auctionCalls.push(opts.riderId); return { id: "a" }; },
  });

  assert.equal(r.reconciled, 2);
  assert.equal(r.expired, 1);
  assert.equal(r.auctioned, 1);
  assert.deepEqual(auctionCalls, ["r-free"], "KUN den team-løse rytter må auktioneres");
  assert.equal(intakeRows.find((x) => x.id === "i-signed").status, "signed");
  assert.equal(intakeRows.find((x) => x.id === "i-rejected").status, "rejected");
  assert.equal(intakeRows.find((x) => x.id === "i-free").status, "expired");
});

test("rytter med PARKERET holdskifte (pending_team_id) auktioneres ikke — behandles som ejet", async () => {
  const intakeRows = [
    { id: "i-parked", rider_id: "r-parked", team_id: "team-a", status: "offered", created_at: OLD },
  ];
  const riders = [{ id: "r-parked", team_id: null, pending_team_id: "team-z" }];
  const capture = {};
  const auctionCalls = [];
  const r = await runIntakeOfferExpirySweep({
    supabase: buildMockSupabase({ intakeRows, riders, capture }),
    now: NOW,
    isEnabled: async () => true,
    listYouthAuctionFn: async (_sb, opts) => { auctionCalls.push(opts.riderId); return { id: "a" }; },
  });
  assert.equal(r.expired, 0);
  assert.equal(auctionCalls.length, 0);
  assert.equal(intakeRows[0].status, "rejected");
});

test("DAGSKVOTE: fuld kvote brugt i rullende døgn → no-op (boot-run nr. 2 er budget-neutral)", async () => {
  const intakeRows = Array.from({ length: 10 }, (_, i) => ({
    id: `i${i}`, rider_id: `r${i}`, team_id: "t", status: "offered",
    created_at: `2026-06-0${1 + (i % 9)}T00:0${i}:00.000Z`,
  }));
  const riders = intakeRows.map((r) => ({ id: r.rider_id, team_id: null, pending_team_id: null }));
  const capture = {};
  const r = await runIntakeOfferExpirySweep({
    supabase: buildMockSupabase({ intakeRows, riders, expiredLast24h: INTAKE_EXPIRY_MAX_PER_DAY, capture }),
    now: NOW,
    isEnabled: async () => true,
    listYouthAuctionFn: async () => { throw new Error("må ikke kaldes"); },
  });
  assert.equal(r.expired, 0);
  assert.equal(r.reason, "daily_budget_spent");
  assert.ok(intakeRows.every((x) => x.status === "offered"), "intet må røres ved brugt kvote");
});

test("DAGSKVOTE: delvist brugt kvote → kun resten tages", async () => {
  const intakeRows = Array.from({ length: 20 }, (_, i) => ({
    id: `i${i}`, rider_id: `r${i}`, team_id: "t", status: "offered",
    created_at: `2026-06-${String(1 + Math.floor(i / 2)).padStart(2, "0")}T0${i % 2}:00:00.000Z`,
  }));
  const riders = intakeRows.map((r) => ({ id: r.rider_id, team_id: null, pending_team_id: null }));
  const capture = {};
  const r = await runIntakeOfferExpirySweep({
    supabase: buildMockSupabase({ intakeRows, riders, expiredLast24h: INTAKE_EXPIRY_MAX_PER_DAY - 5, capture }),
    now: NOW,
    isEnabled: async () => true,
    listYouthAuctionFn: async () => ({ id: "a" }),
  });
  assert.equal(r.expired, 5, "kun rest-budgettet (30-25=5) må tages");
  assert.equal(intakeRows.filter((x) => x.status === "offered").length, 15);
});

test("udløber KUN offered ældre end 7 dage; 24h-varighed videregives til auktionen", async () => {
  const intakeRows = [
    { id: "i-old", rider_id: "r-old", team_id: "t", status: "offered", created_at: OLD },
    { id: "i-fresh", rider_id: "r-fresh", team_id: "t", status: "offered", created_at: "2026-07-17T00:00:00.000Z" },
  ];
  const riders = [
    { id: "r-old", team_id: null, pending_team_id: null },
    { id: "r-fresh", team_id: null, pending_team_id: null },
  ];
  const capture = {};
  const auctionCalls = [];
  const r = await runIntakeOfferExpirySweep({
    supabase: buildMockSupabase({ intakeRows, riders, capture }),
    now: NOW,
    isEnabled: async () => true,
    listYouthAuctionFn: async (_sb, opts) => { auctionCalls.push(opts); return { id: "a" }; },
  });
  assert.equal(r.expired, 1);
  assert.equal(capture.cutoffIso, new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
  assert.equal(auctionCalls[0].riderId, "r-old");
  assert.equal(auctionCalls[0].durationHours, INTAKE_EXPIRY_AUCTION_DURATION_HOURS);
  assert.equal(intakeRows.find((x) => x.id === "i-fresh").status, "offered");
});

test("#2648: expiredIntakeTeamId videregives = academy_intake-rækkens EGEN team_id (den manager der modtog netop dette tilbud)", async () => {
  const intakeRows = [
    { id: "i-a", rider_id: "r-a", team_id: "team-a", status: "offered", created_at: OLD },
    { id: "i-b", rider_id: "r-b", team_id: "team-b", status: "offered", created_at: OLD },
  ];
  const riders = [
    { id: "r-a", team_id: null, pending_team_id: null },
    { id: "r-b", team_id: null, pending_team_id: null },
  ];
  const capture = {};
  const auctionCalls = [];
  await runIntakeOfferExpirySweep({
    supabase: buildMockSupabase({ intakeRows, riders, capture }),
    now: NOW,
    isEnabled: async () => true,
    listYouthAuctionFn: async (_sb, opts) => { auctionCalls.push(opts); return { id: "a" }; },
  });
  const byRider = Object.fromEntries(auctionCalls.map((c) => [c.riderId, c.expiredIntakeTeamId]));
  assert.equal(byRider["r-a"], "team-a");
  assert.equal(byRider["r-b"], "team-b", "hver rytter krediterer SIN EGEN tabende manager, ikke en fælles værdi");
});

test("#2648: forældet 'offered'-række med EJET rytter afstemmes — expiredIntakeTeamId sendes ALDRIG for den (kun team-løse kandidater auktioneres)", async () => {
  const intakeRows = [
    { id: "i-owned", rider_id: "r-owned", team_id: "team-x", status: "offered", created_at: OLD },
  ];
  const riders = [
    { id: "r-owned", team_id: "team-x", pending_team_id: null },
  ];
  const capture = {};
  const auctionCalls = [];
  const r = await runIntakeOfferExpirySweep({
    supabase: buildMockSupabase({ intakeRows, riders, capture }),
    now: NOW,
    isEnabled: async () => true,
    listYouthAuctionFn: async (_sb, opts) => { auctionCalls.push(opts); return { id: "a" }; },
  });
  assert.equal(r.reconciled, 1);
  assert.equal(auctionCalls.length, 0, "ejet rytter auktioneres aldrig — ingen kreditering at videregive");
});

test("fejlet auktions-listning aborterer ikke resten — rapporteres i auctionErrors", async () => {
  const intakeRows = [
    { id: "i1", rider_id: "r-fail", team_id: "t", status: "offered", created_at: OLD },
    { id: "i2", rider_id: "r-ok", team_id: "t", status: "offered", created_at: "2026-07-02T00:00:00.000Z" },
  ];
  const riders = [
    { id: "r-fail", team_id: null, pending_team_id: null },
    { id: "r-ok", team_id: null, pending_team_id: null },
  ];
  const capture = {};
  const r = await runIntakeOfferExpirySweep({
    supabase: buildMockSupabase({ intakeRows, riders, capture }),
    now: NOW,
    isEnabled: async () => true,
    listYouthAuctionFn: async (_sb, opts) => {
      if (opts.riderId === "r-fail") throw new Error("auction boom");
      return { id: "a" };
    },
  });
  assert.equal(r.expired, 2);
  assert.equal(r.auctioned, 1);
  assert.match(r.auctionErrors[0], /r-fail: auction boom/);
});

test("ingen matchende rækker → alt 0, ingen auktions-kald", async () => {
  const capture = {};
  const r = await runIntakeOfferExpirySweep({
    supabase: buildMockSupabase({ intakeRows: [], riders: [], capture }),
    now: NOW,
    isEnabled: async () => true,
    listYouthAuctionFn: async () => { throw new Error("må ikke kaldes"); },
  });
  assert.deepEqual(r, { ran: true, expired: 0, auctioned: 0, reconciled: 0, cutoff: capture.cutoffIso });
});
