import test from "node:test";
import assert from "node:assert/strict";

import { getSeasonPrizePreview, paySeasonPrizesToDate } from "./prizePayoutEngine.js";
import { FINANCE_ACTOR_TYPE } from "./economyConstants.js";

// Mock-query-builder: thenable (for kæder der afsluttes uden .range(), fx races/
// teams) OG med .range() der pager (for fetchAllRows på race_results/finance_tx).
// Håndhæver PostgREST's 1000-row-loft pr. side via slice, så manglende paginering
// fanges af testen.
function queryFor(rows) {
  const obj = {
    select: () => obj,
    eq: () => obj,
    in: () => obj,
    gt: () => obj,
    order: () => obj,
    range: (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
    then: (resolve) => resolve({ data: rows, error: null }),
  };
  return obj;
}

function makeSupabase({ races = [], results = [], transactions = [], teams = [] }) {
  return {
    from(table) {
      if (table === "races") return queryFor(races);
      if (table === "race_results") return queryFor(results);
      if (table === "finance_transactions") return queryFor(transactions);
      if (table === "teams") return queryFor(teams);
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

test("getSeasonPrizePreview paginerer race_results forbi 1000-row-loftet", async () => {
  // 2500 præmie-rækker (10 CZ$ hver) for ét hold i ét ubetalt løb. Uden
  // paginering ville kun de første 1000 tælle → 10.000 i stedet for 25.000.
  const results = [];
  for (let i = 0; i < 2500; i += 1) {
    results.push({ race_id: "r1", team_id: "t1", prize_money: 10 });
  }
  const supabase = makeSupabase({
    races: [{ id: "r1", name: "Race 1", prize_paid_at: null, status: "completed" }],
    results,
    teams: [{ id: "t1", name: "Team 1" }],
  });

  const preview = await getSeasonPrizePreview("season-1", supabase);

  assert.equal(preview.pending_payment.length, 1);
  assert.equal(preview.pending_payment[0].total_prize, 25000); // alle 2500 sider talt
  assert.equal(preview.total_pending, 25000);
});

test("getSeasonPrizePreview splitter betalte og udestående løb", async () => {
  const supabase = makeSupabase({
    races: [
      { id: "paid", name: "Betalt", prize_paid_at: "2026-05-30T00:00:00Z", status: "completed" },
      { id: "pending", name: "Udestående", prize_paid_at: null, status: "completed" },
    ],
    results: [
      { race_id: "pending", team_id: "t1", prize_money: 500 },
      { race_id: "pending", team_id: "t2", prize_money: 300 },
      // 0-præmie-rækker filtreres af .gt("prize_money", 0) i prod; mock returnerer
      // kun det query'et ville — så vi udelader dem her.
    ],
    transactions: [
      { race_id: "paid", team_id: "t1", amount: 800 },
    ],
    teams: [{ id: "t1", name: "Team 1" }, { id: "t2", name: "Team 2" }],
  });

  const preview = await getSeasonPrizePreview("season-1", supabase);

  assert.equal(preview.already_paid.length, 1);
  assert.equal(preview.already_paid[0].total_paid, 800);
  assert.equal(preview.pending_payment.length, 1);
  assert.equal(preview.pending_payment[0].total_prize, 800);
  assert.equal(preview.total_pending, 800);
  // team-navne resolves
  assert.equal(preview.pending_payment[0].by_team.find(t => t.team_id === "t1").team_name, "Team 1");

  // team_totals: per-hold-aggregering på tværs af pending + paid, sorteret desc
  assert.equal(preview.team_totals.length, 2);
  const t1 = preview.team_totals.find(t => t.team_id === "t1");
  assert.deepEqual(t1, { team_id: "t1", team_name: "Team 1", pending: 500, paid: 800, total: 1300 });
  const t2 = preview.team_totals.find(t => t.team_id === "t2");
  assert.deepEqual(t2, { team_id: "t2", team_name: "Team 2", pending: 300, paid: 0, total: 300 });
  // sorteret efter total desc → t1 (1300) før t2 (300)
  assert.deepEqual(preview.team_totals.map(t => t.team_id), ["t1", "t2"]);
});

test("getSeasonPrizePreview returnerer tomt ved ingen løb", async () => {
  const preview = await getSeasonPrizePreview("season-1", makeSupabase({ races: [] }));
  assert.deepEqual(preview, {
    already_paid: [],
    pending_payment: [],
    total_pending: 0,
    totals: { earned: 0, payable: 0, free_ai: 0 },
    team_totals: [],
    reconciliation: [],
    warnings: [],
  });
});

test("getSeasonPrizePreview splitter optjent vs udbetalbar (#896)", async () => {
  const supabase = makeSupabase({
    races: [{ id: "r1", name: "Race 1", prize_paid_at: null, status: "completed" }],
    results: [
      { race_id: "r1", team_id: "t1", prize_money: 500 }, // udbetalbar
      { race_id: "r1", team_id: "t2", prize_money: 300 }, // udbetalbar
      { race_id: "r1", team_id: null, prize_money: 200 }, // fri/AI (holdsløs rytter)
    ],
    teams: [{ id: "t1", name: "Team 1" }, { id: "t2", name: "Team 2" }],
  });

  const preview = await getSeasonPrizePreview("season-1", supabase);

  assert.deepEqual(preview.totals, { earned: 1000, payable: 800, free_ai: 200 });
  // total_pending er kun det udbetalbare — fri/AI tæller IKKE med.
  assert.equal(preview.total_pending, 800);
  assert.equal(preview.warnings.length, 0);
});

test("getSeasonPrizePreview advarer ved løb hvor hele puljen er fri/AI (#896)", async () => {
  const supabase = makeSupabase({
    races: [{ id: "r1", name: "AI Race", prize_paid_at: null, status: "completed" }],
    results: [
      { race_id: "r1", team_id: null, prize_money: 1500 },
    ],
    teams: [],
  });

  const preview = await getSeasonPrizePreview("season-1", supabase);

  // Løbet droppes IKKE stille — det bliver en eksplicit warning.
  assert.equal(preview.pending_payment.length, 0);
  assert.equal(preview.warnings.length, 1);
  assert.equal(preview.warnings[0].type, "all_free_ai");
  assert.equal(preview.warnings[0].race_id, "r1");
  assert.equal(preview.totals.free_ai, 1500);
});

test("getSeasonPrizePreview reconcilerer betalt løb: results-sum vs finance-sum (#896)", async () => {
  const supabase = makeSupabase({
    races: [
      { id: "ok", name: "Match", prize_paid_at: "2026-05-30T00:00:00Z", status: "completed" },
      { id: "bad", name: "Mismatch", prize_paid_at: "2026-05-30T00:00:00Z", status: "completed" },
    ],
    results: [
      // 'ok': results-sum (udbetalbar) = finance-sum
      { race_id: "ok", team_id: "t1", prize_money: 800 },
      { race_id: "ok", team_id: null, prize_money: 100 }, // fri/AI tæller IKKE i reconciliation
      // 'bad': results-sum 500 ≠ finance 800
      { race_id: "bad", team_id: "t1", prize_money: 500 },
    ],
    transactions: [
      { race_id: "ok", team_id: "t1", amount: 800 },
      { race_id: "bad", team_id: "t1", amount: 800 },
    ],
    teams: [{ id: "t1", name: "Team 1" }],
  });

  const preview = await getSeasonPrizePreview("season-1", supabase);

  const ok = preview.reconciliation.find(r => r.race_id === "ok");
  const bad = preview.reconciliation.find(r => r.race_id === "bad");
  assert.deepEqual(ok, { race_id: "ok", race_name: "Match", results_total: 800, finance_total: 800, diff: 0, ok: true });
  assert.deepEqual(bad, { race_id: "bad", race_name: "Mismatch", results_total: 500, finance_total: 800, diff: 300, ok: false });
});

// ─── paySeasonPrizesToDate → rider-value recalc wiring (R3, #895) ──────────────

// Stateful mock covering BOTH the payout path (rpc + races.update + import_log)
// and the updateRiderValues recalc it now triggers (seasons + riders.update).
function makePayoutSupabase({ pendingRace, riders = [], activeSeason = null, completedSeasons = [], failRecalc = false }) {
  const state = { rpcCalls: [], racesPaidAt: [], importLogs: [], riderUpdates: [] };

  const racesRows = [{ id: pendingRace.id, name: pendingRace.name, prize_paid_at: null, status: "completed", season_id: "season-1" }];
  const resultRows = pendingRace.results; // { race_id, team_id, rider_id, prize_money }

  const supabase = {
    state,
    rpc(name, params) {
      state.rpcCalls.push({ name, params });
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      if (table === "races") {
        return {
          // Preview: .select(...).eq("season_id").eq("status") → thenable rows
          // Recalc:  .select("id, season_id").in("season_id",[...]).range()
          select(columns) {
            const builder = {
              eq: () => builder,
              in: () => builder,
              range: (from, to) => {
                const rows = racesRows
                  .map(r => (columns === "id, season_id" ? { id: r.id, season_id: r.season_id } : r))
                  .slice(from, to + 1);
                return Promise.resolve({ data: rows, error: null });
              },
              then: (resolve) => resolve({ data: racesRows, error: null }),
            };
            return builder;
          },
          // #1573: opdateringen er nu et atomart compare-and-set gatet på
          // prize_paid_at IS NULL og læser de ramte rækker tilbage via .select().
          // Mocken simulerer Postgres: kun det FØRSTE update pr. race-id rammer en
          // række (sætter prize_paid_at); efterfølgende kald (et tabende tick) ser
          // rækken allerede sat og returnerer data: [].
          update(payload) {
            const builder = { _id: null, _gated: false };
            builder.eq = (_c, id) => { builder._id = id; return builder; };
            builder.is = (_col, _val) => { builder._gated = true; return builder; };
            builder.select = () => {
              const already = state.racesPaidAt.some(r => r.id === builder._id);
              if (builder._gated && already) {
                return Promise.resolve({ data: [], error: null });
              }
              state.racesPaidAt.push({ id: builder._id, ...payload });
              return Promise.resolve({ data: [{ id: builder._id }], error: null });
            };
            return builder;
          },
        };
      }
      if (table === "race_results") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          gt: () => builder,
          order: () => builder,
          range: (from, to) => Promise.resolve({ data: resultRows.slice(from, to + 1), error: null }),
          then: (resolve) => resolve({ data: resultRows, error: null }),
        };
        return builder;
      }
      if (table === "finance_transactions") {
        const builder = { select: () => builder, eq: () => builder, in: () => builder, order: () => builder, range: () => Promise.resolve({ data: [], error: null }), then: (r) => r({ data: [], error: null }) };
        return builder;
      }
      if (table === "teams") {
        const builder = { select: () => builder, in: () => builder, then: (r) => r({ data: [], error: null }) };
        return builder;
      }
      if (table === "import_log") {
        return { insert: (row) => { state.importLogs.push(row); return Promise.resolve({ error: null }); } };
      }
      if (table === "seasons") {
        if (failRecalc) throw new Error("simuleret recalc-fejl");
        return {
          select() {
            return {
              eq(_col, value) {
                if (value === "active") {
                  return { maybeSingle: () => Promise.resolve({ data: activeSeason, error: null }) };
                }
                // .eq("status","completed").gt("race_days_total",0).order().limit()
                return { gt: () => ({ order: () => ({ limit: () => Promise.resolve({ data: completedSeasons, error: null }) }) }) };
              },
            };
          },
        };
      }
      if (table === "riders") {
        return {
          select: () => ({ range: (from, to) => Promise.resolve({ data: riders.slice(from, to + 1), error: null }) }),
          update: (payload) => ({ eq: (_c, id) => { state.riderUpdates.push({ id, ...payload }); return Promise.resolve({ error: null }); } }),
        };
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
  return supabase;
}

test("paySeasonPrizesToDate triggers fixed-window rider-value recalc after paying", async () => {
  const supabase = makePayoutSupabase({
    pendingRace: {
      id: "race-1",
      name: "Tour Stage 1",
      results: [
        { race_id: "race-1", team_id: "team-1", rider_id: "rider-1", prize_money: 8000 },
      ],
    },
    riders: [{ id: "rider-1" }],
    // Open-beta season 1: lone active season at 10% → fixed /3 window dampens it.
    activeSeason: { id: "season-1", number: 1, race_days_completed: 6, race_days_total: 60 },
    completedSeasons: [],
  });

  const result = await paySeasonPrizesToDate("season-1", "admin-1", supabase);

  assert.equal(result.races_paid, 1);
  assert.equal(result.total_paid, 8000);
  assert.equal(result.riders_updated, 1);
  // Payout happened...
  assert.equal(supabase.state.rpcCalls.length, 1);
  assert.equal(supabase.state.racesPaidAt.length, 1);
  // ...and the rider value was recalculated over the fixed 3-season window:
  // round(8000 / 3) = 2667 (season 1 deliberately dampened to one third).
  assert.deepEqual(supabase.state.riderUpdates, [
    { id: "rider-1", prize_earnings_bonus: 2667 },
  ]);
});

test("paySeasonPrizesToDate still succeeds when the rider-value recalc throws", async () => {
  const supabase = makePayoutSupabase({
    pendingRace: {
      id: "race-1",
      name: "Tour Stage 1",
      results: [{ race_id: "race-1", team_id: "team-1", rider_id: "rider-1", prize_money: 8000 }],
    },
    riders: [{ id: "rider-1" }],
    failRecalc: true,
  });

  const result = await paySeasonPrizesToDate("season-1", "admin-1", supabase);

  // Payout is committed; recalc failure is surfaced as riders_updated=null, not thrown.
  assert.equal(result.races_paid, 1);
  assert.equal(result.total_paid, 8000);
  assert.equal(result.riders_updated, null);
  assert.equal(supabase.state.racesPaidAt.length, 1);
});

// ─── opts.actorType: cron-payout logger som SYSTEM, ikke ADMIN (#WS1) ──────────

test("paySeasonPrizesToDate logger actor_type=admin som default (uændret adfærd)", async () => {
  const supabase = makePayoutSupabase({
    pendingRace: {
      id: "race-1",
      name: "Tour Stage 1",
      results: [{ race_id: "race-1", team_id: "team-1", rider_id: "rider-1", prize_money: 1000 }],
    },
    riders: [{ id: "rider-1" }],
    activeSeason: { id: "season-1", number: 1, race_days_completed: 6, race_days_total: 60 },
  });

  await paySeasonPrizesToDate("season-1", "admin-1", supabase);

  assert.equal(supabase.state.rpcCalls.length, 1);
  assert.equal(supabase.state.rpcCalls[0].params.p_finance_payload.actor_type, FINANCE_ACTOR_TYPE.ADMIN);
});

test("paySeasonPrizesToDate logger actor_type=system når actorType=SYSTEM", async () => {
  const supabase = makePayoutSupabase({
    pendingRace: {
      id: "race-1",
      name: "Tour Stage 1",
      results: [{ race_id: "race-1", team_id: "team-1", rider_id: "rider-1", prize_money: 1000 }],
    },
    riders: [{ id: "rider-1" }],
    activeSeason: { id: "season-1", number: 1, race_days_completed: 6, race_days_total: 60 },
  });

  await paySeasonPrizesToDate("season-1", null, supabase, { actorType: FINANCE_ACTOR_TYPE.SYSTEM });

  assert.equal(supabase.state.rpcCalls.length, 1);
  const payload = supabase.state.rpcCalls[0].params.p_finance_payload;
  assert.equal(payload.actor_type, FINANCE_ACTOR_TYPE.SYSTEM);
  // actor_id falder tilbage til null når ingen admin-bruger angives.
  assert.equal(payload.actor_id, null);
});

// ─── #1573: concurrent-tick race → præcis ÉN import_log-række ───────────────────

// Mock der trofast gengiver TOCTOU'en: BEGGE ticks læser samme pending-preview
// (preview-read af races returnerer altid prize_paid_at: null — som om begge
// snapshottede den ubetalte tilstand før noget update committede). UPDATE'et er
// et delt compare-and-set gatet på prize_paid_at IS NULL: kun det FØRSTE tick pr.
// race-id rammer en række; det tabende tick rammer 0 og må IKKE indsætte en
// import_log-række. balanceRpc returnerer skipped for det tabende ticks dublet-
// idempotency_key (som uniq_finance_idempotency_key gør i prod).
function makeConcurrentPayoutSupabase({ pendingRace }) {
  const state = { importLogs: [], claimed: new Set(), seenIdemKeys: new Set() };
  const racesRow = { id: pendingRace.id, name: pendingRace.name, prize_paid_at: null, status: "completed", season_id: "season-1" };
  const resultRows = pendingRace.results;

  return {
    state,
    rpc(_name, params) {
      // Simulér uniq_finance_idempotency_key: anden gang samme key ses → 23505.
      const key = params?.p_finance_payload?.idempotency_key;
      if (key && state.seenIdemKeys.has(key)) {
        return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
      }
      if (key) state.seenIdemKeys.add(key);
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      if (table === "races") {
        return {
          select(columns) {
            // Preview-read ser ALTID den ubetalte tilstand (frosset snapshot for
            // begge ticks) — det er kernen i TOCTOU'en.
            const builder = {
              eq: () => builder,
              in: () => builder,
              range: (from, to) => {
                const rows = [racesRow]
                  .map(r => (columns === "id, season_id" ? { id: r.id, season_id: r.season_id } : r))
                  .slice(from, to + 1);
                return Promise.resolve({ data: rows, error: null });
              },
              then: (resolve) => resolve({ data: [racesRow], error: null }),
            };
            return builder;
          },
          update(payload) {
            const builder = { _id: null, _gated: false };
            builder.eq = (_c, id) => { builder._id = id; return builder; };
            builder.is = () => { builder._gated = true; return builder; };
            builder.select = () => {
              // Atomart compare-and-set: kun første claim pr. race-id vinder.
              if (builder._gated && state.claimed.has(builder._id)) {
                return Promise.resolve({ data: [], error: null });
              }
              state.claimed.add(builder._id);
              return Promise.resolve({ data: [{ id: builder._id, ...payload }], error: null });
            };
            return builder;
          },
        };
      }
      if (table === "race_results") {
        const builder = { select: () => builder, eq: () => builder, in: () => builder, gt: () => builder, order: () => builder, range: (from, to) => Promise.resolve({ data: resultRows.slice(from, to + 1), error: null }), then: (r) => r({ data: resultRows, error: null }) };
        return builder;
      }
      if (table === "finance_transactions") {
        const builder = { select: () => builder, eq: () => builder, in: () => builder, order: () => builder, range: () => Promise.resolve({ data: [], error: null }), then: (r) => r({ data: [], error: null }) };
        return builder;
      }
      if (table === "teams") {
        const builder = { select: () => builder, in: () => builder, then: (r) => r({ data: [], error: null }) };
        return builder;
      }
      if (table === "import_log") {
        return { insert: (row) => { state.importLogs.push(row); return Promise.resolve({ error: null }); } };
      }
      // Rider-value recalc er ortogonal til dette race — stub den til no-op.
      if (table === "seasons") {
        return { select: () => ({ eq: (_c, v) => (v === "active"
          ? { maybeSingle: () => Promise.resolve({ data: null, error: null }) }
          : { gt: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }) };
      }
      if (table === "riders") {
        return { select: () => ({ range: () => Promise.resolve({ data: [], error: null }) }), update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

test("paySeasonPrizesToDate: to samtidige ticks indsætter præcis ÉN import_log-række (#1573)", async () => {
  const supabase = makeConcurrentPayoutSupabase({
    pendingRace: {
      id: "race-1",
      name: "Tour Stage 1",
      results: [{ race_id: "race-1", team_id: "team-1", rider_id: "rider-1", prize_money: 5000 }],
    },
  });

  // To ticks der race'r: begge læser preview (prize_paid_at IS NULL), begge
  // forsøger at betale + sætte prize_paid_at. Kør dem concurrently for at
  // efterligne to cron-ticks der overlapper.
  const [a, b] = await Promise.all([
    paySeasonPrizesToDate("season-1", null, supabase, { actorType: FINANCE_ACTOR_TYPE.SYSTEM }),
    paySeasonPrizesToDate("season-1", null, supabase, { actorType: FINANCE_ACTOR_TYPE.SYSTEM }),
  ]);

  // KERNE-ASSERTION: præcis én audit-række på trods af to ticks.
  assert.equal(supabase.state.importLogs.length, 1, "forventede præcis én import_log-række");
  assert.equal(supabase.state.importLogs[0].rows_processed, 1);
  assert.equal(supabase.state.importLogs[0].import_type, "prize_payout");

  // Præcis ét tick vandt løbet (races_paid: 1); det andet claimede intet (0).
  const claimed = [a, b].map(r => r.races_paid).sort();
  assert.deepEqual(claimed, [0, 1], "ét tick claimer løbet, det andet claimer intet");

  // Balancen blev udbetalt netop én gang (idempotency_key beskytter den), og
  // race blev kun sat én gang.
  assert.equal(supabase.state.claimed.size, 1);
});

test("paySeasonPrizesToDate: et enkelt tick indsætter stadig præcis ÉN import_log-række (#1573 ikke-regression)", async () => {
  const supabase = makeConcurrentPayoutSupabase({
    pendingRace: {
      id: "race-1",
      name: "Tour Stage 1",
      results: [{ race_id: "race-1", team_id: "team-1", rider_id: "rider-1", prize_money: 5000 }],
    },
  });

  const result = await paySeasonPrizesToDate("season-1", null, supabase, { actorType: FINANCE_ACTOR_TYPE.SYSTEM });

  assert.equal(result.races_paid, 1);
  assert.equal(result.total_paid, 5000);
  assert.equal(supabase.state.importLogs.length, 1);
});

test("paySeasonPrizesToDate: et tick der taber ALT springer import_log over (#1573)", async () => {
  const supabase = makeConcurrentPayoutSupabase({
    pendingRace: {
      id: "race-1",
      name: "Tour Stage 1",
      results: [{ race_id: "race-1", team_id: "team-1", rider_id: "rider-1", prize_money: 5000 }],
    },
  });

  // Første tick claimer løbet.
  await paySeasonPrizesToDate("season-1", null, supabase, { actorType: FINANCE_ACTOR_TYPE.SYSTEM });
  assert.equal(supabase.state.importLogs.length, 1);

  // Andet tick læser samme frosne preview (prize_paid_at IS NULL i mocken), men
  // taber compare-and-set'et for ALLE løb → ingen ny import_log-række.
  const second = await paySeasonPrizesToDate("season-1", null, supabase, { actorType: FINANCE_ACTOR_TYPE.SYSTEM });

  assert.equal(second.races_paid, 0);
  assert.equal(second.total_paid, 0);
  assert.deepEqual(second.by_race, []);
  assert.equal(supabase.state.importLogs.length, 1, "tabende tick må IKKE tilføje en import_log-række");
});
