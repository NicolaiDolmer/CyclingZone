// #6181 · Saelgerens besked ved handlen, proevet paa adfaerd (dommerens B16 og B17).
//
// Koerer confirmTransferOffer og finalizeAuctionById mod en lille in-memory supabase
// og ser den besked, saelgeren og koeberen faktisk faar, i de tre tilfaelde:
//   1. ikke parkeret                       -> beskeden fra foer
//   2. parkeret, ingen laas (kontakt slukket) -> beskeden fra foer (parkeret udgave)
//   3. parkeret med en holdt laas           -> ejerens laaste besked
// Koeberens besked er upaavirket af laasen.
//
// Refs #6181
import test from "node:test";
import assert from "node:assert/strict";

import { clearFlagStageCache } from "./featureStage.js";
import { SALE_ESCROW_FLAG_KEY } from "./saleEscrowFlow6181.js";
import { confirmTransferOffer } from "./transferExecution.js";
import { finalizeAuctionById } from "./auctionFinalization.js";

const NOW = new Date("2026-11-13T12:00:00.000Z");
const LOCKED = "notif.saleEscrow.lockedMessage";

// ── in-memory supabase (samme form som parkedRiderGuard6181.test.js) ──────────

function rowsFor(db, table) {
  if (!db[table]) db[table] = [];
  if (table === "riders") {
    for (const r of db[table]) {
      if (r.is_academy === undefined) r.is_academy = false;
      if (r.is_retired === undefined) r.is_retired = false;
      if (r.squad === undefined) r.squad = "senior";
    }
  }
  return db[table];
}

function matches(row, filters) {
  return filters.every((f) => {
    const v = row[f.col];
    if (f.kind === "eq") return v === f.val;
    if (f.kind === "neq") return v !== f.val;
    if (f.kind === "in") return f.val.includes(v);
    if (f.kind === "gt") return v > f.val;
    if (f.kind === "isNull") return v === null || v === undefined;
    if (f.kind === "notNull") return v !== null && v !== undefined;
    return true;
  });
}

/** @param {Record<string, any[]>} db */
function makeSupabase(db) {
  function builder(table) {
    const state = { op: "select", filters: [], updateObj: null, insertObj: null };
    function apply() {
      const rows = rowsFor(db, table);
      if (state.op === "update") {
        const hit = rows.filter((r) => matches(r, state.filters));
        hit.forEach((r) => Object.assign(r, state.updateObj));
        return hit;
      }
      if (state.op === "insert") {
        const list = Array.isArray(state.insertObj) ? state.insertObj : [state.insertObj];
        const inserted = list.map((obj) => ({ id: `row-${rows.length + 1}`, ...obj }));
        rows.push(...inserted);
        return inserted;
      }
      return rows.filter((r) => matches(r, state.filters));
    }
    const api = {
      select() { return api; },
      update(obj) { state.op = "update"; state.updateObj = obj; return api; },
      insert(obj) { state.op = "insert"; state.insertObj = obj; return api; },
      upsert(obj) { state.op = "insert"; state.insertObj = obj; return api; },
      eq(col, val) { state.filters.push({ kind: "eq", col, val }); return api; },
      neq(col, val) { state.filters.push({ kind: "neq", col, val }); return api; },
      in(col, val) { state.filters.push({ kind: "in", col, val }); return api; },
      gt(col, val) { state.filters.push({ kind: "gt", col, val }); return api; },
      gte() { return api; },
      lte() { return api; },
      lt() { return api; },
      is(col) { state.filters.push({ kind: "isNull", col }); return api; },
      not(col) { state.filters.push({ kind: "notNull", col }); return api; },
      range() { return api; },
      or() { return api; },
      order() { return api; },
      limit() { return api; },
      single() { return Promise.resolve({ data: apply()[0] ?? null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: apply()[0] ?? null, error: null }); },
      then(resolve, reject) {
        try {
          const r = apply();
          return Promise.resolve({ data: r, count: r.length, error: null }).then(resolve, reject);
        } catch (e) { return Promise.reject(e).then(resolve, reject); }
      },
    };
    return api;
  }
  return {
    from(table) { return builder(table); },
    rpc(name, params) {
      const teams = rowsFor(db, "teams");
      if (name === "increment_balance_with_audit") {
        const team = teams.find((t) => t.id === params.p_team_id);
        if (team) team.balance += params.p_delta;
        return Promise.resolve({ data: team?.balance ?? 0, error: null });
      }
      if (name === "hold_sale_escrow") {
        // Efterligner M1: koeber traekkes, beloebet laases, saelger faar intet endnu.
        const payer = teams.find((t) => t.id === params.p_payer_team_id);
        if (payer) payer.balance -= params.p_amount;
        rowsFor(db, "sale_escrows").push({
          id: `escrow-${params.p_deal_id}`, deal_type: params.p_deal_type, deal_id: params.p_deal_id,
          payer_team_id: params.p_payer_team_id, payee_team_id: params.p_payee_team_id,
          amount: params.p_amount, status: "held",
        });
        return Promise.resolve({ data: { status: "held" }, error: null });
      }
      return Promise.reject(new Error(`ukendt rpc ${name}`));
    },
  };
}

/** Rytteren koerer et aktivt etapeloeb for saelgeren (handlen parkeres), eller ej. */
function raceRows({ parked, riderId, teamId }) {
  return {
    races: parked ? [{ id: "race-1", race_type: "stage_race", status: "scheduled", stages_completed: 2 }] : [],
    race_entries: parked ? [{ race_id: "race-1", rider_id: riderId, team_id: teamId }] : [],
    race_withdrawals: [],
  };
}

/** Kontakten taendt i den lokale kopi, saa en parkeret handel faktisk laases. */
const flagRows = (locked) => (locked ? [{ key: SALE_ESCROW_FLAG_KEY, value: "on" }] : []);

function recorder() {
  /** @type {Array<{ teamId: string, type: string, message: string, metadata: any }>} */
  const sent = [];
  return { sent, notifyTeamOwner: async (teamId, type, _title, message, _relatedId, metadata) => { sent.push({ teamId, type, message, metadata }); } };
}

// ── transfer (B16) ────────────────────────────────────────────────────────────

function transferDb({ parked, locked }) {
  const sellerRiders = Array.from({ length: 9 }, (_, i) => ({
    id: `s-rider-${i}`, firstname: "S", lastname: `${i}`, team_id: "seller", pending_team_id: null,
  }));
  return {
    app_config: flagRows(locked),
    teams: [
      { id: "buyer", name: "Hold B", balance: 1000, division: 3, user_id: "u-b", is_bank: false },
      { id: "seller", name: "Hold A", balance: 500, division: 3, user_id: "u-a", is_bank: false },
    ],
    riders: [
      { id: "rider-1", firstname: "Rytter", lastname: "En", team_id: "seller", pending_team_id: null,
        salary: 0, prize_earnings_bonus: 0, contract_length: null, contract_end_season: null },
      ...sellerRiders,
    ],
    transfer_offers: [{
      id: "offer-1", rider_id: "rider-1", seller_team_id: "seller", buyer_team_id: "buyer",
      offer_amount: 200, counter_amount: null, status: "awaiting_confirmation",
      buyer_confirmed: false, seller_confirmed: true,
    }],
    swap_offers: [],
    transfer_listings: [],
    auctions: [],
    auction_proxy_bids: [],
    seasons: [{ id: "season-1", number: 1, status: "active" }],
    transfer_windows: [{ status: "open", created_at: "2026-11-01" }],
    sale_escrows: [],
    ...raceRows({ parked, riderId: "rider-1", teamId: "seller" }),
  };
}

async function runTransfer(opts) {
  clearFlagStageCache();
  const db = transferDb(opts);
  const rec = recorder();
  const result = await confirmTransferOffer({
    supabase: makeSupabase(db), offerId: "offer-1", confirmingTeamId: "buyer", notifyTeamOwner: rec.notifyTeamOwner, now: NOW,
  });
  assert.equal(result.ok, true, `handlen gennemfoeres (${JSON.stringify(result)})`);
  const of = (teamId) => rec.sent.filter((n) => n.teamId === teamId && n.metadata?.messageCode?.startsWith?.("notif.") && n.metadata.titleCode === "notif.transfer.completed.title");
  const [seller] = of("seller");
  const [buyer] = of("buyer");
  assert.ok(seller && buyer, "begge faar handelsbeskeden");
  return { db, seller, buyer };
}

test("#6181 B16 transfer, ikke parkeret: saelgeren faar beskeden fra foer", async () => {
  const { seller, buyer, db } = await runTransfer({ parked: false, locked: false });
  assert.equal(seller.metadata.messageCode, "notif.transfer.completed.message");
  assert.equal(buyer.metadata.messageCode, "notif.transfer.completed.message");
  assert.deepEqual(seller.metadata.messageParams, buyer.metadata.messageParams);
  assert.equal(db.sale_escrows.length, 0);
});

test("#6181 B16 transfer, parkeret uden laas (kontakten slukket): saelgeren faar den parkerede besked fra foer", async () => {
  const { seller, buyer, db } = await runTransfer({ parked: true, locked: false });
  assert.equal(seller.metadata.messageCode, "notif.transfer.completed.messageDeferred");
  assert.equal(buyer.metadata.messageCode, "notif.transfer.completed.messageDeferred");
  assert.equal(db.sale_escrows.length, 0);
  assert.equal(db.riders.find((r) => r.id === "rider-1").pending_team_id, "buyer", "handlen er parkeret");
});

test("#6181 B16 transfer, parkeret med holdt laas: kun saelgeren faar ejerens laaste besked", async () => {
  const { seller, buyer, db } = await runTransfer({ parked: true, locked: true });
  assert.deepEqual(db.sale_escrows.map((e) => e.status), ["held"], "handlen er laast");
  assert.equal(seller.metadata.messageCode, LOCKED);
  assert.deepEqual(seller.metadata.messageParams, { riderName: "Rytter En", price: 200 });
  assert.equal(seller.metadata.titleCode, "notif.transfer.completed.title", "titlen er den, saelgeren faar i dag");
  assert.equal(buyer.metadata.messageCode, "notif.transfer.completed.messageDeferred", "koeberens besked er som uden laas");
  assert.equal(db.teams.find((t) => t.id === "seller").balance, 500, "saelgeren er ikke krediteret endnu");
});

// ── auktion (B17) ─────────────────────────────────────────────────────────────

function auctionDb({ parked, locked }) {
  const rider = { id: "rider-a", firstname: "Rytter", lastname: "To", team_id: "seller", pending_team_id: null,
    salary: 10, contract_length: 2, contract_end_season: 3, is_academy: false, is_retired: false, squad: "senior" };
  const sellerRiders = Array.from({ length: 9 }, (_, i) => ({
    id: `as-rider-${i}`, firstname: "S", lastname: `${i}`, team_id: "seller", pending_team_id: null,
  }));
  return {
    app_config: flagRows(locked),
    auctions: [{ id: "auction-1", status: "active", current_bidder_id: "buyer", current_price: 300, seller_team_id: "seller", rider_id: rider.id, rider }],
    teams: [
      { id: "buyer", name: "Hold B", balance: 5000, division: 3, user_id: "u-b", is_bank: false, is_ai: false },
      { id: "seller", name: "Hold A", balance: 100, division: 3, user_id: "u-a", is_bank: false, is_ai: false },
    ],
    riders: [rider, ...sellerRiders],
    seasons: [{ id: "season-1", number: 1, status: "active" }],
    transfer_windows: [{ status: "open", created_at: "2026-11-01" }],
    transfer_listings: [],
    transfer_offers: [],
    swap_offers: [],
    auction_bids: [],
    academy_graduation: [],
    rider_ownership_events: [],
    finance_transactions: [],
    sale_escrows: [],
    ...raceRows({ parked, riderId: rider.id, teamId: "seller" }),
  };
}

async function runAuction(opts) {
  clearFlagStageCache();
  const db = auctionDb(opts);
  const rec = recorder();
  const result = await finalizeAuctionById({
    supabase: makeSupabase(db), auctionId: "auction-1", notifyTeamOwner: rec.notifyTeamOwner, now: NOW,
  });
  assert.equal(result.ok, true, `auktionen afsluttes (${JSON.stringify(result)})`);
  const seller = rec.sent.find((n) => n.teamId === "seller" && n.type === "auction_sold");
  const buyer = rec.sent.find((n) => n.teamId === "buyer" && n.type === "auction_won");
  assert.ok(seller && buyer, "baade saelger og koeber faar besked");
  return { db, seller, buyer };
}

test("#6181 B17 auktion, ikke laast: saelgerens 'solgt for'-besked har rytterens navn i de samme felter som foer", async () => {
  for (const parked of [false, true]) {
    const { seller, buyer, db } = await runAuction({ parked, locked: false });
    assert.equal(seller.metadata.messageCode, "notif.auction.soldMessage", `parkeret=${parked}`);
    assert.deepEqual(seller.metadata.messageParams, { rider: "Rytter To", price: 300 }, `parkeret=${parked}`);
    assert.equal(buyer.metadata.messageCode === LOCKED, false);
    assert.equal(db.sale_escrows.length, 0);
  }
});

test("#6181 B17 auktion, parkeret med holdt laas: saelgeren faar ejerens laaste besked, koeberen sin egen", async () => {
  const unlocked = await runAuction({ parked: true, locked: false });
  const { seller, buyer, db } = await runAuction({ parked: true, locked: true });
  assert.deepEqual(db.sale_escrows.map((e) => e.status), ["held"]);
  assert.equal(seller.metadata.messageCode, LOCKED);
  assert.deepEqual(seller.metadata.messageParams, { riderName: "Rytter To", price: 300 });
  assert.equal(seller.metadata.titleCode, "notif.auction.soldTitle");
  assert.equal(buyer.metadata.messageCode, unlocked.buyer.metadata.messageCode, "koeberens besked er som uden laas");
  assert.deepEqual(buyer.metadata.messageParams, unlocked.buyer.metadata.messageParams);
});
