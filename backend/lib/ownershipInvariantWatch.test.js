import test from "node:test";
import assert from "node:assert/strict";

import { runOwnershipInvariantWatch } from "./ownershipInvariantWatch.js";

// In-memory mock af de tre tabeller modulet rører (alle READ-ONLY):
//   auctions:       select(...).in("status",[...]).order().range()
//   riders:         select(...).in("id",[...]).order().range()
//   academy_intake: select(...).eq("status","offered").order().range()
//                   (findStaleOfferedIntake's egen riders-select("id, team_id")
//                    genbruger samme riders-mock)
function makeMock({ auctions = [], riders = [], intake = [], auctionsError = null } = {}) {
  return {
    from(table) {
      if (table === "auctions") {
        const filters = [];
        const b = {
          select() { return b; },
          eq(col, val) { filters.push(["eq", col, val]); return b; },
          in(col, vals) { filters.push(["in", col, vals]); return b; },
          is(col, val) { filters.push(["is", col, val]); return b; },
          order() { return b; },
          range(from, to) {
            if (auctionsError) return Promise.resolve({ data: null, error: auctionsError });
            let out = auctions.filter((r) =>
              filters.every(([op, c, v]) => {
                if (op === "eq") return r[c] === v;
                if (op === "in") return v.includes(r[c]);
                if (op === "is") return (r[c] ?? null) === v;
                return true;
              })
            );
            out = out.slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      if (table === "riders") {
        let inIds = null;
        const b = {
          select() { return b; },
          in(_col, ids) { inIds = ids; return b; },
          order() { return b; },
          range(from, to) {
            let out = riders.filter((r) => (inIds ? inIds.includes(r.id) : true));
            out = out.slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      if (table === "academy_intake") {
        const eqFilters = [];
        const b = {
          select() { return b; },
          eq(col, val) { eqFilters.push([col, val]); return b; },
          order() { return b; },
          range(from, to) {
            let out = intake.filter((r) => eqFilters.every(([c, v]) => r[c] === v));
            out = out.slice(from, to + 1);
            return Promise.resolve({
              data: out.map((r) => ({ id: r.id, team_id: r.team_id, rider_id: r.rider_id })),
              error: null,
            });
          },
        };
        return b;
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

test("#2647 clean fixture — ingen brud, ingen capture, alerted=false", async () => {
  const auctions = [
    { id: "auc-1", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "active" },
    { id: "auc-2", rider_id: "r-2", is_youth: false, seller_team_id: "team-X", status: "active" },
  ];
  const riders = [
    { id: "r-1", team_id: null, pending_team_id: null }, // fri ungdomsrytter — legitimt
    { id: "r-2", team_id: null, pending_team_id: null },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(calls.length, 0);
  assert.equal(result.alerted, false);
  assert.deepEqual(result.findings, { youthOwned: 0, sellerlessOwned: 0, staleIntake: 0 });
  assert.equal(result.checked, 2);
});

test("#2647 invariant A — hold-ejet rytter (team_id) på aktiv ungdomsauktion alarmerer med fast fingerprint", async () => {
  const auctions = [
    { id: "auc-1", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "active" },
    { id: "auc-2", rider_id: "r-2", is_youth: true, seller_team_id: null, status: "extended" },
  ];
  const riders = [
    { id: "r-1", team_id: "team-A", pending_team_id: null },
    { id: "r-2", team_id: null, pending_team_id: "team-B" }, // pending_team_id tæller også som ejet
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(calls.length, 1, "kun ÉN capture uanset antal findings");
  assert.deepEqual(calls[0].ctx.fingerprint, ["owned-rider-on-youth-auction"]);
  assert.deepEqual(calls[0].ctx.tags, { cron: "ownership-invariant-watch" });
  assert.equal(calls[0].ctx.extra.count, 2);
  assert.equal(calls[0].ctx.extra.sample.length, 2);
  assert.equal(result.findings.youthOwned, 2);
  assert.equal(result.alerted, true);
});

test("#2647 invariant A — FRI rytter (team_id null) på aktiv ungdomsauktion alarmerer IKKE", async () => {
  const auctions = [
    { id: "auc-1", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "active" },
  ];
  const riders = [{ id: "r-1", team_id: null, pending_team_id: null }];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(calls.length, 0);
  assert.equal(result.findings.youthOwned, 0);
  assert.equal(result.alerted, false);
});

test("#2647 invariant B — hold-ejet rytter på sælgerløs, ikke-ungdoms, AKTIV auktion alarmerer med fast fingerprint", async () => {
  const auctions = [
    { id: "auc-1", rider_id: "r-1", is_youth: false, seller_team_id: null, status: "active" },
  ];
  const riders = [{ id: "r-1", team_id: "team-A", pending_team_id: null }];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ctx.fingerprint, ["owned-rider-on-sellerless-auction"]);
  assert.equal(calls[0].ctx.extra.count, 1);
  assert.equal(result.findings.sellerlessOwned, 1);
  assert.equal(result.alerted, true);
});

test("#2647 invariant B — status-scoping: COMPLETED/CANCELLED sælgerløs hold-ejet auktion alarmerer IKKE (auctionFinalization nulstiller seller_team_id ved completion)", async () => {
  const auctions = [
    { id: "auc-1", rider_id: "r-1", is_youth: false, seller_team_id: null, status: "completed" },
    { id: "auc-2", rider_id: "r-2", is_youth: false, seller_team_id: null, status: "cancelled" },
  ];
  const riders = [
    { id: "r-1", team_id: "team-A", pending_team_id: null },
    { id: "r-2", team_id: "team-B", pending_team_id: null },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(calls.length, 0, "uden status-scoping ville dette false-positive på HVER completed sale");
  assert.equal(result.findings.sellerlessOwned, 0);
  assert.equal(result.checked, 0, "completed/cancelled rækker hentes slet ikke — fetchActiveAuctions scoper i selve queryen");
  assert.equal(result.alerted, false);
});

test("#2647 invariant B — completed YOUTH-auktion med hold-ejet rytter alarmerer heller IKKE (samme status-scoping)", async () => {
  const auctions = [
    { id: "auc-1", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "completed" },
  ];
  const riders = [{ id: "r-1", team_id: "team-A", pending_team_id: null }];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(calls.length, 0);
  assert.equal(result.findings.youthOwned, 0);
});

test("#2647 invariant C — stale offered academy_intake for ejet rytter alarmerer med fast fingerprint (genbrug af findStaleOfferedIntake)", async () => {
  const intake = [
    { id: "i-1", team_id: "team-A", rider_id: "r-1", status: "offered" }, // ejet af team-A → stale
    { id: "i-2", team_id: "team-A", rider_id: "r-2", status: "offered" }, // fri rytter → ikke stale
  ];
  const riders = [
    { id: "r-1", team_id: "team-A", pending_team_id: null },
    { id: "r-2", team_id: null, pending_team_id: null },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions: [], riders, intake }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ctx.fingerprint, ["stale-offered-intake-owned-rider"]);
  assert.equal(calls[0].ctx.extra.count, 1);
  assert.equal(calls[0].ctx.extra.sample[0].intakeId, "i-1");
  assert.equal(result.findings.staleIntake, 1);
  assert.equal(result.alerted, true);
});

test("#2647 invariant C — ingen stale intake → alerted=false, captureExceptionFn ikke kaldt", async () => {
  const intake = [{ id: "i-1", team_id: "team-A", rider_id: "r-1", status: "offered" }];
  const riders = [{ id: "r-1", team_id: null, pending_team_id: null }]; // fri — legitimt åbent tilbud
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions: [], riders, intake }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(calls.length, 0);
  assert.equal(result.findings.staleIntake, 0);
  assert.equal(result.alerted, false);
});

test("#2647 alle tre invarianter brudt samtidig → tre separate captures, hver med sit eget faste fingerprint", async () => {
  const auctions = [
    { id: "auc-1", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "active" },
    { id: "auc-2", rider_id: "r-2", is_youth: false, seller_team_id: null, status: "extended" },
  ];
  const riders = [
    { id: "r-1", team_id: "team-A", pending_team_id: null },
    { id: "r-2", team_id: "team-B", pending_team_id: null },
    { id: "r-3", team_id: "team-C", pending_team_id: null },
  ];
  const intake = [{ id: "i-1", team_id: "team-X", rider_id: "r-3", status: "offered" }];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders, intake }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(calls.length, 3);
  const fingerprints = calls.map((c) => c.ctx.fingerprint[0]).sort();
  assert.deepEqual(fingerprints, [
    "owned-rider-on-sellerless-auction",
    "owned-rider-on-youth-auction",
    "stale-offered-intake-owned-rider",
  ]);
  assert.equal(result.alerted, true);
});

test("#2647 query-fejl på auctions kaster (så trackedTick/monitorCron kan se DB-fejlen)", async () => {
  const supabase = makeMock({ auctionsError: { message: "permission denied for table auctions", code: "42501" } });
  await assert.rejects(() =>
    runOwnershipInvariantWatch({ supabase, captureExceptionFn: () => {} })
  );
});

test("#2647 kræver supabase-klient", async () => {
  await assert.rejects(
    () => runOwnershipInvariantWatch({ supabase: null, captureExceptionFn: () => {} }),
    /Supabase client required/
  );
});
