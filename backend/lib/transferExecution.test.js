import test from "node:test";
import assert from "node:assert/strict";

import {
  confirmSwapOffer,
  confirmTransferOffer,
  getListingCancelIssue,
  getListingPriceUpdateIssue,
  getLoanCancelIssue,
  getSwapCancelIssue,
  getSwapExecutionIssue,
  getTransferCancelIssue,
  getTransferExecutionIssue,
} from "./transferExecution.js";

test("getTransferExecutionIssue rejects a buyer that would exceed the squad max", () => {
  const issue = getTransferExecutionIssue({
    rider: { team_id: "seller-team" },
    sellerState: {
      id: "seller-team",
      division: 2,
      total_count: 15,
      squad_limits: { min: 14, max: 20 },
    },
    buyerState: {
      id: "buyer-team",
      balance: 500,
      division: 2,
      total_count: 20,
      squad_limits: { min: 14, max: 20 },
    },
    price: 50,
  });

  assert.equal(issue?.code, "buyer_squad_full");
  assert.equal(issue?.maxRiders, 20);
});

test("getTransferExecutionIssue rejects a seller that would fall below the squad min", () => {
  const issue = getTransferExecutionIssue({
    rider: { team_id: "seller-team" },
    sellerState: {
      id: "seller-team",
      division: 1,
      total_count: 20,
      squad_limits: { min: 20, max: 30 },
    },
    buyerState: {
      id: "buyer-team",
      balance: 500,
      division: 1,
      total_count: 24,
      squad_limits: { min: 20, max: 30 },
    },
    price: 50,
  });

  assert.equal(issue?.code, "seller_squad_too_small");
  assert.equal(issue?.minRiders, 20);
});

test("getTransferExecutionIssue rejects when the seller no longer owns the rider", () => {
  const issue = getTransferExecutionIssue({
    rider: { team_id: "other-team" },
    sellerState: {
      id: "seller-team",
      division: 3,
      total_count: 9,
      squad_limits: { min: 8, max: 10 },
    },
    buyerState: {
      id: "buyer-team",
      balance: 500,
      division: 3,
      total_count: 8,
      squad_limits: { min: 8, max: 10 },
    },
    price: 50,
  });

  assert.equal(issue?.code, "seller_no_longer_owns_rider");
});

test("getTransferExecutionIssue rejects when the buyer can no longer afford the rider", () => {
  const issue = getTransferExecutionIssue({
    rider: { team_id: "seller-team" },
    sellerState: {
      id: "seller-team",
      division: 3,
      total_count: 9,
      squad_limits: { min: 8, max: 10 },
    },
    buyerState: {
      id: "buyer-team",
      balance: 49,
      division: 3,
      total_count: 8,
      squad_limits: { min: 8, max: 10 },
    },
    price: 50,
  });

  assert.equal(issue?.code, "buyer_insufficient_balance");
});

test("getTransferExecutionIssue returns null when the transfer is still valid", () => {
  const issue = getTransferExecutionIssue({
    rider: { team_id: "seller-team" },
    sellerState: {
      id: "seller-team",
      division: 2,
      total_count: 15,
      squad_limits: { min: 14, max: 20 },
    },
    buyerState: {
      id: "buyer-team",
      balance: 500,
      division: 2,
      total_count: 18,
      squad_limits: { min: 14, max: 20 },
    },
    price: 50,
  });

  assert.equal(issue, null);
});

test("getSwapExecutionIssue rejects when one of the riders has moved", () => {
  const issue = getSwapExecutionIssue({
    swap: {
      proposing_team_id: "proposing-team",
      receiving_team_id: "receiving-team",
    },
    offered: { team_id: "proposing-team" },
    requested: { team_id: "someone-else" },
    proposingState: { balance: 500 },
    receivingState: { balance: 500 },
    cash: 0,
  });

  assert.equal(issue?.code, "requested_rider_moved");
});

test("getSwapExecutionIssue rejects when the payer no longer has the cash adjustment", () => {
  const issue = getSwapExecutionIssue({
    swap: {
      proposing_team_id: "proposing-team",
      receiving_team_id: "receiving-team",
    },
    offered: { team_id: "proposing-team" },
    requested: { team_id: "receiving-team" },
    proposingState: { balance: 25 },
    receivingState: { balance: 500 },
    cash: 50,
  });

  assert.equal(issue?.code, "proposing_insufficient_balance");
});

// ── #44: commitment-aware balance checks ─────────────────────────────────────

test("getTransferExecutionIssue blocks transfer når buyerCommitment ville pushe i underbalance", () => {
  // Køber har 500 balance + 460 i bud → 40 tilgængelig. Transfer 50 skal afvises.
  const issue = getTransferExecutionIssue({
    rider: { team_id: "seller-team" },
    sellerState: {
      id: "seller-team",
      division: 3,
      total_count: 9,
      squad_limits: { min: 8, max: 10 },
    },
    buyerState: {
      id: "buyer-team",
      balance: 500,
      division: 3,
      total_count: 8,
      squad_limits: { min: 8, max: 10 },
    },
    price: 50,
    buyerCommitment: 460,
  });
  assert.equal(issue?.code, "buyer_insufficient_balance");
});

test("getTransferExecutionIssue accepterer transfer når buyer har nok available", () => {
  // 500 balance, 100 i bud → 400 tilgængelig. Transfer 50 OK.
  const issue = getTransferExecutionIssue({
    rider: { team_id: "seller-team" },
    sellerState: {
      id: "seller-team",
      division: 3,
      total_count: 9,
      squad_limits: { min: 8, max: 10 },
    },
    buyerState: {
      id: "buyer-team",
      balance: 500,
      division: 3,
      total_count: 8,
      squad_limits: { min: 8, max: 10 },
    },
    price: 50,
    buyerCommitment: 100,
  });
  assert.equal(issue, null);
});

test("getSwapExecutionIssue blocks cash-swap når proposingCommitment ville pushe i underbalance", () => {
  // Foreslående har 25 balance med 0 commitment → 25 tilgængelig. Cash 50 → afvist.
  // Med 25 balance + 0 commitment + 50 cash skulle issue også vises.
  const issue = getSwapExecutionIssue({
    swap: { proposing_team_id: "p", receiving_team_id: "r" },
    offered: { team_id: "p" },
    requested: { team_id: "r" },
    proposingState: { balance: 100 },
    receivingState: { balance: 500 },
    cash: 50,
    proposingCommitment: 60,
  });
  assert.equal(issue?.code, "proposing_insufficient_balance");
});

test("getSwapExecutionIssue blocks cash-swap når receivingCommitment ville pushe i underbalance", () => {
  // Modtagende har 100 balance + 80 commitment → 20 tilgængelig. Cash -50 → afvist.
  const issue = getSwapExecutionIssue({
    swap: { proposing_team_id: "p", receiving_team_id: "r" },
    offered: { team_id: "p" },
    requested: { team_id: "r" },
    proposingState: { balance: 500 },
    receivingState: { balance: 100 },
    cash: -50,
    receivingCommitment: 80,
  });
  assert.equal(issue?.code, "receiving_insufficient_balance");
});

test("getTransferCancelIssue blocks manager cancel after both parties accepted", () => {
  assert.equal(
    getTransferCancelIssue({
      status: "window_pending",
      buyer_confirmed: true,
      seller_confirmed: true,
    })?.code,
    "deal_already_accepted"
  );

  assert.equal(
    getTransferCancelIssue({
      status: "awaiting_confirmation",
      buyer_confirmed: true,
      seller_confirmed: false,
    }),
    null
  );
});

test("getSwapCancelIssue blocks manager cancel after both parties accepted", () => {
  assert.equal(
    getSwapCancelIssue({
      status: "window_pending",
      proposing_confirmed: true,
      receiving_confirmed: true,
    })?.code,
    "deal_already_accepted"
  );

  assert.equal(
    getSwapCancelIssue({
      status: "awaiting_confirmation",
      proposing_confirmed: true,
      receiving_confirmed: false,
    }),
    null
  );
});

test("getLoanCancelIssue blocks manager cancel on active loan, allows on pending", () => {
  assert.equal(
    getLoanCancelIssue({ status: "active" })?.code,
    "loan_already_active"
  );

  assert.equal(getLoanCancelIssue({ status: "pending" }), null);
  assert.equal(getLoanCancelIssue({ status: "rejected" }), null);
  assert.equal(getLoanCancelIssue(null), null);
});

test("getListingCancelIssue: ejer kan fjerne open/negotiating, fremmede afvises, lukkede er no-op", () => {
  // not_found — listing eksisterer ikke
  assert.equal(
    getListingCancelIssue(null, { teamId: "T1" })?.code,
    "not_found"
  );

  // not_owner — fremmed manager må ikke
  assert.equal(
    getListingCancelIssue(
      { seller_team_id: "T2", status: "open" },
      { teamId: "T1" }
    )?.code,
    "not_owner"
  );

  // already_closed — withdrawn/sold listing kan ikke lukkes igen.
  // 'withdrawn' og 'sold' er de eneste terminale states i CHECK-enum'en
  // (open|negotiating|sold|withdrawn).
  assert.equal(
    getListingCancelIssue(
      { seller_team_id: "T1", status: "withdrawn" },
      { teamId: "T1" }
    )?.code,
    "already_closed"
  );
  assert.equal(
    getListingCancelIssue(
      { seller_team_id: "T1", status: "sold" },
      { teamId: "T1" }
    )?.code,
    "already_closed"
  );

  // happy path — ejer fjerner open eller negotiating
  assert.equal(
    getListingCancelIssue(
      { seller_team_id: "T1", status: "open" },
      { teamId: "T1" }
    ),
    null
  );
  assert.equal(
    getListingCancelIssue(
      { seller_team_id: "T1", status: "negotiating" },
      { teamId: "T1" }
    ),
    null
  );
});

// #1185: inline pris-redigering — samme ejerskabs-/status-regler som cancel,
// plus pris-validering (positivt heltal).
test("getListingPriceUpdateIssue: ejer kan redigere pris på open/negotiating, ugyldig pris afvises", () => {
  // genbruger cancel-reglerne: not_found / not_owner / already_closed
  assert.equal(
    getListingPriceUpdateIssue(null, { teamId: "T1", askingPrice: 100 })?.code,
    "not_found"
  );
  assert.equal(
    getListingPriceUpdateIssue(
      { seller_team_id: "T2", status: "open" },
      { teamId: "T1", askingPrice: 100 }
    )?.code,
    "not_owner"
  );
  assert.equal(
    getListingPriceUpdateIssue(
      { seller_team_id: "T1", status: "sold" },
      { teamId: "T1", askingPrice: 100 }
    )?.code,
    "already_closed"
  );

  // pris-validering: 0, negativ, decimal og NaN afvises
  for (const bad of [0, -5, 1.5, NaN, undefined]) {
    assert.equal(
      getListingPriceUpdateIssue(
        { seller_team_id: "T1", status: "open" },
        { teamId: "T1", askingPrice: bad }
      )?.code,
      "invalid_price",
      `askingPrice=${bad} skal afvises`
    );
  }

  // happy path — open og negotiating med gyldigt heltal
  assert.equal(
    getListingPriceUpdateIssue(
      { seller_team_id: "T1", status: "open" },
      { teamId: "T1", askingPrice: 250000 }
    ),
    null
  );
  assert.equal(
    getListingPriceUpdateIssue(
      { seller_team_id: "T1", status: "negotiating" },
      { teamId: "T1", askingPrice: 1 }
    ),
    null
  );
});

// ── #19: "betal nu, registrér ved åbning" — integration via in-memory supabase ──
//
// Minimal in-memory Supabase-double der dækker query-kæderne i transferExecution.
// Ikke en fuld klon: nok til at køre confirm/flush end-to-end og asserte på penge,
// status og pending_team_id.

function rowsFor(db, table) {
  if (!db[table]) db[table] = [];
  // #1308: riders.is_academy er NOT NULL DEFAULT false i DB. Squad-cap-queries
  // filtrerer nu .eq("is_academy", false); fixtures uden feltet ville ellers
  // blive ekskluderet (undefined !== false). Default'er feltet ved læsning.
  if (table === "riders") {
    for (const r of db[table]) if (r.is_academy === undefined) r.is_academy = false;
  }
  return db[table];
}

function matches(row, filters) {
  return filters.every((f) => {
    const v = row[f.col];
    if (f.kind === "eq") return v === f.val;
    if (f.kind === "neq") return v !== f.val;
    if (f.kind === "in") return f.val.includes(v);
    if (f.kind === "isNull") return v === null || v === undefined;
    if (f.kind === "notNull") return v !== null && v !== undefined;
    return true;
  });
}

function makeSupabase(db) {
  const finance = [];
  const seenIdempotencyKeys = new Set();

  function builder(table) {
    const state = { table, op: "select", filters: [], updateObj: null, insertObj: null, head: false };

    function applyMutation() {
      const rows = rowsFor(db, table);
      if (state.op === "update") {
        const hit = rows.filter((r) => matches(r, state.filters));
        hit.forEach((r) => Object.assign(r, state.updateObj));
        return hit;
      }
      if (state.op === "insert") {
        const inserted = { id: `row-${rows.length + 1}`, ...state.insertObj };
        rows.push(inserted);
        return [inserted];
      }
      return rowsFor(db, table).filter((r) => matches(r, state.filters));
    }

    const api = {
      select(_cols, opts) { state.op = state.op === "select" ? "select" : state.op; if (opts?.head) state.head = true; return api; },
      update(obj) { state.op = "update"; state.updateObj = obj; return api; },
      insert(obj) { state.op = "insert"; state.insertObj = obj; return api; },
      eq(col, val) { state.filters.push({ kind: "eq", col, val }); return api; },
      neq(col, val) { state.filters.push({ kind: "neq", col, val }); return api; },
      in(col, val) { state.filters.push({ kind: "in", col, val }); return api; },
      is(col, _val) { state.filters.push({ kind: "isNull", col }); return api; },
      not(col, _op, _val) { state.filters.push({ kind: "notNull", col }); return api; },
      or() { return api; },
      order() { return api; },
      limit() { return api; },
      single() { const r = applyMutation(); return Promise.resolve({ data: r[0] ?? null, error: null }); },
      maybeSingle() { const r = applyMutation(); return Promise.resolve({ data: r[0] ?? null, error: null }); },
      then(resolve, reject) {
        try {
          const r = applyMutation();
          return Promise.resolve({ data: r, count: r.length, error: null }).then(resolve, reject);
        } catch (e) { return Promise.reject(e).then(resolve, reject); }
      },
    };
    return api;
  }

  return {
    _finance: finance,
    from(table) { return builder(table); },
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      const key = params.p_finance_payload?.idempotency_key;
      if (key && seenIdempotencyKeys.has(key)) {
        return Promise.resolve({ data: null, error: { code: "23505" } });
      }
      if (key) seenIdempotencyKeys.add(key);
      const team = rowsFor(db, "teams").find((t) => t.id === params.p_team_id);
      if (team) team.balance += params.p_delta;
      finance.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: team?.balance ?? 0, error: null });
    },
  };
}

function baseDb({ windowStatus }) {
  const sellerRiders = Array.from({ length: 9 }, (_, i) => ({
    id: `s-rider-${i}`, firstname: "S", lastname: `${i}`, team_id: "seller", pending_team_id: null,
  }));
  return {
    teams: [
      { id: "buyer", name: "Buyer FC", balance: 1000, division: 3, user_id: "u-buyer", is_bank: false },
      { id: "seller", name: "Seller FC", balance: 500, division: 3, user_id: "u-seller", is_bank: false },
    ],
    riders: [
      { id: "rider-1", firstname: "Alex", lastname: "Star", team_id: "seller", pending_team_id: null, salary: 0, prize_earnings_bonus: 0 },
      ...sellerRiders,
      { id: "buyer-rider-1", firstname: "B", lastname: "One", team_id: "buyer", pending_team_id: null },
    ],
    transfer_offers: [],
    swap_offers: [],
    transfer_listings: [],
    auctions: [],
    auction_proxy_bids: [],
    loan_agreements: [],
    seasons: [{ id: "season-1", status: "active" }],
    transfer_windows: [{ status: windowStatus, created_at: "2026-05-31" }],
  };
}

test("#16: confirmTransferOffer registrerer med det samme — selv med en 'closed' transfer_windows-række (altid-åben handel)", async () => {
  const db = baseDb({ windowStatus: "closed" }); // ignoreres nu — getTransferWindowOpen er altid true
  db.transfer_offers.push({
    id: "offer-1", rider_id: "rider-1", seller_team_id: "seller", buyer_team_id: "buyer",
    offer_amount: 200, counter_amount: null, status: "awaiting_confirmation",
    buyer_confirmed: false, seller_confirmed: true,
  });
  const supabase = makeSupabase(db);

  const result = await confirmTransferOffer({
    supabase, offerId: "offer-1", confirmingTeamId: "buyer",
    notifyTeamOwner: async () => {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "accepted", "altid-åben → registreres straks, ikke window_pending");

  const rider = db.riders.find((r) => r.id === "rider-1");
  assert.equal(rider.team_id, "buyer", "rytteren flyttes med det samme");
  assert.equal(rider.pending_team_id, null, "intet parkeres");

  assert.equal(db.teams.find((t) => t.id === "buyer").balance, 800, "køber betaler nu");
  assert.equal(db.teams.find((t) => t.id === "seller").balance, 700, "sælger får pengene nu");

  assert.equal(db.transfer_offers[0].status, "accepted");
  assert.equal(supabase._finance.length, 2, "præcis to finance-posteringer (køber + sælger)");
});

// #16: flush-stien (flushWindowPendingOffers efter parkering) er udgået som testscenarie —
// med altid-åben handel parkeres intet, så confirm-stien udløser aldrig en window_pending-flush.
// flushWindowPendingOffers-funktionen bevares dvælende (admin-vindue-åbning), men er ikke
// længere nået fra confirm-stien, så der er intet at dobbelt-betalings-teste her.

test("#19: confirmTransferOffer flytter team_id med det samme når vinduet er åbent", async () => {
  const db = baseDb({ windowStatus: "open" });
  db.transfer_offers.push({
    id: "offer-1", rider_id: "rider-1", seller_team_id: "seller", buyer_team_id: "buyer",
    offer_amount: 200, counter_amount: null, status: "awaiting_confirmation",
    buyer_confirmed: false, seller_confirmed: true,
  });
  const supabase = makeSupabase(db);

  const result = await confirmTransferOffer({
    supabase, offerId: "offer-1", confirmingTeamId: "buyer", notifyTeamOwner: async () => {},
  });

  assert.equal(result.action, "accepted");
  const rider = db.riders.find((r) => r.id === "rider-1");
  assert.equal(rider.team_id, "buyer", "åbent vindue → team_id flyttes nu");
  assert.equal(rider.pending_team_id, null);
  assert.equal(db.transfer_offers[0].status, "accepted");
  assert.equal(db.teams.find((t) => t.id === "buyer").balance, 800);
});

test("#16: confirmSwapOffer registrerer begge ryttere med det samme (altid-åben handel)", async () => {
  const db = baseDb({ windowStatus: "closed" }); // ignoreres — altid-åben
  // Giv modtager-holdet nok ryttere til at afgive én.
  for (let i = 0; i < 9; i++) {
    db.riders.push({ id: `r-rider-${i}`, firstname: "R", lastname: `${i}`, team_id: "buyer", pending_team_id: null });
  }
  db.riders.push({ id: "req-rider", firstname: "Req", lastname: "Star", team_id: "buyer", pending_team_id: null });
  db.swap_offers.push({
    id: "swap-1", offered_rider_id: "rider-1", requested_rider_id: "req-rider",
    proposing_team_id: "seller", receiving_team_id: "buyer",
    cash_adjustment: 0, counter_cash: null, status: "awaiting_confirmation",
    proposing_confirmed: true, receiving_confirmed: false,
  });
  const supabase = makeSupabase(db);

  const result = await confirmSwapOffer({
    supabase, swapId: "swap-1", confirmingTeamId: "buyer", notifyTeamOwner: async () => {},
  });

  assert.equal(result.action, "accepted", "altid-åben → byttehandel registreres straks");
  assert.equal(db.riders.find((r) => r.id === "rider-1").team_id, "buyer", "tilbudt rytter flyttet straks");
  assert.equal(db.riders.find((r) => r.id === "rider-1").pending_team_id, null);
  assert.equal(db.riders.find((r) => r.id === "req-rider").team_id, "seller", "ønsket rytter flyttet straks");
  assert.equal(db.riders.find((r) => r.id === "req-rider").pending_team_id, null);
  assert.equal(db.swap_offers[0].status, "accepted");
});

// ── #1309 kontrakt-on-acquire (transfer + swap) ──────────────────────────────

// Kontraktløs rytter (salary == null) der erhverves via transfer → standard-
// kontrakt oprettes i samme rider-update som ejerskabsskiftet.
test("#1309: confirmTransferOffer opretter standard-kontrakt for kontraktløs rytter", async () => {
  const db = baseDb({ windowStatus: "open" });
  // Erstat rider-1 med en kontraktløs free-agent-lignende rytter (salary null).
  const rider = db.riders.find((r) => r.id === "rider-1");
  rider.salary = null;
  rider.base_value = 1_000_000;
  rider.prize_earnings_bonus = 0;
  rider.contract_length = null;
  rider.contract_end_season = null;
  db.transfer_offers.push({
    id: "offer-c1", rider_id: "rider-1", seller_team_id: "seller", buyer_team_id: "buyer",
    offer_amount: 200, counter_amount: null, status: "awaiting_confirmation",
    buyer_confirmed: false, seller_confirmed: true,
  });
  const supabase = makeSupabase(db);

  const result = await confirmTransferOffer({
    supabase, offerId: "offer-c1", confirmingTeamId: "buyer", notifyTeamOwner: async () => {},
  });

  assert.equal(result.action, "accepted");
  const moved = db.riders.find((r) => r.id === "rider-1");
  assert.equal(moved.team_id, "buyer");
  assert.equal(moved.salary, 67_000, "salary = 6.7% af base_value 1_000_000");
  assert.equal(moved.contract_length, 2);
  assert.equal(moved.contract_end_season, 2, "aktiv sæson 1 + 2 - 1");
});

// Rytter MED kontrakt (salary != null) → ejerskab skifter, men kontrakten arves
// UÆNDRET (salary/contract_length/contract_end_season røres ikke).
test("#1309: confirmTransferOffer arver eksisterende kontrakt uændret", async () => {
  const db = baseDb({ windowStatus: "open" });
  const rider = db.riders.find((r) => r.id === "rider-1");
  rider.salary = 42_000; // eksisterende kontrakt
  rider.base_value = 1_000_000;
  rider.prize_earnings_bonus = 0;
  rider.contract_length = 3;
  rider.contract_end_season = 4;
  db.transfer_offers.push({
    id: "offer-c2", rider_id: "rider-1", seller_team_id: "seller", buyer_team_id: "buyer",
    offer_amount: 200, counter_amount: null, status: "awaiting_confirmation",
    buyer_confirmed: false, seller_confirmed: true,
  });
  const supabase = makeSupabase(db);

  const result = await confirmTransferOffer({
    supabase, offerId: "offer-c2", confirmingTeamId: "buyer", notifyTeamOwner: async () => {},
  });

  assert.equal(result.action, "accepted");
  const moved = db.riders.find((r) => r.id === "rider-1");
  assert.equal(moved.team_id, "buyer", "ejerskab skifter");
  // Kontrakt UÆNDRET — aldrig regenereret.
  assert.equal(moved.salary, 42_000);
  assert.equal(moved.contract_length, 3);
  assert.equal(moved.contract_end_season, 4);
});

// Swap: en kontraktløs rytter får kontrakt ved erhvervelse; en rytter med
// kontrakt arver uændret.
test("#1309: confirmSwapOffer create-if-missing / inherit-if-present pr. rytter", async () => {
  const db = baseDb({ windowStatus: "open" });
  // Modtager-hold (buyer) skal kunne afgive en rytter.
  for (let i = 0; i < 9; i++) {
    db.riders.push({ id: `r-rider-${i}`, firstname: "R", lastname: `${i}`, team_id: "buyer", pending_team_id: null, salary: 10 });
  }
  // offered (rider-1) = kontraktløs; requested (req-rider) = har kontrakt.
  const offered = db.riders.find((r) => r.id === "rider-1");
  offered.salary = null;
  offered.base_value = 500_000;
  offered.prize_earnings_bonus = 0;
  db.riders.push({
    id: "req-rider", firstname: "Req", lastname: "Star", team_id: "buyer", pending_team_id: null,
    salary: 7_500, base_value: 999_999, prize_earnings_bonus: 0, contract_length: 1, contract_end_season: 1,
  });
  db.swap_offers.push({
    id: "swap-c1", offered_rider_id: "rider-1", requested_rider_id: "req-rider",
    proposing_team_id: "seller", receiving_team_id: "buyer",
    cash_adjustment: 0, counter_cash: null, status: "awaiting_confirmation",
    proposing_confirmed: true, receiving_confirmed: false,
  });
  const supabase = makeSupabase(db);

  const result = await confirmSwapOffer({
    supabase, swapId: "swap-c1", confirmingTeamId: "buyer", notifyTeamOwner: async () => {},
  });

  assert.equal(result.action, "accepted");
  // offered (kontraktløs) → ny kontrakt, nu på buyer
  const movedOffered = db.riders.find((r) => r.id === "rider-1");
  assert.equal(movedOffered.team_id, "buyer");
  assert.equal(movedOffered.salary, 33_500, "6.7% af 500_000");
  assert.equal(movedOffered.contract_length, 2);
  assert.equal(movedOffered.contract_end_season, 2);
  // requested (har kontrakt) → uændret, nu på seller
  const movedRequested = db.riders.find((r) => r.id === "req-rider");
  assert.equal(movedRequested.team_id, "seller");
  assert.equal(movedRequested.salary, 7_500);
  assert.equal(movedRequested.contract_length, 1);
  assert.equal(movedRequested.contract_end_season, 1);
});
