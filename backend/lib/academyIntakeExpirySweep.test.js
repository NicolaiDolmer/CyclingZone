import test from "node:test";
import assert from "node:assert/strict";

import {
  runIntakeOfferExpirySweep,
  runBoardGiftExpiryPurge,
  resolveDailyQuota,
  INTAKE_OFFER_EXPIRY_DAYS,
  INTAKE_EXPIRY_AUCTION_DURATION_HOURS,
  INTAKE_EXPIRY_MAX_PER_DAY,
  INTAKE_EXPIRY_STEADY_PER_DAY,
  INTAKE_EXPIRY_CATCHUP_PER_DAY,
  INTAKE_EXPIRY_BACKLOG_THRESHOLD,
} from "./academyIntakeExpirySweep.js";

test("konstanter: 7 dages udløb, 24h-auktion, 45/60 pr. DAG", () => {
  assert.equal(INTAKE_OFFER_EXPIRY_DAYS, 7);
  assert.equal(INTAKE_EXPIRY_AUCTION_DURATION_HOURS, 24);
  // Ejer-godkendt 10/8: 30 var strukturelt for lav — ~300 tilbud skal udløbe pr.
  // uge (43/dag) mod en kapacitet på 210. Køen voksede ~90/uge af sig selv.
  assert.equal(INTAKE_EXPIRY_STEADY_PER_DAY, 45);
  assert.equal(INTAKE_EXPIRY_CATCHUP_PER_DAY, 60);
  assert.equal(INTAKE_EXPIRY_MAX_PER_DAY, INTAKE_EXPIRY_STEADY_PER_DAY, "den bevarede eksport peger på steady-satsen");
  assert.ok(INTAKE_EXPIRY_CATCHUP_PER_DAY > INTAKE_EXPIRY_STEADY_PER_DAY, "indhentning skal være hurtigere end normal drift");
});

test("kvote: efterslæb over tærsklen → CATCHUP-satsen", async () => {
  const intakeRows = [];
  const supabase = buildMockSupabase({
    intakeRows, riders: [], capture: {},
    overdueOverride: INTAKE_EXPIRY_BACKLOG_THRESHOLD + 1,
  });
  const { quota, overdue } = await resolveDailyQuota(supabase, NOW.toISOString());
  assert.equal(quota, INTAKE_EXPIRY_CATCHUP_PER_DAY);
  assert.equal(overdue, INTAKE_EXPIRY_BACKLOG_THRESHOLD + 1);
});

test("kvote: efterslæb PÅ tærsklen → stadig STEADY (kun OVER udløser indhentning)", async () => {
  const supabase = buildMockSupabase({
    intakeRows: [], riders: [], capture: {},
    overdueOverride: INTAKE_EXPIRY_BACKLOG_THRESHOLD,
  });
  const { quota } = await resolveDailyQuota(supabase, NOW.toISOString());
  assert.equal(quota, INTAKE_EXPIRY_STEADY_PER_DAY);
});

test("kvote: tom kø → STEADY", async () => {
  const supabase = buildMockSupabase({ intakeRows: [], riders: [], capture: {}, overdueOverride: 0 });
  const { quota, overdue } = await resolveDailyQuota(supabase, NOW.toISOString());
  assert.equal(quota, INTAKE_EXPIRY_STEADY_PER_DAY);
  assert.equal(overdue, 0);
});

test("kvoten falder TILBAGE til steady når puklen er afviklet (selv-korrigerende)", async () => {
  // Det scenarie der ellers ville kræve at nogen huskede at sænke tallet manuelt.
  const medPukkel = buildMockSupabase({ intakeRows: [], riders: [], capture: {}, overdueOverride: 400 });
  assert.equal((await resolveDailyQuota(medPukkel, NOW.toISOString())).quota, INTAKE_EXPIRY_CATCHUP_PER_DAY);

  const efterAfvikling = buildMockSupabase({ intakeRows: [], riders: [], capture: {}, overdueOverride: 12 });
  assert.equal((await resolveDailyQuota(efterAfvikling, NOW.toISOString())).quota, INTAKE_EXPIRY_STEADY_PER_DAY);
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
// #5844: den normale sti udelukker gave-rækker med .neq("source", "board_gift").
function notGift(row, excludeGift) {
  return !(excludeGift && row.source === "board_gift");
}

function buildMockSupabase({ intakeRows, riders, expiredLast24h = 0, capture, overdueOverride = null }) {
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
            // To count-queries deler denne gren:
            //   1. dagsforbrug — status='expired' + resolved_at > døgn siden
            //   2. efterslæb (#3576-kvoten) — status='offered' + created_at < cutoff
            // Grenen vælges af hvilken status der filtreres på.
            let status = null;
            let excludeGift = false;
            const chain = {
              eq(c, v) { assert.equal(c, "status"); status = v; return chain; },
              neq(c, v) { assert.equal(c, "source"); assert.equal(v, "board_gift"); excludeGift = true; return chain; },
              gt(c, _v) {
                assert.equal(c, "resolved_at");
                assert.equal(status, "expired");
                return Promise.resolve({ count: expiredLast24h, error: null });
              },
              lt(c, cutoffIso) {
                assert.equal(c, "created_at");
                assert.equal(status, "offered");
                const n = intakeRows.filter((r) => r.status === "offered" && r.created_at < cutoffIso
                  && notGift(r, excludeGift)).length;
                return Promise.resolve({ count: overdueOverride ?? n, error: null });
              },
            };
            return chain;
          }
          if (cols === "id, rider_id, team_id, source") {
            // #5844: gave-purgens udvælgelse (status + source + created_at).
            let giftCutoff = null;
            const giftChain = {
              eq() { return giftChain; },
              lt(c, v) { assert.equal(c, "created_at"); giftCutoff = v; return giftChain; },
              order() { return giftChain; },
              limit() {
                capture.giftPurgeCutoff = giftCutoff;
                return Promise.resolve({
                  data: intakeRows.filter((r) => r.status === "offered" && r.source === "board_gift" && r.created_at < giftCutoff),
                  error: null,
                });
              },
            };
            return giftChain;
          }
          assert.equal(cols, "id, rider_id, team_id");
          const chain = {
            eq(c, v) { assert.equal(c, "status"); assert.equal(v, "offered"); return chain; },
            lt(c, cutoffIso) { assert.equal(c, "created_at"); capture.cutoffIso = cutoffIso; return chain; },
            neq(c, v) { assert.equal(c, "source"); assert.equal(v, "board_gift"); capture.excludeGift = true; return chain; },
            order(c, o) { assert.equal(c, "created_at"); assert.equal(o.ascending, true); return chain; },
            limit(n) {
              capture.selectLimit = n;
              const matched = intakeRows
                .filter((r) => r.status === "offered" && r.created_at < capture.cutoffIso
                  && notGift(r, capture.excludeGift))
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

// ── #5844: bestyrelsens gave-kuld (14 dage, forsvinder stille, ingen auktion) ──
test("#5844: den normale sti rører ALDRIG gave-tilbud (heller ikke på dag 10)", async () => {
  const tenDaysAgo = new Date(NOW.getTime() - 10 * 86_400_000).toISOString();
  const intakeRows = [
    { id: "i-gift", rider_id: "r-gift", team_id: "t", status: "offered", created_at: tenDaysAgo, source: "board_gift" },
    { id: "i-norm", rider_id: "r-norm", team_id: "t", status: "offered", created_at: tenDaysAgo, source: "intake" },
  ];
  const riders = intakeRows.map((r) => ({ id: r.rider_id, team_id: null, pending_team_id: null }));
  const capture = {};
  const auctioned = [];
  const r = await runIntakeOfferExpirySweep({
    supabase: buildMockSupabase({ intakeRows, riders, capture }),
    now: NOW,
    isEnabled: async () => true,
    listYouthAuctionFn: async (_sb, { riderId }) => { auctioned.push(riderId); return { id: "a" }; },
  });
  assert.equal(r.expired, 1);
  assert.deepEqual(auctioned, ["r-norm"]);
  assert.equal(intakeRows[0].status, "offered", "gave-tilbuddet står til dag 14");
  assert.equal(capture.excludeGift, true);
  assert.equal(capture.giftPurgeCutoff, new Date(NOW.getTime() - 14 * 86_400_000).toISOString());
});

test("#5844: umodne gave-tilbud tæller ikke som efterslæb i kvoten", async () => {
  const tenDaysAgo = new Date(NOW.getTime() - 10 * 86_400_000).toISOString();
  const intakeRows = Array.from({ length: INTAKE_EXPIRY_BACKLOG_THRESHOLD + 50 }, (_, i) => ({
    id: `g${i}`, rider_id: `rg${i}`, team_id: "t", status: "offered", created_at: tenDaysAgo, source: "board_gift",
  }));
  const supabase = buildMockSupabase({ intakeRows, riders: [], capture: {} });
  const { quota, overdue } = await resolveDailyQuota(supabase, new Date(NOW.getTime() - 7 * 86_400_000).toISOString());
  assert.equal(overdue, 0);
  assert.equal(quota, INTAKE_EXPIRY_STEADY_PER_DAY);
});

// Lille mock KUN til gave-purgen: academy_intake-select, riders-lookup,
// race_results-lookup, riders-delete (med guard-filtrene) og update.
function buildPurgeMock({ intakeRows, riders, raced = [] }) {
  const log = { deleted: [], deleteFilters: null, updates: [] };
  const supa = {
    from(table) {
      if (table === "academy_intake") {
        return {
          select(cols) {
            assert.equal(cols, "id, rider_id, team_id, source");
            let cutoff = null;
            const c = {
              eq() { return c; }, order() { return c; },
              lt(_col, v) { cutoff = v; return c; },
              limit() {
                return Promise.resolve({ data: intakeRows.filter((r) => r.status === "offered" && r.source === "board_gift" && r.created_at < cutoff), error: null });
              },
            };
            return c;
          },
          update(payload) {
            const u = { id: null, eq(col, v) { if (col === "id") u.id = v; if (col === "status") { const row = intakeRows.find((x) => x.id === u.id); row.status = payload.status; log.updates.push({ id: u.id, status: payload.status }); return Promise.resolve({ error: null }); } return u; } };
            return u;
          },
        };
      }
      if (table === "race_results") {
        return { select() { return { in(_c, ids) { return { limit() { return Promise.resolve({ data: raced.filter((id) => ids.includes(id)).map((rider_id) => ({ rider_id })), error: null }); } }; } }; } };
      }
      assert.equal(table, "riders");
      return {
        select() { return { in(_c, ids) { return Promise.resolve({ data: riders.filter((r) => ids.includes(r.id)), error: null }); } }; },
        delete() {
          const f = {};
          const d = {
            in(_c, ids) { f.ids = ids; return d; },
            is(col, v) { f[col] = v; return d; },
            eq(col, v) { f[col] = v; return d; },
            select() {
              log.deleteFilters = f;
              const gone = riders.filter((r) => f.ids.includes(r.id) && r.team_id === null && r.pending_team_id === null && r.is_academy === false);
              log.deleted.push(...gone.map((r) => r.id));
              return Promise.resolve({ data: gone.map((r) => ({ id: r.id })), error: null });
            },
          };
          return d;
        },
      };
    },
  };
  return { supa, log };
}

test("#5844: gave-tilbud ældre end 14 dage → rytteren slettes stille (ingen auktion); ejede afstemmes", async () => {
  const old = new Date(NOW.getTime() - 15 * 86_400_000).toISOString();
  const fresh = new Date(NOW.getTime() - 10 * 86_400_000).toISOString();
  const intakeRows = [
    { id: "g-free", rider_id: "r-free", team_id: "t1", status: "offered", created_at: old, source: "board_gift" },
    { id: "g-owned", rider_id: "r-owned", team_id: "t1", status: "offered", created_at: old, source: "board_gift" },
    { id: "g-fresh", rider_id: "r-fresh", team_id: "t1", status: "offered", created_at: fresh, source: "board_gift" },
  ];
  const riders = [
    { id: "r-free", team_id: null, pending_team_id: null, is_academy: false },
    { id: "r-owned", team_id: "t1", pending_team_id: null, is_academy: true },
    { id: "r-fresh", team_id: null, pending_team_id: null, is_academy: false },
  ];
  const { supa, log } = buildPurgeMock({ intakeRows, riders });
  const r = await runBoardGiftExpiryPurge({ supabase: supa, now: NOW });
  assert.deepEqual(r, { giftExpired: 1, giftReconciled: 1, giftKept: 0 });
  assert.deepEqual(log.deleted, ["r-free"]);
  assert.deepEqual(log.deleteFilters, { ids: ["r-free"], team_id: null, pending_team_id: null, squad: "senior", is_academy: false });
  assert.deepEqual(log.updates, [{ id: "g-owned", status: "signed" }]);
  assert.equal(intakeRows[2].status, "offered", "dag 10 røres ikke");
});

test("#5844: holdløs gave-rytter MED race_results slettes ikke (#1847-guard)", async () => {
  const old = new Date(NOW.getTime() - 15 * 86_400_000).toISOString();
  const intakeRows = [{ id: "g1", rider_id: "r1", team_id: "t1", status: "offered", created_at: old, source: "board_gift" }];
  const riders = [{ id: "r1", team_id: null, pending_team_id: null, is_academy: false }];
  const { supa, log } = buildPurgeMock({ intakeRows, riders, raced: ["r1"] });
  const r = await runBoardGiftExpiryPurge({ supabase: supa, now: NOW });
  assert.deepEqual(r, { giftExpired: 0, giftReconciled: 0, giftKept: 1 });
  assert.deepEqual(log.deleted, []);
  assert.equal(intakeRows[0].status, "expired");
});

test("#5844: purgen er stille no-op før migrationen (source-kolonnen mangler)", async () => {
  const supa = { from() { const c = { select() { return c; }, eq() { return c; }, lt() { return c; }, order() { return c; }, limit() { return Promise.resolve({ data: null, error: { code: "42703", message: "column academy_intake.source does not exist" } }); } }; return c; } };
  assert.deepEqual(await runBoardGiftExpiryPurge({ supabase: supa, now: NOW }), { giftExpired: 0, giftReconciled: 0, giftKept: 0 });
});

test("#5844: sweep'en kalder gave-purgen og returnerer dens tal", async () => {
  const intakeRows = [];
  const r = await runIntakeOfferExpirySweep({
    supabase: buildMockSupabase({ intakeRows, riders: [], capture: {} }),
    now: NOW,
    isEnabled: async () => true,
    giftPurgeFn: async () => ({ giftExpired: 7, giftReconciled: 0, giftKept: 0 }),
  });
  assert.equal(r.giftExpired, 7);
});

test("#5844: før migrationen (kolonnen mangler) falder den normale sti tilbage til den gamle forespørgsel", async () => {
  const intakeRows = [
    { id: "i-old", rider_id: "r-old", team_id: "t", status: "offered", created_at: OLD },
  ];
  const riders = [{ id: "r-old", team_id: null, pending_team_id: null }];
  const base = buildMockSupabase({ intakeRows, riders, capture: {} });
  // Wrap: et neq("source")-kald giver 42703 (kolonnen findes ikke), præcis som PostgREST.
  const missing = { code: "42703", message: "column academy_intake.source does not exist" };
  const supabase = {
    from(table) {
      const inner = base.from(table);
      if (table !== "academy_intake") return inner;
      return {
        ...inner,
        select(cols, opts) {
          const chain = inner.select(cols, opts);
          const failing = {
            lt: () => failing,
            order: () => failing,
            limit: () => Promise.resolve({ data: null, error: missing }),
            then: (res, rej) => Promise.resolve({ count: null, data: null, error: missing }).then(res, rej),
          };
          const wrap = (c) => new Proxy(c, {
            get(target, prop) {
              if (prop === "neq") return () => failing;
              const v = target[prop];
              return typeof v === "function" ? (...a) => { const r = v.apply(target, a); return r && typeof r === "object" && !r.then ? wrap(r) : r; } : v;
            },
          });
          return wrap(chain);
        },
      };
    },
  };
  const r = await runIntakeOfferExpirySweep({
    supabase,
    now: NOW,
    isEnabled: async () => true,
    listYouthAuctionFn: async () => ({ id: "a" }),
    giftPurgeFn: async () => ({ giftExpired: 0, giftReconciled: 0, giftKept: 0 }),
  });
  assert.equal(r.expired, 1);
});
